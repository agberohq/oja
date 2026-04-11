/**
 * oja/out.js
 * The universal display primitive — describes WHAT to show without rendering
 * it immediately. Lazy by design: an Out is just a description until
 * .render(container) is called.
 *
 * The rule: anywhere in Oja that produces visible output, the answer is
 * always an Out. No raw HTML strings. No ad-hoc innerHTML injection.
 * One primitive, composable, lazy, typed.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { Out } from '../oja/out.js';
 *
 *   router.Get('/hosts', Out.component('pages/hosts.html'));
 *   router.NotFound(Out.component('pages/404.html'));
 *   modal.open('confirm', { body: Out.component('components/confirm.html', data) });
 *   notify.show(Out.html('<strong>Deploy complete</strong>'));
 *   notify.show(Out.text('Saved'));
 *
 * ─── Static factory types ─────────────────────────────────────────────────────
 *
 *   Out.component(url, data?, lists?, options?)  — fetch + render an .html file
 *   Out.html(string)                             — raw HTML string, with script execution
 *   Out.raw(string)                              — raw HTML string, no script execution
 *   Out.text(string)                             — plain text (auto-escaped)
 *   Out.svg(stringOrUrl, options?)               — SVG inline or fetched from URL
 *   Out.image(url, options?)                     — <img> with loading, alt, etc.
 *   Out.link(url, label?, options?)              — <a> anchor
 *   Out.fn(asyncFn, options?)                    — lazy async, called at render time
 *   Out.empty()                                  — renders nothing (explicit no-op)
 *   Out.segment(name, data?)                     — render an in-document <template data-oja-segment>
 *
 * ─── Fluent API — Out.to() ────────────────────────────────────────────────────
 *
 *   Out.to(target) returns an OutTarget — a chainable object that renders directly
 *   into a DOM element. target is a CSS selector string or an Element.
 *
 *   Content methods — each renders immediately into the target and returns this:
 *     .html(string)                    — innerHTML with script execution
 *     .raw(string)                     — innerHTML without script execution
 *     .text(string)                    — textContent (safe, no HTML)
 *     .component(url, data?, lists?)   — fetch + render an .html file
 *     .image(url, options?)            — <img> element
 *     .svg(svgOrUrl, options?)         — inline SVG or fetched SVG
 *     .link(url, label?, options?)     — <a> anchor
 *     .fn(asyncFn)                     — custom async render function
 *     .empty()                         — clears the target
 *     .segment(name, data?)            — render a registered in-document template
 *
 *   Composition methods — wrap an Out type in conditional or async logic:
 *     .cond(condFn, thenOut, elseOut?) — render thenOut or elseOut based on condFn()
 *     .promise(promise, states)        — three-state: loading / success / error
 *     .list(items, itemFn, options?)   — render one slot per item
 *
 *   Modifier methods — call before a content method, return this:
 *     .with(data)                      — merge data into render context
 *     .when(condFn)                    — skip render entirely if condFn() is false
 *     .animate(name, options?)         — apply named animation on enter/exit
 *     .onError(handler)                — fn(err) => Out shown on render failure
 *     .retry(count)                    — retry failed component loads N times
 *     .skeleton(type, options?)        — show a shimmer placeholder while loading
 *
 *   Event methods — attach listeners to the target element, return this:
 *     .on(event, selector?, handler)   — delegated or direct event listener
 *     .once(event, handler)            — one-shot listener
 *     .whenMounted(fn)                 — fn(el) called after next render completes
 *
 *   Reactive binding:
 *     .bind(signal, renderFn)          — re-renders on signal change via effect()
 *
 *   Scope switching:
 *     .to(newTarget)                   — flush pending render, return new OutTarget
 *
 *   Terminal methods:
 *     .el()                            — returns the resolved DOM element
 *     await .render()                  — waits for pending render to settle
 *
 *   Tagged template literal:
 *     Out.to('#el')`<h1>Hello ${name}!</h1>`
 *     — values are HTML-escaped via _esc(); reactive signals re-render on change.
 *
 *   Examples:
 *
 *     Out.to('#app').html('<h1>Hello</h1>');
 *
 *     Out.to('#app').component('pages/hosts.html', data);
 *
 *     Out.to('#header').component('header.html')
 *       .to('#main').component('content.html')
 *       .to('#footer').component('footer.html');
 *
 *     Out.to('#modal').animate('fadeIn').component('modal.html');
 *
 *     Out.to('#app').with({ user: currentUser }).component('page.html');
 *
 *     Out.to('#panel').when(() => user.isAdmin).component('admin.html');
 *
 *     Out.to('#app')
 *       .onError(err => Out.html(`<p>${err.message}</p>`))
 *       .component('risky.html');
 *
 *     Out.to('#app').retry(3).component('unstable.html');
 *
 *     Out.to('#list').list(
 *       Object.entries(hosts),
 *       ([name, cfg]) => Out.html(renderRow(name, cfg))
 *     );
 *
 *     Out.to('#feed').promise(fetchPosts(), {
 *       loading: Out.c('states/loading.html'),
 *       success: (posts) => Out.list(posts, p => Out.c('components/post.html', p)),
 *       error:   Out.c('states/error.html'),
 *     });
 *
 *     const [count, setCount] = state(0);
 *     Out.to('#counter').bind(count, val => Out.text(`Count: ${val}`));
 *
 *     Out.to('#greeting')`<h1>Hello ${userName}!</h1>`;
 *
 * ─── Composition — static forms ───────────────────────────────────────────────
 *
 *   Out.if(conditionFn, thenOut, elseOut?)
 *     — condition evaluated at render time, not construction time.
 *     Out.if(() => user.isAdmin, Out.c('admin.html'), Out.c('denied.html'))
 *
 *   Out.promise(promise, { loading?, success, error? })
 *     — success may be an Out or a function receiving the resolved value.
 *     Out.promise(fetchUser(id), {
 *         loading: Out.c('states/loading.html'),
 *         success: (user) => Out.c('pages/user.html', user),
 *         error:   Out.c('states/error.html'),
 *     })
 *
 *   Out.list(items, itemFn, options?)
 *     — itemFn(item, index) must return an Out. items may be an array or () => array.
 *     — options.empty: Out shown when items is empty (default: Out.empty())
 *     Out.list(users, (user) => Out.c('components/user.html', user))
 *     Out.list(users, (user) => Out.c('components/user.html', user), {
 *         empty: Out.c('states/no-users.html'),
 *     })
 *
 * ─── Beautiful skeleton loaders ───────────────────────────────────────────────
 *
 *     Out.skeleton('#main', 'table', { lines: 5 })
 *        .component('pages/data-grid.html');
 *
 * ─── Composition — static forms ───────────────────────────────────────────────
 *
 *   Out.if(conditionFn, thenOut, elseOut?)
 *   Out.promise(promise, { loading?, success, error? })
 *   Out.list(items, itemFn, options?)
 *
 * ─── Shorthand aliases ────────────────────────────────────────────────────────
 *
 *   Out.c()  — Out.component()
 *   Out.h()  — Out.html()
 *   Out.t()  — Out.text()
 *
 * ─── Every Out instance has ───────────────────────────────────────────────────
 *
 *   out.render(container, context?)   — renders into a DOM element
 *   await out.output()                 — renders to HTML string (no DOM mount, no scripts)
 *   out.type                          — string identifying the type
 *   out.clone(overrides?)             — returns new Out with merged options
 *   out.prefetch(options?)            — optional preload/prepare logic
 *   out.getText()                     — plain text representation (accessibility)
 *
 * ─── VFS integration ─────────────────────────────────────────────────────────
 *
 *   // Register once in app.js — all Out.component() calls check VFS first
 *   Out.vfsUse(vfs);
 *
 *   // Read back the registered instance
 *   Out.vfsGet();
 */

import { render as templateRender, fill, each } from './template.js';
import { execScripts }                           from './_exec.js';
import { emit }                                  from './events.js';
import { runtime }                               from './runtime.js';
import { effect }                                from './reactive.js';
import { animate }                               from './animate.js';
import { _segmentRender }                        from './segment.js';

// Escape special HTML characters to prevent XSS in tagged template literals.
// Used by createTagHandler when interpolating dynamic values into template strings.
function _esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const _cache    = new Map();
const CACHE_TTL = 60_000;
const CACHE_MAX = 50;

