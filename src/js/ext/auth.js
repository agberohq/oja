/**
 * oja/auth.js
 * Session management, token security, and route protection.
 * Works unchanged across web and mobile — storage cascade handles environment.
 *
 * NOTE ON SECURITY: _decodeJWT() extracts payload for UI convenience (names, roles).
 * It does NOT cryptographically verify the signature. Final security verification
 * must always be performed by your server.
 *
 * ─── Setup (once in app.js) ───────────────────────────────────────────────────
 *
 *   import { auth } from '../oja/auth.js';
 *
 *   // Define protection levels
 *   auth.level('protected', () => auth.session.isActive());
 *   auth.level('admin',     () => auth.session.isActive() && auth.hasRole('admin'));
 *   auth.level('auditor',   () => auth.session.isActive() && auth.hasRole('auditor'));
 *
 *   // Session lifecycle hooks
 *   auth.session.OnStart(async (token) => {
 *       api.setToken(token);
 *       const dest = auth.session.intendedPath() || '/dashboard';
 *       auth.session.clearIntendedPath();
 *       router.navigate(dest);
 *   });
 *
 *   auth.session.OnRenew((newToken) => {
 *       api.setToken(newToken);
 *       notify.info('Session renewed');
 *   });
 *
 *   auth.session.OnExpiry(() => {
 *       notify.warn('Session expired');
 *       router.navigate('/login');
 *   });
 *
 * ─── Router integration ───────────────────────────────────────────────────────
 *
 *   // Auth levels plug directly into router middleware
 *   const r = new Router({ mode: 'hash', outlet: '#app' });
 *
 *   r.Get('/login', Responder.component('pages/login.html'));
 *
 *   const app = r.Group('/');
 *   app.Use(auth.middleware('protected', '/login'));
 *   app.Get('dashboard', Responder.component('pages/dashboard.html'));
 *
 * ─── Login / logout ───────────────────────────────────────────────────────────
 *
 *   // After successful API login:
 *   await auth.session.start(jwt);
 *
 *   // Logout:
 *   await auth.session.end();
 *   router.navigate('/login');
 *
 * ─── Reading session data ─────────────────────────────────────────────────────
 *
 *   auth.session.isActive()    // → true/false
 *   auth.session.token()       // → raw JWT string (async, decrypted)
 *   auth.session.user()        // → decoded JWT payload
 *   auth.session.expiresIn()   // → ms until expiry
 *   auth.hasRole('admin')      // → true/false
 *   auth.hasClaim('sub', '42') // → true/false
 */

import { Store }       from '../core/store.js';
import { emit, listen } from '../core/events.js';

// Cascade: sessionStorage (encrypted) → localStorage (encrypted) → memory
// Token is encrypted at rest. Metadata (exp, payload) is stored unencrypted
// in a separate store so synchronous reads (isActive, user) work without
// needing to decrypt.

const _tokenStore = new Store('oja:auth',      { encrypt: true, prefer: 'session' });
const _metaStore  = new Store('oja:auth:meta');  // non-sensitive: exp, payload, intendedPath

const _levels = new Map(); // name → () => bool

const _hooks = new Map([
    ['start', []],
    ['renew', []],
    ['expiry', []],
    ['refresh', []]
]);

const _timers = new Map([
    ['expiry', null],
    ['warning', null],
    ['refresh', null]
]);

let _refreshInProgress = false;
let _refreshSubscribers = [];

const REFRESH_THRESHOLD = 5 * 60 * 1000;
const REFRESH_BUFFER = 30 * 1000;

