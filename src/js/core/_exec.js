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
 * ─── Scope injection ──────────────────────────────────────────────────────────
 *
 * Every component script automatically receives:
 *
 *   container     — the DOM element the component was mounted into.
 *   find          — querySelector scoped to container.
 *   findAll       — querySelectorAll scoped to container.
 *   props         — read-only proxy of the props passed at mount time.
 *   __oja_ready__ — call once when synchronous setup is complete.
 *
 * Variables are only injected when the script does not already declare them,
 * preventing SyntaxError: Identifier already declared.
 *
 * ─── Global key hygiene ───────────────────────────────────────────────────────
 *
 * One window key per execution holds all scope values. It is deleted on the
 * second line of the preamble, immediately after destructuring. A monotonic
 * counter combined with Date.now() makes collisions impossible even when
 * multiple scripts execute in the same millisecond.
 *
 * ─── Resolution paths ────────────────────────────────────────────────────────
 *
 * A `settled` boolean (closed over in the Promise) tracks resolution state.
 * This is the core fix for the layout.apply() hang bug:
 *
 * OLD (broken): fallback checked window[scopeKey]?.__oja_ready__ after the
 *   preamble had already deleted window[scopeKey]. Check was always undefined.
 *   Fallback never fired. layout.apply() hung forever for any script that
 *   forgot to call __oja_ready__().
 *
 * NEW (fixed): closed-over `settled` boolean is immune to the deletion.
 *   Both __oja_ready__() and the load-event fallback call the same _done()
 *   function. _done() is idempotent — settled guards against double resolution.
 *
 * ─── __oja_ready__() contract ────────────────────────────────────────────────
 *
 * Scripts SHOULD call __oja_ready__() once their synchronous setup is done.
 * If they forget, the load-event fallback resolves them automatically.
 * Long-running shells (like shell.html) call it once at the end of their
 * synchronous wiring block — not at the end of any async work.
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

// ── Constants ─────────────────────────────────────────────────────────────────

const SCOPE_PREFIX = '__oja_scope_';
const EXEC_TIMEOUT = 30_000; // 30s — catches while(true) and infinite await chains

// Monotonic counter prevents key collision even in the same millisecond
let _scopeCounter = 0;

// ── Declaration detection ─────────────────────────────────────────────────────
//
// Returns true if `name` is declared as a binding in `source`.
// Strips strings and comments first to avoid false positives.
//
// Patterns covered:
//   const/let/var x = ...                   variable declaration
//   const/let/var { x } = ...              destructuring
//   for (const x of ...) / for (const x in ...)   loop variables
//   function x() {}                         function declaration
//   class x {}                              class declaration
//   function f(x, ...) {}                   function parameter
//   (x) => {}  /  x => {}                  arrow parameter

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
        // const/let/var declarations — covers simple, destructured, array
        new RegExp(`\\b(?:const|let|var)\\b[^;{]*?\\b${n}\\b`),
        // for-of / for-in loop variables
        new RegExp(`\\bfor\\s*\\(\\s*(?:const|let|var)\\s+${n}\\b`),
        // function declarations
        new RegExp(`\\bfunction\\s+${n}\\b`),
        // class declarations
        new RegExp(`\\bclass\\s+${n}\\b`),
        // function parameters: function(x) or function(a, x, b)
        new RegExp(`\\bfunction\\s*\\([^)]*\\b${n}\\b[^)]*\\)`),
        // arrow function parameters: (x) => or x =>
        new RegExp(`(?:^|[^\\w])${n}\\s*=>`),
        new RegExp(`\\([^)]*\\b${n}\\b[^)]*\\)\\s*=>`),
    ].some(re => re.test(clean));
}

// ── Import rewriting ──────────────────────────────────────────────────────────
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

        // import('./rel')
        const dynM = rem.match(/^import\s*\(\s*(['"])(\.\.?[^'"]+)\1\s*\)/);
        if (dynM) {
            out += `import(${dynM[1]}${_abs(dynM[2], base)}${dynM[1]})`;
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

// ── Props proxy ───────────────────────────────────────────────────────────────
//
// Read-only Proxy over propsData. Signals (.__isOjaSignal) are unwrapped on
// read. All traps are implemented so Object.keys(), 'key' in props, and
// delete props.x all behave correctly.

function _makeProps(propsData) {
    // Do NOT freeze the target. Object.freeze() makes properties non-configurable
    // and non-writable, which forces the Proxy to return the exact stored value
    // from get(). But we need get() to unwrap signals (call signal() instead of
    // returning the function). Returning a different value than what
    // getOwnPropertyDescriptor reports is a Proxy invariant violation — TypeError.
    // The set/deleteProperty traps already enforce read-only semantics.
    const target = { ...propsData };

    return new Proxy(target, {
        get(target, prop) {
            if (prop === Symbol.toStringTag) return 'OjaProps';
            const val = target[prop];
            if (typeof val === 'function' && val.__isOjaSignal) {
                try { return val(); } catch { return undefined; }
            }
            return val;
        },
        set(target, prop) {
            console.error(`[Oja] Props are read-only. Cannot set props.${String(prop)}.`);
            return false;
        },
        deleteProperty(target, prop) {
            console.error(`[Oja] Props are read-only. Cannot delete props.${String(prop)}.`);
            return false;
        },
        has(target, prop)   { return prop in target; },
        ownKeys(target)     { return Object.keys(target); },
        getOwnPropertyDescriptor(target, prop) {
            if (!(prop in target)) return undefined;
            // Return the raw stored value (signal function or plain value) —
            // this must match what the engine sees in the target object.
            return { value: target[prop], writable: true, enumerable: true, configurable: true };
        },
    });
}

// ── Main export ───────────────────────────────────────────────────────────────

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

            const body  = oldScript.textContent || '';
            const props = _makeProps(propsData);

            // Place scope on window — preamble destructures then deletes it
            window[scopeKey] = {
                container,
                find:         (sel, opts = {}) => _find(sel, { ...opts, scope: container }),
                findAll:      (sel)            => _findAll(sel, container),
                props,
                __oja_ready__: null, // filled in below inside the Promise
            };

            // Only inject vars the script doesn't already declare —
            // prevents SyntaxError: Identifier already declared
            const picks = ['props', '__oja_ready__'];
            if (!_declares(body, 'container')) picks.push('container');
            if (!_declares(body, 'find'))      picks.push('find');
            if (!_declares(body, 'findAll'))   picks.push('findAll');

            const preamble = [
                `const { ${picks.join(', ')} } = window[${JSON.stringify(scopeKey)}];`,
                `delete window[${JSON.stringify(scopeKey)}];`,
            ].join('\n');

            const src     = `${preamble}\n${_rewriteImports(body, base)}`;
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

                // Primary resolution: script calls __oja_ready__()
                window[scopeKey].__oja_ready__ = _done;

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
        ? Promise.all(promises).then(() => {})
        : Promise.resolve();
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