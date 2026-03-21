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
 *   import { Router }    from '../oja/src/js/core/router.js';
 *   import { Out }       from '../oja/src/js/core/out.js';
 *   import { state }     from '../oja/src/js/core/reactive.js';
 *   import { engine }    from '../oja/src/js/core/engine.js';
 *   import { modal }     from '../oja/src/js/ui/modal.js';
 *   import { notify }    from '../oja/src/js/ui/notify.js';
 *   import { form }      from '../oja/src/js/ui/form.js';
 *   import { validate }  from '../oja/src/js/ui/validate.js';
 *   import { auth }      from '../oja/src/js/ext/auth.js';
 *   import { encrypt }   from '../oja/src/js/utils/encrypt.js';
 *   import { formatter } from '../oja/src/js/utils/formatter.js';
 *
 * ─── Directory layout ─────────────────────────────────────────────────────────
 *
 *   js/core/    — kernel (store, reactive, events, engine, template, out,
 *                          component, _exec, router, layout, animate, ui, plugin)
 *   js/ui/      — UI patterns (modal, notify, form, validate,
 *                               canvas, clipboard, dragdrop, table, tabs)
 *   js/ext/     — opt-in features (auth, channel, config, history, sw,
 *                                   vfs, runner, chart, socket, worker, wasm…)
 *   js/utils/   — pure utilities (encrypt, logger, debug, adapter,
 *                                  formatter, register)
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
export { Out, Responder }                                 from './js/core/out.js';
export { Router }                                         from './js/core/router.js';
export { component }                                      from './js/core/component.js';
export { layout }                                         from './js/core/layout.js';
export { segment }                                        from './js/core/segment.js';
export { animate }                                        from './js/core/animate.js';
export { plugin }                                         from './js/core/plugin.js';

export {
    ui,
    find, findAll, findAllIn,
    createEl, empty, removeEl,
    afterEl, beforeEl, toggleEl,
    matches, closest,
}                                                         from './js/core/ui.js';

// ─── Network ──────────────────────────────────────────────────────────────────
export { Api }                                            from './js/core/api.js';

// ─── Codecs ───────────────────────────────────────────────────────────────────
export { JsonCodec, jsonCodec }                           from './js/core/codecs/json.js';
export { MsgPackCodec }                                   from './js/core/codecs/msgpack.js';

// ─── Events ───────────────────────────────────────────────────────────────────
export {
    on, once, off, emit, listen, listenOnce, waitFor,
    debounce, throttle, rafThrottle,
    keys,
    onScroll, onScrollDirection, isInViewport, getViewportPosition,
    onVisible, onceVisible, unobserve, createVisibilityObserver,
    onResize, onMutation,
}                                                         from './js/core/events.js';

// ─── Engine ───────────────────────────────────────────────────────────────────
export {
    engine,
    morph, shouldMorph,
    scan, unbind, enableAutoBind, disableAutoBind,
    bindText, bindHtml, bindClass, bindAttr, bindToggle,
    list, listAsync,
    nextFrame,
    formatters,
}                                                         from './js/core/engine.js';

// ─── UI layer — js/ui/ ────────────────────────────────────────────────────────
export { modal }                                          from './js/ui/modal.js';
export { notify }                                         from './js/ui/notify.js';
export { form }                                           from './js/ui/form.js';
export { validate }                                       from './js/ui/validate.js';
export { autocomplete }                                   from './js/ui/autocomplete.js';

// ─── Extension layer — js/ext/ ────────────────────────────────────────────────
export { auth }                                           from './js/ext/auth.js';
export { OjaHistory, history }                            from './js/ext/history.js';
export { Channel, go, pipeline, fanOut, fanIn,
    merge, split }                                        from './js/ext/channel.js';
export { config }                                         from './js/ext/config.js';
export { Runner }                                         from './js/ext/runner.js';
export { VFS }                                            from './js/ext/vfs.js';
export { sw }                                             from './js/ext/sw.js';

// ─── Utilities — js/utils/ ────────────────────────────────────────────────────
export { encrypt }                                        from './js/utils/encrypt.js';
export { logger }                                         from './js/utils/logger.js';
export { debug }                                          from './js/utils/debug.js';
export { adapter }                                        from './js/utils/adapter.js';
export { Trie, Search }                                   from './js/utils/search.js';

