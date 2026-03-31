/**
 * oja/ui/clickmenu.js
 * Context menu (right-click menu) — reusable UI primitive for Oja apps.
 *
 * ─── Usage ────────────────────────────────────────────────────────────────────
 *
 *   import { clickmenu } from './js/ui/clickmenu.js';
 *
 *   // Show at cursor position
 *   element.addEventListener('contextmenu', e => {
 *       e.preventDefault();
 *       clickmenu.show(e.clientX, e.clientY, [
 *           { label: '✏️  Rename',      action: () => rename(item) },
 *           { label: '📁  Move…',       action: () => move(item) },
 *           { separator: true },
 *           { label: '🗑  Delete',      action: () => del(item), danger: true },
 *       ]);
 *   });
 *
 *   // Show anchored to an element (e.g. a "⋮" button)
 *   btn.addEventListener('click', e => {
 *       e.stopPropagation();
 *       clickmenu.anchor(btn, items, { align: 'bottom-left' });
 *   });
 *
 *   // Auto-wire contextmenu on a selector (delegated)
 *   clickmenu.bind('#note-list [data-note]', e => {
 *       const id = e.target.closest('[data-note]').dataset.note;
 *       return [
 *           { label: 'Open',   action: () => open(id) },
 *           { label: 'Delete', action: () => del(id), danger: true },
 *       ];
 *   });
 *
 *   // Programmatic close
 *   clickmenu.close();
 *
 * ─── Item shape ───────────────────────────────────────────────────────────────
 *
 *   {
 *     label:     string            — item text
 *     action:    () => void        — called when clicked
 *     danger:    boolean           — red colouring
 *     disabled:  boolean           — greyed out, not clickable
 *     icon:      string            — prepended HTML (emoji or SVG string)
 *     shortcut:  string            — right-aligned hint e.g. '⌘D'
 *     separator: true              — renders a divider (ignores other props)
 *   }
 *
 * ─── Options (show / anchor) ──────────────────────────────────────────────────
 *
 *   {
 *     align:  'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'
 *             (only used by anchor() — show() always opens at cursor)
 *     onClose: () => void   — called when menu closes for any reason
 *   }
 */

const MENU_CLASS   = 'oja-ctx-menu';
const ITEM_CLASS   = 'oja-ctx-item';
const SEP_CLASS    = 'oja-ctx-sep';
const DANGER_CLASS = 'danger';
const DIS_CLASS    = 'disabled';


let _current    = null;   // active menu element
let _onClose    = null;   // close callback
let _cleanupFn  = null;   // removes document listeners

function _close() {
    if (!_current) return;
    _current.remove();
    _current = null;
    if (_onClose) { _onClose(); _onClose = null; }
    if (_cleanupFn) { _cleanupFn(); _cleanupFn = null; }
}

function _buildMenu(items) {
    const menu = document.createElement('div');
    menu.className = MENU_CLASS;
    menu.setAttribute('role', 'menu');

    for (const item of items) {
        if (item.separator === true || item.label === '—') {
            const sep = document.createElement('div');
            sep.className = SEP_CLASS;
            sep.setAttribute('role', 'separator');
            menu.appendChild(sep);
            continue;
        }

        const btn = document.createElement('button');
        btn.className = ITEM_CLASS;
        btn.setAttribute('role', 'menuitem');
        btn.type = 'button';

        if (item.danger)    btn.classList.add(DANGER_CLASS);
        if (item.disabled)  btn.classList.add(DIS_CLASS);

        // Inner layout: [icon] label [shortcut]
        const inner = document.createElement('span');
        inner.className = 'oja-ctx-inner';

        if (item.icon) {
            const ic = document.createElement('span');
            ic.className = 'oja-ctx-icon';
            ic.innerHTML = item.icon;
            inner.appendChild(ic);
        }

        const lbl = document.createElement('span');
        lbl.className = 'oja-ctx-label';
        lbl.textContent = item.label;
        inner.appendChild(lbl);

        if (item.shortcut) {
            const sc = document.createElement('span');
            sc.className = 'oja-ctx-shortcut';
            sc.textContent = item.shortcut;
            inner.appendChild(sc);
        }

        btn.appendChild(inner);

        if (!item.disabled) {
            btn.addEventListener('click', () => {
                _close();
                item.action?.();
            });
        }

        menu.appendChild(btn);
    }

    return menu;
}

