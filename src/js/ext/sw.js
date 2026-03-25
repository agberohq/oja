/**
 * oja/sw.js
 * Service Worker registration and messaging helpers.
 * Works standalone — no dependency on VFS or any other Oja module.
 *
 * ─── Register and wait for control ───────────────────────────────────────────
 *
 *   import { sw } from '../oja/sw.js';
 *
 *   await sw.register('./sw.js');
 *   // Page is now controlled by the SW — safe to postMessage
 *
 * ─── Send a message and await the ACK ────────────────────────────────────────
 *
 *   await sw.send({ type: 'SYNC_VFS', files });
 *   // Resolves when SW posts back { type: 'VFS_SYNCED' } or after timeout
 *
 *   // Custom ACK type
 *   await sw.send({ type: 'CLEAR_CACHE' }, { ack: 'CACHE_CLEARED' });
 *
 * ─── One-way fire and forget ─────────────────────────────────────────────────
 *
 *   sw.post({ type: 'PREFETCH', url: '/assets/chunk.js' });
 *
 * ─── Listen for messages from the SW ─────────────────────────────────────────
 *
 *   const off = sw.on('PUSH_UPDATE', (data) => notify.info(data.message));
 *   off(); // unsubscribe
 *
 * ─── VFS integration (convenience wrapper) ───────────────────────────────────
 *
 *   // Sync a VFS getAll() map to the SW and wait for ACK
 *   await sw.syncVFS(files, { ack: 'VFS_SYNCED', timeout: 2000 });
 */

const DEFAULT_TIMEOUT = 2000;
const _listeners = new Map();     // type → Set<fn>
const _stateListeners = new Set(); // lifecycle state listeners
let _currentState = 'unknown';    // current SW lifecycle state

// Wire the single shared message listener once
if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (e) => {
        if (!e.data?.type) return;
        const fns = _listeners.get(e.data.type);
        if (fns) fns.forEach(fn => fn(e.data));
    });

    // Track SW state
    if (navigator.serviceWorker.controller) {
        _currentState = 'activated';
    }

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        _currentState = navigator.serviceWorker.controller ? 'activated' : 'redundant';
        _stateListeners.forEach(fn => { try { fn(_currentState); } catch {} });
    });
}

