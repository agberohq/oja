/**
 * oja/template.js
 * Fills HTML with data. Two syntax styles, both valid HTML, no compiler.
 *
 * ─── Style 1: data-attributes (pure HTML — UI dev friendly) ──────────────────
 *
 *   <div data-if="user.admin">Admin content</div>
 *   <div data-if-not="user.admin">Guest content</div>
 *   <div data-if-class="user.admin:is-admin,user.active:is-active">...</div>
 *   <a data-bind="href:profile.url,title:profile.name">Profile</a>
 *
 *   <template data-each="hosts" data-as="h">
 *       <div>{{h.name}}</div>
 *   </template>
 *   <div data-empty="hosts">No hosts found</div>
 *   <div data-loading="hosts">Loading...</div>
 *
 * ─── Style 2: Go-like inline syntax (expressive — works inside attributes) ───
 *
 *   {{.user.name}}                         → interpolate value
 *   {{.user.name | upper}}                 → with filter
 *   {{if .user.admin}}...{{end}}           → conditional block
 *   {{if .user.admin}}...{{else}}...{{end}} → if/else
 *   {{if not .user.admin}}...{{end}}       → negated condition
 *   {{range .hosts}}{{.name}}{{end}}       → loop (dot = current item)
 *   {{range .hosts}}...{{else}}none{{end}} → loop with empty fallback
 *
 * ─── Path notation ────────────────────────────────────────────────────────────
 *
 *   Oja supports both dot notation and bracket notation for accessing
 *   nested data — including array indices:
 *
 *   {{user.name}}           → dot notation
 *   {{hosts[0].status}}     → bracket notation (array index)
 *   {{routes[0].backends[1].url}} → deeply nested
 *
 * ─── Loop context variables ───────────────────────────────────────────────────
 *
 *   Inside data-each, these are always available:
 *   {{Index}}   → 0-based index
 *   {{First}}   → true on first item
 *   {{Last}}    → true on last item
 *   {{Length}}  → total item count
 *
 * ─── Filters ─────────────────────────────────────────────────────────────────
 *
 *   Built-in: upper, lower, title, json, date, time, ago, default, trunc, bytes
 *   Custom:   template.filter('slug', s => s.toLowerCase().replace(/ /g,'-'))
 *   Usage:    {{.name | slug}} or {{.ts | date}} or {{.val | default "n/a"}}
 *
 * ─── API ─────────────────────────────────────────────────────────────────────
 *
 *   render(html, data)              → string: process Go-style blocks + interpolate
 *   fill(container, data)           → void:   fill already-mounted DOM element
 *   each(container, name, items, options?) → void: process data-each loop
 *   renderRaw(html, data)           → string: same as render but no XSS escaping
 *   template.filter(name, fn)       → register a custom filter
 */

// ─── Filter registry ──────────────────────────────────────────────────────────

const _filters = new Map([
    ['upper',   (s)       => String(s ?? '').toUpperCase()],
    ['lower',   (s)       => String(s ?? '').toLowerCase()],
    ['title',   (s)       => String(s ?? '').replace(/\b\w/g, l => l.toUpperCase())],
    ['json',    (v)       => JSON.stringify(v)],
    ['date',    (ts)      => ts ? new Date(ts).toLocaleDateString() : ''],
    ['time',    (ts)      => ts ? new Date(ts).toLocaleTimeString() : ''],
    ['ago',     (ts)      => _timeAgo(ts)],
    ['default', (v, dflt) => (v !== undefined && v !== null && v !== '') ? v : (dflt ?? '')],
    ['trunc',   (s, n)    => { const str = String(s ?? ''); return str.length > n ? str.slice(0, n) + '…' : str; }],
    ['bytes',   (n)       => _formatBytes(Number(n) || 0)],
]);

// ─── Token cache ──────────────────────────────────────────────────────────────

const _cache = new Map();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Process an HTML string — runs Go-style block statements then interpolates.
 * Returns a new HTML string. Safe to set as innerHTML.
 * Values are XSS-escaped. Use renderRaw() for trusted HTML values.
 */
export function render(html, data = {}) {
    return _processBlocks(html, data, true);
}

/**
 * Same as render() but does not HTML-escape values.
 * Only use when values are already safe HTML.
 */
