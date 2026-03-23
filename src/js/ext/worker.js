/**
 * oja/worker.js
 * Inline Web Worker — no separate file needed.
 * Define your worker function directly in your page script.
 *
 * ─── The constraint ───────────────────────────────────────────────────────────
 *
 *   The worker function runs in a completely isolated thread.
 *   It CANNOT access variables, state, or imports from the outer scope.
 *   Treat it as if it were a separate file — it is serialized as a string.
 *
 *   ✗ WRONG — outer variable will be undefined in worker:
 *     const multiplier = 2;
 *     const w = new OjaWorker((self) => {
 *         self.handle('double', (n) => n * multiplier); // multiplier = undefined
 *     });
 *
 *   ✓ RIGHT — self-contained:
 *     const w = new OjaWorker((self) => {
 *         const multiplier = 2; // defined inside
 *         self.handle('double', (n) => n * multiplier);
 *     });
 *
 * ─── Request / response ───────────────────────────────────────────────────────
 *
 *   const worker = new OjaWorker((self) => {
 *       self.handle('compress', async (data) => {
 *           // heavy work — runs off main thread
 *           return compress(data);
 *       });
 *
 *       self.handle('resize', async ({ buffer, width, height }) => {
 *           return resizeImageBuffer(buffer, width, height);
 *       });
 *   });
 *
 *   // Main thread — returns a Promise
 *   const compressed = await worker.call('compress', rawData);
 *   const resized    = await worker.call('resize', { buffer, width: 800, height: 600 });
 *
 * ─── Fire and forget ──────────────────────────────────────────────────────────
 *
 *   worker.send('logEvent', { event: 'pageview' }); // no await needed
 *
 * ─── Transferable objects (zero-copy) ────────────────────────────────────────
 *
 *   // Pass ArrayBuffers without copying — much faster for large data
 *   const result = await worker.call('process', buffer, [buffer]);
 *   //                                                   ↑ transfer list
 *
 * ─── Reactive state integration ──────────────────────────────────────────────
 *
 *   // State lives on the main thread. Worker is a pure processing unit.
 *   // Pattern: extract data → send to worker → receive result → update state
 *
 *   const [result, setResult] = state(null);
 *   const [status, setStatus] = state('idle');
 *
 *   on('#upload', 'change', async (e, el) => {
 *       const buffer = await el.files[0].arrayBuffer();
 *       setStatus('processing');
 *       const output = await worker.call('makeItMagic', buffer, [buffer]);
 *       setResult(output);   // triggers effect → DOM updates
 *       setStatus('done');
 *   });
 *
 *   // Cleanup when page navigates away
 *   component.onUnmount(() => worker.close());
 *
 * ─── Loading external scripts ─────────────────────────────────────────────────
 *
 *   // Pass CDN URLs via options.scripts — loaded before handlers run.
 *   // This is the recommended alternative to calling self.importScripts()
 *   // inside the worker function body (which is easy to forget and hard to debug).
 *
 *   const markdownWorker = new OjaWorker(
 *       (self) => {
 *           // marked is already loaded — no importScripts needed here
 *           marked.setOptions({ gfm: true });
 *           self.handle('parse', (content) => marked.parse(content));
 *       },
 *       {
 *           scripts: ['https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js'],
 *           name: 'markdown-parser',
 *       }
 *   );
 */

import { debug } from '../utils/debug.js';

// ─── Worker bootstrap code ───────────────────────────────────────────────────
// This string runs inside the Worker thread. It sets up the self.handle()
// and self.send() API that the user's worker function interacts with.

const WORKER_BOOTSTRAP = `
const _handlers = new Map();
const _api = {
    handle(type, fn) {
        _handlers.set(type, fn);
    },
    send(type, data, transfer = []) {
        self.postMessage({ type: '__event__', eventType: type, data }, transfer);
    }
};

self.onmessage = async (e) => {
    const { id, type, data } = e.data;

    if (type === '__ping__') {
        self.postMessage({ id, type: '__pong__' });
        return;
    }

    const handler = _handlers.get(type);
    if (!handler) {
        self.postMessage({
            id,
            type  : '__error__',
            error : 'No handler for: ' + type
        });
        return;
    }

    try {
        const result   = await handler(data);
        const transfer = result instanceof ArrayBuffer ? [result]
            : result instanceof Uint8Array            ? [result.buffer]
            : [];
        self.postMessage({ id, type: '__result__', result }, transfer);
    } catch (err) {
        self.postMessage({ id, type: '__error__', error: err.message });
    }
};
`;

// ─── OjaWorker ────────────────────────────────────────────────────────────────

