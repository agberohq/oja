/**
 * oja/engine.js
 * Hybrid DOM Engine — smart, surgical DOM updates without full Virtual DOM overhead.
 *
 * Three cooperating systems:
 *   morph()      — tree-diff an existing DOM node against new HTML (structural updates)
 *   bind*()      — store-to-DOM reactive text/html/class/attr subscriptions (telemetry)
 *   list()       — keyed array reconciliation (minimal reorder/add/remove)
 *
 * ─── Store Integration ────────────────────────────────────────────────────────
 *
 *   Engine ships with its own isolated in-memory Store as a fallback.
 *   Call engine.useStore(appStore) once at boot to share the app's Store instead.
 *   Both paths use the identical Store class — no dual-state trap.
 *
 *   // Standalone (uses internal store)
 *   engine.set('cpu', '45%');
 *   engine.bindText('#sysCpu', 'cpu');
 *
 *   // Shared with app store (call once in main.js)
 *   engine.useStore(store);
 *   engine.bindText('#sysCpu', 'metrics.cpu');
 *
 * ─── Morphing ─────────────────────────────────────────────────────────────────
 *
 *   await engine.morph(container, newHtml)
 *
 *   Short-circuits automatically when HTML is identical to the last morph.
 *   No external shouldMorph() guard required — morph() handles it internally.
 *
 *   Advanced use: engine.shouldMorph(el, html) is available for pre-flight checks
 *   (e.g. skip an expensive HTML build when content hasn't changed).
 *
 * ─── Reactive Binding ─────────────────────────────────────────────────────────
 *
 *   engine.bindText('#el',   storeKey)            — updates el.textContent
 *   engine.bindHtml('#el',   storeKey)            — updates el.innerHTML
 *   engine.bindClass('#el',  storeKey, transform)  — replaces el.className
 *   engine.bindAttr('#el',   storeKey, mapFn)     — sets/removes attributes
 *   engine.bindToggle('#el', storeKey, { activeClass, inactiveClass })
 *   engine.unbind(container)                      — remove all bindings in a subtree
 *
 *   Declarative (HTML-driven, called via scan/autoBind):
 *   <span data-oja-bind="metrics.cpu" data-oja-transform="formatPercent"></span>
 *
 * ─── Scoped vs Global Binding ─────────────────────────────────────────────────
 *
 *   engine.scan(container)    — one-time synchronous scan of a component's subtree
 *                               Call inside component.onMount — fast, zero observer overhead
 *   engine.enableAutoBind()   — global MutationObserver — opt-in for shell-level bindings
 *   engine.disableAutoBind()  — stop the global observer
 *
 * ─── Keyed Lists ──────────────────────────────────────────────────────────────
 *
 *   Synchronous render (plain HTML builders):
 *   engine.list(container, items, {
 *       key:    item => item.id,
 *       render: (item, existingEl) => Element,
 *       empty:  () => Element,
 *   });
 *
 *   Async render (Out components, fetched HTML):
 *   await engine.listAsync(container, items, {
 *       key:    item => item.id,
 *       render: async (item, existingEl) => Element,
 *   });
 *
 * ─── Batch ────────────────────────────────────────────────────────────────────
 *
 *   await engine.batch(() => {
 *       engine.set('cpu', '72%');
 *       engine.set('mem', '1.2GB');
 *   });
 *
 * ─── Formatters ───────────────────────────────────────────────────────────────
 *
 *   Built-in: uppercase, lowercase, capitalize, json, compactJson,
 *             formatBytes, formatPercent, booleanStatus, booleanClass, fallback
 *   Extend:   engine.formatters.myFmt = v => ...
 */

import { Store }  from './store.js';
import { emit }   from './events.js';
import {
    uppercase, lowercase, capitalize, toJson, toCompactJson,
    formatBytes, formatPercent, fallback, booleanClass, booleanStatus,
} from '../utils/formatter.js';


