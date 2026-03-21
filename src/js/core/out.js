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
 * ─── Shorthand aliases ────────────────────────────────────────────────────────
 *
 *   Out.c()  — Out.component()
 *   Out.h()  — Out.html()
 *   Out.t()  — Out.text()
 *
 * ─── Every Out instance has ───────────────────────────────────────────────────
 *
 *   out.render(container, context?)   — renders into a DOM element
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
import { effect }                                from './reactive.js';
import { find }                                  from './ui.js';
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

    emit('out:fetch-start', { url });
    const start = performance.now();

    try {
        const res = await fetch(url, { signal: options.signal });
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

// ─── Base class ───────────────────────────────────────────────────────────────

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

    static is(value) {
        return value instanceof _Out;
    }
}

// ─── Primitive types ──────────────────────────────────────────────────────────

class _HtmlOut extends _Out {
    constructor(html, options = {}) {
        super('html', html, options);
    }

    async render(container) {
        container.innerHTML = this._payload;
        execScripts(container, null, {});
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
        this._data       = data;
        this._lists      = lists;
        this._prefetched = false;
        // options.vfs pins a specific VFS to this instance — no global side effect.
        // When absent, _fetchHTML falls back to the globally registered _vfs.
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
                execScripts(container, this._payload, mergedData);
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
            const result = await this._payload(container, context);
            if (_Out.is(result)) {
                await result.render(container, context);
            } else if (typeof result === 'function') {
                // Returned function is a cleanup — register it as an onUnmount hook on the
                // active component scope so it runs automatically when the component unmounts.
                // component.onUnmount() reads _activeElement internally, which is set to the
                // container during _ComponentOut.render() and Out.to().component() calls.
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
                execScripts(container, null, {});
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

// ─── Composition types ────────────────────────────────────────────────────────

class _IfOut extends _Out {
    constructor(conditionFn, thenOut, elseOut, options = {}) {
        super('if', conditionFn, options);
        this._then = thenOut;
        this._else = elseOut || new _EmptyOut();
    }

    // Evaluate condition at render time — not reactive, stateless.
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

            // success can be an Out directly, or a function that receives the resolved value
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
        // options.empty — Out to show when items is empty (defaults to Out.empty())
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

        // Keyed path — delegate to engine.listAsync for minimal DOM updates
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

        // Unkeyed fallback — existing full-rebuild path
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


// ─── Fluent API: Out.to() ─────────────────────────────────────────────────────

// OutTarget provides a fluent, chainable API for rendering content to DOM elements.
// Each method returns `this` for chaining, except .to() which returns a new OutTarget.
class OutTarget {
    constructor(target, options = {}) {
        this._target       = target;
        this._element      = null;
        this._context      = options.context || {};
        this._animation    = null;
        this._errorHandler = null;
        this._retryCount   = 0;
        this._condition    = null;
        this._listeners    = [];
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

    with(data) {
        this._context = _deepMerge(this._context, data);
        return this;
    }

    when(conditionFn) {
        this._condition = conditionFn;
        return this;
    }

    onError(handler) {
        this._errorHandler = handler;
        return this;
    }

    retry(count) {
        this._retryCount = count;
        return this;
    }

    // Diff the container against newHtml and patch only what changed.
    // Delegates to engine.morph() — preserves focus, scroll, and event listeners.
    morph(html) {
        const el = this._resolve();
        if (!el) return this;
        import('./engine.js').then(({ morph }) => morph(el, html));
        return this;
    }

    // Bind this element to a store key for reactive text/html/class/attr updates.
    // Named bindKey to avoid collision with the existing signal-based bind() method.
    // type: 'text' | 'html' | 'class' | 'attr'  (default: 'text')
    bindKey(storeKey, type = 'text', transform) {
        const el = this._resolve();
        if (!el) return this;
        const fnName = `bind${type.charAt(0).toUpperCase() + type.slice(1)}`;
        import('./engine.js').then(mod => {
            if (typeof mod[fnName] === 'function') mod[fnName](el, storeKey, transform);
        });
        return this;
    }

    // Set up a reactive binding — re-renders whenever the signal changes.
    // signal must be an Oja reactive signal or any callable returning a value.
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

    to(target) {
        this._flush();
        return new OutTarget(target, { context: this._context });
    }

    el() {
        return this._resolve();
    }

    async render() {
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
                if (this._animation && el.firstChild) await this._applyAnimation(el, 'out');
                await out.render(el, this._context);
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

// ─── Segment type ─────────────────────────────────────────────────────────────

class _SegmentOut extends _Out {
    constructor(name, data = {}) {
        super('segment', name);
        this._data = data;
    }

    async render(container, context = {}) {
        await _segmentRender(container, this._payload, this._data, context);
    }
}

// ─── Out public API ───────────────────────────────────────────────────────────

export const Out = {

    // Entry point for the fluent API — returns a chainable OutTarget.
    // Supports method chaining and tagged template literal syntax.
    to(target) {
        const outTarget = new OutTarget(target);
        return new Proxy(outTarget, {
            get(targetObj, prop) {
                if (prop === Symbol.for('nodejs.util.promisify.custom')) return undefined;
                if (typeof targetObj[prop] === 'function') return targetObj[prop].bind(targetObj);
                return targetObj[prop];
            },
            apply(targetObj, thisArg, args) {
                return createTagHandler(targetObj._target).apply(thisArg, args);
            }
        });
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
};

Out.c = Out.component;
Out.h = Out.html;
Out.t = Out.text;

// Backwards-compatible alias — Out is the canonical name.
export const Responder = Out;