export const sw = {

    // Register the SW and resolve when the page is controlled by it.
    // On first install, waits for controllerchange.
    // On subsequent loads, the SW already controls the page — resolves immediately.
    register(scriptUrl, options = {}) {
        if (!('serviceWorker' in navigator)) return Promise.resolve(null);

        return new Promise(async (resolve) => {
            let reg;
            try {
                reg = await navigator.serviceWorker.register(scriptUrl, options);
            } catch (e) {
                console.warn('[oja/sw] registration failed:', e);
                resolve(null);
                return;
            }

            if (navigator.serviceWorker.controller) {
                // Already controlled — no need to wait for controllerchange
                _currentState = 'activated';
                _stateListeners.forEach(fn => { try { fn(_currentState); } catch {} });
                resolve(reg);
                return;
            }

            // track installing state only when SW isn't already active
            if (!reg.active) {
                _currentState = 'installing';
                _stateListeners.forEach(fn => { try { fn(_currentState); } catch {} });
            }

            navigator.serviceWorker.addEventListener('controllerchange', () => resolve(reg), { once: true });
            setTimeout(() => resolve(reg), DEFAULT_TIMEOUT);
        });
    },

    // Post a message to the active SW and resolve when the expected ACK arrives.
    // Falls back to resolving after timeout if the SW never replies.
    send(message, options = {}) {
        const { ack = null, timeout = DEFAULT_TIMEOUT } = options;

        return new Promise(async (resolve) => {
            try {
                const reg = await navigator.serviceWorker.ready;
                const worker = reg.active;
                if (!worker) { resolve(null); return; }

                if (!ack) {
                    worker.postMessage(message);
                    resolve(null);
                    return;
                }

                let timer;
                const off = sw.on(ack, (data) => {
                    clearTimeout(timer);
                    off();
                    resolve(data);
                });

                timer = setTimeout(() => {
                    off();
                    resolve(null);
                }, timeout);

                worker.postMessage(message);

            } catch (e) {
                resolve(null);
            }
        });
    },

    // Fire and forget — post a message with no waiting for reply.
    post(message) {
        navigator.serviceWorker?.controller?.postMessage(message);
    },

    // Listen for a specific message type from the SW.
    // Returns an unsubscribe function.
    on(type, fn) {
        if (!_listeners.has(type)) _listeners.set(type, new Set());
        _listeners.get(type).add(fn);
        return () => {
            const fns = _listeners.get(type);
            if (fns) {
                fns.delete(fn);
                if (fns.size === 0) _listeners.delete(type);
            }
        };
    },

    // Sync a flat file map { path: content } to the SW.
    // Expects the SW to handle { type: 'SYNC_VFS', files } and reply { type: 'VFS_SYNCED' }.
    // The ack and timeout options let you adapt to a custom SW protocol.
    syncVFS(files, options = {}) {
        const { ack = 'VFS_SYNCED', timeout = DEFAULT_TIMEOUT } = options;
        return sw.send({ type: 'SYNC_VFS', files }, { ack, timeout });
    },

    // Returns the currently active ServiceWorker, or null.
    get active() {
        return navigator.serviceWorker?.controller || null;
    },

    // Boolean convenience — true if SW is controlling the page.
    get isControlling() {
        return !!navigator.serviceWorker?.controller;
    },

    // Returns true if the browser supports service workers.
    get supported() {
        return 'serviceWorker' in navigator;
    },

    // Wait for a specific message type from the SW (promise-based).
    // Rejects with an Error on timeout.
    //
    //   const data = await sw.waitFor('SW_READY', 3000);
    waitFor(type, timeout = DEFAULT_TIMEOUT) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                off();
                reject(new Error(`[oja/sw] Timeout waiting for message: ${type}`));
            }, timeout);
            const off = sw.on(type, (data) => {
                clearTimeout(timer);
                off();
                resolve(data);
            });
        });
    },

    // Listen to SW lifecycle state changes.
    // fn receives one of: 'unknown' | 'installing' | 'installed' | 'activating' | 'activated' | 'redundant'
    // Returns an unsubscribe function. Calls fn immediately with current state.
    //
    //   const off = sw.onStateChange(state => statusEl.textContent = state);
    onStateChange(fn) {
        _stateListeners.add(fn);
        // Call immediately with current state
        try { fn(_currentState); } catch (e) { console.warn('[oja/sw] onStateChange error:', e); }
        return () => _stateListeners.delete(fn);
    },

    // Tell the SW to clear its VFS cache.
    // Sends CLEAR_VFS, waits for VFS_CLEARED ack.
    //
    //   await sw.clearVFS();
    clearVFS(options = {}) {
        const { ack = 'VFS_CLEARED', timeout = DEFAULT_TIMEOUT } = options;
        return sw.send({ type: 'CLEAR_VFS' }, { ack, timeout });
    },

    /**
     * Register an application service worker and optionally send it a list
     * of assets to precache. This is a convenience wrapper over register()
     * and send() for the common offline-first app pattern.
     *
     * The SW script must handle the PRECACHE message:
     *   self.addEventListener('message', e => {
     *     if (e.data.type === 'PRECACHE') caches.open('v1').then(c => c.addAll(e.data.assets));
     *   });
     *
     *   await sw.registerAppWorker('./sw.js', [
     *     './index.html',
     *     './js/app.js',
     *     'https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js',
     *   ]);
     *
     * @param {string}   scriptUrl  — path to the service worker script
     * @param {string[]} [assets]   — optional list of URLs to precache on activation
     * @param {Object}   [options]  — options passed to navigator.serviceWorker.register()
     * @returns {Promise<ServiceWorkerRegistration|null>}
     */
    async registerAppWorker(scriptUrl, assets = [], options = {}) {
        if (!('serviceWorker' in navigator)) return null;

        const reg = await sw.register(scriptUrl, options);
        if (!reg) return null;

        if (assets.length > 0) {
            // Send precache list to the SW — fire and forget, non-fatal if ignored
            sw.post({ type: 'PRECACHE', assets });
        }

        return reg;
    },
};

// ─── Named exports ──────────────────────────────────────────────────────
// Consistent with all other Oja ext modules that export named functions.
export const register = (scriptUrl, options) => sw.register(scriptUrl, options);
export const send     = (message, options)   => sw.send(message, options);
export const post     = (message)            => sw.post(message);
export const on       = (type, fn)           => sw.on(type, fn);
export const waitFor  = (type, timeout)      => sw.waitFor(type, timeout);
export const syncVFS  = (files, options)     => sw.syncVFS(files, options);
export const clearVFS = (options)            => sw.clearVFS(options);
