/**
 * oja/select.js
 * Searchable select — replaces native <select> with a keyboard-navigable
 * dropdown that supports search, multi-select, option groups, async loading,
 * and custom rendering. Works with any data shape.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { select } from '../ui/select.js';
 *
 *   const s = select.attach('#roleField', [
 *       { value: 'admin',  label: 'Administrator' },
 *       { value: 'editor', label: 'Editor'        },
 *       { value: 'viewer', label: 'Viewer'        },
 *   ], {
 *       placeholder: 'Choose a role…',
 *       onSelect: (item) => console.log(item.value),
 *   });
 *
 *   s.getValue();       // → 'admin'
 *   s.setValue('editor');
 *   s.setOptions([...]);
 *   s.disable();
 *   s.destroy();
 *
 * ─── Multi-select ─────────────────────────────────────────────────────────────
 *
 *   const s = select.attach('#tagsField', options, {
 *       multi:       true,
 *       placeholder: 'Add tags…',
 *       onSelect:    (items) => console.log(items.map(i => i.value)),
 *   });
 *
 *   s.getValues();        // → ['tag1', 'tag2']
 *   s.setValues(['tag1']);
 *
 * ─── Option groups ────────────────────────────────────────────────────────────
 *
 *   select.attach('#regionField', [
 *       { group: 'West Africa',  options: [{ value: 'ng', label: 'Nigeria' }, ...] },
 *       { group: 'East Africa',  options: [{ value: 'ke', label: 'Kenya'   }, ...] },
 *   ], { placeholder: 'Select region…' });
 *
 * ─── Async source ─────────────────────────────────────────────────────────────
 *
 *   select.attach('#secretField', [], {
 *       source: async (query) => {
 *           const secrets = await api.get('/keeper/list');
 *           return secrets.filter(s => s.name.includes(query))
 *                         .map(s => ({ value: s.key, label: s.name }));
 *       },
 *       minChars:    0,           // load immediately on open
 *       placeholder: 'Choose secret…',
 *   });
 *
 * ─── Option shape ─────────────────────────────────────────────────────────────
 *
 *   { value: any, label: string, disabled?: boolean, meta?: string }
 *
 * ─── attach() options ─────────────────────────────────────────────────────────
 *
 *   placeholder : string
 *   multi       : boolean          — allow multiple selections (default: false)
 *   searchable  : boolean          — show filter input (default: true)
 *   clearable   : boolean          — show × to clear selection (default: false)
 *   disabled    : boolean
 *   source      : async (query) => Option[]  — replaces static options
 *   minChars    : number           — chars before source is called (default: 0)
 *   maxItems    : number           — max visible items (default: 200)
 *   onSelect    : fn(item|items)   — fired on selection change
 *   renderOption: fn(option) → Element  — custom option rendering
 *   value       : any              — initial value (or array for multi)
 */

function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _resolve(target) {
    if (!target) return null;
    if (target instanceof Element) return target;
    return document.querySelector(target);
}