// Created on first use if engine.useStore() was never called.
// Uses in-memory storage — no sessionStorage/localStorage pollution.
let _store = null;

function _getStore() {
    if (!_store) _store = new Store('oja:engine', { prefer: 'memory' });
    return _store;
}


// storeKey → Set<Binding>   (for store change dispatch)
const _bindings    = new Map();

// element → Set<storeKey>   (for subtree unbind and lazy GC)
const _elementKeys = new WeakMap();

// element → hash            (morph short-circuit)
const _morphCache  = new WeakMap();

// Global MutationObserver — only active when enableAutoBind() is called
let _observer = null;


/**
 * Swap the engine's internal store for the app's store instance.
 * Call once at boot before any bind* or scan() calls.
 * Bindings registered before the swap are unaffected — they use _getStore() lazily.
 */
export function useStore(instance) {
    _store = instance;
}

/**
 * Convenience proxy to the active store's set().
 */
export function set(key, value) {
    return _getStore().set(key, value);
}

/**
 * Convenience proxy to the active store's get().
 */
export function get(key, fallback = null) {
    return _getStore().get(key, fallback);
}


/**
 * CSP-safe transformation registry for data-oja-transform attributes.
 * Functions are sourced from formatter.js — single source of truth shared with template.js.
 * Extend at app level: engine.formatters.myFmt = v => ...
 */
export const formatters = {
    uppercase,
    lowercase,
    capitalize,
    json:          toJson,
    compactJson:   toCompactJson,
    formatBytes,
    formatPercent,
    fallback,
    booleanClass,
    booleanStatus,
};


/**
 * Diff container against newHtml and surgically patch only what changed.
 * Preserves focus, text selection, scroll position, and existing event listeners.
 *
 * Short-circuits automatically when HTML is identical to the last morph —
 * no external guard required.
 *
 * Morph targets must be persistent container elements. Never morph an element
 * whose own root node will be replaced by the new HTML — use engine.list() for
 * content that may disappear entirely.
 *
 * @param {Element|string} container
 * @param {string}         newHtml
 * @param {Object}         options
 *   keyAttr      : string   — attribute used as stable node key (default: 'data-oja-key')
 *   onBeforeMorph: fn(el)   — return false to skip morphing a subtree (e.g. D3 nodes)
 *   onNodeAdded  : fn(el)   — called after a new node is inserted
 *   onNodeRemoved: fn(el)   — called before a node is removed
 * @returns {Element|null}
 */
export async function morph(container, newHtml, options = {}) {
    const el = _resolve(container);
    if (!el) { console.warn('[oja/engine] morph: container not found'); return null; }

    // Internal short-circuit — identical HTML is a no-op
    const hash = _hash(newHtml);
    if (_morphCache.get(el) === hash) return el;

    const {
        keyAttr       = 'data-oja-key',
        onBeforeMorph = null,
        onNodeAdded   = null,
        onNodeRemoved = null,
    } = options;

    const t0 = performance.now();

    // Parse into an offline fragment — never touches the live DOM during parse
    const tpl = document.createElement('template');
    tpl.innerHTML = newHtml.trim();
    const incoming = tpl.content;

    // Save user state before any DOM changes
    const focusPath = _getFocusPath(document.activeElement);
    const selection = _saveSelection();

    _morphChildren(el, incoming, { keyAttr, onBeforeMorph, onNodeAdded, onNodeRemoved });

    // Restore user state
    if (focusPath) {
        const restored = _resolvePath(focusPath);
        if (restored && typeof restored.focus === 'function') restored.focus({ preventScroll: true });
    }
    _restoreSelection(selection);

    _morphCache.set(el, hash);

    emit('engine:morphed', { container: el, duration: performance.now() - t0 });

    return el;
}

