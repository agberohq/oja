/**
 * oja/worker.js
 * Inline Web Worker — no separate file needed.
 * Define your worker function directly in your page script.
 *
 * ─── Three worker modes ───────────────────────────────────────────────────────
 *
 *   'classic'        (default) — fn serialised into a blob: URL classic Worker.
 *                    Works in all browsers. Blocked by strict blob: CSP (Tauri default).
 *
 *   'module'         — points at a real .js file via its URL. No serialisation,
 *                    no blob:, full ES module support (import/export inside worker).
 *                    Requires options.url.
 *
 *   'inline-module'  — fn serialised into a data: URL ES module Worker.
 *                    Bypasses blob: CSP. Works in Tauri. Requires module Worker support
 *                    (Chrome 80+, Firefox 114+, Safari 15+).
 *                    Falls back to classic if not supported.
 *
 *   'auto'           (default) — uses inline-module when supported + no scripts,
 *                    otherwise classic.
 *
 * ─── Basic usage (unchanged from before) ─────────────────────────────────────
 *
 *   const worker = new OjaWorker((self) => {
 *       self.handle('compress', async (data) => compress(data));
 *   });
 *   const result = await worker.call('compress', rawData);
 *   worker.send('logEvent', { event: 'pageview' });
 *   component.onUnmount(() => worker.close());
 *
 * ─── Explicit inline-module (Tauri-safe) ─────────────────────────────────────
 *
 *   const worker = new OjaWorker(
 *       (self) => { self.handle('parse', (md) => marked.parse(md)); },
 *       { type: 'inline-module' }
 *   );
 *
 * ─── Module worker — real file, full ES imports inside worker ─────────────────
 *
 *   // workers/parser.js
 *   export default function(self) {
 *       self.handle('parse', (md) => marked.parse(md));
 *   }
 *
 *   // app.js
 *   const parser = new OjaWorker(null, {
 *       type: 'module',
 *       url:  new URL('./workers/parser.js', import.meta.url).href,
 *   });
 *
 * ─── Loading scripts (classic mode) ──────────────────────────────────────────
 *
 *   const worker = new OjaWorker(
 *       (self) => {
 *           marked.setOptions({ gfm: true });
 *           self.handle('parse', (md) => marked.parse(md));
 *       },
 *       { scripts: ['https://cdn.../marked.min.js'] }
 *   );
 *
 * ─── Detect available modes ───────────────────────────────────────────────────
 *
 *   const { classic, module: mod, inlineModule } = OjaWorker.detect();
 */

import { debug }   from '../utils/debug.js';
import { runtime } from '../core/runtime.js';


// Classic bootstrap — runs as a top-level classic worker script.
// Uses bare `onmessage =` so the WorkerShim in tests captures it correctly.
const BOOTSTRAP_CLASSIC = `
const _handlers = new Map();
const _api = {
    handle(type, fn) { _handlers.set(type, fn); },
    send(type, data, transfer = []) {
        postMessage({ type: '__event__', eventType: type, data }, transfer);
    },
};

onmessage = self.onmessage = async (e) => {
    const { id, type, data } = e.data;
    if (type === '__ping__') { postMessage({ id, type: '__pong__' }); return; }
    const handler = _handlers.get(type);
    if (!handler) {
        postMessage({ id, type: '__error__', error: 'No handler for: ' + type });
        return;
    }
    try {
        const result   = await handler(data);
        const transfer = result instanceof ArrayBuffer ? [result]
                       : result instanceof Uint8Array  ? [result.buffer]
                       : [];
        postMessage({ id, type: '__result__', result }, transfer);
    } catch (err) {
        postMessage({ id, type: '__error__', error: err.message });
    }
};
`;

// Module bootstrap — wraps user fn or file import in an ES module worker.
// Used by both inline-module and module modes.
function _moduleBootstrap(innerSrc) {
    return `
const _handlers = new Map();
const _api = {
    handle(type, fn) { _handlers.set(type, fn); },
    send(type, data, transfer = []) {
        postMessage({ type: '__event__', eventType: type, data }, transfer);
    },
};

self.onmessage = async (e) => {
    const { id, type, data } = e.data;
    if (type === '__ping__') { postMessage({ id, type: '__pong__' }); return; }
    const handler = _handlers.get(type);
    if (!handler) {
        postMessage({ id, type: '__error__', error: 'No handler for: ' + type });
        return;
    }
    try {
        const result   = await handler(data);
        const transfer = result instanceof ArrayBuffer ? [result]
                       : result instanceof Uint8Array  ? [result.buffer]
                       : [];
        postMessage({ id, type: '__result__', result }, transfer);
    } catch (err) {
        postMessage({ id, type: '__error__', error: err.message });
    }
};

${innerSrc}
`;
}


let _detectionCache = null;

