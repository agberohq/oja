/**
 * oja/theme.js
 * Tiny theme preference helper. It only manages the preference, the
 * `data-theme` attribute and the system-preference listener; colour tokens
 * stay in the app's CSS.
 *
 *   import { theme } from '@agberohq/oja';
 *
 *   theme.apply('system');       // follow prefers-color-scheme
 *   theme.toggle();              // flip the resolved light/dark
 *   theme.current();             // 'light' | 'dark'
 *   theme.mode();                // 'light' | 'dark' | 'system'
 *   const off = theme.watch(v => document.body.dataset.theme = v);
 */

const DEFAULTS = {
    storageKey: 'oja-theme',
    attr: 'data-theme',
    root: null, // defaults to document.documentElement
};

const _watchers = new Set();
let _opts = { ...DEFAULTS };
let _mql = null;
let _mqlHandler = null;

function _root() {
    return _opts.root || (typeof document !== 'undefined' ? document.documentElement : null);
}

function _storageGet() {
    try { return _opts.storageKey ? localStorage.getItem(_opts.storageKey) : null; }
    catch { return null; }
}

function _storageSet(value) {
    try {
        if (!_opts.storageKey) return;
        if (value == null) localStorage.removeItem(_opts.storageKey);
        else localStorage.setItem(_opts.storageKey, value);
    } catch { /* storage can be blocked in private mode — theme still applies */ }
}

function _systemDark() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches; }
    catch { return false; }
}

function _resolve(mode) {
    return mode === 'system' ? (_systemDark() ? 'dark' : 'light') : mode;
}

function _notify() {
    const value = theme.current();
    for (const fn of _watchers) {
        try { fn(value, theme.mode()); } catch (e) {
            console.warn('[oja/theme] watcher error:', e);
        }
    }
}

function _syncSystemListener() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    if (!_mql) {
        try { _mql = window.matchMedia('(prefers-color-scheme: dark)'); }
        catch { return; }
        _mqlHandler = () => {
            if (theme.mode() !== 'system') return;
            theme.apply('system');
        };
    }
    try {
        if (theme.mode() === 'system') _mql.addEventListener('change', _mqlHandler);
        else _mql.removeEventListener('change', _mqlHandler);
    } catch {
        // Safari < 14 uses addListener/removeListener
        try {
            if (theme.mode() === 'system') _mql.addListener(_mqlHandler);
            else _mql.removeListener(_mqlHandler);
        } catch { /* matchMedia is best-effort */ }
    }
}

export const theme = {
    /** Configure storage/attribute. Call once at boot if the defaults do not fit. */
    configure(options = {}) {
        _opts = { ...DEFAULTS, ...options };
        return this;
    },

    /** Apply 'light', 'dark' or 'system'; persists the preference. */
    apply(mode = 'system') {
        const next = ['light', 'dark', 'system'].includes(mode) ? mode : 'system';
        _storageSet(next);
        const root = _root();
        const resolved = _resolve(next);
        if (root) root.setAttribute(_opts.attr, resolved);
        _syncSystemListener();
        _notify();
        return resolved;
    },

    /** Resolved theme currently applied to the document. */
    current() {
        const root = _root();
        const attr = root?.getAttribute(_opts.attr);
        if (attr === 'light' || attr === 'dark') return attr;
        return _resolve(theme.mode());
    },

    /** Persisted preference: 'light' | 'dark' | 'system'. */
    mode() {
        const stored = _storageGet();
        return ['light', 'dark', 'system'].includes(stored) ? stored : 'system';
    },

    /** Flip the resolved theme and persist it explicitly. */
    toggle() {
        return theme.apply(theme.current() === 'dark' ? 'light' : 'dark');
    },

    /** Subscribe to resolved-theme changes. Returns an unsubscribe. */
    watch(fn) {
        if (typeof fn !== 'function') return () => {};
        _watchers.add(fn);
        return () => _watchers.delete(fn);
    },

    /** Remove listeners (useful in tests / hot reload). */
    destroy() {
        _watchers.clear();
        if (_mql && _mqlHandler) {
            try { _mql.removeEventListener('change', _mqlHandler); }
            catch { try { _mql.removeListener(_mqlHandler); } catch {} }
        }
        _mql = null;
        _mqlHandler = null;
        _opts = { ...DEFAULTS };
    },
};
