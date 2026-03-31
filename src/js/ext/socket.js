/**
 * oja/socket.js
 * SSE (Server-Sent Events) and WebSocket — both with automatic reconnection.
 *
 * ─── SSE — server pushes to client ───────────────────────────────────────────
 *
 *   import { OjaSSE } from '../oja/socket.js';
 *
 *   const sse = new OjaSSE('/api/events', { withCredentials: true });
 *
 *   sse.on('metrics', (data) => updateMetrics(data));
 *   sse.on('log',     (data) => appendLog(data));
 *   sse.on('alert',   (data) => notify.warn(data.message));
 *
 *   sse.onConnect(()    => notify.dismissBanner());
 *   sse.onDisconnect(() => notify.banner('Connection lost', { type: 'warn' }));
 *
 *   sse.close(); // stop listening
 *
 * ─── WebSocket — two-way communication ───────────────────────────────────────
 *
 *   import { OjaSocket } from '../oja/socket.js';
 *
 *   const ws = new OjaSocket('wss://api.example.com/live');
 *
 *   ws.on('connect',    ()     => ws.send({ type: 'subscribe', channel: 'hosts' }));
 *   ws.on('message',    (data) => handleMessage(data));
 *   ws.on('disconnect', ()     => notify.warn('Disconnected'));
 *
 *   ws.send({ type: 'ping' });
 *   ws.close();
 *
 * ─── MessagePack codec (opt-in) ───────────────────────────────────────────────
 *
 *   import { MsgPackCodec } from '../oja/codecs/msgpack.js';
 *
 *   const ws = new OjaSocket('wss://api.example.com/live', {
 *       codec: new MsgPackCodec()
 *   });
 *
 * ─── Reconnection ────────────────────────────────────────────────────────────
 *
 *   Both SSE and WebSocket reconnect automatically with exponential backoff:
 *     attempt 1: 1s, attempt 2: 2s, attempt 3: 4s ... max: 30s
 *
 *   new OjaSSE('/events', {
 *       reconnect      : true,   // default: true
 *       reconnectDelay : 1000,   // base delay ms (default: 1000)
 *       maxDelay       : 30000,  // max delay ms  (default: 30000)
 *       maxAttempts    : 10,     // 0 = unlimited (default: 0)
 *   });
 */

import { emit as _emit } from '../core/events.js';


const JsonCodec = {
    encode: (data)    => JSON.stringify(data),
    decode: (raw)     => {
        if (typeof raw === 'string') return JSON.parse(raw);
        // ArrayBuffer from binary WebSocket frame
        return JSON.parse(new TextDecoder().decode(raw));
    },
    binaryType: 'text'
};


export class OjaSSE {
    /**
     * @param {string} url
     * @param {Object} options
     *   withCredentials : bool     — send cookies (default: true)
     *   reconnect       : bool     — auto-reconnect (default: true)
     *   reconnectDelay  : number   — base ms (default: 1000)
     *   maxDelay        : number   — max ms  (default: 30000)
     *   maxAttempts     : number   — 0 = unlimited (default: 0)
     *   headers         : Object   — NOT supported by native EventSource
     *                                Use auth token in URL or cookie instead
     */
    constructor(url, options = {}) {
        this._url       = url;
        this._opts      = {
            withCredentials : true,
            reconnect       : true,
            reconnectDelay  : 1000,
            maxDelay        : 30000,
            maxAttempts     : 0,
            ...options
        };
        this._handlers   = new Map();  // event → Set<fn>
        this._source     = null;
        this._attempts   = 0;
        this._closed     = false;
        this._reconnTimer= null;

        this._connect();
    }

    // ─── Event listeners ──────────────────────────────────────────────────────

    /**
     * Listen for a named SSE event.
     * Handler receives parsed JSON data.
     * Returns an unsubscribe function.
     *
     *   const unsub = sse.on('metrics', (data) => updateMetrics(data));
     *   unsub(); // stop listening to this event
     */
    on(eventName, handler) {
        if (!this._handlers.has(eventName)) this._handlers.set(eventName, new Set());
        this._handlers.get(eventName).add(handler);
        // If already connected, bind to the live source
        if (this._source) this._bindEvent(eventName);
        return () => this._handlers.get(eventName)?.delete(handler);
    }

    /** Called when connection is established */
    onConnect(fn) { return this.on('__connect__', fn); }

    /** Called when connection is lost (before reconnect) */
    onDisconnect(fn) { return this.on('__disconnect__', fn); }

