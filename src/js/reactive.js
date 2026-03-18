/**
 * oja/reactive.js
 * Fine-grained reactivity. Inspired by Svelte's reactive statements.
 * No virtual DOM — effects update real DOM directly and surgically.
 *
 * ─── Local state ──────────────────────────────────────────────────────────────
 *
 *   import { state, effect, derived, batch } from '../oja/reactive.js';
 *
 *   const [count, setCount] = state(0);
 *
 *   effect(() => {
 *       document.getElementById('count').textContent = count();
 *   });
 *
 *   setCount(1);        // effect re-runs automatically
 *   setCount(n => n+1); // functional update
 *
 *   const double = derived(() => count() * 2);
 *
 *   batch(() => {
 *       setCount(10);
 *       setName('Ade');
 *   });
 *
 * ─── Global named context ─────────────────────────────────────────────────────
 *
 *   `context` is a singleton reactive store. Any module anywhere can read or
 *   write the same named value and effects will update automatically.
 *   Use for cross-component state: online/offline, auth status, theme, etc.
 *
 *   import { context } from '../oja/reactive.js';
 *
 *   // Define once (e.g. in app.js) — subsequent calls return the same pair
 *   const [isOnline, setOnline] = context('online', true);
 *
 *   // Read anywhere — always the same reactive value
 *   const [isOnline] = context('online');
 *   effect(() => {
 *       container.querySelector('.status').textContent = isOnline() ? '●' : '○';
 *   });
 *
 *   // Write from anywhere — all effects that read it re-run
 *   api.onOffline(() => setOnline(false));
 *   api.onOnline(()  => setOnline(true));
 *
 *   // Typical global contexts for an admin dashboard:
 *   const [isOnline,   setOnline]   = context('online',   true);
 *   const [authUser,   setAuthUser] = context('authUser', null);
 *   const [theme,      setTheme]    = context('theme',    'dark');
 *   const [connQuality,setQuality]  = context('connQuality', 'unknown');
 *
 * ─── Circular dependency protection ──────────────────────────────────────────
 *
 *   If an effect writes to a state it reads from, Oja detects the cycle
 *   and stops after 50 iterations rather than hanging the browser.
 */

class ReactiveSystem {
    constructor() {
        this._currentEffect = null;
        this._effectQueue   = new Set();
        this._scheduled     = false;
        this._dirtyFlags    = new Map();
        this._dependencies  = new WeakMap(); // effect -> Set of unsubscribe functions
        this._batchDepth    = 0;
        this._flushDepth    = 0;
    }

    // ─── state() ──────────────────────────────────────────────────────────────

    state(initialValue) {
        const subscribers = new Set();
        let value = initialValue;

        const read = () => {
            if (this._currentEffect) {
                subscribers.add(this._currentEffect);

                // Track the dependency for cleanup
                if (!this._dependencies.has(this._currentEffect)) {
                    this._dependencies.set(this._currentEffect, new Set());
                }
                this._dependencies.get(this._currentEffect).add(() => subscribers.delete(this._currentEffect));
            }
            return value;
        };

        const write = (newValue) => {
            if (typeof newValue === 'function') {
                newValue = newValue(value);
            }
            if (value === newValue) return;
            value = newValue;

            for (const effect of subscribers) {
                this._dirtyFlags.set(effect, true);
            }
            this._scheduleEffects([...subscribers]);
        };

        return [read, write];
    }

    // ─── derived() ────────────────────────────────────────────────────────────

    derived(fn) {
        const [read, write] = this.state(undefined);
        this.effect(() => write(fn()));
        return read;
    }

    // ─── effect() ─────────────────────────────────────────────────────────────

    effect(fn) {
        const run = () => {
            // Cleanup previous subscriptions before re-running
            const previousDeps = this._dependencies.get(run);
            if (previousDeps) {
                previousDeps.forEach(unsub => unsub());
                previousDeps.clear();
            }

            this._currentEffect = run;
            try {
                fn();
            } finally {
                this._currentEffect = null;
                this._dirtyFlags.delete(run);
            }
        };

        run();

        return () => {
            const deps = this._dependencies.get(run);
            if (deps) deps.forEach(unsub => unsub());
            this._dependencies.delete(run);
            this._dirtyFlags.delete(run);
        };
    }

    // ─── batch() ──────────────────────────────────────────────────────────────

    batch(fn) {
        this._batchDepth++;
        try {
            fn();
        } finally {
            this._batchDepth--;
            if (this._batchDepth === 0) this._flush();
        }
    }

    // ─── Internals ────────────────────────────────────────────────────────────

    _scheduleEffects(effects) {
        for (const effect of effects) {
            this._effectQueue.add(effect);
        }
        if (!this._batchDepth && !this._scheduled) {
            this._scheduled = true;
            queueMicrotask(() => this._flush());
        }
    }

    _flush() {
        if (this._flushDepth >= 50) {
            console.error(
                '[oja/reactive] Maximum update depth (50) exceeded. ' +
                'Likely a circular dependency: an effect writes to a state it reads. ' +
                'Effects stopped.'
            );
            this._flushDepth = 0;
            this._effectQueue.clear();
            this._scheduled = false;
            return;
        }

        this._flushDepth++;
        const queue = [...this._effectQueue];
        this._effectQueue.clear();
        this._scheduled = false;

        for (const effect of queue) {
            if (this._dirtyFlags.has(effect)) effect();
        }

        this._flushDepth--;
    }
}

// ─── Shared instance ──────────────────────────────────────────────────────────

const _sys = new ReactiveSystem();

export const state   = (v)  => _sys.state(v);
export const derived = (fn) => _sys.derived(fn);
export const effect  = (fn) => _sys.effect(fn);
export const batch   = (fn) => _sys.batch(fn);

// ─── Global named context ─────────────────────────────────────────────────────
//
// Singleton store of named reactive values. Any module that calls
// context('online') gets the SAME [read, write] pair — no prop drilling,
// no manual event dispatch, no global variable conventions.

const _ctx = new Map(); // name → [read, write]

/**
 * Get or create a named reactive value shared across the entire application.
 *
 * First call with a name creates the value with the given initial value.
 * All subsequent calls with the same name return the same [read, write] pair.
 *
 * @param {string} name          — unique name for this context value
 * @param {any}    [initialValue] — initial value (only used on first call)
 * @returns {[Function, Function]} [read, write] — same as state()
 *
 *   // app.js — define once
 *   const [isOnline, setOnline] = context('online', true);
 *
 *   // any-component.html script — read from anywhere
 *   const [isOnline] = context('online');
 *   effect(() => {
 *       container.querySelector('.status').textContent = isOnline() ? 'Live' : 'Offline';
 *   });
 *
 *   // api.js integration
 *   api.onOffline(() => setOnline(false));
 *   api.onOnline(()  => setOnline(true));
 */
export function context(name, initialValue) {
    if (!_ctx.has(name)) {
        _ctx.set(name, _sys.state(initialValue));
    }
    return _ctx.get(name);
}

/**
 * Check if a named context has been created.
 *
 *   if (context.has('online')) { ... }
 */
context.has = (name) => _ctx.has(name);

/**
 * Get the current value of a named context synchronously (no subscription).
 * Useful when you just need a value once, not reactive.
 *
 *   const online = context.get('online'); // → true/false
 */
context.get = (name) => {
    if (!_ctx.has(name)) return undefined;
    const [read] = _ctx.get(name);
    return read();
};

/**
 * List all registered context names — useful for debugging.
 *
 *   context.keys(); // → ['online', 'authUser', 'theme']
 */
context.keys = () => [..._ctx.keys()];