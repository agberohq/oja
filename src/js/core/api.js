/**
 * oja/api.js
 * Fetch wrapper with auth, online/offline detection, and codec support.
 * Each app creates its own instance — base URLs and tokens stay isolated.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { Api } from '../oja/api.js';
 *
 *   const api = new Api({ base: window.location.origin });
 *
 *   api.setToken(jwt);
 *
 *   const data = await api.get('/config');
 *   const res  = await api.post('/firewall', { ip: '1.2.3.4', reason: 'Abuse' });
 *   const ok   = await api.delete('/firewall?ip=1.2.3.4');
 *
 *   api.onOffline(() => notify.banner('Connection lost', { type: 'warn' }));
 *   api.onOnline(()  => notify.dismissBanner());
 *
 * ─── MessagePack (opt-in) ─────────────────────────────────────────────────────
 *
 *   import { MsgPackCodec } from '../oja/codecs/msgpack.js';
 *
 *   const api = new Api({
 *       base  : window.location.origin,
 *       codec : new MsgPackCodec()
 *   });
 *
 *   // All requests now use Content-Type: application/msgpack
 *   // Responses decoded with MessagePack automatically
 *
 * ─── Request hooks ────────────────────────────────────────────────────────────
 *
 *   // Before every request — add custom headers, log, etc.
 *   api.beforeRequest((path, method, opts) => {
 *       opts.headers['X-Request-ID'] = crypto.randomUUID();
 *   });
 *
 *   // After every response — log, metrics, etc.
 *   api.afterResponse((path, method, res, ms) => {
 *       logger.debug('api', `${method} ${path}`, { ms, status: res.status });
 *   });
 *
 * ─── Events emitted ───────────────────────────────────────────────────────────
 *
 *   api:unauthorized  → 401 received    — auth.js listens to this
 *   api:error         → 5xx received
 *   api:offline       → fetch failed
 *   api:online        → connection restored
 */

import { jsonCodec } from './codecs/json.js';
import { runtime }   from './runtime.js';

export class Api {
    /**
     * @param {Object} options
     *   base          : string    — base URL prefix for all requests
     *   codec         : object    — encode/decode codec (default: JSON)
     *   timeout       : number    — ms before request aborts (default: 30000)
     *   retries       : number    — retry count on network failure (default: 0)
     *   retryDelay    : number    — ms between retries (default: 1000)
     */
    constructor(options = {}) {
        if (typeof options === 'string') options = { base: options };

        this._base          = options.base    || '';
        this._codec         = options.codec   || jsonCodec;
        this._timeout       = options.timeout || 30000;
        this._retries       = options.retries || 0;
        this._retryDelay    = options.retryDelay || 1000;

        this._token         = null;
        this._basic         = null;
        this._isOnline      = true;
        this._offlineFn     = null;
        this._onlineFn      = null;
        this._beforeHooks   = [];
        this._afterHooks    = [];

        this._queueWhenOffline    = false;
        this._offlineQueue        = [];
        this._csrfToken           = null;
        this._refreshToken        = null;
        this._refreshEndpoint     = '/auth/refresh';
        this._isRefreshing        = false;
        this._refreshSubscribers  = [];
        this._retryStrategies     = {
            '429': true,
            '503': true,
            '504': true,
        };

        this._setupOnlineDetection();
    }

    // Auth

    setToken(token) {
        this._token = token;
        this._basic = null;
        return this;
    }

    setBasic(encoded) {
        this._basic  = encoded;
        this._token  = null;
        return this;
    }

    clearAuth() {
        this._token = null;
        this._basic = null;
        return this;
    }

    isAuthenticated() {
        return !!(this._token || this._basic);
    }

    // Retry strategies

    /**
     * Configure retry behaviour for specific HTTP status codes.
     *
     *   api.retryWhen(429, true);
     *   api.retryWhen({ 429: true, 503: true, 500: false });
     */
    retryWhen(statusCode, shouldRetry = true) {
        if (typeof statusCode === 'object') {
            Object.assign(this._retryStrategies, statusCode);
        } else {
            this._retryStrategies[statusCode] = shouldRetry;
        }
        return this;
    }

    /**
     * Enable or disable offline queueing for mutations.
     * When enabled, POST/PUT/PATCH/DELETE requests are queued while offline
     * and replayed in order once the connection is restored.
     */
    queueWhenOffline(enable = true) {
        this._queueWhenOffline = enable;
        return this;
    }

    /**
     * Set CSRF token for request safety.
     * Added automatically to all non-GET/HEAD requests as X-CSRF-Token.
     */
    withCsrf(token) {
        this._csrfToken = token;
        return this;
    }

    /**
     * Configure a refresh token for automatic 401 handling.
     * On a 401, the SDK refreshes the access token and retries the original
     * request once before propagating the error.
     */
    withRefreshToken(token, endpoint = '/auth/refresh') {
        this._refreshToken    = token;
        this._refreshEndpoint = endpoint;
        return this;
    }

