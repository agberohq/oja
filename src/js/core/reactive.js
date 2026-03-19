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
 *   // Persistent context — survives page reloads
 *   const [theme, setTheme] = context.persist('theme', 'dark', {
 *       store: 'local',  // 'local' or 'session'
 *       key: 'app-theme' // custom storage key (optional)
 *   });
 *
 *   // Typical global contexts for an admin dashboard:
 *   const [isOnline,   setOnline]   = context('online',   true);
 *   const [authUser,   setAuthUser] = context('authUser', null);
 *   const [theme,      setTheme]    = context.persist('theme', 'dark');
 *   const [connQuality,setQuality]  = context('connQuality', 'unknown');
 *
 * ─── Circular dependency protection ──────────────────────────────────────────
 *
 *   If an effect writes to a state it reads from, Oja detects the cycle
 *   and stops after 50 iterations rather than hanging the browser.
 */

// ─── Storage adapter for persistence ──────────────────────────────────────────

const _storage = {
    local: typeof localStorage !== 'undefined' ? localStorage : null,
    session: typeof sessionStorage !== 'undefined' ? sessionStorage : null,
    memory: new Map()
};

function _getStorage(type = 'memory') {
    switch (type) {
        case 'local': return _storage.local;
        case 'session': return _storage.session;
        default: return _storage.memory;
    }
}

function _isStorageAvailable(storage) {
    if (!storage) return false;
    try {
        storage.setItem('__oja_test__', '1');
        storage.removeItem('__oja_test__');
        return true;
    } catch {
        return false;
    }
}

// ─── DevTools integration ─────────────────────────────────────────────────────

const DEVTOOLS_KEY = '__OJA_DEVTOOLS__';
let _devTools = null;
let _devToolsEnabled = false;

// ─── Reactive System ──────────────────────────────────────────────────────────

class ReactiveSystem {
    constructor() {
        this._currentEffect = null;
        this._effectQueue = new Set();
        this._scheduled = false;
        this._dirtyFlags = new Map();
        this._dependencies = new WeakMap();
        this._batchDepth = 0;
        this._flushDepth = 0;

        // DevTools tracking
        this._states = new Map();
        this._effects = new Map();
        this._derived = new Map();
        this._nextId = 0;
        this._actionStack = [];

        // Persistence tracking
        this._persistentStates = new Map(); // id -> { key, storage, defaultValue }
    }

    // ─── Persistence ─────────────────────────────────────────────────────────

    _loadPersistent(key, storage, defaultValue) {
        const storageImpl = _getStorage(storage);
        if (!storageImpl || !_isStorageAvailable(storageImpl)) return defaultValue;

        try {
            const saved = storageImpl.getItem(key);
            if (saved === null) return defaultValue;
            return JSON.parse(saved);
        } catch {
            return defaultValue;
        }
    }

    _savePersistent(key, storage, value) {
        const storageImpl = _getStorage(storage);
        if (!storageImpl || !_isStorageAvailable(storageImpl)) return;

        try {
            storageImpl.setItem(key, JSON.stringify(value));
            this._sendDevToolsUpdate('persistence:saved', { key, storage });
        } catch (e) {
            console.warn(`[oja/reactive] Failed to persist to ${storage}:`, e);
        }
    }

    _removePersistent(key, storage) {
        const storageImpl = _getStorage(storage);
        if (!storageImpl || !_isStorageAvailable(storageImpl)) return;

        try {
            storageImpl.removeItem(key);
        } catch (e) {
            console.warn(`[oja/reactive] Failed to remove from ${storage}:`, e);
        }
    }

    // ─── DevTools ─────────────────────────────────────────────────────────────

