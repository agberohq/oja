/**
 * oja/modal.js
 * Modal stack — handles normal modals and cascading drawer/modal patterns.
 * Escape key and browser back always close the top of the stack.
 *
 * ─── Normal modal ─────────────────────────────────────────────────────────────
 *
 *   import { modal } from '../oja/modal.js';
 *
 *   modal.open('loginModal');
 *   modal.open('confirmModal', { message: 'Are you sure?' });
 *   modal.close();      // closes top of stack
 *   modal.closeAll();   // closes everything
 *
 * ─── Cascading drawers (admin pattern) ───────────────────────────────────────
 *
 *   // hosts page → open route drawer (level 1)
 *   modal.push('routeDrawer', { host: 'api.example.com', idx: 0 });
 *
 *   // inside route drawer → open backend drawer (level 2)
 *   modal.push('backendDrawer', { backend: backendData });
 *
 *   // inside backend drawer → confirm action (level 3)
 *   modal.push('confirmModal', { message: 'Delete backend?', onConfirm: fn });
 *
 *   // Escape or back → pop one level at a time
 *   modal.pop();
 *
 * ─── Lifecycle hooks ──────────────────────────────────────────────────────────
 *
 *   modal.onOpen('routeDrawer', (data) => renderRouteDrawer(data));
 *   modal.onClose('routeDrawer', () => cleanup());
 *
 * ─── Dynamic content via Out ─────────────────────────────────────────────────
 *
 *   modal.open('detailModal', {
 *       body: Out.c('components/host-detail.html', hostData)
 *   });
 *
 *   // Plain HTML strings are also accepted — auto-wrapped as Out.html():
 *   // Note: Experimental, Out is the primary display primitive
 *   modal.open('alertModal', {
 *       body: '<p>Are you sure you want to delete this?</p>'
 *   });
 *
 * ─── HTML convention ──────────────────────────────────────────────────────────
 *
 *   <!-- Oja looks for [data-modal-body] inside the modal to render Outs -->
 *   <div class="modal-overlay" id="detailModal">
 *       <div class="modal">
 *           <button data-action="modal-close">&times;</button>
 *           <div data-modal-body></div>   ← Out renders here
 *       </div>
 *   </div>
 *
 *   <!-- Drawers use the same pattern -->
 *   <div class="drawer" id="routeDrawer">
 *       <div class="drawer-content" data-modal-body></div>
 *   </div>
 *
 *   <!-- Backdrop -->
 *   <div class="drawer-backdrop" id="drawerBackdrop"></div>
 */

import { emit, listen, on } from '../core/events.js';
import { Out }              from '../core/out.js';

const FOCUSABLE_SELECTORS = [
    'button:not([disabled])',
    '[href]:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"]):not([disabled])',
    'details:not([disabled])',
    '[contenteditable="true"]',
].join(',');

let _previousFocus    = null;
let _focusTrapActive  = false;
let _focusTrapElement = null;

function _setupFocusTrap(modalElement) {
    if (_focusTrapActive) return;

    _previousFocus    = document.activeElement;
    _focusTrapElement = modalElement;
    _focusTrapActive  = true;

    modalElement.addEventListener('keydown', _handleTrapKeydown);
    _focusFirstElement(modalElement);
}

function _releaseFocusTrap() {
    if (!_focusTrapActive) return;

    _focusTrapElement?.querySelectorAll('[data-oja-focus-fallback]').forEach(el => el.remove());
    _focusTrapElement?.removeEventListener('keydown', _handleTrapKeydown);
    _focusTrapActive = false;

    if (
        _previousFocus &&
        document.contains(_previousFocus) &&
        !_previousFocus.disabled &&
        !_previousFocus.hasAttribute('disabled') &&
        _previousFocus.offsetParent !== null
    ) {
        _previousFocus.focus();
    }

    _previousFocus    = null;
    _focusTrapElement = null;
}

function _handleTrapKeydown(e) {
    if (e.key !== 'Tab' || !_focusTrapActive || !_focusTrapElement) return;

    const focusable = Array.from(
        _focusTrapElement.querySelectorAll(FOCUSABLE_SELECTORS)
    ).filter(el => el.offsetParent !== null);

    if (focusable.length === 0) { e.preventDefault(); return; }

    const first = focusable[0];
    const last  = focusable[focusable.length - 1];

    if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
    }
}

