/**
 * oja/plugin.js
 * The single entry point for extending Oja.
 *
 * Oja has eight distinct extension surfaces spread across six modules.
 * Without this file, a developer who wants to customise Oja must read the
 * source of component.js, ui.js, adapter.js, router.js, api.js, auth.js,
 * socket.js, and out.js to find all the hooks. plugin.js fixes that.
 *
 * This module owns nothing. It is a facade — a thin, transparent layer that
 * knows where every extension point lives and exposes them through one
 * coherent, chainable surface. No logic of its own.
 *
 * ─── Quick reference ──────────────────────────────────────────────────────────
 *
 *   import { plugin } from '../oja/plugin.js';
 *
 *   plugin
 *     .animation({ entering, leaving, updated })   // CSS → GSAP transitions
 *     .widget('datepicker', el => new Flatpickr(el))  // data-ui="datepicker"
 *     .lib('gsap', gsap)                           // adapter.register()
 *     .lib.lazy('chart', () => import('chart.js')) // lazy-load on first use
 *     .middleware(authGuard)                        // router.Use()
 *     .api({ beforeRequest, afterResponse })        // api instance hooks
 *     .auth({ onStart, onExpiry, onRenew })         // auth session hooks
 *     .codec('msgpack', new MsgPackCodec())         // named socket codec
 *     .render('sparkline', asyncFn);               // named Out.fn renderer
 *
 * ─── Animation hooks ──────────────────────────────────────────────────────────
 *
 *   Override Oja's default CSS class transitions with any animation library.
 *   Each hook receives the DOM element and may return a Promise.
 *
 *   import gsap from 'gsap';
 *
 *   plugin.animation({
 *       entering: (el) => gsap.from(el, { opacity: 0, y: 10, duration: 0.25 }),
 *       leaving:  (el) => gsap.to(el,   { opacity: 0, y: -10, duration: 0.2 }),
 *       updated:  (el) => gsap.fromTo(el,
 *           { backgroundColor: '#fffbe6' },
 *           { backgroundColor: 'transparent', duration: 0.4 }
 *       ),
 *   });
 *
 *   // You can provide only the hooks you need — others keep their default:
 *   plugin.animation({ entering: el => el.animate([{opacity:0},{opacity:1}], 200) });
 *
 * ─── UI widgets ───────────────────────────────────────────────────────────────
 *
 *   Register a widget once in app.js. Any element with data-ui="name" — on
 *   any page, past or future — will be initialised automatically. Widgets are
 *   also re-initialised when component.add() injects new elements.
 *
 *   import Flatpickr  from 'flatpickr';
 *   import SlimSelect from 'slim-select';
 *
 *   plugin
 *     .widget('datepicker', (el) => new Flatpickr(el, { dateFormat: 'Y-m-d' }))
 *     .widget('select',     (el) => new SlimSelect({ select: el }))
 *     .widget('tags',       (el) => new Tagify(el));
 *
 *   // HTML — no JS needed at the component level:
 *   <input type="text" data-ui="datepicker">
 *   <select data-ui="select" multiple>...</select>
 *
 * ─── Third-party libraries ────────────────────────────────────────────────────
 *
 *   Register libraries once. Retrieve them anywhere without re-importing.
 *   Avoids circular dependencies and window globals.
 *
 *   import * as d3   from 'd3';
 *   import * as PIXI from 'pixi.js';
 *
 *   plugin
 *     .lib('d3',   d3,   { version: '7.8.5' })
 *     .lib('pixi', PIXI, { version: '7.3.0' });
 *
 *   // Retrieve anywhere:
 *   import { adapter } from '../oja/adapter.js';
 *   const d3 = adapter.use('d3');
 *
 *   // Lazy — library only loaded when first used (great for heavy deps):
 *   plugin.lib.lazy('monaco', () => import('https://cdn.jsdelivr.net/npm/monaco-editor'));
 *
 *   // Then await it:
 *   const monaco = await adapter.useAsync('monaco');
 *
 * ─── Router middleware ────────────────────────────────────────────────────────
 *
 *   Add global middleware that runs on every route navigation. Middleware
 *   functions receive (ctx, next) — call next() to continue, return without
 *   calling it to halt the chain.
 *
 *   Middleware signature: async (ctx, next) => { ... await next(); ... }
 *
 *   // Auth guard — halt navigation if session is not active:
 *   plugin.middleware(async (ctx, next) => {
 *       if (!auth.session.isActive()) {
 *           auth.session.setIntendedPath(ctx.path);
 *           ctx.redirect('/login');
 *           return;
 *       }
 *       await next();
 *   });
 *
 *   // Performance logger — wrap every render:
 *   plugin.middleware(async (ctx, next) => {
 *       const t = performance.now();
 *       await next();
 *       logger.debug('router', `${ctx.path} rendered in ${(performance.now()-t).toFixed(1)}ms`);
 *   });
 *
 *   // Multiple middleware — applied in registration order:
 *   plugin
 *     .middleware(timingMiddleware)
 *     .middleware(analyticsMiddleware)
 *     .middleware(errorBoundaryMiddleware);
 *
 *   // Requires a router instance — pass it once, then add as many as you need:
 *   plugin.router(myRouter)
 *         .middleware(authGuard)
 *         .middleware(logger);
 *
 * ─── API hooks ────────────────────────────────────────────────────────────────
 *
 *   Wire into every API request and response globally. Useful for logging,
 *   analytics, token injection, and offline detection.
 *
 *   plugin.api(myApiInstance, {
 *       beforeRequest: (path, method, opts) => {
 *           logger.debug('api', `${method} ${path}`);
 *       },
 *       afterResponse: (path, method, res, ms) => {
 *           if (ms > 500) logger.warn('api', `Slow: ${method} ${path}`, { ms });
 *       },
 *       onOffline: () => notify.banner('Connection lost', { type: 'warn' }),
 *       onOnline:  () => { notify.dismissBanner(); notify.success('Reconnected'); },
 *       retryWhen: { 503: true, 429: true },  // retry on these status codes
 *   });
 *
 *   // Multiple API instances (e.g. primary + analytics):
 *   plugin.api(primaryApi,   { beforeRequest: authHeader });
 *   plugin.api(analyticsApi, { beforeRequest: analyticsHeader });
 *
 * ─── Auth hooks ───────────────────────────────────────────────────────────────
 *
 *   Wire into the session lifecycle. These are the integration points for
 *   connecting auth to your router, api, and notify.
 *
 *   plugin.auth({
 *       onStart: async (token, refreshToken) => {
 *           api.setToken(token);
 *           const dest = auth.session.intendedPath() || '/dashboard';
 *           auth.session.clearIntendedPath();
 *           await router.navigate(dest);
 *       },
 *       onRenew:  (newToken)  => api.setToken(newToken),
 *       onExpiry: ()          => {
 *           notify.warn('Your session has expired.');
 *           router.navigate('/login');
 *       },
 *       onRefresh: ()         => logger.debug('auth', 'Token refreshed silently'),
 *   });
 *
 *   // You can provide only the hooks you need:
 *   plugin.auth({ onExpiry: () => router.navigate('/login') });
 *
 * ─── Socket codecs ────────────────────────────────────────────────────────────
 *
 *   Register named codecs for use when constructing Socket instances.
 *   The default codec is JSON. Register alternatives (e.g. MessagePack) here
 *   and refer to them by name rather than importing in every socket file.
 *
 *   import { MsgPackCodec } from '../oja/codecs/msgpack.js';
 *
 *   plugin.codec('msgpack', new MsgPackCodec());
 *
 *   // Use by name when creating a socket:
 *   import { plugin } from '../oja/plugin.js';
 *   const ws = new Socket('/ws', { codec: plugin.getCodec('msgpack') });
 *
 *   // Or retrieve and pass directly:
 *   const codec = plugin.getCodec('msgpack');
 *
 * ─── Named renderers ──────────────────────────────────────────────────────────
 *
 *   Register reusable Out.fn renderers by name. Useful for patterns that
 *   appear across multiple pages — sparklines, avatars, status badges, etc.
 *
 *   plugin.render('sparkline', async (container, ctx) => {
 *       const { data, color } = ctx;
 *       container.innerHTML = buildSparklineSVG(data, color);
 *   });
 *
 *   plugin.render('avatar', async (container, ctx) => {
 *       const res = await api.get(`/users/${ctx.userId}/avatar`);
 *       return Out.image(res.url, { alt: res.name, width: 40, height: 40 });
 *   });
 *
 *   // Use anywhere by name — creates a fresh Out.fn each time:
 *   const sparkline = plugin.getRenderer('sparkline');
 *   // sparkline is an Out.fn — use it anywhere Out is accepted:
 *   each(container, 'hosts', items, { empty: plugin.getRenderer('empty-state') });
 *
 * ─── Full wiring example (app.js) ────────────────────────────────────────────
 *
 *   import { plugin }       from '../oja/plugin.js';
 *   import { router }       from './router.js';   // your configured Router instance
 *   import { api }          from './api.js';       // your configured Api instance
 *   import gsap             from 'gsap';
 *   import Flatpickr        from 'flatpickr';
 *   import { MsgPackCodec } from '../oja/codecs/msgpack.js';
 *
 *   plugin
 *     // Wire the router so .middleware() has somewhere to register
 *     .router(router)
 *
 *     // Smooth GSAP transitions instead of CSS classes
 *     .animation({
 *         entering: el => gsap.from(el, { opacity: 0, y: 8, duration: 0.2 }),
 *         leaving:  el => gsap.to(el,   { opacity: 0, duration: 0.15 }),
 *     })
 *
 *     // Auto-init any element with data-ui="datepicker"
 *     .widget('datepicker', el => new Flatpickr(el, { dateFormat: 'Y-m-d' }))
 *
 *     // Register GSAP so other modules can access it via adapter.use('gsap')
 *     .lib('gsap', gsap, { version: '3.12' })
 *
 *     // Global auth guard on every navigation
 *     .middleware(async (ctx, next) => {
 *         if (!auth.session.isActive() && ctx.path !== '/login') {
 *             auth.session.setIntendedPath(ctx.path);
 *             ctx.redirect('/login');
 *             return;
 *         }
 *         await next();
 *     })
 *
 *     // Wire api hooks
 *     .api(api, {
 *         beforeRequest: (path, method) => logger.debug('api', `${method} ${path}`),
 *         onOffline:     ()             => notify.banner('Offline', { type: 'warn' }),
 *         onOnline:      ()             => notify.dismissBanner(),
 *     })
 *
 *     // Wire auth lifecycle
 *     .auth({
 *         onStart:  (token) => {
 *             api.setToken(token);
 *             router.navigate(auth.session.intendedPath() || '/dashboard');
 *         },
 *         onRenew:  (token) => api.setToken(token),
 *         onExpiry: ()      => router.navigate('/login'),
 *     })
 *
 *     // Binary codec for high-frequency socket messages
 *     .codec('msgpack', new MsgPackCodec());
 */

