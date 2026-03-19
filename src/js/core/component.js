// src/js/core/component.js
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

const _cache = new Map();

const CACHE_DEFAULTS = {
    ttl:       60000,
    maxSize:   20,
    maxMemory: 5 * 1024 * 1024,
};

let _cacheConfig = { ...CACHE_DEFAULTS };
let _cacheStats  = {
    hits:       0,
    misses:     0,
    evictions:  0,
    totalBytes: 0,
};

async function _load(url) {
    const normalised = (() => {
        try { return new URL(url, location.href).href; } catch { return url; }
    })();
    url = normalised;

    const now    = Date.now();
    const cached = _cache.get(url);

    if (cached && (now - cached.timestamp) < _cacheConfig.ttl) {
        cached.hits++;
        _cacheStats.hits++;
        emit('component:cache-hit', { url, hits: cached.hits });
        return cached.html;
    }

    if (cached) {
        _cacheStats.totalBytes -= cached.size || 0;
        _cache.delete(url);
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
    let oldestUrl  = null;
    let oldestTime = Infinity;

    for (const[url, entry] of _cache.entries()) {
        if (entry.timestamp < oldestTime) {
            oldestTime = entry.timestamp;
            oldestUrl  = url;
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

const _renderTimings = new Map();

let _monitoringEnabled = false;
let _slowThreshold     = 100;

function _trackRender(url, ms) {
    if (!_monitoringEnabled) return;

    if (!_renderTimings.has(url)) {
        if (_renderTimings.size >= 100) {
            const firstKey = _renderTimings.keys().next().value;
            _renderTimings.delete(firstKey);
        }
        _renderTimings.set(url, { count: 0, totalMs: 0, maxMs: 0, minMs: Infinity });
    }

    const stats = _renderTimings.get(url);
    stats.count++;
    stats.totalMs += ms;
    stats.maxMs    = Math.max(stats.maxMs, ms);
    stats.minMs    = Math.min(stats.minMs, ms);

    if (ms > _slowThreshold) {
        emit('component:slow-render', { url, ms, threshold: _slowThreshold });
    }
}

const _scopes = new WeakMap();
export let _activeElement = null;

function _getScope(el) {
    if (!el) return null;
    if (!_scopes.has(el)) {
        _scopes.set(el, { mount: [], unmount: [], intervals: [], timeouts:[] });
    }
    return _scopes.get(el);
}

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

export const component = {

    configureCache(config = {}) {
        _cacheConfig = { ..._cacheConfig, ...config };
        return this;
    },

    cacheStats() {
        return { ..._cacheStats, size: _cache.size, config: { ..._cacheConfig } };
    },

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
            _cacheStats.evictions  = 0;
        }
        return this;
    },

    async prefetch(url) {
        await _load(url);
        return this;
    },

    async prefetchAll(urls) {
        await Promise.all(urls.map(url => _load(url).catch(e => {
            console.warn(`[oja/component] prefetch failed: ${url}`, e);
        })));
        return this;
    },

    enableMonitoring(thresholdMs = 100) {
        _monitoringEnabled = true;
        _slowThreshold     = thresholdMs;
        return this;
    },

    disableMonitoring() {
        _monitoringEnabled = false;
        return this;
    },

    renderStats() {
        const stats = {};
        for (const [url, data] of _renderTimings.entries()) {
            stats[url] = { ...data, avgMs: Math.round(data.totalMs / data.count) };
        }
        return stats;
    },

    async mount(target, url, data = {}, lists = {}, options = {}) {
        const start     = performance.now();
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
                execScripts(container, url, data);
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
            } else if (options.error) {
                const isNetworkError   = e instanceof TypeError;
                const errorIsComponent = options.error.type === 'component';

                if (isNetworkError && errorIsComponent) {
                    console.warn('[oja/component] network down — skipping component error Out to avoid double fetch');
                    container.innerHTML = `<div class="oja-error" data-component="${url}">
                        Failed to load component.
                        <button onclick="this.closest('.oja-error').dispatchEvent(new CustomEvent('oja:retry',{bubbles:true}))">Retry</button>
                    </div>`;
                } else {
                    try {
                        await options.error.render(container, { error: e.message, url });
                    } catch (e2) {
                        console.error('[oja/component] error Out also threw:', e2);
                        container.innerHTML = `<div class="oja-error" data-component="${url}">
                            Failed to load component.
                            <button onclick="this.closest('.oja-error').dispatchEvent(new CustomEvent('oja:retry',{bubbles:true}))">Retry</button>
                        </div>`;
                    }
                }
            } else {
                container.innerHTML = `<div class="oja-error" data-component="${url}">
                    Failed to load component.
                    <button onclick="this.closest('.oja-error').dispatchEvent(new CustomEvent('oja:retry',{bubbles:true}))">Retry</button>
                </div>`;
            }
            throw e;
        }
    },

    async add(target, url, data = {}) {
        const start     = performance.now();
        const container = _resolve(target);
        if (!container) return;

        const html    = await _load(url);
        const wrapper = document.createElement('div');
        wrapper.innerHTML = render(html, data);
        fill(wrapper, data);

        const roots = Array.from(wrapper.children);
        const prev = _activeElement;
        _activeElement = container;

        try {
            if (roots.length === 1) {
                container.appendChild(roots[0]);
                execScripts(roots[0], url, data);
                await _enter(roots[0]);
            } else {
                const fragment = document.createDocumentFragment();
                roots.forEach(el => fragment.appendChild(el));
                container.appendChild(fragment);

                for (const el of roots) {
                    execScripts(el, url, data);
                }

                await Promise.all(roots.map(el => _enter(el)));
            }
        } finally {
            _activeElement = prev;
        }

        const ms = performance.now() - start;
        emit('component:added', { url, ms });

        const addedEl = roots.length === 1 ? roots[0] : container;
        emit('oja:component:added', { el: addedEl });

        return roots.length === 1 ? roots[0] : roots;
    },

    async remove(target) {
        const el = _resolve(target);
        if (!el) return;

        await this._runUnmount(el);
        await _leave(el);
        el.remove();
        emit('component:removed', { target });
    },

    async update(target, data = {}) {
        const start = performance.now();
        const el    = _resolve(target);
        if (!el) return;

        fill(el, data);
        await _flash(el);

        const ms = performance.now() - start;
        emit('component:updated', { target, ms });
    },

    onMount(fn) {
        const scope = _getScope(_activeElement);
        if (scope) scope.mount.push(fn);
        return this;
    },

    onUnmount(fn) {
        const scope = _getScope(_activeElement);
        if (scope) scope.unmount.push(fn);
        return this;
    },

    interval(fn, ms) {
        const id    = setInterval(fn, ms);
        const scope = _getScope(_activeElement);
        if (scope) scope.intervals.push(id);
        return id;
    },

    timeout(fn, ms) {
        const id    = setTimeout(fn, ms);
        const scope = _getScope(_activeElement);
        if (scope) scope.timeouts.push(id);
        return id;
    },

    hooks(overrides = {}) {
        _hooks = { ..._hooks, ...overrides };
    },

    async _runUnmount(el) {
        const scopedDescendants = Array.from(el.querySelectorAll('*'))
            .filter(child => _scopes.has(child));

        for (const child of scopedDescendants.reverse()) {
            await _teardownScope(child);
        }

        await _teardownScope(el);
    },

    async _runMount(el) {
        const scope = _scopes.get(el);
        if (!scope) return;
        for (const fn of scope.mount) {
            try { await fn(); } catch (e) {
                console.warn('[oja/component] onMount hook error:', e);
            }
        }
    },
};

async function _teardownScope(el) {
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
}

function _resolve(target) {
    if (!target) return null;
    if (typeof target === 'string') {
        const el = document.querySelector(target);
        if (!el) console.warn(`[oja/component] element not found: ${target}`);
        return el;
    }
    return target;
}