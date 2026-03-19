/**
 * oja/component.js
 * Loads .html files, mounts them into the DOM, and manages lifecycle
 * transitions (add / remove / update) with CSS animations by default.
 * GSAP, D3, or any other library can be plugged in via hooks().
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { component } from '../oja/component.js';
 *
 *   // Mount a component into a container (fetch + render + inject)
 *   await component.mount('#hostsContainer', 'components/hosts.html', data);
 *
 *   // Add a single new item with enter animation
 *   await component.add('#hostsContainer', 'components/host-row.html', rowData);
 *
 *   // Remove an element with leave animation, then delete from DOM
 *   await component.remove('#host-row-api\\.example\\.com');
 *
 *   // Re-render an element and flash a highlight
 *   await component.update('#host-row-api\\.example\\.com', newData);
 *
 * ─── Page lifecycle ───────────────────────────────────────────────────────────
 *
 *   // Called automatically after the current page finishes mounting.
 *   // Use for: starting polls, focusing inputs, initialising charts.
 *   component.onMount(() => {
 *       component.interval(refresh, 3000); // auto-cleared on navigate
 *   });
 *
 *   // Called automatically before the router navigates away.
 *   // Use for: closing WebSockets, dismissing banners, custom teardown.
 *   component.onUnmount(() => {
 *       sse.close();
 *       notify.dismissBanner();
 *   });
 *
 *   // Register a repeating timer — cleared automatically on navigate.
 *   // Replaces: const id = setInterval(fn, ms);
 *   //           document.addEventListener('oja:navigate', () => clearInterval(id), { once: true });
 *   component.interval(refresh, 3000);
 *
 *   // Register a one-shot timer — cleared automatically on navigate.
 *   component.timeout(() => notify.warn('Slow load?'), 5000);
 *
 * ─── Container scope ──────────────────────────────────────────────────────────
 *
 *   Every component script automatically receives a `container` variable —
 *   the exact DOM element the component was mounted into. Use it instead of
 *   document.getElementById() to keep components isolated and reusable:
 *
 *   // Inside components/image.html <script type="module">:
 *   const img = container.querySelector('img');   // scoped to this instance
 *
 * ─── Animation hooks ──────────────────────────────────────────────────────────
 *
 *   // Override default CSS transitions with GSAP (opt-in per app)
 *   component.hooks({
 *       entering: (el) => gsap.from(el, { opacity: 0, y: 10, duration: 0.25 }),
 *       leaving:  (el) => gsap.to(el,   { opacity: 0, y: -10, duration: 0.2 }),
 *       updated:  (el) => gsap.fromTo(el,
 *           { backgroundColor: '#fffbe6' },
 *           { backgroundColor: 'transparent', duration: 0.4 })
 *   });
 */

import { render, each, fill } from './template.js';
import { execScripts }        from './_exec.js';
import { emit }               from './events.js';

// ─── HTML cache with TTL ─────────────────────────────────────────────────────

const _cache = new Map(); // url → { html, timestamp, hits, size }

const CACHE_DEFAULTS = {
    ttl: 60000,        // 60 seconds default
    maxSize: 20,       // max 20 components in cache
    maxMemory: 5 * 1024 * 1024, // 5MB max total cache size
};

let _cacheConfig = { ...CACHE_DEFAULTS };
let _cacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    totalBytes: 0,
};

async function _load(url) {
    // Normalise the URL so 'page' and 'page/' don't create two cache entries
    // for the same resource. Relative URLs are resolved against the current page.
    const normalised = (() => {
        try { return new URL(url, location.href).href; } catch { return url; }
    })();
    url = normalised;

    const now = Date.now();
    const cached = _cache.get(url);

    if (cached && (now - cached.timestamp) < _cacheConfig.ttl) {
        cached.hits++;
        _cacheStats.hits++;
        emit('component:cache-hit', { url, hits: cached.hits });
        return cached.html;
    }

    if (cached) {
        _cache.delete(url);
        _cacheStats.totalBytes -= cached.size || 0;
    }

    _cacheStats.misses++;
    emit('component:cache-miss', { url });

    const res = await fetch(url);
    if (!res.ok) throw new Error(`[oja/component] failed to load: ${url} (${res.status})`);

    const html = await res.text();
    const size = new Blob([html]).size;

    _cacheStats.totalBytes += size;

    while (_cache.size >= _cacheConfig.maxSize || _cacheStats.totalBytes > _cacheConfig.maxMemory) {
        _evictOldest();
    }

    _cache.set(url, { html, timestamp: now, hits: 1, size });
    emit('component:cached', { url, size });

    return html;
}