import { component }         from './component.js';
import { ui }                from './ui.js';
import { adapter }           from '../utils/adapter.js';
import { auth }              from '../ext/auth.js';
import { Out }               from './out.js';

// Named socket codecs — { name → codec instance }
const _codecs = new Map();

// Named renderers — { name → async fn }
const _renderers = new Map();

// The router instance, set via plugin.router()
let _router = null;

export const plugin = {

    // Animation hooks

    /**
     * Override Oja's default CSS class transitions with a custom animation library.
     *
     * Oja's default behaviour adds/removes CSS classes (oja-entering, oja-leaving,
     * oja-updated). Call plugin.animation() once in app.js to replace this with
     * any animation library — GSAP, Anime.js, Web Animations API, etc.
     *
     * Each hook receives the DOM element. Return a Promise if the animation is
     * async — Oja will await it before continuing the mount/unmount lifecycle.
     *
     * @param {Object} hooks
     *   entering : (el: Element) => void | Promise  — element entering the DOM
     *   leaving  : (el: Element) => void | Promise  — element leaving the DOM
     *   updated  : (el: Element) => void | Promise  — element content was updated
     *
     *   // GSAP example:
     *   plugin.animation({
     *       entering: el => gsap.from(el, { opacity: 0, y: 10, duration: 0.25 }),
     *       leaving:  el => gsap.to(el,   { opacity: 0, duration: 0.2 }),
     *       updated:  el => gsap.fromTo(el,
     *           { backgroundColor: '#fffbe6' },
     *           { backgroundColor: 'transparent', duration: 0.4 }
     *       ),
     *   });
     *
     *   // Web Animations API example (no dependency):
     *   plugin.animation({
     *       entering: el => el.animate([{ opacity: 0, transform: 'translateY(8px)' },
     *                                   { opacity: 1, transform: 'translateY(0)' }],
     *                                  { duration: 200, easing: 'ease-out' }).finished,
     *   });
     */
    animation(hooks = {}) {
        component.hooks(hooks);
        return this;
    },

    // UI widgets

    /**
     * Register a UI widget initialiser for a data-ui attribute value.
     *
     * Register once in app.js. Every element with matching data-ui="name" — on
     * any page, in any component — will be initialised automatically on navigation
     * and re-initialised when component.add() dynamically inserts new elements.
     *
     * The initFn receives the raw DOM element. Return value is ignored.
     *
     * @param {string}   name    — matches data-ui="name" in HTML
     * @param {Function} initFn  — (el: Element) => void | any
     *
     *   plugin
     *     .widget('datepicker', el => new Flatpickr(el, { dateFormat: 'Y-m-d' }))
     *     .widget('select',     el => new SlimSelect({ select: el }))
     *     .widget('tags',       el => new Tagify(el))
     *     .widget('editor',     el => CodeMirror.fromTextArea(el, { mode: 'javascript' }));
     *
     *   // HTML — no JS needed at the component level:
     *   <input type="text"  data-ui="datepicker">
     *   <select             data-ui="select" multiple>...</select>
     *   <textarea           data-ui="editor"></textarea>
     */
    widget(name, initFn) {
        ui.widget.register(name, initFn);
        return this;
    },

    // Third-party library registry

    /**
     * Register a third-party library so any module can access it via
     * adapter.use(name) without re-importing or using window globals.
     *
     * @param {string} name      — key to retrieve the library by
     * @param {any}    instance  — the library object or class
     * @param {Object} [options]
     *   version : string — for documentation, shown in adapter.list()
     *
     *   import * as d3   from 'd3';
     *   import * as PIXI from 'pixi.js';
     *
     *   plugin
     *     .lib('d3',   d3,   { version: '7.8.5' })
     *     .lib('pixi', PIXI, { version: '7.3.0' });
     *
     *   // Retrieve in any component script:
     *   import { adapter } from '../oja/adapter.js';
     *   const d3 = adapter.use('d3');
     */
    lib(name, instance, options = {}) {
        adapter.register(name, instance, options);
        return this;
    },

    // Router middleware

    /**
     * Provide a Router instance so plugin.middleware() has somewhere to register.
     * Call this once in app.js before any .middleware() calls.
     *
     * @param {Router} routerInstance — your configured Router
     *
     *   import { router } from './router.js';
     *   plugin.router(router).middleware(authGuard);
     */
    router(routerInstance) {
        _router = routerInstance;
        return this;
    },

    /**
     * Add a global middleware function that runs on every route navigation.
     *
     * Middleware signature: async (ctx, next) => void
     *   ctx.path       — the path being navigated to
     *   ctx.params     — URL parameters from the route pattern
     *   ctx.data       — data attached by earlier middleware
     *   ctx.redirect() — abort and navigate elsewhere
     *   next()         — call to continue the chain; omit to halt it
     *
     * Requires plugin.router() to be called first with a Router instance.
     * Middleware is applied in registration order.
     *
     * @param {...Function} fns — one or more middleware functions
     *
     *   // Auth guard — redirect to login if session is not active:
     *   plugin.middleware(async (ctx, next) => {
     *       if (!auth.session.isActive() && ctx.path !== '/login') {
     *           auth.session.setIntendedPath(ctx.path);
     *           ctx.redirect('/login');
     *           return;          // halt — do not call next()
     *       }
     *       await next();        // continue to the route handler
     *   });
     *
     *   // Data loader — attach data before the page renders:
     *   plugin.middleware(async (ctx, next) => {
     *       if (ctx.path.startsWith('/hosts/')) {
     *           ctx.data = await api.get(`/hosts/${ctx.params.id}`);
     *       }
     *       await next();
     *   });
     *
     *   // Timing — wrap every render:
     *   plugin.middleware(async (ctx, next) => {
     *       const t = performance.now();
     *       await next();
     *       logger.debug('router', `${ctx.path} in ${(performance.now()-t).toFixed(1)}ms`);
     *   });
     */
    middleware(...fns) {
        if (!_router) {
            console.warn(
                '[oja/plugin] middleware() called before router() — ' +
                'call plugin.router(myRouter) first so middleware has somewhere to register.'
            );
            return this;
        }
        _router.Use(...fns);
        return this;
    },

    // API hooks

    /**
     * Wire hooks into an Api instance.
     * All hooks are optional — provide only the ones you need.
     *
     * @param {Api}    apiInstance — your configured Api instance
     * @param {Object} hooks
     *   beforeRequest : (path, method, opts) => void
     *       Runs before every request. Use for logging, injecting headers,
     *       or recording request start times.
     *
     *   afterResponse : (path, method, res, ms) => void
     *       Runs after every response. Use for logging, analytics,
     *       or slow-response warnings.
     *
     *   onOffline     : () => void
     *       Fires when the app detects it has lost network connectivity.
     *       Use to show a banner or disable form submissions.
     *
     *   onOnline      : () => void
     *       Fires when connectivity is restored.
     *       Use to dismiss the offline banner and re-enable the UI.
     *
     *   retryWhen     : number | { [statusCode]: boolean }
     *       Status codes that should trigger automatic retry.
     *       Examples: 503, { 503: true, 429: true }
     *
     *   plugin.api(api, {
     *       beforeRequest: (path, method) => logger.debug('api', `→ ${method} ${path}`),
     *       afterResponse: (path, method, res, ms) => {
     *           if (ms > 500) logger.warn('api', `Slow: ${method} ${path}`, { ms });
     *       },
     *       onOffline: () => notify.banner('Connection lost', { type: 'warn' }),
     *       onOnline:  () => { notify.dismissBanner(); notify.success('Reconnected'); },
     *       retryWhen: { 503: true, 429: true },
     *   });
     */
    api(apiInstance, hooks = {}) {
        if (!apiInstance || typeof apiInstance !== 'object') {
            console.warn('[oja/plugin] api() requires an Api instance as first argument.');
            return this;
        }

        const { beforeRequest, afterResponse, onOffline, onOnline, retryWhen } = hooks;

        if (typeof beforeRequest === 'function') apiInstance.beforeRequest(beforeRequest);
        if (typeof afterResponse === 'function') apiInstance.afterResponse(afterResponse);
        if (typeof onOffline    === 'function') apiInstance.onOffline(onOffline);
        if (typeof onOnline     === 'function') apiInstance.onOnline(onOnline);

        if (retryWhen !== undefined) {
            apiInstance.retryWhen(retryWhen);
        }

        return this;
    },

    // Auth hooks

    /**
     * Wire into the auth session lifecycle.
     * All hooks are optional — provide only the ones you need.
     *
     * These are the primary integration points for connecting auth to your
     * router, api instance, and notification system.
     *
     * @param {Object} hooks
     *   onStart   : (token, refreshToken) => void | Promise
     *       Fires after a successful session.start() — i.e. after login.
     *       Use to set the API token, navigate to the intended page, and
     *       initialise any per-session state.
     *
     *   onRenew   : (newToken, newRefreshToken) => void | Promise
     *       Fires after a successful token refresh.
     *       Use to update the API token.
     *
     *   onExpiry  : () => void | Promise
     *       Fires when the session expires (JWT exp reached).
     *       Use to show a warning and redirect to login.
     *
     *   onRefresh : () => void | Promise
     *       Fires when a silent token refresh is triggered (5 min before expiry).
     *       Use for logging or to show a "refreshing session" indicator.
     *
     *   plugin.auth({
     *       onStart: async (token) => {
     *           api.setToken(token);
     *           const dest = auth.session.intendedPath() || '/dashboard';
     *           auth.session.clearIntendedPath();
     *           await router.navigate(dest);
     *       },
     *       onRenew:   (token) => api.setToken(token),
     *       onExpiry:  ()      => {
     *           notify.warn('Your session has expired. Please log in again.');
     *           router.navigate('/login');
     *       },
     *       onRefresh: ()      => logger.debug('auth', 'Token refreshed silently'),
     *   });
     */
    auth(hooks = {}) {
        const { onStart, onRenew, onExpiry, onRefresh } = hooks;

        if (typeof onStart   === 'function') auth.session.OnStart(onStart);
        if (typeof onRenew   === 'function') auth.session.OnRenew(onRenew);
        if (typeof onExpiry  === 'function') auth.session.OnExpiry(onExpiry);
        if (typeof onRefresh === 'function') auth.session.OnRefresh(onRefresh);

        return this;
    },

    // Socket codecs

    /**
     * Register a named socket codec.
     *
     * A codec is an object with:
     *   encode(data)     → string | ArrayBuffer  — serialise before sending
     *   decode(raw)      → any                   — deserialise on receive
     *   binaryType       → 'text' | 'binary'     — WebSocket binary mode
     *
     * The built-in JSON codec is always available. Register alternatives here
     * and retrieve them by name when constructing Socket instances.
     *
     * @param {string} name  — codec identifier
     * @param {Object} codec — { encode, decode, binaryType }
     *
     *   import { MsgPackCodec } from '../oja/codecs/msgpack.js';
     *
     *   plugin.codec('msgpack', new MsgPackCodec());
     *
     *   // Use by name:
     *   const ws = new Socket('/ws/metrics', {
     *       codec: plugin.getCodec('msgpack'),
     *   });
     */
    codec(name, codec) {
        if (!codec || typeof codec.encode !== 'function' || typeof codec.decode !== 'function') {
            console.warn(
                `[oja/plugin] codec('${name}', ...) — codec must have encode() and decode() methods.`
            );
            return this;
        }
        _codecs.set(name, codec);
        return this;
    },

    /**
     * Retrieve a previously registered codec by name.
     * Returns null if the codec has not been registered.
     *
     * @param {string} name
     * @returns {Object|null}
     *
     *   const codec = plugin.getCodec('msgpack');
     *   if (!codec) throw new Error('msgpack codec not registered');
     */
    getCodec(name) {
        return _codecs.get(name) ?? null;
    },

    // Named renderers

    /**
     * Register a named renderer — a reusable Out.fn that can be retrieved by
     * name from anywhere in the application.
     *
     * A renderer is an async function with signature:
     *   (container: Element, ctx: Object) => void | Out | string
     *
     * Return another Out to compose, return a string to set innerHTML,
     * or return nothing and manipulate the container directly.
     *
     * @param {string}   name   — renderer identifier
     * @param {Function} asyncFn — async (container, ctx) => void | Out | string
     *
     *   // Register in app.js:
     *   plugin.render('sparkline', async (container, ctx) => {
     *       const { data, color = 'var(--accent)' } = ctx;
     *       container.innerHTML = buildSparklineSVG(data, color);
     *   });
     *
     *   plugin.render('avatar', async (container, ctx) => {
     *       const user = await api.get(`/users/${ctx.userId}`);
     *       return Out.image(user.avatarUrl, { alt: user.name, width: 40, height: 40 });
     *   });
     *
     *   plugin.render('empty-hosts', async (container) => {
     *       return Out.component('states/no-hosts.html');
     *   });
     *
     *   // Use anywhere Out is accepted — creates a fresh Out.fn each time:
     *   const sparkline = plugin.getRenderer('sparkline');
     *   // Pass as an Out:
     *   each(container, 'series', items, { empty: plugin.getRenderer('empty-hosts') });
     *   modal.open('chart', { body: plugin.getRenderer('sparkline') });
     */
    render(name, asyncFn) {
        if (typeof asyncFn !== 'function') {
            console.warn(`[oja/plugin] render('${name}', ...) — second argument must be a function.`);
            return this;
        }
        _renderers.set(name, asyncFn);
        return this;
    },

    /**
     * Retrieve a named renderer as a fresh Out.fn instance.
     * Returns null if the renderer has not been registered.
     *
     * @param {string} name
     * @returns {Out|null}
     *
     *   const renderer = plugin.getRenderer('sparkline');
     *   if (!renderer) throw new Error('sparkline renderer not registered');
     *
     *   // Use as an Out anywhere:
     *   modal.open('chart', { body: plugin.getRenderer('sparkline') });
     *   each(container, 'hosts', items, { empty: plugin.getRenderer('empty-hosts') });
     */
    getRenderer(name) {
        const fn = _renderers.get(name);
        if (!fn) return null;
        // Return a fresh Out.fn so each use gets an independent instance
        return Out.fn(fn);
    },

    // Introspection

    /**
     * List everything that has been registered through plugin.
     * Useful for debugging app.js wiring at startup.
     *
     *   console.table(plugin.inspect());
     *   // → { codecs: ['msgpack'], renderers: ['sparkline', 'avatar'],
     *   // router: true, libs: ['gsap', 'd3', 'pixi'] }
     */
    inspect() {
        return {
            router:    !!_router,
            libs:      adapter.list().map(l => l.name),
            codecs:    [..._codecs.keys()],
            renderers: [..._renderers.keys()],
        };
    },
};

//
// This allows the chained form:
//   plugin.lib.lazy('chart', () => import('chart.js'))
//
// It works because plugin.lib is a method, and methods are objects in JS —
// we attach .lazy directly onto the function reference.

plugin.lib.lazy = function(name, factory, options = {}) {
    adapter.lazy(name, factory, options);
    return plugin;
};
