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
 *   // Router — declare what to show, not how
 *   router.Get('/hosts', Out.component('pages/hosts.html'));
 *   router.NotFound(Out.component('pages/404.html'));
 *
 *   // Modal — body is a full rendered component, not a string
 *   modal.open('confirm', { body: Out.component('components/confirm.html', data) });
 *
 *   // Notify — rich HTML or plain text
 *   notify.show(Out.html('<strong>Deploy complete</strong> in 2.3s'));
 *   notify.show(Out.text('Saved'));
 *
 *   // Template — empty state as a component
 *   each(container, 'hosts', items, { empty: Out.component('states/no-hosts.html') });
 *
 *   // Component — error fallback as a component
 *   component.mount('#app', url, data, {}, { error: Out.component('states/error.html') });
 *
 * ─── Types ────────────────────────────────────────────────────────────────────
 *
 *   Out.component(url, data?, lists?, options?)  — fetch + render an .html file
 *   Out.html(string)                             — raw HTML string
 *   Out.text(string)                             — plain text (auto-escaped)
 *   Out.svg(stringOrUrl, options?)               — SVG inline or fetched from URL
 *   Out.image(url, options?)                     — <img> with loading, alt, etc.
 *   Out.link(url, label?, options?)              — <a> anchor
 *   Out.fn(asyncFn, options?)                    — lazy async, called at render time
 *   Out.empty()                                  — renders nothing (explicit no-op)
 *
 * ─── Shorthand aliases (for real code) ───────────────────────────────────────
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
 */

import { render as templateRender, fill, each } from './template.js';
import { execScripts }                           from './_exec.js';
import { emit }                                  from './events.js';

const _cache    = new Map();
const CACHE_TTL = 60000;
const CACHE_MAX = 50;

async function _fetchHTML(url, options = {}) {
    const now    = Date.now();
    const cached = _cache.get(url);

    if (cached && (now - cached.timestamp) < CACHE_TTL && !options.bypassCache) {
        _cache.delete(url);
        _cache.set(url, cached);
        emit('out:cache-hit', { url });
        return cached.html;
    }

    if (options.signal?.aborted) {
        throw new Error('[oja/out] fetch aborted');
    }

    emit('out:fetch-start', { url });
    const start = performance.now();

    try {
        const res = await fetch(url, { signal: options.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const html = await res.text();
        const size = new Blob([html]).size;

        while (_cache.size >= CACHE_MAX) {
            const oldestKey = _cache.keys().next().value;
            _cache.delete(oldestKey);
        }

        _cache.set(url, { html, timestamp: now, size });

        const ms = performance.now() - start;
        emit('out:fetch-end', { url, ms, size });

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
    } catch {
        // Ignore
    }
}

class _Out {
    constructor(type, payload, options = {}) {
        this.type     = type;
        this._payload = payload;
        this._options = options;
        this._id      = `out-${Math.random().toString(36).slice(2)}`;
    }

    async render(container, context = {}) {
        throw new Error(`[oja/out] render() not implemented for type: ${this.type}`);
    }

    async prefetch(options = {}) {
        return this;
    }

    clone(overrides = {}) {
        return new this.constructor(
            this.type,
            this._payload,
            { ...this._options, ...overrides }
        );
    }

    getText() {
        return null;
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
        execScripts(container, null, {});
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
                if (e.name !== 'AbortError') {
                    console.warn('[oja/out] SVG prefetch failed:', e);
                }
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
        if (!options.bypassCache) {
            const img = new Image();
            img.src = this._payload;
            return new Promise((resolve, reject) => {
                img.onload  = resolve;
                img.onerror = reject;
                if (options.signal) {
                    options.signal.addEventListener('abort', () => { img.src = ''; reject(new Error('Aborted')); });
                }
            });
        }
        return this;
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
    }

    async render(container, context = {}) {
        const mergedData = { ...context, ...this._data };
        const start      = performance.now();

        const loadingEl = container.querySelector('[data-loading]');
        const errorEl   = container.querySelector('[data-error]');

        if (loadingEl) loadingEl.style.display = '';
        if (errorEl)   errorEl.style.display   = 'none';

        try {
            const html = await _fetchHTML(this._payload, {
                bypassCache: this._options.bypassCache
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

            const ms = performance.now() - start;
            emit('out:component-rendered', {
                url: this._payload,
                ms,
                hasData: Object.keys(mergedData).length
            });

        } catch (e) {
            console.error(`[oja/out] component load failed: ${this._payload}`, e);

            if (errorEl) {
                errorEl.style.display = '';
                if (loadingEl) loadingEl.style.display = 'none';
            } else if (this._options.error) {
                const isNetworkError = e instanceof TypeError;
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
                bypassCache: options.bypassCache
            });
            this._prefetched = true;
            emit('out:component-prefetched', { url: this._payload });
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.warn(`[oja/out] prefetch failed: ${this._payload}`, e);
            }
        }
        return this;
    }

    withData(data) {
        return new _ComponentOut(
            this._payload,
            _deepMerge(this._data, data),
            this._lists,
            this._options
        );
    }

    withLists(lists) {
        return new _ComponentOut(
            this._payload,
            this._data,
            { ...this._lists, ...lists },
            this._options
        );
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
                    console.error('[oja/out] error Out also threw — using emergency fallback:', e2);
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
        if (this._payload.prefetch) {
            await this._payload.prefetch(options);
        }
        return this;
    }
}

class _EmptyOut extends _Out {
    constructor() {
        super('empty', null);
    }

    async render(container) {
        container.innerHTML = '';
    }

    getText() {
        return '';
    }
}

export const Out = {
    component(url, data = {}, lists = {}, options = {}) {
        return new _ComponentOut(url, data, lists, options);
    },

    html(htmlString) {
        return new _HtmlOut(htmlString);
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
        if (url) {
            _cache.delete(url);
        } else {
            _cache.clear();
        }
        return this;
    },

    cacheStats() {
        const entries = [];
        for (const [url, entry] of _cache.entries()) {
            entries.push({ url, age: Date.now() - entry.timestamp, size: entry.size });
        }
        return { size: _cache.size, maxSize: CACHE_MAX, ttl: CACHE_TTL, entries };
    }
};

Out.c = Out.component;
Out.h = Out.html;
Out.t = Out.text;

export const Responder = Out;

export { _Out as OutBase };