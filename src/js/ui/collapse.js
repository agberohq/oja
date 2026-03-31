/**
 * oja/collapse.js
 * Collapse/expand panels and accordion groups.
 * Uses animate.collapse() / animate.expand() for smooth height transitions.
 *
 * ─── Single panel (collapse) ──────────────────────────────────────────────────
 *
 *   import { collapse } from '../oja/src/js/ui/collapse.js';
 *
 *   const panel = collapse.attach('#toggle-btn', '#content-panel');
 *
 *   panel.open();    // animate expand
 *   panel.close();   // animate collapse
 *   panel.toggle();  // flip state
 *   panel.isOpen();  // → true | false
 *   panel.destroy(); // remove listeners
 *
 *   // With options:
 *   collapse.attach('#btn', '#panel', {
 *       open:      true,          // start open (default: false)
 *       animation: true,          // use height animation (default: true)
 *       duration:  200,           // ms (default: 250)
 *       onOpen:    () => {},      // called after open completes
 *       onClose:   () => {},      // called after close completes
 *   });
 *
 *   // Imperative show/hide without a trigger button:
 *   collapse.show('#panel');
 *   collapse.hide('#panel');
 *   collapse.toggle('#panel');
 *
 * ─── Accordion (mutually exclusive panels) ───────────────────────────────────
 *
 *   accordion.render('#faq', [
 *       { key: 'q1', label: 'What is Oja?',    content: '<p>...</p>' },
 *       { key: 'q2', label: 'Is it free?',     content: '<p>...</p>' },
 *       { key: 'q3', label: 'How to install?', content: Out.c('faq/install.html') },
 *   ], {
 *       openFirst:  true,          // open first item on render
 *       multiple:   false,         // allow multiple open at once
 *       onChange:   (key, open) => {},
 *   });
 *
 *   // With existing HTML (data-accordion-item pattern):
 *   //   <div id="faq">
 *   //     <div data-accordion-item="q1">
 *   //       <button data-accordion-trigger>What is Oja?</button>
 *   //       <div data-accordion-body><p>...</p></div>
 *   //     </div>
 *   //   </div>
 *   accordion.wire('#faq', { openFirst: true });
 */

import { animate } from '../core/animate.js';
import { Out }     from '../core/out.js';


function _resolve(target) {
    if (!target) return null;
    if (target instanceof Element) return target;
    return document.querySelector(target);
}

function _setAriaExpanded(triggerEl, open) {
    if (triggerEl) triggerEl.setAttribute('aria-expanded', String(open));
}