/**
 * Returns true only if newHtml differs from what was last morphed into container.
 * Useful for skipping an expensive HTML build step when source data hasn't changed.
 * Not required as a guard before morph() — morph() short-circuits internally.
 *
 *   // Skip expensive build if nothing changed
 *   if (engine.shouldMorph(el, lastHtml)) {
 *       await engine.morph(el, buildHosts(data));
 *   }
 */
export function shouldMorph(container, newHtml) {
    const el = _resolve(container);
    if (!el) return true;
    return _morphCache.get(el) !== _hash(newHtml);
}

function _morphElement(target, source, opts) {
    // Text nodes
    if (target.nodeType === Node.TEXT_NODE && source.nodeType === Node.TEXT_NODE) {
        if (target.textContent !== source.textContent) target.textContent = source.textContent;
        return;
    }

    // Incompatible node types or tags — replace wholesale
    if (target.nodeType !== source.nodeType || target.nodeName !== source.nodeName) {
        const replacement = source.cloneNode(true);
        target.parentNode?.replaceChild(replacement, target);
        opts.onNodeAdded?.(replacement);
        return;
    }

    // Allow caller to veto morphing a subtree (e.g. a D3-owned node)
    if (opts.onBeforeMorph?.(target) === false) return;

    if (target.nodeType === Node.ELEMENT_NODE) {
        const tag = target.tagName;

        // Sync form element state without clobbering active user input
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
            const srcVal = source.getAttribute('value') ?? '';
            if (document.activeElement !== target && target.value !== srcVal) target.value = srcVal;
            if (target.checked !== source.checked) target.checked = source.checked;
        }
        if (tag === 'SELECT') {
            if (document.activeElement !== target && target.value !== source.value) target.value = source.value;
        }

        _morphAttributes(target, source);
        _morphChildren(target, source, opts);
    }
}

function _morphAttributes(target, source) {
    for (let i = target.attributes.length - 1; i >= 0; i--) {
        const name = target.attributes[i].name;
        if (!source.hasAttribute(name)) target.removeAttribute(name);
    }
    for (const { name, value } of source.attributes) {
        if (target.getAttribute(name) !== value) target.setAttribute(name, value);
    }
}

function _morphChildren(parent, newParent, opts) {
    const existing = Array.from(parent.childNodes);
    const incoming = Array.from(newParent.childNodes);
    const keyedOld = new Map();
    const used     = new Set();
    const order    = [];

    for (const node of existing) {
        const k = _nodeKey(node, opts.keyAttr);
        if (k) keyedOld.set(k, node);
    }

    for (let i = 0; i < incoming.length; i++) {
        const newNode = incoming[i];
        const key     = _nodeKey(newNode, opts.keyAttr);
        let   matched = null;

        if (key && keyedOld.has(key) && !used.has(keyedOld.get(key))) {
            matched = keyedOld.get(key);
            used.add(matched);
        }

        if (!matched && i < existing.length && !used.has(existing[i])) {
            const cand = existing[i];
            if (cand.nodeType === newNode.nodeType && cand.nodeName === newNode.nodeName) {
                matched = cand;
                used.add(matched);
            }
        }

        if (matched) {
            _morphElement(matched, newNode, opts);
            order.push(matched);
        } else {
            const created = newNode.cloneNode(true);
            order.push(created);
            opts.onNodeAdded?.(created);
        }
    }

    for (const node of existing) {
        if (!used.has(node)) { opts.onNodeRemoved?.(node); node.remove(); }
    }

    let cursor = parent.firstChild;
    for (const node of order) {
        if (cursor === node) { cursor = cursor.nextSibling; }
        else { parent.insertBefore(node, cursor); }
    }
}


/**
 * One-time synchronous scan of a container for data-oja-bind attributes.
 * The default pattern for component use — scoped, predictable, zero overhead.
 *
 *   component.onMount(el => engine.scan(el));
 */
export function scan(container) {
    const root = _resolve(container);
    if (!root) return;
    if (root.matches?.('[data-oja-bind]')) _applyBindAttr(root);
    for (const el of root.querySelectorAll('[data-oja-bind]')) _applyBindAttr(el);
}