function _detect() {
    if (_detectionCache) return _detectionCache;

    // Classic: blob: Worker. Works everywhere, blocked by strict blob: CSP.
    let classic = false;
    try {
        const b = new Blob(['self.onmessage=()=>{}'], { type: 'text/javascript' });
        const u = URL.createObjectURL(b);
        URL.revokeObjectURL(u);
        classic = true;
    } catch (_) {}

    // Detect whether we are running under a test shim that intercepts
    // URL.createObjectURL(). The jsdom/Vitest shim in setup.js returns URLs
    // with the prefix 'blob:shim-'; real browsers return 'blob:http://...' or
    // 'blob:null/...'. We use this to avoid falsely reporting inline-module
    // support when the shim would mishandle data: URL workers.
    let isShimEnvironment = false;
    try {
        const b = new Blob([''], { type: 'text/javascript' });
        const u = URL.createObjectURL(b);
        isShimEnvironment = u.startsWith('blob:shim');
        URL.revokeObjectURL(u);
    } catch (_) {}

    // Module Worker support — only meaningful outside the test shim.
    // data: URL module Workers require the real Worker implementation.
    let moduleSupport = false;
    if (!isShimEnvironment) {
        try {
            const w = new Worker('data:text/javascript,', { type: 'module' });
            w.terminate();
            moduleSupport = true;
        } catch (_) {
            // TypeError = module Workers not supported at all.
            // Other errors (DOMException for CSP, etc.) = supported but restricted.
            moduleSupport = !(_ instanceof TypeError);
        }
    }

    const inlineModule = moduleSupport;
    _detectionCache = { classic, module: moduleSupport, inlineModule };
    return _detectionCache;
}

/**
 * Reset the detection cache. Used in tests to re-probe after environment changes.
 * Not part of the public API — do not call from application code.
 * @internal
 */
export function _resetWorkerDetectionCache() {
    _detectionCache = null;
}


function _buildClassicWorker(workerFn, scripts, name) {
    const importBlock = scripts.length
        ? `importScripts(${scripts.map(s => JSON.stringify(s)).join(', ')});\n`
        : '';
    const src  = `${importBlock}${BOOTSTRAP_CLASSIC}\n;(${workerFn.toString()})(_api);`;
    const blob = new Blob([src], { type: 'text/javascript' });
    const url  = URL.createObjectURL(blob);
    // Safe to revoke immediately for classic workers — browser reads source synchronously.
    // (Module workers load asynchronously so we cannot revoke at construction time.)
    const w    = new Worker(url);
    URL.revokeObjectURL(url);
    debug.log('worker', 'created:classic', { name });
    return w;
}

function _buildInlineModuleWorker(workerFn, name) {
    const inner = `;(${workerFn.toString()})(_api);`;
    const src   = _moduleBootstrap(inner);
    const url   = `data:text/javascript;charset=utf-8,${encodeURIComponent(src)}`;
    const w     = new Worker(url, { type: 'module' });
    debug.log('worker', 'created:inline-module', { name });
    return w;
}

