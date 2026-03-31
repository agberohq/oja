/**
 * oja/ui.js
 * DOM interaction helpers — loading states, element utilities, themes, and widgets.
 * Makes the most common patterns zero-boilerplate.
 *
 * ─── The problem ──────────────────────────────────────────────────────────────
 *
 *   Every app needs buttons and links to show a loading state.
 *   Without Oja you write 10 lines per button. With Oja, it's one.
 *   Similarly, initializing 3rd party pickers usually requires manual JS
 *   per-page. Oja centralizes this.
 *
 * ─── Attribute-driven (zero JS) ──────────────────────────────────────────────
 *
 *   Add data-loading to any clickable element — Oja handles the rest:
 *
 *   <button data-action="save"  data-loading="Saving...">Save</button>
 *   <a href="#/hosts" data-page="/hosts" data-loading="Loading...">Hosts</a>
 *
 *   When clicked:
 *     → original content saved
 *     → element disabled + gets .oja-loading class
 *     → text replaced with data-loading value + spinner
 *
 *   When navigation completes (oja:navigate:end) or action resolves:
 *     → original content restored
 *     → .oja-loading removed
 *
 * ─── DOM Query Helpers ───────────────────────────────────────────────────────
 *
 *   // Single element
 *   const btn = find('button.save-btn');
 *
 *   // Multiple elements
 *   const items = findAll('.list-item');
 *
 *   // Scoped to container (perfect for components)
 *   const[wrap, img, loading, error] = findAllIn(container,[
 *       '.wrap', '.img', '.loading', '.error'
 *   ]);
 *
 *   // With required check
 *   const input = find('input[name="email"]', { required: true });
 *   if (!input) return;
 *
 *   // Create element
 *   const div = createEl('div', { class: 'card', text: 'Hello' });
 *
 * ─── Widgets and Pickers ─────────────────────────────────────────────────────
 *
 *   JS developer registers the widget logic once in app.js.
 *   UI developer simply adds the data-ui attribute to the HTML.
 *
 *   // app.js
 *   ui.widget.register('datepicker', (el) => new Flatpickr(el));
 *
 *   // page.html
 *   <input data-ui="datepicker" type="text">
 *
 * ─── JS API for custom actions (Fluent Chain) ────────────────────────────────
 *
 *   import { ui, find } from '../oja/ui.js';
 *
 *   on('#deploy-btn', 'click', async (e, el) => {
 *       const btn = ui(el);
 *       btn.loading('Deploying...');
 *       try {
 *           await api.post('/deploy', payload);
 *           btn.done('Deployed ✓');        // brief success, then restore
 *       } catch {
 *           btn.error('Failed — retry?');  // brief error, then restore
 *       }
 *   });
 *
 *   // Or inline — fluent chain
 *   ui('#save-btn').loading('Saving...');
 *   // ... later ...
 *   ui('#save-btn').reset();
 *
 * ─── Router integration ───────────────────────────────────────────────────────
 *
 *   Navigation links with data-loading auto-show spinner when clicked
 *   and auto-restore when oja:navigate:end fires.
 *   No JS needed — just add data-loading to the <a> tag.
 *
 * ─── CSS hooks ────────────────────────────────────────────────────────────────
 *
 *   .oja-loading          — element is in loading state
 *   .oja-done             — brief success state (auto-removed after 2s)
 *   .oja-error            — brief error state (auto-removed after 3s)
 *   .oja-loading-spinner  — the injected spinner SVG
 *
 *   Style these in your app CSS — Oja never sets colors or layout here.
 */

import { listen, emit, on as _on, once as _once } from './events.js';
import { effect }                                    from './reactive.js';

export function find(selector, options = {}) {
    const { required = false, scope = document, timeout = 0 } = options;

    if (timeout > 0) {
        return new Promise((resolve) => {
            const el = scope.querySelector(selector);
            if (el) {
                resolve(_renderable(el));
                return;
            }

            const observer = new MutationObserver((mutations, obs) => {
                const el = scope.querySelector(selector);
                if (el) {
                    obs.disconnect();
                    resolve(_renderable(el));
                }
            });

            observer.observe(scope, {
                childList: true,
                subtree: true
            });

            setTimeout(() => {
                observer.disconnect();
                if (required) {
                    console.warn(`[oja/ui] Required element not found after ${timeout}ms: ${selector}`);
                }
                resolve(null);
            }, timeout);
        });
    }

    const el = scope.querySelector(selector);

    if (required && !el) {
        console.warn(`[oja/ui] Required element not found: ${selector}`);
    }

    return _renderable(el);
}

