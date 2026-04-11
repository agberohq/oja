/**
 * oja/panel.js
 * Floating panel windows — draggable, resizable, non-blocking.
 *
 * Unlike modal.js (which blocks all interaction behind it), panels sit on
 * top of the page while the rest of the UI remains fully interactive.
 * Multiple panels can be open simultaneously. They survive navigation.
 *
 * Typical uses: AI chat sidekick, perf metrics overlay, diff viewer,
 * log tail, floating media player, detached config inspector.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { panel } from '../ui/panel.js';
 *
 *   const p = panel.open({
 *       id:       'ai-chat',
 *       title:    'AI Assistant',
 *       content:  Out.component('components/ai-chat.html'),
 *       width:    360,
 *       height:   480,
 *       position: 'bottom-right',
 *   });
 *
 *   p.minimize();     // collapse to title bar only
 *   p.restore();      // expand back
 *   p.close();
 *
 * ─── Plain HTML content ───────────────────────────────────────────────────────
 *
 *   panel.open({
 *       id:      'log-tail',
 *       title:   'Live Logs',
 *       html:    '<pre id="log-output"></pre>',
 *       width:   500,
 *       height:  300,
 *       position: { x: 40, y: 80 },   // exact pixel position
 *   });
 *
 * ─── Options ──────────────────────────────────────────────────────────────────
 *
 *   id          : string            — unique identifier (required)
 *   title       : string            — title bar text
 *   content     : Out               — Oja Out instance rendered into body
 *   html        : string            — plain HTML string (alternative to content)
 *   width       : number            — initial width in px (default: 360)
 *   height      : number            — initial height in px (default: 420)
 *   minWidth    : number            — resize minimum (default: 200)
 *   minHeight   : number            — resize minimum (default: 120)
 *   position    : 'center' | 'top-right' | 'top-left' |
 *                 'bottom-right' | 'bottom-left' |
 *                 { x, y }          — exact viewport coords (default: 'center')
 *   resizable   : boolean           — drag-to-resize (default: true)
 *   closable    : boolean           — show × button (default: true)
 *   minimizable : boolean           — show − button (default: true)
 *   class       : string            — extra CSS class on the panel element
 *   onClose     : () => void
 *   onMinimize  : (minimized) => void
 *   onFocus     : () => void
 *
 * ─── Static methods ───────────────────────────────────────────────────────────
 *
 *   panel.open(options)       → panelHandle
 *   panel.get(id)             → panelHandle | null
 *   panel.close(id)
 *   panel.closeAll()
 *   panel.bringToFront(id)
 *   panel.isOpen(id)          → boolean
 *
 * ─── Panel handle methods ─────────────────────────────────────────────────────
 *
 *   p.minimize()
 *   p.restore()
 *   p.close()
 *   p.setTitle(str)
 *   p.setContent(Out | html)  — swap body content
 *   p.focus()                 — bring to front
 *   p.el                      — the root DOM element
 *   p.body                    — the body DOM element (content area)
 */

import { Out } from '../core/out.js';

const _panels    = new Map();  // id → panelHandle
let   _zBase     = 1000;       // starting z-index for panels
let   _zTop      = _zBase;     // current highest z-index in use

// Helpers

function _nextZ() { return ++_zTop; }

function _clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

function _initialPosition(position, width, height) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 24;

    if (position && typeof position === 'object') {
        return { x: position.x, y: position.y };
    }

    switch (position) {
        case 'top-left':     return { x: pad,              y: pad };
        case 'top-right':    return { x: vw - width - pad, y: pad };
        case 'bottom-left':  return { x: pad,              y: vh - height - pad };
        case 'bottom-right': return { x: vw - width - pad, y: vh - height - pad };
        case 'center':
        default:
            return {
                x: Math.round((vw - width)  / 2),
                y: Math.round((vh - height) / 2),
            };
    }
}

// Drag

function _makeDraggable(el, handle) {
    let _ox = 0, _oy = 0, _ex = 0, _ey = 0;

    handle.style.cursor = 'grab';

    const onDown = (e) => {
        if (e.target.closest('button')) return; // don't drag when clicking buttons
        e.preventDefault();
        _ex = parseInt(el.style.left, 10) || 0;
        _ey = parseInt(el.style.top,  10) || 0;
        _ox = e.clientX;
        _oy = e.clientY;
        handle.style.cursor = 'grabbing';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
    };

    const onMove = (e) => {
        const dx  = e.clientX - _ox;
        const dy  = e.clientY - _oy;
        const vw  = window.innerWidth;
        const vh  = window.innerHeight;
        const w   = el.offsetWidth;
        const h   = el.offsetHeight;
        el.style.left = _clamp(_ex + dx, 0, vw - w)  + 'px';
        el.style.top  = _clamp(_ey + dy, 0, vh - h)  + 'px';
    };

    const onUp = () => {
        handle.style.cursor = 'grab';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
    };

    handle.addEventListener('mousedown', onDown);
}

// Resize

function _makeResizable(el, minWidth, minHeight) {
    const handle = document.createElement('div');
    handle.className = 'oja-panel-resize';
    handle.title     = 'Drag to resize';
    el.appendChild(handle);

    let _ox = 0, _oy = 0, _ow = 0, _oh = 0;

    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        _ox = e.clientX;
        _oy = e.clientY;
        _ow = el.offsetWidth;
        _oh = el.offsetHeight;

        const onMove = (e) => {
            const w = Math.max(_ow + (e.clientX - _ox), minWidth);
            const h = Math.max(_oh + (e.clientY - _oy), minHeight);
            el.style.width  = w + 'px';
            el.style.height = h + 'px';
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup',   onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
    });
}

// Build panel DOM

