/**
 * oja/hotkeys.js
 * Command palette — fuzzy-searchable action launcher.
 *
 * Absorbs the pattern from agbero's command-palette.js into a reusable
 * Oja primitive. Uses existing keys() for the keyboard trigger and
 * renders into any container or a self-managed overlay.
 *
 * ─── Setup (once in app.js) ───────────────────────────────────────────────────
 *
 *   import { hotkeys } from '../ui/hotkeys.js';
 *
 *   hotkeys.register([
 *       { label: 'Dashboard',    action: () => router.navigate('/'),        keys: 'Ctrl+1', icon: '🏠' },
 *       { label: 'Settings',     action: () => router.navigate('/settings'),keys: 'Ctrl+,', icon: '⚙️' },
 *       { label: 'New Note',     action: () => newNote(),                   keys: 'Ctrl+N', icon: '📝' },
 *       { label: 'Search Notes', action: () => openSearch(),                           icon: '🔍' },
 *       { label: 'Dark Theme',   action: () => setTheme('dark'),            group: 'Theme' },
 *       { label: 'Light Theme',  action: () => setTheme('light'),           group: 'Theme' },
 *   ]);
 *
 *   // Ctrl+K opens the palette automatically
 *   // Or open it programmatically:
 *   hotkeys.open();
 *
 * ─── Dynamic actions ──────────────────────────────────────────────────────────
 *
 *   // Add more actions later (e.g. from a plugin)
 *   hotkeys.add({ label: 'Export PDF', action: exportPdf, icon: '📄' });
 *
 *   // Remove an action
 *   hotkeys.remove('Export PDF');
 *
 * ─── Custom trigger ───────────────────────────────────────────────────────────
 *
 *   hotkeys.register(actions, { trigger: 'ctrl+p' });   // default: 'ctrl+k'
 *
 * ─── Action shape ─────────────────────────────────────────────────────────────
 *
 *   {
 *     label  : string       — display name (required, used for search)
 *     action : () => void   — called when selected (required)
 *     keys   : string       — hint shown on the right (e.g. 'Ctrl+1')
 *     icon   : string       — emoji or short text shown on the left
 *     group  : string       — optional group heading (actions with same group are clustered)
 *     disabled : boolean    — shown but not selectable
 *   }
 */

import { keys as _keys, emit, listen } from '../core/events.js';

// State

let _actions      = [];   // all registered actions
let _overlay      = null; // the open overlay element
let _input        = null;
let _list         = null;
let _activeIdx    = 0;
let _filtered     = [];
let _closeUnsub   = null;

// Fuzzy filter

function _filter(term) {
    if (!term) return _actions.filter(a => !a.disabled);
    const t = term.toLowerCase();
    return _actions.filter(a => {
        if (a.disabled) return false;
        const label = a.label.toLowerCase();
        const group = (a.group || '').toLowerCase();
        // Substring match first, then fuzzy
        if (label.includes(t) || group.includes(t)) return true;
        // Character-order fuzzy match
        let li = 0;
        for (const ch of t) {
            li = label.indexOf(ch, li);
            if (li === -1) return false;
            li++;
        }
        return true;
    });
}

// Render

function _renderList(term) {
    if (!_list) return;
    _filtered  = _filter(term);
    _activeIdx = 0;
    _list.innerHTML = '';

    if (_filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'oja-palette-empty';
        empty.textContent = 'No matching actions';
        _list.appendChild(empty);
        return;
    }

    let lastGroup = null;

    _filtered.forEach((action, i) => {
        // Group heading
        if (action.group && action.group !== lastGroup) {
            lastGroup = action.group;
            const hdr = document.createElement('div');
            hdr.className = 'oja-palette-group';
            hdr.textContent = action.group;
            _list.appendChild(hdr);
        }

        const item = document.createElement('button');
        item.type      = 'button';
        item.className = 'oja-palette-item' + (i === 0 ? ' oja-palette-item--active' : '');
        item.dataset.idx = i;

        const left = document.createElement('span');
        left.className = 'oja-palette-item-left';
        if (action.icon) {
            const icon = document.createElement('span');
            icon.className = 'oja-palette-icon';
            icon.textContent = action.icon;
            left.appendChild(icon);
        }
        const label = document.createElement('span');
        label.className = 'oja-palette-label';
        // Highlight matching chars
        label.innerHTML = _highlight(action.label, term);
        left.appendChild(label);
        item.appendChild(left);

        if (action.keys) {
            const kbd = document.createElement('kbd');
            kbd.className = 'oja-palette-kbd';
            kbd.textContent = action.keys;
            item.appendChild(kbd);
        }

        item.addEventListener('mouseenter', () => _setActive(i));
        item.addEventListener('click', () => { hotkeys.close(); action.action?.(); });
        _list.appendChild(item);
    });
}

