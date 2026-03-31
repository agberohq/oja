/**
 * oja/runner.js
 * Persistent background worker with typed message protocol.
 *
 * A Runner is a long-lived worker that owns its own state for the lifetime
 * of the application. Unlike OjaWorker (run a function once) or Channel
 * (pipe data between tasks), Runner is for infrastructure that needs to
 * stay alive, maintain internal state, and respond to messages over time.
 *
 * Used by vfs.js internally. Available for any extension that needs a
 * dedicated background process — game engines, long-running simulations,
 * persistent connections, etc.
 *
 * ─── Three communication patterns ────────────────────────────────────────────
 *
 *   runner.send('write', data)         — fire and forget, no wait
 *   await runner.post('write', data)   — resolves when worker receives it
 *   await runner.request('read', data) — resolves when worker replies
 *
 * ─── Usage ───────────────────────────────────────────────────────────────────
 *
 *   import { Runner } from '../oja/src/js/core/runner.js';
 *
 *   const worker = new Runner((self) => {
 *       let count = 0;
 *
 *       self.on('increment', (data) => {
 *           count += data.by ?? 1;
 *           self.reply('incremented', { count });
 *       });
 *
 *       self.on('get', (data) => {
 *           self.reply('value', { count });
 *       });
 *   });
 *
 *   // Fire and forget
 *   worker.send('increment', { by: 5 });
 *
 *   // Await acknowledgement (worker received the message)
 *   await worker.post('increment', { by: 1 });
 *
 *   // Await full response (worker processed and replied)
 *   const { count } = await worker.request('get');
 *
 *   // Listen to worker events
 *   worker.on('incremented', ({ count }) => console.log('count is now', count));
 *
 *   // Shut down
 *   worker.close();
 */

// Runs inside the Worker thread. Serialised to a blob so no separate file
// is needed — same pattern used by channel.js.

const WORKER_BOOTSTRAP = `
const _handlers  = new Map();
const _pendingAck = new Map();

// Public self API exposed to user-provided worker function
const _self = {
    // Register a handler for an incoming message type
    on(type, fn) {
        _handlers.set(type, fn);
    },

    // Send an event back to the main thread (no request/response pairing)
    reply(type, data) {
        postMessage({ _type: 'event', type, data: data ?? {} });
    },

    // Emit a raw message — used internally
    _emit(type, data) {
        postMessage({ _type: type, data: data ?? {} });
    },
};

onmessage = async (e) => {
    const { _type, _id, type, data } = e.data;

    // Acknowledgement ping — reply immediately before processing
    if (_type === 'post') {
        postMessage({ _type: 'ack', _id });
    }

    // Route to the registered handler
    const handler = _handlers.get(type);
    if (!handler) {
        if (_type === 'request') {
            postMessage({ _type: 'response', _id, error: 'No handler for: ' + type });
        }
        return;
    }

    try {
        const result = await handler(data ?? {});

        if (_type === 'request') {
            postMessage({ _type: 'response', _id, data: result ?? {} });
        }
    } catch (err) {
        const message = err?.message ?? String(err);
        postMessage({ _type: 'error', _id, type, message });

        if (_type === 'request') {
            postMessage({ _type: 'response', _id, error: message });
        }
    }
};

// User-provided worker function is injected below
`;


export class Runner {
    #worker   = null;
    #handlers = new Map();   // type → Set of listener functions (main thread)
    #pending  = new Map();   // _id  → { resolve, reject } for request/post
    #nextId   = 0;
    #blobUrl  = null;
    #closed   = false;

