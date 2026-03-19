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
 * Every component script automatically receives a `container` variable — the
 * exact DOM element the component was mounted into. This enables true component
 * isolation: multiple instances of the same component on the same page each
 * get their own scoped reference, so querySelector() never bleeds across them.
 *
 *   // Inside any component script — container is always available:
 *   const imgEl = container.querySelector('img');   // scoped to THIS instance
 *   const form  = container.querySelector('form');  // not the whole document
 *
 * Used by:
 *   - responder.js  (_ComponentResponder.render)
 *   - component.js  (mount, add)
 *
 * @param {Element} container   — DOM element the HTML was mounted into
 * @param {string}  [sourceUrl] — URL the HTML was fetched from. Used as the
 *                                base for resolving relative import specifiers.
 *                                Falls back to document.baseURI if omitted.
 */
export function execScripts(container, sourceUrl) {
    // Resolve the base URL for import specifiers.
    // We use the component file's URL (e.g. pages/login.html) so that
    // '../../src/js/form.js' resolves relative to that file, not to index.html.
    const base = sourceUrl
        ? new URL(sourceUrl, document.baseURI).href
        : document.baseURI;

    for (const old of Array.from(container.querySelectorAll('script'))) {
        const next = document.createElement('script');

        // Copy all attributes except src — we set it ourselves for modules
        for (const { name, value } of Array.from(old.attributes)) {
            if (name !== 'src') next.setAttribute(name, value);
        }

        if (old.type === 'module') {
            // Store the container in a temporary global so the module script
            // can retrieve it synchronously on first line of execution.
            // The key is unique per invocation to avoid collisions.
            const ctxKey = `__oja_ctx_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            window[ctxKey] = container;

            // Rewrite relative import specifiers to absolute URLs.
            // Three patterns covered:
            //   import { x } from './y.js'   — static named import
            //   import './y.js'               — side-effect import
            //   import('./y.js')              — dynamic import
            //
            // The `from` regex is anchored to only match after an `import`
            // statement boundary (start of line, or after ; or newline).
            // This prevents false matches inside string literals such as:
            //   const msg = "imported from './assets/img.png'";
            // Without the anchor, that string would be incorrectly rewritten.
            const body = old.textContent
                .replace(/((?:^|\n|;)\s*import\s+[\w*{][^;]*?)\bfrom\s+(['"])([^'"]+)\2/gm,
                    (m, prefix, q, s) =>
                        s.startsWith('.') ? `${prefix}from ${q}${_abs(s, base)}${q}` : m)
                .replace(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g, (m, q, s) =>
                    s.startsWith('.') ? `import(${q}${_abs(s, base)}${q})` : m)
                .replace(/((?:^|\n|;)\s*)import\s+(['"])([^'"]+)\2/gm,
                    (m, prefix, q, s) =>
                        s.startsWith('.') ? `${prefix}import ${q}${_abs(s, base)}${q}` : m);

            // Prepend container retrieval — first thing the module does is
            // grab its scoped container and remove the global reference.
            const src = `const container = window[${JSON.stringify(ctxKey)}];
delete window[${JSON.stringify(ctxKey)}];
${body}`;

            const blob    = new Blob([src], { type: 'text/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            next.src  = blobUrl;
            next.type = 'module';

            // Revoke the blob URL once the script loads or errors.
            // The 5s timeout is a safety net if neither event fires
            // (e.g. the user navigates away before the script executes).
            const revoke = () => URL.revokeObjectURL(blobUrl);
            next.addEventListener('load',  revoke, { once: true });
            next.addEventListener('error', (e) => {
                console.error('[oja/_exec] module script failed in:', sourceUrl, e);
                revoke();
            }, { once: true });
            setTimeout(revoke, 5000);

        } else {
            // Classic script — copy text directly, no module isolation needed
            next.textContent = old.textContent;
        }

        old.replaceWith(next);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _abs(specifier, base) {
    try   { return new URL(specifier, base).href; }
    catch { return specifier; }
}