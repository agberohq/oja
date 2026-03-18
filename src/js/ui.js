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
 *   import { ui } from '../oja/ui.js';
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

// ─── Spinner SVG ──────────────────────────────────────────────────────────────

const SPINNER = `<svg class="oja-loading-spinner" viewBox="0 0 24 24" fill="none"
    width="14" height="14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M12 2V6M12 18V22M4.93 4.93L7.76 7.76M16.24 16.24L19.07 19.07
             M2 12H6M18 12H22M4.93 19.07L7.76 16.24M16.24 7.76L19.07 4.93"
          stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

// ─── Registries ───────────────────────────────────────────────────────────────

const _widgets = new Map(); // name -> init function

// ─── Element wrapper ──────────────────────────────────────────────────────────

class UiElement {
    constructor(el) {
        this._el          = el;
        this._original    = el.innerHTML;
        this._originalTag = el.tagName.toLowerCase();
        this._timer       = null;
    }

    /**
     * Show loading state — disables element, shows spinner + message.
     * Returns `this` for fluent chaining.
     */
    loading(message) {
        const msg = message
            ?? this._el.dataset.loading
            ?? '';

        this._el.classList.add('oja-loading');
        this._el.classList.remove('oja-done', 'oja-error');
        this._el.setAttribute('disabled', '');
        this._el.setAttribute('aria-busy', 'true');
        this._el.innerHTML = msg
            ? `${SPINNER}<span>${_esc(msg)}</span>`
            : SPINNER;

        clearTimeout(this._timer);
        return this;
    }

    /**
     * Show brief success state, then restore after 2 seconds.
     * Returns `this` for fluent chaining.
     */
    done(message = '✓') {
        clearTimeout(this._timer);
        this._el.classList.remove('oja-loading', 'oja-error');
        this._el.classList.add('oja-done');
        this._el.removeAttribute('disabled');
        this._el.removeAttribute('aria-busy');
        this._el.innerHTML = _esc(message);

        this._timer = setTimeout(() => this.reset(), 2000);
        return this;
    }

    /**
     * Show brief error state, then restore after 3 seconds.
     * Returns `this` for fluent chaining.
     */
    error(message = '✗ Error') {
        clearTimeout(this._timer);
        this._el.classList.remove('oja-loading', 'oja-done');
        this._el.classList.add('oja-error');
        this._el.removeAttribute('disabled');
        this._el.removeAttribute('aria-busy');
        this._el.innerHTML = _esc(message);

        this._timer = setTimeout(() => this.reset(), 3000);
        return this;
    }

    /**
     * Restore the element to its original state immediately.
     * Returns `this` for fluent chaining.
     */
    reset() {
        clearTimeout(this._timer);
        this._el.classList.remove('oja-loading', 'oja-done', 'oja-error');
        this._el.removeAttribute('disabled');
        this._el.removeAttribute('aria-busy');
        this._el.innerHTML = this._original;
        return this;
    }

    /** Is element currently in loading state? */
    get isLoading() { return this._el.classList.contains('oja-loading'); }

    /** The underlying DOM element */
    get el() { return this._el; }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a UiElement wrapper for the given element.
 */
export function ui(target) {
    const el = typeof target === 'string'
        ? document.querySelector(target)
        : target;

    if (!el) {
        console.warn(`[oja/ui] element not found: ${target}`);
        // Return a no-op wrapper so callers don't need to null-check
        return {
            loading: function() { return this; },
            done:    function() { return this; },
            error:   function() { return this; },
            reset:   function() { return this; }
        };
    }

    return new UiElement(el);
}

/**
 * Theme Management
 */
ui.theme = {
    /** Set the theme name (applied as data-theme attribute on <html>) */
    set(name) {
        document.documentElement.setAttribute('data-theme', name);
        try {
            // Guard against Private Mode exceptions
            localStorage.setItem('oja-theme', name);
        } catch (e) {}
        emit('ui:theme:changed', { theme: name });
    },

    /** Get current theme name */
    get() {
        let saved = 'dark';
        try {
            // Guard against Private Mode exceptions
            saved = localStorage.getItem('oja-theme') || 'dark';
        } catch (e) {}
        return document.documentElement.getAttribute('data-theme') || saved;
    },

    /** Toggle between two theme names */
    toggle(a = 'dark', b = 'light') {
        this.set(this.get() === a ? b : a);
    }
};

/**
 * Widget Management (Pickers, Selects, etc)
 */
ui.widget = {
    /** Register a widget initializer */
    register(name, initFn) {
        _widgets.set(name, initFn);
        return this;
    },

    /** Wire widgets in a specific container */
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

/**
 * Wire all Oja-enhanced elements in a container.
 */
ui.wire = function(scope) {
    const root = scope
        ? (typeof scope === 'string' ? document.querySelector(scope) : scope)
        : document.body;

    if (!root) return;

    // 1. Wire data-loading logic for clicks
    root.querySelectorAll('[data-loading]').forEach(el => {
        if (el._ojaUiWired) return;
        el._ojaUiWired = true;

        el.addEventListener('click', () => {
            const wrapper = ui(el);

            // If it's a navigation link, auto-restore on navigation end
            if (el.hasAttribute('data-page') || el.hasAttribute('href')) {
                wrapper.loading();
                const unsub = listen('oja:navigate:end', () => {
                    wrapper.reset();
                    unsub();
                });
                // Safety net
                setTimeout(() => { wrapper.reset(); unsub(); }, 10000);
            }
        });
    });

    // 2. Wire widgets (pickers, etc)
    this.widget.wire(root);
};

// ─── Listeners ────────────────────────────────────────────────────────────────

listen('oja:navigate:start', ({ path }) => {
    document.querySelectorAll(`[data-page="${path}"][data-loading]`).forEach(el => {
        ui(el).loading();
    });
});

listen('oja:navigate:end', () => {
    // Restore nav buttons
    document.querySelectorAll('[data-page].oja-loading').forEach(el => {
        ui(el).reset();
    });
    // Auto-wire new widgets on new page content
    ui.widget.wire(document.body);
});

// Auto-wire on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ui.wire());
} else {
    ui.wire();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}