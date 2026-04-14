/**
 * oja/layout.js
 * Persistent layout shells — nav, sidebar, header, footer — that survive
 * navigation while only the inner content slot is swapped by the router.
 *
 * The key distinction from component.js:
 *   component.mount() tears down and rebuilds on every navigation.
 *   layout.apply()   mounts once and persists until explicitly replaced
 *                    or the layout name changes.
 *
 * This means layout scripts run once, layout state survives page changes,
 * and the browser does not repaint the entire chrome on every route.
 *
 * ─── Typical structure ────────────────────────────────────────────────────────
 *
 *   <body>
 *     <div id="layout">          ← layout shell lives here
 *       <nav>...</nav>
 *       <main id="app"></main>   ← router outlet lives inside the layout
 *       <footer>...</footer>
 *     </div>
 *   </body>
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { layout } from '../oja/layout.js';
 *
 *   // Legacy (inline script, execScripts path):
 *   await layout.apply('#layout', 'layouts/main.html', { user });
 *
 *   // Modern (ESM module function, minifiable, DI-enabled):
 *   await layout.apply('#layout', () => import('./layouts/main.js'), 'layouts/main.html', { user });
 *   router.start('/dashboard');
 *
 * ─── Multiple layouts ─────────────────────────────────────────────────────────
 *
 *   // Switch to a different layout (e.g. for auth pages)
 *   await layout.apply('#layout', 'layouts/auth.html');
 *
 *   // Oja detects the URL has changed and replaces the shell;
 *   // if the same URL is requested again the shell is reused as-is.
 *
 * ─── Updating data without remounting ────────────────────────────────────────
 *
 *   // Re-fill data-bind attributes in the current layout without a full remount.
 *   // Useful for updating the user name in the nav after profile changes.
 *   layout.update({ user: updatedUser });
 *
 * ─── Dependency injection (layout.apply with JS) ──────────────────────────────
 *
 *   // In your layout module function:
 *   export default async function({ provide, ready }) {
 *       provide('api',   new Api({ base: getHost() }));
 *       provide('store', store);
 *       ready();
 *   }
 *
 *   // In any child page mounted by Out.module:
 *   export default async function({ inject, find, ready }) {
 *       const api   = inject('api');
 *       const store = inject('store');
 *       const data  = await api.get('/hosts');
 *       ready();
 *   }
 *
 * ─── Layout-scoped lifecycle ─────────────────────────────────────────────────
 *
 *   // Inside a layout script — these persist for the lifetime of the layout,
 *   // not just a single page render.
 *   layout.onUnmount(() => closeLayoutWebSocket());
 *
 * ─── Layout-scoped timers ─────────────────────────────────────────────────────
 *
 *   // Repeating timer — cleared automatically when the layout is unmounted.
 *   // Mirrors component.interval() but scoped to the layout lifetime.
 *   layout.interval(pollMetrics, 2000);
 *
 *   // One-shot timer — also cleared on unmount.
 *   layout.timeout(() => notify.warn('Slow load?'), 5000);
 *
 * ─── Named slots ─────────────────────────────────────────────────────────────
 *
 *   await layout.slot('sidebar', Out.c('components/sidebar.html', { items }));
 *   await layout.slot('breadcrumb', Out.h('<a href="/">Home</a> / Hosts'));
 *
 * ─── Arbitrary injection ──────────────────────────────────────────────────────
 *
 *   await layout.inject('#toolbar-extra', Out.c('components/filter.html'));
 *   await layout.inject('.breadcrumb', Out.h('<a href="/">Home</a> / Settings'));
 *
 * ─── Lifecycle hooks ──────────────────────────────────────────────────────────
 *
 *   // Inside a layout script — scoped to layout lifetime, not page lifetime
 *   layout.onUnmount(() => ws.close());
 *
 *   // After all slots are filled and scripts have run
 *   layout.onReady(() => runPreview());
 *
 * ─── Router integration ───────────────────────────────────────────────────────
 *
 *   // Use as router middleware to switch layouts per route group
 *   const authGroup = router.Group('/');
 *   authGroup.Use(layout.middleware('layouts/main.html', '#layout'));
 *   authGroup.Get('dashboard', Out.c('pages/dashboard.html'));
 *
 *   const publicGroup = router.Group('/');
 *   publicGroup.Use(layout.middleware('layouts/auth.html', '#layout'));
 *   publicGroup.Get('login', Out.c('pages/login.html'));
 */