export function findAll(selector, scope = document) {
    return Array.from(scope.querySelectorAll(selector)).map(_renderable);
}

/**
 * query(selector, scope?) — scoped querySelector, never auto-injected.
 *
 * The safe alternative to the injected `find` when you need DOM queries inside
 * component scripts. Because `query` is never part of the _exec.js preamble,
 * importing it can never cause a "already declared" SyntaxError — regardless
 * of what other names the script imports or declares.
 *
 *   import { query } from '../lib/oja.full.esm.js';
 *
 *   // Scoped to a container — only searches inside it:
 *   const btn = query('.save-btn', container);
 *
 *   // Falls back to document when no scope given:
 *   const modal = query('#loginModal');
 *
 * Unlike the injected `find`, query() does NOT support timeout-based waiting
 * or a `required` option — use find() directly if you need those features.
 *
 * @param {string}   selector
 * @param {Element}  [scope=document]
 * @returns {Element|null}
 */
export function query(selector, scope = document) {
    const el = (scope || document).querySelector(selector);
    return _renderable(el);
}

/**
 * queryAll(selector, scope?) — scoped querySelectorAll, never auto-injected.
 * Returns a plain Array (not NodeList) so .forEach/.map/.filter work directly.
 * Safe alternative to findAll when you need DOM queries inside component scripts
 * without risking name conflicts with injected variables.
 *
 *   import { queryAll } from '../lib/oja.full.esm.js';
 *
 *   // All .chip elements inside a container:
 *   queryAll('.chip', container).forEach(c => c.classList.remove('active'));
 *
 *   // Falls back to document when no scope given:
 *   queryAll('.chart-tab').forEach(t => t.classList.remove('active'));
 *
 * @param {string}  selector
 * @param {Element} [scope=document]
 * @returns {Element[]}
 */
export function queryAll(selector, scope = document) {
    return Array.from((scope || document).querySelectorAll(selector)).map(_renderable);
}

export function findAllIn(scope, selectors, options = {}) {
    const { required = false } = options;

    return selectors.map(selector => {
        const el = scope.querySelector(selector);

        if (required && !el) {
            console.warn(`[oja/ui] Required element not found in scope: ${selector}`);
        }

        return el;
    });
}

export function createEl(tag, attrs = {}) {
    const el = document.createElement(tag);

    for (const [key, value] of Object.entries(attrs)) {
        if (key === 'text') {
            el.textContent = value;
        } else if (key === 'html') {
            el.innerHTML = value;
        } else if (key === 'children' && Array.isArray(value)) {
            value.forEach(child => {
                if (typeof child === 'string') {
                    el.appendChild(document.createTextNode(child));
                } else if (child instanceof Element) {
                    el.appendChild(child);
                }
            });
        } else if (key.startsWith('on') && typeof value === 'function') {
            const eventName = key.slice(2).toLowerCase();
            el.addEventListener(eventName, value);
        } else if (value === true) {
            el.setAttribute(key, '');
        } else if (value !== false && value !== null && value !== undefined) {
            el.setAttribute(key, value);
        }
    }

    return _renderable(el);
}

/**
 * make(html, options?) — create a DOM element from an HTML string and
 * optionally append it to a parent (defaults to document.body).
 *
 * Useful in component scripts and tests — a one-liner that replaces the
 * three-step createElement / innerHTML / appendChild pattern.
 *
 *   const card = make('<div class="card"><p>Hello</p></div>');
 *   const row  = make('<tr><td>Alice</td></tr>', { parent: find('#table-body') });
 *
 * Returns the first child element so you get the actual node, not a wrapper.
 * If the HTML has multiple root elements, returns a DocumentFragment instead.
 *
 * @param {string}   html           — HTML string to parse
 * @param {Object}   [options]
 * @param {Element}  [options.parent=document.body] — element to append into
 * @returns {Element|DocumentFragment}
 */
