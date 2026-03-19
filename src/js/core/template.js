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
 * ─── Internationalization (i18n) ─────────────────────────────────────────────
 *
 *   {{t "welcome.message"}}                          → translate key
 *   {{t "user.greeting" .name}}                      → with interpolation
 *   {{t "items.count" .count | pluralize "item"}}    → with pluralization
 *   {{.count | pluralize "item"}}                     → standalone pluralize
 *
 *   // Configure in app.js
 *   template.i18n({
 *       locale: 'fr',
 *       fallback: 'en',
 *       messages: {
 *           'welcome.message': 'Bienvenue',
 *           'user.greeting': 'Bonjour, {0}',
 *           'items.count': '{0} élément(s)'
 *       },
 *       pluralize: (count, word) => count === 1 ? word : word + 's'
 *   });
 *
 * ─── API ─────────────────────────────────────────────────────────────────────
 *
 *   render(html, data)              → string: process Go-style blocks + interpolate
 *   fill(container, data)           → void:   fill already-mounted DOM element
 *   each(container, name, items, options?) → void: process data-each loop
 *   renderRaw(html, data)           → string: same as render but no XSS escaping
 *   template.filter(name, fn)       → register a custom filter
 */

let _i18n = {
    locale: 'en',
    fallback: 'en',
    messages: {},
    pluralize: (count, word, pluralForm) => {
        if (typeof pluralForm === 'string') return pluralForm;
        return count === 1 ? word : word + 's';
    },
    interpolate: (str, ...args) => {
        return str.replace(/{(\w+)}/g, (match, key) => {
            if (!isNaN(key)) {
                return args[Number(key)] !== undefined ? args[Number(key)] : match;
            }
            const data = args[0];
            if (data !== null && typeof data === 'object' && key in data) {
                return data[key] !== undefined ? data[key] : match;
            }
            return match;
        });
    }
};

const _filters = new Map([
    ['upper',   (s)       => String(s ?? '').toUpperCase()],['lower',   (s)       => String(s ?? '').toLowerCase()],['title',   (s)       => String(s ?? '').replace(/\b\w/g, l => l.toUpperCase())],['json',    (v)       => JSON.stringify(v)],['date',    (ts)      => ts ? new Date(ts).toLocaleDateString() : ''],['time',    (ts)      => ts ? new Date(ts).toLocaleTimeString() : ''],
    ['ago',     (ts)      => _timeAgo(ts)],['default', (v, dflt) => (v !== undefined && v !== null && v !== '') ? v : (dflt ?? '')],['trunc',   (s, n)    => { const str = String(s ?? ''); return str.length > n ? str.slice(0, n) + '…' : str; }],['bytes',   (n)       => _formatBytes(Number(n) || 0)],
    ['t',       (key, ...args) => _translate(key, ...args)],['pluralize', (count, word, pluralForm) => _i18n.pluralize(count, word, pluralForm)],
]);

const _cache = new Map();
const TPL_PREFIX = '__OJA_TPL_';

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
 *   empty   : string | Out        — what to show when list is empty
 *   loading : string | Out        — what to show while chunked render runs
 */
