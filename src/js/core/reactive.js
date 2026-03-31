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
 *   const[isOnline, setOnline] = context('online', true);
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
 *   // onQuotaExceeded — called when localStorage is full (default: silent warn + event)
 *   const [notes, setNotes] = context.persist('notes', {}, {
 *       onQuotaExceeded: (key, value, err) => {
 *           notify.warn('Storage full — export your data to free space');
 *           emit('storage:quota-exceeded', { key });
 *       }
 *   });
 *   // Also available as a global window event for centralised handling:
 *   window.addEventListener('oja:quota-exceeded', ({ detail }) => {
 *       console.warn('Quota hit for key:', detail.key);
 *   });
 *
 *   // Require — throws clearly if the key was never registered.
 *   // Use in components to catch key typos or incorrect load order.
 *   const [activeFile, setActiveFile] = context.require('active_file');
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

const _storage = {
    memory: new Map()
};

function _getStorage(type = 'memory') {
    switch (type) {
        case 'local':
            return typeof localStorage !== 'undefined' ? localStorage : null;
        case 'session':
            return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
        default:
            return _storage.memory;
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

const DEVTOOLS_KEY = '__OJA_DEVTOOLS__';
let _devTools = null;
let _devToolsEnabled = false;
const MAX_FLUSH_DEPTH = 50;

class ReactiveSystem {
    constructor() {
        this._currentEffect = null;
        this._effectQueue = new Set();
        this._scheduled = false;
        this._dirtyFlags = new Map();
        this._dependencies = new WeakMap();
        this._batchDepth = 0;
        this._flushDepth = 0;

        this._states = new Map();
        this._effects = new Map();
        this._derived = new Map();
        this._nextId = 0;
        this._actionStack = [];

        this._persistentStates = new Map();
    }

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

    _savePersistent(key, storage, value, onQuotaExceeded = null) {
        const storageImpl = _getStorage(storage);
        if (!storageImpl) return;
        // Note: we do NOT call _isStorageAvailable here — that guard would itself
        // call setItem and swallow QuotaExceededError before we can handle it.
        // Storage availability is verified once during _loadPersistent at init time.
        // After that, the only expected failure mode is quota exhaustion, which we
        // now handle explicitly and surface via the onQuotaExceeded callback and
        // the oja:quota-exceeded window event.

        try {
            storageImpl.setItem(key, JSON.stringify(value));
            this._sendDevToolsUpdate('persistence:saved', {key, storage});
        } catch (e) {
            const isQuota = e.name === 'QuotaExceededError' ||
                e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
                e.code === 22;
            if (isQuota) {
                console.warn(`[oja/reactive] Storage quota exceeded for key "${key}"`, e);
                if (typeof onQuotaExceeded === 'function') {
                    try { onQuotaExceeded(key, value, e); } catch (_) {}
                }
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('oja:quota-exceeded', {
                        detail: { key, storage, value, error: e },
                        bubbles: false,
                    }));
                }
            } else {
                console.warn(`[oja/reactive] Failed to persist to ${storage}:`, e);
            }
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
        for (const [id, {name, value}] of this._states) {
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
        if (this._actionStack.length > MAX_FLUSH_DEPTH) {
            this._actionStack.shift();
        }

        if (_devTools) {
            _devTools.send(action, this._getSnapshot());
        }
    }

    _trackState(id, name, value, initialValue, persistent = null) {
        this._states.set(id, {name, value, initialValue});
        if (persistent) {
            this._persistentStates.set(id, persistent);
        }
        this._sendDevToolsUpdate('state:created', {id, name, value, persistent: !!persistent});
    }

    _trackEffect(id, fn) {
        this._effects.set(id, fn);
        this._sendDevToolsUpdate('effect:created', {id});
    }

    _trackDerived(id, fn, value) {
        this._derived.set(id, {fn, value});
        this._sendDevToolsUpdate('derived:created', {id, value});
    }

    _sendDevToolsUpdate(type, data) {
        if (!_devToolsEnabled || !_devTools) return;

        _devTools.send({
            type,
            ...data,
            timestamp: Date.now()
        }, this._getSnapshot());
    }

    state(initialValue, name) {
        return this._createState(initialValue, name);
    }

    persistentState(initialValue, name, options = {}) {
        const {
            store            = 'local',
            key              = `oja:${name}`,
            onQuotaExceeded  = null,
        } = options;
        const savedValue = this._loadPersistent(key, store, initialValue);

        const [read, write] = this._createState(savedValue, name, {
            key,
            storage: store,
            defaultValue: initialValue,
            onQuotaExceeded,
        });

        // Guard per storage key so only one listener is registered
        // per key regardless of how many times persistentState() is called with it.
        if (store === 'local' && typeof window !== 'undefined') {
            const flagKey = `__oja_storage_wired_${key}`;
            if (!window[flagKey]) {
                window[flagKey] = true;
                window.addEventListener('storage', (e) => {
                    if (e.key === key && e.newValue !== null) {
                        try { write(JSON.parse(e.newValue)); } catch { /* ignore */ }
                    }
                });
            }
        }

        return [read, write];
    }

    _createState(initialValue, name, persistent = null) {
        const id = `state_${this._nextId++}`;

        const subscribers = new Set();
        let value = initialValue;

        const read = () => {
            if (this._currentEffect) {
                const effectRef = this._currentEffect;
                subscribers.add(effectRef);
                if (!this._dependencies.has(effectRef)) {
                    this._dependencies.set(effectRef, new Set());
                }
                this._dependencies.get(effectRef).add(
                    () => subscribers.delete(effectRef)
                );
            }
            return value;
        };

        const write = (newValue) => {
            if (typeof newValue === 'function') {
                newValue = newValue(value);
            }
            const isObject = newValue !== null && typeof newValue === 'object';
            if (!isObject && value === newValue) return;

            const oldValue = value;
            value = newValue;

            if (persistent) {
                this._savePersistent(persistent.key, persistent.storage, value, persistent.onQuotaExceeded ?? null);
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

        read.__isOjaSignal = true;

        this._trackState(id, name, value, initialValue, persistent);
        return [read, write];
    }

    _setValue(id, newValue, skipBatch = false) {
        const state = this._states.get(id);
        if (!state) return;

        const oldValue = state.value;
        state.value = newValue;

        const persistent = this._persistentStates.get(id);
        if (persistent) {
            this._savePersistent(persistent.key, persistent.storage, newValue, persistent.onQuotaExceeded ?? null);
        }

        if (!skipBatch) {
            this._sendDevToolsUpdate('state:changed', {id, oldValue, newValue});
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
                console.warn('[oja/reactive] derived() threw — value unchanged:', e);
                this._sendDevToolsUpdate('error:derived', {id, error: e.message});
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
            this._sendDevToolsUpdate('effect:disposed', {id});
        };
    }

    batch(fn) {
        this._batchDepth++;
        this._sendDevToolsUpdate('batch:start', {depth: this._batchDepth});

        try {
            fn();
        } finally {
            this._batchDepth--;
            this._sendDevToolsUpdate('batch:end', {depth: this._batchDepth});

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
        if (this._flushDepth >= MAX_FLUSH_DEPTH) {
            const error = `[oja/reactive] Maximum update depth (${MAX_FLUSH_DEPTH}) exceeded. Likely a circular dependency.`;
            console.error(error);
            this._sendDevToolsUpdate('error:max-depth', {depth: this._flushDepth});

            this._flushDepth = 0;
            this._effectQueue.clear();
            this._scheduled = false;
            return;
        }

        this._flushDepth++;
        const queue = [...this._effectQueue];
        this._effectQueue.clear();
        this._scheduled = false;

        this._sendDevToolsUpdate('flush:start', {count: queue.length, depth: this._flushDepth});

        for (const effect of queue) {
            if (this._dirtyFlags.has(effect)) {
                effect();
            }
        }

        this._sendDevToolsUpdate('flush:end', {depth: this._flushDepth});
        this._flushDepth--;
    }

    // Run fn without tracking signal dependencies
    _withoutTracking(fn) {
        const saved = this._currentEffect;
        this._currentEffect = null;
        try { return fn(); }
        finally { this._currentEffect = saved; }
    }

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

const _sys = new ReactiveSystem();

// D-03: DevTools connection is now opt-in via window.__OJA_DEVTOOLS__ = true.
// Previously auto-connected on localhost which caused issues in staging/intranet
// environments served locally. Set the flag before importing reactive.js:
//   window.__OJA_DEVTOOLS__ = true;
if (typeof window !== 'undefined' && window.__OJA_DEVTOOLS__) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => _sys._connectDevTools());
    } else {
        _sys._connectDevTools();
    }
}

// Creates a reactive state primitive.
// Returns a tuple with a getter and a setter function.
export const state = (v, name) => _sys.state(v, name);

// Creates a derived reactive value based on a computation function.
// Automatically tracks dependencies accessed during the computation.
export const derived = (fn) => _sys.derived(fn);

// Registers a side effect that automatically re-runs when its dependencies change.
// Returns a function to manually dispose the effect.
export const effect = (fn) => _sys.effect(fn);

// Groups multiple state updates into a single synchronous batch.
// Prevents intermediate effects from firing until the batch completes.
export const batch = (fn) => _sys.batch(fn);

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
 */
export function context(name, initialValue) {
    if (!_ctx.has(name)) {
        const [read, write] = _sys.state(initialValue, name);
        _ctx.set(name, [read, write]);
    }
    return _ctx.get(name);
}

context.persist = (name, initialValue, options = {}) => {
    if (!_ctx.has(name)) {
        const [read, write] = _sys.persistentState(initialValue, name, options);
        _ctx.set(name, [read, write]);
    }
    return _ctx.get(name);
};

context.has = (name) => _ctx.has(name);

// Throws a clear error if the key has not been registered yet.
// Use in components to catch context key typos or ordering bugs early.
context.require = (name) => {
    if (!_ctx.has(name)) {
        throw new Error(`[oja/context] '${name}' is not registered. Call context('${name}', defaultValue) before subscribing.`);
    }
    return _ctx.get(name);
};

context.delete = (name) => _ctx.delete(name);

context.get = (name) => {
    if (!_ctx.has(name)) return undefined;
    const [read] = _ctx.get(name);
    return read();
};

context.keys = () => [..._ctx.keys()];

context.clear = (name) => {
    if (!_ctx.has(name)) return;

    const [read, write] = _ctx.get(name);
    read();
    write(undefined);

    for (const [id, data] of _sys._persistentStates) {
        const stateEntry = _sys._states.get(id);
        if (stateEntry && stateEntry.name === name) {
            _sys._removePersistent(data.key, data.storage);
            break;
        }
    }
};

context.inspect = () => {
    const snapshot = {};
    for (const [name, [read]] of _ctx) {
        snapshot[name] = read();
    }
    return snapshot;
};


// Like effect() but explicit about what to watch, passes (newVal, oldVal),
// and does not run immediately by default.
//
//   watch(count, (next, prev) => console.log(prev, '→', next));
//   watch(count, handler, { immediate: true }); // run like effect()
//
// Returns a dispose function.
export function watch(signal, fn, options = {}) {
    const { immediate = false } = options;
    let prev = signal();

    if (immediate) {
        fn(prev, undefined);
    }

    return effect(() => {
        const next = signal();
        if (next !== prev || (next !== null && typeof next === 'object')) {
            const old = prev;
            prev = next;
            fn(next, old);
        }
    });
}

// Run fn() without tracking any signal reads as dependencies.
// Use inside effect() to read signals you don't want to subscribe to.
//
//   effect(() => {
//       const id = selectedId();          // tracked
//       const cfg = untrack(getConfig);   // NOT tracked
//   });
export function untrack(fn) {
    return _sys._withoutTracking(fn);
}

// Wrap a writable signal to expose only the getter.
// Useful for module encapsulation.
//
//   const [_count, setCount] = state(0);
//   export const count = readonly(_count);
export function readonly(signal) {
    const read = () => signal();
    read.__isOjaSignal = true;
    read.__isReadonly  = true;
    return read;
}

// Watch a named context value. fn receives (newValue, oldValue).
// Returns an unsubscribe function.
context.subscribe = (name, fn) => {
    const pair = _ctx.get(name);
    if (!pair) {
        console.warn(`[oja/context] subscribe: '${name}' is not registered`);
        return () => {};
    }
    const [read] = pair;
    return watch(read, fn);
};

// Restore a context value to its initial value and re-persist if applicable.
context.reset = (name) => {
    if (!_ctx.has(name)) return;

    // Find the initial value from the reactive system's state tracking
    for (const [id, stateEntry] of _sys._states) {
        if (stateEntry.name === name) {
            const [, write] = _ctx.get(name);
            write(stateEntry.initialValue);

            // Re-persist default if this was a persistent state
            const persistent = _sys._persistentStates.get(id);
            if (persistent) {
                _sys._savePersistent(persistent.key, persistent.storage, stateEntry.initialValue, null);
            }
            return;
        }
    }
};

if (typeof window !== 'undefined') {
    window.__OJA_REACTIVE__ = {
        inspect: () => _sys.inspect(),
        context: context.inspect,
        state: state,
        effect: effect,
        batch: batch
    };
}

//
// Unlike emit/listen (fire-and-forget), a channel holds the last value.
// Late subscribers receive the current value immediately on subscribe.
// This makes it the right primitive for component-to-component communication
// where components mount at different times and need the current state.
//
//
//   // In hosts.html component — write
//   import { channel } from '../core/reactive.js';
//   const selected = channel('host:selected');
//   selected.set({ id: 42, name: 'api.example.com' });
//
//   // In sidebar.html component — read (gets current value immediately)
//   const selected = channel('host:selected');
//   const off = selected.subscribe(host => {
//       if (host) renderDetail(host);
//   });
//   // off() to unsubscribe
//
//   // One-time read without subscribing
//   const host = selected.get();
//
//   // Reset to initial value and notify subscribers
//   selected.reset();
//
//   // Check if anyone is listening
//   selected.hasSubscribers(); // → boolean
//
//
//   // Channels are global by default — same name = same channel everywhere.
//   // Destroy a channel when the page that owns it unmounts:
//   component.onUnmount(() => channel('host:selected').destroy());
//
//
//   // Use with effect() for reactive derived state
//   const selected = channel('host:selected');
//   effect(() => {
//       const host = selected.get();
//       if (host) document.title = host.name;
//   });

const _signals = new Map();

// Hook set by component.js so channel() can auto-register new channels
// for cleanup when they are created inside a component script.
// Follows the same pattern as _setComponentScopeHook in events.js.
let _componentChannelHook = null;
export function _setComponentChannelHook(fn) { _componentChannelHook = fn; }

export function signal(name, initialValue = undefined) {
    if (_signals.has(name)) return _signals.get(name);

    let _value       = initialValue;
    let _hasValue    = initialValue !== undefined;
    const _listeners = new Set();

    const ch = {
        /**
         * Set the current value and notify all subscribers.
         * @param {*} value
         */
        set(value) {
            _value   = value;
            _hasValue = true;
            for (const fn of _listeners) {
                try { fn(value); } catch (e) {
                    console.warn(`[oja/channel] subscriber error on "${name}":`, e);
                }
            }
            return this;
        },

        /**
         * Get the current value without subscribing.
         * Returns undefined if no value has been set yet.
         */
        get() {
            return _value;
        },

        /**
         * Subscribe to value changes.
         * The subscriber is called immediately with the current value if one exists.
         * Returns an unsubscribe function.
         *
         * @param {Function} fn — called with (value) on every set()
         * @returns {Function} unsubscribe
         */
        subscribe(fn) {
            if (typeof fn !== 'function') return () => {};
            _listeners.add(fn);
            // Give late subscriber the current value immediately
            if (_hasValue) {
                try { fn(_value); } catch (e) {
                    console.warn(`[oja/channel] subscriber error on "${name}":`, e);
                }
            }
            return () => _listeners.delete(fn);
        },

        /**
         * Reset the channel to its initial value and notify subscribers.
         */
        reset() {
            _value    = initialValue;
            _hasValue = initialValue !== undefined;
            for (const fn of _listeners) {
                try { fn(_value); } catch (e) {
                    console.warn(`[oja/channel] subscriber error on "${name}":`, e);
                }
            }
            return this;
        },

        /**
         * Remove all subscribers and delete from the global registry.
         * Call from component.onUnmount() when the component owns the channel.
         */
        destroy() {
            _listeners.clear();
            _signals.delete(name);
        },

        /** True if at least one subscriber is registered. */
        hasSubscribers() {
            return _listeners.size > 0;
        },

        /** Number of active subscribers. */
        get size() {
            return _listeners.size;
        },

        /** The channel name. */
        get name() {
            return name;
        },
    };

    _signals.set(name, ch);

    // If a component is currently mounting, register this channel for
    // auto-cleanup when that component unmounts. The owning component is
    // responsible for destroying the channel — subscribers only unsubscribe.
    if (_componentChannelHook) _componentChannelHook(ch);

    return ch;
}

/**
 * Destroy all channels — useful in tests and full app teardown.
 */
signal.destroyAll = function() {
    for (const ch of _signals.values()) ch.destroy();
    _signals.clear();
};