/**
 * make(tag, options?, ...children) — programmatic DOM builder.
 *
 * Creates an element, applies options, appends children, and returns an
 * enhanced element with .update(), .list(), .render(), and placement methods
 * (.appendTo, .prependTo, .after, .before, .replace).
 *
 * The first argument after `tag` is optional — if it is not a plain object
 * (or is a string / Element / array), it is treated as a child, not options.
 *
 * ─── Options ────────────────────────────────────────────────────────────────
 *
 *   class  : string | string[]          — className
 *   id     : string                     — element id
 *   style  : object                     — inline styles
 *   attrs  : object                     — arbitrary HTML attributes
 *   data   : object                     — data-* attributes (key → data-key)
 *   on     : object                     — event listeners { click: fn, ... }
 *   text   : string                     — textContent shorthand
 *   html   : string                     — innerHTML shorthand
 *
 * ─── Children ───────────────────────────────────────────────────────────────
 *
 *   string | number  → text node
 *   Element          → appended directly
 *   Array            → each item appended
 *
 * ─── Placement (on the returned element) ────────────────────────────────────
 *
 *   .appendTo(target)   — append as last child of target
 *   .prependTo(target)  — prepend as first child of target
 *   .after(target)      — insert immediately after target (as next sibling)
 *   .before(target)     — insert immediately before target (as prev sibling)
 *   .replace(target)    — replace target with this element
 *
 *   All placement methods accept a CSS selector string or an Element.
 *   All return `this` so the chain continues.
 *
 * ─── Examples ───────────────────────────────────────────────────────────────
 *
 *   make.div({ class: 'card', data: { id: host.id } },
 *       make.h2({ class: 'title' }, host.name),
 *       make.p({ style: { color: 'var(--text-mute)' } }, host.status),
 *       make.button({ class: 'btn-danger', on: { click: () => del(host.id) } }, 'Delete'),
 *   ).appendTo('#host-list');
 *
 *   // Enhance an existing element
 *   make(document.getElementById('legacy')).appendTo('#new-container');
 *
 * @param {string|Element} tag
 * @param {Object|string|Element|Array} [optionsOrChild]
 * @param {...(string|number|Element|Array)} children
 * @returns {Element} — enhanced with update/list/render/placement methods
 */
export function make(tag, optionsOrChild, ...rest) {
    // Allow make(existingElement) to just enhance and return it
    if (tag instanceof Element) {
        return _renderable(tag);
    }

    const el = document.createElement(tag);

    // Determine if second arg is options or a child
    let options = {};
    let children = rest;

    if (optionsOrChild !== undefined) {
        const isOptions = optionsOrChild !== null
            && typeof optionsOrChild === 'object'
            && !Array.isArray(optionsOrChild)
            && !(optionsOrChild instanceof Element)
            && !(optionsOrChild instanceof Node);

        if (isOptions) {
            options = optionsOrChild;
        } else {
            children = [optionsOrChild, ...rest];
        }
    }

    // ── Apply options ──────────────────────────────────────────────────────

    if (options.id) el.id = options.id;

    if (options.class) {
        if (Array.isArray(options.class)) {
            el.classList.add(...options.class.filter(Boolean));
        } else {
            // String — assign directly so 'card active' works as-is
            el.className = options.class;
        }
    }

    if (options.style) {
        Object.assign(el.style, options.style);
    }

    if (options.attrs) {
        for (const [k, v] of Object.entries(options.attrs)) {
            if (v !== null && v !== undefined) el.setAttribute(k, String(v));
        }
    }

    if (options.data) {
        for (const [k, v] of Object.entries(options.data)) {
            if (v !== null && v !== undefined) el.dataset[k] = String(v);
        }
    }

    if (options.on) {
        for (const [event, handler] of Object.entries(options.on)) {
            if (typeof handler === 'function') el.addEventListener(event, handler);
        }
    }

    if (options.html !== undefined) {
        el.innerHTML = options.html;
    } else if (options.text !== undefined) {
        el.textContent = String(options.text);
    }

    // ── Append children ────────────────────────────────────────────────────

    const _append = (child) => {
        if (child === null || child === undefined) return;
        if (typeof child === 'string' || typeof child === 'number') {
            el.appendChild(document.createTextNode(String(child)));
        } else if (child instanceof Node) {
            el.appendChild(child);
        } else if (Array.isArray(child)) {
            child.forEach(_append);
        }
    };

    children.forEach(_append);

    return _renderable(el);
}