    /**
     * Replay all queued offline requests in the order they were made.
     * Items that fail are re-queued so they are not silently lost, but
     * callers should treat re-queued items as potentially out-of-date.
     * Called automatically when the connection is restored.
     */
    async flushQueue() {
        if (!this._offlineQueue.length) return;

        const queue = [...this._offlineQueue];
        this._offlineQueue = [];

        for (const item of queue) {
            try {
                await this._request(item.path, item.method, item.body, item.options);
            } catch (e) {
                console.warn('[oja/api] Failed to replay queued request:', item, e);
                this._offlineQueue.push(item);
            }
        }
    }

    // Hooks

    /**
     * Called before every request.
     * fn(path, method, fetchOptions) — mutate fetchOptions.headers to add custom headers.
     */
    beforeRequest(fn) {
        this._beforeHooks.push(fn);
        return this;
    }

    /**
     * Called after every response.
     * fn(path, method, response, elapsedMs)
     */
    afterResponse(fn) {
        this._afterHooks.push(fn);
        return this;
    }

    // Online / offline

    onOffline(fn) { this._offlineFn = fn; return this; }
    onOnline(fn)  { this._onlineFn  = fn; return this; }

    // HTTP verbs

    get(path, options = {})         { return this._request(path, 'GET',    null, options); }
    post(path, body, options = {})  { return this._request(path, 'POST',   body, options); }
    put(path, body, options = {})   { return this._request(path, 'PUT',    body, options); }
    patch(path, body, options = {}) { return this._request(path, 'PATCH',  body, options); }
    delete(path, options = {})      { return this._request(path, 'DELETE', null, options); }

    /**
     * Upload a file or FormData — lets the browser set the correct
     * multipart boundary by skipping codec encoding.
     */
    upload(path, formData, options = {}) {
        return this._request(path, 'POST', formData, { ...options, raw: true });
    }

    // Core

    async _request(path, method, body = null, options = {}) {
        // Queue the request if offline and queueing is enabled.
        // A single permanent listener on the 'online' window event (registered
        // in _setupOnlineDetection) handles flushing — we do not add a new
        // listener per queued request, which would cause N flush calls on
        // reconnect and potentially duplicate or out-of-order requests.
        if (!navigator.onLine && this._queueWhenOffline && method !== 'GET') {
            this._offlineQueue.push({ path, method, body, options });
            this._setOnline(false);
            _emit('api:queued', { path, method });
            return new Promise(() => {}); // resolves when flushed
        }

        if (this._refreshToken && !options._skipRefresh) {
            return this._requestWithRefresh(path, method, body, options);
        }

        return this._executeRequest(path, method, body, options);
    }

    async _requestWithRefresh(path, method, body, options) {
        try {
            return await this._executeRequest(path, method, body, options);
        } catch (error) {
            // Network failures arrive as TypeError with no .status property.
            // Do not attempt a token refresh for those — the server never
            // returned a 401, and the refresh request would also fail.
            if (error instanceof TypeError || error.status !== 401) throw error;

            if (this._isRefreshing) {
                return new Promise(resolve => {
                    this._refreshSubscribers.push(resolve);
                });
            }

            this._isRefreshing = true;

            try {
                const newToken = await this._refreshTokenRequest();
                this.setToken(newToken);
                this._refreshSubscribers.forEach(resolve => resolve());
                this._refreshSubscribers = [];
                return this._executeRequest(path, method, body, { ...options, _skipRefresh: true });
            } catch (refreshError) {
                // The refresh token itself failed — the session is definitively
                // dead. Clear all pending subscribers and notify auth.js so it
                // can trigger a clean logout rather than leaving the app in a
                // half-authenticated state until the user manually refreshes.
                this._refreshSubscribers.forEach(resolve => resolve(null));
                this._refreshSubscribers = [];
                this.setToken(null);

                _emit('api:unauthorized', { path, method, reason: 'refresh_failed' });
                throw refreshError;
            } finally {
                this._isRefreshing = false;
            }
        }
    }