function _position(menu, x, y) {
    // Start at cursor
    menu.style.left = `${x}px`;
    menu.style.top  = `${y}px`;

    // Clamp to viewport after paint
    requestAnimationFrame(() => {
        const r = menu.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        if (r.right  > vw - 8) menu.style.left = `${x - r.width}px`;
        if (r.bottom > vh - 8) menu.style.top  = `${y - r.height}px`;
        // If still off top/left, hard-clamp
        const r2 = menu.getBoundingClientRect();
        if (r2.left < 8)   menu.style.left = '8px';
        if (r2.top  < 8)   menu.style.top  = '8px';
    });
}

function _positionAnchored(menu, el, align = 'bottom-left') {
    const rect = el.getBoundingClientRect();
    let x, y;

    if (align.startsWith('bottom')) {
        y = rect.bottom + 4;
    } else {
        y = rect.top - 4; // will be adjusted after measuring
    }

    if (align.endsWith('left')) {
        x = rect.left;
    } else {
        x = rect.right;  // will be adjusted after measuring
    }

    menu.style.left = `${x}px`;
    menu.style.top  = `${y}px`;

    requestAnimationFrame(() => {
        const r  = menu.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;

        if (align.endsWith('right'))  menu.style.left = `${rect.right - r.width}px`;
        if (align.startsWith('top'))  menu.style.top  = `${rect.top - r.height - 4}px`;

        // Final viewport clamp
        const r2 = menu.getBoundingClientRect();
        if (r2.right  > vw - 8) menu.style.left = `${vw - r.width - 8}px`;
        if (r2.bottom > vh - 8) menu.style.top  = `${vh - r.height - 8}px`;
        if (r2.left   < 8)      menu.style.left = '8px';
        if (r2.top    < 8)      menu.style.top  = '8px';
    });
}

function _mount(menu, opts = {}) {
    _close(); // close any existing menu

    _onClose = opts.onClose || null;
    menu.style.position = 'fixed';
    menu.style.zIndex   = '9999';
    document.body.appendChild(menu);
    _current = menu;

    // Focus first item for keyboard nav
    requestAnimationFrame(() => {
        menu.querySelector(`.${ITEM_CLASS}:not(.${DIS_CLASS})`)?.focus();
    });

    // Keyboard navigation
    const onKey = (e) => {
        if (!_current) return;
        const items = [..._current.querySelectorAll(`.${ITEM_CLASS}:not(.${DIS_CLASS})`)];
        const focused = document.activeElement;
        const idx = items.indexOf(focused);

        if (e.key === 'Escape') { _close(); return; }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            items[(idx + 1) % items.length]?.focus();
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            items[(idx - 1 + items.length) % items.length]?.focus();
        }
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            focused?.click();
        }
        if (e.key === 'Tab') { _close(); }
    };

    // Close on outside click (next event loop tick to avoid closing on the triggering click)
    const onOutside = (e) => {
        if (_current && !_current.contains(e.target)) _close();
    };

    setTimeout(() => {
        document.addEventListener('click',      onOutside, { capture: true });
        document.addEventListener('contextmenu',onOutside, { capture: true });
        document.addEventListener('keydown',    onKey);
        window.addEventListener('blur',         _close);
        window.addEventListener('scroll',       _close, { passive: true, capture: true });
        window.addEventListener('resize',       _close);
    }, 0);

    _cleanupFn = () => {
        document.removeEventListener('click',      onOutside, { capture: true });
        document.removeEventListener('contextmenu',onOutside, { capture: true });
        document.removeEventListener('keydown',    onKey);
        window.removeEventListener('blur',         _close);
        window.removeEventListener('scroll',       _close, { capture: true });
        window.removeEventListener('resize',       _close);
    };
}


