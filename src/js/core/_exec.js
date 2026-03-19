import { find as _find, findAll as _findAll } from './ui.js';
/**
 * oja/_exec.js
 * Execute <script> tags that were injected via innerHTML.
 *
 * Browsers silently ignore scripts set via innerHTML — this is a hard security
 * rule with no exceptions. This module re-injects them as real DOM elements so
 * the browser actually runs them.
 *
 * For type="module" scripts, relative import specifiers are rewritten to
 * absolute URLs using the source component's URL as the resolution base.
 * This ensures that '../../src/js/form.js' inside 'pages/login.html' resolves
 * correctly regardless of where index.html lives.
 *
 * ─── Container injection ──────────────────────────────────────────────────────
 *
 * Every component script automatically receives three variables:
 *
 *   container  — the exact DOM element the component was mounted into.
 *   find       — pre-bound to scope within container; no second argument needed.
 *   findAll    — pre-bound to scope within container.
 *
 * This ensures DOM queries are always component-scoped without the developer
 * having to remember to pass container explicitly:
 *
 *   // Barrel-imported find — still works outside components:
 *   const btn = find(container, '#submit');
 *
 *   // Inside any component script — no second argument required:
 *   const btn = find('#submit');   // automatically scoped to this instance
 *
 * Outside component scripts the barrel-exported `find` keeps its existing
 * explicit-scope signature — nothing changes for non-component code.
 *
 * Used by:
 *   - out.js        (_ComponentOut.render)
 *   - component.js  (mount, add)
 *
 * @param {Element} container   — DOM element the HTML was mounted into
 * @param {string}  [sourceUrl] — URL the HTML was fetched from. Used as the
 * @param {object} propsData  -  Props Information
 *                                base for resolving relative import specifiers.
 *                                Falls back to document.baseURI if omitted.
 */
export function execScripts(container, sourceUrl, propsData = {}) {
    const base = sourceUrl
        ? new URL(sourceUrl, document.baseURI).href
        : document.baseURI;

    for (const old of Array.from(container.querySelectorAll('script'))) {
        const next = document.createElement('script');

        for (const { name, value } of Array.from(old.attributes)) {
            if (name !== 'src') next.setAttribute(name, value);
        }

        if (old.type === 'module') {
            const ctxKey  = '__oja_ctx_'  + Date.now() + '_' + Math.random().toString(36).slice(2);
            const helpKey = '__oja_hlp_'  + Date.now() + '_' + Math.random().toString(36).slice(2);
            const propsKey = '__oja_prp_' + Date.now() + '_' + Math.random().toString(36).slice(2);

            window[ctxKey]  = container;
            window[helpKey] = {
                find:    (sel, opts = {}) => _find(sel, { ...opts, scope: container }),
                findAll: (sel)            => _findAll(sel, container),
            };

            window[propsKey] = new Proxy(propsData || {}, {
                get(target, prop) {
                    const val = target[prop];
                    if (typeof val === 'function' && val.__isOjaSignal) return val();
                    return val;
                },
                set(target, prop, value) {
                    console.error(`[Oja] Attempted to mutate props.${String(prop)} to ${value}. Props are read-only. Use callbacks to communicate with parents.`);
                    return false;
                }
            });

            const body = old.textContent
                .replace(
                    /((?:^|\n|;)\s*import\s+(?:[\w*{}][\s\S]*?)?)\bfrom\s+(['"])([^'"]+)\2/gm,
                    function(m, prefix, q, s) {
                        return s.startsWith('.') ? prefix + 'from ' + q + _abs(s, base) + q : m;
                    }
                )
                .replace(
                    /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
                    function(m, q, s) {
                        return s.startsWith('.') ? 'import(' + q + _abs(s, base) + q + ')' : m;
                    }
                )
                .replace(
                    /((?:^|\n|;)\s*)import\s+(['"])([^'"]+)\2/gm,
                    function(m, prefix, q, s) {
                        return s.startsWith('.') ? prefix + 'import ' + q + _abs(s, base) + q : m;
                    }
                );

            const src = [
                'const container = window[' + JSON.stringify(ctxKey)  + '];',
                'delete window['             + JSON.stringify(ctxKey)  + '];',
                'const { find, findAll } = window[' + JSON.stringify(helpKey) + '];',
                'delete window['                     + JSON.stringify(helpKey) + '];',
                'const props = window[' + JSON.stringify(propsKey) + '];',
                'delete window[' + JSON.stringify(propsKey) + '];',
                body,
            ].join('\n');

            const blob    = new Blob([src], { type: 'text/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            next.src  = blobUrl;
            next.type = 'module';

            const revoke = function() { URL.revokeObjectURL(blobUrl); };
            next.addEventListener('load',  revoke, { once: true });
            next.addEventListener('error', function(e) {
                console.error('[oja/_exec] module script failed in:', sourceUrl, e);
                revoke();
            }, { once: true });
            setTimeout(revoke, 30000);

        } else {
            next.textContent = old.textContent;
        }

        old.replaceWith(next);
    }
}

function _abs(specifier, base) {
    try   { return new URL(specifier, base).href; }
    catch { return specifier; }
}