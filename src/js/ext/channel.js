/**
 * oja/channel.js
 * Go-style channels for coordinating async work in JavaScript.
 *
 * A Channel is a typed pipe between producers and consumers.
 * It can run in async mode (main thread coordination) or worker mode
 * (true parallel processing via Web Worker).
 *
 * Channel moves data. Worker runs code. They compose cleanly:
 *
 *   const ch     = new Channel({ buffer: 10, workers: true, name: 'images' });
 *   const worker = new Worker((self) => {
 *       self.handle('process', async (data) => doHeavyWork(data));
 *   });
 *
 *   // Producer — main thread feeds the channel
 *   await ch.send(imageBuffer);
 *
 *   // Consumer — worker drains it
 *   go(async () => {
 *       for await (const buffer of ch) {
 *           const result = await worker.call('process', buffer);
 *           setResult(result); // reactive state → DOM
 *       }
 *   });
 *
 * ─── Constructor options ──────────────────────────────────────────────────────
 *
 *   // Simple — just a buffer size
 *   new Channel(10)
 *
 *   // Async mode — main thread only, no workers
 *   new Channel({ buffer: 10, mode: 'async' })
 *
 *   // Worker mode — auto-detect optimal pool size
 *   new Channel({ buffer: 10, workers: true })
 *
 *   // Worker mode — specific pool size
 *   new Channel({ buffer: 10, workers: 4 })
 *
 *   // Named — appears in debug timeline and console logs
 *   new Channel({ buffer: 10, workers: true, name: 'image-pipeline' })
 *
 *   // With fallback — if workers unavailable, use async
 *   new Channel({ buffer: 10, mode: 'worker', fallback: 'async' })
 *
 * ─── Usage ────────────────────────────────────────────────────────────────────
 *
 *   const ch = new Channel({ buffer: 5, workers: true, name: 'jobs' });
 *
 *   // Send — like ch <- value in Go
 *   await ch.send({ type: 'resize', data: imageBuffer });
 *
 *   // Receive — like value, ok := <-ch in Go
 *   const { value, ok } = await ch.receive();
 *
 *   // Iterate — like for v := range ch in Go
 *   for await (const item of ch) {
 *       console.log(item);
 *   }
 *
 *   // Close when done — signals consumers to stop
 *   ch.close();
 *
 * ─── Concurrency primitives ───────────────────────────────────────────────────
 *
 *   // go — run async function as a lightweight concurrent task
 *   go(async () => {
 *       for await (const job of ch) { await processJob(job); }
 *   });
 *
 *   // pipeline — chain processing stages
 *   const output = pipeline([resize, compress, upload], inputChannel);
 *
 *   // fanOut — distribute work across N channels
 *   const [ch1, ch2, ch3] = fanOut(inputChannel, 3);
 *
 *   // fanIn — merge N channels into one
 *   const merged = fanIn([ch1, ch2, ch3]);
 */

import { debug } from '../utils/debug.js';

export class Channel {
    #buffer    = [];
    #closed    = false;
    #receivers = [];
    #senders   = [];
    #mode;
    #workers   = null;

    // Pending calls waiting for a worker response in worker mode.
    // Keyed by a per-message id so concurrent sends and receives can be
    // matched up correctly when postMessage responses arrive out of order.
    #workerPending = new Map(); // id -> { resolve, reject }
    #workerNextId  = 0;
    #workerIndex   = 0; // round-robin pointer into #workers

