/**
 * oja/_context.js
 * Component execution context — the container stack and props store.
 *
 * Intentionally dependency-free. Single source of truth for which component
 * is currently executing. Any module imports from here without circles.
 *
 * ─── Concurrency model ────────────────────────────────────────────────────────
 *
 * JavaScript is single-threaded, but multiple execScripts() calls can be made
 * concurrently (e.g. layout mounting 5 slots via Promise.all). Each module
 * script's synchronous top-level code runs non-interleaved — two modules never
 * run simultaneously. So a single "current execution" slot is safe for
 * top-level find() calls.
 *
 * The slot is set by the preamble injected into each blob:
 *   window.__oja_exec__ = containerElement;
 * and read by currentContainer() before falling back to the stack.
 *
 * For find() calls inside effects or callbacks (which run after the script's
 * top-level completes), the correct pattern is to capture the element once
 * at init time:
 *   const btn = find('#btn');          // at top-level — correct container
 *   effect(() => { btn.update(...); }); // reuses captured reference
 *
 * ─── Who uses this ────────────────────────────────────────────────────────────
 *
 *   _exec.js      — sets window.__oja_exec__ in preamble (via scopeKey),
 *                   pushContainer/popContainer for the legacy stack path,
 *                   _setReadyFn(el, done) to wire the completion signal.
 *
 *   ui.js         — currentContainer() as default scope for find().
 *
 *   component.js  — currentContainer() for lifecycle hooks,
 *                   _getProps(el) for props() export,
 *                   _getReadyFn(el) for ready() export.
 */

// Per-execution slot (parallel-safe)
// Set by the preamble at the very start of each module script's synchronous
// execution. Cleared after the top-level code completes (on load event).
// Safe because JS module evaluation is single-threaded and non-interleaved.
const _EXEC_KEY = '__oja_exec__';

/** @internal — called by ui.js/component.js to get the current container */
export function currentContainer() {
    return window[_EXEC_KEY] ?? _stack.at(-1) ?? null;
}

/** @internal — clear the per-execution slot after script top-level completes */
export function clearExecSlot() {
    delete window[_EXEC_KEY];
}

// Legacy stack (for non-parallel / nested component mounts)
// Stack of active containers — each entry is the DOM element only.
// Props are stored separately in a WeakMap for O(1) lookup regardless of depth.
const _stack    = [];
const _propsMap = new WeakMap(); // Element → propsData

/** @internal */
export function pushContainer(el, propsData = {}) {
    _stack.push(el);
    _propsMap.set(el, propsData);
}

/** @internal */
export function popContainer() {
    return _stack.pop();
}

/** @internal — O(1) props lookup via WeakMap */
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