    /**
     * Create a persistent background runner.
     *
     * @param {Function} workerFn — function that runs inside the worker.
     *   Receives a `self` object with `.on(type, fn)` and `.reply(type, data)`.
     *   The function is serialised to a string — it cannot close over outer scope.
     */
    constructor(workerFn) {
        if (typeof workerFn !== 'function') {
            throw new Error('[oja/runner] workerFn must be a function');
        }

        const src = WORKER_BOOTSTRAP + '\n;(' + workerFn.toString() + ')(_self);\n';
        const blob = new Blob([src], { type: 'text/javascript' });

        this.#blobUrl = URL.createObjectURL(blob);
        this.#worker  = new Worker(this.#blobUrl, { type: 'classic' });

        this.#worker.onmessage = (e) => this.#route(e.data);
        this.#worker.onerror   = (e) => {
            console.error('[oja/runner] worker error:', e.message);
            this.#rejectAll(e.message);
        };
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * Fire and forget — send a message to the worker, do not wait.
     * Use for writes and operations where you don't need confirmation.
     *
     *   runner.send('write', { path: 'index.html', content: html });
     */
    send(type, data = {}) {
        this._assertOpen();
        this.#worker.postMessage({ _type: 'send', type, data });
    }

    /**
     * Send and await acknowledgement — resolves when the worker receives
     * the message, before processing is complete.
     * Use when you need backpressure awareness but not the result.
     *
     *   await runner.post('write', { path: 'index.html', content: html });
     */
    post(type, data = {}) {
        this._assertOpen();
        return new Promise((resolve, reject) => {
            const id = this.#id();
            this.#pending.set(id, { resolve, reject, type: 'ack' });
            this.#worker.postMessage({ _type: 'post', _id: id, type, data });
        });
    }

    /**
     * Send and await full response — resolves when the worker has processed
     * the message and called self.reply() or returned a value from the handler.
     * Use for reads and queries where you need data back.
     *
     *   const { content } = await runner.request('read', { path: 'index.html' });
     */
    request(type, data = {}) {
        this._assertOpen();
        return new Promise((resolve, reject) => {
            const id = this.#id();
            this.#pending.set(id, { resolve, reject, type: 'response' });
            this.#worker.postMessage({ _type: 'request', _id: id, type, data });
        });
    }

    /**
     * Listen for events emitted by the worker via self.reply().
     * Returns an unsubscribe function.
     *
     *   const off = runner.on('written', ({ path }) => console.log(path));
     *   off(); // stop listening
     */
    on(type, fn) {
        if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
        this.#handlers.get(type).add(fn);
        return () => this.#handlers.get(type)?.delete(fn);
    }

    /**
     * Terminate the worker and release resources.
     */
    close() {
        if (this.#closed) return;
        this.#closed = true;
        this.#worker.terminate();
        URL.revokeObjectURL(this.#blobUrl);
        this.#rejectAll('Runner closed');
        this.#pending.clear();
        this.#handlers.clear();
    }

    get closed() { return this.#closed; }

    // ─── Internal ─────────────────────────────────────────────────────────────

    #route(msg) {
        const { _type, _id, type, data, error, message } = msg;

        // Acknowledgement — resolves post()
        if (_type === 'ack') {
            const p = this.#pending.get(_id);
            if (p?.type === 'ack') {
                this.#pending.delete(_id);
                p.resolve();
            }
            return;
        }

        // Response — resolves request()
        if (_type === 'response') {
            const p = this.#pending.get(_id);
            if (p?.type === 'response') {
                this.#pending.delete(_id);
                if (error) p.reject(new Error(error));
                else       p.resolve(data);
            }
            return;
        }

        // Event — triggers runner.on() listeners
        if (_type === 'event') {
            const listeners = this.#handlers.get(type);
            if (listeners) listeners.forEach(fn => fn(data));
            return;
        }

        // Worker-reported error
        if (_type === 'error') {
            const listeners = this.#handlers.get('error');
            if (listeners) listeners.forEach(fn => fn({ type, message }));
            else console.error(`[oja/runner] unhandled worker error in "${type}":`, message);
        }
    }

    #id() {
        return `r_${++this.#nextId}_${Date.now()}`;
    }

    #rejectAll(reason) {
        for (const [id, p] of this.#pending) {
            p.reject(new Error(reason));
        }
        this.#pending.clear();
    }

    _assertOpen() {
        if (this.#closed) throw new Error('[oja/runner] Runner is closed');
    }
}