    /** Called when max reconnect attempts exceeded */
    onFailed(fn) { return this.on('__failed__', fn); }

    // ─── Control ──────────────────────────────────────────────────────────────

    /** Permanently close the connection — no more reconnects */
    close() {
        this._closed = true;
        clearTimeout(this._reconnTimer);
        this._source?.close();
        this._source = null;
    }

    /** Current readyState: 0=connecting, 1=open, 2=closed */
    get readyState() {
        return this._source?.readyState ?? 2;
    }

    // ─── Internals ────────────────────────────────────────────────────────────

    _connect() {
        if (this._closed) return;

        this._source = new EventSource(this._url, {
            withCredentials: this._opts.withCredentials
        });

        this._source.onopen = () => {
            this._attempts = 0;
            this._fire('__connect__', {});
            _emit('sse:connect', { url: this._url });
        };

        this._source.onerror = () => {
            this._source.close();
            this._fire('__disconnect__', {});
            _emit('sse:disconnect', { url: this._url });
            this._scheduleReconnect();
        };

        // Bind all registered event handlers to the new source
        for (const eventName of this._handlers.keys()) {
            if (!eventName.startsWith('__')) this._bindEvent(eventName);
        }
    }

    _bindEvent(eventName) {
        if (!this._source) return;
        this._source.addEventListener(eventName, (e) => {
            let data = e.data;
            try { data = JSON.parse(e.data); } catch {
                console.warn(`[oja/sse] failed to parse JSON from "${eventName}"`);
            }
            this._fire(eventName, data);
            _emit(`sse:${eventName}`, { data, url: this._url });
        });
    }

    _fire(eventName, data) {
        this._handlers.get(eventName)?.forEach(fn => {
            try { fn(data); } catch (e) {
                console.warn(`[oja/socket] handler error for "${eventName}":`, e);
            }
        });
    }

    _scheduleReconnect() {
        if (this._closed || !this._opts.reconnect) return;

        const max = this._opts.maxAttempts;
        if (max > 0 && this._attempts >= max) {
            this._fire('__failed__', { attempts: this._attempts });
            _emit('sse:failed', { url: this._url });
            return;
        }

        this._attempts++;
        // Exponential backoff with jitter
        const base  = this._opts.reconnectDelay;
        const delay = Math.min(base * Math.pow(2, this._attempts - 1), this._opts.maxDelay);
        const jitter= Math.random() * 500;

        this._reconnTimer = setTimeout(() => this._connect(), delay + jitter);
    }
}


export class OjaSocket {
    /**
     * @param {string} url            — ws:// or wss://
     * @param {Object} options
     *   protocols       : string[]   — WebSocket subprotocols
     *   codec           : object     — { encode, decode, binaryType } (default: JSON)
     *   reconnect       : bool       — auto-reconnect (default: true)
     *   reconnectDelay  : number     — base ms (default: 1000)
     *   maxDelay        : number     — max ms  (default: 30000)
     *   maxAttempts     : number     — 0 = unlimited (default: 0)
     *   pingInterval    : number     — ms between pings, 0 = disabled (default: 0)
     *   pingMessage     : any        — message to send as ping (default: 'ping')
     */
    constructor(url, options = {}) {
        this._url       = url;
        this._opts      = {
            protocols       : [],
            codec           : JsonCodec,
            reconnect       : true,
            reconnectDelay  : 1000,
            maxDelay        : 30000,
            maxAttempts     : 0,
            pingInterval    : 0,
            pingMessage     : 'ping',
            maxQueueSize    : 100,   // max messages queued while disconnected
            ...options
        };
        this._ws         = null;
        this._handlers   = new Map();
        this._queue      = [];   // messages queued while connecting
        this._maxQueue   = this._opts.maxQueueSize ?? 100; // bounded — see send()
        this._attempts   = 0;
        this._closed     = false;
        this._reconnTimer= null;
        this._pingTimer  = null;

        this._connect();
    }

    // ─── Event listeners ──────────────────────────────────────────────────────

    /**
     * Listen for a message type.
     * Handler receives decoded message data.
     * Special events: 'connect', 'disconnect', 'error', 'message' (all messages)
     *
     *   ws.on('metrics', (data) => updateMetrics(data));
     *   ws.on('message', (data) => console.log('any message:', data));
     */
    on(eventName, handler) {
        if (!this._handlers.has(eventName)) this._handlers.set(eventName, new Set());
        this._handlers.get(eventName).add(handler);
        return () => this._handlers.get(eventName)?.delete(handler);
    }