// make.div(...), make.span(...), make.button(...) etc.
// Each accepts the same (options?, ...children) signature as make().

const _TAGS = [
    'div', 'span', 'p', 'a', 'button', 'input', 'textarea', 'select',
    'form', 'label', 'img', 'svg',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'section', 'article', 'aside', 'header', 'footer', 'main', 'nav',
    'figure', 'figcaption', 'blockquote', 'pre', 'code',
    'strong', 'em', 'small', 'mark', 'del', 'ins',
    'details', 'summary', 'dialog',
];

_TAGS.forEach(tag => {
    make[tag] = (optionsOrChild, ...rest) => make(tag, optionsOrChild, ...rest);
});

export function empty(target) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return el;

    while (el.firstChild) {
        el.removeChild(el.firstChild);
    }

    return el;
}

export function removeEl(target) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el || !el.parentNode) return false;

    el.parentNode.removeChild(el);
    return true;
}

export function afterEl(target, html) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;

    el.insertAdjacentHTML('afterend', html);
}

export function beforeEl(target, html) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;

    el.insertAdjacentHTML('beforebegin', html);
}

export function toggleEl(target, force) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return false;

    const isHidden = window.getComputedStyle(el).display === 'none';
    const shouldShow = force !== undefined ? force : isHidden;

    el.style.display = shouldShow ? '' : 'none';
    return shouldShow;
}

export function matches(el, selector) {
    return el.matches(selector);
}

export function closest(el, selector) {
    return el.closest(selector);
}