export const select = {
    /**
     * @param {string|Element} target  — element to replace or attach next to
     * @param {Object[]}       options — option list (or grouped list)
     * @param {Object}         opts    — configuration
     * @returns {selectHandle}
     */
    attach(target, options = [], opts = {}) {
        const anchor = _resolve(target);
        if (!anchor) { console.warn('[oja/select] target not found:', target); return null; }

        const {
            placeholder  = 'Select…',
            multi        = false,
            searchable   = true,
            clearable    = false,
            disabled     = false,
            source       = null,   // async (query) => options
            minChars     = 0,
            maxItems     = 200,
            onSelect     = null,
            renderOption = null,
            value: initVal = multi ? [] : null,
        } = opts;

        // State
        let _options    = options;      // flat or grouped
        let _selected   = multi
            ? (Array.isArray(initVal) ? [...initVal] : initVal ? [initVal] : [])
            : initVal;
        let _open       = false;
        let _query      = '';
        let _activeIdx  = 0;
        let _loading    = false;
        let _srcTimer   = null;

        // DOM
        const wrap = document.createElement('div');
        wrap.className = `oja-select${disabled ? ' disabled' : ''}`;
        anchor.insertAdjacentElement('afterend', wrap);
        if (anchor.tagName === 'SELECT' || anchor.tagName === 'INPUT') {
            anchor.style.display = 'none';
        }

        // Trigger button
        const trigger = document.createElement('div');
        trigger.className  = 'oja-select-trigger' + (disabled ? ' disabled' : '');
        trigger.tabIndex   = disabled ? -1 : 0;
        trigger.setAttribute('role', 'combobox');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-haspopup', 'listbox');

        const valueEl = document.createElement('div');
        valueEl.className = 'oja-select-value';

        const iconsEl = document.createElement('div');
        iconsEl.className = 'oja-select-icons';

        let clearBtn = null;
        if (clearable) {
            clearBtn = document.createElement('span');
            clearBtn.className = 'oja-select-clear';
            clearBtn.textContent = '×';
            clearBtn.title = 'Clear selection';
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                _selected = multi ? [] : null;
                _render();
                onSelect?.(multi ? [] : null);
                _syncAnchor();
            });
            iconsEl.appendChild(clearBtn);
        }

        const arrow = document.createElement('span');
        arrow.className = 'oja-select-arrow';
        arrow.innerHTML = '&#9660;'; // ▼
        iconsEl.appendChild(arrow);

        trigger.appendChild(valueEl);
        trigger.appendChild(iconsEl);
        wrap.appendChild(trigger);

        // Dropdown
        let dropdown = null;
        let searchInput = null;
        let listEl = null;

        // Helpers

        function _flatOptions(opts, query) {
            const q = query?.toLowerCase() || '';
            const flat = [];

            const addOption = (opt, groupLabel) => {
                if (opt.disabled) { flat.push({ ...opt, _group: groupLabel }); return; }
                if (q && !opt.label.toLowerCase().includes(q)) return;
                flat.push({ ...opt, _group: groupLabel });
            };

            for (const o of opts) {
                if (o.group) {
                    const sub = (o.options || []).filter(so => !q || so.label.toLowerCase().includes(q));
                    if (sub.length) sub.forEach(so => addOption(so, o.group));
                } else {
                    addOption(o, null);
                }
            }
            return flat.slice(0, maxItems);
        }

        function _isSelected(value) {
            if (multi) return Array.isArray(_selected) && _selected.includes(value);
            return _selected === value || (value !== null && value !== undefined && String(_selected) === String(value));
        }

        function _getLabelFor(value) {
            const all = _allFlat();
            const found = all.find(o => o.value === value || String(o.value) === String(value));
            return found?.label ?? String(value ?? '');
        }

        function _allFlat() {
            const flat = [];
            for (const o of _options) {
                if (o.group) (o.options || []).forEach(so => flat.push(so));
                else flat.push(o);
            }
            return flat;
        }

        // Render trigger display

        function _render() {
            if (clearBtn) clearBtn.style.display = (multi ? _selected.length : _selected !== null) ? '' : 'none';

            if (multi) {
                if (!_selected.length) {
                    valueEl.innerHTML = `<span class="oja-select-placeholder">${_esc(placeholder)}</span>`;
                } else {
                    valueEl.innerHTML = '';
                    for (const v of _selected) {
                        const tag = document.createElement('span');
                        tag.className = 'oja-select-tag';
                        tag.innerHTML = `${_esc(_getLabelFor(v))}<span class="oja-select-tag-remove" data-val="${_esc(String(v))}">×</span>`;
                        valueEl.appendChild(tag);
                    }
                }
            } else {
                if (_selected === null || _selected === undefined) {
                    valueEl.innerHTML = `<span class="oja-select-placeholder">${_esc(placeholder)}</span>`;
                } else {
                    valueEl.textContent = _getLabelFor(_selected);
                }
            }
        }

        // Render list

        function _renderList(items) {
            if (!listEl) return;
            listEl.innerHTML = '';
            _activeIdx = 0;

            if (_loading) {
                listEl.innerHTML = `<div class="oja-select-loading">Loading…</div>`;
                return;
            }
            if (!items.length) {
                listEl.innerHTML = `<div class="oja-select-empty">No options</div>`;
                return;
            }

            let lastGroup = null;
            items.forEach((opt, i) => {
                if (opt._group && opt._group !== lastGroup) {
                    lastGroup = opt._group;
                    const hdr = document.createElement('div');
                    hdr.className = 'oja-select-group-label';
                    hdr.textContent = opt._group;
                    listEl.appendChild(hdr);
                }

                const item = document.createElement('div');
                item.className = [
                    'oja-select-option',
                    _isSelected(opt.value) ? 'selected' : '',
                    opt.disabled ? 'disabled' : '',
                ].filter(Boolean).join(' ');
                item.dataset.idx = i;

                if (renderOption) {
                    const custom = renderOption(opt);
                    if (custom instanceof Element) { item.appendChild(custom); }
                    else item.innerHTML = custom;
                } else {
                    const left = document.createElement('span');
                    left.innerHTML = _esc(opt.label);
                    if (opt.meta) {
                        left.innerHTML += ` <span class="oja-select-option-meta">${_esc(opt.meta)}</span>`;
                    }
                    item.appendChild(left);
                    const check = document.createElement('span');
                    check.className = 'oja-select-check';
                    check.textContent = '✓';
                    item.appendChild(check);
                }

                item.addEventListener('mouseenter', () => _setActive(i));
                item.addEventListener('click', () => _pick(opt));
                listEl.appendChild(item);
            });
        }

        function _setActive(idx) {
            _activeIdx = idx;
            if (!listEl) return;
            listEl.querySelectorAll('.oja-select-option').forEach((el, i) => {
                el.classList.toggle('active', i === idx);
            });
            listEl.querySelector('.oja-select-option.active')?.scrollIntoView({ block: 'nearest' });
        }

        // Pick

        function _pick(opt) {
            if (opt.disabled) return;
            if (multi) {
                const idx = (_selected || []).indexOf(opt.value);
                if (idx === -1) _selected = [...(_selected || []), opt.value];
                else            _selected = _selected.filter(v => v !== opt.value);
                onSelect?.(_allFlat().filter(o => (_selected || []).includes(o.value)));
                _refreshList();
            } else {
                _selected = opt.value;
                onSelect?.(opt);
                handle.close();
            }
            _render();
            _syncAnchor();
        }

        // Source loading

        async function _loadSource(query) {
            if (!source) return _flatOptions(_options, query);
            if (query.length < minChars) return [];
            _loading = true;
            _renderList([]);
            try {
                const raw = await source(query);
                _options = raw || [];
                return _flatOptions(_options, '');
            } catch (e) {
                console.warn('[oja/select] source error:', e);
                return [];
            } finally {
                _loading = false;
            }
        }

        function _refreshList() {
            const items = _flatOptions(_options, _query);
            _renderList(items);
        }

        // Open / close

        // Declare handle early — _pick() references handle.close() before the
        // original declaration, causing a TDZ ReferenceError in strict mode.
        const handle = {
            open:    null, // assigned below
            close:   null, // assigned below
            getValue()  { return _selected; },
            getValues() { return Array.isArray(_selected) ? [..._selected] : _selected !== null ? [_selected] : []; },
            setValue(value) { _selected = value; _render(); _syncAnchor(); },
            setValues(values) { _selected = [...values]; _render(); _syncAnchor(); },
            setOptions(newOptions) { _options = newOptions; if (_open) _refreshList(); _render(); },
            clear() { _selected = multi ? [] : null; _render(); _syncAnchor(); },
            disable() { trigger.classList.add('disabled'); trigger.tabIndex = -1; },
            enable()  { trigger.classList.remove('disabled'); trigger.tabIndex = 0; },
            destroy() { handle.close(); wrap.remove(); if (anchor.tagName === 'SELECT' || anchor.tagName === 'INPUT') anchor.style.display = ''; },
            el: wrap,
        };

        handle.open = async function() {
            if (_open || disabled) return;
            _open = true;
            wrap.classList.add('open');
            trigger.setAttribute('aria-expanded', 'true');

            dropdown = document.createElement('div');
            dropdown.className = 'oja-select-dropdown';

            if (searchable) {
                const sw = document.createElement('div');
                sw.className = 'oja-select-search';
                searchInput = document.createElement('input');
                searchInput.type = 'text';
                searchInput.placeholder = 'Search…';
                searchInput.setAttribute('autocomplete', 'off');
                sw.appendChild(searchInput);
                dropdown.appendChild(sw);
            }

            listEl = document.createElement('div');
            listEl.className = 'oja-select-list';
            listEl.setAttribute('role', 'listbox');
            dropdown.appendChild(listEl);
            wrap.appendChild(dropdown);

            // Load initial items
            let items;
            if (source) {
                items = await _loadSource('');
            } else {
                items = _flatOptions(_options, '');
            }
            _renderList(items);

            if (searchInput) {
                searchInput.focus();
                searchInput.addEventListener('input', async () => {
                    _query = searchInput.value.trim();
                    clearTimeout(_srcTimer);
                    if (source) {
                        _srcTimer = setTimeout(async () => {
                            const r = await _loadSource(_query);
                            _renderList(r);
                        }, 200);
                    } else {
                        _renderList(_flatOptions(_options, _query));
                    }
                });
                searchInput.addEventListener('keydown', _onKeydown);
            } else {
                trigger.addEventListener('keydown', _onKeydown);
            }

            // Close on outside click
            setTimeout(() => {
                document.addEventListener('mousedown', _onOutside, { capture: true });
            }, 0);
        };

        handle.close = function() {
            if (!_open) return;
            _open = false;
            wrap.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
            dropdown?.remove();
            dropdown = null;
            searchInput = null;
            listEl = null;
            _query = '';
            document.removeEventListener('mousedown', _onOutside, { capture: true });
        };

        function _onOutside(e) {
            if (!wrap.contains(e.target)) handle.close();
        }

        function _onKeydown(e) {
            const items = listEl?.querySelectorAll('.oja-select-option:not(.disabled)') || [];
            const count = items.length;
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                _setActive((_activeIdx + 1) % count);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                _setActive((_activeIdx - 1 + count) % count);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const flat = _flatOptions(_options, _query).filter(o => !o.disabled);
                if (flat[_activeIdx]) _pick(flat[_activeIdx]);
            } else if (e.key === 'Escape') {
                handle.close();
            }
        }

        // Multi tag removal via event delegation
        valueEl.addEventListener('click', (e) => {
            const rem = e.target.closest('.oja-select-tag-remove');
            if (rem) {
                e.stopPropagation();
                const val = rem.dataset.val;
                _selected = (_selected || []).filter(v => String(v) !== val);
                _render();
                onSelect?.(_allFlat().filter(o => (_selected || []).includes(o.value)));
                _syncAnchor();
            }
        });

        trigger.addEventListener('click', () => {
            if (disabled) return;
            _open ? handle.close() : handle.open();
        });
        trigger.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handle.open(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); handle.open(); }
            else if (e.key === 'Escape') handle.close();
        });

        function _syncAnchor() {
            if (anchor.tagName === 'SELECT') {
                const vals = multi ? (_selected || []).map(String) : [String(_selected ?? '')];
                for (const opt of anchor.options) {
                    opt.selected = vals.includes(opt.value);
                }
                anchor.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (anchor.tagName === 'INPUT') {
                anchor.value = multi
                    ? (_selected || []).join(',')
                    : String(_selected ?? '');
                anchor.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }


        _render();
        return handle;
    },
};