    _connectDevTools() {
        if (typeof window === 'undefined') return;

        const devTools = window.__REDUX_DEVTOOLS_EXTENSION__?.connect({
            name: 'Oja Reactive State',
            features: {
                pause: true,
                lock: true,
                persist: true,
                export: true,
                import: true,
                jump: true,
                skip: true,
                reorder: true,
                dispatch: true,
                test: true
            }
        });

        if (devTools) {
            _devTools = devTools;
            _devToolsEnabled = true;

            devTools.init(this._getSnapshot());
            devTools.subscribe((message) => this._handleDevToolsMessage(message));

            console.info('[oja/reactive] Connected to Redux DevTools');
        }
    }

    _getSnapshot() {
        const snapshot = {};
        for (const [id, { name, value }] of this._states) {
            snapshot[name || id] = value;
        }
        return snapshot;
    }

    _handleDevToolsMessage(message) {
        switch (message.type) {
            case 'DISPATCH':
                switch (message.payload.type) {
                    case 'JUMP_TO_STATE':
                    case 'JUMP_TO_ACTION':
                        this._jumpToState(JSON.parse(message.state));
                        break;
                    case 'RESET':
                        this._reset();
                        break;
                }
                break;
            case 'ACTION':
                if (message.payload) {
                    this._dispatchAction(message.payload);
                }
                break;
        }
    }

    _jumpToState(targetState) {
        for (const [id, state] of this._states) {
            if (targetState[state.name || id] !== undefined) {
                this._setValue(id, targetState[state.name || id], true);
            }
        }
    }

    _reset() {
        for (const [id, state] of this._states) {
            const persistent = this._persistentStates.get(id);
            if (persistent) {
                this._setValue(id, persistent.defaultValue, true);
                this._savePersistent(persistent.key, persistent.storage, persistent.defaultValue);
            } else {
                this._setValue(id, state.initialValue, true);
            }
        }
    }

    _dispatchAction(action) {
        this._actionStack.push(action);
        if (this._actionStack.length > 50) {
            this._actionStack.shift();
        }

        if (_devTools) {
            _devTools.send(action, this._getSnapshot());
        }
    }

    _trackState(id, name, value, initialValue, persistent = null) {
        this._states.set(id, { name, value, initialValue });
        if (persistent) {
            this._persistentStates.set(id, persistent);
        }
        this._sendDevToolsUpdate('state:created', { id, name, value, persistent: !!persistent });
    }

    _trackEffect(id, fn) {
        this._effects.set(id, fn);
        this._sendDevToolsUpdate('effect:created', { id });
    }

    _trackDerived(id, fn, value) {
        this._derived.set(id, { fn, value });
        this._sendDevToolsUpdate('derived:created', { id, value });
    }

    _sendDevToolsUpdate(type, data) {
        if (!_devToolsEnabled || !_devTools) return;

        _devTools.send({
            type,
            ...data,
            timestamp: Date.now()
        }, this._getSnapshot());
    }

    // ─── Core reactivity ─────────────────────────────────────────────────────

    state(initialValue, name) {
        return this._createState(initialValue, name);
    }

    persistentState(initialValue, name, options = {}) {
        const { store = 'local', key = `oja:${name}` } = options;
        const savedValue = this._loadPersistent(key, store, initialValue);

        const [read, write] = this._createState(savedValue, name, {
            key,
            storage: store,
            defaultValue: initialValue
        });

        return [read, write];
    }

