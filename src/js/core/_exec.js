import { pushContainer, popContainer, _setReadyFn, clearExecSlot } from './_context.js';

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
 * Module scripts are executed via blob: URLs. This is the only reliable
 * mechanism because:
 *   - Re-injected <script type="module"> need a URL base for relative imports.
 *   - data: URLs have null origin, which breaks relative import resolution.
 *   - factory/IIFE wrappers are SyntaxErrors — static imports must be top-level.
 *
 * The host page must include blob: in its Content-Security-Policy script-src:
 *   <meta http-equiv="Content-Security-Policy"
 *         content="script-src 'self' blob: ...">
 *
 * ─── No magic injection ───────────────────────────────────────────────────────
 *
 * _exec.js does not inject any variables into component scripts.
 * Scripts import what they need explicitly:
 *
 *   import { find, container, props, ready, scoped, ref } from '../js/oja.js';
 *
 * find() reads the active container from the stack automatically.
 * container() returns the DOM element this script is mounted into.
 * props() returns the data passed at mount time.
 *
 * ─── ready() ─────────────────────────────────────────────────────────────────
 *
 * Scripts signal async completion by calling ready() (imported from oja.js).
 * If ready() is never called, the load-event fallback resolves automatically.
 *
 *   import { ready } from '../js/oja.js';
 *   // ... async setup ...
 *   ready();
 *
 * ─── Why _declares() was removed ─────────────────────────────────────────────
 *
 * _declares() was a regex-based JS parser used to detect whether a component
 * script already declared a name before injecting it in the preamble. It was
 * inherently brittle — already fixed once for the `const x = await find(...)`
 * false-positive. Other valid patterns it would misparse:
 *   `const obj = { find: fn }`, `function f(find) {}`
 *
 * Removing __oja_ready__ injection removes the only reason _declares() existed.
 * The preamble is now two fixed lines — no code generation, no parsing.
 *
 * ─── Preamble ─────────────────────────────────────────────────────────────────
 *
 * window[scopeKey] is set to the container element (a bare Element reference,
 * not a wrapped object). The preamble reads it synchronously — the very first
 * code the module runs — then deletes it. This is the only channel from the
 * host page into the isolated blob module context.
 *
 * ─── Resolution paths ────────────────────────────────────────────────────────
 *
 * A `settled` boolean (closed over in the Promise) tracks resolution state.
 * This is immune to the window[scopeKey] deletion that caused the original
 * layout.apply() hang bug.
 *
 * ─── Return value ─────────────────────────────────────────────────────────────
 *
 * Returns a Promise<void> that resolves when all module scripts have settled.
 * Classic scripts resolve immediately. Rejects only on invalid input.
 *
 * @param {Element} container   — DOM element the HTML was mounted into
 * @param {string}  [sourceUrl] — URL the HTML was fetched from
 * @param {object}  [propsData] — props passed to the component
 * @returns {Promise<void>}
 */

const SCOPE_PREFIX = '__oja_scope_';
const EXEC_TIMEOUT = 30_000; // 30s — catches while(true) and infinite await chains

// Monotonic counter prevents key collision even in the same millisecond
let _scopeCounter = 0;

//
// Rewrites relative import specifiers to absolute URLs using the component's
// base URL. Uses a character-by-character parser to correctly skip strings,
// template literals, and comments — so imports inside strings or comments are
// never accidentally rewritten.

