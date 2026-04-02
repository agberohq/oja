import { pushContainer, popContainer, _setReadyFn } from './_context.js';

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
 * _exec.js no longer injects container, find, findAll, or props as magic
 * globals. Component scripts import what they need explicitly:
 *
 *   import { find, container, props } from '../js/oja.js';
 *
 * find() reads the active container from the stack automatically.
 * container() returns the DOM element this script is mounted into.
 * props() returns the data passed at mount time.
 *
 * This makes dependencies IDE-visible, testable, and statically analysable.
 *
 * ─── __oja_ready__ ───────────────────────────────────────────────────────────
 *
 * The one remaining special value. Scripts signal completion by calling
 * ready() (imported from oja.js) or the injected __oja_ready__(). Both
 * resolve the same Promise. If neither is called, the load-event fallback
 * resolves automatically.
 *
 *   import { ready } from '../js/oja.js';
 *   // ... async setup ...
 *   ready();
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
// Returns true if `name` is declared as a binding in `source`.
// Strips strings and comments first to avoid false positives.
//
// Patterns covered:
//   const/let/var x = ...                   simple declaration
//   const/let/var { x } = ...              object destructuring
//   const/let/var [x] = ...               array destructuring
//   for (const x of ...) / for (const x in ...)   loop variables
//   function x() {}                         function declaration
//   class x {}                              class declaration
//   function f(x, ...) {}                   function parameter
//   (x) => {}  /  x => {}                  arrow parameter
//
// Critical correctness rule — the binding name must appear on the LEFT side
// of the declaration, not in the initialiser expression. The original pattern:
//
//   \b(?:const|let|var)\b[^;{]*?\bname\b
//
// was too broad: it matched  `const wsSwitcher = await find('#id')`  because
// `find` appears anywhere after `const` on the same line — including in the
// VALUE expression. This caused the preamble to skip injecting the scoped
// `find` helper, so scripts fell back to `window.find()` (the browser's
// native text-search API which returns boolean false).
//
// The fix: each const/let/var pattern now anchors the name to the BINDING
// position — directly after the keyword (simple), or inside { } / [ ]
// (destructuring) — never after the `=` sign.

function _declares(source, name) {
    if (!source.includes(name)) return false;

    // Strip strings and comments to reduce false positives
    const clean = source
        .replace(/`(?:[^`\\]|\\.)*`/g,  '``')   // template literals
        .replace(/'(?:[^'\\]|\\.)*'/g,  "''")    // single-quoted strings
        .replace(/"(?:[^"\\]|\\.)*"/g,  '""')    // double-quoted strings
        .replace(/\/\/[^\n]*/g,         '')       // line comments
        .replace(/\/\*[\s\S]*?\*\//g,   '');      // block comments

    const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return [
        // Simple: const find = ...  /  let find;  /  var find,
        // Name is the first (and only) identifier directly after the keyword.
        new RegExp(`\\b(?:const|let|var)\\s+${n}\\b`),
        // Object destructuring: const { find } = ...  or  const { a, find } = ...
        new RegExp(`\\b(?:const|let|var)\\s*\\{[^}]*\\b${n}\\b[^}]*\\}`),
        // Array destructuring: const [find] = ...  or  const [a, find] = ...
        new RegExp(`\\b(?:const|let|var)\\s*\\[[^\\]]*\\b${n}\\b[^\\]]*\\]`),
        // for-of / for-in loop variables
        new RegExp(`\\bfor\\s*\\(\\s*(?:const|let|var)\\s+${n}\\b`),
        // function declarations
        new RegExp(`\\bfunction\\s+${n}\\b`),
        // class declarations
        new RegExp(`\\bclass\\s+${n}\\b`),
        // function parameters: function(find) or function(a, find, b)
        new RegExp(`\\bfunction\\s*\\([^)]*\\b${n}\\b[^)]*\\)`),
        // arrow function parameters: (find) => or find =>
        new RegExp(`(?:^|[^\\w])${n}\\s*=>`),
        new RegExp(`\\([^)]*\\b${n}\\b[^)]*\\)\\s*=>`),
    ].some(re => re.test(clean));
}

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

            // Only __oja_ready__ is injected — everything else (container,
            // find, findAll, props) is imported explicitly by the script.
            window[scopeKey] = {
                __oja_ready__: null, // filled in below inside the Promise
            };

            const preamble = [
                `const { __oja_ready__ } = window[${JSON.stringify(scopeKey)}];`,
                `delete window[${JSON.stringify(scopeKey)}];`,
            ].join('\n');

            const src = `${preamble}\n${_rewriteImports(body, base)}`;
            const blob    = new Blob([src], { type: 'text/javascript' });
            const blobUrl = URL.createObjectURL(blob);

            newScript.src  = blobUrl;
            newScript.type = 'module';

            promises.push(new Promise((resolve) => {
                // ── Core fix: closed-over settled flag ────────────────────────
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
                };

                const _done = () => {
                    clearTimeout(timeoutId);
                    _settle();
                    resolve();
                };

                // Safety timeout — resolves instead of hanging forever if the
                // script has an infinite loop or never calls __oja_ready__().
                const timeoutId = setTimeout(() => {
                    console.warn(
                        `[oja/_exec] script timeout (${EXEC_TIMEOUT}ms) in:`,
                        sourceUrl || 'inline'
                    );
                    _done();
                }, EXEC_TIMEOUT);

                // Primary resolution: script calls __oja_ready__() (injected)
                // or import { ready } from '../js/oja.js' (explicit import path)
                window[scopeKey].__oja_ready__ = _done;
                _setReadyFn(container, _done);

                // Fallback: load event fires after script executes.
                // Covers scripts that forget __oja_ready__(), legacy components,
                // and scripts that error before reaching it.
                // Microtask delay gives synchronous post-load code one tick to
                // call __oja_ready__() before the fallback fires.
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