function _focusFirstElement(container) {
    requestAnimationFrame(() => {
        const focusable = container.querySelector(FOCUSABLE_SELECTORS);
        if (focusable) {
            focusable.focus();
        } else {
            container.setAttribute('tabindex', '-1');
            container.focus();
        }
    });
}

function _getAllFocusable(container) {
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTORS))
        .filter(el => el.offsetParent !== null);
}

const _stack = [];
const _hooks = new Map();
const _closeGuards = new Map();
let   _backdrop = null;

// Hidden sibling tracking for aria isolation
const _hiddenSiblings = [];

function _hideSiblingsFromAT(modalEl) {
    _hiddenSiblings.length = 0;
    // Walk direct children of body; hide everything that is not the modal or its overlay
    for (const child of document.body.children) {
        if (child === modalEl || child.contains(modalEl)) continue;
        if (child.getAttribute('aria-hidden') === 'true') continue; // already hidden
        if (child.id === 'oja-announcer') continue;
        child.setAttribute('aria-hidden', 'true');
        child.setAttribute('inert', '');
        _hiddenSiblings.push(child);
    }
}

function _restoreSiblingsFromAT() {
    for (const el of _hiddenSiblings) {
        el.removeAttribute('aria-hidden');
        el.removeAttribute('inert');
    }
    _hiddenSiblings.length = 0;
}

function _setAriaHidden(element, hidden) {
    if (!element) return;
    element.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    if (element.classList.contains('drawer') || element.classList.contains('modal-overlay')) {
        if (hidden) element.setAttribute('inert', '');
        else        element.removeAttribute('inert');
    }
}

function _announce(message) {
    const announcer = document.getElementById('oja-announcer');
    if (!announcer) return;
    announcer.textContent = message;
}

// Tracks any in-flight confirm promise resolver keyed by modal ID.
// A second call before the first resolves dismisses the previous one gracefully.
const _pendingConfirms = new Map();

// Used by modal.open() to render a body Out and return its completion promise.
class _ModalOutTarget {
    constructor(el) { this._el = el; }
    _renderAsync(out, context) {
        return out.render ? out.render(this._el, context) : Promise.resolve();
    }
}

