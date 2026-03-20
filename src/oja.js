/**
 * oja.js — core barrel entry point
 *
 * ─── Named imports (tree-shakeable) ──────────────────────────────────────────
 *
 *   import { Router, Out, auth, notify, state, effect } from '../oja/src/oja.js';
 *
 * ─── Grouped imports (one object, dot-access) ─────────────────────────────────
 *
 *   import { Reactive, Event, DOM } from '../oja/src/oja.js';
 *   Reactive.state(0)
 *   Event.on('.btn', 'click', handler)
 *   DOM.find('#app')
 *
 * ─── Namespace import (everything under one object) ───────────────────────────
 *
 *   import { Oja } from '../oja/src/oja.js';
 *   Oja.Router   Oja.Out   Oja.notify   Oja.state
 *
 * ─── Individual deep imports (zero-build / max tree-shaking) ──────────────────
 *
 *   import { Router }   from '../oja/src/js/core/router.js';
 *   import { Out }      from '../oja/src/js/core/out.js';
 *   import { state }    from '../oja/src/js/core/reactive.js';
 *   import { encrypt }  from '../oja/src/js/core/encrypt.js';
 *   import { VFS }      from '../oja/src/js/core/vfs.js';
 *   import { Runner }   from '../oja/src/js/core/runner.js';
 *
 * ─── Extensions ───────────────────────────────────────────────────────────────
 *
 *   import { OjaSocket, canvas, dragdrop } from '../oja/src/oja.full.js';
 *
 * ─── Out shorthands ───────────────────────────────────────────────────────────
 *
 *   Out.c()  → Out.component()
 *   Out.h()  → Out.html()
 *   Out.t()  → Out.text()
 */

// ─── Kernel ───────────────────────────────────────────────────────────────────
export { Store }                                          from './js/core/store.js';
export { state, effect, derived, batch, context }         from './js/core/reactive.js';
export { render, renderRaw, fill, each, template }        from './js/core/template.js';
export { OjaHistory, history }                            from './js/core/history.js';

// ─── Crypto ───────────────────────────────────────────────────────────────────
export { encrypt }                                        from './js/core/encrypt.js';

// ─── Project config ───────────────────────────────────────────────────────────
// Optional oja.config.json loader — single source of truth for the project.
// Zero config to start — every primitive works without it.
export { config }                                         from './js/core/config.js';

// ─── Display primitive ────────────────────────────────────────────────────────
// Out is the universal output type. Responder is a backwards-compatible alias.
export { Out, Responder }                                 from './js/core/out.js';

// ─── Network ──────────────────────────────────────────────────────────────────
export { Api }                                            from './js/core/api.js';

// ─── Codecs ───────────────────────────────────────────────────────────────────
export { JsonCodec, jsonCodec }                           from './js/core/codecs/json.js';
export { MsgPackCodec }                                   from './js/core/codecs/msgpack.js';

// ─── UI ───────────────────────────────────────────────────────────────────────
export { Router }                                         from './js/core/router.js';
export { component }                                      from './js/core/component.js';
export { layout }                                         from './js/core/layout.js';
export { modal }                                          from './js/core/modal.js';
export { notify }                                         from './js/core/notify.js';
export { animate }                                        from './js/core/animate.js';

export {
    ui,
    find, findAll, findAllIn,
    createEl, empty, removeEl,
    afterEl, beforeEl, toggleEl,
    matches, closest,
}                                                         from './js/core/ui.js';

// ─── Forms + Validation ───────────────────────────────────────────────────────
export { form }                                           from './js/core/form.js';
export { validate }                                       from './js/core/validate.js';

// ─── Events ───────────────────────────────────────────────────────────────────
export {
    on, once, off, emit, listen, listenOnce, waitFor,
    debounce, throttle, rafThrottle,
    keys,
    onScroll, onScrollDirection, isInViewport, getViewportPosition,
    onVisible, onceVisible, unobserve, createVisibilityObserver,
    onResize, onMutation,
}                                                         from './js/core/events.js';

// ─── Auth ─────────────────────────────────────────────────────────────────────
export { auth }                                           from './js/core/auth.js';

// ─── Concurrency ─────────────────────────────────────────────────────────────
export { Channel, go, pipeline, fanOut, fanIn,
    merge, split }                                        from './js/core/channel.js';

// Background infrastructure
export { Runner }                                         from './js/core/runner.js';
export { VFS }                                            from './js/core/vfs.js';
export { sw }                                             from './js/core/sw.js';

// ─── Plugin system ────────────────────────────────────────────────────────────
export { plugin }                                         from './js/core/plugin.js';

// ─── Dev tools ────────────────────────────────────────────────────────────────
export { logger }                                         from './js/core/logger.js';
export { debug }                                          from './js/core/debug.js';
export { adapter }                                        from './js/core/adapter.js';

