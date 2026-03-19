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
 *   modal.pop();   // closes confirmModal, backendDrawer still open
 *   modal.pop();   // closes backendDrawer, routeDrawer still open
 *   modal.pop();   // closes routeDrawer
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
 * ─── HTML convention ──────────────────────────────────────────────────────────
 *
 *   <!-- Oja looks for [data-modal-body] inside the modal to render Responders -->
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

import { emit, listen, on } from './events.js';
import { Out } from './out.js';

// ─── Focus trap management ────────────────────────────────────────────────────

const FOCUSABLE_SELECTORS = [
    'button:not([disabled])',
    '[href]:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"]):not([disabled])',
    'details:not([disabled])',
    '[contenteditable="true"]'
].join(',');

let _previousFocus = null;
let _focusTrapActive = false;
let _focusTrapElement = null;

function _setupFocusTrap(modalElement) {
    if (_focusTrapActive) return;

    _previousFocus = document.activeElement;
    _focusTrapElement = modalElement;
    _focusTrapActive = true;

    modalElement.addEventListener('keydown', _handleTrapKeydown);

    _focusFirstElement(modalElement);
}

function _releaseFocusTrap() {
    if (!_focusTrapActive) return;

    // Remove the invisible fallback button injected when no focusable elements
    // were present — it must not persist in the DOM after close.
    _focusTrapElement?.querySelectorAll('[data-oja-focus-fallback]').forEach(el => el.remove());

    _focusTrapElement?.removeEventListener('keydown', _handleTrapKeydown);
    _focusTrapActive = false;

    // Restore focus to the previously focused element, but only if it is still
    // in the document, visible, and not disabled — all three conditions must
    // hold or focusing it would be a no-op or throw in strict browsers.
    if (
        _previousFocus &&
        document.contains(_previousFocus) &&
        !_previousFocus.disabled &&
        !_previousFocus.hasAttribute('disabled') &&
        _previousFocus.offsetParent !== null
    ) {
        _previousFocus.focus();
    }
    _previousFocus = null;
    _focusTrapElement = null;
}