function _buildPanel(opts) {
    const {
        id,
        title       = '',
        width       = 360,
        height      = 420,
        minWidth    = 200,
        minHeight   = 120,
        position    = 'center',
        resizable   = true,
        closable    = true,
        minimizable = true,
        class:      extraClass = '',
        onClose     = null,
        onMinimize  = null,
        onFocus     = null,
    } = opts;

    const { x, y } = _initialPosition(position, width, height);

    // Root
    const el = document.createElement('div');
    el.className = ['oja-panel', extraClass].filter(Boolean).join(' ');
    el.setAttribute('data-panel-id', id);
    el.style.cssText = [
        `left:${x}px`, `top:${y}px`,
        `width:${width}px`, `height:${height}px`,
        `z-index:${_nextZ()}`,
        'position:fixed',
        'display:flex',
        'flex-direction:column',
    ].join(';');

    // Title bar
    const titleBar = document.createElement('div');
    titleBar.className = 'oja-panel-title';

    const titleText = document.createElement('span');
    titleText.className = 'oja-panel-title-text';
    titleText.textContent = title;
    titleBar.appendChild(titleText);

    const actions = document.createElement('div');
    actions.className = 'oja-panel-actions';

    let minimized = false;
    let savedHeight = height + 'px';

    if (minimizable) {
        const minBtn = document.createElement('button');
        minBtn.className = 'oja-panel-btn';
        minBtn.type      = 'button';
        minBtn.title     = 'Minimize';
        minBtn.innerHTML = '&#8722;'; // minus sign
        minBtn.addEventListener('click', () => {
            minimized = !minimized;
            if (minimized) {
                savedHeight = el.style.height;
                body.style.display = 'none';
                el.style.height    = 'auto';
                if (resizable && el.querySelector('.oja-panel-resize')) {
                    el.querySelector('.oja-panel-resize').style.display = 'none';
                }
            } else {
                body.style.display = '';
                el.style.height    = savedHeight;
                if (resizable && el.querySelector('.oja-panel-resize')) {
                    el.querySelector('.oja-panel-resize').style.display = '';
                }
            }
            minBtn.innerHTML = minimized ? '&#9723;' : '&#8722;';
            onMinimize?.(minimized);
        });
        actions.appendChild(minBtn);
    }

    if (closable) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'oja-panel-btn oja-panel-btn-close';
        closeBtn.type      = 'button';
        closeBtn.title     = 'Close';
        closeBtn.innerHTML = '&times;';
        closeBtn.addEventListener('click', () => {
            panel.close(id);
        });
        actions.appendChild(closeBtn);
    }

    titleBar.appendChild(actions);
    el.appendChild(titleBar);

    // Body
    const body = document.createElement('div');
    body.className = 'oja-panel-body';
    el.appendChild(body);

    // Bring to front on click
    el.addEventListener('mousedown', () => {
        el.style.zIndex = _nextZ();
        onFocus?.();
    }, true);

    // Draggable via title bar
    _makeDraggable(el, titleBar);

    // Resizable via bottom-right handle
    if (resizable) _makeResizable(el, minWidth, minHeight);

    // Inject styles once

    document.body.appendChild(el);

    const handle = {
        el,
        body,
        id,

        minimize() {
            if (!minimized) el.querySelector('.oja-panel-btn')?.click();
        },

        restore() {
            if (minimized) el.querySelector('.oja-panel-btn')?.click();
        },

        close() {
            panel.close(id);
        },

        focus() {
            el.style.zIndex = _nextZ();
            onFocus?.();
        },

        setTitle(str) {
            titleText.textContent = str;
        },

        async setContent(contentOrHtml) {
            body.innerHTML = '';
            if (typeof contentOrHtml === 'string') {
                body.innerHTML = contentOrHtml;
            } else if (contentOrHtml && typeof contentOrHtml.render === 'function') {
                await contentOrHtml.render(body);
            }
        },
    };

    return { handle, body, onClose };
}

// Style injection

// Public API

export const panel = {
    /**
     * Open a floating panel. If a panel with this id is already open,
     * brings it to front and returns the existing handle.
     *
     * @param {Object} options
     * @returns {panelHandle}
     */
    open(options) {
        const { id, content, html, onClose } = options;

        if (!id) throw new Error('[oja/panel] options.id is required');

        // Reuse existing panel
        if (_panels.has(id)) {
            const existing = _panels.get(id);
            existing.focus();
            return existing;
        }

        const { handle, body, onClose: closeCb } = _buildPanel(options);
        _panels.set(id, handle);

        // Render content
        (async () => {
            if (html) {
                body.innerHTML = html;
            } else if (content && typeof content.render === 'function') {
                await content.render(body);
            }
        })();

        handle._onClose = closeCb;
        return handle;
    },

    /**
     * Get an open panel handle by id.
     * @param {string} id
     * @returns {panelHandle|null}
     */
    get(id) { return _panels.get(id) || null; },

    /** @param {string} id @returns {boolean} */
    isOpen(id) { return _panels.has(id); },

    /**
     * Close a panel by id.
     * @param {string} id
     */
    close(id) {
        const handle = _panels.get(id);
        if (!handle) return;
        handle.el.remove();
        _panels.delete(id);
        handle._onClose?.();
    },

    /** Close all open panels. */
    closeAll() {
        for (const id of [..._panels.keys()]) this.close(id);
    },

    /**
     * Bring a panel to front (highest z-index).
     * @param {string} id
     */
    bringToFront(id) {
        const handle = _panels.get(id);
        if (handle) handle.el.style.zIndex = _nextZ();
    },

    /** @returns {string[]} ids of all currently open panels */
    openIds() { return Array.from(_panels.keys()); },
};
