// src/js/core/runtime.js
/**
 * oja/runtime.js
 * Passive configuration store and hook registry.
 *
 * Never pulls — every other module pushes through it or reads from it.
 * No opinions about what your app does.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { runtime } from './runtime.js';
 *
 *   runtime
 *     .env('production')
 *     .define('apiBase', 'https://api.myapp.com/v1')
 *     .allowOrigins(['https://api.myapp.com'])
 *     .sandbox(false)
 *     .onFetch((url, opts) => ({ ...opts, headers: { ...opts.headers, 'X-App': '1' } }))
 *     .onError((err, source) => logger.capture(err, source))
 *     .ready(() => router.start());
 *
 * ─── Security ─────────────────────────────────────────────────────────────────
 *
 *   runtime.sandbox(true)          — out.js skips execScripts, worker.js skips importScripts
 *   runtime.isSandboxed()          — read current value
 *   runtime.allowOrigins([...])    — whitelist; empty = allow all (default)
 *   runtime.isOriginAllowed(url)   — used internally by out.js, worker.js
 *
 * ─── Hooks ────────────────────────────────────────────────────────────────────
 *
 *   All hook registration methods return an unsubscribe function.
 *
 *   runtime.onFetch(fn)      — fn(url, opts) → opts    — called before every fetch
 *   runtime.onError(fn)      — fn(err, source)          — called on unhandled errors
 *   runtime.onNavigate(fn)   — fn(nav)                  — called on route change
 *
 *   nav = {
 *     from:     '/users/7/posts',
 *     to:       '/users/42/posts',
 *     route:    '/users/:id/posts',   // matched pattern
 *     params:   { id: '42' },          // route params
 *     query:    { sort: 'date' },      // query string parsed
 *     redirect: (url) => {},           // cancel + go elsewhere
 *     cancel:   () => {},              // stop this navigation
 *   }
 *
 * ─── Definitions ──────────────────────────────────────────────────────────────
 *
 *   runtime.define(key, value)   — store a named value (any type, including functions)
 *   runtime.get(key, fallback?)  — read it back; returns fallback if not found
 *   runtime.env(name?)           — getter/setter for 'development'|'production'|'test'
 *
 * ─── Lifecycle ────────────────────────────────────────────────────────────────
 *
 *   runtime.ready(fn)               — run after DOMContentLoaded (or immediately if already fired)
 *   runtime.reportError(err, source) — fires all onError hooks + emits runtime:error
 *   runtime.destroy()               — clears all hooks and definitions; used in tests and teardown
 *
 * ─── Internal API (used by other oja modules) ─────────────────────────────────
 *
 *   runtime.runFetchHooks(url, opts)       — pipeline: each hook receives the previous's return value
 *   runtime.runNavigateHooks(nav)          — fires all onNavigate hooks; honours cancel/redirect
 */

const VALID_ENVS = new Set(['development', 'production', 'test']);