function _highlight(label, term) {
    if (!term) return _esc(label);
    const t = term.toLowerCase();
    const l = label.toLowerCase();
    let out = '', i = 0, li = 0;
    for (; li < l.length; li++) {
        if (i < t.length && l[li] === t[i]) {
            out += `<mark>${_esc(label[li])}</mark>`;
            i++;
        } else {
            out += _esc(label[li]);
        }
    }
    return out;
}

function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _setActive(idx) {
    _activeIdx = idx;
    if (!_list) return;
    _list.querySelectorAll('.oja-palette-item').forEach((el, i) => {
        el.classList.toggle('oja-palette-item--active', i === idx);
    });
    // Scroll into view
    const active = _list.querySelector('.oja-palette-item--active');
    active?.scrollIntoView({ block: 'nearest' });
}

// Overlay

function _buildOverlay() {

    const overlay = document.createElement('div');
    overlay.className = 'oja-palette-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Command palette');

    const box = document.createElement('div');
    box.className = 'oja-palette-box';

    const inputWrap = document.createElement('div');
    inputWrap.className = 'oja-palette-input-wrap';

    const inp = document.createElement('input');
    inp.type        = 'text';
    inp.className   = 'oja-palette-input';
    inp.placeholder = 'Search actions…';
    inp.setAttribute('autocomplete', 'off');
    inp.setAttribute('spellcheck',   'false');
    inputWrap.appendChild(inp);
    box.appendChild(inputWrap);

    const list = document.createElement('div');
    list.className   = 'oja-palette-list';
    list.setAttribute('role', 'listbox');
    box.appendChild(list);

    overlay.appendChild(box);

    // Click outside → close
    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay) hotkeys.close();
    });

    // Keyboard navigation
    inp.addEventListener('keydown', (e) => {
        const items = _filtered.filter(a => !a.disabled);
        if (!items.length) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            _setActive((_activeIdx + 1) % items.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            _setActive((_activeIdx - 1 + items.length) % items.length);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const action = items[_activeIdx];
            if (action) { hotkeys.close(); action.action?.(); }
        } else if (e.key === 'Escape') {
            hotkeys.close();
        }
    });

    inp.addEventListener('input', () => _renderList(inp.value.trim()));

    return { overlay, inp, list };
}

// Styles

// Public API

export const hotkeys = {
    /**
     * Register a list of actions and set up the keyboard trigger.
     * Safe to call multiple times — subsequent calls merge actions.
     *
     * @param {Object[]} actions
     * @param {Object}   [options]
     * @param {string}   [options.trigger='ctrl+k']
     */
    register(actions, options = {}) {
        const { trigger = 'ctrl+k' } = options;

        for (const a of actions) {
            if (!_actions.find(x => x.label === a.label)) {
                _actions.push(a);
            }
        }

        // Wire the keyboard trigger (idempotent guard via keys.isRegistered)
        if (!_keys.isRegistered(trigger)) {
            _keys({ [trigger]: () => this.open() });
        }

        return this;
    },

    /**
     * Add a single action.
     * @param {Object} action
     */
    add(action) {
        if (!_actions.find(a => a.label === action.label)) {
            _actions.push(action);
        }
        return this;
    },

    /**
     * Remove an action by label.
     * @param {string} label
     */
    remove(label) {
        _actions = _actions.filter(a => a.label !== label);
        return this;
    },

    /** Replace all actions. */
    setActions(actions) {
        _actions = [...actions];
        return this;
    },

    /** @returns {Object[]} */
    getActions() { return [..._actions]; },

    /** Open the palette. */
    open() {
        if (_overlay) { _input?.focus(); return; }

        const { overlay, inp, list } = _buildOverlay();
        _overlay = overlay;
        _input   = inp;
        _list    = list;

        document.body.appendChild(overlay);
        _renderList('');
        requestAnimationFrame(() => inp.focus());

        // Close on Escape (also handled in keydown above, belt+suspenders)
        const escHandler = (e) => { if (e.key === 'Escape') this.close(); };
        document.addEventListener('keydown', escHandler, { capture: true });
        _closeUnsub = () => document.removeEventListener('keydown', escHandler, { capture: true });

        emit('hotkeys:palette-open');
    },

    /** Close the palette. */
    close() {
        if (!_overlay) return;
        _overlay.remove();
        _overlay = null;
        _input   = null;
        _list    = null;
        _filtered = [];
        _closeUnsub?.();
        _closeUnsub = null;
        emit('hotkeys:palette-close');
    },

    /** Toggle the palette open/closed. */
    toggle() {
        _overlay ? this.close() : this.open();
    },

    /** @returns {boolean} */
    isOpen() { return _overlay !== null; },
};
