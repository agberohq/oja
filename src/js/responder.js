/**
 * oja/responder.js
 * A display primitive — describes WHAT to show without rendering it immediately.
 * Lazy by design: a Responder is just a description until .render() is called.
 *
 * Used everywhere a display outcome is needed:
 *   - router.Get('/hosts', Responder.component('pages/hosts.html'))
 *   - router.NotFound(Responder.component('pages/404.html'))
 *   - each(container, 'hosts', items, { empty: Responder.svg(emptyStateSvg) })
 *   - component.mount('#app', url, data, {}, { error: Responder.html('<p>Failed</p>') })
 *   - notify.show(Responder.html('<strong>Deploy complete</strong>'))
 *   - modal.open('confirm', { body: Responder.component('components/confirm.html', data) })
 *
 * Types:
 *   Responder.html(string)                      — raw HTML string
 *   Responder.text(string)                      — plain text (escaped)
 *   Responder.svg(string)                       — SVG string or URL
 *   Responder.image(url, options?)              — <img> with optional alt, width, height
 *   Responder.link(url, label?, options?)       — <a> anchor
 *   Responder.component(url, data?, lists?)     — fetch + render an .html file
 *   Responder.fn(asyncFn)                       — lazy async function, called at render time
 *   Responder.empty()                           — renders nothing (explicit no-op)
 *
 * Every Responder has:
 *   responder.render(container, context?)       — renders into a DOM element
 *   responder.type                              — string identifying the type
 *   responder.clone(overrides?)                 — returns a new Responder with merged options
 */

import { render as templateRender, fill } from './template.js';
import { execScripts }                    from './_exec.js';

// ─── Cache for component HTML ─────────────────────────────────────────────────

const _cache = new Map();

async function _fetchHTML(url) {
    if (_cache.has(url)) return _cache.get(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`[oja/responder] failed to load: ${url} (${res.status})`);
    const html = await res.text();
    _cache.set(url, html);
    return html;
}

// ─── Base class ───────────────────────────────────────────────────────────────

class _Responder {
    constructor(type, payload, options = {}) {
        this.type     = type;
        this._payload = payload;
        this._options = options;
    }

    /**
     * Render this Responder into a DOM container.
     * @param {Element} container
     * @param {Object}  context   — optional data from router ctx, each(), etc.
     */
    async render(container, context = {}) {
        throw new Error(`[oja/responder] render() not implemented for type: ${this.type}`);
    }

    /**
     * Clone with optional overrides — useful for reusing a base Responder
     * with different data per instance.
     */
    clone(overrides = {}) {
        return new this.constructor(
            this.type,
            this._payload,
            { ...this._options, ...overrides }
        );
    }

    /**
     * Quick check — is this a Responder?
     */
    static isResponder(value) {
        return value instanceof _Responder;
    }
}

// ─── Concrete types ───────────────────────────────────────────────────────────

class _HtmlResponder extends _Responder {
    constructor(html, options = {}) {
        super('html', html, options);
    }
    async render(container) {
        container.innerHTML = this._payload;
        execScripts(container);
    }
}

class _TextResponder extends _Responder {
    constructor(text, options = {}) {
        super('text', text, options);
    }
    async render(container) {
        container.textContent = this._payload;
    }
}

class _SvgResponder extends _Responder {
    constructor(svg, options = {}) {
        super('svg', svg, options);
    }
    async render(container) {
        // Accepts inline SVG string or a URL ending in .svg
        if (this._payload.trim().startsWith('<')) {
            container.innerHTML = this._payload;
        } else {
            // URL — fetch and inline it so CSS variables work
            try {
                const res  = await fetch(this._payload);
                const text = await res.text();
                container.innerHTML = text;
            } catch {
                container.innerHTML = `<img src="${this._payload}" alt="${this._options.alt || ''}" style="max-width:100%">`;
            }
        }
    }
}

class _ImageResponder extends _Responder {
    constructor(url, options = {}) {
        super('image', url, options);
    }
    async render(container) {
        const { alt = '', width = '', height = '', className = '' } = this._options;
        const img = document.createElement('img');
        img.src = this._payload;
        if (alt)       img.alt       = alt;
        if (width)     img.width     = width;
        if (height)    img.height    = height;
        if (className) img.className = className;
        img.style.maxWidth = '100%';
        container.innerHTML = '';
        container.appendChild(img);
    }
}

class _LinkResponder extends _Responder {
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
}

class _ComponentResponder extends _Responder {
    constructor(url, data = {}, lists = {}, options = {}) {
        super('component', url, options);
        this._data  = data;
        this._lists = lists;
    }

    async render(container, context = {}) {
        // Context from router (params, user, etc.) merged with static data
        const mergedData = { ...context, ...this._data };

        // Show loading slot if present
        const loadingEl = container.querySelector('[data-loading]');
        const errorEl   = container.querySelector('[data-error]');
        if (loadingEl) loadingEl.style.display = '';
        if (errorEl)   errorEl.style.display   = 'none';

        try {
            const html = await _fetchHTML(this._payload);
            container.innerHTML = templateRender(html, mergedData);
            fill(container, mergedData);

            // Process declared loops
            if (Object.keys(this._lists).length > 0) {
                const { each } = await import('./template.js');
                for (const [name, items] of Object.entries(this._lists)) {
                    each(container, name, items);
                }
            }

            // We must set the component's active element before executing scripts
            // so that onMount/interval calls in the component are correctly scoped.
            const { component } = await import('./component.js');
            const oldActive = component._activeElement;
            component._activeElement = container;

            // Execute scripts with source URL for relative import resolution
            execScripts(container, this._payload);

            // Restore previous active element (handle nested renders)
            component._activeElement = oldActive;

        } catch (e) {
            console.error(`[oja/responder] component load failed: ${this._payload}`, e);

            if (errorEl) {
                errorEl.style.display = '';
                if (loadingEl) loadingEl.style.display = 'none';
            } else if (this._options.error) {
                // Nested Responder for error state
                await this._options.error.render(container, { error: e.message });
            } else {
                container.innerHTML = `
                    <div class="oja-error">
                        Failed to load component.
                        <button onclick="this.closest('.oja-error').dispatchEvent(
                            new CustomEvent('oja:retry', { bubbles: true })
                        )">Retry</button>
                    </div>`;
            }
            throw e;
        }
    }