function _evictOldest() {
    let oldestUrl = null;
    let oldestTime = Infinity;

    for (const [url, entry] of _cache.entries()) {
        if (entry.timestamp < oldestTime) {
            oldestTime = entry.timestamp;
            oldestUrl = url;
        }
    }

    if (oldestUrl) {
        const entry = _cache.get(oldestUrl);
        _cacheStats.totalBytes -= entry.size || 0;
        _cacheStats.evictions++;
        _cache.delete(oldestUrl);
        emit('component:cache-evict', { url: oldestUrl });
    }
}

// ─── Performance monitoring ───────────────────────────────────────────────────

const _renderTimings = new Map(); // url → { count, totalMs, maxMs, minMs }

let _monitoringEnabled = false;
let _slowThreshold = 100; // ms

function _trackRender(url, ms) {
    if (!_monitoringEnabled) return;

    if (!_renderTimings.has(url)) {
        // Cap at 100 entries to prevent unbounded growth in long-running SPAs.
        // Evict the oldest entry when the limit is reached.
        if (_renderTimings.size >= 100) {
            const firstKey = _renderTimings.keys().next().value;
            _renderTimings.delete(firstKey);
        }
        _renderTimings.set(url, {
            count: 0,
            totalMs: 0,
            maxMs: 0,
            minMs: Infinity,
        });
    }

    const stats = _renderTimings.get(url);
    stats.count++;
    stats.totalMs += ms;
    stats.maxMs = Math.max(stats.maxMs, ms);
    stats.minMs = Math.min(stats.minMs, ms);

    if (ms > _slowThreshold) {
        emit('component:slow-render', { url, ms, threshold: _slowThreshold });
    }
}

// ─── Lifecycle registry ───────────────────────────────────────────────────────

const _scopes = new WeakMap(); // Element → { mount: [], unmount: [], intervals: [], timeouts: [] }
export let _activeElement = null; // Exported for responder.js to set scope

function _getScope(el) {
    if (!el) return null;
    if (!_scopes.has(el)) {
        _scopes.set(el, { mount: [], unmount: [], intervals: [], timeouts: [] });
    }
    return _scopes.get(el);
}

// ─── Animation hooks ──────────────────────────────────────────────────────────

let _hooks = {
    entering: null,
    leaving:  null,
    updated:  null,
};

const CSS_TRANSITION_MS = 250;

function _enter(el) {
    if (_hooks.entering) return Promise.resolve(_hooks.entering(el));
    el.classList.add('oja-entering');
    return new Promise(r => setTimeout(() => { el.classList.remove('oja-entering'); r(); }, CSS_TRANSITION_MS));
}

function _leave(el) {
    if (_hooks.leaving) return Promise.resolve(_hooks.leaving(el));
    el.classList.add('oja-leaving');
    return new Promise(r => setTimeout(() => { el.classList.remove('oja-leaving'); r(); }, CSS_TRANSITION_MS));
}