export function renderRaw(html, data = {}) {
    return _processBlocks(html, data, false);
}

/**
 * Fill an already-mounted DOM container with data.
 * Handles: text interpolation, data-if, data-if-not, data-if-class, data-bind.
 */
export function fill(container, data = {}) {
    _walkDOM(container, data);
}

/**
 * Process a data-each loop inside a container.
 *
 * @param {Element}  container
 * @param {string}   name       — matches <template data-each="name">
 * @param {Array}    items
 * @param {Object}   options
 *   filter  : (item) => bool
 *   sort    : (a, b) => number
 *   map     : (item, index) => object
 *   chunk   : number              — render N per animation frame (non-blocking)
 *   empty   : string | Responder  — what to show when list is empty
 *   loading : string | Responder  — what to show while chunked render runs
 */
export function each(container, name, items = [], options = {}) {
    const tpl = container.querySelector(`template[data-each="${name}"]`);
    if (!tpl) {
        console.warn(`[oja/template] <template data-each="${name}"> not found`);
        return;
    }

    // Clear previously rendered items
    container.querySelectorAll(`[data-each-item="${name}"]`).forEach(el => el.remove());
    container.querySelectorAll(`[data-each-empty="${name}"]`).forEach(el => el.remove());

    const asVar     = tpl.dataset.as || 'item';
    const emptyEl   = container.querySelector(`[data-empty="${name}"]`);
    const loadingEl = container.querySelector(`[data-loading="${name}"]`);

    // Apply filter → sort → map
    let list = options.filter ? items.filter(options.filter) : [...items];
    if (options.sort) list.sort(options.sort);

    if (list.length === 0) {
        _showSlot(emptyEl, tpl, name, options.empty, 'empty');
        if (loadingEl) loadingEl.style.display = 'none';
        return;
    }

    if (emptyEl)   emptyEl.style.display   = 'none';
    if (loadingEl) loadingEl.style.display  = '';

    if (options.chunk && list.length > options.chunk) {
        _renderChunked(container, tpl, name, asVar, list, options);
    } else {
        _renderBatch(container, tpl, name, asVar, list, options.map);
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

// ─── Go-style block processor ─────────────────────────────────────────────────
// Processes {{if}}, {{range}}, {{else}}, {{end}} as a string pre-processor
// before HTML hits the DOM. Avoids fragile DOM surgery.

function _processBlocks(html, data, escape) {
    // Fast path — no Go syntax present
    if (!html.includes('{{')) return html;

    const result = _evalTemplate(html, data, escape);
    return result;
}

function _evalTemplate(src, data, escape) {
    const out    = [];
    let   i      = 0;
    const len    = src.length;

    while (i < len) {
        const open = src.indexOf('{{', i);
        if (open === -1) {
            out.push(src.slice(i));
            break;
        }

        // Static text before {{
        if (open > i) out.push(src.slice(i, open));

        const close = src.indexOf('}}', open + 2);
        if (close === -1) {
            // Unclosed — treat rest as static
            out.push(src.slice(open));
            break;
        }

        const expr = src.slice(open + 2, close).trim();
        i = close + 2;

        // ── if block ──────────────────────────────────────────────────────────
        if (expr.startsWith('if ')) {
            const negated  = expr.startsWith('if not ');
            const pathStr  = negated ? expr.slice(7).trim() : expr.slice(3).trim();
            const val      = _resolve(data, pathStr);
            const truthy   = negated ? !val : !!val;

            // Find matching {{else}} or {{end}} at same depth
            const { ifBody, elseBody, endIndex } = _extractBlock(src, i);
            i = endIndex;

            out.push(_evalTemplate(truthy ? ifBody : elseBody, data, escape));
            continue;
        }

        // ── range block ───────────────────────────────────────────────────────
        if (expr.startsWith('range ')) {
            const rangeExpr = expr.slice(6).trim();

            // {{range $h := .hosts}} or {{range .hosts}}
            let asVar  = '.';
            let pathStr = rangeExpr;
            const assignMatch = rangeExpr.match(/^\$?(\w+)\s*:=\s*(.+)$/);
            if (assignMatch) {
                asVar   = assignMatch[1];
                pathStr = assignMatch[2].trim();
            }

            const items = _resolve(data, pathStr);
            const list  = Array.isArray(items) ? items : [];

            const { ifBody: loopBody, elseBody: emptyBody, endIndex } = _extractBlock(src, i);
            i = endIndex;

            if (list.length === 0) {
                out.push(_evalTemplate(emptyBody, data, escape));
            } else {
                list.forEach((item, index) => {
                    const ctx = {
                        ...data,
                        [asVar]: item,
                        '.':     item,
                        Index:   index,
                        First:   index === 0,
                        Last:    index === list.length - 1,
                        Length:  list.length,
                    };
                    out.push(_evalTemplate(loopBody, ctx, escape));
                });
            }
            continue;
        }

        // ── variable / pipeline ───────────────────────────────────────────────
        const pipeIdx = expr.indexOf('|');
        let   rawVal;

        if (pipeIdx !== -1) {
            const pathStr = expr.slice(0, pipeIdx).trim();
            const pipes   = expr.slice(pipeIdx + 1).trim().split('|').map(s => s.trim());
            rawVal = _resolve(data, pathStr);
            for (const pipe of pipes) {
                const [name, ...args] = pipe.split(/\s+/);
                const fn = _filters.get(name);
                if (fn) rawVal = fn(rawVal, ...args);
            }
        } else {
            rawVal = _resolve(data, expr);
        }

        const str = rawVal === undefined || rawVal === null ? '' : String(rawVal);
        out.push(escape ? _esc(str) : str);
    }

    return out.join('');
}

/**
 * Extract the body between current position and matching {{end}},
 * splitting at {{else}} if present. Handles nesting correctly.
 */
function _extractBlock(src, start) {
    let depth    = 1;
    let i        = start;
    let elseAt   = -1;
    const len    = src.length;

    while (i < len) {
        const open = src.indexOf('{{', i);
        if (open === -1) break;

        const close = src.indexOf('}}', open + 2);
        if (close === -1) break;

        const expr = src.slice(open + 2, close).trim();
        i = close + 2;

        if (expr.startsWith('if ') || expr.startsWith('range ')) {
            depth++;
        } else if (expr === 'end') {
            depth--;
            if (depth === 0) {
                const body    = src.slice(start, open);
                const ifBody  = elseAt >= 0 ? src.slice(start, elseAt)    : body;
                const elseBody= elseAt >= 0 ? src.slice(elseAt + 8, open) : '';
                // 8 = length of "{{else}}"
                return { ifBody, elseBody, endIndex: i };
            }
        } else if (expr === 'else' && depth === 1) {
            elseAt = open;
        }
    }

    // Malformed — return everything as body
    return { ifBody: src.slice(start), elseBody: '', endIndex: len };
}

// ─── DOM walker ───────────────────────────────────────────────────────────────

function _walkDOM(node, data) {
    const walker = document.createTreeWalker(
        node,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        null
    );

    const nodes = [];
    let cur = walker.nextNode();
    while (cur) { nodes.push(cur); cur = walker.nextNode(); }

    for (const n of nodes) {
        if (n.nodeType === Node.TEXT_NODE) {
            if (n.textContent.includes('{{')) {
                n.textContent = render(n.textContent, data);
            }
            continue;
        }

        if (n.nodeType !== Node.ELEMENT_NODE) continue;

        // data-if
        if (n.dataset.if !== undefined) {
            n.style.display = _resolve(data, n.dataset.if) ? '' : 'none';
        }

        // data-if-not
        if (n.dataset.ifNot !== undefined) {
            n.style.display = _resolve(data, n.dataset.ifNot) ? 'none' : '';
        }

        // data-if-class="condition:class,condition2:class2"
        if (n.dataset.ifClass) {
            for (const pair of n.dataset.ifClass.split(',')) {
                const [cond, cls] = pair.trim().split(':');
                if (cond && cls) {
                    n.classList.toggle(cls.trim(), !!_resolve(data, cond.trim()));
                }
            }
        }

        // data-bind="attr:key,attr2:key2"
        if (n.dataset.bind) {
            for (const binding of n.dataset.bind.split(',')) {
                const [attr, key] = binding.trim().split(':');
                if (attr && key) {
                    const val = _resolve(data, key.trim());
                    if (val !== undefined && val !== null) {
                        n.setAttribute(attr.trim(), _esc(String(val)));
                    }
                }
            }
        }

        // Interpolate non-directive attribute values
        for (const attr of Array.from(n.attributes)) {
            if (attr.name.startsWith('data-')) continue;
            if (attr.value.includes('{{')) {
                attr.value = render(attr.value, data);
            }
        }
    }
}

// ─── Batch and chunked rendering ──────────────────────────────────────────────

function _renderBatch(container, tpl, name, asVar, list, mapFn) {
    const fragment  = document.createDocumentFragment();
    const totalLen  = list.length;

    list.forEach((item, index) => {
        const data  = mapFn ? mapFn(item, index) : item;
        const ctx   = {
            ...data,
            [asVar]: data,
            Index:  index,
            First:  index === 0,
            Last:   index === totalLen - 1,
            Length: totalLen,
        };

        // Process Go-style blocks in template HTML first
        const rawHTML   = tpl.innerHTML;
        const processed = render(rawHTML, ctx);

        const wrapper   = document.createElement('template');
        wrapper.innerHTML = processed;
        const clone     = wrapper.content.cloneNode(true);

        // data-attribute directives on cloned DOM
        _walkDOM(clone, ctx);

        Array.from(clone.children).forEach(el => {
            el.dataset.eachItem  = name;
            el.dataset.eachIndex = String(index);
        });

        fragment.appendChild(clone);
    });

    tpl.after(fragment);
}

function _renderChunked(container, tpl, name, asVar, list, options) {
    const loadingEl = container.querySelector(`[data-loading="${name}"]`);
    let index = 0;

    const next = () => {
        const slice = list.slice(index, index + options.chunk);
        if (!slice.length) {
            if (loadingEl) loadingEl.style.display = 'none';
            return;
        }
        _renderBatch(container, tpl, name, asVar, slice, options.map);
        index += options.chunk;
        requestAnimationFrame(next);
    };

    requestAnimationFrame(next);
}

// ─── Empty slot helper ────────────────────────────────────────────────────────

function _showSlot(slotEl, tpl, name, content, suffix) {
    if (slotEl) {
        slotEl.style.display = '';
        if (content) _applyContent(slotEl, content);
        return;
    }

    if (!content) return;

    // No slot in markup — inject one after the template
    const el = document.createElement('div');
    el.dataset[`eachEmpty`] = name;
    tpl.after(el);
    _applyContent(el, content);
}

function _applyContent(el, content) {
    if (typeof content === 'string') {
        el.innerHTML = content;
    } else if (content && typeof content.render === 'function') {
        // Responder instance
        content.render(el);
    }
}

// ─── Path resolution ──────────────────────────────────────────────────────────

/**
 * Resolve a dot/bracket path expression against a data object.
 *
 * Supports:
 *   user.name            → dot notation
 *   hosts[0].status      → bracket notation with array index
 *   routes[0].backends[1].url → deeply nested mixed notation
 *   .name                → leading dot stripped (Go template style)
 *
 * @param {Object} data
 * @param {string} expr
 */
function _resolve(data, expr) {
    // Remove leading dot — {{.name}} and {{name}} are equivalent
    const path = expr.replace(/^\$?\./, '');
    if (!path) return data;

    // Split on dots, opening brackets, and closing brackets: hosts[0].status -> [hosts, 0, status]
    const keys = path.split(/\.|\[|\]/).filter(Boolean);

    return keys.reduce((acc, key) => {
        if (acc === null || acc === undefined) return undefined;
        return acc[key];
    }, data);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function _esc(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function _timeAgo(ts) {
    if (!ts) return '';
    const secs = Math.floor((Date.now() - new Date(ts)) / 1000);
    if (secs < 60)    return `${secs}s ago`;
    if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    return `${Math.floor(secs / 86400)}d ago`;
}

function _formatBytes(b) {
    if (!b) return '0 B';
    const k = 1024, units = ['B','KB','MB','GB','TB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return `${(b / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

// ─── Custom filter registration ───────────────────────────────────────────────

/**
 * Register a custom filter for use in templates.
 *
 *   import { template } from '../oja/template.js';
 *   template.filter('slug', s => s.toLowerCase().replace(/\s+/g, '-'));
 *
 *   // In HTML:
 *   // {{.title | slug}}
 */
export const template = {
    filter(name, fn) {
        _filters.set(name, fn);
        return this; // chainable
    },
    filters: _filters
};