// VFS instance registered via Out.vfsUse() — checked before every network fetch.
let _vfs = null;

// Fetch an HTML file, checking the in-memory cache and VFS before hitting the network.
// vfsOverride lets a single Out instance use a specific VFS without touching the global.
// On a successful network fetch the result is written back to VFS for offline use.
async function _fetchHTML(url, options = {}) {
    const now       = Date.now();
    const cached    = _cache.get(url);
    const activeVfs = options.vfsOverride !== undefined ? options.vfsOverride : _vfs;

    if (cached && (now - cached.timestamp) < CACHE_TTL && !options.bypassCache) {
        _cache.delete(url);
        _cache.set(url, cached);
        emit('out:cache-hit', { url });
        return cached.html;
    }

    if (activeVfs) {
        try {
            const text = await activeVfs.readText(url);
            if (text !== null) {
                _cache.set(url, { html: text, timestamp: now, size: text.length });
                emit('out:vfs-hit', { url });
                return text;
            }
        } catch {
            // VFS miss — fall through to network
        }
    }

    if (options.signal?.aborted) throw new Error('[oja/out] fetch aborted');

    if (!runtime.isOriginAllowed(url)) throw new Error(`[oja/out] blocked origin: ${url}`);

    emit('out:fetch-start', { url });
    const start = performance.now();

    try {
        const fetchOpts = runtime.runFetchHooks(url, { signal: options.signal });
        const res = await fetch(url, fetchOpts);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const html = await res.text();
        const size = new Blob([html]).size;

        while (_cache.size >= CACHE_MAX) {
            _cache.delete(_cache.keys().next().value);
        }
        _cache.set(url, { html, timestamp: now, size });

        if (activeVfs) activeVfs.write(url, html);

        emit('out:fetch-end', { url, ms: performance.now() - start, size });
        return html;
    } catch (e) {
        emit('out:fetch-error', { url, error: e.message });
        throw e;
    }
}

function _deepMerge(target, source) {
    const out = { ...target };
    for (const key of Object.keys(source)) {
        if (
            source[key] !== null &&
            typeof source[key] === 'object' &&
            !Array.isArray(source[key]) &&
            target[key] !== null &&
            typeof target[key] === 'object' &&
            !Array.isArray(target[key])
        ) {
            out[key] = _deepMerge(target[key], source[key]);
        } else {
            out[key] = source[key];
        }
    }
    return out;
}

function _emergencyError(container, message) {
    try {
        container.innerHTML = `<div class="oja-error" role="alert" style="padding:1rem;color:#c00">
            An error occurred and the error display also failed.
            <pre style="margin-top:.5rem;font-size:.8em;opacity:.7">${
            String(message).replace(/</g, '&lt;')
        }</pre>
        </div>`;
    } catch { /* ignore */ }
}

// Resolve an OutTarget target — accepts a CSS selector string or a DOM Element.
// Returns the Element, or null with a console warning if not found.
// Used by OutTarget._resolve() to lazily look up the target element.
function _resolveTarget(target) {
    if (!target) return null;
    if (target instanceof Element) return target;
    if (typeof target === 'string') {
        const el = document.querySelector(target);
        if (!el) console.warn(`[oja/out] target not found: ${target}`);
        return el;
    }
    return null;
}

class _Out {
    constructor(type, payload, options = {}) {
        this.type     = type;
        this._payload = payload;
        this._options = options;
    }

    async render(container, context = {}) {
        throw new Error(`[oja/out] render() not implemented for type: ${this.type}`);
    }

    async prefetch(options = {}) {
        return this;
    }

    clone(overrides = {}) {
        return new this.constructor(this.type, this._payload, { ...this._options, ...overrides });
    }

    getText() {
        return null;
    }

    /**
     * output() — render this Out to an HTML string without mounting into the DOM.
     * Useful for imperative usage: third-party editors, SSR, testing, PDF export.
     */
    async output() {
        const div = document.createElement('div');
        await this.render(div, {});
        return div.innerHTML;
    }

    static is(value) {
        return value instanceof _Out;
    }
}

class _HtmlOut extends _Out {
    constructor(html, options = {}) {
        super('html', html, options);
    }

    async render(container) {
        container.innerHTML = this._payload;
        if (!runtime.isSandboxed()) execScripts(container, null, {});
    }

    getText() {
        const div = document.createElement('div');
        div.innerHTML = this._payload;
        return div.textContent || div.innerText || '';
    }
}

class _RawOut extends _Out {
    constructor(html, options = {}) {
        super('raw', html, options);
    }

    // Insert HTML without executing any inline scripts.
    async render(container) {
        container.innerHTML = this._payload;
    }

    getText() {
        const div = document.createElement('div');
        div.innerHTML = this._payload;
        return div.textContent || div.innerText || '';
    }
}

class _TextOut extends _Out {
    constructor(text, options = {}) {
        super('text', text, options);
    }

    async render(container) {
        container.textContent = this._payload;
    }

    getText() {
        return this._payload;
    }
}

class _SvgOut extends _Out {
    constructor(svg, options = {}) {
        super('svg', svg, options);
    }

    async render(container) {
        if (this._payload.trim().startsWith('<')) {
            container.innerHTML = this._payload;
        } else {
            try {
                const res  = await fetch(this._payload);
                const text = await res.text();
                container.innerHTML = text;
            } catch {
                container.innerHTML = `<img src="${this._payload}" alt="${this._options.alt || ''}" style="max-width:100%">`;
            }
        }
    }

    async prefetch(options = {}) {
        if (!this._payload.trim().startsWith('<') && !options.bypassCache) {
            try {
                await fetch(this._payload, { method: 'HEAD', signal: options.signal });
            } catch (e) {
                if (e.name !== 'AbortError') console.warn('[oja/out] SVG prefetch failed:', e);
            }
        }
        return this;
    }
}

class _ImageOut extends _Out {
    constructor(url, options = {}) {
        super('image', url, options);
    }

    async render(container) {
        const { alt = '', width = '', height = '', className = '', loading = 'lazy' } = this._options;
        const img = document.createElement('img');
        img.src     = this._payload;
        img.loading = loading;
        img.style.maxWidth = '100%';
        if (alt)       img.alt       = alt;
        if (width)     img.width     = width;
        if (height)    img.height    = height;
        if (className) img.className = className;

        container.innerHTML = '';
        container.appendChild(img);

        return new Promise((resolve, reject) => {
            img.onload  = () => { emit('out:image-loaded', { url: this._payload }); resolve(); };
            img.onerror = () => {
                emit('out:image-error', { url: this._payload });
                reject(new Error(`[oja/out] failed to load image: ${this._payload}`));
            };
        });
    }

    async prefetch(options = {}) {
        if (options.bypassCache) return this;
        const img = new Image();
        img.src = this._payload;
        return new Promise((resolve, reject) => {
            img.onload  = resolve;
            img.onerror = reject;
            options.signal?.addEventListener('abort', () => { img.src = ''; reject(new Error('Aborted')); });
        });
    }
}

class _LinkOut extends _Out {
    constructor(url, label, options = {}) {
        super('link', url, options);
        this._label = label || url;
    }

    async render(container) {
        const { target = '_blank', className = '', rel = 'noopener noreferrer' } = this._options;
        const a = document.createElement('a');
        a.href        = this._payload;
        a.textContent = this._label;
        a.target      = target;
        a.rel         = rel;
        if (className) a.className = className;
        container.innerHTML = '';
        container.appendChild(a);
    }

    getText() {
        return this._label;
    }
}

class _ComponentOut extends _Out {
    constructor(url, data = {}, lists = {}, options = {}) {
        super('component', url, options);
        if (typeof url !== 'string') {
            console.warn(
                '[oja/out] _ComponentOut received a non-string url:', url,
                '\nDid you mean .render(Out.text(...)) instead of .component(Out.text(...))?'
            );
        }
        this._data       = data;
        this._lists      = lists;
        this._prefetched = false;
        this._vfs = options.vfs !== undefined ? options.vfs : undefined;
    }