/**
 * Remove all bindings for every element within container.
 * Call in component.onUnmount for deterministic cleanup.
 * Proactive alternative to lazy GC.
 *
 *   component.onUnmount(() => engine.unbind(container));
 */
export function unbind(container) {
    const root = _resolve(container);
    if (!root) return;

    const unbindEl = el => {
        const keys = _elementKeys.get(el);
        if (!keys) return;
        for (const storeKey of [...keys]) _unbind(el, storeKey);
    };

    unbindEl(root);
    for (const el of root.querySelectorAll('[data-oja-bind]')) unbindEl(el);
}

/**
 * Opt-in global MutationObserver — scans new nodes automatically.
 * Appropriate for shell-level bindings that span the full document lifetime.
 * Use engine.scan() for component-level work.
 */
export function enableAutoBind() {
    if (_observer) return;
    scan(document.body);
    _observer = new MutationObserver(mutations => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) scan(node);
            }
        }
    });
    _observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * Stop the global MutationObserver started by enableAutoBind().
 */
export function disableAutoBind() {
    _observer?.disconnect();
    _observer = null;
}

function _applyBindAttr(el) {
    const key           = el.getAttribute('data-oja-bind');
    const type          = el.getAttribute('data-oja-bind-type') || 'text';
    const formatterName = el.getAttribute('data-oja-transform');
    const transform     = (formatterName && formatters[formatterName])
        ? formatters[formatterName]
        : formatters.fallback;
    _bindElement(el, key, type, transform);
}

/**
 * Bind an element's textContent to a store key.
 * Returns an unsubscribe function.
 */
export function bindText(selector, storeKey, transform = formatters.fallback) {
    const el = _resolve(selector);
    if (!el) { console.warn(`[oja/engine] bindText: element not found — "${selector}"`); return () => {}; }
    return _bindElement(el, storeKey, 'text', transform);
}

/**
 * Bind an element's innerHTML to a store key.
 * Returns an unsubscribe function.
 */
export function bindHtml(selector, storeKey, transform = formatters.fallback) {
    const el = _resolve(selector);
    if (!el) { console.warn(`[oja/engine] bindHtml: element not found — "${selector}"`); return () => {}; }
    return _bindElement(el, storeKey, 'html', transform);
}

/**
 * Bind an element's className to a store key.
 * transform receives the store value and should return a class string.
 * Returns an unsubscribe function.
 */
export function bindClass(selector, storeKey, transform = formatters.fallback) {
    const el = _resolve(selector);
    if (!el) { console.warn(`[oja/engine] bindClass: element not found — "${selector}"`); return () => {}; }
    return _bindElement(el, storeKey, 'class', transform);
}

/**
 * Bind one or more attributes to a store key.
 * transform receives the store value and must return { attrName: value }.
 * A null value removes the attribute.
 * Returns an unsubscribe function.
 */
export function bindAttr(selector, storeKey, transform) {
    if (typeof transform !== 'function') {
        console.warn(`[oja/engine] bindAttr: transform must be a function — "${storeKey}"`);
        return () => {};
    }
    const el = _resolve(selector);
    if (!el) { console.warn(`[oja/engine] bindAttr: element not found — "${selector}"`); return () => {}; }
    return _bindElement(el, storeKey, 'attr', transform);
}

/**
 * Toggle a CSS class on an element based on a store boolean.
 * Returns an unsubscribe function.
 *
 *   engine.bindToggle('#offlineBanner', 'isOffline', { activeClass: 'active' });
 */
export function bindToggle(selector, storeKey, options = {}) {
    const { activeClass = 'active', inactiveClass = '' } = options;
    const el = _resolve(selector);
    if (!el) { console.warn(`[oja/engine] bindToggle: element not found — "${selector}"`); return () => {}; }
    return _bindElement(el, storeKey, 'class', v => v ? activeClass : inactiveClass);
}