export {
    uppercase, lowercase, capitalize, titleCase,
    toJson, toCompactJson,
    formatBytes, formatPercent,
    timeAgo, formatDate, formatTime,
    truncate, fallback,
    booleanStatus, booleanClass,
}                                                         from './js/utils/formatter.js';

export { events, register, strictMode, isRegistered, getRegistered }
    from './js/utils/register.js';

// ─── Version ──────────────────────────────────────────────────────────────────
export const VERSION = '0.0.1';

// ─── Grouped exports — one import, dot-access ─────────────────────────────────
import { state, effect, derived, batch, context }                    from './js/core/reactive.js';
import { on, once, off, emit, listen, listenOnce, waitFor,
    debounce, throttle, rafThrottle, keys,
    onScroll, onScrollDirection, isInViewport, getViewportPosition,
    onVisible, onceVisible, unobserve, createVisibilityObserver,
    onResize, onMutation }                                            from './js/core/events.js';
import { ui, find, findAll, findAllIn, createEl, empty, removeEl,
    afterEl, beforeEl, toggleEl, matches, closest }                  from './js/core/ui.js';
import { Store }                                                      from './js/core/store.js';
import { encrypt }                                                    from './js/utils/encrypt.js';
import { config }                                                     from './js/ext/config.js';
import { render, renderRaw, fill, each, template }                   from './js/core/template.js';
import { OjaHistory, history }                                        from './js/ext/history.js';
import { Out, Responder }                                             from './js/core/out.js';
import { Api }                                                        from './js/core/api.js';
import { JsonCodec, jsonCodec }                                       from './js/core/codecs/json.js';
import { MsgPackCodec }                                               from './js/core/codecs/msgpack.js';
import { Router }                                                     from './js/core/router.js';
import { component }                                                  from './js/core/component.js';
import { layout }                                                     from './js/core/layout.js';
import { segment }                                                    from './js/core/segment.js';
import { modal }                                                      from './js/ui/modal.js';
import { notify }                                                     from './js/ui/notify.js';
import { animate }                                                    from './js/core/animate.js';
import { form }                                                        from './js/ui/form.js';
import { validate }                                                    from './js/ui/validate.js';
import { autocomplete }                                                from './js/ui/autocomplete.js';
import { Trie, Search }                                                from './js/utils/search.js';
import { auth }                                                        from './js/ext/auth.js';
import { Channel, go, pipeline, fanOut, fanIn, merge, split }        from './js/ext/channel.js';
import { Runner }                                                     from './js/ext/runner.js';
import { VFS }                                                        from './js/ext/vfs.js';
import { plugin }                                                     from './js/core/plugin.js';
import { logger }                                                     from './js/utils/logger.js';
import { debug }                                                      from './js/utils/debug.js';
import { adapter }                                                    from './js/utils/adapter.js';
import { engine }                                                     from './js/core/engine.js';

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

export const Oja = {
    // Kernel
    Store,
    Reactive, Event, DOM,
    state, effect, derived, batch, context,
    render, renderRaw, fill, each, template,
    // Engine
    engine,
    // Display
    Out, Responder,
    // Network
    Api,
    // Codecs
    JsonCodec, jsonCodec, MsgPackCodec,
    // UI
    Router, component, layout, segment, modal, notify, animate,
    ui, find, findAll, findAllIn,
    createEl, empty, removeEl,
    afterEl, beforeEl, toggleEl,
    matches, closest,
    // Forms
    form, validate, autocomplete,
    // Search
    Trie, Search,
    // Events
    on, once, off, emit, listen, listenOnce, waitFor,
    debounce, throttle, rafThrottle, keys,
    onScroll, onScrollDirection, isInViewport, getViewportPosition,
    onVisible, onceVisible, unobserve, createVisibilityObserver,
    onResize, onMutation,
    // Ext
    auth, OjaHistory, history, config,
    Channel, go, pipeline, fanOut, fanIn, merge, split,
    Runner, VFS,
    // Utils
    encrypt, logger, debug, adapter,
    // Plugin
    plugin,
    // Version
    version: VERSION,
};