export const collapse = {

    /**
     * Attach a toggle trigger to a collapsible panel.
     * Returns a panel handle with open/close/toggle/destroy.
     */
    attach(trigger, panel, options = {}) {
        const triggerEl = _resolve(trigger);
        const panelEl   = _resolve(panel);

        if (!panelEl) {
            console.warn('[oja/collapse] panel not found:', panel);
            return _nullHandle();
        }

        const {
            open      = false,
            animation = true,
            duration  = 250,
            onOpen    = null,
            onClose   = null,
        } = options;

        // Set initial state
        if (!open) {
            panelEl.style.display = 'none';
            panelEl.setAttribute('aria-hidden', 'true');
        } else {
            panelEl.setAttribute('aria-hidden', 'false');
        }

        if (triggerEl) {
            triggerEl.setAttribute('aria-expanded', String(open));
            if (!triggerEl.id) triggerEl.id = `oja-collapse-trigger-${_idCounter++}`;
            if (!panelEl.id)   panelEl.id   = `oja-collapse-panel-${_idCounter++}`;
            triggerEl.setAttribute('aria-controls', panelEl.id);
            panelEl.setAttribute('aria-labelledby', triggerEl.id);
        }

        let _open = open;

        const handle = {
            async open() {
                if (_open) return this;
                _open = true;
                _setAriaExpanded(triggerEl, true);
                panelEl.setAttribute('aria-hidden', 'false');
                if (animation) {
                    await animate.expand(panelEl, { duration });
                } else {
                    panelEl.style.display = '';
                }
                onOpen?.();
                return this;
            },

            async close() {
                if (!_open) return this;
                _open = false;
                _setAriaExpanded(triggerEl, false);
                panelEl.setAttribute('aria-hidden', 'true');
                if (animation) {
                    await animate.collapse(panelEl, { duration });
                } else {
                    panelEl.style.display = 'none';
                }
                onClose?.();
                return this;
            },

            toggle() {
                return _open ? this.close() : this.open();
            },

            isOpen() { return _open; },

            destroy() {
                if (triggerEl) triggerEl.removeEventListener('click', _clickHandler);
            },
        };

        const _clickHandler = () => handle.toggle();
        if (triggerEl) triggerEl.addEventListener('click', _clickHandler);

        return handle;
    },

    /**
     * Imperatively show a panel element (with animation).
     */
    async show(target, options = {}) {
        const el = _resolve(target);
        if (!el) return;
        el.setAttribute('aria-hidden', 'false');
        if (options.animation !== false) {
            await animate.expand(el, { duration: options.duration ?? 250 });
        } else {
            el.style.display = '';
        }
    },

    /**
     * Imperatively hide a panel element (with animation).
     */
    async hide(target, options = {}) {
        const el = _resolve(target);
        if (!el) return;
        el.setAttribute('aria-hidden', 'true');
        if (options.animation !== false) {
            await animate.collapse(el, { duration: options.duration ?? 250 });
        } else {
            el.style.display = 'none';
        }
    },

    /**
     * Toggle a panel's visibility.
     */
    async toggle(target, options = {}) {
        const el = _resolve(target);
        if (!el) return;
        const hidden = el.style.display === 'none'
            || window.getComputedStyle(el).display === 'none';
        if (hidden) await this.show(target, options);
        else        await this.hide(target, options);
    },

    /**
     * Wire a toggle-card: a panel with a header row that contains a checkbox
     * which controls both the visual expanded state and a boolean data value.
     *   const card = collapse.toggleCard(cardEl, {
     *       checkbox: cb,
     *       body:     bodyEl,
     *       open:     cb.checked,
     *       animation: false,
     *       onChange: (open) => { route.engineData.web_static_on = open; },
     *   });
     *   card.open();
     *   card.close();
     *   card.isOpen();
     *   card.destroy();
     */
    toggleCard(cardEl, options = {}) {
        const {
            checkbox,
            body,
            open      = checkbox ? checkbox.checked : false,
            animation = false,
            duration  = 150,
            onChange  = null,
        } = options;

        if (!body) {
            console.warn('[oja/collapse] toggleCard: body element is required');
            return _nullHandle();
        }

        let _open = open;

        // Set initial visual state without triggering onChange
        if (_open) {
            body.style.display = '';
        } else {
            body.style.display = 'none';
        }
        if (checkbox) checkbox.checked = _open;

        function _applyState(nextOpen) {
            if (nextOpen === _open) return;
            _open = nextOpen;
            if (checkbox) checkbox.checked = _open;
            if (_open) {
                body.style.display = '';
            } else {
                body.style.display = 'none';
            }
            if (onChange) onChange(_open);
        }

        // Checkbox change handler — fires when the user interacts with the
        // checkbox/label directly (not through header click).
        function _onCheckboxChange() {
            _applyState(checkbox.checked);
        }

        // Header click handler — fires when the user clicks the card header
        // outside the switch label. We must NOT let the browser's label-for
        // mechanism fire change again for the same interaction, so we
        // preventDefault on the header click when it reaches a label element.
        function _onHeaderClick(e) {
            // If the click hit the switch wrapper or any element inside it,
            // let the checkbox handle it — do not also toggle here.
            if (e.target.closest && e.target.closest('.wz-switch')) return;
            e.stopPropagation();
            // Toggle state ourselves; do NOT modify checkbox.checked here
            // and then also dispatch change — _applyState sets checkbox.checked.
            _applyState(!_open);
        }

        if (checkbox) {
            checkbox.addEventListener('change', _onCheckboxChange);
        }

        const header = cardEl ? cardEl.querySelector('[data-target]') : null;
        if (header) {
            header.addEventListener('click', _onHeaderClick);
        }

        const handle = {
            open()    { _applyState(true);  return this; },
            close()   { _applyState(false); return this; },
            toggle()  { _applyState(!_open); return this; },
            isOpen()  { return _open; },
            destroy() {
                if (checkbox) checkbox.removeEventListener('change', _onCheckboxChange);
                if (header)   header.removeEventListener('click', _onHeaderClick);
            },
        };

        return handle;
    },
};