export class OjaWorker {
    /**
     * Create an inline Web Worker from a function.
     *
     * @param {Function} workerFn — function that runs in the worker thread.
     *   Receives a `self` object with:
     *     self.handle(type, fn)          — register a message handler
     *     self.send(type, data, transfer) — push an event to main thread
     *
     *   ⚠️  Cannot access outer scope variables. Must be self-contained.
     *
     * @param {Object} options
     *   name     : string    — debug name shown in console and debug timeline
     *   scripts  : string[]  — URLs to load via importScripts() before handlers run
     *                          Use for CDN libraries (marked, pako, etc.)
     *                          Example: { scripts: ['https://cdn.../marked.min.js'] }
     *   onEvent  : fn        — called when worker pushes an event via self.send()
     *   onError  : fn        — called on unhandled worker errors
     */
    constructor(workerFn, options = {}) {
        this._name     = options.name    || `worker-${Math.random().toString(36).slice(2, 8)}`;
        this._onEvent  = options.onEvent || null;
        this._onError  = options.onError || null;
        this._pending  = new Map();  // id → { resolve, reject }
        this._nextId   = 0;
        this._closed   = false;

        // Prepend importScripts() calls for any scripts listed in options.scripts.
        // These execute before the user's worker function, so libraries are
        // available when self.handle() handlers are registered.
        const scripts = Array.isArray(options.scripts) ? options.scripts : [];
        const importBlock = scripts.length
            ? `importScripts(${scripts.map(s => JSON.stringify(s)).join(', ')});\n`
            : '';

        // Serialize the worker function and combine with bootstrap
        const fnBody = workerFn.toString();
        const src    = `${importBlock}${WORKER_BOOTSTRAP}\n;(${fnBody})(_api);`;
        const blob   = new Blob([src], { type: 'text/javascript' });
        const url    = URL.createObjectURL(blob);

        this._worker = new Worker(url);

        // Revoke immediately — this is safe for CLASSIC Worker scripts.
        // The Worker constructor synchronously reads the blob URL before
        // returning, so it is safe to revoke right after construction.
        // (This differs from module scripts loaded via <script type="module">
        // which are fetched asynchronously — those need a delayed revoke,
        // which is why _exec.js uses a 5s setTimeout for component scripts.)
        URL.revokeObjectURL(url);

        this._worker.onmessage = (e) => this._onMessage(e.data);
        this._worker.onerror   = (e) => this._onWorkerError(e);

        debug.log('worker', 'created', { name: this._name });
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * Send a message and wait for the result.
     * Returns a Promise that resolves with the handler's return value.
     *
     *   const result = await worker.call('compress', data);
     *   const result = await worker.call('process', buffer, [buffer]); // zero-copy
     *
     * @param {string}   type      — handler name registered via self.handle()
     * @param {any}      data      — data to send
     * @param {Array}    transfer  — Transferable objects (ArrayBuffers) for zero-copy
     */
    call(type, data, transfer = []) {
        if (this._closed) return Promise.reject(new Error(`[oja/worker] "${this._name}" is closed`));

        return new Promise((resolve, reject) => {
            const id = this._nextId++;
            this._pending.set(id, { resolve, reject });
            this._worker.postMessage({ id, type, data }, transfer);
            debug.log('worker', 'call', { name: this._name, type });
        });
    }

    /**
     * Send a message without waiting for a response — fire and forget.
     *
     *   worker.send('logEvent', { event: 'pageview', path: '/hosts' });
     *
     * @param {string}  type      — handler name
     * @param {any}     data      — data to send
     * @param {Array}   transfer  — Transferable objects for zero-copy
     */
    send(type, data, transfer = []) {
        if (this._closed) {
            console.warn(`[oja/worker] "${this._name}" is closed — send ignored`);
            return this;
        }
        const id = this._nextId++;
        this._worker.postMessage({ id, type, data }, transfer);
        debug.log('worker', 'send', { name: this._name, type });
        return this;
    }

    /**
     * Terminate the worker. In-flight calls will reject.
     * Always call this in component.onUnmount() to avoid memory leaks.
     *
     *   component.onUnmount(() => worker.close());
     */
    close() {
        if (this._closed) return;
        this._closed = true;
        this._worker.terminate();

        // Reject any pending calls
        for (const [, { reject }] of this._pending) {
            reject(new Error(`[oja/worker] "${this._name}" was closed`));
        }
        this._pending.clear();
        debug.log('worker', 'closed', { name: this._name });
    }

    get closed() { return this._closed; }

    // ─── Internal ─────────────────────────────────────────────────────────────

    _onMessage(msg) {
        const { id, type, result, error, eventType, data } = msg;

        // Worker pushed an event via self.send() — not a response to a call
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

        // Reject all pending calls
        for (const [, { reject }] of this._pending) reject(err);
        this._pending.clear();
    }
}