export const modal = {

    /**
     * Open a modal or drawer by element ID.
     * Data is passed to onOpen hooks and available as [data-modal-body] context.
     * Alias: modal.push() — semantic for drawer stacks.
     */
    open(id, data = {}) {
        const el = document.getElementById(id);
        if (!el) {
            console.warn(`[oja/modal] element not found: #${id}`);
            return Promise.resolve(null);
        }

        _setAriaHidden(el, false);
        _stack.push({ id, data, element: el });
        el.classList.add('active');

        if (data.size) {
            const inner = el.querySelector('.modal') || el;
            inner.classList.add(`oja-modal-${data.size}`);
        }

        const focusable = _getAllFocusable(el);

        if (focusable.length === 0) {
            console.warn(`[oja/modal] #${id} has no focusable elements — adding fallback`);
            const fallback = document.createElement('button');
            fallback.setAttribute('aria-label', 'Close modal');
            fallback.dataset.ojaFocusFallback = 'true';
            Object.assign(fallback.style, {
                position: 'absolute', width: '1px', height: '1px',
                padding: '0', margin: '-1px', overflow: 'hidden',
                clip: 'rect(0,0,0,0)', border: '0',
            });
            fallback.addEventListener('click', () => modal.close());
            el.appendChild(fallback);
        }

        _setupFocusTrap(el);

        if (_stack.length === 1) {
            _showBackdrop();
            document.body.style.overflow = 'hidden';
            // Hide siblings of the modal from AT — do NOT set aria-hidden on body itself
            // because the modal lives inside body and would be hidden along with everything else.
            _hideSiblingsFromAT(el);
        }

        // Render body content and collect any async render promise
        let _renderPromise = null;

        if (data.body && Out.is(data.body)) {
            const bodyEl = el.querySelector('[data-modal-body]');
            if (bodyEl) {
                const out = new _ModalOutTarget(bodyEl);
                _renderPromise = out._renderAsync(data.body, data);
            }
        } else if (typeof data.body === 'string') {
            const bodyEl = el.querySelector('[data-modal-body]');
            if (bodyEl) Out.html(data.body).render(bodyEl, data);
        }

        if (data.footer && Out.is(data.footer)) {
            const footerEl = el.querySelector('[data-modal-footer]');
            if (footerEl) data.footer.render(footerEl, data);
        } else if (typeof data.footer === 'string') {
            const footerEl = el.querySelector('[data-modal-footer]');
            if (footerEl) Out.html(data.footer).render(footerEl, data);
        }

        if (Object.keys(data).length > 0) _fillModal(el, data);

        _runHooks(id, 'open', data);
        emit('modal:open', { id, data });
        _announce(`Opened ${el.getAttribute('aria-label') || id}`);

        // Return Promise<Element> resolving once body
        // has rendered. Eliminates setTimeout(50)+getElementById workaround.
        // Usage: const el = await modal.open('id', { body: Out.html('...') });
        if (_renderPromise) return _renderPromise.then(() => el);
        return Promise.resolve(el);
    },

    /** Alias for open() — semantic for drawer stacks. */
    push(id, data = {}) { return this.open(id, data); },

    /**
     * Close the top-most modal/drawer on the stack.
     */
    async close() {
        if (_stack.length === 0) return;

        // Run close guards — if any return false, cancel the close
        const top = _stack[_stack.length - 1];
        const guards = _closeGuards.get(top.id);
        if (guards?.size) {
            for (const guard of guards) {
                try {
                    const result = await guard();
                    if (result === false) return this;
                } catch (e) {
                    console.warn(`[oja/modal] beforeClose guard error:`, e);
                }
            }
        }

        const { id, element } = _stack.pop();
        element.classList.remove('active');
        _setAriaHidden(element, true);

        if (_stack.length === 0) {
            _releaseFocusTrap();
            _hideBackdrop();
            document.body.style.overflow = '';
            _restoreSiblingsFromAT();
        } else {
            const topElement = _stack[_stack.length - 1].element;
            _setupFocusTrap(topElement);
        }

        _runHooks(id, 'close');
        emit('modal:close', { id });
        _announce(`Closed ${element.getAttribute('aria-label') || id}`);

        return this;
    },

    /** Alias for close(). */
    pop() { return this.close(); },

    /**
     * Close a specific modal by ID, regardless of stack position.
     * Closes everything above it in the stack first.
     */
    closeById(id) {
        const idx = _stack.findIndex(entry => entry.id === id);
        if (idx === -1) return;
        while (_stack.length > idx) this.close();
        return this;
    },

    /** Close everything. */
    closeAll() {
        while (_stack.length > 0) this.close();
        return this;
    },

    // State

    current() { return _stack.length > 0 ? _stack[_stack.length - 1].id : null; },
    stack()   { return _stack.map(({ id, data }) => ({ id, data })); },
    isOpen(id){ return _stack.some(entry => entry.id === id); },
    depth()   { return _stack.length; },

    // Lifecycle hooks

    /**
     * Register a handler called when a modal opens.
     * Returns an unsubscribe function.
     *
     *   modal.onOpen('routeDrawer', (data) => renderRoute(data));
     */
    onOpen(id, handler) {
        _ensureHooks(id);
        _hooks.get(id).open.add(handler);
        return () => _hooks.get(id)?.open.delete(handler);
    },

    /**
     * Register a handler called when a modal closes.
     * Returns an unsubscribe function.
     *
     *   modal.onClose('routeDrawer', () => clearRouteState());
     */
    onClose(id, handler) {
        _ensureHooks(id);
        _hooks.get(id).close.add(handler);
        return () => _hooks.get(id)?.close.delete(handler);
    },

    // Backdrop

    /**
     * Register an element as the backdrop.
     * Clicking it closes the top-most modal.
     */
    setBackdrop(idOrElement) {
        _backdrop = typeof idOrElement === 'string'
            ? document.getElementById(idOrElement)
            : idOrElement;

        if (_backdrop) {
            _backdrop.setAttribute('aria-label', 'Close modal');
            _backdrop.addEventListener('click', () => modal.close());
        }
    },

    // Confirm helper

    /**
     * Programmatic confirm dialog.
     * Returns a Promise resolving to true (confirmed) or false (cancelled).
     *
     *   const confirmed = await modal.confirm('Delete this host?');
     *   if (confirmed) await api.delete(`/hosts/${id}`);
     *
     * Requires a #confirmModal in the HTML with:
     *   <p data-modal-field="message"></p>
     *   <button data-confirm-ok>Yes</button>
     *   <button data-confirm-cancel>Cancel</button>
     */
    confirm(message, options = {}) {
        const id = options.modalId || 'confirmModal';

        // If a confirm for this modal is already in flight, resolve it false
        // before opening a new one — prevents stacked click listeners on the
        // same ok/cancel buttons.
        const pending = _pendingConfirms.get(id);
        if (pending) {
            _pendingConfirms.delete(id);
            pending(false);
        }

        return new Promise(resolve => {
            _pendingConfirms.set(id, resolve);

            const done = (result) => {
                if (!_pendingConfirms.has(id)) return;
                _pendingConfirms.delete(id);
                resolve(result);
                modal.closeById(id);
            };

            modal.open(id, { message, ...options });

            const el = document.getElementById(id);
            if (!el) { done(false); return; }

            const msgEl = el.querySelector('[data-modal-field="message"]');
            if (msgEl) {
                msgEl.textContent = message;
                msgEl.id = 'confirm-message';
                el.setAttribute('aria-describedby', 'confirm-message');
            }

            const ok     = el.querySelector('[data-confirm-ok]');
            const cancel = el.querySelector('[data-confirm-cancel]');

            if (ok)     ok.setAttribute('aria-label',     options.okLabel     || 'Confirm');
            if (cancel) cancel.setAttribute('aria-label', options.cancelLabel || 'Cancel');

            ok?.addEventListener('click',     () => done(true),  { once: true });
            cancel?.addEventListener('click', () => done(false), { once: true });

            const unsub = listen('modal:close', ({ id: closedId }) => {
                if (closedId === id) { unsub(); done(false); }
            });
        });
    },

    // Prompt helper

    /**
     * Programmatic input prompt dialog.
     * Returns a Promise resolving to the entered string, or null if cancelled.
     *
     *   const name = await modal.prompt('Rename note', {
     *       default: meta.title,
     *       placeholder: 'Note name',
     *       confirm: 'Rename',
     *   });
     *   if (name) renameNote(id, name);
     *
     * Requires a #promptModal in the HTML with:
     *   <p data-modal-field="message"></p>
     *   <input data-prompt-input>
     *   <button data-prompt-ok>OK</button>
     *   <button data-prompt-cancel>Cancel</button>
     *
     * Alternatively, if no #promptModal exists, modal.prompt() injects a
     * temporary one automatically — zero HTML required.
     */
    prompt(message, options = {}) {
        const {
            modalId     = 'promptModal',
            default: defaultValue = '',
            placeholder = '',
            confirm     = 'OK',
            cancel      = 'Cancel',
        } = options;

        return new Promise(resolve => {
            let el = document.getElementById(modalId);
            let _injected = false;

            // Auto-inject a minimal prompt modal if none exists in the HTML
            if (!el) {
                _injected = true;
                el = document.createElement('div');
                el.id = modalId;
                el.className = 'modal-overlay';
                el.setAttribute('role', 'dialog');
                el.setAttribute('aria-modal', 'true');
                el.innerHTML = `
                    <div class="modal" style="min-width:300px;max-width:480px">
                        <p data-modal-field="message" style="margin-bottom:12px;font-weight:500"></p>
                        <input data-prompt-input class="modal-input" style="width:100%;margin-bottom:12px;padding:8px 10px;border:1px solid var(--border,#444);border-radius:4px;background:var(--bg-input,#1a1a1a);color:var(--text-primary,#eee);font-size:13px">
                        <div style="display:flex;gap:8px;justify-content:flex-end">
                            <button data-prompt-cancel class="btn-ghost">${_esc(cancel)}</button>
                            <button data-prompt-ok class="btn-primary">${_esc(confirm)}</button>
                        </div>
                    </div>`;
                document.body.appendChild(el);
            }

            const done = (value) => {
                resolve(value);
                if (_injected) {
                    modal.closeById(modalId);
                    setTimeout(() => el.remove(), 300);
                } else {
                    modal.closeById(modalId);
                }
            };

            modal.open(modalId, { message }).then(() => {
                const input  = el.querySelector('[data-prompt-input]');
                const ok     = el.querySelector('[data-prompt-ok]');
                const cancelBtn = el.querySelector('[data-prompt-cancel]');

                if (input) {
                    input.value = defaultValue;
                    if (placeholder) input.placeholder = placeholder;
                    input.focus();
                    input.select();
                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter')  { e.preventDefault(); done(input.value.trim() || null); }
                        if (e.key === 'Escape') { e.preventDefault(); done(null); }
                    }, { once: false });
                }

                ok?.addEventListener('click',     () => done(input ? input.value.trim() || null : null), { once: true });
                cancelBtn?.addEventListener('click', () => done(null), { once: true });

                const unsub = listen('modal:close', ({ id: closedId }) => {
                    if (closedId === modalId) { unsub(); resolve(null); }
                });
            });
        });
    },

    // Before-close guard

    /**
     * Register a guard function called before a modal closes.
     * If the guard returns false (or a Promise resolving to false), the close
     * is cancelled. Use for unsaved-form warnings.
     *
     *   modal.beforeClose('editModal', async () => {
     *       if (form.isDirty('#editForm')) {
     *           return await modal.confirm('Discard unsaved changes?');
     *       }
     *       return true;
     *   });
     *
     * Returns an unsubscribe function.
     */
    beforeClose(id, guardFn) {
        if (!_closeGuards.has(id)) _closeGuards.set(id, new Set());
        _closeGuards.get(id).add(guardFn);
        return () => _closeGuards.get(id)?.delete(guardFn);
    },

    // Accessibility utilities

    getFocusable(id) {
        const el = document.getElementById(id);
        return el ? _getAllFocusable(el) : [];
    },

    setFocus(id, selector) {
        const el = document.getElementById(id);
        if (!el) return;
        const target = selector ? el.querySelector(selector) : _getAllFocusable(el)[0];
        target?.focus();
    },
};

