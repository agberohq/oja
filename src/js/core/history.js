/**
 * oja/history.js
 * History management with undo/redo support.
 * Tracks state changes and provides navigation through history stack.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { history } from '../oja/history.js';
 *
 *   // Push state with action description
 *   history.push({ hosts: ['api-01', 'api-02'] }, 'Loaded hosts');
 *
 *   // Update state (automatically creates history entry)
 *   history.update({ hosts: [...hosts, 'api-03'] }, 'Added host');
 *
 *   // Undo/redo
 *   history.undo(); // Reverts to previous state
 *   history.redo(); // Re-applies undone state
 *
 *   // Check availability
 *   if (history.canUndo) enableUndoButton();
 *   if (history.canRedo) enableRedoButton();
 *
 * ─── With reactive state ──────────────────────────────────────────────────────
 *
 *   import { history } from '../oja/history.js';
 *   import { state } from '../oja/reactive.js';
 *
 *   const [hosts, setHosts] = state([]);
 *
 *   // Wrap state updates with history
 *   function addHost(host) {
 *       history.update(
 *           { hosts: [...hosts(), host] },
 *           `Added host ${host.name}`
 *       );
 *       setHosts(hosts()); // Will be called by history if bound
 *   }
 *
 *   // Bind to reactive state
 *   history.bind(setHosts, (state) => setHosts(state.hosts));
 *
 * ─── With form editing ────────────────────────────────────────────────────────
 *
 *   import { history } from '../oja/history.js';
 *
 *   // Track form changes
 *   form.on('#config-form', {
 *       onChange: (data) => {
 *           history.push(data, 'Form updated');
 *       }
 *   });
 *
 *   // Undo/redo buttons
 *   on('#undo-btn', 'click', () => history.undo());
 *   on('#redo-btn', 'click', () => history.redo());
 *
 * ─── Named histories ──────────────────────────────────────────────────────────
 *
 *   // Create separate history stacks
 *   const hostsHistory = history.namespace('hosts');
 *   const configHistory = history.namespace('config');
 *
 *   hostsHistory.push({ hosts: [] }, 'Initial');
 *   configHistory.push({ theme: 'dark' }, 'Theme set');
 *
 * ─── State diffs ──────────────────────────────────────────────────────────────
 *
 *   history.onChange((action, oldState, newState) => {
 *       const changes = history.diff(oldState, newState);
 *       console.log('Changed fields:', changes);
 *   });
 */

// ─── History stack ────────────────────────────────────────────────────────────

// ─── Deep clone ──────────────────────────────────────────────────────────────
//
// JSON.parse(JSON.stringify(x)) is lossy:
//   - Date objects become strings
//   - undefined values are dropped or become null
//   - Functions, Maps, Sets are silently lost
//   - Circular references throw
//
// structuredClone() handles all of these correctly and is available in all
// modern browsers (Chrome 98+, Firefox 94+, Safari 15.4+) and Node 17+.
// We wrap it with a JSON fallback for environments that don't support it yet.
function _deepClone(value) {
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch {
            // structuredClone throws on non-cloneable values (e.g. functions).
            // Fall through to JSON path which will drop them silently.
        }
    }
    // Legacy fallback — lossy but safe
    return JSON.parse(JSON.stringify(value));
}

export class OjaHistory {
    constructor(namespace = 'default', maxSize = 100) {
        this.namespace = namespace;
        this.maxSize = maxSize;
        this.stack = [];
        this.index = -1;
        this.savedIndex = -1;
        this.listeners = new Set();
        this.bindings = new Set(); // { getter, setter }
    }

    /**
     * Push a new state onto the history stack
     */
    push(state, description = 'Unknown action', options = {}) {
        const { merge = false, skipDuplicates = true } = options;

        // Remove any future states if we're not at the end
        if (this.index < this.stack.length - 1) {
            this.stack = this.stack.slice(0, this.index + 1);
        }

        // Check for duplicate
        if (skipDuplicates && this.stack.length > 0) {
            const last = this.stack[this.index];
            if (JSON.stringify(last.state) === JSON.stringify(state)) {
                return this;
            }
        }

        // Merge with last state if requested
        if (merge && this.stack.length > 0) {
            const last = this.stack[this.index];
            state = { ...last.state, ...state };
        }

        const entry = {
            state: _deepClone(state),
            description,
            timestamp: Date.now(),
        };

        this.stack.push(entry);

        // Enforce max size
        if (this.stack.length > this.maxSize) {
            this.stack.shift();
        } else {
            this.index++;
        }

        this._notify('push', entry);
        this._updateBindings();

        return this;
    }

    /**
     * Update current state (replaces last entry)
     */
    update(state, description = 'Updated', options = {}) {
        if (this.stack.length === 0) {
            return this.push(state, description, options);
        }

        const last = this.stack[this.index];
        const newEntry = {
            state: _deepClone(state),
            description,
            timestamp: Date.now(),
        };

        this.stack[this.index] = newEntry;
        this._notify('update', newEntry, last);
        this._updateBindings();

        return this;
    }

    /**
     * Undo to previous state
     */
    undo() {
        if (!this.canUndo) return null;

        const current = this.stack[this.index];
        this.index--;
        const previous = this.stack[this.index];

        this._notify('undo', previous, current);
        this._updateBindings();

        return previous;
    }

