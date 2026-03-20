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
 * ─── Types ────────────────────────────────────────────────────────────────────
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
 *
 * ─── Composition ──────────────────────────────────────────────────────────────
 *
 *   Out.if(condition, thenOut, elseOut?)
 *     — condition is a function () => bool, evaluated at render time
 *     out.if(() => user.isAdmin, Out.c('admin.html'), Out.c('denied.html'))
 *
 *   Out.promise(promise, { loading, success, error })
 *     — three-state async: show loading Out while promise is pending,
 *       success Out when it resolves (receives resolved value as data),
 *       error Out when it rejects (receives { error: message } as data).
 *     Out.promise(fetchUser(id), {
 *         loading: Out.c('states/loading.html'),
 *         success: (user) => Out.c('pages/user.html', user),
 *         error:   Out.c('states/error.html'),
 *     })
 *
 *   Out.list(items, itemFn, options?)
 *     — render a list of items, one Out per item.
 *     — itemFn receives (item, index) and must return an Out.
 *     — options.empty: Out — shown when items is empty (default: Out.empty())
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
 * ─── Every Out has ────────────────────────────────────────────────────────────
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

// ─── Out public API ───────────────────────────────────────────────────────────

export const Out = {
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