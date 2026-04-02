/**
 * oja/_context.js
 * Component execution context — the container stack and props store.
 *
 * Intentionally dependency-free. Single source of truth for which component
 * is currently executing. Any module imports from here without circles.
 *
 * ─── Who uses this ────────────────────────────────────────────────────────────
 *
 *   _exec.js      — pushContainer(el, propsData) before executing a script,
 *                   popContainer() in the Promise.all finally block,
 *                   _setReadyFn(el, done) to wire the completion signal.
 *
 *   ui.js         — currentContainer() as default scope for find().
 *
 *   component.js  — currentContainer() for lifecycle hooks,
 *                   _getProps(el) for props() export,
 *                   _getReadyFn(el) for ready() export.
 *
 * ─── Public API (re-exported from component.js → oja.js) ─────────────────────
 *
 *   import { find, container, props, ready } from '../js/oja.js';
 */

// Stack of active containers — each entry is the DOM element only.
// Props are stored separately in a WeakMap for O(1) lookup regardless of stack depth.
const _stack     = [];
const _propsMap  = new WeakMap(); // Element → propsData

/** @internal */
export function pushContainer(el, propsData = {}) {
    _stack.push(el);
    _propsMap.set(el, propsData);
}

/** @internal */
export function popContainer() {
    const el = _stack.pop();
    // Do not delete from _propsMap — WeakMap releases automatically when el is GC'd.
    // Keeping it alive is harmless; the element reference in the stack was the only
    // strong reference preventing GC, and we just removed it.
    return el;
}

/** Returns the DOM element currently being executed, or null */
export function currentContainer() {
    return _stack.at(-1) ?? null;
}

/** @internal — O(1) props lookup via WeakMap (was O(N) linear scan) */
export function _getProps(el) {
    return _propsMap.get(el) ?? null;
}

// ready() bridge
const _readyFns = new WeakMap();

/** @internal — called by _exec.js to register the _done resolver */
export function _setReadyFn(el, fn) {
    _readyFns.set(el, fn);
}

/** @internal — called by component.ready() */
export function _getReadyFn(el) {
    return _readyFns.get(el) ?? null;
}
