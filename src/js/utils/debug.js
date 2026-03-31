/**
 * oja/debug.js
 * Oja framework internals tracing — development tool only.
 * Different from logger.js — debug traces OJA actions, logger tracks APP events.
 *
 * Zero overhead when disabled — all calls are no-ops in production.
 *
 * ─── Usage ────────────────────────────────────────────────────────────────────
 *
 *   import { debug } from '../oja/debug.js';
 *
 *   // Enable in app.js during development
 *   debug.enable('*');             // all modules
 *   debug.enable('router,api');    // selective
 *   debug.enable('component:*');   // one module
 *
 *   // Manual logging from app code
 *   debug.log('hosts', 'rendered', { count: 50 });
 *   debug.warn('hosts', 'slow render', { ms: 340 });
 *
 *   // Dump timeline to console
 *   debug.dump();
 *
 *   // Export for sharing / filing issues
 *   const log = debug.export();
 *   console.log(JSON.stringify(log, null, 2));
 *
 * ─── Timeline output ─────────────────────────────────────────────────────────
 *
 *   [12:34:01.234] router    → navigate    /admin/hosts
 *   [12:34:01.251] api       → GET         /config              17ms
 *   [12:34:01.252] component → mount       hosts.html
 *   [12:34:01.267] template  → each        hosts                50 items
 *   [12:34:01.289] reactive  → effect      ran
 *   [12:34:01.890] component → mount       firewall.html        ⚠️ 340ms
 *
 * ─── Oja internal hook ───────────────────────────────────────────────────────
 *
 *   Every Oja file calls debug internally:
 *     import { debug } from './debug.js';
 *     debug.log('router', 'navigate', { path });
 *
 *   App code can call it too — useful for tracing page logic.
 */


let _enabled    = new Set();   // active namespace patterns
let _all        = false;       // '*' wildcard
let _timeline   = [];          // { ts, ns, action, data, ms, warn }
const MAX_ENTRIES = 1000;

const SLOW_THRESHOLD_MS = 200;


export const debug = {

    /**
     * Enable debug output for specific namespaces.
     *
     *   debug.enable('*')             → everything
     *   debug.enable('router,api')    → router and api only
     *   debug.enable('component')     → component module only
     */
    enable(namespaces = '*') {
        if (namespaces === '*') {
            _all = true;
        } else {
            namespaces.split(',').forEach(ns => _enabled.add(ns.trim()));
        }
        return this;
    },

    disable() {
        _all     = false;
        _enabled.clear();
        return this;
    },

    isEnabled(ns) {
        return _all || _enabled.has(ns);
    },

    // ─── Logging ──────────────────────────────────────────────────────────────

    /**
     * Log a framework action.
     * Called internally by every Oja module.
     *
     *   debug.log('router', 'navigate', { path: '/hosts' });
     *   debug.log('api', 'GET', { path: '/config', ms: 17 });
     */
    log(ns, action, data) {
        if (!_all && !_enabled.has(ns)) return;
        _record(ns, action, data, false);
    },

    warn(ns, action, data) {
        if (!_all && !_enabled.has(ns)) return;
        _record(ns, action, data, true);
    },

    /** Start a timer — returns a function that logs the elapsed time */
    time(ns, action) {
        const start = performance.now();
        return (data = {}) => {
            const ms = Math.round(performance.now() - start);
            const isWarn = ms > SLOW_THRESHOLD_MS;
            _record(ns, action, { ...data, ms }, isWarn);
        };
    },

    // ─── Timeline ─────────────────────────────────────────────────────────────

    /**
     * Print the full timeline to the console in a readable format.
     */
    dump() {
        if (_timeline.length === 0) {
            console.info('[oja/debug] No entries. Call debug.enable("*") first.');
            return;
        }

        console.group('[oja/debug] Timeline');
        for (const entry of _timeline) {
            const ts     = entry.ts;
            const ns     = entry.ns.padEnd(10);
            const action = entry.action.padEnd(12);
            const slow   = entry.warn ? ' ⚠️' : '';
            const ms     = entry.data?.ms !== undefined ? ` ${entry.data.ms}ms` : '';
            const extra  = _summarise(entry.data);

            const style  = entry.warn
                ? 'color: #fd7e14; font-weight: 500'
                : 'color: #6c757d';

            console.log(
                `%c[${ts}] ${ns} → ${action}${ms}${slow}`,
                style,
                extra ? extra : ''
            );
        }
        console.groupEnd();
    },

    /**
     * Export the timeline as a structured array.
     * Use for copying to a bug report or sending to a server.
     */
    export() {
        return {
            exported  : new Date().toISOString(),
            entries   : [..._timeline],
            userAgent : typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
            url       : typeof window    !== 'undefined' ? window.location.href : 'unknown',
        };
    },

    /** Clear the timeline */
    clear() {
        _timeline = [];
        return this;
    },

    /** Raw timeline array */
    entries() {
        return [..._timeline];
    }
};


function _record(ns, action, data, warn) {
    const now = new Date();
    const ts  = now.toTimeString().slice(0, 8) + '.' + String(now.getMilliseconds()).padStart(3, '0');

    const entry = { ts, ns, action, data: data || {}, warn };
    _timeline.push(entry);
    if (_timeline.length > MAX_ENTRIES) _timeline.shift();

    // Live console output when enabled
    const style = warn
        ? 'color:#fd7e14; font-weight:500'
        : 'color:#6c757d';

    const ms    = data?.ms !== undefined ? ` ${data.ms}ms` : '';
    const slow  = warn ? ' ⚠️' : '';
    const extra = _summarise(data);

    console.debug(
        `%c[oja:${ns}] ${action}${ms}${slow}`,
        style,
        extra ? extra : ''
    );
}

function _summarise(data) {
    if (!data || typeof data !== 'object') return '';
    const keys = Object.keys(data).filter(k => k !== 'ms');
    if (!keys.length) return '';
    return keys.map(k => `${k}=${JSON.stringify(data[k])}`).join(' ');
}