const SPINNER = `<svg class="oja-loading-spinner" viewBox="0 0 24 24" fill="none"
    width="14" height="14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M12 2V6M12 18V22M4.93 4.93L7.76 7.76M16.24 16.24L19.07 19.07
             M2 12H6M18 12H22M4.93 19.07L7.76 16.24M16.24 7.76L19.07 4.93"
          stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

const _widgets = new Map();

class UiElement {
    constructor(el) {
        this._el = el;

        // Persist original content on the DOM element so rapid consecutive UI
        // instantiations don't accidentally capture the loading spinner as the
        // original content.
        if (el._ojaOriginal === undefined) {
            el._ojaOriginal = el.innerHTML;
        }

        this._original = el._ojaOriginal;
        this._originalTag = el.tagName.toLowerCase();
    }

    /**
     * Bridges Oja Responders to the element.
     * Allows: ui('#b').render(Out.text('hello'))
     */
    render(responder) {
        if (responder && typeof responder.render === 'function') {
            responder.render(this._el);
        }
        return this;
    }

    loading(message) {
        const msg = message ?? this._el.dataset.loading ?? '';

        this._el.classList.add('oja-loading');
        this._el.classList.remove('oja-done', 'oja-error');
        this._el.setAttribute('disabled', '');
        this._el.setAttribute('aria-busy', 'true');
        this._el.innerHTML = msg ? `${SPINNER}<span>${_esc(msg)}</span>` : SPINNER;

        clearTimeout(this._el._ojaTimer);
        return this;
    }

    done(message = '✓') {
        clearTimeout(this._el._ojaTimer);
        this._el.classList.remove('oja-loading', 'oja-error');
        this._el.classList.add('oja-done');
        this._el.removeAttribute('disabled');
        this._el.removeAttribute('aria-busy');
        this._el.innerHTML = _esc(message);

        this._el._ojaTimer = setTimeout(() => this.reset(), 2000);
        return this;
    }

    error(message = '✗ Error') {
        clearTimeout(this._el._ojaTimer);
        this._el.classList.remove('oja-loading', 'oja-done');
        this._el.classList.add('oja-error');
        this._el.removeAttribute('disabled');
        this._el.removeAttribute('aria-busy');
        this._el.innerHTML = _esc(message);

        this._el._ojaTimer = setTimeout(() => this.reset(), 3000);
        return this;
    }

    reset() {
        clearTimeout(this._el._ojaTimer);
        this._el.classList.remove('oja-loading', 'oja-done', 'oja-error');
        this._el.removeAttribute('disabled');
        this._el.removeAttribute('aria-busy');
        this._el.innerHTML = this._original;

        // Clear original state from DOM node so next capture is fresh
        delete this._el._ojaOriginal;
        return this;
    }

    /**
     * Track a Promise — auto-transitions loading → done/error → reset.
     *
     *   ui(btn).track(api.post('/save', data), {
     *       loading: 'Saving…',
     *       success: 'Saved ✓',
     *       error:   'Failed',
     *       resetAfter: 2000,   // ms before reset after success/error (default: 2000)
     *   });
     *
     * Returns the original promise so callers can still await/chain it.
     */
    track(promise, opts = {}) {
        const loading    = opts.loading    ?? this._el.dataset.loading ?? 'Loading…';
        const success    = opts.success    ?? this._el.dataset.success ?? '✓';
        const error      = opts.error      ?? this._el.dataset.error   ?? '✗ Failed';
        const resetAfter = opts.resetAfter ?? 2000;

        this.loading(loading);

        promise.then(
            ()  => { this.done(success);  if (resetAfter) setTimeout(() => this.reset(), resetAfter); },
            (e) => { this.error(typeof error === 'function' ? error(e) : error); },
        );

        return promise;
    }

    get isLoading() { return this._el.classList.contains('oja-loading'); }
    get el() { return this._el; }
}

export function ui(target) {
    const el = typeof target === 'string'
        ? document.querySelector(target)
        : target;

    if (!el) {
        console.warn(`[oja/ui] element not found: ${target}`);
        return {
            loading: function() { return this; },
            done:    function() { return this; },
            error:   function() { return this; },
            reset:   function() { return this; },
            render:  function() { return this; }
        };
    }

    return new UiElement(el);
}

/**
 * ui.btn — static API for button/link state management.
 * Identical to ui(el).method() but accepts the element directly.
 * Use this when you already have the element reference (e.g. inside an event handler).
 *
 *   on('#save', 'click', async (e, el) => {
 *       ui.btn.loading(el, 'Saving…');
 *       try {
 *           await api.post('/save', data);
 *           ui.btn.done(el, 'Saved ✓');
 *       } catch(e) {
 *           ui.btn.error(el, 'Failed');
 *       }
 *   });
 *
 *   // Promise shorthand — auto loading → success/error → reset:
 *   ui.btn.track(el, savePromise, { loading: 'Saving…', success: 'Saved ✓' });
 *
 * Works on <button>, <a>, and any element with disabled support.
 * Stores original content in el._ojaOriginal — safe across rapid calls.
 */
ui.btn = {
    loading(el, message) { return ui(el).loading(message); },
    done(el, message)    { return ui(el).done(message); },
    error(el, message)   { return ui(el).error(message); },
    reset(el)            { return ui(el).reset(); },
    track(el, promise, opts) { return ui(el).track(promise, opts); },
};

ui.theme = {
    set(name) {
        document.documentElement.setAttribute('data-theme', name);
        try {
            localStorage.setItem('oja-theme', name);
        } catch (e) {}
        emit('ui:theme:changed', { theme: name });
    },

    get() {
        let saved = 'dark';
        try {
            saved = localStorage.getItem('oja-theme') || 'dark';
        } catch (e) {}
        return document.documentElement.getAttribute('data-theme') || saved;
    },

    toggle(a = 'dark', b = 'light') {
        this.set(this.get() === a ? b : a);
    }
};

ui.widget = {
    register(name, initFn) {
        _widgets.set(name, initFn);
        return this;
    },

    wire(scope) {
        const root = scope
            ? (typeof scope === 'string' ? document.querySelector(scope) : scope)
            : document.body;

        if (!root) return;

        _widgets.forEach((initFn, name) => {
            root.querySelectorAll(`[data-ui="${name}"]`).forEach(el => {
                if (el._ojaWired) return;
                initFn(el);
                el._ojaWired = true;
            });
        });
    }
};

ui.wire = function(scope) {
    const root = scope
        ? (typeof scope === 'string' ? document.querySelector(scope) : scope)
        : document.body;

    if (!root) return;

    root.querySelectorAll('[data-loading]').forEach(el => {
        if (el._ojaUiWired) return;
        el._ojaUiWired = true;

        el.addEventListener('click', () => {
            const wrapper = ui(el);

            if (el.hasAttribute('data-page') || el.hasAttribute('href')) {
                wrapper.loading();
                const unsub = listen('oja:navigate:end', () => {
                    wrapper.reset();
                    unsub();
                });
                setTimeout(() => { wrapper.reset(); unsub(); }, 10000);
            }
        });
    });

    this.widget.wire(root);
};

listen('oja:navigate:start', ({ path }) => {
    document.querySelectorAll(`[data-page="${path}"][data-loading]`).forEach(el => {
        ui(el).loading();
    });
});

listen('oja:navigate:end', () => {
    document.querySelectorAll('[data-page].oja-loading').forEach(el => {
        ui(el).reset();
    });
    ui.widget.wire(document.body);
});

listen('oja:component:added', ({ el }) => {
    if (el) ui.widget.wire(el);
});

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => ui.wire());
    } else {
        ui.wire();
    }
}

function _esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Attaches Oja's .render method to a standard DOM element.
 * Bridges the gap between ui.js helpers and Oja Responders.
 */
function _renderable(el) {
    if (!el || el.__oja_enhanced__) return el;
    el.__oja_enhanced__ = true;

    // Helper — safely define a property only if it is not a read-only native.
    // HTMLInputElement.list, HTMLSelectElement.form, etc. are native getters
    // that throw if you try to assign to them directly.
    const _define = (name, fn) => {
        const desc = Object.getOwnPropertyDescriptor(el, name)
            || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), name)
            || Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
        if (desc && desc.set === undefined && desc.writable === false) return;
        try { el[name] = fn; } catch (_) { /* native read-only — skip */ }
    };

    // ── Placement helpers ─────────────────────────────────────────────────────
    // All accept a CSS selector string or an Element. All return `this`.

    const _resolveTarget = (target) =>
        typeof target === 'string' ? document.querySelector(target) : target;

    /** Append as last child of target. */
    _define('appendTo', function(target) {
        const t = _resolveTarget(target);
        if (t) t.appendChild(el);
        else console.warn('[oja/make] appendTo: target not found:', target);
        return el;
    });

    /** Prepend as first child of target. */
    _define('prependTo', function(target) {
        const t = _resolveTarget(target);
        if (t) t.prepend(el);
        else console.warn('[oja/make] prependTo: target not found:', target);
        return el;
    });

    /**
     * Insert this element immediately after target (as next sibling).
     * Named insertAfter (not after) to avoid overwriting the native
     * Element.prototype.after() which inserts nodes after this element.
     */
    _define('insertAfter', function(target) {
        const t = _resolveTarget(target);
        if (t?.parentNode) t.parentNode.insertBefore(el, t.nextSibling);
        else console.warn('[oja/make] insertAfter: target not found:', target);
        return el;
    });

    /**
     * Insert this element immediately before target (as previous sibling).
     * Named insertBefore (not before) to avoid overwriting the native
     * Element.prototype.before() which inserts nodes before this element.
     */
    _define('insertBefore', function(target) {
        const t = _resolveTarget(target);
        if (t?.parentNode) t.parentNode.insertBefore(el, t);
        else console.warn('[oja/make] insertBefore: target not found:', target);
        return el;
    });

    /** Replace target entirely with this element. */
    _define('replace', function(target) {
        const t = _resolveTarget(target);
        if (t?.parentNode) t.parentNode.replaceChild(el, t);
        else console.warn('[oja/make] replace: target not found:', target);
        return el;
    });

    // ── el.on(event, fn) / el.on(event, selector, fn) ───────────────────────────
    //
    // Attaches an event listener to this element.
    //
    //   el.on('click', handler)
    //     — direct listener on this element, equivalent to addEventListener
    //       but auto-removed on component unmount.
    //
    //   el.on('click', '[data-item]', handler)
    //     — delegated listener scoped to descendants of this element.
    //       Fires when e.target.closest(selector) is inside this element.
    //       Also auto-removed on component unmount.
    //
    // Both forms return `this` so the chain continues:
    //
    //   find('#list')
    //     .on('click', '[data-item]', (e, item) => open(item.dataset.id))
    //     .on('keydown', handleKey)
    //     .update({ class: { remove: 'loading' } });
    //
    _define('on', function(event, selectorOrFn, fn) {
        if (typeof selectorOrFn === 'function') {
            // Direct — pass element as EventTarget to _on() so scope cleanup is
            // registered automatically with the active component.
            _on(el, event, selectorOrFn);
        } else if (typeof selectorOrFn === 'string' && typeof fn === 'function') {
            // Delegated — listen on this element, check if the event originated
            // from a descendant that matches the selector.
            const wrapped = (e) => {
                if (!e.target || typeof e.target.closest !== 'function') return;
                const target = e.target.closest(selectorOrFn);
                if (target && (el === target || el.contains(target))) fn(e, target);
            };
            // Store original fn reference for potential removal
            wrapped.__oja_original__ = fn;
            // Use _on with the element as EventTarget — handles scope cleanup
            _on(el, event, wrapped);
        }
        return el;
    });

    // ── el.once(event, fn) / el.once(event, selector, fn) ────────────────────
    //
    // Same as el.on() but the handler removes itself after the first call.
    //
    _define('once', function(event, selectorOrFn, fn) {
        if (typeof selectorOrFn === 'function') {
            _once(el, event, selectorOrFn);
        } else if (typeof selectorOrFn === 'string' && typeof fn === 'function') {
            // Delegated once — wrap to self-remove after first match
            let wrapped;
            wrapped = (e) => {
                if (!e.target || typeof e.target.closest !== 'function') return;
                const target = e.target.closest(selectorOrFn);
                if (target && (el === target || el.contains(target))) {
                    el.removeEventListener(event, wrapped);
                    fn(e, target);
                }
            };
            _on(el, event, wrapped);
        }
        return el;
    });

    // ── el.render(out) ────────────────────────────────────────────────────────
    // Original render — accepts any Out and renders it into the element.
    _define('render', function(responder) {
        if (responder && typeof responder.render === 'function') {
            responder.render(el);
        }
        return el;
    });

    // ── el.update(descriptor) ─────────────────────────────────────────────────
    //
    // Declarative patch — describe what the element should look like.
    // Any key whose value is a function that reads signals is automatically
    // wrapped in effect() and re-runs whenever those signals change.
    //
    // Supported keys:
    //   text      : string | () => string          — sets textContent
    //   html      : string | () => string          — sets innerHTML
    //   out       : Out    | () => Out             — renders any Out
    //   component : string (url), data?: object    — shorthand for out: Out.c(...)
    //   fn        : async (el) => void | Out       — full control; return Out or mutate directly
    //   class     : { add?, remove?, toggle? } | () => same
    //   attr      : { key: value|null } | () => same — null removes the attribute
    //   style     : { prop: value } | () => same
    //
    // Examples:
    //
    //   find('#badge').update({ text: 'Online', class: { add: 'badge-success' } });
    //
    //   find('#panel').update({ out: Out.c('components/detail.html', { host }) });
    //
    //   find('#panel').update({ component: 'components/detail.html', data: { host } });
    //
    //   find('#count').update({ text: () => `${tasks().length} tasks` }); // reactive
    //
    //   find('#chart').update({
    //       fn: async (el) => {
    //           const data = await api.get('/metrics');
    //           return Out.timeSeries(data.series, { height: 80 });
    //       },
    //   });
    //
    _define('update', function(descriptor = {}) {
        const _applyOnce = async (desc) => {
            // ── class ─────────────────────────────────────────────────────────
            if (desc.class) {
                const cls = typeof desc.class === 'function' ? desc.class() : desc.class;
                if (cls.add)    [].concat(cls.add).forEach(c => c && el.classList.add(c));
                if (cls.remove) [].concat(cls.remove).forEach(c => c && el.classList.remove(c));
                if (cls.toggle) [].concat(cls.toggle).forEach(c => c && el.classList.toggle(c));
            }

            // ── attr ──────────────────────────────────────────────────────────
            if (desc.attr) {
                const attrs = typeof desc.attr === 'function' ? desc.attr() : desc.attr;
                for (const [k, v] of Object.entries(attrs)) {
                    if (v === null || v === undefined) el.removeAttribute(k);
                    else el.setAttribute(k, String(v));
                }
            }

            // ── style ─────────────────────────────────────────────────────────
            if (desc.style) {
                const styles = typeof desc.style === 'function' ? desc.style() : desc.style;
                Object.assign(el.style, styles);
            }

            // ── content — text / html / out / component / fn ──────────────────
            if (desc.fn !== undefined) {
                const result = await desc.fn(el);
                if (result && typeof result.render === 'function') {
                    await result.render(el);
                }
            } else if (desc.out !== undefined) {
                const out = typeof desc.out === 'function' ? desc.out() : desc.out;
                if (out && typeof out.render === 'function') await out.render(el);
            } else if (desc.component !== undefined) {
                // Lazy import to avoid circular dep at module parse time
                const { Out } = await import('./out.js');
                const out = Out.component(desc.component, desc.data || {});
                await out.render(el);
            } else if (desc.html !== undefined) {
                const val = typeof desc.html === 'function' ? desc.html() : desc.html;
                el.innerHTML = val;
            } else if (desc.text !== undefined) {
                const val = typeof desc.text === 'function' ? desc.text() : desc.text;
                el.textContent = val;
            }
        };

        // Determine if any value is a function (potential signal reader).
        // If so, wrap the whole descriptor application in effect() so it
        // re-runs automatically when any signal it reads changes.
        const hasReactive = Object.values(descriptor).some(v => typeof v === 'function');

        if (hasReactive) {
            effect(() => { _applyOnce(descriptor); });
        } else {
            _applyOnce(descriptor);
        }

        return el;
    });

    // ── el.list(items, options) ───────────────────────────────────────────────
    //
    // Keyed list reconciliation — shorthand over engine.list().
    // Only changed nodes are patched. Existing nodes are passed back to
    // render() as the second argument so you can update them in place.
    //
    //   find('#task-list').list(tasks(), {
    //       key:    t => t.id,
    //       render: t => Out.c('components/task.html', t),  // returns an Out
    //       empty:  Out.h('<p>No tasks yet</p>'),
    //   });
    //
    //   // Reactive — re-reconciles when tasks() signal changes
    //   find('#task-list').list(() => tasks(), {
    //       key:    t => t.id,
    //       render: t => Out.c('components/task.html', t),
    //       empty:  Out.h('<p>No tasks yet</p>'),
    //   });
    //
    _define('list', function(itemsOrSignal, options = {}) {
        const { key, render: renderFn, empty } = options;

        if (!renderFn) {
            console.warn('[oja/ui] el.list() requires a render function');
            return el;
        }

        const _reconcile = async (items) => {
            if (!items || items.length === 0) {
                el.innerHTML = '';
                if (empty) {
                    const out = typeof empty === 'function' && !empty.__isOjaSignal
                        ? empty()
                        : empty;
                    if (out && typeof out.render === 'function') {
                        await out.render(el);
                    } else if (typeof out === 'string') {
                        el.innerHTML = out;
                    }
                }
                return;
            }

            // Build a map of existing keyed nodes
            const existing = new Map();
            if (key) {
                Array.from(el.children).forEach(child => {
                    const k = child.dataset.listKey;
                    if (k !== undefined) existing.set(k, child);
                });
            }

            // Render each item
            const fragment = document.createDocumentFragment();
            for (const item of items) {
                const k = key ? String(key(item)) : null;
                const existingEl = k ? existing.get(k) : null;

                const out = renderFn(item, existingEl);

                if (out && typeof out.render === 'function') {
                    // Out returned — render into a slot
                    const slot = existingEl || document.createElement('div');
                    if (k) slot.dataset.listKey = k;
                    if (!existingEl) await out.render(slot);
                    else await out.render(slot); // re-render in place
                    fragment.appendChild(slot);
                } else if (out instanceof Element) {
                    // Raw element returned
                    if (k) out.dataset.listKey = k;
                    fragment.appendChild(out);
                }
            }

            el.innerHTML = '';
            el.appendChild(fragment);
        };

        // If itemsOrSignal is a function, treat it as a signal — wrap in effect()
        if (typeof itemsOrSignal === 'function' && !itemsOrSignal.__isOjaOut) {
            effect(() => { _reconcile(itemsOrSignal()); });
        } else {
            _reconcile(itemsOrSignal);
        }

        return el;
    });

    return el;
}

ui.find = find;
ui.findAll = findAll;
ui.findAllIn = findAllIn;
ui.make = make;
ui.createEl = createEl;
ui.empty = empty;
ui.remove = removeEl;
ui.after = afterEl;
ui.before = beforeEl;
ui.toggle = toggleEl;
ui.matches = matches;
ui.closest = closest;