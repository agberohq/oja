/**
 * oja.full.js — full barrel (kernel + ui + ext + utils)
 *
 * Use this when you want everything in one import:
 *
 *   import { Router, Out, modal, chart, auth, pagination, uploader, analytics } from './oja.full.js';
 *
 * For production apps that care about bundle size, import from specific layers:
 *
 *   import { Router, Out }   from './oja.js';            — kernel only
 *   import { modal, notify } from './js/ui/modal.js';    — ui layer
 *   import { auth }          from './js/ext/auth.js';    — ext layer
 *   import { encrypt }       from './js/utils/encrypt.js';
 *
 * ─── What is in each layer ────────────────────────────────────────────────────
 *
 *   oja.js (kernel)
 *     System:    timeout, interval, sleep, defer, withDefer
 *     State:     Store, state, effect, derived, batch, context
 *     Rendering: Out, Responder, render, template, segment, animate
 *     Routing:   Router, component, layout
 *     DOM:       ui, find, findAll, query, queryAll, createEl …
 *     Events:    on, emit, listen, keys, debounce …
 *     Engine:    engine, morph, bindText, bindClass …
 *     Network:   Api
 *     Codecs:    JsonCodec, MsgPackCodec
 *     Plugin:    plugin
 *
 *   js/ui/  (UI patterns)
 *     modal, notify, clipboard, form, validate, autocomplete,
 *     table, tabs, canvas, dragdrop, popover, virtualList, mask,
 *     clickmenu, collapse, accordion, countdown, wizard
 *
 *   js/ext/ (opt-in features)
 *     auth, pagination, chart, history, channel, config,
 *     runner, VFS, sw, socket (OjaSSE, OjaSocket), OjaWorker, OjaWasm, webrtc,
 *     infiniteScroll, pullToRefresh, cssVars, lazy, exporter, OjaUploader, uploader,
 *     OjaAnalytics, analytics
 *
 *   js/utils/ (pure utilities)
 *     encrypt, logger, debug, adapter, search (Trie, Search),
 *     formatter, register
 */

export * from './oja.js';

export { modal }                                          from './js/ui/modal.js';
export { notify }                                         from './js/ui/notify.js';
export { clipboard }                                      from './js/ui/clipboard.js';
export { form }                                           from './js/ui/form.js';
export { validate }                                       from './js/ui/validate.js';
export { autocomplete }                                   from './js/ui/autocomplete.js';
export { table }                                          from './js/ui/table.js';
export { tabs }                                           from './js/ui/tabs.js';
export { canvas }                                         from './js/ui/canvas.js';
export { dragdrop }                                       from './js/ui/dragdrop.js';
export { popover }                                        from './js/ui/popover.js';
export { virtualList }                                    from './js/ui/virtual-list.js';
export { mask }                                           from './js/ui/mask.js';
export { clickmenu }                                          from './js/ui/clickmenu.js';
export { collapse, accordion }                                from './js/ui/collapse.js';
export { countdown }                                          from './js/ui/countdown.js';
export { wizard }                                             from './js/ui/wizard.js';

export { auth }                                           from './js/ext/auth.js';
export { pagination }                                     from './js/ext/pagination.js';
export { chart }                                          from './js/ext/chart.js';
export { OjaHistory, history }                            from './js/ext/history.js';
export { Channel, go, pipeline, fanOut, fanIn,
    merge, split }                                        from './js/ext/channel.js';
export { config }                                         from './js/ext/config.js';
export { Runner }                                         from './js/ext/runner.js';
export { VFS }                                            from './js/ext/vfs.js';
export { sw, send, post, syncVFS, clearVFS }                       from './js/ext/sw.js';
export { OjaSSE, OjaSocket }                              from './js/ext/socket.js';
export { OjaWorker }                                      from './js/ext/worker.js';
export { OjaWasm }                                        from './js/ext/wasm.js';
export { webrtc }                                         from './js/ext/webrtc.js';
export { infiniteScroll }                                 from './js/ext/infinitescroll.js';
export { pullToRefresh }                                  from './js/ext/pulltorefresh.js';
export { cssVars }                                        from './js/ext/cssvars.js';
export { lazy }                                           from './js/ext/lazy.js';
export { exporter }                                       from './js/ext/export.js';
export { OjaUploader, uploader }                          from './js/ext/uploader.js';
export { OjaAnalytics, analytics }                        from './js/ext/analytics.js';

export { encrypt }                                        from './js/utils/encrypt.js';
export { logger }                                         from './js/utils/logger.js';
export { debug }                                          from './js/utils/debug.js';
export { adapter }                                        from './js/utils/adapter.js';
export { progress }                                        from './js/utils/progress.js';
export { Trie, Search }                                   from './js/utils/search.js';
export {
    uppercase, lowercase, capitalize, titleCase,
    toJson, toCompactJson,
    formatBytes, formatPercent,
    timeAgo, formatDate, formatTime,
    truncate, fallback,
    booleanStatus, booleanClass,
}                                                         from './js/utils/formatter.js';
export { events, register, strictMode, isRegistered, getRegistered,
    emit as registryEmit, listen as registryListen }
    from './js/utils/register.js';