function _handleTrapKeydown(e) {
    if (e.key !== 'Tab' || !_focusTrapActive || !_focusTrapElement) return;

    const focusable = Array.from(
        _focusTrapElement.querySelectorAll(FOCUSABLE_SELECTORS)
    ).filter(el => el.offsetParent !== null); // Only visible elements

    if (focusable.length === 0) {
        e.preventDefault();
        return;
    }

    const firstFocusable = focusable[0];
    const lastFocusable = focusable[focusable.length - 1];

    if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
            e.preventDefault();
            lastFocusable.focus();
        }
    } else {
        if (document.activeElement === lastFocusable) {
            e.preventDefault();
            firstFocusable.focus();
        }
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

// ─── Stack ────────────────────────────────────────────────────────────────────

const _stack = [];
const _hooks = new Map();
let _backdrop = null;

// ─── Accessibility helpers ────────────────────────────────────────────────────

function _setAriaHidden(element, hidden) {
    if (!element) return;
    element.setAttribute('aria-hidden', hidden ? 'true' : 'false');

    if (element.classList.contains('drawer') || element.classList.contains('modal-overlay')) {
        if (hidden) {
            element.setAttribute('inert', '');
        } else {
            element.removeAttribute('inert');
        }
    }
}

function _announce(message, assertive = false) {
    const announcer = document.getElementById('oja-announcer') || (() => {
        const el = document.createElement('div');
        el.id = 'oja-announcer';
        el.setAttribute('aria-live', 'polite');
        el.setAttribute('aria-atomic', 'true');
        el.style.position = 'absolute';
        el.style.width = '1px';
        el.style.height = '1px';
        el.style.padding = '0';
        el.style.margin = '-1px';
        el.style.overflow = 'hidden';
        el.style.clip = 'rect(0, 0, 0, 0)';
        el.style.whiteSpace = 'nowrap';
        el.style.border = '0';
        document.body.appendChild(el);
        return el;
    })();

    if (assertive) {
        announcer.setAttribute('aria-live', 'assertive');
    } else {
        announcer.setAttribute('aria-live', 'polite');
    }

    announcer.textContent = message;
}

// ─── Public API ───────────────────────────────────────────────────────────────

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
            return;
        }

        _setAriaHidden(el, false);
        _stack.push({ id, data, element: el });
        el.classList.add('active');

        const focusable = _getAllFocusable(el);
        const description = data['aria-description'] || data.description || el.getAttribute('aria-description') || '';

        if (focusable.length === 0) {
            console.warn(`[oja/modal] #${id} has no focusable elements - adding fallback`);
            const fallback = document.createElement('button');
            fallback.setAttribute('aria-label', 'Close modal');
            // Mark with a data attribute so _releaseFocusTrap can find and
            // remove it on close — without this the button leaks into the DOM
            // permanently, accumulating with every open/close cycle.
            fallback.dataset.ojaFocusFallback = 'true';
            fallback.style.position = 'absolute';
            fallback.style.width = '1px';
            fallback.style.height = '1px';
            fallback.style.padding = '0';
            fallback.style.margin = '-1px';
            fallback.style.overflow = 'hidden';
            fallback.style.clip = 'rect(0, 0, 0, 0)';
            fallback.style.border = '0';
            fallback.addEventListener('click', () => modal.close());
            el.appendChild(fallback);
        }

        _setupFocusTrap(el);

        if (_stack.length === 1) {
            _showBackdrop();
            document.body.style.overflow = 'hidden';
            document.body.setAttribute('aria-hidden', 'true');
        }

        if (data.body && Out.is(data.body)) {
            const bodyEl = el.querySelector('[data-modal-body]');
            if (bodyEl) {
                data.body.render(bodyEl, data);
            }
        }

        if (Object.keys(data).length > 0) {
            _fillModal(el, data);
        }

        _runHooks(id, 'open', data);
        emit('modal:open', { id, data });

        _announce(`Opened ${el.getAttribute('aria-label') || id}${description ? ': ' + description : ''}`);

        return this;
    },

    /** Alias for open() — more semantic for drawer stacks */
    push(id, data = {}) {
        return this.open(id, data);
    },

    /**
     * Close the top-most modal/drawer on the stack.
     * Alias: modal.pop()
     */
    close() {
        if (_stack.length === 0) return;

        const { id, element } = _stack.pop();

        element.classList.remove('active');
        _setAriaHidden(element, true);

        if (_stack.length === 0) {
            _releaseFocusTrap();
            _hideBackdrop();
            document.body.style.overflow = '';
            document.body.removeAttribute('aria-hidden');
        } else {
            const topElement = _stack[_stack.length - 1].element;
            _setupFocusTrap(topElement);
        }

        _runHooks(id, 'close');
        emit('modal:close', { id });

        _announce(`Closed ${element.getAttribute('aria-label') || id}`);

        return this;
    },

    /** Alias for close() */
    pop() {
        return this.close();
    },

    /**
     * Close a specific modal by ID, regardless of stack position.
     * Closes everything above it in the stack first.
     */
    closeById(id) {
        const idx = _stack.findIndex(entry => entry.id === id);
        if (idx === -1) return;

        while (_stack.length > idx) {
            this.close();
        }
        return this;
    },

    /**
     * Close everything.
     */
    closeAll() {
        while (_stack.length > 0) this.close();
        return this;
    },

    // ─── State ────────────────────────────────────────────────────────────────

    /** ID of the top-most open modal, or null */
    current() {
        return _stack.length > 0 ? _stack[_stack.length - 1].id : null;
    },

    /** Full stack as array of { id, data } */
    stack() {
        return _stack.map(({ id, data }) => ({ id, data }));
    },

    /** Is a specific modal currently open? */
    isOpen(id) {
        return _stack.some(entry => entry.id === id);
    },

    /** How deep is the stack? */
    depth() {
        return _stack.length;
    },

    // ─── Lifecycle hooks ──────────────────────────────────────────────────────

    /**
     * Register a handler called when a modal opens.
     * Handler receives the data passed to open().
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

    // ─── Backdrop ─────────────────────────────────────────────────────────────

    /**
     * Register an element as the backdrop.
     * Clicking it closes the top-most modal.
     * Oja auto-detects #drawerBackdrop if this is not called.
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

    // ─── Confirm helper ───────────────────────────────────────────────────────

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
        return new Promise(resolve => {
            const id = options.modalId || 'confirmModal';

            const ariaDescription = options['aria-description'] ||
                'This dialog requires confirmation. Use Tab to navigate between buttons.';

            modal.open(id, {
                message,
                ...options,
                'aria-description': ariaDescription
            });

            const el = document.getElementById(id);
            if (!el) { resolve(false); return; }

            const msgEl = el.querySelector('[data-modal-field="message"]');
            if (msgEl) {
                msgEl.textContent = message;
                msgEl.id = 'confirm-message';
                el.setAttribute('aria-describedby', 'confirm-message');
            }

            const ok     = el.querySelector('[data-confirm-ok]');
            const cancel = el.querySelector('[data-confirm-cancel]');

            if (ok) {
                ok.setAttribute('aria-label', options.okLabel || 'Confirm');
            }
            if (cancel) {
                cancel.setAttribute('aria-label', options.cancelLabel || 'Cancel');
            }

            const cleanup = () => modal.closeById(id);

            const onOk = () => { cleanup(); resolve(true); };
            const onCancel = () => { cleanup(); resolve(false); };

            ok?.addEventListener('click', onOk, { once: true });
            cancel?.addEventListener('click', onCancel, { once: true });

            const unsub = listen('modal:close', ({ id: closedId }) => {
                if (closedId === id) { unsub(); resolve(false); }
            });
        });
    },

    // ─── Accessibility utilities ──────────────────────────────────────────────

    /**
     * Get all focusable elements within a modal.
     * Useful for custom focus management.
     */
    getFocusable(id) {
        const el = document.getElementById(id);
        if (!el) return [];
        return _getAllFocusable(el);
    },

    /**
     * Manually set focus to a specific element within a modal.
     */
    setFocus(id, selector) {
        const el = document.getElementById(id);
        if (!el) return;
        const target = selector ? el.querySelector(selector) : _getAllFocusable(el)[0];
        target?.focus();
    }
};

