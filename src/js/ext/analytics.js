/**
 * oja/analytics.js
 * Zero-bloat telemetry and analytics engine.
 *
 * Auto-tracks page views, API errors, and performance with offline queueing.
 * Uses navigator.sendBeacon() to guarantee delivery when the tab is closed.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { analytics } from '../oja/analytics.js';
 *
 *   analytics.init({
 *       endpoint: '/api/telemetry',
 *       batchSize: 20,           // Send every 20 events
 *       flushInterval: 10000,    // Or every 10 seconds
 *       autoTrackPages: true,    // Listen to oja:navigate:end
 *       autoTrackErrors: true,   // Listen to api:error
 *       autoTrackPerf: true,     // Listen to component:slow-render
 *   });
 *
 *   // Identify the user so all future events attach this data
 *   analytics.identify('user-123', { role: 'admin' });
 *
 *   // Manual tracking
 *   analytics.track('button_clicked', { btnId: 'checkout' });
 */

import { listen } from '../core/events.js';
import { Store }  from '../core/store.js';

export class Analytics {
    constructor(options = {}) {
        this.options = {
            endpoint: '/api/telemetry',
            batchSize: 20,
            flushInterval: 10000,
            autoTrackPages: true,
            autoTrackErrors: true,
            autoTrackPerf: true,
            defaultData: {},
            headers: {},
            debug: false,
            ...options
        };

        this._store = new Store('oja:analytics', { prefer: 'local' });
        this._queue = this._store.get('queue',[]);
        this._timer = null;
        this._unsubs =[];
        this._flushing = false;
        this._visibilityHandler = null;
        this._seq = 0; // Monotonic counter — gives each event a stable identity for flush filtering
    }

    init(opts = {}) {
        this.options = { ...this.options, ...opts };
        this._setupAutoTracking();
        this._setupFlushTimer();
        this._setupVisibilityHandler();
        return this;
    }

    identify(userId, traits = {}) {
        this.options.defaultData = { ...this.options.defaultData, userId, ...traits };
        this.track('user_identified');
        return this;
    }

    track(event, data = {}) {
        const entry = {
            _id: ++this._seq,
            event,
            data,
            timestamp: Date.now(),
            sessionId: this._getSessionId(),
            url: typeof window !== 'undefined' ? window.location.href : '',
            ...this.options.defaultData
        };

        this._queue.push(entry);
        this._saveQueue();

        if (this.options.debug) {
            console.debug(`[oja/analytics] track: ${event}`, entry);
        }

        if (this._queue.length >= this.options.batchSize) {
            this.flush();
        }

        return this;
    }

    async flush() {
        if (this._flushing || this._queue.length === 0) return;

        const batch =[...this._queue];
        this._flushing = true;

        try {
            if (typeof navigator !== 'undefined' && navigator.onLine === false) {
                this._flushing = false;
                return; // Wait for online
            }

            const response = await fetch(this.options.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.options.headers
                },
                body: JSON.stringify({ batch })
            });

            if (response.ok) {
                // Remove successfully sent items using stable _id comparison.
                // Reference equality (batch.includes(e)) breaks if the queue is
                // ever deserialized from storage — objects become new instances.
                const batchIds = new Set(batch.map(e => e._id));
                this._queue = this._queue.filter(e => !batchIds.has(e._id));
                this._saveQueue();
            } else if (response.status === 413) {
                // Payload too large — drop the batch to prevent an infinite blocking loop
                const batchIds = new Set(batch.map(e => e._id));
                this._queue = this._queue.filter(e => !batchIds.has(e._id));
                this._saveQueue();
            }
        } catch (e) {
            if (this.options.debug) console.warn('[oja/analytics] flush failed', e);
        } finally {
            this._flushing = false;
        }
    }

    getQueue() {
        return [...this._queue];
    }

    _saveQueue() {
        this._store.set('queue', this._queue);
    }

    _getSessionId() {
        let sid = this._store.get('sessionId');
        if (!sid) {
            sid = `sess_${Math.random().toString(36).slice(2)}_${Date.now()}`;
            this._store.set('sessionId', sid);
        }
        return sid;
    }

    _setupAutoTracking() {
        this._unsubs.forEach(fn => fn());
        this._unsubs =[];

        if (this.options.autoTrackPages) {
            this._unsubs.push(listen('oja:navigate:end', ({ path, params }) => {
                this.track('page_view', { path, params });
            }));
        }

        if (this.options.autoTrackErrors) {
            this._unsubs.push(listen('api:error', ({ status, path, method }) => {
                this.track('api_error', { status, path, method });
            }));
            this._unsubs.push(listen('ws:error', ({ url }) => {
                this.track('ws_error', { url });
            }));
        }

        if (this.options.autoTrackPerf) {
            this._unsubs.push(listen('component:slow-render', ({ url, ms, threshold }) => {
                this.track('slow_render', { url, ms, threshold });
            }));
        }
    }

    _setupFlushTimer() {
        if (this._timer) clearInterval(this._timer);
        if (this.options.flushInterval > 0) {
            this._timer = setInterval(() => this.flush(), this.options.flushInterval);
        }
    }

    _setupVisibilityHandler() {
        if (typeof document === 'undefined') return;

        // Remove any previously registered listener before adding a new one.
        // Prevents accumulation when init() is called multiple times and
        // ensures destroy() fully cleans up.
        if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
        }

        this._visibilityHandler = () => {
            if (document.visibilityState === 'hidden' && this._queue.length > 0) {
                if (navigator.sendBeacon) {
                    // SendBeacon guarantees delivery even as the document unloads
                    const blob = new Blob([JSON.stringify({ batch: this._queue })], { type: 'application/json' });
                    navigator.sendBeacon(this.options.endpoint, blob);

                    this._queue =[];
                    this._saveQueue();
                } else {
                    this.flush();
                }
            }
        };

        document.addEventListener('visibilitychange', this._visibilityHandler);
    }

    destroy() {
        if (this._timer) clearInterval(this._timer);
        this._unsubs.forEach(fn => fn());
        this._unsubs =[];
        if (this._visibilityHandler) {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = null;
        }
    }
}

export const analytics = new Analytics();