    _createState(initialValue, name, persistent = null) {
        const id = `state_${this._nextId++}`;

        const subscribers = new Set();
        let value = initialValue;

        const read = () => {
            if (this._currentEffect) {
                subscribers.add(this._currentEffect);

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
            // Skip the equality check for objects — reference equality can't
            // detect in-place mutation. If a developer does:
            //   const u = user(); u.name = 'Bisi'; setUser(u);
            // the reference is identical but the value has changed. We must
            // always propagate for objects to guarantee UI consistency.
            const isObject = newValue !== null && typeof newValue === 'object';
            if (!isObject && value === newValue) return;

            const oldValue = value;
            value = newValue;

            // Persist if configured
            if (persistent) {
                this._savePersistent(persistent.key, persistent.storage, value);
            }

            this._trackState(id, name, value, initialValue, persistent);
            this._sendDevToolsUpdate('state:changed', {
                id,
                name,
                oldValue,
                newValue: value,
                effects: subscribers.size,
                persistent: !!persistent
            });

            for (const effect of subscribers) {
                this._dirtyFlags.set(effect, true);
            }
            this._scheduleEffects([...subscribers]);
        };

        this._trackState(id, name, value, initialValue, persistent);
        return [read, write];
    }

    _setValue(id, newValue, skipBatch = false) {
        const state = this._states.get(id);
        if (!state) return;

        const oldValue = state.value;
        state.value = newValue;

        // Update persistence if configured
        const persistent = this._persistentStates.get(id);
        if (persistent) {
            this._savePersistent(persistent.key, persistent.storage, newValue);
        }

        if (!skipBatch) {
            this._sendDevToolsUpdate('state:changed', { id, oldValue, newValue });
        }
    }

    derived(fn) {
        const id = `derived_${this._nextId++}`;
        const [read, write] = this.state(undefined);
        this.effect(() => {
            let value;
            try {
                value = fn();
            } catch (e) {
                // Leave the derived value unchanged rather than silently
                // setting it to undefined. Emit an event so devtools / loggers
                // can surface the problem without crashing the effect queue.
                console.warn('[oja/reactive] derived() threw — value unchanged:', e);
                this._sendDevToolsUpdate('error:derived', { id, error: e.message });
                return;
            }
            write(value);
            this._trackDerived(id, fn, value);
        });
        return read;
    }

    effect(fn) {
        const id = `effect_${this._nextId++}`;

        const run = () => {
            const previousDeps = this._dependencies.get(run);
            if (previousDeps) {
                previousDeps.forEach(unsub => unsub());
                previousDeps.clear();
            }

            this._currentEffect = run;
            try {
                const result = fn();
                this._sendDevToolsUpdate('effect:ran', {
                    id,
                    dependencies: this._dependencies.get(run)?.size || 0
                });
                return result;
            } finally {
                this._currentEffect = null;
                this._dirtyFlags.delete(run);
            }
        };

        this._trackEffect(id, run);
        run();

        return () => {
            const deps = this._dependencies.get(run);
            if (deps) deps.forEach(unsub => unsub());
            this._dependencies.delete(run);
            this._dirtyFlags.delete(run);
            this._effects.delete(id);
            this._sendDevToolsUpdate('effect:disposed', { id });
        };
    }

    batch(fn) {
        this._batchDepth++;
        this._sendDevToolsUpdate('batch:start', { depth: this._batchDepth });

        try {
            fn();
        } finally {
            this._batchDepth--;
            this._sendDevToolsUpdate('batch:end', { depth: this._batchDepth });

            if (this._batchDepth === 0) this._flush();
        }
    }

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
            const error = '[oja/reactive] Maximum update depth (50) exceeded. Likely a circular dependency.';
            console.error(error);
            this._sendDevToolsUpdate('error:max-depth', { depth: this._flushDepth });

            this._flushDepth = 0;
            this._effectQueue.clear();
            this._scheduled = false;
            return;
        }

        this._flushDepth++;
        const queue = [...this._effectQueue];
        this._effectQueue.clear();
        this._scheduled = false;

        this._sendDevToolsUpdate('flush:start', { count: queue.length, depth: this._flushDepth });

        for (const effect of queue) {
            if (this._dirtyFlags.has(effect)) {
                effect();
            }
        }

