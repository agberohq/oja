/**
 * oja/autocomplete.js
 * DOM autocomplete widget. Attaches a keyboard-navigable suggestion list to any
 * input element. Source can be a Trie, Search instance, plain array, or async fn.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { autocomplete } from '../oja/src/js/ui/autocomplete.js';
 *   import { Trie }         from '../oja/src/js/utils/search.js';
 *
 *   const trie = new Trie();
 *   trie.insertAll(['apple', 'apricot', 'banana']);
 *
 *   const handle = autocomplete.attach('#search', {
 *       source:   trie,
 *       limit:    5,
 *       onSelect: (item) => console.log('selected:', item),
 *   });
 *
 *   handle.destroy(); // remove listeners and list element
 *
 * ─── With Search (full document search) ──────────────────────────────────────
 *
 *   import { Search }       from '../oja/src/js/utils/search.js';
 *   import { autocomplete } from '../oja/src/js/ui/autocomplete.js';
 *
 *   const search = new Search(hosts, { fields: ['name', 'region'], fuzzy: true });
 *
 *   autocomplete.attach('#host-input', {
 *       source:     search,
 *       limit:      8,
 *       renderItem: (item) => {
 *           const el = document.createElement('span');
 *           el.textContent = item.doc ? item.doc.name : item;
 *           return el;
 *       },
 *       onSelect: (item) => fillForm(item.doc),
 *   });
 *
 * ─── With async source ────────────────────────────────────────────────────────
 *
 *   autocomplete.attach('#city', {
 *       source:   async (query, limit) => fetchCities(query, limit),
 *       minChars: 3,
 *   });
 *
 * ─── Custom container ─────────────────────────────────────────────────────────
 *
 *   // Pass an existing element — autocomplete will not inject its own
 *   autocomplete.attach('#input', {
 *       source:    trie,
 *       container: document.getElementById('my-dropdown'),
 *   });
 *
 * ─── Keyboard navigation ──────────────────────────────────────────────────────
 *
 *   ArrowDown / ArrowUp  — move selection
 *   Enter                — confirm selection
 *   Escape               — close
 */

import { Trie, Search } from '../utils/search.js';

const _ACTIVE_CLASS = 'oja-ac-active';

export const autocomplete = {
    /**
     * Attach autocomplete behaviour to an input element.
     * Returns a { destroy, show, hide } handle.
     *
     * @param {string|Element} input
     * @param {Object} options
     *   source     : Trie | Search | string[] | async (query, limit) => items
     *   limit      : number   Max suggestions (default: 10)
     *   minChars   : number   Min chars before triggering  (default: 1)
     *   onSelect   : function Called with the selected item
     *   renderItem : function Returns an Element for a suggestion item
     *   container  : string|Element  Existing container element (optional)
     */
    attach(input, options = {}) {
        const inputEl = _resolveEl(input);
        if (!inputEl) return null;

        const {
            source     = [],
            limit      = 10,
            minChars   = 1,
            onSelect   = null,
            renderItem = null,
            container  = null,
        } = options;

        // Build or adopt the list element
        let listEl;
        let _injected = false;

        if (container) {
            listEl = _resolveEl(container);
        } else {
            listEl = document.createElement('ul');
            listEl.className = 'oja-autocomplete-suggestions';
            listEl.setAttribute('role', 'listbox');
            // Insert immediately after the input so relative positioning works
            inputEl.insertAdjacentElement('afterend', listEl);
            _injected = true;
        }

        inputEl.setAttribute('autocomplete', 'off');
        inputEl.setAttribute('aria-autocomplete', 'list');
        inputEl.setAttribute('aria-expanded', 'false');

        let _activeIdx = -1;

        // Rendering

        function _items() {
            return Array.from(listEl.querySelectorAll('li'));
        }

        function _setActive(idx) {
            const items = _items();
            _activeIdx = Math.max(-1, Math.min(idx, items.length - 1));
            items.forEach((li, i) => {
                const active = i === _activeIdx;
                li.classList.toggle(_ACTIVE_CLASS, active);
                li.setAttribute('aria-selected', String(active));
            });
        }

        function _hide() {
            listEl.style.display = 'none';
            inputEl.setAttribute('aria-expanded', 'false');
            _activeIdx = -1;
        }

        function _show(suggestions) {
            if (!suggestions.length) { _hide(); return; }

            listEl.innerHTML = '';
            _activeIdx = -1;

            for (const item of suggestions.slice(0, limit)) {
                const li = document.createElement('li');
                li.setAttribute('role', 'option');
                li.setAttribute('aria-selected', 'false');

                if (renderItem) {
                    const content = renderItem(item);
                    if (content) li.appendChild(content);
                } else {
                    li.textContent = _itemLabel(item);
                }

                li.addEventListener('mousedown', (e) => {
                    // mousedown fires before blur — prevent hiding before click lands
                    e.preventDefault();
                    _select(item, li);
                });

                listEl.appendChild(li);
            }

            listEl.style.display = 'block';
            inputEl.setAttribute('aria-expanded', 'true');
        }

        function _select(item, li) {
            inputEl.value = _itemLabel(item);
            if (onSelect) onSelect(item);
            _hide();
        }

        // Query → suggestions

        async function _query(value) {
            if (value.length < minChars) { _hide(); return; }

            let results = [];

            if (source instanceof Search) {
                results = source.search(value, { limit });
            } else if (source instanceof Trie) {
                results = source.autocomplete(value, { limit, includeData: false });
            } else if (Array.isArray(source)) {
                const lower = value.toLowerCase();
                results = source.filter(s => String(s).toLowerCase().includes(lower));
            } else if (typeof source === 'function') {
                results = await source(value, limit);
            }

            _show(results);
        }

        // Event handlers

        function _onInput(e) {
            _query(e.target.value);
        }

        function _onKeydown(e) {
            if (listEl.style.display === 'none') return;

            const items = _items();

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                _setActive(_activeIdx + 1 < items.length ? _activeIdx + 1 : 0);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                _setActive(_activeIdx - 1 >= 0 ? _activeIdx - 1 : items.length - 1);
            } else if (e.key === 'Enter') {
                if (_activeIdx >= 0 && items[_activeIdx]) {
                    e.preventDefault();
                    items[_activeIdx].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                }
            } else if (e.key === 'Escape') {
                _hide();
            }
        }

        function _onBlur() {
            // Small delay so mousedown on a suggestion fires before blur hides list
            setTimeout(_hide, 150);
        }

        inputEl.addEventListener('input',   _onInput);
        inputEl.addEventListener('keydown', _onKeydown);
        inputEl.addEventListener('blur',    _onBlur);

        // Public handle

        return {
            destroy() {
                inputEl.removeEventListener('input',   _onInput);
                inputEl.removeEventListener('keydown', _onKeydown);
                inputEl.removeEventListener('blur',    _onBlur);
                inputEl.removeAttribute('aria-autocomplete');
                inputEl.removeAttribute('aria-expanded');
                if (_injected) listEl.remove();
            },
            show: () => { listEl.style.display = 'block'; },
            hide: _hide,
        };
    },
};

// Resolve a CSS selector string or Element to an Element.
function _resolveEl(target) {
    if (!target) return null;
    if (typeof target === 'string') return document.querySelector(target);
    return target;
}

// Extract a display string from whatever the source returns.
function _itemLabel(item) {
    if (typeof item === 'string') return item;
    if (item?.doc?.name)  return item.doc.name;
    if (item?.key)        return item.key;
    if (item?.value)      return item.value;
    if (item?.label)      return item.label;
    return String(item);
}