function _buildModuleWorker(fileUrl, name) {
    // User's file must export default function(self) { ... }
    // We wrap it in a bootstrap module that provides the _api object.
    const inner = `
import _userFn from ${JSON.stringify(fileUrl)};
_userFn(_api);
`;
    const src = _moduleBootstrap(inner);
    const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(src)}`;
    const w   = new Worker(url, { type: 'module' });
    debug.log('worker', 'created:module', { name, fileUrl });
    return w;
}


export class OjaWorker {
    /**
     * @param {Function|null} workerFn
     *   Self-contained function to run in the worker. Cannot access outer scope.
     *   Pass null when using type:'module' with a real file URL.
     *
     * @param {Object} [options]
     *   name     : string     — debug name
     *   type     : 'classic' | 'module' | 'inline-module' | 'auto'
     *              Default: 'auto' — prefers inline-module, falls back to classic.
     *   url      : string     — worker file URL (required for type:'module')
     *   scripts  : string[]   — CDN scripts loaded via importScripts() (classic only)
     *   onEvent  : fn         — called when worker uses self.send()
     *   onError  : fn         — called on unhandled worker errors
     */
    constructor(workerFn, options = {}) {
        this._name    = options.name    || `worker-${Math.random().toString(36).slice(2, 8)}`;
        this._onEvent = options.onEvent || null;
        this._onError = options.onError || null;
        this._pending = new Map();
        this._nextId  = 0;
        this._closed  = false;

        const scripts  = Array.isArray(options.scripts) ? options.scripts : [];
        const modeOpt  = options.type || 'auto';
        const support  = _detect();

        // ── Security ──────────────────────────────────────────────────────────
        for (const s of scripts) {
            if (!runtime.isOriginAllowed(s)) {
                throw new Error(`[oja/worker] "${this._name}" blocked origin: ${s}`);
            }
        }

        // ── Mode resolution ───────────────────────────────────────────────────
        let mode = modeOpt;

        if (mode === 'auto') {
            // inline-module is preferred: no blob: needed, no importScripts.
            // Fall back to classic when scripts are required (importScripts = classic only)
            // or when inline-module isn't supported.
            mode = (support.inlineModule && !scripts.length) ? 'inline-module' : 'classic';
        }

        // Sandbox upgrades classic → inline-module where possible
        if (runtime.isSandboxed() && mode === 'classic') {
            if (support.inlineModule && !scripts.length) {
                mode = 'inline-module'; // silent upgrade
            } else {
                throw new Error(
                    `[oja/worker] "${this._name}" blocked in sandbox. ` +
                    `Use type:'inline-module' or type:'module'.`
                );
            }
        }

        // scripts are only supported in classic mode
        if (scripts.length > 0 && mode !== 'classic') {
            throw new Error(
                `[oja/worker] "${this._name}" options.scripts requires type:'classic'. ` +
                `Module workers use ES imports inside the worker file instead.`
            );
        }

        this._mode = mode;

        // ── Construct ─────────────────────────────────────────────────────────
        if (mode === 'classic') {
            if (!workerFn) throw new TypeError(`[oja/worker] "${this._name}" classic mode requires a workerFn`);
            this._worker = _buildClassicWorker(workerFn, scripts, this._name);

        } else if (mode === 'inline-module') {
            if (!workerFn) throw new TypeError(`[oja/worker] "${this._name}" inline-module mode requires a workerFn`);
            if (!support.inlineModule) {
                // Graceful degradation
                debug.log('worker', 'inline-module unsupported — degrading to classic', { name: this._name });
                this._worker = _buildClassicWorker(workerFn, [], this._name);
                this._mode   = 'classic';
            } else {
                this._worker = _buildInlineModuleWorker(workerFn, this._name);
            }

        } else if (mode === 'module') {
            if (!options.url) throw new TypeError(`[oja/worker] "${this._name}" type:'module' requires options.url`);
            if (!support.module) throw new Error(`[oja/worker] "${this._name}" module Workers not supported`);
            this._worker = _buildModuleWorker(options.url, this._name);

        } else {
            throw new TypeError(`[oja/worker] "${this._name}" unknown type: "${modeOpt}"`);
        }

        this._worker.onmessage = (e) => this._onMessage(e.data);
        this._worker.onerror   = (e) => this._onWorkerError(e);
        debug.log('worker', `mode:${this._mode}`, { name: this._name });
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /** Send a message, get a Promise for the result. */
    call(type, data, transfer = []) {
        if (this._closed) return Promise.reject(new Error(`[oja/worker] "${this._name}" is closed`));
        return new Promise((resolve, reject) => {
            const id = this._nextId++;
            this._pending.set(id, { resolve, reject });
            this._worker.postMessage({ id, type, data }, transfer);
            debug.log('worker', 'call', { name: this._name, type });
        });
    }

    /** Fire and forget — no response. */
    send(type, data, transfer = []) {
        if (this._closed) { console.warn(`[oja/worker] "${this._name}" is closed — send ignored`); return this; }
        this._worker.postMessage({ id: this._nextId++, type, data }, transfer);
        debug.log('worker', 'send', { name: this._name, type });
        return this;
    }

    /** Terminate. In-flight calls reject. Call from component.onUnmount(). */
    close() {
        if (this._closed) return;
        this._closed = true;
        this._worker.terminate();
        for (const [, { reject }] of this._pending) reject(new Error(`[oja/worker] "${this._name}" was closed`));
        this._pending.clear();
        debug.log('worker', 'closed', { name: this._name });
    }

    /** True if the worker has been terminated. */
    get closed() { return this._closed; }

    /**
     * The resolved mode actually used — 'classic', 'inline-module', or 'module'.
     * Useful for debugging and Tauri compatibility checks.
     */
    get mode() { return this._mode; }

    /**
     * Detect which modes are available in the current environment.
     *   const { classic, module: mod, inlineModule } = OjaWorker.detect();
     */
    static detect() { return _detect(); }

    // ─── Internal ─────────────────────────────────────────────────────────────

    _onMessage(msg) {
        const { id, type, result, error, eventType, data } = msg;
        if (type === '__event__') {
            if (this._onEvent) this._onEvent(eventType, data);
            debug.log('worker', 'event', { name: this._name, eventType });
            return;
        }
        const pending = this._pending.get(id);
        if (!pending) return;
        this._pending.delete(id);
        if (type === '__result__') {
            pending.resolve(result);
            debug.log('worker', 'result', { name: this._name });
        } else if (type === '__error__') {
            const err = new Error(error);
            if (this._onError) this._onError(err);
            pending.reject(err);
            debug.log('worker', 'error', { name: this._name, error });
        }
    }

    _onWorkerError(e) {
        const err = new Error(`[oja/worker] "${this._name}": ${e.message}`);
        console.error(err);
        if (this._onError) this._onError(err);
        for (const [, { reject }] of this._pending) reject(err);
        this._pending.clear();
    }
}