function _flash(el) {
    if (_hooks.updated) return Promise.resolve(_hooks.updated(el));
    el.classList.add('oja-updated');
    return new Promise(r => setTimeout(() => { el.classList.remove('oja-updated'); r(); }, CSS_TRANSITION_MS * 2));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const component = {

    // ─── Cache configuration ─────────────────────────────────────────────────

    /**
     * Configure the component cache behavior.
     *
     * @param {Object} config
     *   ttl       : number  — time to live in ms (default: 60000)
     *   maxSize   : number  — maximum number of cached components (default: 20)
     *   maxMemory : number  — maximum total cache size in bytes (default: 5MB)
     */
    configureCache(config = {}) {
        _cacheConfig = { ..._cacheConfig, ...config };
        return this;
    },

    /**
     * Get cache statistics.
     * Returns { hits, misses, evictions, totalBytes, size }
     */
    cacheStats() {
        return {
            ..._cacheStats,
            size: _cache.size,
            config: { ..._cacheConfig },
        };
    },

    /**
     * Clear the component HTML cache.
     * Useful during development or after a deploy.
     */
    clearCache(url) {
        if (url) {
            const entry = _cache.get(url);
            if (entry) {
                _cacheStats.totalBytes -= entry.size || 0;
                _cache.delete(url);
            }
        } else {
            _cache.clear();
            _cacheStats.totalBytes = 0;
            _cacheStats.evictions = 0;
        }
        return this;
    },

    /**
     * Pre-fetch and cache a component without mounting it.
     * Call during app init to avoid loading delays on first navigation.
     */
    async prefetch(url) {
        await _load(url);
        return this;
    },

    /**
     * Pre-fetch multiple components in parallel.
     * Useful for prefetching an entire section of the app.
     */
    async prefetchAll(urls) {
        await Promise.all(urls.map(url => _load(url).catch(e => {
            console.warn(`[oja/component] prefetch failed: ${url}`, e);
        })));
        return this;
    },

    // ─── Performance monitoring ───────────────────────────────────────────────

    /**
     * Enable render performance monitoring.
     * Emits 'component:slow-render' events when renders exceed threshold.
     *
     * @param {number} thresholdMs - Slow render threshold in ms (default: 100)
     */
    enableMonitoring(thresholdMs = 100) {
        _monitoringEnabled = true;
        _slowThreshold = thresholdMs;
        return this;
    },

    disableMonitoring() {
        _monitoringEnabled = false;
        return this;
    },

    /**
     * Get render timing statistics.
     * Returns map of URL → { count, avgMs, maxMs, minMs }
     */
    renderStats() {
        const stats = {};
        for (const [url, data] of _renderTimings.entries()) {
            stats[url] = {
                ...data,
                avgMs: Math.round(data.totalMs / data.count),
            };
        }
        return stats;
    },

    // ─── Mounting ─────────────────────────────────────────────────────────────

    /**
     * Replace the entire contents of a container with a rendered component.
     * Use for full page sections (hosts list, firewall table, etc.)
     *
     * @param {string|Element} target  — CSS selector or DOM element
     * @param {string}         url     — path to .html component file
     * @param {Object}         data    — data for {{interpolation}}
     * @param {Object}         lists   — { listName: [items] } for data-each loops
     */
    async mount(target, url, data = {}, lists = {}) {
        const start = performance.now();
        const container = _resolve(target);
        if (!container) return;

        await this._runUnmount(container);

        const loadingEl = container.querySelector('[data-loading]');
        const errorEl   = container.querySelector('[data-error]');
        if (loadingEl) loadingEl.style.display = '';
        if (errorEl)   errorEl.style.display   = 'none';

        try {
            const html = await _load(url);
            container.innerHTML = render(html, data);

            for (const [name, items] of Object.entries(lists)) {
                each(container, name, items);
            }

            fill(container, data);

            const prev = _activeElement;
            _activeElement = container;
            try {
                execScripts(container, url);
            } finally {
                _activeElement = prev;
            }

            const ms = performance.now() - start;
            _trackRender(url, ms);
            emit('component:mounted', { url, ms });

        } catch (e) {
            console.error(`[oja/component] failed to mount "${url}":`, e);
            if (errorEl) {
                errorEl.style.display = '';
                if (loadingEl) loadingEl.style.display = 'none';
            } else {
                container.innerHTML = `<div class="oja-error" data-component="${url}">
                    Failed to load component.
                    <button onclick="this.closest('.oja-error').dispatchEvent(new CustomEvent('oja:retry',{bubbles:true}))">Retry</button>
                </div>`;
            }
            throw e;
        }
    },

    /**
     * Append a new item to a container with an enter animation.
     * Use for adding a single row/card to an existing list.
     */
    async add(target, url, data = {}) {
        const start = performance.now();
        const container = _resolve(target);
        if (!container) return;

        const html    = await _load(url);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = render(html, data);
        fill(wrapper, data);

        const prev = _activeElement;
        _activeElement = wrapper;
        try {
            execScripts(wrapper, url);
        } finally {
            _activeElement = prev;
        }

        const el = wrapper.firstElementChild || wrapper;
        container.appendChild(el);
        await _enter(el);

        const ms = performance.now() - start;
        emit('component:added', { url, ms });

        // Notify ui.js to re-wire any data-ui widgets inside the new element.
        // Without this, dynamically added components (e.g. a new table row
        // containing a datepicker) would never have their widgets initialised
        // because no navigation event fired.
        emit('oja:component:added', { el });

        return el;
    },

    /**
     * Animate an element out, then remove it from the DOM.
     * Use for deleting a row, dismissing a card, etc.
     */
    async remove(target) {
        const el = _resolve(target);
        if (!el) return;

        await this._runUnmount(el);
        await _leave(el);
        el.remove();
        emit('component:removed', { target });
    },

    /**
     * Re-render an element with new data and flash a highlight.
     * Use when a value changes and you want the user to notice.
     */
    async update(target, data = {}) {
        const start = performance.now();
        const el = _resolve(target);
        if (!el) return;

        fill(el, data);
        await _flash(el);

        const ms = performance.now() - start;
        emit('component:updated', { target, ms });
    },

    // ─── Page lifecycle ───────────────────────────────────────────────────────

    /**
     * Register a function to run after the current page finishes mounting.
     * Called automatically by the router after rendering completes.
     * Use for: starting polls, focusing inputs, drawing charts.
     *
     *   component.onMount(() => {
     *       component.interval(refresh, 3000);
     *       document.getElementById('search')?.focus();
     *   });
     */
    onMount(fn) {
        const scope = _getScope(_activeElement);
        if (scope) scope.mount.push(fn);
        return this;
    },

    /**
     * Register a function to run before the router navigates away.
     * Called automatically — no need to listen for oja:navigate manually.
     * Use for: closing WebSockets, dismissing banners, custom teardown.
     *
     *   component.onUnmount(() => {
     *       sse.close();
     *       notify.dismissBanner();
     *   });
     */
    onUnmount(fn) {
        const scope = _getScope(_activeElement);
        if (scope) scope.unmount.push(fn);
        return this;
    },

    /**
     * Register a repeating interval that is automatically cleared when the
     * router navigates away. Replaces the common pattern of:
     *   const id = setInterval(fn, ms);
     *   document.addEventListener('oja:navigate', () => clearInterval(id), { once: true });
     *
     *   component.interval(refresh, 3000);
     *
     * @returns {number} The interval id — can be used to clear early if needed.
     */
    interval(fn, ms) {
        const id = setInterval(fn, ms);
        const scope = _getScope(_activeElement);
        if (scope) scope.intervals.push(id);
        return id;
    },

    /**
     * Register a one-shot timeout that is automatically cleared when the
     * router navigates away before it fires.
     *
     *   component.timeout(() => notify.warn('Still loading...'), 5000);
     *
     * @returns {number} The timeout id — can be used to clear early if needed.
     */
    timeout(fn, ms) {
        const id = setTimeout(fn, ms);
        const scope = _getScope(_activeElement);
        if (scope) scope.timeouts.push(id);
        return id;
    },

    // ─── Animation hooks ──────────────────────────────────────────────────────

    /**
     * Override default CSS transitions with a custom animation library.
     * Each hook receives the element and should return a Promise or void.
     *
     *   component.hooks({
     *       entering: (el) => gsap.from(el, { opacity: 0, duration: 0.3 }),
     *       leaving:  (el) => gsap.to(el,   { opacity: 0, duration: 0.2 }),
     *       updated:  (el) => gsap.fromTo(el, { background: '#fffbe6' }, { background: 'transparent' })
     *   });
     */
    hooks(overrides = {}) {
        _hooks = { ..._hooks, ...overrides };
    },

    // ─── Internal — called by router.js ──────────────────────────────────────

    /**
     * Run all onUnmount hooks and clear all registered intervals/timeouts for a scope.
     * @internal
     */
    async _runUnmount(el) {
        // Recursively teardown child components first — child intervals and
        // unmount hooks must be cleared before the parent, otherwise removing
        // a dashboard card that contains a live-gauge widget leaves "ghost"
        // timers running for every sub-widget inside it.
        const children = el.querySelectorAll('*');
        for (const child of children) {
            if (_scopes.has(child)) {
                await this._runUnmount(child);
            }
        }

        // Teardown this element
        const scope = _scopes.get(el);
        if (!scope) return;

        for (const id of scope.intervals) clearInterval(id);
        for (const id of scope.timeouts)  clearTimeout(id);

        for (const fn of scope.unmount) {
            try { await fn(); } catch (e) {
                console.warn('[oja/component] onUnmount hook error:', e);
            }
        }

        _scopes.delete(el);
    },

    /**
     * Run all onMount hooks for a specific container.
     * @internal
     */
    async _runMount(el) {
        const scope = _scopes.get(el);
        if (!scope) return;
        for (const fn of scope.mount) {
            try { await fn(); } catch (e) {
                console.warn('[oja/component] onMount hook error:', e);
            }
        }
    }
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _resolve(target) {
    if (!target) return null;
    if (typeof target === 'string') {
        const el = document.querySelector(target);
        if (!el) console.warn(`[oja/component] element not found: ${target}`);
        return el;
    }
    return target;
}