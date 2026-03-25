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
 * This ensures that '../js/store.js' inside 'pages/hosts.html' resolves
 * correctly regardless of where index.html lives.
 *
 * ─── Execution mechanism: blob: URLs ─────────────────────────────────────────
 *
 * Module scripts are executed via blob: URLs. This is the only reliable mechanism
 * because:
 *   - Re-injected <script type="module"> need a URL base for relative imports.
 *   - data: URLs have null origin, which breaks all relative import resolution.
 *   - factory/IIFE wrappers are SyntaxErrors — static imports must be top-level.
 *
 * The host page must include blob: in its Content-Security-Policy script-src:
 *
 *   <meta http-equiv="Content-Security-Policy"
 *         content="script-src 'self' blob: ...">
 *
 * ─── Container injection ──────────────────────────────────────────────────────
 *
 * Every component script automatically receives up to four variables:
 *
 *   container  — the exact DOM element the component was mounted into.
 *   find       — pre-bound querySelector scoped to container.
 *   findAll    — pre-bound querySelectorAll scoped to container.
 *   props      — read-only proxy of props passed to this component.
 *
 * Each variable is only injected when the script does not already declare it,
 * preventing duplicate-identifier crashes.
 *
 * ─── Global key hygiene ───────────────────────────────────────────────────────
 *
 * One window key per execution holds all scope values (down from three in the
 * previous implementation). It is deleted on the second line of the preamble,
 * immediately after destructuring — the key is only needed for that one read.
 * This is safe because module scripts execute synchronously until the first await,
 * and the key is never needed again after the destructure completes.
 *
 * ─── Return value ─────────────────────────────────────────────────────────────
 *
 * Returns a Promise that resolves once all type="module" scripts have fired
 * their load event. Classic scripts resolve immediately.
 *
 * @param {Element} container   — DOM element the HTML was mounted into
 * @param {string}  [sourceUrl] — URL the HTML was fetched from
 * @param {object}  [propsData] — props passed to the component
 * @returns {Promise<void>}
 */
export function execScripts(container, sourceUrl, propsData = {}) {
    const base = sourceUrl
        ? new URL(sourceUrl, document.baseURI).href
        : document.baseURI;

    const modulePromises = [];

    for (const old of Array.from(container.querySelectorAll('script'))) {
        const next = document.createElement('script');

        for (const { name, value } of Array.from(old.attributes)) {
            if (name !== 'src') next.setAttribute(name, value);
        }

        if (old.type === 'module') {
            // Single key holds all scope values — reduces global surface from 3 keys to 1.
            const scopeKey = '__oja_' + Date.now() + '_' + Math.random().toString(36).slice(2);

            window[scopeKey] = {
                container,
                find:    (sel, opts = {}) => _find(sel, { ...opts, scope: container }),
                findAll: (sel)            => _findAll(sel, container),
                props: new Proxy(propsData || {}, {
                    get(target, prop) {
                        const val = target[prop];
                        if (typeof val === 'function' && val.__isOjaSignal) return val();
                        return val;
                    },
                    set(target, prop, value) {
                        console.error(`[Oja] Attempted to mutate props.${String(prop)} to ${value}. Props are read-only.`);
                        return false;
                    },
                }),
            };

            const body = _rewriteImports(old.textContent, base);

            // container, find, and findAll are common names a developer may declare
            // themselves — only inject the ones the script does not already declare.
            const declares = (name) =>
                new RegExp(`\\b(?:const|let|var|function)\\s+${name}\\b`).test(body);

            const picks = [];
            if (!declares('container')) picks.push('container');
            if (!declares('find'))      picks.push('find');
            if (!declares('findAll'))   picks.push('findAll');
            picks.push('props');          // props is Oja-specific — always injected
            picks.push('__oja_ready__'); // slot completion signal

            // The key is read once and immediately deleted. Module scripts execute
            // synchronously until their first await, so the delete on line 2 always
            // runs before any async gap — nothing can observe the key between these lines.
            const preamble = [
                `const { ${picks.join(', ')} } = window[${JSON.stringify(scopeKey)}];`,
                `delete window[${JSON.stringify(scopeKey)}];`,
            ];

            const src     = [...preamble, body].join('\n');
            const blob    = new Blob([src], { type: 'text/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            next.src  = blobUrl;
            next.type = 'module';

            // Use a ready-signal channel instead of the load event.
            // The load event fires when the <script> element loads — not when
            // the module's async body (imports, top-level awaits) completes.
            // We inject __oja_ready__ into the module scope; the module calls
            // it as the last statement of its setup, guaranteeing all listeners
            // and effects are registered before the caller proceeds.
            const p = new Promise((resolve) => {
                const revoke = () => URL.revokeObjectURL(blobUrl);
                window[scopeKey].__oja_ready__ = () => { revoke(); resolve(); };

                // Fallback: if the module never calls __oja_ready__ (e.g. it has
                // no top-level async, or an older slot without the call), the load
                // event still resolves us — it just means we may resolve slightly early.
                next.addEventListener('load', () => {
                    // Give the module one microtask tick to call __oja_ready__
                    // synchronously before we fall back to load-event resolution.
                    Promise.resolve().then(() => {
                        if (window[scopeKey]?.__oja_ready__) {
                            // Module didn't call it yet — fall back to load timing
                            revoke();
                            resolve();
                        }
                    });
                }, { once: true });

                next.addEventListener('error', (e) => {
                    console.error('[oja/_exec] module script failed in:', sourceUrl, e);
                    revoke();
                    resolve();
                }, { once: true });
            });

            modulePromises.push(p);

        } else {
            next.textContent = old.textContent;
        }

        old.replaceWith(next);
    }

    return modulePromises.length > 0
        ? Promise.all(modulePromises).then(() => {})
        : Promise.resolve();
}

/**
 * Rewrite relative import specifiers to absolute URLs using the component's base URL.
 * Three independent patterns cover all static and dynamic import forms without overlap.
 * Bare specifiers (e.g. 'vue') and absolute URLs are left untouched.
 */
function _rewriteImports(source, base) {
    return source
        // from './rel' or from "../rel"  (named, namespace, default imports)
        .replace(
            /\bfrom\s+(['"])(\.\.?[^'"]+)\1/g,
            (_, q, spec) => `from ${q}${_abs(spec, base)}${q}`
        )
        // import('./rel')  (dynamic import expression)
        .replace(
            /\bimport\s*\(\s*(['"])(\.\.?[^'"]+)\1\s*\)/g,
            (_, q, spec) => `import(${q}${_abs(spec, base)}${q})`
        )
        // import './rel'  (side-effect import, no bindings)
        .replace(
            /\bimport\s+(['"])(\.\.?[^'"]+)\1/g,
            (_, q, spec) => `import ${q}${_abs(spec, base)}${q}`
        );
}

function _abs(specifier, base) {
    try   { return new URL(specifier, base).href; }
    catch { return specifier; }
}