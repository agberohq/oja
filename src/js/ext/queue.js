/**
 * oja/queue.js
 * Offline-first request queue — persists failed requests and replays them
 * when the connection is restored.
 *
 * Works with Oja's Api instance. Listens to 'api:offline' / 'api:online'
 * events automatically, or can be driven manually.
 *
 * ─── Setup (once in app.js) ───────────────────────────────────────────────────
 *
 *   import { Queue } from '../ext/queue.js';
 *   import { api }   from './api.js';
 *
 *   const queue = new Queue({ api, store: new Store('req-queue', { prefer: 'local' }) });
 *   queue.start();    // begin listening to api:offline / api:online
 *
 *   // Use queue.request() instead of api.post() for operations that must not
 *   // be lost if the user goes offline:
 *   await queue.request('POST', '/firewall', { ip, reason });
 *
 *   queue.size;         // → number of pending requests
 *   queue.pending;      // → [{ id, method, path, body, queuedAt }]
 *   queue.flush();      // → manually replay all queued requests
 *   queue.clear();      // → discard all queued requests (no replay)
 *   queue.stop();       // → stop listening to api events
 *
 * ─── Events ───────────────────────────────────────────────────────────────────
 *
 *   queue.on('queued',    ({ request }) => notify.info('Saved offline'))
 *   queue.on('replayed',  ({ request, response }) => notify.success('Synced'))
 *   queue.on('failed',    ({ request, error }) => notify.error('Sync failed'))
 *   queue.on('flushed',   ({ succeeded, failed }) => updateUI())
 *
 * ─── Options ──────────────────────────────────────────────────────────────────
 *
 *   api       : Api instance     — required
 *   store     : Store instance   — for persistence (default: in-memory only)
 *   maxSize   : number           — max queued requests (default: 100)
 *   retries   : number           — retry attempts per request on flush (default: 2)
 *   onQueued  : fn({ request })
 *   onReplayed: fn({ request, response })
 *   onFailed  : fn({ request, error })
 */

import { listen, emit } from '../core/events.js';

export class Queue {
    /**
     * @param {Object} options
     * @param {Object} options.api      — Oja Api instance
     * @param {Object} [options.store]  — Oja Store instance for persistence
     * @param {number} [options.maxSize=100]
     * @param {number} [options.retries=2]
     */
    constructor(options = {}) {
        const { api, store = null, maxSize = 100, retries = 2 } = options;

        if (!api) throw new Error('[oja/queue] options.api is required');

        this._api      = api;
        this._store    = store;
        this._maxSize  = maxSize;
        this._retries  = retries;
        this._queue    = [];
        this._handlers = new Map();
        this._unsubs   = [];
        this._flushing = false;
        this._online   = navigator?.onLine ?? true;

        // Load persisted queue
        if (this._store) {
            try {
                const saved = this._store.get('queue:pending');
                if (Array.isArray(saved)) this._queue = saved;
            } catch { /* ignore */ }
        }
    }

    // Lifecycle

    /**
     * Start listening to api:offline / api:online events.
     * Call once in app.js after creating the queue.
     * @returns {this}
     */
    start() {
        this._unsubs.push(
            listen('api:offline', () => { this._online = false; }),
            listen('api:online',  () => { this._online = true;  this.flush(); }),
        );
        return this;
    }

    /**
     * Stop listening to api events.
     */
    stop() {
        for (const unsub of this._unsubs) unsub?.();
        this._unsubs = [];
    }

    // Queueing

    /**
     * Make an API request. If online, executes immediately via api.
     * If offline (or if the request fails with a network error), queues
     * the request for later replay.
     *
     *   await queue.request('POST', '/firewall', { ip, reason });
     *   await queue.request('DELETE', '/route/42');
     *   await queue.request('PATCH', '/host', data, { headers: { ... } });
     *
     * @param {string} method   — 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'
     * @param {string} path     — API path
     * @param {any}    [body]
     * @param {Object} [opts]   — extra options passed to api._request
     * @returns {any|null}      — response if online, null if queued
     */
    async request(method, path, body = null, opts = {}) {
        if (this._online) {
            try {
                return await this._execute({ method, path, body, opts });
            } catch (e) {
                if (this._isNetworkError(e)) {
                    return this._enqueue(method, path, body, opts);
                }
                throw e;
            }
        }
        return this._enqueue(method, path, body, opts);
    }