function _esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || _stack.length === 0) return;
    e.preventDefault();

    const topModal     = _stack[_stack.length - 1];
    const cancelButton = topModal.element.querySelector(
        '[data-confirm-cancel], [data-action="modal-close"], .close-modal'
    );

    if (cancelButton) cancelButton.click();
    else modal.close();
});

on('[data-action="modal-close"]', 'click', () => modal.close());
on('.close-modal',   'click', () => modal.close());
on('.drawer-close',  'click', () => modal.close());

document.addEventListener('DOMContentLoaded', () => {
    const backdrop = document.getElementById('drawerBackdrop')
        || document.getElementById('modalBackdrop');
    if (backdrop && !_backdrop) modal.setBackdrop(backdrop);
});

function _showBackdrop() {
    if (!_backdrop) {
        _backdrop = document.getElementById('drawerBackdrop')
            || document.getElementById('modalBackdrop');
        if (_backdrop) {
            _backdrop.setAttribute('aria-label', 'Close modal');
            _backdrop.addEventListener('click', () => modal.close());
        }
    }
    if (_backdrop) {
        _backdrop.classList.add('active');
        _setAriaHidden(_backdrop, false);
    }
}

function _hideBackdrop() {
    if (_backdrop) {
        _backdrop.classList.remove('active');
        _setAriaHidden(_backdrop, true);
    }
}