function _rewriteImports(source, base) {
    let out = '';
    let i   = 0;
    const L = source.length;

    while (i < L) {
        const ch  = source[i];
        const rem = source.slice(i);

        // String literals — copy verbatim, do not inspect for imports
        if (ch === '"' || ch === "'" || ch === '`') {
            out += ch; i++;
            while (i < L && source[i] !== ch) {
                if (source[i] === '\\') { out += source[i++]; }
                if (i < L) out += source[i++];
            }
            if (i < L) out += source[i++];
            continue;
        }

        // Line comment — preserve text, skip import detection
        if (rem.startsWith('//')) {
            const nl = source.indexOf('\n', i);
            if (nl === -1) { out += rem; break; }
            out += source.slice(i, nl);
            i = nl;
            continue;
        }

        // Block comment — preserve text, skip import detection
        if (rem.startsWith('/*')) {
            const end = source.indexOf('*/', i);
            if (end === -1) { out += rem; break; }
            out += source.slice(i, end + 2);
            i = end + 2;
            continue;
        }

        // from './rel'
        const fromM = rem.match(/^from\s+(['"])(\.\.?[^'"]+)\1/);
        if (fromM) {
            out += `from ${fromM[1]}${_abs(fromM[2], base)}${fromM[1]}`;
            i += fromM[0].length;
            continue;
        }

        // import('./rel') or await import('./rel')
        const dynM = rem.match(/^(await\s+)?import\s*\(\s*(['"])(\.\.?[^'"]+)\2\s*\)/);
        if (dynM) {
            const awaitPrefix = dynM[1] || '';
            const quote = dynM[2];
            const path = dynM[3];
            out += `${awaitPrefix}import(${quote}${_abs(path, base)}${quote})`;
            i += dynM[0].length;
            continue;
        }

        // import './rel'
        const sideM = rem.match(/^import\s+(['"])(\.\.?[^'"]+)\1/);
        if (sideM) {
            out += `import ${sideM[1]}${_abs(sideM[2], base)}${sideM[1]}`;
            i += sideM[0].length;
            continue;
        }

        out += source[i++];
    }

    return out;
}

function _abs(spec, base) {
    try   { return new URL(spec, base).href; }
    catch { return spec; }
}

export function execScripts(container, sourceUrl, propsData = {}) {
    if (!container || !(container instanceof Element)) {
        return Promise.reject(
            new TypeError('[oja/_exec] container must be a DOM Element')
        );
    }

    const scripts = Array.from(container.querySelectorAll('script'));
    if (scripts.length === 0) return Promise.resolve();

    const base = sourceUrl
        ? new URL(sourceUrl, document.baseURI).href
        : document.baseURI;

    // Push this container onto the stack so find(), container(), props()
    // and ready() all resolve to the right element during script execution.
    pushContainer(container, propsData);

    const promises = [];

    for (const oldScript of scripts) {
        const newScript = document.createElement('script');

        // Copy all attributes except src — we set src ourselves for modules
        for (const { name, value } of oldScript.attributes) {
            if (name !== 'src') newScript.setAttribute(name, value);
        }

        if (oldScript.type === 'module') {
            // Unique key: counter makes collision impossible even at same ms
            const scopeKey = `${SCOPE_PREFIX}${Date.now()}_${++_scopeCounter}_${Math.random().toString(36).slice(2, 8)}`;

            const body = oldScript.textContent || '';

            // Pass the container element through the blob boundary via a
            // temporary window key. The preamble reads it synchronously —
            // the very first code the module runs — so find() / scoped() /
            // container() at top-level always see the correct element.
            //
            // No __oja_ready__ is injected here. Scripts signal completion via:
            //   import { ready } from '../js/oja.js'; ready();
            // The load-event fallback resolves automatically if ready() is
            // never called (covers synchronous scripts and legacy components).
            window[scopeKey] = container;

            // Two fixed lines — no code generation, no _declares() parsing.
            const preamble = [
                `window.__oja_exec__ = window[${JSON.stringify(scopeKey)}];`,
                `delete window[${JSON.stringify(scopeKey)}];`,
            ].join('\n');

            const src     = `${preamble}\n${_rewriteImports(body, base)}`;
            const blob    = new Blob([src], { type: 'text/javascript' });
            const blobUrl = URL.createObjectURL(blob);

            newScript.src  = blobUrl;
            newScript.type = 'module';

            promises.push(new Promise((resolve) => {
                // Core fix: closed-over settled flag
                // window[scopeKey] is deleted by the preamble before any event
                // handler fires, so we track resolution with a plain boolean
                // instead. This fixed the layout.apply() hang bug.
                let settled = false;

                const _settle = () => {
                    if (settled) return;
                    settled = true;
                    URL.revokeObjectURL(blobUrl);
                    // Clean up scope key in case script errored before preamble ran
                    if (scopeKey in window) delete window[scopeKey];
                    // Clear the per-execution slot — top-level code is done
                    clearExecSlot();
                };

                const _done = () => {
                    clearTimeout(timeoutId);
                    _settle();
                    resolve();
                };

                // Safety timeout — resolves instead of hanging forever if the
                // script has an infinite loop or never resolves.
                const timeoutId = setTimeout(() => {
                    console.warn(
                        `[oja/_exec] script timeout (${EXEC_TIMEOUT}ms) in:`,
                        sourceUrl || 'inline'
                    );
                    _done();
                }, EXEC_TIMEOUT);

                // Primary resolution: script imports ready() from oja.js and calls it.
                //   import { ready } from '../js/oja.js'; ready();
                // _setReadyFn wires the container -> _done so component.ready()
                // resolves this same Promise.
                _setReadyFn(container, _done);

                // Fallback: load event fires after script executes.
                // Covers synchronous scripts, scripts that never call ready(),
                // and scripts that error before reaching it.
                // Microtask delay gives synchronous post-load code one tick to
                // call ready() before the fallback fires.
                newScript.addEventListener('load',  () => { Promise.resolve().then(_done); }, { once: true });
                newScript.addEventListener('error', (e) => {
                    console.error('[oja/_exec] module script error in:', sourceUrl || 'inline', e);
                    _done();
                }, { once: true });
            }));

        } else {
            // Classic script — synchronous, no blob, resolves immediately
            newScript.textContent = oldScript.textContent;
        }

        oldScript.replaceWith(newScript);
    }

    return promises.length > 0
        ? Promise.all(promises).then(() => {}).finally(() => popContainer())
        : Promise.resolve().finally(() => popContainer());
}

/**
 * Remove any orphaned scope keys left on window.
 * Called by the router on navigation after component unmount.
 */
export function cleanupOjaScopes() {
    for (const key of Object.keys(window)) {
        if (key.startsWith(SCOPE_PREFIX)) delete window[key];
    }
}