function _bindElement(el, storeKey, type, transform) {
    const existing = _elementKeys.get(el);
    if (existing?.has(storeKey)) return () => _unbind(el, storeKey);

    if (!_bindings.has(storeKey)) _bindings.set(storeKey, new Set());

    const unsub   = _getStore().onChange(storeKey, newVal => _applyBinding(el, type, transform, storeKey, newVal));
    const binding = { el, type, transform, unsub };

    _bindings.get(storeKey).add(binding);
    if (!_elementKeys.has(el)) _elementKeys.set(el, new Set());
    _elementKeys.get(el).add(storeKey);

    _applyBinding(el, type, transform, storeKey);

    return () => _unbind(el, storeKey);
}

function _applyBinding(el, type, transform, storeKey, value) {
    if (!document.contains(el)) { _unbind(el, storeKey); return; }
    if (value === undefined) value = _getStore().get(storeKey);
    const v = transform ? transform(value) : (value ?? '');

    try {
        switch (type) {
            case 'text':  el.textContent = v; break;
            case 'html':  el.innerHTML   = v; break;
            case 'class': el.className   = Array.isArray(v) ? v.join(' ') : (v ?? ''); break;
            case 'attr':
                if (v && typeof v === 'object') {
                    for (const [attr, val] of Object.entries(v)) {
                        if (val == null) el.removeAttribute(attr);
                        else el.setAttribute(attr, String(val));
                    }
                }
                break;
        }
    } catch (e) {
        console.warn(`[oja/engine] binding update failed — key: "${storeKey}"`, e);
    }
}

function _unbind(el, storeKey) {
    const set = _bindings.get(storeKey);
    if (set) {
        for (const b of set) {
            if (b.el === el) { b.unsub?.(); set.delete(b); break; }
        }
        if (set.size === 0) _bindings.delete(storeKey);
    }
    _elementKeys.get(el)?.delete(storeKey);
}


/**
 * Reconcile a keyed array into a container with minimal DOM operations.
 * For synchronous render functions (plain HTML builders, template strings).
 *
 * Existing elements with matching keys are reused and passed to render() for
 * in-place update. New keys get freshly created elements. Removed keys are deleted.
 *
 *   engine.list('#hostsContainer', hosts, {
 *       key:    host => host.id,
 *       render: (host, existingEl) => {
 *           const el = existingEl || document.createElement('div');
 *           el.innerHTML = buildHostRow(host);   // sync template builder
 *           return el;
 *       },
 *   });
 */
/**
 * Reconcile a keyed array into a container with minimal DOM operations.
 * For synchronous render functions (plain HTML builders, template strings).
 *
 * Lifecycle callbacks:
 *   onMount(containerEl)           — fires once after the first render
 *   onItemMount(itemEl, data, idx) — fires only for newly created items
 *   onItemRemove(itemEl)           — fires before an item is removed
 *
 * The onMount / onItemMount distinction matters: onMount is for one-time
 * imperative plugin setup (e.g. dragdrop.reorder). onItemMount is for
 * per-item setup (e.g. attaching a tooltip to each new row).
 * Neither fires on subsequent re-renders of existing items.
 *
 *   engine.list('#notes', notes, {
 *       key:    n => n.id,
 *       render: (n, existing) => { ... return el; },
 *       onMount:      (container) => dragdrop.reorder(container, { ... }),
 *       onItemMount:  (el, data, i) => initTooltip(el),
 *       onItemRemove: (el) => cleanupTooltip(el),
 *   });
 */
