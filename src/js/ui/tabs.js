/**
 * oja/tabs.js
 * Imperative tab system — nav bar + panel switching.
 * Follows the same pattern as chart.js and table.js.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { tabs } from '../oja/src/js/ui/tabs.js';
 *
 *   const t = tabs.render('#infoTabs', [
 *       { key: 'details',    label: 'Details'    },
 *       { key: 'directors',  label: 'Directors'  },
 *       { key: 'compliance', label: 'Compliance' },
 *   ], {
 *       active:   'details',
 *       onChange: key => loadPanel(key),
 *   });
 *
 *   t.activate('directors');  // switch programmatically
 *   t.active();               // → 'directors'
 *   t.destroy();
 *
 * ─── Integration with Out ─────────────────────────────────────────────────────
 *
 *   The cleanest pattern — Out loads a component into a panel container each
 *   time the tab changes:
 *
 *   tabs.render('#tabNav', defs, {
 *       active: 'details',
 *       onChange: async (key) => {
 *           await Out.to('#tabPanel').component(`pages/tabs/${key}.html`);
 *       },
 *   });
 *
 * ─── Inline panels (data-tab attribute) ──────────────────────────────────────
 *
 *   Provide pre-rendered panels. tabs.js shows/hides them via aria-hidden:
 *
 *   <div id="panels">
 *       <div data-tab="details">...</div>
 *       <div data-tab="directors">...</div>
 *   </div>
 *
 *   tabs.render('#tabNav', defs, {
 *       panels: '#panels',
 *       active: 'details',
 *   });
 *
 * ─── Options ──────────────────────────────────────────────────────────────────
 *
 *   active   : string          — initially active tab key (default: first tab)
 *   onChange : async fn(key)   — called on every tab change
 *   panels   : string|Element  — container holding [data-tab] children
 *   variant  : 'line' | 'pill' — visual style (default: 'line')
 */


function _resolve(target) {
    if (!target) return null;
    if (target instanceof Element) return target;
    return document.querySelector(target);
}


export const tabs = {

    /**
     * Render a tab nav bar into container.
     * @param {string|Element} target
     * @param {Object[]}       defs     — [{ key, label, disabled? }]
     * @param {Object}         opts
     * @returns {{ activate, active, destroy }}
     */
    render(target, defs, opts = {}) {
        const container = _resolve(target);
        if (!container || !defs?.length) return null;

        const {
            active:   initialActive = defs[0]?.key,
            onChange  = null,
            panels    = null,
            variant   = 'line',
        } = opts;

        let currentKey   = initialActive;
        const _listeners = [];
        const panelRoot  = panels ? _resolve(panels) : null;

        // ── Build nav ─────────────────────────────────────────────────────

        container.innerHTML = '';
        container.className = `oja-tabs oja-tabs-${variant}`;
        container.setAttribute('role', 'tablist');

        const buttons = new Map();

        for (const def of defs) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'oja-tab-btn';
            btn.setAttribute('role', 'tab');
            btn.setAttribute('data-key', def.key);
            btn.setAttribute('aria-selected', String(def.key === currentKey));
            btn.setAttribute('aria-controls', `oja-panel-${def.key}`);
            btn.id = `oja-tab-${def.key}`;
            btn.textContent = def.label;
            if (def.disabled) {
                btn.disabled = true;
                btn.setAttribute('aria-disabled', 'true');
            }

            const handler = () => {
                if (def.disabled || def.key === currentKey) return;
                _activate(def.key);
            };
            btn.addEventListener('click', handler);
            _listeners.push({ el: btn, type: 'click', handler });

            container.appendChild(btn);
            buttons.set(def.key, btn);
        }

        // ── Panel management ──────────────────────────────────────────────

        function _syncPanels(key) {
            if (!panelRoot) return;
            for (const panel of panelRoot.querySelectorAll('[data-tab]')) {
                const isActive = panel.getAttribute('data-tab') === key;
                panel.hidden = !isActive;
                panel.setAttribute('role', 'tabpanel');
                panel.id = `oja-panel-${panel.getAttribute('data-tab')}`;
                panel.setAttribute('aria-labelledby', `oja-tab-${panel.getAttribute('data-tab')}`);
            }
        }

        function _syncButtons(key) {
            for (const [k, btn] of buttons) {
                const active = k === key;
                btn.classList.toggle('active', active);
                btn.setAttribute('aria-selected', String(active));
            }
        }

        function _activate(key) {
            currentKey = key;
            _syncButtons(key);
            _syncPanels(key);
            onChange?.(key);
        }

        // ── Initial state ─────────────────────────────────────────────────

        _syncButtons(currentKey);
        _syncPanels(currentKey);

        // ── Public handle ─────────────────────────────────────────────────

        return {
            // Switch to a tab by key. Fires onChange.
            activate(key) {
                if (key !== currentKey) _activate(key);
            },

            // Returns the currently active tab key.
            active() {
                return currentKey;
            },

            // Remove the nav DOM and detach all listeners.
            destroy() {
                for (const { el, type, handler } of _listeners) {
                    el.removeEventListener(type, handler);
                }
                container.innerHTML = '';
            },
        };
    },
};