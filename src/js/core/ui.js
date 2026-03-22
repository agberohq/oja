// src/js/core/ui.js
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

import { listen, emit } from './events.js';

export function find(selector, options = {}) {
    const { required = false, scope = document, timeout = 0 } = options;

    if (timeout > 0) {
        return new Promise((resolve) => {
            const el = scope.querySelector(selector);
            if (el) {
                resolve(el);
                return;
            }

            const observer = new MutationObserver((mutations, obs) => {
                const el = scope.querySelector(selector);
                if (el) {
                    obs.disconnect();
                    resolve(el);
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

    return el;
}

export function findAll(selector, scope = document) {
    return Array.from(scope.querySelectorAll(selector));
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
    return (scope || document).querySelector(selector);
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

    return el;
}

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
            reset:   function() { return this; }
        };
    }

    return new UiElement(el);
}

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

ui.find = find;
ui.findAll = findAll;
ui.findAllIn = findAllIn;
ui.createEl = createEl;
ui.empty = empty;
ui.remove = removeEl;
ui.after = afterEl;
ui.before = beforeEl;
ui.toggle = toggleEl;
ui.matches = matches;
ui.closest = closest;