export function list(container, items, options = {}) {
    const parent = _resolve(container);
    if (!parent) { console.warn('[oja/engine] list: container not found'); return; }

    const {
        key, render, empty, keyAttr = 'data-oja-key',
        onMount, onItemMount, onItemRemove,
    } = options;
    if (!render) { console.warn('[oja/engine] list: options.render is required'); return; }
    if (!key)    { console.warn('[oja/engine] list: options.key is required');    return; }

    // data-oja-list-mounted is a durable DOM marker — survives reactive re-renders
    // without requiring an internal WeakMap or module-level state.
    const isFirstRender = !parent.hasAttribute('data-oja-list-mounted');

    if (!items || items.length === 0) {
        parent.innerHTML = '';
        if (empty) parent.appendChild(typeof empty === 'function' ? empty() : empty);
        if (isFirstRender) {
            parent.setAttribute('data-oja-list-mounted', '');
            onMount?.(parent);
        }
        emit('engine:list-updated', { container: parent, count: 0 });
        return;
    }

    const existing = new Map();
    for (const child of parent.children) {
        const k = child.getAttribute(keyAttr);
        if (k) existing.set(k, child);
    }

    const used  = new Set();
    const order = [];

    for (let i = 0; i < items.length; i++) {
        const item    = items[i];
        const itemKey = String(key(item, i));
        const found   = existing.get(itemKey) || null;
        const el      = render(item, found, i);
        if (!el) continue;
        if (!el.getAttribute(keyAttr)) el.setAttribute(keyAttr, itemKey);
        // If render returned a new element instead of reusing found, remove the stale one
        if (found && el !== found) found.remove();
        // onItemMount fires ONLY for genuinely new items (found === null).
        // It does NOT fire on re-renders of existing items.
        if (!found && onItemMount) onItemMount(el, item, i);
        order.push(el);
        used.add(itemKey);
    }

    for (const [k, el] of existing) {
        if (!used.has(k)) {
            onItemRemove?.(el);
            el.remove();
        }
    }

    _reorderChildren(parent, order);

    if (isFirstRender) {
        parent.setAttribute('data-oja-list-mounted', '');
        onMount?.(parent);
    }

    emit('engine:list-updated', { container: parent, count: items.length });
}

/**
 * Async variant of list() — for render functions that return Promises.
 * Used when render involves fetching component HTML or async Out rendering.
 * Slots are inserted immediately with existing content preserved; async renders
 * update each slot in place as they resolve.
 *
 * Supports the same lifecycle callbacks as list():
 *   onMount(containerEl)           — fires once after the first render
 *   onItemMount(itemEl, data, idx) — fires only for newly inserted slots
 *   onItemRemove(itemEl)           — fires before a slot is removed
 *
 *   await engine.listAsync('#hostsContainer', hosts, {
 *       key:    host => host.id,
 *       render: async (host, existingEl) => {
 *           const el = existingEl || document.createElement('div');
 *           await Out.to(el).component('components/host-row.html', host);
 *           return el;
 *       },
 *       onMount: (container) => dragdrop.reorder(container, { ... }),
 *   });
 */