export const auth = {

    /**
     * Define a named protection level.
     * The check function is called synchronously before every protected route.
     *
     *   auth.level('protected', () => auth.session.isActive());
     *   auth.level('admin',     () => auth.session.isActive() && auth.hasRole('admin'));
     */
    level(name, checkFn) {
        _levels.set(name, checkFn);
        return this;
    },

    /**
     * Returns a router middleware function for a named protection level.
     * On failure: stores the intended destination and redirects to login.
     *
     *   app.Use(auth.middleware('protected', '/login'));
     */
    /**
     * Returns a router middleware function for a named protection level.
     *
     * The second argument can now be a callback (for modal-based login flows)
     * in addition to a redirect path string.
     *
     *   // Classic redirect (unchanged)
     *   app.Use(auth.middleware('protected', '/login'));
     *
     *   // Modal-based login — pass a callback instead of a path
     *   app.Use(auth.middleware('protected', () => modal.open('loginModal')));
     *   app.Use(auth.middleware('protected', { onFail: () => modal.open('loginModal') }));
     */
    middleware(levelName, redirectTo = '/login') {
        return async (ctx, next) => {
            const check = _levels.get(levelName);
            if (!check) {
                console.warn(`[oja/auth] unknown level: "${levelName}"`);
                await next();
                return;
            }

            if (!check()) {
                _metaStore.set('intendedPath',   ctx.path);
                _metaStore.set('intendedParams', ctx.params);

                // support callback or { onFail } object as redirect target
                if (typeof redirectTo === 'function') {
                    redirectTo();
                } else if (redirectTo && typeof redirectTo === 'object' && typeof redirectTo.onFail === 'function') {
                    redirectTo.onFail(ctx);
                } else {
                    ctx.redirect(redirectTo);
                }
                return;
            }

            await next();
        };
    },

    /**
     * Check if a named level passes right now.
     * Useful in app code outside of routing.
     *
     *   if (auth.guard('admin')) showAdminMenu();
     */
    guard(levelName) {
        const check = _levels.get(levelName);
        return check ? check() : false;
    },

    /**
     * Check if the current user has a JWT role claim.
     * Works with both string roles and array roles.
     *
     *   auth.hasRole('admin')
     */
    hasRole(role) {
        const user = auth.session.user();
        if (!user) return false;
        const roles = user.roles || user.role || user.permissions || [];
        if (Array.isArray(roles)) return roles.includes(role);
        return roles === role;
    },

    /**
     * Check if the JWT payload has a specific claim value.
     *
     *   auth.hasClaim('sub', '42')
     *   auth.hasClaim('email_verified', true)
     */
    hasClaim(claim, value) {
        const user = auth.session.user();
        if (!user) return false;
        return value !== undefined ? user[claim] === value : claim in user;
    },

    // Session

    session: {

        /**
         * Start a session with a JWT or opaque token.
         * Stores token encrypted, sets up expiry watch.
         * Fires OnStart hooks after setup.
         *
         *   await auth.session.start(jwt);
         */
        /**
         * Start a session with a JWT, opaque token, or Basic auth credential.
         *
         * The third argument `sessionOptions` allows non-JWT tokens to
         * specify an expiry or opt out of expiry entirely (e.g. Basic auth):
         *
         *   // JWT — expiry auto-detected from payload.exp (unchanged)
         *   await auth.session.start(jwt);
         *
         *   // Opaque token with explicit expiry
         *   await auth.session.start(opaqueToken, null, { expires: Date.now() + 8 * 3600_000 });
         *
         *   // Basic auth / no expiry — isActive() returns true while token present
         *   await auth.session.start(basicToken, null, { expires: null });
         */
        async start(token, refreshToken = null, sessionOptions = {}) {
            await _tokenStore.set('token', token);
            if (refreshToken) {
                await _tokenStore.set('refresh_token', refreshToken);
            }
            _metaStore.set('startedAt', Date.now());

            // Determine expiry — JWT payload takes priority, then explicit
            // sessionOptions.expires, then undefined (no expiry = never expires).
            const payload = _decodeJWT(token);

            if (payload?.exp) {
                // Standard JWT with exp claim
                const expMs = payload.exp * 1000;
                _metaStore.set('exp', expMs);
                _metaStore.set('payload', payload);
                _startExpiryWatch(expMs);
                _startRefreshWatch(expMs);
            } else if (sessionOptions.expires !== undefined) {
                if (sessionOptions.expires === null) {
                    // Explicit no-expiry (Basic auth, long-lived tokens)
                    // Store a sentinel so isActive() knows a session is live
                    _metaStore.set('exp', 'no-expiry');
                } else {
                    // Explicit timestamp
                    const expMs = sessionOptions.expires;
                    _metaStore.set('exp', expMs);
                    _startExpiryWatch(expMs);
                    _startRefreshWatch(expMs);
                }
            }
            // If no exp and no sessionOptions.expires: session is present but
            // isActive() will return false (original behaviour preserved for
            // callers who relied on that — they can pass { expires: null } to opt in).

            emit('auth:start', { token });
            _runHooks('start', token, refreshToken);
        },

        /**
         * End the session — clear token, stop timers, fire hooks.
         */
        async end() {
            _stopAllTimers();
            await _tokenStore.clear('token');
            await _tokenStore.clear('refresh_token');
            _metaStore.clear('exp');        // clears both numeric and 'no-expiry'
            _metaStore.clear('startedAt');
            _metaStore.clear('payload');
            emit('auth:end');
        },

        /**
         * Replace the current token — resets expiry watch.
         * Fires OnRenew hooks.
         *
         *   await auth.session.renew(newJwt);
         */
        async renew(newToken, newRefreshToken = null) {
            _stopAllTimers();
            await _tokenStore.set('token', newToken);

            if (newRefreshToken) {
                await _tokenStore.set('refresh_token', newRefreshToken);
            }

            const payload = _decodeJWT(newToken);
            if (payload?.exp) {
                const expMs = payload.exp * 1000;
                _metaStore.set('exp', expMs);
                _startExpiryWatch(expMs);
                _startRefreshWatch(expMs);
            }

            emit('auth:renew', { token: newToken });
            _runHooks('renew', newToken, newRefreshToken);
        },

        /**
         * Is a session currently active?
         * Checks that a session was started (exp exists in meta) and has not expired.
         */
        // isActive() now handles three cases:
        // JWT with exp claim    → check timestamp
        // 'no-expiry' sentinel  → true while token is stored
        // No exp at all         → false (original behaviour)
        isActive() {
            const exp = _metaStore.get('exp');
            if (!exp) return false;
            if (exp === 'no-expiry') return true; // explicit no-expiry
            if (Date.now() >= exp) return false;
            return true;
        },

        /**
         * Retrieve the raw token string (async, decrypted).
         */
        async token() {
            return _tokenStore.get('token');
        },

        /**
         * Decoded JWT payload — claims, roles, user info.
         * Returns null if no active session.
         */
        user() {
            if (!auth.session.isActive()) return null;
            return _metaStore.get('payload') || null;
        },

        /**
         * How many milliseconds until the session expires.
         * Returns Infinity if no expiry is set.
         */
        expiresIn() {
            const exp = _metaStore.get('exp');
            if (!exp) return Infinity;
            return Math.max(0, exp - Date.now());
        },

        /**
         * The path the user was trying to reach before being redirected to login.
         */
        intendedPath() {
            return _metaStore.get('intendedPath') || null;
        },

        clearIntendedPath() {
            _metaStore.clear('intendedPath');
            _metaStore.clear('intendedParams');
        },

        // Lifecycle hooks
        /**
         * Called after session.start() — use to set api token, navigate.
         *
         *   auth.session.OnStart(async (token) => {
         *       api.setToken(token);
         *       const dest = auth.session.intendedPath() || '/dashboard';
         *       auth.session.clearIntendedPath();
         *       router.navigate(dest);
         *   });
         */
        OnStart(fn) { _addHook('start', fn); return auth; },

        /**
         * Called after session.renew() — use to update api token.
         *
         *   auth.session.OnRenew((newToken) => api.setToken(newToken));
         */
        OnRenew(fn) { _addHook('renew', fn); return auth; },

        /**
         * Called when session expires — use to redirect and notify.
         *
         *   auth.session.OnExpiry(() => {
         *       notify.warn('Session expired');
         *       router.navigate('/login');
         *   });
         */
        OnExpiry(fn) { _addHook('expiry', fn); return auth; },

        /**
         * Called when token is about to expire (5 minutes before).
         * Use to show warning or trigger silent refresh.
         */
        OnRefresh(fn) { _addHook('refresh', fn); return auth; },

        /**
         * Manually trigger token refresh.
         * Returns true if refresh succeeded, false otherwise.
         */
        async refresh() {
            if (_refreshInProgress) {
                return new Promise(resolve => {
                    _refreshSubscribers.push(resolve);
                });
            }

            _refreshInProgress = true;

            try {
                const refreshToken = await _tokenStore.get('refresh_token');
                if (!refreshToken) {
                    throw new Error('No refresh token available');
                }

                emit('auth:refresh:start');

                const result = await this._executeRefresh(refreshToken);
                await this.renew(result.token, result.refreshToken || refreshToken);

                _refreshSubscribers.forEach(resolve => resolve(true));
                emit('auth:refresh:success', result);

                return true;
            } catch (error) {
                console.warn('[oja/auth] Token refresh failed:', error);
                _refreshSubscribers.forEach(resolve => resolve(false));
                emit('auth:refresh:failed', { error: error.message });

                if (error.fatal) {
                    await this.end();
                }

                return false;
            } finally {
                _refreshInProgress = false;
                _refreshSubscribers = [];
            }
        },

        async _executeRefresh(refreshToken) {
            const response = await fetch('/auth/refresh', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + refreshToken
                }
            });

            if (!response.ok) {
                const error = new Error(`Refresh failed: ${response.status}`);
                error.fatal = response.status === 401 || response.status === 403;
                throw error;
            }

            return response.json();
        },

        /**
         * Retrieve the raw refresh token string (async, decrypted).
         */
        async refreshToken() {
            return _tokenStore.get('refresh_token');
        },

        /**
         * How many milliseconds until the next automatic refresh attempt.
         */
        timeUntilRefresh() {
            const exp = _metaStore.get('exp');
            if (!exp) return Infinity;
            const refreshAt = exp - REFRESH_THRESHOLD;
            return Math.max(0, refreshAt - Date.now());
        }
    }
};

