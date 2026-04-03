/**
 * oja.js — kernel barrel
 *
 * Contains only what every Oja app needs regardless of what it builds:
 * reactive state, rendering, routing, DOM helpers, events, engine, timers.
 *
 * UI patterns, extensions, and utilities live in oja.full.js.
 *
 * Deep imports are always available for maximum tree-shaking:
 *
 *   import { Router }   from './js/core/router.js';
 *   import { modal }    from './js/ui/modal.js';
 *   import { auth }     from './js/ext/auth.js';
 *   import { encrypt }  from './js/utils/encrypt.js';
 *
 * ─── Directory layout ─────────────────────────────────────────────────────────
 *
 *   js/core/   — kernel (store, reactive, events, engine, template, out,
 *                         component, router, layout, animate, ui, plugin)
 *   js/ui/     — UI patterns (modal, notify, form, validate,
 *                              clipboard, canvas, dragdrop, table, tabs)
 *   js/ext/    — opt-in (auth, pagination, channel, chart, history, config,
 *                          socket, worker, wasm, vfs, runner, sw …)
 *   js/utils/  — pure utilities (encrypt, logger, debug, adapter,
 *                                  formatter, register, search)
 *
 * ─── Grouped objects (one import, dot-access) ─────────────────────────────────
 *
 *   import { Reactive, Event, DOM } from './oja.js';
 *   Reactive.state(0)
 *   Event.on('.btn', 'click', handler)
 *   DOM.find('#app')
 *
 * ─── Out shorthands ───────────────────────────────────────────────────────────
 *
 *   Out.c()  → Out.component()
 *   Out.h()  → Out.html()
 *   Out.t()  → Out.text()
 */

export { timeout, interval, sleep, defer, withDefer }     from './js/core/system.js';

export { Store }                                          from './js/core/store.js';
export { state, effect, derived, batch, context,
    watch, untrack, readonly, signal }              from './js/core/reactive.js';

export { render, renderRaw, fill, each, template }        from './js/core/template.js';
export { Out, Responder }                                 from './js/core/out.js';
export { segment }                                        from './js/core/segment.js';
export { animate }                                        from './js/core/animate.js';

export { Router }                                         from './js/core/router.js';
export { component,
    container, props, ready,
}                                                         from './js/core/component.js';
export { currentContainer }                               from './js/core/_context.js';
export { layout, allSlotsReady }           from './js/core/layout.js';

export {
    ui,
    find, findAll, findAllIn,
    query, queryAll,
    make,
    createEl, empty, removeEl,
    afterEl, beforeEl, toggleEl,
    matches, closest,
}                                                         from './js/core/ui.js';

export {
    on, once, off, emit, listen, listenOnce, waitFor,
    debounce, throttle, rafThrottle,
    keys,
    onScroll, onScrollDirection, isInViewport, getViewportPosition,
    onVisible, onceVisible, unobserve, createVisibilityObserver,
    onResize, onMutation,
    onlyOnce,                    // was exported from events.js but missing from barrel
    onClickOutside, onHover, onLongPress,  //
}                                                         from './js/core/events.js';

export {
    engine,
    morph, shouldMorph,
    scan, unbind, enableAutoBind, disableAutoBind,
    bindText, bindHtml, bindClass, bindAttr, bindToggle,
    list, listAsync,
    nextFrame,
    formatters,
}                                                         from './js/core/engine.js';

export { Api }                                            from './js/core/api.js';
export { runtime }                                        from './js/core/runtime.js';

export { JsonCodec, jsonCodec }                           from './js/core/codecs/json.js';
export { MsgPackCodec }                                   from './js/core/codecs/msgpack.js';

export { plugin }                                         from './js/core/plugin.js';

export const VERSION = '0.0.1';

import { timeout, interval, sleep, defer, withDefer }    from './js/core/system.js';
import { state, effect, derived, batch, context,
    watch, untrack, readonly, signal }                   from './js/core/reactive.js';
import { on, once, off, emit, listen, listenOnce, waitFor,
    debounce, throttle, rafThrottle, keys,
    onScroll, onScrollDirection, isInViewport, getViewportPosition,
    onVisible, onceVisible, unobserve, createVisibilityObserver,
    onResize, onMutation,
    onlyOnce, onClickOutside, onHover, onLongPress }      from './js/core/events.js';
import { ui, find, findAll, findAllIn, query, queryAll,
    make,
    createEl, empty, removeEl,
    afterEl, beforeEl, toggleEl,
    matches, closest }                                    from './js/core/ui.js';
import { Store }                                         from './js/core/store.js';
import { render, renderRaw, fill, each, template }       from './js/core/template.js';
import { Out, Responder }                                from './js/core/out.js';
import { Api }                                           from './js/core/api.js';
import { JsonCodec, jsonCodec }                          from './js/core/codecs/json.js';
import { MsgPackCodec }                                  from './js/core/codecs/msgpack.js';
import { Router }                                        from './js/core/router.js';
import { component }                                     from './js/core/component.js';
import { layout, allSlotsReady }                         from './js/core/layout.js';
import { segment }                                       from './js/core/segment.js';
import { animate }                                       from './js/core/animate.js';
import { engine }                                        from './js/core/engine.js';
import { plugin }                                        from './js/core/plugin.js';

export const Reactive = { state, effect, derived, batch, context, watch, untrack, readonly };

export const Event = {
    on, once, off, emit, listen, listenOnce, waitFor,
    debounce, throttle, rafThrottle, keys,
    onScroll, onScrollDirection, isInViewport, getViewportPosition,
    onVisible, onceVisible, unobserve, createVisibilityObserver,
    onResize, onMutation,
    onlyOnce, onClickOutside, onHover, onLongPress,
};

export const DOM = {
    ui,
    find, findAll, findAllIn,
    query, queryAll,
    make,
    createEl, empty, removeEl,
    afterEl, beforeEl, toggleEl,
    matches, closest,
};

export const Oja = {
    // System
    timeout, interval, sleep, defer, withDefer,
    // State
    Store, state, effect, derived, batch, context,
    // Rendering
    Out, Responder, render, renderRaw, fill, each, template,
    segment, animate,
    // Routing
    Router, component, layout, allSlotsReady,
    // DOM
    DOM, ui,
    find, findAll, findAllIn,
    query, queryAll,
    make,
    createEl, empty, removeEl,
    afterEl, beforeEl, toggleEl,
    matches, closest,
    // Events
    Event,
    on, once, off, emit, listen, listenOnce, waitFor,
    debounce, throttle, rafThrottle, keys,
    onScroll, onScrollDirection, isInViewport, getViewportPosition,
    onVisible, onceVisible, unobserve, createVisibilityObserver,
    onResize, onMutation,
    // Engine
    engine,
    // Network & Codecs
    Api, JsonCodec, jsonCodec, MsgPackCodec,
    // Plugin
    plugin,
    // Reactive grouped
    Reactive,
    // Version
    version: VERSION,
};
