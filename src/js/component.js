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

// ─── HTML cache ───────────────────────────────────────────────────────────────

const _cache = new Map(); // url → html string

async function _load(url) {
    if (_cache.has(url)) return _cache.get(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`[oja/component] failed to load: ${url} (${res.status})`);
    const html = await res.text();
    _cache.set(url, html);
    return html;
}

// ─── Lifecycle registry ───────────────────────────────────────────────────────
// associated with a specific container element via WeakMap to prevent pollution.

const _scopes = new WeakMap(); // Element → { mount: [], unmount: [], intervals: [], timeouts: [] }
export let _activeElement = null; // Exported for responder.js to set scope

function _getScope(el) {
    if (!el) return null;
    if (!_scopes.has(el)) {
        _scopes.set(el, { mount: [], unmount: [], intervals: [], timeouts: [] });
    }
    return _scopes.get(el);
}

// ─── Animation hooks (overrideable transitions) ───────────────────────────────

let _hooks = {
    entering: null, // (el) => Promise | void
    leaving:  null, // (el) => Promise | void
    updated:  null, // (el) => Promise | void
};

// ─── CSS class transitions (defaults) ────────────────────────────────────────

const CSS_TRANSITION_MS = 250; // must match oja.css animation durations

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
        const container = _resolve(target);
        if (!container) return;

        // Teardown previous content in this specific container
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

            // Execute scripts — passes container so component scripts have
            // a scoped reference to their own DOM element.
            // Stack pattern ensures nested mounts don't lose parent context.
            const prev = _activeElement;
            _activeElement = container;
            try {
                execScripts(container, url);
            } finally {
                _activeElement = prev;
            }

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
        return el;
    },

    /**
     * Animate an element out, then remove it from the DOM.
     * Use for deleting a row, dismissing a card, etc.
     */
    async remove(target) {
        const el = _resolve(target);
        if (!el) return;

        // Teardown scoped hooks for this subtree
        await this._runUnmount(el);

        await _leave(el);
        el.remove();
    },

    /**
     * Re-render an element with new data and flash a highlight.
     * Use when a value changes and you want the user to notice.
     */
    async update(target, data = {}) {
        const el = _resolve(target);
        if (!el) return;
        fill(el, data);
        await _flash(el);
    },

    /**
     * Pre-fetch and cache a component without mounting it.
     * Call during app init to avoid loading delays on first navigation.
     */
    async prefetch(url) {
        await _load(url);
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

    /**
     * Clear the component HTML cache.
     * Useful during development or after a deploy.
     */
    clearCache(url) {
        if (url) _cache.delete(url);
        else     _cache.clear();
    },

    // ─── Internal — called by router.js ──────────────────────────────────────

    /**
     * Run all onUnmount hooks and clear all registered intervals/timeouts for a scope.
     * @internal
     */
    async _runUnmount(el) {
        const scope = _scopes.get(el);
        if (!scope) return;

        // Clear timers first
        for (const id of scope.intervals) clearInterval(id);
        for (const id of scope.timeouts)  clearTimeout(id);

        // Run user-registered teardown hooks
        for (const fn of scope.unmount) {
            try { await fn(); } catch (e) {
                console.warn('[oja/component] onUnmount hook error:', e);
            }
        }

        // Clean up the WeakMap
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