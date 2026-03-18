/**
 * app.js — Oja example application entry point
 *
 * Demonstrates everything Oja provides:
 *   - Router with Go-style groups and middleware
 *   - Auth levels + encrypted session lifecycle
 *   - Api instance with request/response hooks
 *   - Global context() for cross-component state
 *   - Keyboard shortcuts via keys()
 *   - Adapter registration
 *   - Debug + logger
 *   - Sys-bar live updates
 *
 * Notice: no rendering code here — only wiring.
 * All HTML lives in pages/*.html and components/*.html
 */

// ── Mock API first — intercepts fetch before anything else ────────────────────
import './mock/api.js';

// ── Oja imports ───────────────────────────────────────────────────────────────
import { Router }            from '../src/js/router.js';
import { Responder }         from '../src/js/responder.js';
import { auth }              from '../src/js/auth.js';
import { Api }               from '../src/js/api.js';
import { notify }            from '../src/js/notify.js';
import { modal }             from '../src/js/modal.js';
import { component }         from '../src/js/component.js';
import { logger }            from '../src/js/logger.js';
import { debug }             from '../src/js/debug.js';
import { adapter }           from '../src/js/adapter.js';
import { Store }             from '../src/js/store.js';
import { context, effect }   from '../src/js/reactive.js';
import { on, listen, keys }  from '../src/js/events.js';

// ── Debug ─────────────────────────────────────────────────────────────────────
debug.enable('router,auth,api');
window._debug = debug;

// ── Logger ────────────────────────────────────────────────────────────────────
logger.setLevel('DEBUG');

// ── Stores ────────────────────────────────────────────────────────────────────
export const store  = new Store('oja-example');
export const secure = new Store('oja-example-secure', { encrypt: true });

// ── Global context — cross-component reactive state ───────────────────────────
// Any page script can call context('isOnline') and get the same live value.
export const [isOnline,    setOnline]    = context('isOnline',    true);
export const [sysStats,    setSysStats]  = context('sysStats',    null);
export const [totalReqs,   setTotalReqs] = context('totalReqs',   0);
export const [totalErrors, setErrors]    = context('totalErrors', 0);
export const [rps,         setRps]       = context('rps',         0);
export const [avgP99,      setAvgP99]    = context('avgP99',      0);
export const [activeBackends, setActiveBackends] = context('activeBackends', 0);

// ── API client ────────────────────────────────────────────────────────────────
export const api = new Api({ base: '' });

api.beforeRequest((path, method) => {
    logger.debug('api', `${method} ${path}`);
});
api.afterResponse((path, method, res, ms) => {
    if (ms > 300) logger.warn('api', `Slow: ${method} ${path}`, { ms });
    else          logger.debug('api', `${method} ${path} → ${res?.status}`, { ms });
});
api.onOffline(() => {
    setOnline(false);
    notify.banner('⚠️ Connection lost. Reconnecting...', { type: 'warn' });
    logger.warn('api', 'Connection lost');
});
api.onOnline(() => {
    setOnline(true);
    notify.dismissBanner();
    notify.success('Reconnected');
    logger.info('api', 'Connection restored');
});

