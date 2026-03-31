/**
 * oja/segment.js
 * In-document template registry — define reusable HTML segments directly
 * inside the main HTML file using <template> elements, with zero setup
 * required for the common case.
 *
 * Two layers:
 *   Layer 1 (newbie)  — just use Out.segment(name, data). No import needed.
 *                       Auto-scans the document on first use.
 *   Layer 2 (power)   — import { segment } for explicit control: scan(),
 *                       define(), list(), clearCache() etc.
 *
 * ─── Declare segments in HTML ─────────────────────────────────────────────────
 *
 *   <template data-oja-segment="home">
 *       <h1>Welcome {{user.name}}</h1>
 *       <button data-action="logout">Sign out</button>
 *   </template>
 *
 *   <template data-oja-segment="about">
 *       <p>Oja v{{version}} — zero-build SPA framework</p>
 *   </template>
 *
 * ─── Layer 1 — newbie usage ───────────────────────────────────────────────────
 *
 *   import { Router, Out } from './oja.js';
 *
 *   const router = new Router({ outlet: '#app' });
 *   router.Get('/',      Out.segment('home',  { user }));
 *   router.Get('/about', Out.segment('about', { version: '0.0.9' }));
 *   router.start('/');
 *
 *   // Render directly without a router
 *   await Out.to('#app').segment('home', { user });
 *
 *   // In a modal or layout slot — Out.segment() is a full Out
 *   modal.open('m', { body: Out.segment('confirm', { msg }) });
 *   await layout.slot('sidebar', Out.segment('nav', { items }));
 *
 * ─── Layer 2 — power user usage ──────────────────────────────────────────────
 *
 *   import { segment } from './oja.js';
 *
 *   segment.scan();                            // re-scan the document
 *   segment.define('dashboard', '<h1>{{t}}</h1>');  // programmatic
 *   segment.defineAll({ home: html1, about: html2 });
 *
 *   console.log(segment.list());              // → ['home', 'about', 'dashboard']
 *   segment.has('home');                      // → true
 *   segment.get('home');                      // → raw HTML string
 *
 *   segment.undefine('dashboard');            // remove one
 *   segment.clearCache();                     // remove all — next use re-scans
 *
 *   // Still use Out.segment() — it reads from the same registry
 *   router.Get('/dashboard', Out.segment('dashboard', { data }));
 *
 * ─── data-oja-segment-keep ───────────────────────────────────────────────────
 *
 *   By default, <template> elements are removed from the DOM after scan()
 *   to keep the live document clean. Add data-oja-segment-keep to retain them:
 *
 *   <template data-oja-segment="reusable" data-oja-segment-keep>...</template>
 *
 * ─── Script execution ─────────────────────────────────────────────────────────
 *
 *   Scripts inside segments work identically to scripts in .html components.
 *   The container, find, findAll, and props variables are all injected.
 *
 *   <template data-oja-segment="counter">
 *       <span id="count">{{initial}}</span>
 *       <script type="module">
 *           import { state, effect } from './oja.js';
 *           const [n, setN] = state(props.initial ?? 0);
 *           effect(() => { find('#count').textContent = n(); });
 *           component.onMount(() => setN(n => n + 1));
 *       </script>
 *   </template>
 *
 * ─── Dynamic / programmatic segments ─────────────────────────────────────────
 *
 *   // Load from an API and register
 *   const html = await fetch('/api/segments/promo').then(r => r.text());
 *   segment.define('promo', html);
 *   Out.to('#banner').segment('promo', { code: 'OJA10' });
 *
 *   // Load from VFS
 *   const doc = new DOMParser().parseFromString(
 *       await vfs.readText('segments.html'), 'text/html'
 *   );
 *   segment.scan(doc);   // scan accepts any Element or Document
 */

import { render as templateRender, fill } from './template.js';
import { execScripts }                    from './_exec.js';
import { emit }                           from './events.js';


const _registry = new Map(); // name → html string
let   _scanned  = false;

// Scan on first use — called internally before every registry read.
// Re-entrant: does nothing if already scanned unless reset by clearCache()/scan().
function _ensureScanned() {
    if (_scanned) return;
    _scanned = true;
    _scanRoot(document);
}

function _scanRoot(root) {
    root.querySelectorAll('template[data-oja-segment]').forEach(tmpl => {
        const name = tmpl.getAttribute('data-oja-segment');
        if (!name) return;
        if (_registry.has(name)) {
            console.warn(`[oja/segment] duplicate name "${name}" — overwriting`);
        }
        _registry.set(name, tmpl.innerHTML);
        if (!tmpl.hasAttribute('data-oja-segment-keep')) tmpl.remove();
    });
}


export async function _segmentRender(container, name, data, context = {}) {
    _ensureScanned();

    const html = _registry.get(name);
    if (!html) {
        throw new Error(
            `[oja/segment] unknown segment: "${name}". ` +
            `Did you forget <template data-oja-segment="${name}">?`
        );
    }

    const merged = { ...context, ...data };
    container.innerHTML = templateRender(html, merged);
    fill(container, merged);

    const { component } = await import('./component.js');
    const prev = component._activeElement;
    component._activeElement = container;
    try {
        await execScripts(container, `segment:${name}`, merged);
    } finally {
        component._activeElement = prev;
    }

    emit('segment:rendered', { name, container });
}


export const segment = {

    /**
     * Scan a root element (or the whole document) for <template data-oja-segment>
     * elements and register them. Calling scan() resets the auto-scan flag so
     * explicit calls always pick up new templates added to the DOM after boot.
     *
     *   segment.scan();           // scan document
     *   segment.scan(dialogEl);   // scan a specific subtree
     */
    scan(root = document) {
        _scanned = true; // suppress the auto-scan — this IS the scan
        // Previously both ternary branches passed the same value.
        _scanRoot(root instanceof Document ? root.documentElement : root);
        return this;
    },

    /**
     * Register a segment by name from an HTML string.
     * Overwrites any previously registered segment with the same name.
     *
     *   segment.define('promo', '<div class="promo">{{offer}}</div>');
     */
    define(name, html) {
        if (!name || typeof html !== 'string') {
            console.warn('[oja/segment] define() requires a name and an HTML string');
            return this;
        }
        _registry.set(name, html);
        return this;
    },

    /**
     * Register multiple segments at once from a { name: html } map.
     *
     *   segment.defineAll({ home: homeHtml, about: aboutHtml });
     */
    defineAll(map) {
        for (const [name, html] of Object.entries(map)) this.define(name, html);
        return this;
    },

    /**
     * Return true if a segment with this name is registered.
     */
    has(name) {
        _ensureScanned();
        return _registry.has(name);
    },

    /**
     * Return the raw HTML string for a registered segment, or null.
     */
    get(name) {
        _ensureScanned();
        return _registry.get(name) ?? null;
    },

    /**
     * Return an array of all registered segment names.
     */
    list() {
        _ensureScanned();
        return Array.from(_registry.keys());
    },

    /**
     * Remove a single registered segment.
     */
    undefine(name) {
        _registry.delete(name);
        return this;
    },

    /**
     * Clear the entire registry and reset the auto-scan flag.
     * The next Out.segment() or segment.has() call will re-scan the document.
     */
    clearCache() {
        _registry.clear();
        _scanned = false;
        return this;
    },
};