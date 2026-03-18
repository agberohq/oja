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

import { Store }       from './store.js';
import { emit, listen } from './events.js';

// ─── Token storage ────────────────────────────────────────────────────────────
// Cascade: sessionStorage (encrypted) → localStorage (encrypted) → memory
// Token is encrypted at rest. Metadata (exp, payload) is stored unencrypted
// in a separate store so synchronous reads (isActive, user) work without
// needing to decrypt.

const _tokenStore = new Store('oja:auth',      { encrypt: true, prefer: 'session' });
const _metaStore  = new Store('oja:auth:meta');  // non-sensitive: exp, payload, intendedPath

// ─── Level registry ───────────────────────────────────────────────────────────

const _levels = new Map(); // name → () => bool

// ─── Session state ────────────────────────────────────────────────────────────

let _expiryTimer   = null;
let _warningTimer  = null;
let _onStartHooks  = [];
let _onRenewHooks  = [];
let _onExpiryHooks = [];

// ─── Public API ───────────────────────────────────────────────────────────────

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
    middleware(levelName, redirectTo = '/login') {
        return async (ctx, next) => {
            const check = _levels.get(levelName);
            if (!check) {
                console.warn(`[oja/auth] unknown level: "${levelName}"`);
                await next();
                return;
            }

            if (!check()) {
                // Save where the user was trying to go
                _metaStore.set('intendedPath',   ctx.path);
                _metaStore.set('intendedParams', ctx.params);
                ctx.redirect(redirectTo);
                return; // do not call next()
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

    // ─── Session ──────────────────────────────────────────────────────────────

    session: {

        /**
         * Start a session with a JWT or opaque token.
         * Stores token encrypted, sets up expiry watch.
         * Fires OnStart hooks after setup.
         *
         *   await auth.session.start(jwt);
         */
        async start(token) {
            await _tokenStore.setAsync('token', token);
            _metaStore.set('startedAt', Date.now());

            const payload = _decodeJWT(token);
            if (payload?.exp) {
                _metaStore.set('exp', payload.exp * 1000);
                _startExpiryWatch(payload.exp * 1000);
            }

            emit('auth:start', { token });
            for (const fn of _onStartHooks) {
                try { await fn(token); } catch (e) {
                    console.warn('[oja/auth] OnStart hook error:', e);
                }
            }
        },

        /**
         * End the session — clear token, stop timers, fire hooks.
         */
        async end() {
            _stopExpiryWatch();
            await _tokenStore.clear('token');
            _metaStore.clear('exp');
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
        async renew(newToken) {
            _stopExpiryWatch();
            await _tokenStore.setAsync('token', newToken);

            const payload = _decodeJWT(newToken);
            if (payload?.exp) {
                _metaStore.set('exp', payload.exp * 1000);
                _startExpiryWatch(payload.exp * 1000);
            }

            emit('auth:renew', { token: newToken });
            for (const fn of _onRenewHooks) {
                try { await fn(newToken); } catch (e) {
                    console.warn('[oja/auth] OnRenew hook error:', e);
                }
            }
        },

        /**
         * Is a session currently active?
         * Checks that a session was started (exp exists in meta) and has not expired.
         */
        isActive() {
            const exp = _metaStore.get('exp');
            if (!exp) return false;                   // no session started
            if (Date.now() >= exp) return false;      // expired
            return true;
        },

        /**
         * Retrieve the raw token string (async, decrypted).
         */
        async token() {
            return _tokenStore.getAsync('token');
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

        // ── Lifecycle hooks ────────────────────────────────────────────────────
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
        OnStart(fn) { _onStartHooks.push(fn); return auth; },

        /**
         * Called after session.renew() — use to update api token.
         *
         *   auth.session.OnRenew((newToken) => api.setToken(newToken));
         */
        OnRenew(fn) { _onRenewHooks.push(fn); return auth; },


        /**
         * Called when session expires — use to redirect and notify.
         *
         *   auth.session.OnExpiry(() => {
         *       notify.warn('Session expired');
         *       router.navigate('/login');
         *   });
         */
        OnExpiry(fn) { _onExpiryHooks.push(fn); return auth; }
    }
};

// ─── Expiry watch ─────────────────────────────────────────────────────────────

function _startExpiryWatch(expMs) {
    _stopExpiryWatch();

    const now        = Date.now();
    const msLeft     = expMs - now;
    const warnBefore = 5 * 60 * 1000; // warn 5 minutes before expiry

    if (msLeft <= 0) {
        _handleExpiry();
        return;
    }

    const warnAt = msLeft - warnBefore;
    if (warnAt > 0) {
        _warningTimer = setTimeout(() => {
            emit('auth:expiring', { ms: warnBefore, expiresAt: expMs });
        }, warnAt);
    }

    _expiryTimer = setTimeout(_handleExpiry, msLeft);
}

function _stopExpiryWatch() {
    clearTimeout(_expiryTimer);
    clearTimeout(_warningTimer);
    _expiryTimer  = null;
    _warningTimer = null;
}

async function _handleExpiry() {
    await auth.session.end();
    emit('auth:expired');
    for (const fn of _onExpiryHooks) {
        try { await fn(); } catch (e) {
            console.warn('[oja/auth] OnExpiry hook error:', e);
        }
    }
}

// ─── JWT decode ───────────────────────────────────────────────────────────────

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

// ─── Listen for api:unauthorized ─────────────────────────────────────────────

listen('api:unauthorized', async () => {
    if (auth.session.isActive()) {
        await auth.session.end();
        emit('auth:expired');
        for (const fn of _onExpiryHooks) {
            try { await fn(); } catch {}
        }
    }
});