    onConnect(fn)    { return this.on('connect', fn); }
    onDisconnect(fn) { return this.on('disconnect', fn); }
    onError(fn)      { return this.on('error', fn); }

    // ─── Sending ──────────────────────────────────────────────────────────────

    /**
     * Send a message — queued automatically if not yet connected.
     * Objects are encoded with the configured codec.
     * Async to handle lazy-loaded binary codecs like MsgPack.
     */
    async send(data) {
        // Await encode in case it returns a Promise (e.g. MsgPackCodec)
        const encoded = typeof data === 'string'
            ? data
            : await Promise.resolve(this._opts.codec.encode(data));

        if (this._ws?.readyState === WebSocket.OPEN) {
            this._ws.send(encoded);
        } else {
            // Cap the outbound queue so a long disconnection (server down) with
            // frequent send() calls doesn't exhaust memory. The oldest message
            // is dropped when the limit is reached — callers that need delivery
            // guarantees should listen for 'oja:socket:queue-overflow'.
            if (this._queue.length >= this._maxQueue) {
                this._queue.shift();
                _emit('oja:socket:queue-overflow', { url: this._opts.url, dropped: 1 });
            }
            this._queue.push(encoded);
        }
        return this;
    }

    // ─── Control ──────────────────────────────────────────────────────────────

    close() {
        this._closed = true;
        clearTimeout(this._reconnTimer);
        clearInterval(this._pingTimer);
        this._ws?.close();
        this._ws = null;
    }

    get readyState() {
        return this._ws?.readyState ?? WebSocket.CLOSED;
    }

    get isConnected() {
        return this._ws?.readyState === WebSocket.OPEN;
    }

    // ─── Internals ────────────────────────────────────────────────────────────

    _connect() {
        if (this._closed) return;

        const protocols = this._opts.protocols;
        this._ws = protocols.length
            ? new WebSocket(this._url, protocols)
            : new WebSocket(this._url);

        this._ws.binaryType = this._opts.codec.binaryType === 'binary'
            ? 'arraybuffer'
            : 'blob';

        this._ws.onopen = () => {
            this._attempts = 0;

            // Flush queued messages
            while (this._queue.length) {
                this._ws.send(this._queue.shift());
            }

            // Start ping interval
            if (this._opts.pingInterval > 0) {
                this._pingTimer = setInterval(() => {
                    this.send(this._opts.pingMessage);
                }, this._opts.pingInterval);
            }

            this._fire('connect', {});
            _emit('ws:connect', { url: this._url });
        };

        this._ws.onmessage = async (e) => {
            // Await decode in case it returns a Promise
            let data = e.data;
            try {
                data = await Promise.resolve(this._opts.codec.decode(e.data));
            } catch {
                console.warn('[oja/socket] failed to decode message');
            }

            // Fire typed handler if message has a .type field
            if (data && typeof data === 'object' && data.type) {
                this._fire(data.type, data);
            }

            // Always fire generic 'message' handler
            this._fire('message', data);
            _emit('ws:message', { data, url: this._url });
        };

        this._ws.onerror = (e) => {
            this._fire('error', e);
            _emit('ws:error', { url: this._url });
        };

        this._ws.onclose = (e) => {
            clearInterval(this._pingTimer);
            this._pingTimer = null;
            this._fire('disconnect', { code: e.code, reason: e.reason });
            _emit('ws:disconnect', { url: this._url, code: e.code });
            this._scheduleReconnect();
        };
    }

    _fire(eventName, data) {
        this._handlers.get(eventName)?.forEach(fn => {
            try { fn(data); } catch (e) {
                console.warn(`[oja/socket] handler error for "${eventName}":`, e);
            }
        });
    }

    _scheduleReconnect() {
        if (this._closed || !this._opts.reconnect) return;

        const max = this._opts.maxAttempts;
        if (max > 0 && this._attempts >= max) {
            this._fire('failed', { attempts: this._attempts });
            _emit('ws:failed', { url: this._url });
            return;
        }

        this._attempts++;
        const base  = this._opts.reconnectDelay;
        const delay = Math.min(base * Math.pow(2, this._attempts - 1), this._opts.maxDelay);
        const jitter= Math.random() * 500;

        this._reconnTimer = setTimeout(() => this._connect(), delay + jitter);
    }
}