// Semantic alias
modal.push = modal.open;
modal.pop  = modal.close;

// ─── Keyboard and event wiring ────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _stack.length > 0) {
        e.preventDefault();

        const topModal = _stack[_stack.length - 1];
        const cancelButton = topModal.element.querySelector('[data-confirm-cancel], [data-action="modal-close"], .close-modal');

        if (cancelButton) {
            cancelButton.click();
        } else {
            modal.close();
        }
    }
});

on('[data-action="modal-close"]', 'click', () => modal.close());
on('.close-modal', 'click', () => modal.close());
on('.drawer-close', 'click', () => modal.close());

document.addEventListener('DOMContentLoaded', () => {
    const backdrop = document.getElementById('drawerBackdrop')
        || document.getElementById('modalBackdrop');
    if (backdrop && !_backdrop) {
        modal.setBackdrop(backdrop);
    }

    const announcer = document.getElementById('oja-announcer');
    if (!announcer) {
        const el = document.createElement('div');
        el.id = 'oja-announcer';
        el.setAttribute('aria-live', 'polite');
        el.setAttribute('aria-atomic', 'true');
        el.style.position = 'absolute';
        el.style.width = '1px';
        el.style.height = '1px';
        el.style.padding = '0';
        el.style.margin = '-1px';
        el.style.overflow = 'hidden';
        el.style.clip = 'rect(0, 0, 0, 0)';
        el.style.whiteSpace = 'nowrap';
        el.style.border = '0';
        document.body.appendChild(el);
    }
});

// ─── Internals ────────────────────────────────────────────────────────────────

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
    if (!_hooks.has(id)) {
        _hooks.set(id, { open: new Set(), close: new Set() });
    }
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
        if (data[key] !== undefined) {
            field.textContent = data[key];
        }
    });

    if (data['aria-label']) {
        el.setAttribute('aria-label', data['aria-label']);
    }
    if (data['aria-description']) {
        // aria-description is not a valid ARIA attribute. The correct pattern
        // is aria-describedby pointing to an element that contains the text.
        // We create a visually-hidden description element and reference it.
        const descId  = `${el.id || 'oja-modal'}-desc`;
        let descEl = el.querySelector(`#${descId}`);
        if (!descEl) {
            descEl = document.createElement('p');
            descEl.id = descId;
            // Visually hidden but readable by screen readers
            descEl.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0';
            el.appendChild(descEl);
        }
        descEl.textContent = data['aria-description'];
        el.setAttribute('aria-describedby', descId);
    }
    if (data['role']) {
        el.setAttribute('role', data['role']);
    } else if (!el.getAttribute('role')) {
        el.setAttribute('role', el.classList.contains('drawer') ? 'dialog' : 'dialog');
    }

    if (!el.hasAttribute('aria-modal')) {
        el.setAttribute('aria-modal', 'true');
    }
}