function _injectStyles() {
    if (document.getElementById('oja-ctx-styles')) return;
    const style = document.createElement('style');
    style.id = 'oja-ctx-styles';
    style.textContent = `
.oja-ctx-menu {
    background: var(--bg-panel, #1c2128);
    border: 1px solid var(--border, #30363d);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.3);
    padding: 4px 0;
    min-width: 172px;
    max-width: 280px;
    outline: none;
    animation: oja-ctx-in .1s ease;
}
@keyframes oja-ctx-in {
    from { opacity: 0; transform: scale(.97) translateY(-4px); }
    to   { opacity: 1; transform: scale(1)   translateY(0); }
}
.oja-ctx-item {
    display: block;
    width: 100%;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
    outline: none;
    text-align: left;
    color: var(--text-secondary, #8b949e);
    font-size: 12.5px;
    font-family: var(--sans, system-ui, sans-serif);
    transition: background .1s, color .1s;
    border-radius: 0;
}
.oja-ctx-item:hover,
.oja-ctx-item:focus {
    background: var(--bg-hover, #21262d);
    color: var(--text-primary, #e6edf3);
}
.oja-ctx-item.danger { color: var(--danger, #f85149); }
.oja-ctx-item.danger:hover,
.oja-ctx-item.danger:focus {
    background: var(--danger-subtle, rgba(248,81,73,.1));
    color: var(--danger, #f85149);
}
.oja-ctx-item.disabled {
    opacity: .4;
    cursor: default;
    pointer-events: none;
}
.oja-ctx-inner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 14px;
    width: 100%;
}
.oja-ctx-icon {
    flex-shrink: 0;
    width: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    opacity: .8;
}
.oja-ctx-label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.oja-ctx-shortcut {
    flex-shrink: 0;
    font-size: 10.5px;
    color: var(--text-muted, #484f58);
    font-family: var(--mono, monospace);
    margin-left: auto;
    padding-left: 12px;
}
.oja-ctx-sep {
    height: 1px;
    background: var(--border, #21262d);
    margin: 3px 0;
}
`;
    document.head.appendChild(style);
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _injectStyles, { once: true });
    } else {
        _injectStyles();
    }
}


export const clickmenu = {

    /**
     * Show a context menu at a specific (x, y) viewport coordinate.
     * Typically called from a contextmenu event.
     *
     * @param {number}   x        — clientX
     * @param {number}   y        — clientY
     * @param {Array}    items    — array of item descriptors
     * @param {Object}   [opts]   — { onClose }
     */
    show(x, y, items, opts = {}) {
        const menu = _buildMenu(items);
        _mount(menu, opts);
        _position(menu, x, y);
        return this;
    },

    /**
     * Show a context menu anchored to a DOM element.
     * Useful for "⋮" / kebab buttons.
     *
     * @param {Element}  el       — anchor element
     * @param {Array}    items    — array of item descriptors
     * @param {Object}   [opts]   — { align: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right', onClose }
     */
    anchor(el, items, opts = {}) {
        const menu  = _buildMenu(items);
        const align = opts.align || 'bottom-left';
        _mount(menu, opts);
        _positionAnchored(menu, el, align);
        return this;
    },

    /**
     * Bind a contextmenu event to a delegated selector.
     * The factory function receives the triggering event and should return
     * an array of menu items. Returning null/undefined/[] suppresses the menu.
     *
     * @param {string}   selector — CSS selector to delegate from document
     * @param {Function} factory  — (event) => items[]
     * @param {Object}   [opts]   — { onClose }
     * @returns {Function}        — call to remove the binding
     */
    bind(selector, factory, opts = {}) {
        const handler = (e) => {
            if (!e.target || typeof e.target.closest !== 'function') return;
            const target = e.target.closest(selector);
            if (!target) return;
            e.preventDefault();
            const items = factory(e, target);
            if (!items?.length) return;
            this.show(e.clientX, e.clientY, items, opts);
        };
        document.addEventListener('contextmenu', handler);
        return () => document.removeEventListener('contextmenu', handler);
    },

    /** Programmatically close the active menu. */
    close() {
        _close();
        return this;
    },

    /** True if a menu is currently visible. */
    get isOpen() {
        return _current !== null;
    },
};