    async render(container, context = {}) {
        const mergedData = { ...context, ...this._data };
        const start      = performance.now();
        const loadingEl  = container.querySelector('[data-loading]');
        const errorEl    = container.querySelector('[data-error]');

        if (loadingEl) loadingEl.style.display = '';
        if (errorEl)   errorEl.style.display   = 'none';

        try {
            const html = await _fetchHTML(this._payload, {
                bypassCache:  this._options.bypassCache,
                vfsOverride:  this._vfs,
            });

            container.innerHTML = templateRender(html, mergedData);
            fill(container, mergedData);

            if (Object.keys(this._lists).length > 0) {
                for (const [name, items] of Object.entries(this._lists)) {
                    each(container, name, items);
                }
            }

            const { component } = await import('./component.js');
            const oldActive = component._activeElement;
            component._activeElement = container;
            try {
                if (!runtime.isSandboxed()) execScripts(container, this._payload, mergedData);
            } finally {
                component._activeElement = oldActive;
            }

            emit('out:component-rendered', {
                url: this._payload,
                ms: performance.now() - start,
                hasData: Object.keys(mergedData).length,
            });

        } catch (e) {
            console.error(`[oja/out] component load failed: ${this._payload}`, e);

            if (errorEl) {
                errorEl.style.display = '';
                if (loadingEl) loadingEl.style.display = 'none';
            } else if (this._options.error) {
                const isNetworkError   = e instanceof TypeError;
                const errorIsComponent = this._options.error.type === 'component';

                if (isNetworkError && errorIsComponent) {
                    console.warn('[oja/out] network down — skipping component error Out to avoid double fetch');
                    _emergencyError(container, e.message);
                } else {
                    try {
                        await this._options.error.render(container, { error: e.message });
                    } catch (e2) {
                        console.error('[oja/out] error Out also threw — using emergency fallback:', e2);
                        _emergencyError(container, e.message);
                    }
                }
            } else {
                container.innerHTML = `
                    <div class="oja-error" role="alert">
                        Failed to load component.
                        <button onclick="this.closest('.oja-error').dispatchEvent(
                            new CustomEvent('oja:retry', { bubbles: true })
                        )">Retry</button>
                    </div>`;
            }
            throw e;
        }
    }

    async prefetch(options = {}) {
        if (this._prefetched) return this;
        try {
            await _fetchHTML(this._payload, {
                signal:      options.signal,
                bypassCache: options.bypassCache,
                vfsOverride: this._vfs,
            });
            this._prefetched = true;
            emit('out:component-prefetched', { url: this._payload });
        } catch (e) {
            if (e.name !== 'AbortError') console.warn(`[oja/out] prefetch failed: ${this._payload}`, e);
        }
        return this;
    }

    withData(data) {
        return new _ComponentOut(this._payload, _deepMerge(this._data, data), this._lists, this._options);
    }

    withLists(lists) {
        return new _ComponentOut(this._payload, this._data, { ...this._lists, ...lists }, this._options);
    }
}

class _FnOut extends _Out {
    constructor(fn, options = {}) {
        super('fn', fn, options);
    }

    async render(container, context = {}) {
        try {
            // Attach the navigation AbortSignal to the container so Out.fn()
            // callbacks can do: const res = await fetch('/api', { signal: container.signal })
            // The signal is automatically aborted when the next navigation starts.
            if (context.signal && !container.signal) {
                Object.defineProperty(container, 'signal', {
                    value: context.signal, configurable: true, writable: true,
                });
            }
            const result = await this._payload(container, context);
            if (_Out.is(result)) {
                await result.render(container, context);
            } else if (typeof result === 'function') {
                try {
                    const { component } = await import('./component.js');
                    if (component._activeElement) {
                        component.onUnmount(result);
                    } else {
                        document.addEventListener('oja:navigate', result, { once: true });
                    }
                } catch {
                    document.addEventListener('oja:navigate', result, { once: true });
                }
            } else if (typeof result === 'string') {
                container.innerHTML = result;
                if (!runtime.isSandboxed()) execScripts(container, null, {});
            }
        } catch (e) {
            console.error('[oja/out] fn Out threw:', e);
            if (this._options.error) {
                try {
                    await this._options.error.render(container, { error: e.message });
                } catch (e2) {
                    _emergencyError(container, e.message);
                }
            } else {
                container.innerHTML = `<div class="oja-error" role="alert">${
                    String(e.message).replace(/</g, '&lt;')
                }</div>`;
            }
        }
    }

    async prefetch(options = {}) {
        if (this._payload.prefetch) await this._payload.prefetch(options);
        return this;
    }
}

class _EmptyOut extends _Out {
    constructor() { super('empty', null); }
    async render(container) { container.innerHTML = ''; }
    getText() { return ''; }
}

class _IfOut extends _Out {
    constructor(conditionFn, thenOut, elseOut, options = {}) {
        super('if', conditionFn, options);
        this._then = thenOut;
        this._else = elseOut || new _EmptyOut();
    }

    async render(container, context = {}) {
        const branch = this._payload(context) ? this._then : this._else;
        await branch.render(container, context);
    }

    async prefetch(options = {}) {
        await Promise.allSettled([
            this._then.prefetch(options),
            this._else.prefetch(options),
        ]);
        return this;
    }
}

class _PromiseOut extends _Out {
    constructor(promise, states, options = {}) {
        super('promise', promise, options);
        this._loading = states.loading || new _EmptyOut();
        this._success = states.success;
        this._error   = states.error   || new _EmptyOut();
    }

    async render(container, context = {}) {
        await this._loading.render(container, context);

        try {
            const value = await this._payload;

            const successOut = typeof this._success === 'function'
                ? this._success(value)
                : this._success;

            if (!successOut) {
                container.innerHTML = '';
                return;
            }
            await successOut.render(container, { ...context, ...( typeof value === 'object' && value !== null ? value : { value }) });
        } catch (e) {
            const errorOut = typeof this._error === 'function'
                ? this._error(e)
                : this._error;

            await errorOut.render(container, { ...context, error: e.message });
        }
    }
}

class _ListOut extends _Out {
    constructor(items, itemFn, options = {}) {
        super('list', items, options);
        this._itemFn = itemFn;
        this._emptyOut = options.empty || new _EmptyOut();
    }

    async render(container, context = {}) {
        const items = typeof this._payload === 'function'
            ? this._payload()
            : this._payload;

        if (!items || items.length === 0) {
            await this._emptyOut.render(container, context);
            return;
        }

        if (this._options.key) {
            const { listAsync } = await import('./engine.js');
            const itemFn = this._itemFn;
            await listAsync(container, items, {
                key:    this._options.key,
                keyAttr: 'data-list-key',
                render: async (item, existingEl) => {
                    const slot    = existingEl || document.createElement('div');
                    const itemOut = itemFn(item);
                    if (!_Out.is(itemOut)) {
                        throw new Error(`[oja/out] Out.list() itemFn must return an Out (got ${typeof itemOut})`);
                    }
                    await itemOut.render(slot, { ...context, item });
                    return slot;
                },
                empty: this._options.empty
                    ? async () => {
                        const el = document.createElement('div');
                        await this._options.empty.render(el, context);
                        return el;
                    }
                    : null,
            });
            return;
        }

        container.innerHTML = '';

        await Promise.all(items.map(async (item, index) => {
            const slot = document.createElement('div');
            slot.dataset.listIndex = index;
            container.appendChild(slot);

            const itemOut = this._itemFn(item, index);
            if (!_Out.is(itemOut)) {
                throw new Error(`[oja/out] Out.list() itemFn must return an Out (got ${typeof itemOut} at index ${index})`);
            }
            await itemOut.render(slot, { ...context, item, index });
        }));
    }
}

function _buildSkeletonHtml(type, opts) {
    const lines = opts.lines || 3;
    let html = '';

    if (type === 'card') {
        html = `<div class="oja-skel-row">
                    <div class="oja-skel-avatar"></div>
                    <div style="flex:1">
                        <div class="oja-skel-title" style="margin-bottom:8px"></div>
                        <div class="oja-skel-line"></div>
                    </div>
                </div>`;
        for (let i = 0; i < lines; i++) html += `<div class="oja-skel-line"></div>`;
    } else if (type === 'table') {
        for (let i = 0; i < lines; i++) {
            html += `<div class="oja-skel-row">
                        <div class="oja-skel-line" style="margin-bottom:0"></div>
                        <div class="oja-skel-line" style="margin-bottom:0"></div>
                        <div class="oja-skel-line" style="margin-bottom:0"></div>
                     </div>`;
        }
    } else {
        for (let i = 0; i < lines; i++) html += `<div class="oja-skel-line"></div>`;
    }

    return `<div class="oja-skeleton-wrapper" aria-busy="true">${html}</div>`;
}