function _addHook(type, fn) {
    if (!_hooks.has(type)) return;
    _hooks.get(type).push(fn);
}

function _runHooks(type, ...args) {
    const hooks = _hooks.get(type);
    if (!hooks) return;

    for (const fn of hooks) {
        try { fn(...args); } catch (e) {
            console.warn(`[oja/auth] ${type} hook error:`, e);
        }
    }
}

function _setTimer(type, fn, delay) {
    _clearTimer(type);
    if (delay <= 0) {
        fn();
        return;
    }
    _timers.set(type, setTimeout(fn, delay));
}

function _clearTimer(type) {
    const timer = _timers.get(type);
    if (timer) {
        clearTimeout(timer);
        _timers.set(type, null);
    }
}

function _stopAllTimers() {
    for (const type of _timers.keys()) {
        _clearTimer(type);
    }
}

function _startExpiryWatch(expMs) {
    const now = Date.now();
    const msLeft = expMs - now;
    const warnBefore = 5 * 60 * 1000;

    if (msLeft <= 0) {
        _handleExpiry();
        return;
    }

    const warnAt = msLeft - warnBefore;
    if (warnAt > 0) {
        _setTimer('warning', () => {
            emit('auth:expiring', { ms: warnBefore, expiresAt: expMs });
        }, warnAt);
    }

    _setTimer('expiry', _handleExpiry, msLeft);
}