    // Convenience — clone with new data merged in
    withData(data) {
        return new _ComponentResponder(
            this._payload,
            { ...this._data, ...data },
            this._lists,
            this._options
        );
    }

    withLists(lists) {
        return new _ComponentResponder(
            this._payload,
            this._data,
            { ...this._lists, ...lists },
            this._options
        );
    }
}

class _FnResponder extends _Responder {
    constructor(fn, options = {}) {
        super('fn', fn, options);
    }
    async render(container, context = {}) {
        try {
            const result = await this._payload(container, context);
            // If the fn returns a Responder, render it
            if (_Responder.isResponder(result)) {
                await result.render(container, context);
            }
            // If it returns an HTML string, inject it
            else if (typeof result === 'string') {
                container.innerHTML = result;
                execScripts(container);
            }
            // Otherwise the fn is expected to have mutated the container directly
        } catch (e) {
            console.error('[oja/responder] fn responder threw:', e);
            if (this._options.error) {
                await this._options.error.render(container, { error: e.message });
            } else {
                container.innerHTML = `<div class="oja-error">${e.message}</div>`;
            }
        }
    }
}

class _EmptyResponder extends _Responder {
    constructor() { super('empty', null); }
    async render(container) { container.innerHTML = ''; }
}

// ─── Public factory ───────────────────────────────────────────────────────────

/**
 * Responder — factory for all display primitives.
 *
 * Every method returns a lazy Responder instance.
 * Nothing renders until .render(container) is called.
 */
export const Responder = {

    /**
     * Inject a raw HTML string.
     * Use for simple error states, empty states, spinners.
     * WARNING: not XSS-safe — only use with trusted strings.
     *
     *   Responder.html('<p class="empty">No hosts found</p>')
     *   Responder.html(`<div class="spinner"></div>`)
     */
    html(htmlString) {
        return new _HtmlResponder(htmlString);
    },

    /**
     * Inject plain text — always XSS-safe.
     *
     *   Responder.text('No results found')
     *   Responder.text(errorMessage)
     */
    text(string) {
        return new _TextResponder(String(string));
    },

    /**
     * Inject an SVG — accepts inline SVG string or a URL.
     * Inline SVGs inherit CSS variables from the page.
     *
     *   Responder.svg('<svg>...</svg>')
     *   Responder.svg('/assets/empty-state.svg')
     */
    svg(svgStringOrUrl, options = {}) {
        return new _SvgResponder(svgStringOrUrl, options);
    },

    /**
     * Inject an <img> element.
     *
     *   Responder.image('/assets/empty.png', { alt: 'No data', width: 200 })
     */
    image(url, options = {}) {
        return new _ImageResponder(url, options);
    },

    /**
     * Inject an <a> link.
     *
     *   Responder.link('https://docs.example.com', 'Read the docs')
     *   Responder.link('/login', 'Sign in', { target: '_self' })
     */
    link(url, label, options = {}) {
        return new _LinkResponder(url, label, options);
    },

    /**
     * Fetch and render an .html component file.
     * Data is merged with router context at render time.
     *
     *   Responder.component('pages/hosts.html')
     *   Responder.component('pages/hosts.html', { title: 'Hosts' })
     *   Responder.component('components/empty.html', {}, {}, {
     *       error: Responder.html('<p>Could not load</p>')
     *   })
     */
    component(url, data = {}, lists = {}, options = {}) {
        return new _ComponentResponder(url, data, lists, options);
    },

    /**
     * Lazy async function — called at render time with (container, context).
     * Can return a Responder, an HTML string, or mutate the container directly.
     *
     *   Responder.fn(async (container, ctx) => {
     *       const data = await api.get('/hosts');
     *       return Responder.component('pages/hosts.html', data);
     *   })
     *
     *   Responder.fn(async (container, ctx) => {
     *       container.innerHTML = '<canvas id="chart"></canvas>';
     *       renderD3Chart(container.querySelector('#chart'), ctx.params);
     *   })
     */
    fn(asyncFn, options = {}) {
        return new _FnResponder(asyncFn, options);
    },

    /**
     * Renders nothing — explicit no-op.
     * Use when you want to clear a container with intent.
     *
     *   each(container, 'hosts', [], { empty: Responder.empty() })
     */
    empty() {
        return new _EmptyResponder();
    },

    /**
     * Check if a value is a Responder instance.
     * Useful in component.js and template.js when accepting Responder or string.
     *
     *   if (Responder.is(options.empty)) await options.empty.render(el);
     */
    is(value) {
        return value instanceof _Responder;
    }
};

// Also export the base class for instanceof checks in other modules
export { _Responder as ResponderBase };