class OutTarget {
    constructor(target, options = {}) {
        this._target       = target;
        this._element      = null;
        this._context      = options.context || {};
        this._animation    = null;
        this._errorHandler = null;
        this._retryCount   = 0;
        this._condition    = null;
        this._skeleton     = null;
        this._listeners    =[];
    }

    _resolve() {
        if (!this._element) {
            this._element = _resolveTarget(this._target);
        }
        return this._element;
    }

    html(content) {
        if (!this._condition || this._condition()) this._render(new _HtmlOut(content));
        return this;
    }

    raw(content) {
        if (!this._condition || this._condition()) this._render(new _RawOut(content));
        return this;
    }

    text(content) {
        if (!this._condition || this._condition()) this._render(new _TextOut(content));
        return this;
    }

    image(url, options = {}) {
        if (!this._condition || this._condition()) this._render(new _ImageOut(url, options));
        return this;
    }

    svg(svg, options = {}) {
        if (!this._condition || this._condition()) this._render(new _SvgOut(svg, options));
        return this;
    }

    link(url, label, options = {}) {
        if (!this._condition || this._condition()) this._render(new _LinkOut(url, label, options));
        return this;
    }

    component(url, data = {}, lists = {}, options = {}) {
        if (!this._condition || this._condition()) {
            const mergedData = { ...this._context, ...data };
            this._render(new _ComponentOut(url, mergedData, lists, { ...options, ...this._options }));
        }
        return this;
    }

    /**
     * Render an external classic-script composite into this target.
     * Accepts all argument forms that Out.composite() does.
     *
     *   Out.to('#app').composite('pages/hosts.html', 'pages/hosts.js');
     *   Out.to('#app').composite('pages/hosts.html', 'pages/hosts.js', 'pages/hosts.css');
     *   Out.to('#app').composite({ html, js, css, data });
     */
    composite(a, b, c, d, e) {
        if (!this._condition || this._condition()) {
            this._render(Out.composite(a, b, c, d, e));
        }
        return this;
    }

    fn(asyncFn, options = {}) {
        if (!this._condition || this._condition()) {
            this._render(new _FnOut(asyncFn, { ...options, ...this._options }));
        }
        return this;
    }

    empty() {
        if (!this._condition || this._condition()) this._render(new _EmptyOut());
        return this;
    }

    /**
     * Set render mode — 'replace' (default), 'append', or 'prepend'.
     * When 'append' or 'prepend', new content is added without clearing existing.
     *
     *   Out.to('#feed').mode('append').component('post.html', newPost)
     *   Out.to('#log').mode('prepend').html('<li>New entry</li>')
     */
    mode(renderMode) {
        this._renderMode = renderMode; // 'replace' | 'append' | 'prepend'
        return this;
    }

    segment(name, data = {}) {
        if (!this._condition || this._condition()) {
            const mergedData = { ...this._context, ...data };
            this._render(new _SegmentOut(name, mergedData));
        }
        return this;
    }

    cond(conditionFn, thenOut, elseOut) {
        if (!this._condition || this._condition()) this._render(new _IfOut(conditionFn, thenOut, elseOut));
        return this;
    }

    promise(promise, states) {
        if (!this._condition || this._condition()) this._render(new _PromiseOut(promise, states));
        return this;
    }

    list(items, itemFn, options = {}) {
        if (!this._condition || this._condition()) this._render(new _ListOut(items, itemFn, options));
        return this;
    }

    animate(animationName, options = {}) {
        this._animation = { name: animationName, options };
        return this;
    }

    skeleton(type = 'text', options = {}) {
        this._skeleton = { type, options };
        return this;
    }

    with(data) {
        this._context = _deepMerge(this._context, data);
        return this;
    }

    when(conditionFn) {
        this._condition = conditionFn;
        return this;
    }

    /**
     * Re-invoke an Out factory on a timer, replacing content each tick.
     * Returns a handle with .stop(). Automatically clears on component unmount
     * via the component scope hook.
     *
     *   Out.to('#stats').poll(() => Out.fn(fetchStats), 5000);
     *
     * @param {Function} outFn   — () => Out  — called each tick
     * @param {number}   intervalMs — milliseconds between updates
     */
    poll(outFn, intervalMs = 5000) {
        if (typeof outFn !== 'function') {
            console.warn('[oja/out] poll() requires a factory function () => Out');
            return this;
        }

        // Render immediately
        const out = outFn();
        if (_Out.is(out)) this._render(out);

        const id = setInterval(() => {
            const next = outFn();
            if (_Out.is(next)) this._render(next);
        }, intervalMs);

        const stop = () => clearInterval(id);

        // Register with component scope for auto-cleanup on unmount

        try { _registerWithActiveComponent?.(stop); } catch {}

        this._pollStop = stop;
        return { stop, target: this };
    }

    onError(handler) {
        this._errorHandler = handler;
        return this;
    }

    retry(count) {
        this._retryCount = count;
        return this;
    }

    morph(html) {
        const el = this._resolve();
        if (!el) return this;
        import('./engine.js').then(({ morph }) => morph(el, html));
        return this;
    }

    bindKey(storeKey, type = 'text', transform) {
        const el = this._resolve();
        if (!el) return this;
        const fnName = `bind${type.charAt(0).toUpperCase() + type.slice(1)}`;
        import('./engine.js').then(mod => {
            if (typeof mod[fnName] === 'function') mod[fnName](el, storeKey, transform);
        });
        return this;
    }

    bind(signal, renderFn) {
        const el = this._resolve();
        if (!el) return this;

        const update = () => {
            const value = typeof signal === 'function' && signal.__isOjaSignal ? signal() : signal;
            const out = renderFn(value);
            if (_Out.is(out)) {
                out.render(el);
            } else if (typeof out === 'string') {
                el.innerHTML = out;
            }
        };

        effect(update);
        update();
        return this;
    }

    on(event, selectorOrHandler, handlerOrOptions, options = {}) {
        const el = this._resolve();
        if (!el) return this;

        let selector = null;
        let handler  = selectorOrHandler;

        if (typeof selectorOrHandler === 'string' && typeof handlerOrOptions === 'function') {
            selector = selectorOrHandler;
            handler  = handlerOrOptions;
            options  = options || {};
        } else if (typeof selectorOrHandler === 'string' && typeof handlerOrOptions === 'object') {
            selector = selectorOrHandler;
            options  = handlerOrOptions;
        }

        const wrappedHandler = (e) => {
            if (!e.target || typeof e.target.closest !== 'function') return;
            if (selector) {
                const target = e.target.closest(selector);
                if (!target || !el.contains(target)) return;
            }
            handler(e);
        };

        el.addEventListener(event, wrappedHandler, options);
        this._listeners.push({ event, handler: wrappedHandler, options });
        return this;
    }

    once(event, handler, options = {}) {
        return this.on(event, handler, { ...options, once: true });
    }

    whenMounted(fn) {
        queueMicrotask(() => {
            const el = this._resolve();
            if (el) fn(el);
        });
        return this;
    }

    // DOM helpers
    // Pure element manipulation — no rendering involved. All return this.

    /** Show the element (restore display). */
    show() {
        const el = this._resolve();
        if (el) el.style.display = '';
        return this;
    }

    /** Hide the element (display:none). */
    hide() {
        const el = this._resolve();
        if (el) el.style.display = 'none';
        return this;
    }

    /** Toggle visibility. Pass force=true/false to set explicitly. */
    toggle(force) {
        const el = this._resolve();
        if (!el) return this;
        const isHidden = getComputedStyle(el).display === 'none';
        const shouldShow = force !== undefined ? force : isHidden;
        el.style.display = shouldShow ? '' : 'none';
        return this;
    }

    /** Add one or more CSS classes. */
    addClass(...classes) {
        const el = this._resolve();
        if (el) el.classList.add(...classes.flat());
        return this;
    }

    /** Remove one or more CSS classes. */
    removeClass(...classes) {
        const el = this._resolve();
        if (el) el.classList.remove(...classes.flat());
        return this;
    }

