/**
 * oja/popover.js
 * Floating UI engine — tooltips, dropdowns, and context menus.
 * Pure math positioning with automatic boundary collision detection.
 *
 * ─── Tooltips (Declarative) ───────────────────────────────────────────────────
 *
 *   // Auto-wires any element with data-tooltip
 *   <button data-tooltip="Save changes" data-position="top">Save</button>
 *
 * ─── Programmatic Popovers ────────────────────────────────────────────────────
 *
 *   import { popover } from '../oja/popover.js';
 *
 *   on('#menu-btn', 'click', (e, el) => {
 *       popover.show(el, Out.c('components/menu.html'), {
 *           position: 'bottom-start',
 *           clickOutsideToClose: true,
 *       });
 *   });
 *
 *   // Close manually
 *   popover.hide();
 */

import { Out } from '../core/out.js';
import { listen } from '../core/events.js';

let _activePopover = null;
let _activeTooltip = null;
let _unsubClickOutside = null;
let _unsubScroll = null;

const MARGIN = 8; // Distance from trigger element

export const popover = {
    /**
     * Show a rich popover relative to a trigger element.
     * Only one popover can be active at a time.
     */
    async show(trigger, content, options = {}) {
        const triggerEl = typeof trigger === 'string' ? document.querySelector(trigger) : trigger;
        if (!triggerEl) return;

        this.hide();

        const {
            position = 'bottom', // top, bottom, left, right (can append -start or -end)
            clickOutsideToClose = true,
            className = '',
        } = options;

        const popEl = document.createElement('div');
        popEl.className = `oja-popover ${className}`;
        popEl.style.position = 'fixed';
        popEl.style.zIndex = '9999';
        popEl.style.opacity = '0'; // hide while calculating position
        document.body.appendChild(popEl);

        if (Out.is(content)) {
            await content.render(popEl);
        } else if (typeof content === 'string') {
            popEl.innerHTML = content;
        } else if (content instanceof Element) {
            popEl.appendChild(content);
        }

        this._updatePosition(triggerEl, popEl, position);
        popEl.style.opacity = '1';
        popEl.classList.add('oja-entering');

        _activePopover = { popEl, triggerEl, position };

        // Keyboard: Escape closes the popover
        const escHandler = (e) => { if (e.key === 'Escape') this.hide(); };
        document.addEventListener('keydown', escHandler, { once: true });

        // Handle outside clicks
        if (clickOutsideToClose) {
            setTimeout(() => { // delay so the trigger click doesn't instantly close it
                _unsubClickOutside = listen('click', (e) => {
                    if (!popEl.contains(e.target) && !triggerEl.contains(e.target)) {
                        this.hide();
                    }
                });
            }, 10);
        }

        // Keep it attached to the trigger while scrolling
        _unsubScroll = listen('scroll', () => {
            if (_activePopover) {
                this._updatePosition(_activePopover.triggerEl, _activePopover.popEl, _activePopover.position);
            }
        }, { capture: true, passive: true });

        return popEl;
    },

    hide() {
        if (_activePopover) {
            const el = _activePopover.popEl;
            el.classList.add('oja-leaving');
            setTimeout(() => el.remove(), 150);
            _activePopover = null;
        }
        if (_unsubClickOutside) { _unsubClickOutside(); _unsubClickOutside = null; }
        if (_unsubScroll) { _unsubScroll(); _unsubScroll = null; }
    },

    /**
     * Auto-wire data-tooltip elements.
     * Call once in app.js
     */
    wireTooltips() {
        if (typeof document === 'undefined') return;

        document.addEventListener('mouseover', (e) => {
            if (!e.target || typeof e.target.closest !== 'function') return;
            const trigger = e.target.closest('[data-tooltip]');
            if (!trigger) return;

            if (_activeTooltip) _activeTooltip.remove();

            const text = trigger.getAttribute('data-tooltip');
            const pos = trigger.getAttribute('data-position') || 'top';

            const tip = document.createElement('div');
            tip.className = 'oja-tooltip oja-entering';
            tip.style.position = 'fixed';
            tip.style.zIndex = '10000';
            tip.style.pointerEvents = 'none';
            tip.textContent = text;
            document.body.appendChild(tip);

            this._updatePosition(trigger, tip, pos);
            _activeTooltip = tip;
        });

        document.addEventListener('mouseleave', (e) => {
            if (!e.target || typeof e.target.closest !== 'function') return;
            const trigger = e.target.closest('[data-tooltip]');
            if (trigger && _activeTooltip) {
                _activeTooltip.remove();
                _activeTooltip = null;
            }
        }, true); // capture phase so closest() works correctly
    },

    // Math

    _updatePosition(trigger, floater, requestedPos) {
        const tRect = trigger.getBoundingClientRect();
        const fRect = floater.getBoundingClientRect();
        const viewW = document.documentElement.clientWidth;
        const viewH = document.documentElement.clientHeight;

        let [side, align] = requestedPos.split('-');

        // Boundary collision detection (Flip logic)
        if (side === 'top' && tRect.top - fRect.height - MARGIN < 0) side = 'bottom';
        if (side === 'bottom' && tRect.bottom + fRect.height + MARGIN > viewH) side = 'top';
        if (side === 'left' && tRect.left - fRect.width - MARGIN < 0) side = 'right';
        if (side === 'right' && tRect.right + fRect.width + MARGIN > viewW) side = 'left';

        let top = 0;
        let left = 0;

        // Base side positioning
        if (side === 'top') {
            top = tRect.top - fRect.height - MARGIN;
        } else if (side === 'bottom') {
            top = tRect.bottom + MARGIN;
        } else if (side === 'left') {
            left = tRect.left - fRect.width - MARGIN;
        } else if (side === 'right') {
            left = tRect.right + MARGIN;
        }

        // Alignment logic
        if (side === 'top' || side === 'bottom') {
            if (align === 'start') left = tRect.left;
            else if (align === 'end') left = tRect.right - fRect.width;
            else left = tRect.left + (tRect.width / 2) - (fRect.width / 2); // center
        } else {
            if (align === 'start') top = tRect.top;
            else if (align === 'end') top = tRect.bottom - fRect.height;
            else top = tRect.top + (tRect.height / 2) - (fRect.height / 2); // center
        }

        // Final viewport clamps to guarantee it never bleeds offscreen
        left = Math.max(MARGIN, Math.min(left, viewW - fRect.width - MARGIN));
        top = Math.max(MARGIN, Math.min(top, viewH - fRect.height - MARGIN));

        floater.style.top = `${top}px`;
        floater.style.left = `${left}px`;
    }
};

// Auto-wire tooltips immediately
popover.wireTooltips();