// ─── Version ──────────────────────────────────────────────────────────────────
export const VERSION = '0.0.1';

// ─── Grouped exports — one import, dot-access ────────────────────────────────
// Import the whole group when you want a clean namespace without listing every name.
// Named individual exports above are preserved — both patterns work simultaneously.
//
//   import { Reactive } from 'oja';
//   const [count, setCount] = Reactive.state(0);
//   Reactive.effect(() => console.log(count()));
//
//   import { Event } from 'oja';
//   Event.on('.btn', 'click', handler);
//   Event.emit('app:ready');
//
//   import { DOM } from 'oja';
//   DOM.find('#app');
//   DOM.createEl('div', { class: 'card' });

import { state, effect, derived, batch, context }                                    from './js/core/reactive.js';
import { on, once, off, emit, listen, listenOnce, waitFor,
    debounce, throttle, rafThrottle, keys,
    onScroll, onScrollDirection, isInViewport, getViewportPosition,
    onVisible, onceVisible, unobserve, createVisibilityObserver,
    onResize, onMutation }                                                        from './js/core/events.js';
import { ui, find, findAll, findAllIn, createEl, empty, removeEl,
    afterEl, beforeEl, toggleEl, matches, closest }                              from './js/core/ui.js';
import { Store }                                                                      from './js/core/store.js';
import { encrypt }                                                                    from './js/core/encrypt.js';
import { config }                                                                     from './js/core/config.js';
import { render, renderRaw, fill, each, template }                                   from './js/core/template.js';
import { OjaHistory, history }                                                        from './js/core/history.js';
import { Out, Responder }                                                             from './js/core/out.js';
import { Api }                                                                        from './js/core/api.js';
import { JsonCodec, jsonCodec }                                                       from './js/core/codecs/json.js';
import { MsgPackCodec }                                                               from './js/core/codecs/msgpack.js';
import { Router }                                                                     from './js/core/router.js';
import { component }                                                                  from './js/core/component.js';
import { layout }                                                                     from './js/core/layout.js';
import { modal }                                                                      from './js/core/modal.js';
import { notify }                                                                     from './js/core/notify.js';
import { animate }                                                                    from './js/core/animate.js';
import { form }                                                                       from './js/core/form.js';
import { validate }                                                                   from './js/core/validate.js';
import { auth }                                                                       from './js/core/auth.js';
import { Channel, go, pipeline, fanOut, fanIn, merge, split }                        from './js/core/channel.js';
import { Runner }                                                                     from './js/core/runner.js';
import { VFS }                                                                        from './js/core/vfs.js';
import { plugin }                                                                     from './js/core/plugin.js';
import { logger }                                                                     from './js/core/logger.js';
import { debug }                                                                      from './js/core/debug.js';
import { adapter }                                                                    from './js/core/adapter.js';

export const Reactive = { state, effect, derived, batch, context };

export const Event = {
    on, once, off, emit, listen, listenOnce, waitFor,
    debounce, throttle, rafThrottle, keys,
    onScroll, onScrollDirection, isInViewport, getViewportPosition,
    onVisible, onceVisible, unobserve, createVisibilityObserver,
    onResize, onMutation,
};

export const DOM = {
    ui,
    find, findAll, findAllIn,
    createEl, empty, removeEl,
    afterEl, beforeEl, toggleEl,
    matches, closest,
};

// ─── Oja namespace — everything under one object ──────────────────────────────
// Alternative to the grouped exports above. Useful for quick prototyping or
// when you want every primitive available without any destructuring.
//
//   import { Oja } from 'oja';
//   Oja.state   Oja.Router   Oja.notify   Oja.Event.on   Oja.DOM.find

export const Oja = {
    // Kernel
    Store,
    Reactive, Event, DOM,
    state, effect, derived, batch, context,
    render, renderRaw, fill, each, template,
    OjaHistory, history,
    // Crypto
    encrypt,
    // Config
    config,
    // Display
    Out, Responder,
    // Network
    Api,
    // Codecs
    JsonCodec, jsonCodec, MsgPackCodec,
    // UI
    Router, component, layout, modal, notify, animate,
    ui, find, findAll, findAllIn,
    createEl, empty, removeEl,
    afterEl, beforeEl, toggleEl,
    matches, closest,
    // Forms
    form, validate,
    // Events
    on, once, off, emit, listen, listenOnce, waitFor,
    debounce, throttle, rafThrottle, keys,
    onScroll, onScrollDirection, isInViewport, getViewportPosition,
    onVisible, onceVisible, unobserve, createVisibilityObserver,
    onResize, onMutation,
    // Auth
    auth,
    // Concurrency
    Channel, go, pipeline, fanOut, fanIn, merge, split,
    // Background infrastructure
    Runner, VFS,
    // Plugin
    plugin,
    // Dev tools
    logger, debug, adapter,
    // Version
    version: VERSION,
};