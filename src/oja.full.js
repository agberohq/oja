/**
 * oja.full.js — full barrel entry point (core + all plugins)
 *
 * Use this when you want everything including plugins:
 *   import { Router, Out, OjaSocket, OjaWorker, canvas } from '../oja/src/oja.full.js';
 *
 * For production apps that need tree-shaking, import from oja.js (core)
 * and import only the specific plugins you use:
 *   import { Router, Out }   from '../oja/src/oja.js';
 *   import { OjaSocket }     from '../oja/src/js/plugin/socket.js';
 *   import { infiniteScroll } from '../oja/src/js/plugin/infinitescroll.js';
 */

// ─── Everything in core ───────────────────────────────────────────────────────
export * from './oja.js';

// ─── Plugins ─────────────────────────────────────────────────────────────────
// These are opt-in — not every app needs them. Import individually for better
// tree-shaking, or use this barrel to get everything at once.

// Real-time (WebSocket + SSE)
export { OjaSSE, OjaSocket }                              from './js/plugin/socket.js';

// Concurrency (heavy — wasm, workers)
export { OjaWorker }                                      from './js/plugin/worker.js';
export { OjaWasm }                                        from './js/plugin/wasm.js';

// DOM utilities
export { cssVars }                                        from './js/plugin/cssvars.js';
export { lazy }                                           from './js/plugin/lazy.js';
export { clipboard }                                      from './js/ui/clipboard.js';
export { dragDrop }                                       from './js/ui/dragdrop.js';

// Data / visualisation
export { canvas }                                         from './js/plugin/canvas.js';
export { exportData }                                     from './js/plugin/export.js';

// Mobile / UX patterns
export { infiniteScroll }                                 from './js/plugin/infinitescroll.js';
export { pullToRefresh }                                  from './js/plugin/pulltorefresh.js';

// Communication
export { webrtc }                                         from './js/plugin/webrtc.js';