export function each(container, name, items = [], options = {}) {
    const tpl = container.querySelector(`template[data-each="${name}"]`);
    if (!tpl) {
        console.warn(`[oja/template] <template data-each="${name}"> not found`);
        return;
    }

    container.querySelectorAll(`[data-each-item="${name}"]`).forEach(el => el.remove());
    container.querySelectorAll(`[data-each-empty="${name}"]`).forEach(el => el.remove());

    const asVar     = tpl.dataset.as || 'item';
    const emptyEl   = container.querySelector(`[data-empty="${name}"]`);
    const loadingEl = container.querySelector(`[data-loading="${name}"]`);

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

export const template = {
    filter(name, fn) {
        _filters.set(name, fn);
        return this;
    },
    filters: _filters,

    i18n(config = {}) {
        _i18n = { ..._i18n, ...config };
        return this;
    },

    getI18n() {
        return { ..._i18n };
    },

    addMessages(locale, messages) {
        if (!_i18n.messages[locale]) {
            _i18n.messages[locale] = {};
        }
        Object.assign(_i18n.messages[locale], messages);
        return this;
    },

    setLocale(locale) {
        _i18n.locale = locale;
        return this;
    }
};

function _translate(key, ...args) {
    const localeMessages = _i18n.messages[_i18n.locale];
    const fallbackMessages = _i18n.messages[_i18n.fallback];

    let message = localeMessages?.[key] || fallbackMessages?.[key] || key;

    if (args.length > 0) {
        message = _i18n.interpolate(message, ...args);
    }

    return message;
}

// Processes Go-style block statements and interpolates data.
// Masks template tags to prevent premature evaluation.
function _processBlocks(html, data, escape) {
    if (!html.includes('{{')) return html;

    const templates =[];
    let maskedHtml = html;
    if (html.includes('<template')) {
        maskedHtml = html.replace(/(<template\b[^>]*>)([\s\S]*?)(<\/template>)/gi, (match, open, content, close) => {
            templates.push(content);
            return `${open}${TPL_PREFIX}${templates.length - 1}__${close}`;
        });
    }

    let processed = _evalTemplate(maskedHtml, data, escape);

    if (templates.length > 0) {
        templates.forEach((content, i) => {
            processed = processed.replace(`${TPL_PREFIX}${i}__`, () => content);
        });
    }

    return processed;
}

function _evalTemplate(src, data, escape) {
    const out    =[];
    let   i      = 0;
    const len    = src.length;

    while (i < len) {
        const open = src.indexOf('{{', i);
        if (open === -1) {
            out.push(src.slice(i));
            break;
        }

        if (open > i) out.push(src.slice(i, open));

        const close = src.indexOf('}}', open + 2);
        if (close === -1) {
            out.push(src.slice(open));
            break;
        }

        const expr = src.slice(open + 2, close).trim();
        i = close + 2;

        if (expr.startsWith('if ')) {
            const negated  = expr.startsWith('if not ');
            const pathStr  = negated ? expr.slice(7).trim() : expr.slice(3).trim();
            const val      = _resolve(data, pathStr);
            const truthy   = negated ? !val : !!val;

            const { ifBody, elseBody, endIndex } = _extractBlock(src, i);
            i = endIndex;

            out.push(_evalTemplate(truthy ? ifBody : elseBody, data, escape));
            continue;
        }

        if (expr.startsWith('range ')) {
            const rangeExpr = expr.slice(6).trim();

            let asVar  = '.';
            let pathStr = rangeExpr;
            const assignMatch = rangeExpr.match(/^\$?(\w+)\s*:=\s*(.+)$/);
            if (assignMatch) {
                asVar   = assignMatch[1];
                pathStr = assignMatch[2].trim();
            }

            const items = _resolve(data, pathStr);
            const list  = Array.isArray(items) ? items :[];

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
                        [`${asVar}_Index`]:  index,[`${asVar}_First`]:  index === 0,
                        [`${asVar}_Last`]:   index === list.length - 1,
                        [`${asVar}_Length`]: list.length,
                    };
                    out.push(_evalTemplate(loopBody, ctx, escape));
                });
            }
            continue;
        }

        const pipeIdx = expr.indexOf('|');
        let   rawVal;

        if (pipeIdx !== -1) {
            const pathStr = expr.slice(0, pipeIdx).trim();
            const pipes   = expr.slice(pipeIdx + 1).trim().split('|').map(s => s.trim());
            rawVal = _resolve(data, pathStr);
            for (const pipe of pipes) {
                const [name, ...args] = pipe.split(/\s+/);
                const fn = _filters.get(name);
                if (fn) {
                    const processedArgs = args.map(arg => {
                        if (arg.startsWith('"') && arg.endsWith('"')) {
                            return arg.slice(1, -1);
                        }
                        if (arg.startsWith("'") && arg.endsWith("'")) {
                            return arg.slice(1, -1);
                        }
                        const resolved = _resolve(data, arg);
                        return resolved !== undefined ? resolved : arg;
                    });
                    rawVal = fn(rawVal, ...processedArgs);
                }
            }
        } else {
            rawVal = _resolve(data, expr);
        }

        if (typeof rawVal === 'function' && rawVal.__isOjaSignal) {
            rawVal = rawVal();
        }

        const str = rawVal === undefined || rawVal === null ? '' : String(rawVal);
        out.push(escape ? _esc(str) : str);
    }

    return out.join('');
}

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
                return { ifBody, elseBody, endIndex: i };
            }
        } else if (expr === 'else' && depth === 1) {
            elseAt = open;
        }
    }

    return { ifBody: src.slice(start), elseBody: '', endIndex: len };
}