    // Convenience wrappers
    post(path, body, opts)   { return this.request('POST',   path, body, opts); }
    put(path, body, opts)    { return this.request('PUT',    path, body, opts); }
    patch(path, body, opts)  { return this.request('PATCH',  path, body, opts); }
    delete(path, opts)       { return this.request('DELETE', path, null, opts); }

    // Flush

    /**
     * Replay all queued requests in order.
     * Called automatically when 'api:online' fires.
     * Safe to call manually at any time.
     *
     * @returns {{ succeeded: number, failed: number }}
     */
    async flush() {
        if (this._flushing || this._queue.length === 0) return { succeeded: 0, failed: 0 };
        this._flushing = true;

        let succeeded = 0, failed = 0;
        const remaining = [];

        for (const req of this._queue) {
            let lastErr = null;
            let ok = false;

            for (let attempt = 0; attempt <= this._retries; attempt++) {
                try {
                    const res = await this._execute(req);
                    this._emit('replayed', { request: req, response: res });
                    ok = true;
                    break;
                } catch (e) {
                    lastErr = e;
                    if (!this._isNetworkError(e)) break; // don't retry non-network errors
                    if (attempt < this._retries) await this._sleep(500 * (attempt + 1));
                }
            }

            if (ok) {
                succeeded++;
            } else {
                failed++;
                remaining.push(req);
                this._emit('failed', { request: req, error: lastErr });
            }
        }

        this._queue = remaining;
        this._persist();
        this._flushing = false;

        this._emit('flushed', { succeeded, failed });
        emit('queue:flushed', { succeeded, failed });

        return { succeeded, failed };
    }

    // Management

    /** Number of pending requests. */
    get size() { return this._queue.length; }

    /** Copy of pending request list. */
    get pending() { return this._queue.map(r => ({ ...r })); }

    /**
     * Remove all queued requests without replaying.
     * @returns {this}
     */
    clear() {
        this._queue = [];
        this._persist();
        return this;
    }

    /**
     * Remove a specific queued request by id.
     * @param {string} id
     * @returns {boolean}
     */
    remove(id) {
        const before = this._queue.length;
        this._queue = this._queue.filter(r => r.id !== id);
        if (this._queue.length !== before) { this._persist(); return true; }
        return false;
    }

    // Events

    /**
     * Subscribe to queue events: 'queued', 'replayed', 'failed', 'flushed'.
     * @param {string}   event
     * @param {Function} fn
     * @returns {Function} unsubscribe
     */
    on(event, fn) {
        if (!this._handlers.has(event)) this._handlers.set(event, new Set());
        this._handlers.get(event).add(fn);
        return () => this._handlers.get(event)?.delete(fn);
    }

    // Internal

    _enqueue(method, path, body, opts) {
        if (this._queue.length >= this._maxSize) {
            console.warn('[oja/queue] max queue size reached — request dropped');
            return null;
        }
        const req = {
            id:        `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
            method,
            path,
            body,
            opts,
            queuedAt:  Date.now(),
            attempts:  0,
        };
        this._queue.push(req);
        this._persist();
        this._emit('queued', { request: req });
        emit('queue:queued', { request: req });
        return null;
    }

    async _execute(req) {
        const { method, path, body, opts = {} } = req;
        const m = method.toLowerCase();
        if (typeof this._api[m] === 'function') {
            return this._api[m](path, body, opts);
        }
        // Fallback for methods api might not expose directly
        return this._api._request?.(path, method.toUpperCase(), body, opts);
    }

    _isNetworkError(e) {
        return e instanceof TypeError ||      // fetch failed (no connection)
               e?.name === 'AbortError' ||
               e?.message?.includes('network') ||
               e?.message?.includes('fetch') ||
               e?.message?.includes('Failed to fetch');
    }

    _emit(event, data) {
        const handlers = this._handlers.get(event);
        if (handlers) for (const fn of handlers) { try { fn(data); } catch {} }
    }

    _persist() {
        if (!this._store) return;
        try { this._store.set('queue:pending', this._queue); } catch {}
    }

    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}