import { render, fill }  from './template.js';
import { execScripts }   from './_exec.js';
import { emit }          from './events.js';
import { Out, _setLayoutInjectorHook } from './out.js';

// Tracks the active layout per container element.
const _active = new Map(); // containerEl → { url, unmountHooks, readyHooks, intervals, timeouts }

// Tracks per-slot ready callbacks registered via allSlotsReady()
const _slotReadyMap = new Map(); // slotName → resolve[]

// Set during apply() so onUnmount/onReady/interval/timeout called inside layout
// scripts know which container's entry to register against.
let _currentContainer = null;

export const layout = {

    /**
     * Mount a layout shell into a container, or reuse it if the same URL
     * is already mounted. Awaits script execution before resolving.
     *
     * @param {string|Element} target  — CSS selector or DOM element
     * @param {string}         url     — path to the layout .html file
     * @param {Object}         data    — data passed to template interpolation
     * @returns {Promise<Element>}
     */
    /**
     * Mount a layout shell — the persistent chrome that wraps all pages.
     *
     * Accepts any combination of HTML template and JS module:
     *
     *   // HTML only
     *   await layout.apply('#shell', 'layouts/shell.html');
     *
     *   // HTML + JS module (either argument order)
     *   await layout.apply('#shell', 'layouts/shell.html', 'layouts/shell.js');
     *   await layout.apply('#shell', 'layouts/shell.js', 'layouts/shell.html');
     *
     *   // HTML + factory function
     *   await layout.apply('#shell', 'layouts/shell.html', () => import('./layouts/shell.js'));
     *
     *   // HTML + inline async function
     *   await layout.apply('#shell', 'layouts/shell.html', async ({ find, provide, ready }) => { ... });
     *
     *   // Object form
     *   await layout.apply('#shell', { html: 'layouts/shell.html', js: 'layouts/shell.js', data: { user } });
     *
     *   // With data
     *   await layout.apply('#shell', 'layouts/shell.html', 'layouts/shell.js', { user });
     *
     * The JS default export receives a scope object:
     *   { container, find, findAll, provide, onUnmount, onReady, ready, signal }
     *
     * @param {string|Element} target
     * @param {string|Function|Object} a  — html url, js url, factory fn, or object form
     * @param {string|Function}        [b] — html url, js url, or factory fn
     * @param {Object}                 [data]
     */
    async apply(target, a, b, data = {}) {
        const container = _resolve(target);
        if (!container) return null;

        // Normalise arguments
        let htmlUrl = null, jsArg = null;

        if (a && typeof a === 'object' && !Array.isArray(a) && !(a instanceof Function)) {
            if ('html' in a || 'js' in a) {
                // Object form: { html, js, data }
                ({ html: htmlUrl = null, js: jsArg = null, data = {} } = a);
            } else {
                // Module object passed directly: { default: fn }
                jsArg = a;
            }
        } else {
            // Positional — classify each arg by type / extension
            for (const arg of [a, b]) {
                if (!arg) continue;
                if (typeof arg === 'function') {
                    jsArg = arg;
                } else if (typeof arg === 'string') {
                    const ext = arg.split('.').pop().toLowerCase();
                    if (ext === 'html' || ext === 'htm') htmlUrl = arg;
                    else jsArg = arg; // .js / .mjs / .ts → JS
                }
            }
            // If b is a plain object it's the data arg
            if (b && typeof b === 'object' && !(b instanceof Function) && !Array.isArray(b)
                && typeof a === 'string') {
                data = b;
                jsArg = null; // b was data, not js
                // re-classify a
                const ext = a.split('.').pop().toLowerCase();
                if (ext === 'html' || ext === 'htm') { htmlUrl = a; }
                else { jsArg = a; htmlUrl = null; }
            }
        }

        // Wrap a JS URL string as a dynamic import factory
        if (typeof jsArg === 'string') {
            const url = jsArg;
            jsArg = () => import(/* @vite-ignore */ url);
        }

        // Cache key — include js identity so remount fires when js changes
        const cacheKey = [htmlUrl, typeof jsArg === 'function' ? jsArg.toString().slice(0, 60) : ''].join('|');

        const current = _active.get(container);

        // Reuse if identical layout already mounted
        if (current && current.url === cacheKey && !jsArg) {
            if (Object.keys(data).length > 0) fill(container, data);
            return container;
        }

        if (current) await _teardown(container);

        // Render HTML
        if (htmlUrl) {
            const html = await _fetchLayout(htmlUrl);
            container.innerHTML = render(html, data);
            fill(container, data);
        }

        const controller = new AbortController();
        _active.set(container, {
            url:          cacheKey,
            provided:     new Map(),
            unmountHooks: [],
            readyHooks:   [],
            intervals:    [],
            timeouts:     [],
            controller,
        });
        _currentContainer = container;

        // Execute JS
        if (jsArg) {
            // Build scope
            const _unsubs = [];

            // on(selectorOrEl, event, handler) — scoped to container, auto-cleaned on unmount.
            //   on('.nav-link', 'click', handler) — delegates within container
            //   on(someElement, 'click', handler) — direct listener
            // Returns an unsub for early removal.
            const on = (selectorOrEl, event, handler) => {
                let unsub;
                if (typeof selectorOrEl === 'string') {
                    const wrapped = (e) => {
                        if (!e.target?.closest) return;
                        const target = e.target.closest(selectorOrEl);
                        if (target && container.contains(target)) handler(e, target);
                    };
                    container.addEventListener(event, wrapped);
                    unsub = () => container.removeEventListener(event, wrapped);
                } else if (selectorOrEl instanceof EventTarget) {
                    selectorOrEl.addEventListener(event, handler);
                    unsub = () => selectorOrEl.removeEventListener(event, handler);
                } else {
                    return () => {};
                }
                _unsubs.push(unsub);
                return unsub;
            };

            const off = (unsub) => {
                unsub?.();
                const idx = _unsubs.indexOf(unsub);
                if (idx !== -1) _unsubs.splice(idx, 1);
            };

            const scope = {
                container,
                data,
                find:      (sel) => container.querySelector(sel),
                findAll:   (sel) => Array.from(container.querySelectorAll(sel)),
                on,
                off,
                provide:   (key, val) => {
                    const entry = _active.get(container);
                    if (entry) entry.provided.set(key, val);
                    else console.warn('[oja/layout] provide() called after layout was unmounted');
                },
                onUnmount: (fn) => layout.onUnmount(fn),
                onReady:   (fn) => layout.onReady(fn),
                get signal() { return controller.signal; },
                ready: () => {},
            };

            // Resolve fn: factory (fn.length===0 + returns module namespace) → use .default
            //             inline fn (fn.length>=1) → call directly
            //             module object → use .default
            let fn = jsArg;
            try {
                if (fn && typeof fn === 'object') {
                    fn = fn.default ?? fn;
                } else if (typeof fn === 'function' && fn.length === 0) {
                    const mod = await fn();
                    const isNamespace = mod !== null && mod !== undefined && typeof mod === 'object' &&
                        (mod[Symbol.toStringTag] === 'Module' || 'default' in mod);
                    if (isNamespace) fn = mod.default;
                }
            } catch (e) {
                console.error('[oja/layout] layout.apply() failed to resolve module:', e);
                _currentContainer = null;
                return container;
            }

            if (typeof fn === 'function') {
                try { await fn(scope); }
                catch (e) { console.error('[oja/layout] layout.apply() function threw:', e); }
            } else if (jsArg) {
                console.error('[oja/layout] layout.apply() could not resolve a function from:', jsArg);
            }

            // Auto-clean any listeners registered via scope.on() when layout unmounts
            layout.onUnmount(() => { _unsubs.forEach(u => u()); _unsubs.length = 0; });
        } else if (htmlUrl) {
            // HTML-only path: execute any inline <script> tags (legacy)
            await execScripts(container, htmlUrl);
        }

        _currentContainer = null;

        // Fire onReady hooks
        const entry = _active.get(container);
        if (entry?.readyHooks?.length) {
            for (const hook of entry.readyHooks) {
                try { await hook(); } catch (e) {
                    console.warn('[oja/layout] onReady hook error:', e);
                }
            }
        }

        emit('layout:mounted', { url: htmlUrl || cacheKey, container });
        return container;
    },

    /**
     * Re-fill data-bind attributes in the current layout without remounting.
     *
     * @param {string|Element} target — layout container (defaults to last applied)
     * @param {Object}         data   — new data to fill
     */
    update(target, data = {}) {
        if (target && typeof target === 'object' && !(target instanceof Element) && !_isSelector(target)) {
            data   = target;
            target = _lastContainer();
        }
        const container = _resolve(target);
        if (!container || !_active.has(container)) return this;
        fill(container, data);
        emit('layout:updated', { container });
        return this;
    },

    /**
     * Signal that a slot's async setup is complete.
     * Called by slot scripts as their last statement after all listeners,
     * effects, and imports are registered. Resolves the corresponding
     * allSlotsReady() promise entry.
     *
     * The __oja_ready__ function injected by _exec.js calls this automatically
     * when a slot script calls layout.slotReady(name) as its final line.
     *
     *   // At the end of a slot script:
     *   layout.slotReady('editor');
     *
     * @param {string} name — must match the slot name used in layout.slot()
     */
    slotReady(name) {
        const cbs = _slotReadyMap.get(name);
        if (cbs) {
            cbs.forEach(resolve => resolve());
            _slotReadyMap.delete(name);
        }
        import('./events.js').then(({ emit }) => emit('layout:slot-ready', { name })).catch(() => {});
    },

    /**
     * Wait for multiple slots to signal readiness via slotReady().
     * Resolves only when all named slots have called layout.slotReady().
     * Use this in app.js after layout.slot() calls to ensure all slot
     * scripts have finished their async setup before loading content.
     *
     *   await layout.allSlotsReady(['nav', 'sidebar', 'editor', 'render']);
     *   // Now safe — all listen() handlers are registered
     *   await loadNoteContent(activeNote());
     *
     * @param {string[]} names     — slot names to wait for
     * @param {number}   [timeout] — ms before rejecting (default 10000)
     * @returns {Promise<void>}
     */
    allSlotsReady(names, timeout = 10000, options = {}) {
        if (!names?.length) return Promise.resolve();

        // onTimeout: 'reject' (default) | 'resolve'
        // Use 'resolve' on slow connections where a timeout should degrade
        // gracefully rather than crash the init sequence:
        //   await allSlotsReady(['nav','editor','sidebar'], 10000, { onTimeout: 'resolve' })
        const onTimeout = options.onTimeout ?? 'reject';
        const pending = new Set(names);

        return new Promise((resolve, reject) => {
            let unsub = () => {};

            const timer = setTimeout(() => {
                unsub();
                const msg = `[oja/layout] Slot ready timeout — still waiting: ${[...pending].join(', ')}`;
                if (onTimeout === 'resolve') {
                    console.warn(msg + '. Proceeding anyway.');
                    resolve();
                } else {
                    reject(new Error(msg));
                }
            }, timeout);

            const check = (name) => {
                if (!pending.has(name)) return;
                pending.delete(name);
                if (pending.size === 0) { clearTimeout(timer); unsub(); resolve(); }
            };

            // Primary path: layout.slotReady(name) called directly from script
            for (const name of names) {
                if (!_slotReadyMap.has(name)) _slotReadyMap.set(name, []);
                _slotReadyMap.get(name).push(() => check(name));
            }

            // Secondary path: emit('layout:slot-ready', { name }) on the event bus.
            // Some components prefer emit() over importing layout directly.
            // Both mechanisms resolve the same pending set — whichever fires first wins.
            import('./events.js').then(({ listen }) => {
                unsub = listen('layout:slot-ready', ({ name }) => {
                    if (names.includes(name)) check(name);
                });
            }).catch(() => {});
        });
    },

    /**
     * Render an Out into a named [data-slot="name"] element inside the layout.
     * Awaits script execution in the slotted content before resolving.
     *
     * @param {string}         name      — slot name matching data-slot attribute
     * @param {Out|string}     content   — Out instance or HTML string
     * @param {string|Element} [target]  — layout container (defaults to last applied)
     */
    async slot(name, content, target) {
        const container = _resolve(target) || _lastContainer();
        if (!container) {
            console.warn('[oja/layout] slot() called but no layout is mounted');
            return this;
        }

        const slotEl = container.querySelector(`[data-slot="${name}"]`);
        if (!slotEl) {
            console.warn(`[oja/layout] slot "${name}" not found in layout`);
            return this;
        }

        if (Out.is(content)) {
            await content.render(slotEl, {});
        } else if (typeof content === 'string') {
            slotEl.innerHTML = content;
            await execScripts(slotEl, null);
        } else {
            console.warn(`[oja/layout] slot() content must be an Out or HTML string`);
        }

        emit('layout:slot', { name, container });
        return this;
    },

    /**
     * Inject an Out or HTML string into any element matched by selector.
     * Unlike slot(), which targets [data-slot] attributes, inject() targets
     * any CSS selector and awaits script execution in the injected content.
     *
     *   await layout.inject('#toolbar-extra', Out.c('components/filter.html'));
     *   await layout.inject('.breadcrumb', Out.h('<a href="/">Home</a> / Users'));
     *
     * @param {string}         selector  — CSS selector for the target element
     * @param {Out|string}     content   — Out instance or HTML string
     * @param {string|Element} [target]  — layout container (defaults to last applied)
     */
    async inject(selector, content, target) {
        const container = _resolve(target) || _lastContainer();
        if (!container) {
            console.warn('[oja/layout] inject() called but no layout is mounted');
            return this;
        }

        const el = container.querySelector(selector);
        if (!el) {
            console.warn(`[oja/layout] inject() target not found: ${selector}`);
            return this;
        }

        if (Out.is(content)) {
            await content.render(el, {});
        } else if (typeof content === 'string') {
            el.innerHTML = content;
            await execScripts(el, null);
        } else {
            console.warn(`[oja/layout] inject() content must be an Out or HTML string`);
        }

        emit('layout:injected', { selector, container });
        return this;
    },

    /**
     * Register a repeating timer scoped to the layout lifetime.
     * Cleared automatically when the layout is unmounted — no manual cleanup needed.
     * Must be called from inside a layout script. Mirrors component.interval().
     *
     *   layout.interval(pollMetrics, 2000);
     *
     * @param {Function} fn — function to call on each tick
     * @param {number}   ms — interval in milliseconds
     * @returns {number}    — interval ID (can be passed to clearInterval if needed early)
     */
    interval(fn, ms) {
        const id    = setInterval(fn, ms);
        const entry = _active.get(_currentContainer);
        if (entry) {
            entry.intervals.push(id);
        } else {
            console.warn(
                '[oja/layout] interval() called outside a layout script — ' +
                'the timer will run forever and never be cleared. ' +
                'Call layout.interval() synchronously at the top level of a layout script.'
            );
        }
        return id;
    },

    /**
     * Register a one-shot timer scoped to the layout lifetime.
     * Cleared automatically when the layout is unmounted — no manual cleanup needed.
     * Must be called from inside a layout script. Mirrors component.timeout().
     *
     *   layout.timeout(() => notify.warn('Slow load?'), 5000);
     *
     * @param {Function} fn — function to call after delay
     * @param {number}   ms — delay in milliseconds
     * @returns {number}    — timeout ID (can be passed to clearTimeout if needed early)
     */
    timeout(fn, ms) {
        const id    = setTimeout(fn, ms);
        const entry = _active.get(_currentContainer);
        if (entry) {
            entry.timeouts.push(id);
        } else {
            console.warn(
                '[oja/layout] timeout() called outside a layout script — ' +
                'the timer will run and never be tracked for cleanup. ' +
                'Call layout.timeout() synchronously at the top level of a layout script.'
            );
        }
        return id;
    },

    /**
     * Register a hook to run after layout scripts have executed.
     * When called inside a layout script, fires after apply() completes.
     * When called outside a layout script, fires on the next layout:mounted event.
     *
     *   await Promise.all([layout.slot('nav', ...), layout.slot('editor', ...)]);
     *   layout.onReady(() => runPreview());
     */
    onReady(fn) {
        if (!_currentContainer) {
            document.addEventListener('layout:mounted', () => fn(), { once: true });
            return this;
        }
        const entry = _active.get(_currentContainer);
        if (entry) {
            if (!entry.readyHooks) entry.readyHooks = [];
            entry.readyHooks.push(fn);
        }
        return this;
    },

    /**
     * Register a hook to run when the layout is replaced or unmounted.
     * Must be called from inside a layout script.
     *
     *   layout.onUnmount(() => ws.close());
     */
    onUnmount(fn) {
        if (!_currentContainer) {
            console.warn(
                '[oja/layout] onUnmount() called outside a layout script.\n' +
                'layout.onUnmount(), layout.interval(), and layout.timeout() must be ' +
                'called synchronously at the top level of a layout <script> tag — ' +
                'not inside component.onMount(), setTimeout(), or any async callback.\n' +
                'Oja captures the active layout context only while the script executes. ' +
                'By the time any callback runs, that context is gone.\n' +
                'Fix: move layout.onUnmount() to the root of the layout script, ' +
                'before any async calls.'
            );
            return this;
        }
        const entry = _active.get(_currentContainer);
        if (entry) entry.unmountHooks.push(fn);
        return this;
    },

    /**
     * Explicitly unmount the layout from a container and run teardown hooks.
     *
     * @param {string|Element} [target] — layout container (defaults to last applied)
     */
    async unmount(target) {
        const container = _resolve(target) || _lastContainer();
        if (!container) return this;
        await _teardown(container);
        container.innerHTML = '';
        return this;
    },

    /**
     * Returns the URL of the currently mounted layout for a container.
     *
     * @param {string|Element} [target] — layout container (defaults to last applied)
     */
    current(target) {
        const container = _resolve(target) || _lastContainer();
        if (!container) return null;
        return _active.get(container)?.url || null;
    },

    /**
     * AbortSignal tied to the current layout's lifetime.
     * Automatically aborted when the layout is unmounted.
     * Use to cancel in-flight fetches when the user navigates away.
     *
     *   const data = await fetch('/api/data', { signal: layout.signal }).then(r => r.json());
     *
     * Returns null when called outside a layout script.
     */
    get signal() {
        const entry = _active.get(_currentContainer);
        return entry?.controller?.signal ?? null;
    },

    // Returns true if a layout is currently mounted in the given container.
    isMounted(target) {
        const container = _resolve(target) || _lastContainer();
        return container ? _active.has(container) : false;
    },

    /**
     * Router middleware factory — switches layouts automatically per route group.
     * Only remounts when the layout URL changes.
     *
     *   const app = router.Group('/');
     *   app.Use(layout.middleware('layouts/main.html', '#layout'));
     */
    middleware(url, container, data = {}) {
        return async (ctx, next) => {
            await layout.apply(container, url, { ...data, ...ctx });
            await next();
        };
    },

    /**
     * Returns an inject function bound to the active layout's provided Map.
     * Called by _ModuleOut.render() to pass inject() into page scope.
     *
     * inject(key) returns the value registered by provide(key, val) in the
     * layout module function, or undefined if not found.
     *
     * @param {string|Element} [target] — layout container (defaults to last applied)
     * @returns {Function} inject — (key: string) => any
     */
    // Clear the HTML template cache — useful in tests or after hot-reload.
    clearCache(url) {
        if (url) _htmlCache.delete(url);
        else     _htmlCache.clear();
        return this;
    },

    injector(target) {
        const container = _resolve(target) || _lastContainer();
        if (!container || !_active.has(container)) return (_key) => undefined;
        const provided = _active.get(container).provided;
        if (!provided) return (_key) => undefined;
        return (key) => provided.get(key);
    },

};