function _startRefreshWatch(expMs) {
    const now = Date.now();
    const refreshAt = expMs - REFRESH_THRESHOLD;
    const msUntilRefresh = refreshAt - now;

    if (msUntilRefresh <= 0) {
        _handleRefresh();
        return;
    }

    _setTimer('refresh', _handleRefresh, msUntilRefresh);
}

async function _handleExpiry() {
    await auth.session.end();
    emit('auth:expired');
    _runHooks('expiry');
}

async function _handleRefresh() {
    if (!auth.session.isActive()) return;

    emit('auth:expiring', {
        ms: REFRESH_THRESHOLD,
        expiresAt: _metaStore.get('exp')
    });

    const hooks = _hooks.get('refresh');
    for (const fn of hooks) {
        try {
            const shouldRefresh = await fn();
            if (shouldRefresh !== false) {
                await auth.session.refresh();
                break;
            }
        } catch (e) {
            console.warn('[oja/auth] refresh hook error:', e);
        }
    }
}

function _decodeJWT(token) {
    if (!token || typeof token !== 'string') return null;
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        const b64    = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=');

        const bytes   = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
        const payload = JSON.parse(new TextDecoder().decode(bytes));

        _metaStore.set('payload', payload);
        return payload;
    } catch {
        return null;
    }
}

listen('api:unauthorized', async () => {
    if (!auth.session.isActive()) return;

    const refreshed = await auth.session.refresh();
    if (!refreshed) {
        await auth.session.end();
        emit('auth:expired');
        _runHooks('expiry');
    }
});