        this._sendDevToolsUpdate('flush:end', { depth: this._flushDepth });
        this._flushDepth--;
    }

    // ─── DevTools inspection ─────────────────────────────────────────────────

    inspect() {
        return {
            states: Array.from(this._states.entries()).map(([id, data]) => ({
                id,
                name: data.name,
                value: data.value,
                initialValue: data.initialValue,
                persistent: this._persistentStates.has(id)
            })),
            effects: Array.from(this._effects.keys()).map(id => ({
                id,
                active: this._dependencies.has(this._effects.get(id))
            })),
            derived: Array.from(this._derived.entries()).map(([id, data]) => ({
                id,
                value: data.value
            })),
            queueSize: this._effectQueue.size,
            batchDepth: this._batchDepth,
            flushDepth: this._flushDepth
        };
    }
}

// ─── Shared instance ──────────────────────────────────────────────────────────

const _sys = new ReactiveSystem();

// Auto-connect DevTools in development
if (typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname.endsWith('.local'))) {

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => _sys._connectDevTools());
    } else {
        _sys._connectDevTools();
    }
}

export const state   = (v, name) => _sys.state(v, name);
export const derived = (fn) => _sys.derived(fn);
export const effect  = (fn) => _sys.effect(fn);
export const batch   = (fn) => _sys.batch(fn);

// ─── Global named context ─────────────────────────────────────────────────────

const _ctx = new Map();

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
        const [read, write] = _sys.state(initialValue, name);
        _ctx.set(name, [read, write]);
    }
    return _ctx.get(name);
}

/**
 * Create a persistent context value that survives page reloads.
 *
 * @param {string} name          — unique name for this context value
 * @param {any}    initialValue  — default value (used if no saved value exists)
 * @param {Object} options
 *   store : 'local' | 'session' | 'memory' — storage type (default: 'local')
 *   key   : string                          — custom storage key (default: `oja:${name}`)
 * @returns {[Function, Function]} [read, write]
 *
 *   // User preference — survives reload
 *   const [theme, setTheme] = context.persist('theme', 'dark');
 *
 *   // Session-only — cleared when tab closes
 *   const [tabState, setTabState] = context.persist('tabState', {}, { store: 'session' });
 */
context.persist = (name, initialValue, options = {}) => {
    if (!_ctx.has(name)) {
        const [read, write] = _sys.persistentState(initialValue, name, options);
        _ctx.set(name, [read, write]);
    }
    return _ctx.get(name);
};

/**
 * Check if a named context has been created.
 *
 *   if (context.has('online')) { ... }
 */
context.has = (name) => _ctx.has(name);

/**
 * Delete a named context entry from the registry.
 * The underlying reactive state is NOT destroyed — any existing [read, write]
 * references held by components will continue to work. This only removes the
 * name-to-pair mapping so the name can be reused or garbage collected.
 *
 * Use in long-lived SPAs that create many short-lived dynamic contexts to
 * prevent the _ctx Map from growing without bound.
 *
 *   // When a feature module unmounts:
 *   context.delete('featureX:filter');
 */
context.delete = (name) => _ctx.delete(name);

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

/**
 * Clear a persisted context value from storage.
 *
 *   context.clear('theme'); // Removes from localStorage
 */
context.clear = (name) => {
    if (!_ctx.has(name)) return;

    const [read, write] = _ctx.get(name);
    const current = read();
    write(undefined);

    // Find and remove from persistent storage
    for (const [id, data] of _sys._persistentStates) {
        const state = _sys._states.get(id);
        if (state && state.name === name) {
            _sys._removePersistent(data.key, data.storage);
            break;
        }
    }
};

/**
 * DevTools integration for context inspection.
 *
 *   // In browser console:
 *   context.inspect()  // → { online: true, authUser: {...}, theme: 'dark' }
 */
context.inspect = () => {
    const snapshot = {};
    for (const [name, [read]] of _ctx) {
        snapshot[name] = read();
    }
    return snapshot;
};

// ─── DevTools global export ───────────────────────────────────────────────────

if (typeof window !== 'undefined') {
    window.__OJA_REACTIVE__ = {
        inspect: () => _sys.inspect(),
        context: context.inspect,
        state: state,
        effect: effect,
        batch: batch
    };
}