/**
 * oja/logger.js
 * Structured application-level logging.
 * Different from debug.js — logger is for APP events (works in production).
 * debug.js is for OJA INTERNALS (dev only).
 *
 * ─── Usage ────────────────────────────────────────────────────────────────────
 *
 *   import { logger } from '../oja/logger.js';
 *
 *   logger.info('auth',      'User logged in',    { userId: 42 });
 *   logger.warn('api',       'Slow response',     { ms: 1240, path: '/config' });
 *   logger.error('component','Load failed',       { url: 'hosts.html', err: e.message });
 *   logger.debug('router',   'Navigate',          { path: '/admin/hosts' });
 *
 * ─── Log levels ───────────────────────────────────────────────────────────────
 *
 *   logger.setLevel('DEBUG');  // DEBUG < INFO < WARN < ERROR < NONE
 *   logger.setLevel('ERROR');  // production — only errors logged
 *   logger.setLevel('NONE');   // silent
 *
 * ─── Forward to server ────────────────────────────────────────────────────────
 *
 *   logger.onLog((entry) => {
 *       if (entry.level === 'ERROR') {
 *           api.post('/logs', entry);   // send errors to Agbero
 *       }
 *   });
 *
 * ─── Format ───────────────────────────────────────────────────────────────────
 *
 *   Structured output with caller location (file:line):
 *   [INFO]  12:34:01.234  auth          User logged in  {userId: 42}
 *   [WARN]  12:34:01.890  api           Slow response   {ms: 1240}
 *   [ERROR] 12:34:02.001  component     Load failed     {url: 'hosts.html'}
 */


const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, NONE: 4 };

const STYLES = {
    DEBUG : 'color:#6c757d; font-weight:500',
    INFO  : 'color:#0d6efd; font-weight:500',
    WARN  : 'color:#fd7e14; font-weight:500',
    ERROR : 'color:#dc3545; font-weight:500',
};


let _level      = LEVELS.INFO;
let _handlers   = [];
let _history    = [];         // in-memory ring buffer
const MAX_HIST  = 500;


export const logger = {

    debug(component, message, data) { _log('DEBUG', component, message, data); },
    info (component, message, data) { _log('INFO',  component, message, data); },
    warn (component, message, data) { _log('WARN',  component, message, data); },
    error(component, message, data) { _log('ERROR', component, message, data); },

    /**
     * Set the minimum log level.
     * Entries below this level are silently dropped.
     *
     *   logger.setLevel('WARN');  // only WARN and ERROR printed
     */
    setLevel(levelName) {
        const n = LEVELS[levelName?.toUpperCase()];
        if (n !== undefined) _level = n;
        return this;
    },

    getLevel() {
        return Object.keys(LEVELS).find(k => LEVELS[k] === _level);
    },

    /**
     * Register a handler called for every log entry at or above the current level.
     * Use to forward errors to server, feed into debug panel, etc.
     * Returns an unsubscribe function.
     *
     *   const unsub = logger.onLog((entry) => {
     *       if (entry.level === 'ERROR') api.post('/logs', entry);
     *   });
     */
    onLog(fn) {
        _handlers.push(fn);
        return () => { _handlers = _handlers.filter(h => h !== fn); };
    },

    /**
     * Recent log entries — useful for a log panel in your UI.
     *
     *   const recent = logger.history();
     *   const errors = logger.history('ERROR');
     */
    history(levelFilter) {
        if (!levelFilter) return [..._history];
        return _history.filter(e => e.level === levelFilter.toUpperCase());
    },

    /** Clear the in-memory history */
    clearHistory() {
        _history = [];
        return this;
    },

    /** Check if a level would be logged */
    isEnabled(levelName) {
        const n = LEVELS[levelName?.toUpperCase()];
        return n !== undefined && n >= _level;
    }
};

// Set production default — only WARN and above in production
if (typeof window !== 'undefined') {
    const isDev = window.location.hostname === 'localhost'
        || window.location.hostname === '127.0.0.1'
        || window.location.hostname.endsWith('.local');
    if (!isDev) _level = LEVELS.WARN;
}


function _log(levelName, component, message, data) {
    if (LEVELS[levelName] < _level) return;

    const entry = {
        level     : levelName,
        component : component,
        message   : message,
        data      : data,
        timestamp : new Date().toISOString(),
        caller    : _getCaller(),
    };

    // Ring buffer
    _history.push(entry);
    if (_history.length > MAX_HIST) _history.shift();

    // Console output
    _print(entry);

    // Forward to registered handlers
    for (const fn of _handlers) {
        try { fn(entry); } catch {}
    }
}

function _print(entry) {
    const ts    = entry.timestamp.split('T')[1].slice(0, 12);
    const comp  = entry.component.padEnd(14);
    const style = STYLES[entry.level];

    if (entry.data !== undefined) {
        console[_consoleMethod(entry.level)](
            `%c[${entry.level.padEnd(5)}] ${ts}  ${comp}`,
            style,
            entry.message,
            entry.data
        );
    } else {
        console[_consoleMethod(entry.level)](
            `%c[${entry.level.padEnd(5)}] ${ts}  ${comp}`,
            style,
            entry.message
        );
    }
}

function _consoleMethod(level) {
    return { DEBUG: 'debug', INFO: 'info', WARN: 'warn', ERROR: 'error' }[level] || 'log';
}

function _getCaller() {
    try {
        const stack = new Error().stack?.split('\n') || [];
        for (let i = 3; i < stack.length; i++) {
            const line = stack[i];
            if (!line.includes('logger.js') && !line.includes('at _log')) {
                const match = line.match(/([^/\\]+\.js):(\d+)/);
                if (match) return `${match[1]}:${match[2]}`;
            }
        }
    } catch {}
    return '';
}