function _createRuntime() {

    // ── Internal state ──────────────────────────────────────────────────────

    let _env       = 'development';
    let _sandboxed = false;
    let _origins   = [];            // empty = allow all

    const _defs          = new Map();
    const _fetchHooks    = [];
    const _errorHooks    = [];
    const _navigateHooks = [];
    const _readyQueue    = [];
    let   _domReady      = false;

    // ── DOM ready bootstrap ─────────────────────────────────────────────────

    function _bootDOMReady() {
        _domReady = true;
        for (const fn of _readyQueue) {
            try { fn(); } catch (err) { _runtime.reportError(err, 'runtime:ready'); }
        }
        _readyQueue.length = 0;
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', _bootDOMReady, { once: true });
        } else {
            _domReady = true;
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    function _subscribe(list, fn) {
        if (typeof fn !== 'function') {
            throw new TypeError('[oja/runtime] hook must be a function');
        }
        list.push(fn);
        return function unsubscribe() {
            const idx = list.indexOf(fn);
            if (idx !== -1) list.splice(idx, 1);
        };
    }

    // ── Public API ──────────────────────────────────────────────────────────

    const _runtime = {

        // ─── Security ──────────────────────────────────────────────────────

        /**
         * Enable or disable sandbox mode.
         * When true: out.js skips execScripts, worker.js skips importScripts.
         * @param {boolean} bool
         * @returns {this}
         */
        sandbox(bool) {
            _sandboxed = !!bool;
            return this;
        },

        /** @returns {boolean} */
        isSandboxed() {
            return _sandboxed;
        },

        /**
         * Set the allowed origins whitelist for cross-origin fetch and importScripts.
         * Empty array (default) allows all origins — backwards-compatible.
         * @param {string[]} origins
         * @returns {this}
         */
        allowOrigins(origins) {
            if (!Array.isArray(origins)) {
                throw new TypeError('[oja/runtime] allowOrigins expects an array');
            }
            _origins = origins.map(o => o.toLowerCase().replace(/\/$/, ''));
            return this;
        },

        /**
         * Check whether a URL is permitted by the current origin whitelist.
         * Always returns true when the whitelist is empty.
         * @param {string} url
         * @returns {boolean}
         */
        isOriginAllowed(url) {
            if (_origins.length === 0) return true;
            // Relative URLs (no scheme) are same-origin — always allowed.
            // A URL is relative when it starts with /, ./, ../, or contains no '://'.
            if (!url.includes('://')) return true;
            try {
                const { origin } = new URL(url);
                return _origins.some(o => o === origin.toLowerCase());
            } catch {
                return true;
            }
        },

        // ─── Hooks ─────────────────────────────────────────────────────────

        /**
         * Register a fetch interceptor.
         * Hooks compose as a pipeline: each hook receives the previous hook's returned opts.
         * fn(url, opts) → opts  (must return the opts object, mutated or replaced)
         * @param {Function} fn
         * @returns {Function} unsubscribe
         */
        onFetch(fn) {
            return _subscribe(_fetchHooks, fn);
        },

        /**
         * Register an error handler.
         * fn(err, source) — source is a string identifying the calling module.
         * Hook errors are silently swallowed so one bad handler cannot break others.
         * @param {Function} fn
         * @returns {Function} unsubscribe
         */
        onError(fn) {
            return _subscribe(_errorHooks, fn);
        },

        /**
         * Register a navigation interceptor.
         * fn(nav) — nav contains from, to, route, params, query, redirect, cancel.
         * @param {Function} fn
         * @returns {Function} unsubscribe
         */
        onNavigate(fn) {
            return _subscribe(_navigateHooks, fn);
        },

        // ─── Definitions ───────────────────────────────────────────────────

        /**
         * Store a named value. Value can be anything, including a function.
         * @param {string} key
         * @param {*} value
         * @returns {this}
         */
        define(key, value) {
            _defs.set(key, value);
            return this;
        },

        /**
         * Read a stored value. Returns fallback (default: undefined) if not found.
         * @param {string}  key
         * @param {*}       [fallback]
         * @returns {*}
         */
        get(key, fallback = undefined) {
            return _defs.has(key) ? _defs.get(key) : fallback;
        },

        /**
         * Getter/setter for the current environment.
         * No arguments → getter. One argument → setter (returns this).
         * @param {'development'|'production'|'test'} [name]
         * @returns {string|this}
         */
        env(name) {
            if (name === undefined) return _env;
            if (!VALID_ENVS.has(name)) {
                throw new RangeError(`[oja/runtime] env must be one of: ${[...VALID_ENVS].join(', ')}`);
            }
            _env = name;
            return this;
        },

        // ─── Lifecycle ─────────────────────────────────────────────────────

        /**
         * Queue a function to run after DOMContentLoaded.
         * If the DOM is already ready, runs on the next microtask.
         * @param {Function} fn
         * @returns {this}
         */
        ready(fn) {
            if (typeof fn !== 'function') {
                throw new TypeError('[oja/runtime] ready() expects a function');
            }
            if (_domReady) {
                // Schedule on next microtask — consistent behaviour regardless
                // of whether the DOM fired before or after ready() was called.
                Promise.resolve().then(() => {
                    try { fn(); } catch (err) { this.reportError(err, 'runtime:ready'); }
                });
            } else {
                _readyQueue.push(fn);
            }
            return this;
        },

        /**
         * Fire all onError hooks and emit the runtime:error document event.
         * Hook errors are swallowed to prevent cascading failures.
         * @param {Error}  err
         * @param {string} source
         */
        reportError(err, source) {
            for (const fn of _errorHooks) {
                try { fn(err, source); } catch (_) { /* never let hook errors propagate */ }
            }
            if (typeof document !== 'undefined') {
                document.dispatchEvent(
                    new CustomEvent('runtime:error', { detail: { err, source } })
                );
            }
        },

        /**
         * Clear all hooks, definitions, and origin/sandbox settings.
         * Emits runtime:destroy. Used in tests and micro-frontend teardown.
         */
        destroy() {
            _fetchHooks.length    = 0;
            _errorHooks.length    = 0;
            _navigateHooks.length = 0;
            _readyQueue.length    = 0;
            _defs.clear();
            _origins   = [];
            _sandboxed = false;
            _env       = 'development';

            if (typeof document !== 'undefined') {
                document.dispatchEvent(new CustomEvent('runtime:destroy'));
            }
        },

        // ─── Internal — called by other oja modules, not user code ─────────

        /**
         * Run all registered fetch hooks as a pipeline.
         * Each hook receives (url, opts) and must return an opts object.
         * The output of hook N becomes the input of hook N+1.
         * Hook errors are caught and the previous opts are preserved.
         *
         * @param {string} url
         * @param {Object} opts  — initial fetch options
         * @returns {Object}     — transformed opts
         */
        runFetchHooks(url, opts) {
            let current = opts;
            for (const fn of _fetchHooks) {
                try {
                    const next = fn(url, current);
                    // Only accept the return value if it's a plain object.
                    // Guards against a hook that forgets to return or returns a primitive.
                    if (next !== null && typeof next === 'object') {
                        current = next;
                    }
                } catch (err) {
                    this.reportError(err, 'runtime:fetch-hook');
                }
            }
            return current;
        },

        /**
         * Run all registered navigate hooks.
         * Provides cancel() and redirect() on the nav context so hooks can
         * act as navigation guards.
         *
         * Returns { cancelled, redirectTo } so router.js can act on them.
         *
         * @param {{ from, to, route, params, query }} navBase
         * @returns {{ cancelled: boolean, redirectTo: string|null }}
         */
        runNavigateHooks(navBase) {
            let cancelled   = false;
            let redirectTo  = null;

            const nav = {
                ...navBase,
                cancel()       { cancelled  = true;  },
                redirect(url)  { redirectTo = url; cancelled = true; },
            };

            for (const fn of _navigateHooks) {
                try {
                    fn(nav);
                } catch (err) {
                    this.reportError(err, 'runtime:navigate-hook');
                }
                // Stop firing remaining hooks once navigation is cancelled.
                if (cancelled) break;
            }

            return { cancelled, redirectTo };
        },
    };

    return _runtime;
}

/**
 * Singleton runtime instance.
 * Import and configure once at app startup; all modules share this instance.
 */
export const runtime = _createRuntime();