export async function listAsync(container, items, options = {}) {
    const parent = _resolve(container);
    if (!parent) { console.warn('[oja/engine] listAsync: container not found'); return; }

    const {
        key, render, empty, keyAttr = 'data-oja-key',
        onMount, onItemMount, onItemRemove,
    } = options;
    if (!render) { console.warn('[oja/engine] listAsync: options.render is required'); return; }
    if (!key)    { console.warn('[oja/engine] listAsync: options.key is required');    return; }

    const isFirstRender = !parent.hasAttribute('data-oja-list-mounted');

    if (!items || items.length === 0) {
        parent.innerHTML = '';
        if (empty) parent.appendChild(typeof empty === 'function' ? empty() : empty);
        if (isFirstRender) {
            parent.setAttribute('data-oja-list-mounted', '');
            onMount?.(parent);
        }
        emit('engine:list-updated', { container: parent, count: 0 });
        return;
    }

    const existing = new Map();
    for (const child of parent.children) {
        const k = child.getAttribute(keyAttr);
        if (k) existing.set(k, child);
    }

    // Build slots synchronously — preserves order and reuses existing nodes immediately
    const slots = items.map((item, i) => {
        const itemKey = String(key(item, i));
        const found   = existing.get(itemKey) || null;
        const slot    = found || document.createElement('div');
        if (!slot.getAttribute(keyAttr)) slot.setAttribute(keyAttr, itemKey);
        return { item, slot, itemKey, i, isNew: !found };
    });

    // Insert/reorder before async work so DOM order is correct immediately
    const used = new Set(slots.map(s => s.itemKey));
    for (const [k, el] of existing) {
        if (!used.has(k)) {
            onItemRemove?.(el);
            el.remove();
        }
    }
    _reorderChildren(parent, slots.map(s => s.slot));

    // Render all slots concurrently — each updates its slot in place
    await Promise.all(slots.map(({ item, slot, i, isNew }) =>
        Promise.resolve(render(item, slot, i)).then(() => {
            if (isNew && onItemMount) onItemMount(slot, item, i);
        })
    ));

    if (isFirstRender) {
        parent.setAttribute('data-oja-list-mounted', '');
        onMount?.(parent);
    }

    emit('engine:list-updated', { container: parent, count: items.length });
}

/**
 * Defer a batch of store updates to the next animation frame.
 * Prevents multiple repaints when updating several keys at once.
 *
 *   await engine.nextFrame(() => {
 *       engine.set('cpu', '72%');
 *       engine.set('mem', '1.2GB');
 *   });
 */
export function nextFrame(fn) {
    return new Promise(resolve => requestAnimationFrame(() => { fn(); resolve(); }));
}


function _resolve(target) {
    if (!target) return null;
    if (target instanceof Element) return target;
    return document.querySelector(target);
}

// Fast synchronous integer hash — not cryptographic.
// Purpose: detect whether HTML content has changed since the last morph.
// 32-bit range is sufficient for short-lived morph cache entries.
function _hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = Math.imul(31, h) + str.charCodeAt(i) | 0; }
    return h;
}

function _nodeKey(node, keyAttr) {
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    return node.getAttribute(keyAttr) || node.id || null;
}

function _reorderChildren(parent, order) {
    let cursor = parent.firstChild;
    for (const node of order) {
        if (cursor === node) { cursor = cursor.nextSibling; }
        else { parent.insertBefore(node, cursor ?? null); }
    }
}

function _getFocusPath(el) {
    if (!el || el === document.body || !document.body.contains(el)) return null;
    const path = [];
    while (el && el !== document.body) {
        const parent = el.parentNode;
        if (!parent) break;
        path.unshift(Array.from(parent.childNodes).indexOf(el));
        el = parent;
    }
    return path;
}

function _resolvePath(path) {
    let el = document.body;
    for (const i of path) {
        el = el?.childNodes[i];
        if (!el) return null;
    }
    return el;
}

function _saveSelection() {
    const sel = window.getSelection?.();
    if (!sel || !sel.rangeCount) return null;
    try {
        const r = sel.getRangeAt(0);
        return {
            sc: _getFocusPath(r.startContainer), so: r.startOffset,
            ec: _getFocusPath(r.endContainer),   eo: r.endOffset,
        };
    } catch { return null; }
}

function _restoreSelection(state) {
    if (!state) return;
    try {
        const sc = _resolvePath(state.sc);
        const ec = _resolvePath(state.ec);
        if (!sc || !ec) return;
        const range = document.createRange();
        range.setStart(sc, state.so);
        range.setEnd(ec, state.eo);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    } catch { /* selection restoration is best-effort */ }
}


export const engine = {
    useStore,
    set,
    get,
    morph,
    shouldMorph,
    scan,
    unbind,
    enableAutoBind,
    disableAutoBind,
    bindText,
    bindHtml,
    bindClass,
    bindAttr,
    bindToggle,
    list,
    listAsync,
    batch: nextFrame,
    formatters,
};