    /** Toggle a CSS class. Pass force=true/false to set explicitly. */
    toggleClass(cls, force) {
        const el = this._resolve();
        if (el) el.classList.toggle(cls, force);
        return this;
    }

    /** Set or remove an attribute. Pass null/undefined value to remove. */
    attr(name, value) {
        const el = this._resolve();
        if (!el) return this;
        if (value === null || value === undefined) el.removeAttribute(name);
        else el.setAttribute(name, String(value));
        return this;
    }

    /** Apply inline styles from a plain object. */
    css(styles) {
        const el = this._resolve();
        if (el) Object.assign(el.style, styles);
        return this;
    }

    to(target) {
        this._flush();
        return new OutTarget(target, { context: this._context });
    }

    el() {
        return this._resolve();
    }

    async render(out) {
        if (_Out.is(out)) {
            this._render(out);
            if (this._pendingRender) await this._pendingRender;
            return this;
        }
        if (this._pendingRender) await this._pendingRender;
        return this._resolve();
    }

    _render(out) {
        const el = this._resolve();
        if (!el) {
            console.warn('[oja/out] cannot render: target not found');
            return;
        }

        const doRender = async () => {
            try {
                // Animate old content out (only if we aren't replacing it with a skeleton right now)
                if (this._animation && el.firstChild && !this._skeleton) await this._applyAnimation(el, 'out');

                // Inject skeleton synchronously BEFORE awaiting the Out render
                if (this._skeleton) {
                    el.innerHTML = _buildSkeletonHtml(this._skeleton.type, this._skeleton.options);
                }

                // Render new content (e.g. fetches happen inside here)
                // honour render mode
                if (this._renderMode === 'append' || this._renderMode === 'prepend') {
                    const tmp = document.createElement('div');
                    await out.render(tmp, this._context);
                    if (this._renderMode === 'append') {
                        while (tmp.firstChild) el.appendChild(tmp.firstChild);
                    } else {
                        while (tmp.lastChild) el.insertBefore(tmp.lastChild, el.firstChild);
                    }
                } else {
                    await out.render(el, this._context);
                }

                // Animate new content in
                if (this._animation) await this._applyAnimation(el, 'in');
            } catch (err) {
                if (this._errorHandler) {
                    try {
                        const errorOut = this._errorHandler(err);
                        if (_Out.is(errorOut)) {
                            await errorOut.render(el);
                        } else if (typeof errorOut === 'string') {
                            el.innerHTML = errorOut;
                        }
                    } catch {
                        _emergencyError(el, err.message);
                    }
                } else {
                    _emergencyError(el, err.message);
                }

                if (this._retryCount > 0 && out.type === 'component') {
                    this._retryCount--;
                    setTimeout(() => this._render(out), 1000);
                }
            }
        };

        this._pendingRender = doRender();
    }

    async _applyAnimation(el, direction) {
        const { name, options } = this._animation;
        const key = name + (direction === 'in' ? 'In' : 'Out');

        if (animate[name] && direction === 'in')  { await animate[name](el, options); return; }
        if (animate[key])                          { await animate[key](el, options); return; }

        if (name === 'fadeIn'  && direction === 'in')  await animate.fadeIn(el, options);
        if (name === 'fadeOut' && direction === 'out') await animate.fadeOut(el, options);
        if (name === 'slideIn' && direction === 'in')  await animate.slideIn(el, options);
        if (name === 'slideOut'&& direction === 'out') await animate.slideOut(el, options);
    }

    _flush() {
        if (this._pendingRender) {
            this._pendingRender.then(() => { this._pendingRender = null; });
        }
    }
}

// Create tagged template handler for a target.
// Interpolated reactive signals are tracked and re-render on change.
function createTagHandler(target) {
    return function(strings, ...values) {
        let content = '';
        strings.forEach((str, i) => {
            content += str;
            if (i < values.length) {
                const val = values[i];
                if (typeof val === 'function' && val.__isOjaSignal) {
                    content += `{{REACTIVE:${i}}}`;
                } else if (_Out.is(val)) {
                    console.warn('[oja/out] cannot embed Out in template literal, use .component() instead');
                    content += '[Complex content]';
                } else {
                    content += _esc(String(val));
                }
            }
        });

        const targetObj   = new OutTarget(target);
        const hasReactive = values.some(v => typeof v === 'function' && v.__isOjaSignal);

        if (hasReactive) {
            const el = targetObj._resolve();
            if (el) {
                let html = content;
                values.forEach((val, i) => {
                    if (typeof val === 'function' && val.__isOjaSignal) {
                        html = html.replace(`{{REACTIVE:${i}}}`, _esc(String(val())));
                    }
                });
                el.innerHTML = html;

                values.forEach((val) => {
                    if (typeof val === 'function' && val.__isOjaSignal) {
                        effect(() => {
                            let newHtml = '';
                            strings.forEach((str, j) => {
                                newHtml += str;
                                if (j < values.length) {
                                    const v = values[j];
                                    newHtml += (typeof v === 'function' && v.__isOjaSignal)
                                        ? _esc(String(v()))
                                        : _esc(String(v));
                                }
                            });
                            el.innerHTML = newHtml;
                        });
                    }
                });
            }
            return targetObj;
        }

        targetObj.html(content);
        return targetObj;
    };
}

// CSS scoping helpers
// Rewrites `.selector` → `[data-oja-composite="id"] .selector` so composite
// styles are contained to their own container. Handles @media, @supports,
// @layer wrappers correctly. @keyframes and @font-face are left untouched.

const _CSS_AT_PASSTHROUGH = /^@(keyframes|font-face|charset|import|namespace)/i;

function _scopeCSSBlock(block, scopeAttr) {
    // block is the content inside a @media / @supports / @layer { ... } wrapper.
    // We only scope the inner rule-sets, not the at-rule itself.
    return block.replace(/([^{}]+)\{([^{}]*)\}/g, (_m, sel, decl) => {
        const trimmed = sel.trim();
        if (!trimmed || _CSS_AT_PASSTHROUGH.test(trimmed)) return _m;
        const scoped = trimmed.split(',').map(s => `[data-oja-composite="${scopeAttr}"] ${s.trim()}`).join(', ');
        return `${scoped} {${decl}}`;
    });
}

function _scopeCSS(css, scopeId) {
    // State machine: walk the CSS token-by-token to find top-level rules vs
    // at-rules with blocks. We don't use regex on the full string because
    // nested @media blocks would confuse a flat regex.
    let out   = '';
    let i     = 0;
    const L   = css.length;

    while (i < L) {
        // Skip whitespace / comments at top level
        if (css.slice(i, i + 2) === '/*') {
            const end = css.indexOf('*/', i + 2);
            if (end === -1) { out += css.slice(i); break; }
            out += css.slice(i, end + 2);
            i = end + 2;
            continue;
        }

        // Find the next { to classify what we're looking at
        const brace = css.indexOf('{', i);
        if (brace === -1) { out += css.slice(i); break; }

        const preamble = css.slice(i, brace).trim();
        i = brace + 1;

        // Find matching closing brace (supports one level of nesting for @media)
        let depth = 1, j = i;
        while (j < L && depth > 0) {
            if (css[j] === '{') depth++;
            else if (css[j] === '}') depth--;
            j++;
        }
        const inner = css.slice(i, j - 1);
        i = j;

        if (!preamble) { out += `{${inner}}`; continue; }

        // @keyframes, @font-face etc — pass through verbatim
        if (_CSS_AT_PASSTHROUGH.test(preamble)) {
            out += `${preamble} {${inner}}\n`;
            continue;
        }

        // @media / @supports / @layer — scope the inner rules, keep wrapper
        if (/^@/.test(preamble)) {
            out += `${preamble} {\n${_scopeCSSBlock(inner, scopeId)}\n}\n`;
            continue;
        }

        // Regular selector rule — scope directly
        const scoped = preamble.split(',')
            .map(s => `[data-oja-composite="${scopeId}"] ${s.trim()}`)
            .join(', ');
        out += `${scoped} {${inner}}\n`;
    }

    return out;
}

function _injectScopedCSS(cssText, scopeId) {
    const attr  = `data-oja-composite-style`;
    const existing = document.head.querySelector(`style[${attr}="${scopeId}"]`);
    if (existing) return; // already injected (e.g. after re-render)

    const style = document.createElement('style');
    style.setAttribute(attr, scopeId);
    style.textContent = _scopeCSS(cssText, scopeId);
    document.head.appendChild(style);
}

