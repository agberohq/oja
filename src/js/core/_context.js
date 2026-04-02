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

// Each entry: { el, props }
const _stack = [];

/** @internal */
export function pushContainer(el, propsData = {}) {
    _stack.push({ el, props: propsData });
}

/** @internal */
export function popContainer() {
    _stack.pop();
}

/** Returns the DOM element currently being executed, or null */
export function currentContainer() {
    return _stack.at(-1)?.el ?? null;
}

/** @internal — returns the props for a given element */
export function _getProps(el) {
    // Search from top of stack for matching element
    for (let i = _stack.length - 1; i >= 0; i--) {
        if (_stack[i].el === el) return _stack[i].props;
    }
    return null;
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