// ── Adapter — SVG sparkline chart (no D3 needed for the example) ──────────────
adapter.register('chart', {
    /**
     * Draw a simple SVG sparkline into a container element.
     * Used by dashboard p99 chart and perf modal.
     *
     * @param {Element} el    — container element (will be filled with <svg>)
     * @param {number[]} data — data points
     * @param {Object}  opts  — { color, label, unit, minY, maxY }
     */
    draw(el, data, opts = {}) {
        if (!el || !data?.length) return;

        const w      = el.clientWidth  || 800;
        const h      = el.clientHeight || 120;
        const color  = opts.color || 'var(--accent)';
        const pad    = { t: 16, r: 8, b: 20, l: 36 };
        const iw     = w - pad.l - pad.r;
        const ih     = h - pad.t - pad.b;

        const minV = opts.minY ?? Math.min(...data);
        const maxV = opts.maxY ?? Math.max(...data, minV + 1);
        const xS   = (i) => pad.l + (i / (data.length - 1)) * iw;
        const yS   = (v) => pad.t + ih - ((v - minV) / (maxV - minV)) * ih;

        const pts  = data.map((v, i) => `${xS(i).toFixed(1)},${yS(v).toFixed(1)}`).join(' ');
        const area = `${pad.l},${pad.t + ih} ` + pts + ` ${xS(data.length - 1)},${pad.t + ih}`;

        // Y-axis ticks
        const yticks = [minV, (minV + maxV) / 2, maxV].map(v => ({
            y: yS(v),
            l: opts.unit ? `${Math.round(v)}${opts.unit}` : String(Math.round(v))
        }));

        el.innerHTML = `
        <svg width="100%" height="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"
             xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="cg-${color.replace(/[^a-z]/gi,'')}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stop-color="${color}" stop-opacity="0.18"/>
                    <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
                </linearGradient>
            </defs>
            <polygon points="${area}"
                fill="url(#cg-${color.replace(/[^a-z]/gi,'')})" />
            <polyline points="${pts}"
                fill="none" stroke="${color}" stroke-width="1.5"
                stroke-linejoin="round" stroke-linecap="round"/>
            <circle cx="${xS(data.length-1).toFixed(1)}" cy="${yS(data[data.length-1]).toFixed(1)}"
                r="3" fill="${color}" stroke="var(--bg)" stroke-width="1.5"/>
            ${yticks.map(t =>
            `<text x="${pad.l - 4}" y="${(t.y + 3.5).toFixed(1)}"
                    font-size="9" font-family="monospace"
                    fill="var(--text-mute)" text-anchor="end">${t.l}</text>`
        ).join('')}
            ${opts.label ? `<text x="${pad.l}" y="11"
                font-size="9" font-family="monospace"
                fill="var(--text-mute)">${opts.label}</text>` : ''}
        </svg>`;
    },

    // Canvas variant — kept for backward compat with dashboard.html canvas element
    drawCanvas(canvas, data, opts = {}) {
        if (!canvas) return;
        const ctx  = canvas.getContext('2d');
        const w    = canvas.width;
        const h    = canvas.height;
        const max  = Math.max(...data, 1);
        const barW = (w / data.length) - 1;
        ctx.clearRect(0, 0, w, h);
        data.forEach((val, i) => {
            const barH = (val / max) * (h - 16);
            const pct  = val / max;
            ctx.fillStyle = pct > 0.8 ? '#e74c3c' : pct > 0.5 ? '#f39c12' : '#2ecc71';
            ctx.fillRect(i * (barW + 1), h - barH, barW, barH);
        });
        if (opts.label) {
            ctx.fillStyle = 'var(--text-mute, #888)';
            ctx.font      = '10px monospace';
            ctx.fillText(opts.label, 4, 12);
        }
    }
});
logger.info('app', 'Adapter registered: chart');

// ── Auth setup ────────────────────────────────────────────────────────────────
// Declare auth levels BEFORE router — router.Group() captures these by reference
auth.level('protected', () => auth.session.isActive());
auth.level('admin',     () => auth.session.isActive() && auth.hasRole('admin'));
auth.level('auditor',   () => auth.session.isActive() && auth.hasRole('auditor'));

// ── Router — declared BEFORE auth.session.OnStart ─────────────────────────────
// OnStart references router, so router must exist when the hook fires.
export const router = new Router({
    mode    : 'hash',
    outlet  : '#app',
    loading : Responder.html(`
        <div class="page-loading">
            <svg class="oja-spinner" viewBox="0 0 24 24" fill="none" width="24" height="24">
                <path d="M12 2V6M12 18V22M4.93 4.93L7.76 7.76M16.24 16.24L19.07 19.07
                         M2 12H6M18 12H22M4.93 19.07L7.76 16.24M16.24 7.76L19.07 4.93"
                      stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
            </svg>
        </div>
    `)
});

// ── Auth session hooks ────────────────────────────────────────────────────────
auth.session.OnStart(async (token) => {
    api.setToken(token);
    const user = auth.session.user();
    const navUser = document.getElementById('nav-user');
    if (navUser) navUser.textContent = user?.name || 'User';
    document.getElementById('navbar').style.display = '';
    logger.info('auth', 'Session started', { user: user?.name });

    // Start sys-bar polling
    _startSysBarPoll();

    // Navigate to intended page or dashboard
    const dest = auth.session.intendedPath() || '/dashboard';
    auth.session.clearIntendedPath();
    router.navigate(dest);
});

auth.session.OnRenew((newToken) => {
    api.setToken(newToken);
    notify.info('Session renewed');
    logger.info('auth', 'Session renewed');
});

auth.session.OnExpiry(() => {
    document.getElementById('navbar').style.display = 'none';
    _stopSysBarPoll();
    notify.warn('Session expired — please sign in again');
    logger.warn('auth', 'Session expired');
    router.navigate('/login');
});

// ── Router middleware ─────────────────────────────────────────────────────────
router.Use(async (ctx, next) => {
    const t = Date.now();
    await next();
    logger.debug('router', `${ctx.path}`, { ms: Date.now() - t });
});

router.Use(Router.middleware.errorBoundary(
    Responder.html('<div class="error-page"><div class="error-code">Error</div><p class="error-msg">Something went wrong. Try refreshing.</p></div>')
));