function _removeScopedCSS(scopeId) {
    document.head
        .querySelectorAll(`style[data-oja-composite-style="${scopeId}"]`)
        .forEach(el => el.remove());
}

// Fetch plain text (CSS). Mirrors _fetchHTML but skips VFS write-back.
async function _fetchText(url, options = {}) {
    const now       = Date.now();
    const cached    = _cache.get(url);
    const activeVfs = options.vfsOverride !== undefined ? options.vfsOverride : _vfs;

    if (cached && (now - cached.timestamp) < CACHE_TTL && !options.bypassCache) {
        return cached.html;
    }

    if (activeVfs) {
        try {
            const text = await activeVfs.readText(url);
            if (text !== null) {
                _cache.set(url, { html: text, timestamp: now, size: text.length });
                return text;
            }
        } catch { /* VFS miss — fall through */ }
    }

    if (options.signal?.aborted) throw new Error('[oja/out] fetch aborted');
    if (!runtime.isOriginAllowed(url)) throw new Error(`[oja/out] blocked origin: ${url}`);

    const res = await fetch(url, runtime.runFetchHooks(url, { signal: options.signal }));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    while (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value);
    _cache.set(url, { html: text, timestamp: now, size: new Blob([text]).size });
    return text;
}

// Deduce { html, js, css } from an arbitrary argument list by file extension.
// Accepts positional (html, js, css) or object form { html, js, css, data, ...opts }.
function _normalizeCompositeArgs(a, b, c, d, e) {
    if (a && typeof a === 'object' && !Array.isArray(a) && ('html' in a || 'js' in a)) {
        // Object form: Out.composite({ html, js, css, data, ...options })
        const { html = null, js = null, css = null, data = {}, ...opts } = a;
        return { html, js, css, data, opts };
    }

    // Positional: Out.composite(fileA, fileB?, fileC?, data?, options?)
    // Collect all string args as file paths, classify by extension.
    const files  = [];
    let   data   = {};
    let   opts   = {};

    for (const arg of [a, b, c, d, e]) {
        if (arg === null || arg === undefined) continue;
        if (typeof arg === 'string') files.push(arg);
        else if (typeof arg === 'object' && !Array.isArray(arg)) {
            // First plain object = data, second = options
            if (!Object.keys(data).length && !('timeout' in arg) && !('vfs' in arg) && !('bypassCache' in arg) && !('signal' in arg)) {
                data = arg;
            } else {
                opts = arg;
            }
        }
    }

    let html = null, js = null, css = null;
    for (const f of files) {
        const ext = f.split('.').pop().toLowerCase();
        if (ext === 'html' || ext === 'htm') {
            if (html !== null) throw new Error(`[oja/out] Out.composite() received two HTML files: "${html}" and "${f}". Only one is allowed.`);
            html = f;
        } else if (ext === 'js' || ext === 'ts' || ext === 'mjs') {
            if (js !== null) throw new Error(`[oja/out] Out.composite() received two JS files: "${js}" and "${f}". Only one is allowed.`);
            js = f;
        } else if (ext === 'css') {
            if (css !== null) throw new Error(`[oja/out] Out.composite() received two CSS files: "${css}" and "${f}". Only one is allowed.`);
            css = f;
        }
    }

    return { html, js, css, data, opts };
}

// _CompositeOut
//
// Renders an HTML template + an external classic <script src> + optional CSS.
// Unlike _ComponentOut (which uses _exec.js blob-URL modules), composite JS is
// loaded as a plain <script src="..."> — no type="module", no blob wrapping.
// This makes it fully compatible with HTML/JS minifiers (tdewolff/minify etc.)
// that cannot safely process module scripts embedded in HTML.
//
// Communication between the host page and the composite script uses a
// window[scopeKey] handshake (same SCOPE_PREFIX as _exec.js) — the script
// reads container + props synchronously and calls ready() when done.
//
// Composite scripts CANNOT use import/export. They receive:
//   const { container, props, ready } = window[document.currentScript.dataset.ojaScope];
//
// If you need ES module imports, use Out.component() via _exec.js instead.

const COMPOSITE_SCOPE_PREFIX = '__oja_scope_';
let   _compositeCounter      = 0;

// Composite scope helpers — set synchronously at module load time via
// _setCompositeHelpers(), called by component.js and router.js.
// Using a hook pattern (same as _componentScopeHook in events.js) avoids
// dynamic import() inside render(), which would add extra microtask ticks
// and cause test timing issues. Both callers already import out.js, so
// there is no circular dependency.
let _compositeRegisterUnmount = null;
let _compositeRouter          = null;

/** @internal — called by component.js after module init */
export function _setCompositeRegisterUnmount(fn) {
    _compositeRegisterUnmount = fn;
}

/** @internal — called by router.js after the singleton proxy is created */
export function _setCompositeRouter(routerProxy) {
    _compositeRouter = routerProxy;
}

class _CompositeOut extends _Out {
    constructor(html, js, css = null, data = {}, options = {}) {
        super('composite', html, options);
        this._jsUrl  = js;
        this._cssUrl = css;
        this._data   = data;
        this._vfs    = options.vfs !== undefined ? options.vfs : undefined;
    }