function _ensureHooks(id) {
    if (!_hooks.has(id)) _hooks.set(id, { open: new Set(), close: new Set() });
}

function _runHooks(id, type, data) {
    _hooks.get(id)?.[type]?.forEach(fn => {
        try { fn(data); } catch (e) {
            console.warn(`[oja/modal] ${type} hook error for #${id}:`, e);
        }
    });
}

function _fillModal(el, data) {
    el.querySelectorAll('[data-modal-field]').forEach(field => {
        const key = field.dataset.modalField;
        if (data[key] !== undefined) field.textContent = data[key];
    });

    if (data['aria-label']) el.setAttribute('aria-label', data['aria-label']);

    if (data['aria-description']) {
        // aria-description is not a valid ARIA attribute. The correct pattern
        // is aria-describedby pointing to a visually-hidden element that
        // contains the description text.
        const descId = `${el.id || 'oja-modal'}-desc`;
        let descEl   = el.querySelector(`#${descId}`);
        if (!descEl) {
            descEl = document.createElement('p');
            descEl.id = descId;
            descEl.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0';
            el.appendChild(descEl);
        }
        descEl.textContent = data['aria-description'];
        el.setAttribute('aria-describedby', descId);
    }

    // Only set role from a fixed allowlist. Accepting arbitrary role values
    // from caller-supplied data would allow attribute injection if data ever
    // originates from user input or an API response.
    const ALLOWED_ROLES = new Set(['dialog', 'alertdialog']);
    if (data['role'] && ALLOWED_ROLES.has(data['role'])) {
        el.setAttribute('role', data['role']);
    } else if (!el.getAttribute('role')) {
        el.setAttribute('role', 'dialog');
    }

    if (!el.hasAttribute('aria-modal')) el.setAttribute('aria-modal', 'true');
}
