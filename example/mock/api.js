/**
 * mock/api.js
 * Fake API — intercepts fetch calls so the example works without a server.
 * Wraps window.fetch and matches paths to mock handlers.
 *
 * Endpoints:
 *   POST /login                  → JWT token
 *   GET  /api/hosts              → host list
 *   GET  /api/hosts/:id          → single host
 *   GET  /api/metrics            → live metrics
 *   GET  /api/system             → system stats (cpu, mem, goroutines)
 *   GET  /api/telemetry?host=&range=  → time-series history for perf modal
 *   GET  /api/firewall           → firewall rules
 *   POST /api/firewall           → add rule
 *   DELETE /api/firewall?ip=     → remove rule
 *   GET  /api/logs               → log entries
 *   GET  /api/settings           → server settings
 *   POST /api/settings           → save settings
 */

import {
    HOSTS, FIREWALL_RULES, LOGS, SETTINGS,
    getLiveMetrics, getLiveSystem, getTelemetryHistory
} from './data.js';

const DELAY_MIN = 40;
const DELAY_MAX = 180;

const _delay = (ms = null) =>
    new Promise(r => setTimeout(r, ms ?? DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN)));

const _json = (data, status = 200) => ({
    ok     : status >= 200 && status < 300,
    status,
    headers: { get: (h) => h === 'content-type' ? 'application/json' : null },
    text   : async () => JSON.stringify(data),
    json   : async () => data,
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(data)).buffer,
});

let _firewallRules = [...FIREWALL_RULES];

const ROUTES = [

    // ── Auth ──────────────────────────────────────────────────────────────────
    ['POST', '/login', async (body) => {
        await _delay(300);
        if (body?.username === 'admin' && body?.password === 'admin') {
            const payload = {
                sub  : '1',
                name : 'Admin User',
                roles: ['admin', 'auditor'],
                exp  : Math.floor(Date.now() / 1000) + 3600,
            };
            return _json({ token: _fakeJWT(payload) });
        }
        return _json({ error: 'Invalid credentials' }, 401);
    }],

    // ── Hosts ─────────────────────────────────────────────────────────────────
    ['GET', '/api/hosts', async () => {
        await _delay();
        return _json(HOSTS);
    }],

    ['GET', '/api/hosts/:id', async (_, params) => {
        await _delay();
        const host = HOSTS.find(h => h.id === params.id);
        return host ? _json(host) : _json({ error: 'Not found' }, 404);
    }],

    // ── Metrics ───────────────────────────────────────────────────────────────
    ['GET', '/api/metrics', async () => {
        await _delay(20);
        return _json(getLiveMetrics());
    }],

    // ── System stats (cpu, mem, goroutines) ───────────────────────────────────
    ['GET', '/api/system', async () => {
        await _delay(20);
        return _json(getLiveSystem());
    }],

    // ── Telemetry history (perf modal) ────────────────────────────────────────
    ['GET', '/api/telemetry', async (_, __, url) => {
        await _delay(80);
        const params   = new URL('http://x' + url).searchParams;
        const hostname = params.get('host')  || 'api.example.com';
        const range    = params.get('range') || '1h';
        return _json(getTelemetryHistory(hostname, range));
    }],

    // ── Firewall ──────────────────────────────────────────────────────────────
    ['GET', '/api/firewall', async () => {
        await _delay();
        return _json({ enabled: true, rules: [..._firewallRules] });
    }],

    ['POST', '/api/firewall', async (body) => {
        await _delay(200);
        const rule = { ...body, created_at: new Date().toISOString() };
        _firewallRules.unshift(rule);
        return _json({ ok: true, rule });
    }],

    ['DELETE', '/api/firewall', async (_, __, url) => {
        await _delay(150);
        const ip = new URL('http://x' + url).searchParams.get('ip');
        _firewallRules = _firewallRules.filter(r => r.ip !== ip);
        return _json({ ok: true });
    }],

    // ── Logs ──────────────────────────────────────────────────────────────────
    ['GET', '/api/logs', async () => {
        await _delay(60);
        return _json(LOGS);
    }],

    // ── Settings ──────────────────────────────────────────────────────────────
    ['GET', '/api/settings', async () => {
        await _delay();
        return _json(SETTINGS);
    }],

    ['POST', '/api/settings', async (body) => {
        await _delay(200);
        Object.assign(SETTINGS, body);
        return _json({ ok: true });
    }],
];

// ─── Fetch interceptor ────────────────────────────────────────────────────────

const _realFetch = window.fetch.bind(window);

window.fetch = async function(url, opts = {}) {
    const path   = typeof url === 'string' ? url : url.toString();
    const method = (opts.method || 'GET').toUpperCase();

    if (!path.startsWith('/api/') && path !== '/login') {
        return _realFetch(url, opts);
    }

    let body = null;
    if (opts.body) {
        try { body = JSON.parse(opts.body); } catch { body = opts.body; }
    }

    for (const [m, pattern, handler] of ROUTES) {
        if (m !== method) continue;
        const params = _matchPath(pattern, path);
        if (params !== null) {
            try {
                return await handler(body, params, path);
            } catch (e) {
                console.error('[mock/api] handler error:', e);
                return _json({ error: 'Internal error' }, 500);
            }
        }
    }

    return _json({ error: `No mock handler: ${method} ${path}` }, 404);
};

// ─── Path matching ────────────────────────────────────────────────────────────

function _matchPath(pattern, path) {
    const pp = pattern.split('/');
    const rp = path.split('?')[0].split('/');
    if (pp.length !== rp.length) return null;

    const params = {};
    for (let i = 0; i < pp.length; i++) {
        if (pp[i].startsWith(':')) {
            params[pp[i].slice(1)] = decodeURIComponent(rp[i]);
        } else if (pp[i] !== rp[i]) {
            return null;
        }
    }
    return params;
}

// ─── Fake JWT ─────────────────────────────────────────────────────────────────

function _fakeJWT(payload) {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body   = btoa(JSON.stringify(payload));
    const sig    = btoa('demo-signature');
    return `${header}.${body}.${sig}`;
}

console.info('[oja/example] Mock API active — no server required');
console.info('[oja/example] Login: username=admin  password=admin');