    async render(container, context = {}) {
        const props   = { ...context, ...this._data };
        const timeout = this._options.timeout ?? 5000;
        const signal  = this._options.signal ?? context.signal ?? null;

        // Unique composite ID: used both as scope key and CSS scoping attribute.
        const scopeId  = `oja-cmp-${Date.now()}_${++_compositeCounter}_${Math.random().toString(36).slice(2, 7)}`;
        const scopeKey = `${COMPOSITE_SCOPE_PREFIX}${scopeId}`;

        // Mark the container so scoped CSS selectors can target it.
        // Saved so we can clean up the <style> tag on navigation (router calls
        // component._runUnmount which tears down the scope — CSS is removed
        // via a MutationObserver registered below).
        container.setAttribute('data-oja-composite', scopeId);

        // Fetch and render the HTML template (VFS → cache → network)
        if (this._payload) {
            const html = await _fetchHTML(this._payload, {
                bypassCache: this._options.bypassCache,
                vfsOverride: this._vfs,
                signal,
            });
            container.innerHTML = templateRender(html, props);
            fill(container, props);
        }

        // Fetch and inject scoped CSS (non-blocking — warn on failure, never throw)
        if (this._cssUrl) {
            _fetchText(this._cssUrl, { vfsOverride: this._vfs, signal })
                .then(css => _injectScopedCSS(css, scopeId))
                .catch(e  => console.warn(`[oja/out] composite: failed to load CSS: ${this._cssUrl}`, e));
        }

        // Register a MutationObserver so the <style> tag is removed automatically
        //    when this container is detached from the DOM (e.g. router navigation).
        if (this._cssUrl) {
            const obs = new MutationObserver(() => {
                if (!document.body.contains(container)) {
                    _removeScopedCSS(scopeId);
                    obs.disconnect();
                }
            });
            obs.observe(document.body, { childList: true, subtree: true });
        }

        // If no JS, we're done.
        if (!this._jsUrl) return;

        // Window scope handshake — written before the <script> is injected.
        //    The composite script reads this synchronously via document.currentScript.
        //
        //    Composite scripts receive a rich scope object that mirrors Out.component():
        //      const { container, props, ready, find, findAll, onUnmount, router } =
        //          window[document.currentScript.dataset.ojaScope];
        //
        //    _compositeRegisterUnmount and _compositeRouter are set synchronously at
        //    module load time via _setCompositeHelpers() — no async import() needed.

        return new Promise((resolve) => {
            let settled = false;

            const settle = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timerId);
                document.removeEventListener('oja:composite-ready', onReadyEvent);
                // Defer scope key deletion — give the script's synchronous
                // post-load code one more tick before we clean up.
                setTimeout(() => { delete window[scopeKey]; }, 0);
                resolve();
            };

            // Timeout guard — resolves instead of hanging if script never calls ready()
            let timerId = null;
            if (timeout > 0) timerId = setTimeout(() => {
                console.warn(`[oja/out] composite timeout (${timeout}ms): ${this._jsUrl}`);
                settle();
            }, timeout);

            // Abort signal — remove injected script and resolve cleanly
            if (signal) {
                signal.addEventListener('abort', () => {
                    container.querySelector(`script[data-oja-scope="${scopeKey}"]`)?.remove();
                    settle();
                }, { once: true });
            }

            // Event-based ready: the composite script can dispatch instead of
            // calling ready() directly — useful when the script has no access
            // to document.currentScript (e.g. loaded via a bundler).
            const onReadyEvent = (e) => {
                if (e.detail?.scope === scopeKey) settle();
            };
            document.addEventListener('oja:composite-ready', onReadyEvent);

            // The actual scope object exposed to the composite script.
            // Mirrors the Out.component() developer experience as closely as possible:
            //   find / findAll  — scoped querySelector, no global DOM leaks
            //   onUnmount       — hooks into component lifecycle; router calls _runUnmount on navigate
            //   router          — the singleton proxy; safe to reference before start()
            window[scopeKey] = {
                container,
                props,
                ready:     settle,
                find:      (sel) => container.querySelector(sel),
                findAll:   (sel) => Array.from(container.querySelectorAll(sel)),
                onUnmount: (fn)  => _compositeRegisterUnmount?.(container, fn),
                router:    _compositeRouter,
            };

            // Inject the classic <script src> tag.
            //    NO type="module" — this is intentional. Classic scripts are
            //    minifier-safe. The trade-off: no import/export in composite JS.
            const script      = document.createElement('script');
            script.src        = this._jsUrl;
            // data-oja-scope lets the composite script find its scope key via
            //   window[document.currentScript.dataset.ojaScope]
            script.dataset.ojaScope = scopeKey;

            script.addEventListener('error', (e) => {
                console.error(`[oja/out] composite script failed to load: ${this._jsUrl}`, e);
                settle(); // don't hang on network error
            }, { once: true });

            // For inline-only composites that have no async work, the script
            // may call ready() synchronously during the load event — that's fine,
            // settle() is idempotent.
            container.appendChild(script);
        });
    }

    async prefetch(options = {}) {
        const jobs = [];
        if (this._payload) {
            jobs.push(
                _fetchHTML(this._payload, { signal: options.signal, vfsOverride: this._vfs, bypassCache: options.bypassCache })
                    .catch(e => { if (e.name !== 'AbortError') console.warn(`[oja/out] composite prefetch (html): ${this._payload}`, e); })
            );
        }
        if (this._cssUrl) {
            jobs.push(
                _fetchText(this._cssUrl, { signal: options.signal, vfsOverride: this._vfs })
                    .catch(e => { if (e.name !== 'AbortError') console.warn(`[oja/out] composite prefetch (css): ${this._cssUrl}`, e); })
            );
        }
        // JS is a real URL — just warm the browser cache via a preload hint
        if (this._jsUrl && !options.bypassCache) {
            const link = document.createElement('link');
            link.rel   = 'preload';
            link.as    = 'script';
            link.href  = this._jsUrl;
            document.head.appendChild(link);
        }
        await Promise.allSettled(jobs);
        return this;
    }
}

class _SegmentOut extends _Out {
    constructor(name, data = {}) {
        super('segment', name);
        this._data = data;
    }

    async render(container, context = {}) {
        await _segmentRender(container, this._payload, this._data, context);
    }
}

