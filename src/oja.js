/**
 * oja.js — core barrel entry point
 *
 * Single import for apps that want everything in core:
 *   import { Router, Out, auth, notify, debounce, keys, context } from '../oja/src/oja.js';
 *
 * Individual imports for zero-build / tree-shaking:
 *   import { Router }          from '../oja/src/js/router.js';
 *   import { Out }             from '../oja/src/js/out.js';
 *   import { context }         from '../oja/src/js/reactive.js';
 *   import { keys, debounce }  from '../oja/src/js/events.js';
 *   import { Channel, go }     from '../oja/src/js/channel.js';
 *
 * For plugins (socket, wasm, worker, canvas, etc.) import from oja.full.js:
 *   import { OjaSocket, OjaWorker, OjaWasm } from '../oja/src/oja.full.js';
 *
 * Shorthand aliases baked into Out:
 *   Out.c()  → Out.component()
 *   Out.h()  → Out.html()
 *   Out.t()  → Out.text()
 */

// ─── Kernel ───────────────────────────────────────────────────────────────────
export { Store }                                          from './js/store.js';
export { state, effect, derived, batch, context }         from './js/reactive.js';
export { render, renderRaw, fill, each, template }        from './js/template.js';
export { OjaHistory, history }                            from './js/history.js';

// ─── The display primitive ────────────────────────────────────────────────────
// Out is the universal output type. Everywhere Oja produces visible content,
// the answer is an Out. Responder is kept as a backwards-compatible alias.
export { Out, OutBase, Responder }                        from './js/out.js';

// ─── Network ──────────────────────────────────────────────────────────────────
export { Api }                                            from './js/api.js';

// ─── Codecs ───────────────────────────────────────────────────────────────────
export { JsonCodec, jsonCodec }                           from './js/codecs/json.js';
export { MsgPackCodec }                                   from './js/codecs/msgpack.js';

// ─── UI ───────────────────────────────────────────────────────────────────────
export { Router }                                         from './js/router.js';
export { component }                                      from './js/component.js';
export { modal }                                          from './js/modal.js';
export { notify }                                         from './js/notify.js';
export { ui }                                             from './js/ui.js';
export { animate }                                        from './js/animate.js';

// ─── Forms + Validation ───────────────────────────────────────────────────────
export { form }                                           from './js/form.js';
export { validate }                                       from './js/validate.js';

// ─── Events ───────────────────────────────────────────────────────────────────
export {
    on, once, off, emit, listen, listenOnce, waitFor,
    debounce, throttle, rafThrottle, once as onceFn,
    keys,
    onScroll, onScrollDirection, isInViewport, getViewportPosition,
    onVisible, onceVisible, unobserve, createVisibilityObserver,
    onResize, onMutation
}                                                         from './js/events.js';

// ─── Auth ─────────────────────────────────────────────────────────────────────
export { auth }                                           from './js/auth.js';

// ─── Concurrency (core — Go-style concurrency is idiomatic Oja) ──────────────
export { Channel, go, pipeline, fanOut, fanIn,
    merge, split }                                   from './js/channel.js';

// ─── Dev tools ────────────────────────────────────────────────────────────────
export { logger }                                         from './js/logger.js';
export { debug }                                          from './js/debug.js';
export { adapter }                                        from './js/adapter.js';

// ─── Version ──────────────────────────────────────────────────────────────────
export const VERSION = '0.0.1';
export const OJA = {
    version:     '0.0.1',
    name:        'Oja Framework',
    description: 'Zero-boilerplate SPA framework',
};