export const accordion = {

    /**
     * Render an accordion from a data array into a container.
     * Each item must have: { key, label, content }
     * content can be an HTML string or an Out instance.
     */
    render(target, items = [], options = {}) {
        const container = _resolve(target);
        if (!container) {
            console.warn('[oja/accordion] container not found:', target);
            return null;
        }

        const {
            openFirst = false,
            multiple  = false,
            duration  = 250,
            onChange  = null,
            className = '',
        } = options;

        container.innerHTML = '';
        container.setAttribute('role', 'list');

        const handles = new Map();

        items.forEach((item, idx) => {
            const itemEl    = document.createElement('div');
            const headerId  = `oja-acc-h-${_idCounter++}`;
            const panelId   = `oja-acc-p-${_idCounter++}`;
            const startOpen = openFirst && idx === 0;

            itemEl.className = `oja-accordion-item${className ? ' ' + className : ''}`;
            itemEl.setAttribute('role', 'listitem');

            const triggerEl = document.createElement('button');
            triggerEl.id        = headerId;
            triggerEl.type      = 'button';
            triggerEl.className = 'oja-accordion-trigger';
            triggerEl.setAttribute('aria-expanded',  String(startOpen));
            triggerEl.setAttribute('aria-controls',  panelId);
            triggerEl.innerHTML = `<span class="oja-accordion-label">${_esc(item.label)}</span>
                <span class="oja-accordion-icon" aria-hidden="true">${startOpen ? '▲' : '▼'}</span>`;

            const panelEl = document.createElement('div');
            panelEl.id        = panelId;
            panelEl.className = 'oja-accordion-body';
            panelEl.setAttribute('role',            'region');
            panelEl.setAttribute('aria-labelledby', headerId);
            panelEl.setAttribute('aria-hidden',     String(!startOpen));

            // Render content
            if (Out.is(item.content)) {
                item.content.render(panelEl);
            } else if (typeof item.content === 'string') {
                panelEl.innerHTML = item.content;
            }

            if (!startOpen) panelEl.style.display = 'none';

            itemEl.appendChild(triggerEl);
            itemEl.appendChild(panelEl);
            container.appendChild(itemEl);

            let _open = startOpen;

            const open = async () => {
                if (_open) return;
                if (!multiple) {
                    // Close all others
                    for (const [k, h] of handles) {
                        if (k !== item.key) await h.close();
                    }
                }
                _open = true;
                triggerEl.setAttribute('aria-expanded', 'true');
                panelEl.setAttribute('aria-hidden', 'false');
                triggerEl.querySelector('.oja-accordion-icon').textContent = '▲';
                await animate.expand(panelEl, { duration });
                onChange?.(item.key, true);
            };

            const close = async () => {
                if (!_open) return;
                _open = false;
                triggerEl.setAttribute('aria-expanded', 'false');
                panelEl.setAttribute('aria-hidden', 'true');
                triggerEl.querySelector('.oja-accordion-icon').textContent = '▼';
                await animate.collapse(panelEl, { duration });
                onChange?.(item.key, false);
            };

            triggerEl.addEventListener('click', () => _open ? close() : open());
            handles.set(item.key, { open, close, toggle: () => _open ? close() : open(), isOpen: () => _open });
        });

        return {
            open:  (key) => handles.get(key)?.open(),
            close: (key) => handles.get(key)?.close(),
            toggle:(key) => handles.get(key)?.toggle(),
            isOpen:(key) => handles.get(key)?.isOpen() ?? false,
            openAll:  () => Promise.all([...handles.values()].map(h => h.open())),
            closeAll: () => Promise.all([...handles.values()].map(h => h.close())),
            destroy:  () => { container.innerHTML = ''; handles.clear(); },
        };
    },

    /**
     * Wire existing HTML with data-accordion-item / data-accordion-trigger /
     * data-accordion-body attributes into an accordion.
     *
     *   <div id="faq">
     *     <div data-accordion-item="q1">
     *       <button data-accordion-trigger>Question?</button>
     *       <div data-accordion-body>Answer.</div>
     *     </div>
     *   </div>
     *
     *   accordion.wire('#faq', { openFirst: true });
     */
    wire(target, options = {}) {
        const container = _resolve(target);
        if (!container) return null;

        const items = Array.from(container.querySelectorAll('[data-accordion-item]'))
            .map(el => {
                const trigger = el.querySelector('[data-accordion-trigger]');
                const body    = el.querySelector('[data-accordion-body]');
                return { key: el.dataset.accordionItem, label: trigger?.textContent?.trim() || '', content: body?.innerHTML || '', _el: el };
            });

        // Use the existing elements rather than re-rendering
        const { openFirst = false, duration = 250, multiple = false, onChange = null } = options;
        const handles = new Map();

        items.forEach((item, idx) => {
            const itemEl  = item._el;
            const trigger = itemEl.querySelector('[data-accordion-trigger]');
            const body    = itemEl.querySelector('[data-accordion-body]');
            if (!trigger || !body) return;

            const startOpen = openFirst && idx === 0;
            let _open = startOpen;

            if (!startOpen) body.style.display = 'none';
            trigger.setAttribute('aria-expanded', String(startOpen));

            const open = async () => {
                if (_open) return;
                if (!multiple) {
                    for (const [k, h] of handles) { if (k !== item.key) await h.close(); }
                }
                _open = true;
                trigger.setAttribute('aria-expanded', 'true');
                await animate.expand(body, { duration });
                onChange?.(item.key, true);
            };

            const close = async () => {
                if (!_open) return;
                _open = false;
                trigger.setAttribute('aria-expanded', 'false');
                await animate.collapse(body, { duration });
                onChange?.(item.key, false);
            };

            trigger.addEventListener('click', () => _open ? close() : open());
            handles.set(item.key, { open, close, toggle: () => _open ? close() : open(), isOpen: () => _open });
        });

        return {
            open:  (key) => handles.get(key)?.open(),
            close: (key) => handles.get(key)?.close(),
            toggle:(key) => handles.get(key)?.toggle(),
            isOpen:(key) => handles.get(key)?.isOpen() ?? false,
        };
    },
};


let _idCounter = 0;

function _nullHandle() {
    return { open: () => Promise.resolve(), close: () => Promise.resolve(), toggle: () => Promise.resolve(), isOpen: () => false, destroy: () => {} };
}

function _esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}