    /**
     * Redo to next state
     */
    redo() {
        if (!this.canRedo) return null;

        const current = this.stack[this.index];
        this.index++;
        const next = this.stack[this.index];

        this._notify('redo', next, current);
        this._updateBindings();

        return next;
    }

    /**
     * Go to specific index
     */
    goTo(index) {
        if (index < 0 || index >= this.stack.length) return null;

        const current = this.stack[this.index];
        this.index = index;
        const target = this.stack[this.index];

        this._notify('goto', target, current);
        this._updateBindings();

        return target;
    }

    /**
     * Clear history
     */
    clear() {
        this.stack = [];
        this.index = -1;
        this._notify('clear');
    }

    /**
     * Mark current state as saved (for dirty tracking)
     */
    markSaved() {
        this.savedIndex = this.index;
        this._notify('markSaved');
    }

    /**
     * Check if current state is saved
     */
    get isSaved() {
        return this.savedIndex === this.index;
    }

    /**
     * Check if undo is available
     */
    get canUndo() {
        return this.index > 0;
    }

    /**
     * Check if redo is available
     */
    get canRedo() {
        return this.index < this.stack.length - 1;
    }

    /**
     * Get current state
     */
    get current() {
        return this.stack[this.index]?.state || null;
    }

    /**
     * Get current entry
     */
    get currentEntry() {
        return this.stack[this.index] || null;
    }

    /**
     * Get undo description
     */
    get undoDescription() {
        return this.canUndo ? this.stack[this.index - 1]?.description : null;
    }

    /**
     * Get redo description
     */
    get redoDescription() {
        return this.canRedo ? this.stack[this.index + 1]?.description : null;
    }

    /**
     * Get stack size
     */
    get size() {
        return this.stack.length;
    }

    /**
     * Bind to reactive state
     */
    bind(setter, getter = null) {
        this.bindings.add({ setter, getter });

        // Initial sync
        if (this.current && getter) {
            setter(this.current);
        }

        return () => this.bindings.delete({ setter, getter });
    }

    _updateBindings() {
        if (!this.current) return;

        for (const { setter, getter } of this.bindings) {
            try {
                if (getter) {
                    setter(this.current);
                }
            } catch (e) {
                console.warn(`[oja/history] Binding update failed:`, e);
            }
        }
    }

    /**
     * Listen to history changes
     */
    onChange(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    _notify(type, ...args) {
        for (const fn of this.listeners) {
            try {
                fn(type, ...args);
            } catch (e) {
                console.warn(`[oja/history] Listener error:`, e);
            }
        }
    }

    /**
     * Get diff between two states
     */
    diff(oldState, newState) {
        const changes = {};

        const allKeys = new Set([
            ...Object.keys(oldState || {}),
            ...Object.keys(newState || {})
        ]);

        for (const key of allKeys) {
            const oldVal = oldState?.[key];
            const newVal = newState?.[key];

            if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
                changes[key] = { old: oldVal, new: newVal };
            }
        }

        return changes;
    }

    /**
     * Export history for debugging
     */
    export() {
        return {
            namespace: this.namespace,
            index: this.index,
            savedIndex: this.savedIndex,
            stack: this.stack.map(entry => ({
                ...entry,
                state: '[cloned]', // Don't expose actual state
                description: entry.description,
                timestamp: entry.timestamp,
            })),
        };
    }
}

// ─── Global history instance ──────────────────────────────────────────────────

const _histories = new Map();

export const history = {
    /**
     * Get or create a history namespace
     */
    namespace(name = 'default', maxSize = 100) {
        if (!_histories.has(name)) {
            _histories.set(name, new OjaHistory(name, maxSize));
        }
        return _histories.get(name);
    },

    /**
     * Push state to default history
     */
    push(state, description, options) {
        return this.namespace('default').push(state, description, options);
    },

    /**
     * Update state in default history
     */
    update(state, description, options) {
        return this.namespace('default').update(state, description, options);
    },

    /**
     * Undo default history
     */
    undo() {
        return this.namespace('default').undo();
    },

    /**
     * Redo default history
     */
    redo() {
        return this.namespace('default').redo();
    },

    /**
     * Go to index in default history
     */
    goTo(index) {
        return this.namespace('default').goTo(index);
    },

    /**
     * Clear default history
     */
    clear() {
        return this.namespace('default').clear();
    },

    /**
     * Mark saved in default history
     */
    markSaved() {
        return this.namespace('default').markSaved();
    },

    /**
     * Check if undo available
     */
    get canUndo() {
        return this.namespace('default').canUndo;
    },

    /**
     * Check if redo available
     */
    get canRedo() {
        return this.namespace('default').canRedo;
    },

    /**
     * Get current state
     */
    get current() {
        return this.namespace('default').current;
    },

    /**
     * Check if current state is saved
     */
    get isSaved() {
        return this.namespace('default').isSaved;
    },

    /**
     * Listen to changes in default history
     */
    onChange(fn) {
        return this.namespace('default').onChange(fn);
    },

    /**
     * Bind to reactive state
     */
    bind(setter, getter) {
        return this.namespace('default').bind(setter, getter);
    },

    /**
     * Get diff between states
     */
    diff(oldState, newState) {
        return this.namespace('default').diff(oldState, newState);
    },

    /**
     * Get all history namespaces
     */
    namespaces() {
        return Array.from(_histories.keys());
    },

    /**
     * Delete a history namespace
     */
    delete(name) {
        return _histories.delete(name);
    },
};