const _htmlCache = new Map();

async function _fetchLayout(url) {
    if (_htmlCache.has(url)) return _htmlCache.get(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`[oja/layout] failed to load: ${url} (${res.status})`);
    const html = await res.text();
    _htmlCache.set(url, html);
    return html;
}

async function _teardown(container) {
    const entry = _active.get(container);
    if (!entry) return;

    // Abort any in-flight fetches that were given this layout's signal.
    // This fires before unmount hooks so hooks can react to the abort if needed.
    entry.controller?.abort();

    for (const id of entry.intervals) clearInterval(id);
    for (const id of entry.timeouts)  clearTimeout(id);

    for (const fn of entry.unmountHooks) {
        try { await fn(); } catch (e) {
            console.warn('[oja/layout] onUnmount hook error:', e);
        }
    }
    _active.delete(container);
    emit('layout:unmounted', { url: entry.url, container });
}

function _lastContainer() {
    if (_active.size === 0) return null;
    const keys = Array.from(_active.keys());
    return keys[keys.length - 1];
}

function _resolve(target) {
    if (!target) return null;
    if (target instanceof Element) return target;
    if (typeof target === 'string') {
        const el = document.querySelector(target);
        if (!el) console.warn(`[oja/layout] container not found: ${target}`);
        return el;
    }
    return null;
}

function _isSelector(value) {
    return typeof value === 'string';
}

// Wire the layout injector hook into out.js so _ModuleOut.render() can call
// layout.injector() without creating a circular import dependency.
_setLayoutInjectorHook(() => layout.injector());
// allSlotsReady is available as layout.allSlotsReady() and also as a named export
// so apps can import it directly: import { allSlotsReady } from './layout.js'
export function allSlotsReady(names, timeout = 10000, options = {}) {
    return layout.allSlotsReady(names, timeout, options);
}