function _walkDOM(node, data) {
    const walker = document.createTreeWalker(
        node,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        null
    );

    const nodes =[];
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

        if (n.dataset.if !== undefined) {
            n.style.display = _resolve(data, n.dataset.if) ? '' : 'none';
        }

        if (n.dataset.ifNot !== undefined) {
            n.style.display = _resolve(data, n.dataset.ifNot) ? 'none' : '';
        }

        if (n.dataset.ifClass) {
            for (const pair of n.dataset.ifClass.split(',')) {
                const [cond, cls] = pair.trim().split(':');
                if (cond && cls) {
                    n.classList.toggle(cls.trim(), !!_resolve(data, cond.trim()));
                }
            }
        }

        if (n.dataset.bind) {
            for (const binding of n.dataset.bind.split(',')) {
                const[attr, key] = binding.trim().split(':');
                if (attr && key) {
                    const val = _resolve(data, key.trim());
                    if (val !== undefined && val !== null) {
                        n.setAttribute(attr.trim(), _esc(String(val)));
                    }
                }
            }
        }

        for (const attr of Array.from(n.attributes)) {
            if (attr.name.startsWith('data-')) continue;
            if (attr.value.includes('{{')) {
                attr.value = render(attr.value, data);
            }
        }
    }
}

function _renderBatch(container, tpl, name, asVar, list, mapFn, startIndex = 0, totalLen = list.length) {
    const fragment  = document.createDocumentFragment();

    list.forEach((item, chunkOffset) => {
        const index = startIndex + chunkOffset;
        const data  = mapFn ? mapFn(item, index) : item;
        const ctx   = {
            ...data,
            [asVar]: data,
            Index:  index,
            First:  index === 0,
            Last:   index === totalLen - 1,
            Length: totalLen,[`${asVar}_Index`]:  index,
            [`${asVar}_First`]:  index === 0,[`${asVar}_Last`]:   index === totalLen - 1,[`${asVar}_Length`]: totalLen,
        };

        const rawHTML   = tpl.innerHTML;
        const processed = render(rawHTML, ctx);

        const wrapper   = document.createElement('template');
        wrapper.innerHTML = processed;
        const clone     = wrapper.content.cloneNode(true);

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
    const totalLen  = list.length;
    let offset = 0;

    const next = () => {
        const slice = list.slice(offset, offset + options.chunk);
        if (!slice.length) {
            if (loadingEl) loadingEl.style.display = 'none';
            return;
        }
        _renderBatch(container, tpl, name, asVar, slice, options.map, offset, totalLen);
        offset += options.chunk;
        requestAnimationFrame(next);
    };

    requestAnimationFrame(next);
}

function _showSlot(slotEl, tpl, name, content, suffix) {
    if (slotEl) {
        slotEl.style.display = '';
        if (content) _applyContent(slotEl, content);
        return;
    }

    if (!content) return;

    const el = document.createElement('div');
    el.dataset[`eachEmpty`] = name;
    tpl.after(el);
    _applyContent(el, content);
}

function _applyContent(el, content) {
    if (typeof content === 'string') {
        el.innerHTML = content;
    } else if (content && typeof content.render === 'function') {
        content.render(el);
    }
}

function _resolve(data, expr) {
    const path = expr.replace(/^\$?\./, '');
    if (!path) return data;

    const keys = path.split(/\.|\[|\]/).filter(Boolean);

    return keys.reduce((acc, key) => {
        if (acc === null || acc === undefined) return undefined;
        if (key.match(/^\d+$/)) {
            const idx = parseInt(key, 10);
            return Array.isArray(acc) ? acc[idx] : undefined;
        }
        return acc[key];
    }, data);
}

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