    /**
     * @param {number|Object} options
     *   buffer   : number   — buffer size (default: 0 = unbuffered)
     *   mode     : string   — 'async' | 'worker' (default: 'async')
     *   workers  : boolean|number — true = auto pool size, number = explicit count
     *   fallback : string   — mode to use if workers unsupported (default: 'async')
     *   name     : string   — debug name
     *   onError  : Function — error handler
     */
    constructor(options = {}) {
        const opts = typeof options === 'number'
            ? { buffer: options }
            : options;

        const {
            buffer   = 0,
            mode     = 'async',
            workers  = false,
            fallback = 'async',
            name,
            onError,
        } = opts;

        this.bufferSize = buffer;
        this.name       = name    || `chan-${Math.random().toString(36).slice(2, 8)}`;
        this._onError   = onError || null;

        if (mode === 'worker' || workers) {
            if (this.#supportsWorkers()) {
                this.#mode = 'worker';
                const poolSize = workers === true
                    ? this.#detectOptimalPoolSize()
                    : typeof workers === 'number'
                        ? Math.min(workers, this.#maxWorkers())
                        : 1;
                this.#initWorkers(poolSize);
                console.info(`[oja/channel] ${this.name} → worker mode (${poolSize} worker${poolSize > 1 ? 's' : ''})`);
            } else {
                console.warn(`[oja/channel] ${this.name} → workers not supported, falling back to ${fallback}`);
                this.#mode = fallback;
            }
        } else {
            this.#mode = mode;
        }

        debug.log('channel', 'created', {
            name    : this.name,
            mode    : this.#mode,
            buffer  : this.bufferSize,
            workers : this.#workers?.length ?? 0,
        });
    }

    // Core API

    /**
     * Send a value — like ch <- value in Go.
     * In worker mode the value is routed through the worker pool.
     * In async mode it blocks (returns a Promise) if buffer is full and
     * no receiver is waiting.
     */
    async send(value) {
        if (this.#closed) throw new Error(`[oja/channel] send on closed channel: ${this.name}`);

        if (this.#mode === 'worker' && this.#workers?.length) {
            return this.#workerSend(value);
        }

        if (this.#receivers.length > 0) {
            const receiver = this.#receivers.shift();
            receiver.resolve({ value, ok: true });
            debug.log('channel', 'send-direct', { name: this.name });
            return;
        }

        if (this.#buffer.length < this.bufferSize) {
            this.#buffer.push(value);
            debug.log('channel', 'send-buffered', { name: this.name, buffered: this.#buffer.length });
            return;
        }

        return new Promise((resolve) => {
            this.#senders.push({ value, resolve });
            debug.log('channel', 'send-waiting', { name: this.name });
        });
    }

    /**
     * Receive a value — like value, ok := <-ch in Go.
     * Returns { value, ok: true } or { value: undefined, ok: false } when closed.
     * In worker mode the receive is routed through the worker pool.
     * Blocks if no value is available.
     */
    async receive() {
        if (this.#mode === 'worker' && this.#workers?.length) {
            return this.#workerReceive();
        }

        if (this.#closed && this.#buffer.length === 0 && this.#senders.length === 0) {
            return { value: undefined, ok: false };
        }

        if (this.#buffer.length > 0) {
            const value = this.#buffer.shift();
            if (this.#senders.length > 0) {
                const sender = this.#senders.shift();
                this.#buffer.push(sender.value);
                sender.resolve();
            }
            debug.log('channel', 'receive-buffered', { name: this.name });
            return { value, ok: true };
        }

        if (this.#senders.length > 0) {
            const sender = this.#senders.shift();
            sender.resolve();
            debug.log('channel', 'receive-direct', { name: this.name });
            return { value: sender.value, ok: true };
        }

        if (this.#closed) return { value: undefined, ok: false };

        return new Promise((resolve) => {
            this.#receivers.push({ resolve });
            debug.log('channel', 'receive-waiting', { name: this.name });
        });
    }

    /**
     * Close the channel — signals all consumers to stop.
     * Any pending receivers get { value: undefined, ok: false }.
     * Senders after close will throw.
     */
    close() {
        if (this.#closed) return;
        this.#closed = true;

        for (const r of this.#receivers) {
            r.resolve({ value: undefined, ok: false });
        }
        this.#receivers = [];

        // Reject any pending worker calls so callers are not left hanging.
        for (const [, { reject }] of this.#workerPending) {
            reject(new Error(`[oja/channel] channel closed: ${this.name}`));
        }
        this.#workerPending.clear();

        if (this.#workers) {
            for (const w of this.#workers) w.terminate();
            this.#workers = null;
        }

        debug.log('channel', 'closed', { name: this.name });
    }

    /**
     * Async iterator — like for v := range ch in Go.
     * Stops automatically when the channel is closed and drained.
     *
     *   for await (const item of ch) {
     *       await process(item);
     *   }
     */
    async *[Symbol.asyncIterator]() {
        while (true) {
            const { value, ok } = await this.receive();
            if (!ok) break;
            yield value;
        }
    }

    // State

    get closed()  { return this.#closed; }
    get length()  { return this.#buffer.length; }
    get mode()    { return this.#mode; }
    get waiting() { return this.#receivers.length; }

    // Worker pool

    #supportsWorkers() {
        return typeof Worker !== 'undefined';
    }

    #maxWorkers() {
        return navigator.hardwareConcurrency || 4;
    }

    #detectOptimalPoolSize() {
        const cores = navigator.hardwareConcurrency || 2;
        return Math.max(1, Math.min(cores - 1, 8));
    }

    #initWorkers(count) {
        // Each worker runs the same buffering logic off the main thread.
        // The worker maintains its own buffer, sender queue, and receiver queue,
        // and responds to 'send' and 'receive' messages with acknowledgements.
        // This offloads all channel coordination to the worker thread.
        const workerSrc = `
            const buffer    = [];
            const bufferMax = ${this.bufferSize};
            const senders   = [];
            const receivers = [];
            let   closed    = false;

            self.onmessage = (e) => {
                const { type, value, id } = e.data;

                if (type === 'send') {
                    if (receivers.length > 0) {
                        const r = receivers.shift();
                        self.postMessage({ type: 'receive-ok', value, id: r.id });
                        self.postMessage({ type: 'send-ok', id });
                    } else if (buffer.length < bufferMax) {
                        buffer.push(value);
                        self.postMessage({ type: 'send-ok', id });
                    } else {
                        senders.push({ value, id });
                    }
                }

                else if (type === 'receive') {
                    if (buffer.length > 0) {
                        const val = buffer.shift();
                        if (senders.length > 0) {
                            const s = senders.shift();
                            buffer.push(s.value);
                            self.postMessage({ type: 'send-ok', id: s.id });
                        }
                        self.postMessage({ type: 'receive-ok', value: val, id });
                    } else if (senders.length > 0) {
                        const s = senders.shift();
                        self.postMessage({ type: 'send-ok', id: s.id });
                        self.postMessage({ type: 'receive-ok', value: s.value, id });
                    } else if (closed) {
                        self.postMessage({ type: 'receive-closed', id });
                    } else {
                        receivers.push({ id });
                    }
                }

                else if (type === 'close') {
                    closed = true;
                    receivers.forEach(r => {
                        self.postMessage({ type: 'receive-closed', id: r.id });
                    });
                }
            };
        `;

        const blob = new Blob([workerSrc], { type: 'text/javascript' });
        const url  = URL.createObjectURL(blob);

        this.#workers = Array.from({ length: count }, () => {
            const w = new Worker(url);
            w.onmessage = (e) => this.#handleWorkerMessage(e.data);
            w.onerror   = (e) => {
                console.error(`[oja/channel] worker error in ${this.name}:`, e);
                if (this._onError) this._onError(e);
            };
            return w;
        });

        URL.revokeObjectURL(url);
    }

    /**
     * Route a send through the worker pool using round-robin dispatch.
     * Returns a Promise that resolves when the worker acknowledges the send.
     */
    #workerSend(value) {
        return new Promise((resolve, reject) => {
            const id     = this.#workerNextId++;
            const worker = this.#workers[this.#workerIndex % this.#workers.length];
            this.#workerIndex++;
            this.#workerPending.set(id, { resolve, reject, type: 'send' });
            worker.postMessage({ type: 'send', value, id });
        });
    }

    /**
     * Route a receive through the worker pool using round-robin dispatch.
     * Returns a Promise that resolves to { value, ok }.
     */
    #workerReceive() {
        return new Promise((resolve, reject) => {
            const id     = this.#workerNextId++;
            const worker = this.#workers[this.#workerIndex % this.#workers.length];
            this.#workerIndex++;
            this.#workerPending.set(id, { resolve, reject, type: 'receive' });
            worker.postMessage({ type: 'receive', id });
        });
    }

    /**
     * Dispatch incoming worker messages to the correct pending promise.
     */
    #handleWorkerMessage(msg) {
        const { type, value, id } = msg;
        const pending = this.#workerPending.get(id);
        if (!pending) return;

        this.#workerPending.delete(id);

        switch (type) {
            case 'send-ok':
                pending.resolve();
                break;
            case 'receive-ok':
                pending.resolve({ value, ok: true });
                break;
            case 'receive-closed':
                pending.resolve({ value: undefined, ok: false });
                break;
            default:
                pending.reject(new Error(`[oja/channel] unknown worker message type: ${type}`));
        }
    }
}

/**
 * go — run an async function as a concurrent microtask.
 * Equivalent to Go's `go func() { ... }()`.
 * Errors are logged — use onError in your Channel for structured handling.
 *
 *   go(async () => {
 *       for await (const job of ch) {
 *           const result = await worker.call('process', job);
 *           setResult(result);
 *       }
 *   });
 */
export function go(fn) {
    Promise.resolve().then(fn).catch(e => {
        console.error('[oja/channel] go() error:', e);
    });
}

/**
 * pipeline — chain processing stages, each as a Channel.
 * Output of each stage becomes input of the next.
 * Returns the final output channel.
 *
 * Each output channel is closed when its stage finishes draining, whether
 * that is because the input closed normally or because a stage threw.
 *
 *   const output = pipeline([resize, compress, upload], inputChannel);
 *   for await (const result of output) { displayResult(result); }
 */
export function pipeline(stages, input) {
    let current = input;

    for (const stage of stages) {
        const output = new Channel(current.bufferSize || 0);
        const src    = current;

        go(async () => {
            try {
                for await (const item of src) {
                    try {
                        const result = await stage(item);
                        await output.send(result);
                    } catch (e) {
                        console.error('[oja/channel] pipeline stage error:', e);
                    }
                }
            } finally {
                // Always close the output so downstream consumers are not left
                // blocked on receive() when the input closes or a stage throws.
                output.close();
            }
        });

        current = output;
    }

    return current;
}

/**
 * fanOut — distribute items from one channel across N output channels.
 * Items are distributed round-robin.
 * All output channels are closed when the input closes.
 *
 *   const [ch1, ch2, ch3] = fanOut(inputChannel, 3);
 */
export function fanOut(input, count) {
    const outputs = Array.from({ length: count }, () => new Channel(input.bufferSize || 0));
    let i = 0;

    go(async () => {
        try {
            for await (const item of input) {
                await outputs[i % count].send(item);
                i++;
            }
        } finally {
            outputs.forEach(ch => ch.close());
        }
    });

    return outputs;
}

/**
 * fanIn — merge N channels into one output channel.
 * The output channel closes when all inputs are closed and drained.
 *
 *   const merged = fanIn([ch1, ch2, ch3]);
 */
export function fanIn(channels) {
    const output = new Channel();
    let active   = channels.length;

    channels.forEach(ch => {
        go(async () => {
            try {
                for await (const item of ch) {
                    await output.send(item);
                }
            } finally {
                active--;
                if (active === 0) output.close();
            }
        });
    });

    return output;
}

/** merge — alias for fanIn */
export const merge = fanIn;

/**
 * split — divide channel items across outputs based on predicate functions.
 * First matching predicate wins. Unmatched items are dropped.
 * All output channels are closed when the input closes.
 *
 *   const [errors, warnings, info] = split(logChannel, [
 *       (item) => item.level === 'ERROR',
 *       (item) => item.level === 'WARN',
 *       (item) => item.level === 'INFO',
 *   ]);
 */
export function split(input, predicates) {
    const outputs = predicates.map(() => new Channel());

    go(async () => {
        try {
            for await (const item of input) {
                for (let i = 0; i < predicates.length; i++) {
                    if (predicates[i](item)) {
                        await outputs[i].send(item);
                        break;
                    }
                }
            }
        } finally {
            outputs.forEach(ch => ch.close());
        }
    });

    return outputs;
}