router.afterEach(Router.middleware.pageTitle('Oja · Agbero'));
router.afterEach(Router.middleware.scrollTop);

// ── Routes ────────────────────────────────────────────────────────────────────
router.Get('/login', Responder.component('pages/login.html'));

const app = router.Group('/');
app.Use(auth.middleware('protected', '/login'));

app.Get('dashboard', Responder.component('pages/dashboard.html'));
app.Get('firewall',  Responder.component('pages/firewall.html'));
app.Get('logs',      Responder.component('pages/logs.html'));
app.Get('settings',  Responder.component('pages/settings.html'));

app.Route('hosts', hosts => {
    hosts.Get('/', Responder.component('pages/hosts.html'));

    hosts.Route('{id}', host => {
        host.Use(async (ctx, next) => {
            ctx.host = await api.get(`/api/hosts/${ctx.params.id}`);
            if (!ctx.host) return ctx.redirect('/hosts');
            await next();
        });
        host.Get('/', Responder.fn(async (container, ctx) =>
            Responder.component('pages/host-detail.html', ctx.host)
        ));
    });
});

router.NotFound(Responder.html(`
    <div class="error-page">
        <div class="error-code">404</div>
        <p class="error-msg">Page not found</p>
        <a href="#/dashboard" class="btn-primary">Dashboard</a>
    </div>
`));

// ── UI bindings ───────────────────────────────────────────────────────────────
on('#logout-btn', 'click', async () => {
    const ok = await modal.confirm('Sign out?');
    if (!ok) return;
    await auth.session.end();
    api.clearAuth();
    _stopSysBarPoll();
    document.getElementById('navbar').style.display = 'none';
    notify.info('Signed out');
    router.navigate('/login');
});

on('#debug-btn', 'click', () => {
    debug.dump();
    notify.info('Debug timeline → console');
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
keys({
    'ctrl+1' : () => router.navigate('/dashboard'),
    'ctrl+2' : () => router.navigate('/hosts'),
    'ctrl+3' : () => router.navigate('/firewall'),
    'ctrl+4' : () => router.navigate('/logs'),
    'ctrl+5' : () => router.navigate('/settings'),
    'escape' : () => modal.closeAll(),
    'r'      : () => router.refresh(),
    '/'      : () => document.getElementById('host-search')?.focus(),
    '?'      : () => notify.info('Ctrl+1–5: Navigate  ·  r: Refresh  ·  /: Search  ·  Esc: Close', { duration: 5000 }),
});

// ── API events ────────────────────────────────────────────────────────────────
notify.on('api:unauthorized', () => {
    notify.warn('Session expired');
    router.navigate('/login');
});

// ── Sys-bar — live system stats in the fixed bottom bar ───────────────────────
let _sysBarTimer = null;

async function _updateSysBar() {
    const sys = await api.get('/api/system');
    if (!sys) return;
    setSysStats(sys);
}

function _startSysBarPoll() {
    _stopSysBarPoll();
    _updateSysBar();
    _sysBarTimer = setInterval(_updateSysBar, 5000);
}

function _stopSysBarPoll() {
    clearInterval(_sysBarTimer);
    _sysBarTimer = null;
}

// ── Sys-bar effects — update DOM when sysStats changes ────────────────────────
const _fmt = (n) => {
    if (!n) return '0 B';
    const k = 1024, u = ['B','KB','MB','GB'];
    const i = Math.floor(Math.log(n) / Math.log(k));
    return `${(n / Math.pow(k, i)).toFixed(1)} ${u[i]}`;
};

effect(() => {
    const sys = sysStats();
    if (!sys) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('sys-cpu',       `${sys.cpu_percent?.toFixed(1) ?? '—'}%`);
    set('sys-mem',       _fmt(sys.mem_rss));
    set('sys-goroutines', sys.num_goroutine ?? '—');
    set('sys-cores',     sys.num_cpu ?? '—');
    set('sys-alloc',     _fmt(sys.mem_alloc));
});

// ── Footer stats effects — updated by pages that fetch metrics ────────────────
effect(() => {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('footer-total',   _fmtNum(totalReqs()));
    set('footer-errors',  _fmtNum(totalErrors()));
    set('footer-rps',     rps().toFixed(1));
    set('footer-p99',     `${avgP99()}ms`);
    set('footer-backends', activeBackends());
});

function _fmtNum(n) {
    if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n/1e3).toFixed(1) + 'k';
    return String(n || 0);
}

// ── Start ─────────────────────────────────────────────────────────────────────
logger.info('app', 'Oja example starting');
router.start('/login');