export const Out = {

    // Entry point for the fluent chainable API.
    // Returns an OutTarget directly — no Proxy, no magic.
    //
    //   Out.to('#app').html('<h1>Hello</h1>');
    //   Out.to('#app').component('pages/hosts.html', data);
    //   Out.to('#app').animate('fadeIn').component('modal.html');
    to(target) {
        return new OutTarget(target);
    },

    // Tagged template literal entry point.
    // Separated from to() so Out.to() can return a plain OutTarget.
    //
    //   Out.tag('#app')`<h1>Hello ${name}!</h1>`;
    tag(target) {
        return createTagHandler(target);
    },

    skeleton(target, type = 'text', options = {}) {
        return this.to(target).skeleton(type, options);
    },

    component(url, data = {}, lists = {}, options = {}) {
        return new _ComponentOut(url, data, lists, options);
    },

    html(htmlString) {
        return new _HtmlOut(htmlString);
    },

    // Insert HTML without executing inline scripts — safer for untrusted content.
    raw(htmlString) {
        return new _RawOut(htmlString);
    },

    text(string) {
        return new _TextOut(String(string));
    },

    svg(svgStringOrUrl, options = {}) {
        return new _SvgOut(svgStringOrUrl, options);
    },

    image(url, options = {}) {
        return new _ImageOut(url, options);
    },

    link(url, label, options = {}) {
        return new _LinkOut(url, label, options);
    },

    fn(asyncFn, options = {}) {
        return new _FnOut(asyncFn, options);
    },

    empty() {
        return new _EmptyOut();
    },

    // Render a named segment registered via <template data-oja-segment="name">.
    // Auto-scans the document on first use — no setup required.
    // For explicit control (scan, define, list) import { segment } from './segment.js'.
    segment(name, data = {}) {
        return new _SegmentOut(name, data);
    },

    // Conditional rendering — condition is evaluated at render time, not eagerly.
    // condition: () => boolean  thenOut: Out  elseOut?: Out
    if(conditionFn, thenOut, elseOut) {
        if (typeof conditionFn !== 'function') {
            throw new Error('[oja/out] Out.if() condition must be a function () => boolean');
        }
        return new _IfOut(conditionFn, thenOut, elseOut);
    },

    // Three-state async rendering — loading while pending, success/error on settle.
    // promise: Promise  states: { loading?: Out, success: Out | (value) => Out, error?: Out | (err) => Out }
    promise(promise, states = {}) {
        if (!states.success) {
            throw new Error('[oja/out] Out.promise() requires states.success');
        }
        return new _PromiseOut(promise, states);
    },

    // Render a list of items — one Out slot per item.
    // items: Array  itemFn: (item, index) => Out  options?: { empty?: Out }
    list(items, itemFn, options = {}) {
        if (typeof itemFn !== 'function') {
            throw new Error('[oja/out] Out.list() requires an itemFn: (item, index) => Out');
        }
        return new _ListOut(items, itemFn, options);
    },

    is(value) {
        return value instanceof _Out;
    },

    /**
     * Zero-dependency inline SVG sparkline.
     * No CDN required — pure SVG path computed from values array.
     *
     *   Out.sparkline([12, 45, 23, 67, 34, 89], { color: '#00c770', height: 40 })
     *
     * @param {number[]} values
     * @param {Object}   options
     *   color   : string  — stroke colour (default: 'var(--accent, #4f8ef7)')
     *   height  : number  — SVG height in px (default: 40)
     *   width   : number  — SVG width in px (default: 120)
     *   fill    : boolean — filled area under the line (default: false)
     *   strokeWidth : number — line thickness (default: 1.5)
     */
    sparkline(values, options = {}) {
        return new _FnOut(async (container) => {
            const {
                color       = 'var(--accent, #4f8ef7)',
                height      = 40,
                width       = 120,
                fill        = false,
                strokeWidth = 1.5,
            } = options;

            if (!values || values.length < 2) { container.innerHTML = ''; return; }

            const min = Math.min(...values);
            const max = Math.max(...values);
            const range = max - min || 1;
            const pad = strokeWidth;
            const W = width - pad * 2;
            const H = height - pad * 2;

            const pts = values.map((v, i) => {
                const x = pad + (i / (values.length - 1)) * W;
                const y = pad + H - ((v - min) / range) * H;
                return `${x},${y}`;
            });

            const polyline = pts.join(' ');
            const fillPath = fill
                ? `<polygon points="${polyline} ${pad + W},${pad + H} ${pad},${pad + H}"
                    fill="${color}" fill-opacity="0.15"/>`
                : '';

            container.innerHTML = `<svg viewBox="0 0 ${width} ${height}"
                xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"
                style="display:block;overflow:visible">
                ${fillPath}
                <polyline points="${polyline}"
                    fill="none" stroke="${color}" stroke-width="${strokeWidth}"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
        });
    },

    /**
     * A-09: Zero-dependency inline SVG time-series line chart.
     * Supports multiple series, axis labels, and tooltips on hover.
     *
     *   Out.timeSeries([
     *       { label: 'HTTP', values: [12, 45, 23], color: '#4f8ef7' },
     *       { label: 'TCP',  values: [5,  12, 8],  color: '#00c770' },
     *   ], { height: 120, timestamps: ['00:00','00:01','00:02'] })
     */
    timeSeries(series, options = {}) {
        return new _FnOut(async (container) => {
            const {
                height      = 120,
                width       = 300,
                strokeWidth = 1.5,
                timestamps  = [],
                showGrid    = true,
                gridLines   = 4,
            } = options;

            if (!series?.length) { container.innerHTML = ''; return; }

            const allValues = series.flatMap(s => s.values || []);
            if (!allValues.length) { container.innerHTML = ''; return; }

            const min = Math.min(...allValues);
            const max = Math.max(...allValues);
            const range = max - min || 1;
            const padL = 32, padR = 8, padT = 8, padB = timestamps.length ? 20 : 8;
            const W = width - padL - padR;
            const H = height - padT - padB;

            const maxLen = Math.max(...series.map(s => s.values?.length || 0));

            let svgContent = '';

            // Grid lines
            if (showGrid) {
                for (let i = 0; i <= gridLines; i++) {
                    const y = padT + (i / gridLines) * H;
                    const val = max - (i / gridLines) * range;
                    svgContent += `<line x1="${padL}" y1="${y}" x2="${padL + W}" y2="${y}"
                        stroke="var(--border,#333)" stroke-width="0.5" stroke-dasharray="2,3"/>
                        <text x="${padL - 4}" y="${y + 4}" text-anchor="end"
                        font-size="8" fill="var(--text-muted,#666)">${Math.round(val)}</text>`;
                }
            }

            // X-axis labels
            if (timestamps.length) {
                const step = Math.max(1, Math.floor(timestamps.length / 5));
                timestamps.forEach((t, i) => {
                    if (i % step !== 0 && i !== timestamps.length - 1) return;
                    const x = padL + (i / (maxLen - 1 || 1)) * W;
                    svgContent += `<text x="${x}" y="${padT + H + 14}" text-anchor="middle"
                        font-size="8" fill="var(--text-muted,#666)">${t}</text>`;
                });
            }

            // Series lines
            for (const s of series) {
                const vals = s.values || [];
                if (vals.length < 2) continue;
                const color = s.color || 'var(--accent,#4f8ef7)';
                const pts = vals.map((v, i) => {
                    const x = padL + (i / (vals.length - 1)) * W;
                    const y = padT + H - ((v - min) / range) * H;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                }).join(' ');
                svgContent += `<polyline points="${pts}" fill="none" stroke="${color}"
                    stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
            }

            container.innerHTML = `<svg viewBox="0 0 ${width} ${height}"
                xmlns="http://www.w3.org/2000/svg" width="100%" height="${height}"
                style="display:block;overflow:visible">${svgContent}</svg>`;
        });
    },

    async prefetchAll(outs, options = {}) {
        const promises = outs
            .filter(o => o instanceof _Out)
            .map(o => o.prefetch(options));
        await Promise.allSettled(promises);
        return this;
    },

    clearCache(url) {
        if (url) _cache.delete(url);
        else     _cache.clear();
        return this;
    },

    cacheStats() {
        const entries = [];
        for (const [url, entry] of _cache.entries()) {
            entries.push({ url, age: Date.now() - entry.timestamp, size: entry.size });
        }
        return { size: _cache.size, maxSize: CACHE_MAX, ttl: CACHE_TTL, entries };
    },

    // Register a VFS instance — all Out.component() calls check it before the network.
    // On a network fetch the result is written back to VFS for future offline use.
    vfsUse(vfs) {
        _vfs = vfs;
        return this;
    },

    // Returns the currently registered VFS instance, or null if none registered.
    vfsGet() {
        return _vfs;
    },

    /**
     * Out.composite(html, js, css?, data?, options?)
     * Out.composite(js,   html, css?, data?, options?)  — order doesn't matter
     * Out.composite({ html, js, css?, data?, ...options })
     *
     * Renders an HTML template paired with an external classic <script src>.
     * Unlike Out.component() (which uses <script type="module"> via blob URLs),
     * composite JS is loaded as a plain classic script — making it fully
     * compatible with HTML/JS minifiers such as tdewolff/minify.
     *
     * Trade-off: composite JS files cannot use ES import/export.
     * The script receives the container and props via a window scope handshake:
     *
     *   // inside dashboard.js
     *   const { container, props, ready, find, findAll, onUnmount, router } =
     *       window[document.currentScript.dataset.ojaScope];
     *
     *   const search = find('#searchInput');
     *   const timer  = setInterval(refresh, 30_000);
     *   onUnmount(() => clearInterval(timer));
     *   ready();
     *
     * Scope object properties:
     *   container  {Element}   — the DOM element this composite rendered into
     *   props      {Object}    — merged data/context passed at render time
     *   ready      {Function}  — call when async setup is complete
     *   find       {Function}  — container.querySelector shorthand (scoped)
     *   findAll    {Function}  — container.querySelectorAll shorthand (scoped)
     *   onUnmount  {Function}  — register a cleanup fn called on router navigation
     *   router     {Proxy}     — the router singleton (requires createRouter() first)
     *
     * Options:
     *   timeout     {number}  ms before render resolves anyway (default: 5000)
     *   vfs         {VFS}     per-instance VFS (overrides Out.vfsUse())
     *   bypassCache {boolean} skip in-memory HTML cache
     *
     * @returns {_CompositeOut}
     */
    composite(a, b, c, d, e) {
        const { html, js, css, data, opts } = _normalizeCompositeArgs(a, b, c, d, e);
        if (!html && !js) {
            throw new Error('[oja/out] Out.composite() requires at least an html or js file');
        }
        return new _CompositeOut(html, js, css, data, opts);
    },

    /**
     * Out.page(html, js?, css?, data?, options?)
     *
     * Semantic alias for Out.composite() intended for router usage.
     * Identical behaviour — the name signals "this is a full page", which
     * enables router tooling (title updates, scroll-reset, prefetch-on-hover)
     * to distinguish page transitions from sub-component renders.
     *
     * Falls back to Out.component() when no JS is provided — plain HTML pages
     * do not need the composite handshake overhead.
     *
     *   r.Get('/dashboard', Out.page('pages/dashboard.html', 'pages/dashboard.js'));
     *   r.Get('/about',     Out.page('pages/about.html'));   // html-only → component
     *
     * @returns {_CompositeOut | _ComponentOut}
     */
    page(a, b, c, d, e) {
        const { html, js, css, data, opts } = _normalizeCompositeArgs(a, b, c, d, e);
        if (!js) {
            // No JS — use the lighter _ComponentOut path (no handshake overhead)
            return new _ComponentOut(html, data, {}, opts);
        }
        return new _CompositeOut(html, js, css, data, { ...opts, _isPage: true });
    },

    /**
     * Out.within(element) — scoped rendering root.
     *
     * Returns a scope object whose .to(selector) resolves the selector against
     * `element` instead of the global document. Prevents accidental matches on
     * elements belonging to sibling components when IDs are not globally unique.
     *
     *   // Inside a composite or component script:
     *   Out.within(container).to('#stepPanel').component('steps/step-1.html');
     *   Out.within(container).to('#stepPanel').composite('steps/step.html', 'steps/step.js');
     *
     * @param {Element} scopeEl — the container to search within
     * @returns {{ to(selector): OutTarget }}
     */
    within(scopeEl) {
        if (!(scopeEl instanceof Element)) {
            console.warn('[oja/out] Out.within() requires a DOM Element');
            return { to: () => new OutTarget(null) };
        }
        return {
            to(selector) {
                const el = typeof selector === 'string'
                    ? scopeEl.querySelector(selector)
                    : selector instanceof Element ? selector : null;
                if (!el) console.warn(`[oja/out] Out.within().to() — element not found: ${selector}`);
                // Pass the resolved Element directly — OutTarget._resolve() handles Elements natively.
                return new OutTarget(el);
            },
        };
    },
};

Out.c    = Out.component;
Out.h    = Out.html;
Out.t    = Out.text;
Out.cmp  = Out.composite; // short alias

// Backwards-compatible alias — Out is the canonical name.
export const Responder = Out;