    async _refreshTokenRequest() {
        const res = await fetch(this._refreshEndpoint, {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + this._refreshToken },
        });
        if (!res.ok) throw new Error('Token refresh failed');
        const { token } = await res.json();
        return token;
    }

    async _executeRequest(path, method, body = null, options = {}) {
        const headers = {};

        if (this._token)      headers['Authorization'] = 'Bearer ' + this._token;
        else if (this._basic) headers['Authorization'] = 'Basic '  + this._basic;

        if (this._csrfToken && method !== 'GET' && method !== 'HEAD') {
            headers['X-CSRF-Token'] = this._csrfToken;
        }

        if (body !== null && !options.raw) {
            headers['Content-Type'] = this._codec.contentType;
            headers['Accept']       = this._codec.contentType;
        }

        if (options.headers) Object.assign(headers, options.headers);

        const opts = { method, headers };

        if (body !== null) {
            if (options.raw || body instanceof FormData) {
                opts.body = body;
                delete opts.headers['Content-Type'];
            } else {
                opts.body = await Promise.resolve(this._codec.encode(body));
            }
        }

        for (const fn of this._beforeHooks) {
            try { await fn(path, method, opts); } catch (e) {
                console.warn('[oja/api] beforeRequest hook error:', e);
            }
        }

        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), this._timeout);
        opts.signal = controller.signal;

        // Run global fetch hooks (pipeline) — e.g. add trace headers, sign requests.
        // This runs after instance-level beforeRequest hooks so instance config wins.
        const finalOpts = runtime.runFetchHooks(this._base + path, opts);

        const url     = this._base + path;
        const startMs = Date.now();
        let   res     = null;
        let   attempt = 0;

        while (attempt <= this._retries) {
            try {
                res = await fetch(url, finalOpts);
                clearTimeout(timeoutId);
                this._setOnline(true);
                break;
            } catch (e) {
                attempt++;
                if (attempt > this._retries || e.name === 'AbortError') {
                    clearTimeout(timeoutId);
                    this._setOnline(false);
                    runtime.reportError(e, 'api');
                    return null;
                }
                await _wait(this._retryDelay * attempt);
            }
        }

        const elapsedMs = Date.now() - startMs;

        for (const fn of this._afterHooks) {
            try { await fn(path, method, res, elapsedMs); } catch (e) {
                console.warn('[oja/api] afterResponse hook error:', e);
            }
        }

        if (res.status === 401) {
            _emit('api:unauthorized', { path, method });
            throw Object.assign(new Error('Unauthorized'), { status: 401 });
        }

        if (res.status === 204) return true;
        if (res.status === 404) return null;

        if (res.status >= 500) {
            _emit('api:error', { status: res.status, path, method });

            // Retry 5xx responses that are configured as retryable.
            // Pass the remaining attempt budget through so retries are bounded.
            // Previously this called _executeRequest recursively with a fresh
            // local `attempt = 0`, which made the retry counter ineffective
            // and could produce unbounded retries on persistent 5xx responses.
            if (this._retryStrategies[res.status] && attempt < this._retries) {
                await _wait(this._retryDelay * (attempt + 1));
                return this._executeRequest(path, method, body, {
                    ...options,
                    _attempt: (options._attempt || 0) + 1,
                });
            }

            throw Object.assign(new Error(`Server error: ${res.status}`), { status: res.status });
        }

        return this._decode(res);
    }

    async _decode(res) {
        const ct = res.headers.get('content-type') || '';

        if (ct.includes('msgpack') || this._codec.binaryType === 'binary') {
            try {
                const buf = await res.arrayBuffer();
                if (!buf.byteLength) return null;
                return await Promise.resolve(this._codec.decode(buf));
            } catch {
                return null;
            }
        }

        // Read the raw text first so it is never lost regardless of content type.
        // JSON is attempted only when the content-type indicates it; otherwise
        // the raw string is returned so callers receive text/csv, text/plain, etc.
        try {
            const text = await res.text();
            if (!text.trim()) return null;

            if (ct.includes('json') || ct === '') {
                try {
                    return jsonCodec.decode(text);
                } catch {
                    // Server sent Content-Type: application/json but the body
                    // is not valid JSON — return the raw text rather than null
                    // so the caller can inspect or log it.
                    return text;
                }
            }

            return text;
        } catch {
            return null;
        }
    }

    _setOnline(online) {
        if (this._isOnline === online) return;
        this._isOnline = online;
        if (online  && this._onlineFn)  this._onlineFn();
        if (!online && this._offlineFn) this._offlineFn();
        _emit(online ? 'api:online' : 'api:offline');
    }

    // Store listener references so destroy() can remove them.
    // Previously anonymous listeners were added with no way to remove them,
    // causing leaks when multiple Api instances are created.
    _setupOnlineDetection() {
        if (typeof window === 'undefined') return;
        this._onOnline  = () => { this._setOnline(true); this.flushQueue(); };
        this._onOffline = () => this._setOnline(false);
        window.addEventListener('online',  this._onOnline);
        window.addEventListener('offline', this._onOffline);
    }

    /**
     * Remove window event listeners registered by this Api instance.
     * Call when the instance is no longer needed to prevent memory leaks.
     */
    destroy() {
        if (this._onOnline)  window.removeEventListener('online',  this._onOnline);
        if (this._onOffline) window.removeEventListener('offline', this._onOffline);
        this._onOnline  = null;
        this._onOffline = null;
    }
}

function _emit(name, detail = {}) {
    if (typeof document === 'undefined') return;
    document.dispatchEvent(new CustomEvent(name, { detail }));
}

function _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
