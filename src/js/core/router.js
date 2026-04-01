/**
 * oja/router.js
 * SPA navigation — Go-style middleware, groups, and race-safe rendering.
 *
 * The power of this router is Use() and Group():
 *   Use()   → middleware applied to all routes below it
 *   Group() → scoped sub-router with its own middleware stack
 *
 * Middleware signature: async (ctx, next) => { ... await next(); ... }
 * Returning false stops the chain. Modifying ctx passes data downstream.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { Router } from '../oja/router.js';
 *   import { Out } from '../oja/out.js';
 *
 *   const r = new Router({ mode: 'hash', outlet: '#app' });
 *
 *   // Global middleware — runs on every route
 *   r.Use(async (ctx, next) => {
 *       console.time(ctx.path);
 *       await next();
 *       console.timeEnd(ctx.path);
 *   });
 *
 *   // Public routes
 *   r.Get('/login',  Out.c('pages/login.html'));
 *   r.Get('/about',  Out.c('pages/about.html'));
 *
 *   // Protected group — middleware applied to all routes inside
 *   const app = r.Group('/');
 *   app.Use(auth.middleware('protected', '/login'));
 *   app.Get('dashboard', Out.c('pages/dashboard.html'));
 *   app.Get('hosts',     Out.c('pages/hosts.html'));
 *
 *   // Nested group with URL params
 *   app.Route('hosts/{id}', host => {
 *       host.Use(loadHostMiddleware);
 *       host.Get('/', Out.c('pages/host-detail.html'));
 *   });
 *
 *   // Chain of responsibility on a single route
 *   r.Get('/audit', [requireAuth, requireAuditor,
 *       Out.c('pages/audit.html')
 *   ]);
 *
 *   r.NotFound(Out.c('pages/404.html'));
 *   r.start('/login');
 *
 * ─── VFS integration ──────────────────────────────────────────────────────────
 *
 *   const vfs = new VFS('my-app');
 *   await vfs.mount('https://raw.githubusercontent.com/me/repo/main/');
 *
 *   const router = new Router({ mode: 'hash', outlet: '#app', vfs });
 *   // All Out.component() calls now check VFS before the network.
 *   // Works offline after first load — no service worker required.
 *
 * ─── Prefetching ──────────────────────────────────────────────────────────────
 *
 *   // Prefetch a route when user hovers over link
 *   router.prefetchOnHover('.nav-link', { delay: 100 });
 *
 *   // Prefetch multiple routes after initial load
 *   router.prefetch(['/dashboard', '/hosts', '/firewall']);
 *
 * ─── Middleware pattern ────────────────────────────────────────────────────────
 *
 *   // Wrap — do work before AND after the route renders
 *   r.Use(async (ctx, next) => {
 *       ctx.startTime = Date.now();
 *       await next();
 *       logger.info('router', `${ctx.path} rendered in ${Date.now() - ctx.startTime}ms`);
 *   });
 *
 *   // Guard — stop the chain, redirect
 *   const requireAuth = async (ctx, next) => {
 *       if (!auth.session.isActive()) {
 *           ctx.redirect('/login');
 *           return;
 *       }
 *       await next();
 *   };
 *
 *   // Loader — attach data to ctx before render
 *   const loadHost = async (ctx, next) => {
 *       ctx.host = await api.get(`/hosts/${ctx.params.id}`);
 *       await next();
 *   };
 *
 * ─── Query string helpers ─────────────────────────────────────────────────────
 *
 *   // Update query params without triggering a full navigation.
 *   router.setQuery({ filter: 'alive', sort: 'name' });
 *
 *   // Read current query params
 *   router.params();  // → { filter: 'alive', sort: 'name', ...routeParams }
 */

import { Store }          from './store.js';
import { Out }            from './out.js';
import { component }      from './component.js';
import { runtime }        from './runtime.js';
import { emit as _emit }  from './events.js';

const _store = new Store('oja:router');


const _prefetchQueue = new Set();
const _prefetchCache = new Map();  // url -> { promise, timestamp, priority }
const _prefetchLinks = new WeakMap(); // element -> { url, timeout }

const PREFETCH_CACHE_MAX = 100; // max entries — evict oldest on overflow

const PREFETCH_DEFAULTS = {
    delay:         200,
    timeout:       10000,
    priority:      'low',
    maxConcurrent: 3,
};

let _prefetchConfig = { ...PREFETCH_DEFAULTS };
let _prefetchActive = 0;


class _RouteNode {
    constructor(segment = '') {
        this.segment    = segment;
        this.responder  = null;
        this.middleware = [];
        this.children   = new Map();
        this.paramChild = null;
        this.paramName  = null;
        this.prefetch   = false;
    }
}


export class Router {
    /**
     * @param {Object} options
     *   mode    : 'hash' | 'path'  — URL strategy (default: 'hash')
     *   outlet  : string           — CSS selector for page container (default: '#app')
     *   loading : Out              — shown immediately while page loads (default: none)
     *   prefetch: boolean          — enable automatic prefetching (default: false)
     *   vfs     : VFS              — VFS instance; all Out.component() calls check it first
     */
    constructor({ mode = 'hash', outlet = '#app', loading = null, prefetch = false, vfs = null } = {}) {
        this._mode             = mode;
        this._outlet           = outlet;
        this._loadingResponder = loading;
        this._root             = new _RouteNode();
        this._globalMiddleware = [];
        this._notFound         = Out.html('<div class="oja-404"><h2>404</h2><p>Page not found</p></div>');
        this._errorResponder   = Out.html('<div class="oja-error"><h2>Error</h2><p>Something went wrong</p></div>');
        this._current          = null;
        this._params           = {};
        this._started          = false;
        this._navId            = 0;
        this._navController    = null; // AbortController for in-flight navigation
        this._beforeEach       = [];
        this._afterEach        = [];
        this._prefetchEnabled  = prefetch;
        this._namedRoutes      = new Map(); // F-31: name → pattern
        this._urlHandler       = null;      // L-03: stored for destroy()

        // Register VFS with Out so all component fetches check local store first.
        // Can also be set independently via Out.vfsUse(vfs) before router.start().
        if (vfs) Out.vfsUse(vfs);
    }

    // ─── Prefetching ──────────────────────────────────────────────────────────

    /**
     * Configure prefetching behaviour.
     */
    configurePrefetch(config = {}) {
        _prefetchConfig = { ..._prefetchConfig, ...config };
        return this;
    }

    /**
     * Prefetch specific routes.
     * Returns a promise that resolves when all prefetches complete.
     */
    async prefetch(target, options = {}) {
        const urls = Array.isArray(target) ? target : [target];
        const opts = { ..._prefetchConfig, ...options };
        await Promise.allSettled(urls.map(url => this._prefetchRoute(url, opts)));
        return this;
    }

    /**
     * Enable prefetching on hover for matching links.
     *
     *   router.prefetchOnHover('.nav-link', { delay: 100 });
     */
    prefetchOnHover(selector, options = {}) {
        const opts = { ..._prefetchConfig, ...options };

        const handler = (e) => {
            if (!e.target || typeof e.target.closest !== 'function') return;
            const link = e.target.closest(selector);
            if (!link) return;

            if (_prefetchLinks.has(link)) clearTimeout(_prefetchLinks.get(link).timeout);

            const timeout = setTimeout(() => {
                const href = link.getAttribute('href') || link.dataset.href || link.dataset.page;
                if (href) this._prefetchRoute(this._normalizePath(href), opts);
            }, opts.delay);

            _prefetchLinks.set(link, { url: link.href, timeout });
        };

        const cancelHandler = (e) => {
            if (!e.target || typeof e.target.closest !== 'function') return;
            const link = e.target.closest(selector);
            if (!link) return;
            const data = _prefetchLinks.get(link);
            if (data) { clearTimeout(data.timeout); _prefetchLinks.delete(link); }
        };

        document.addEventListener('mouseenter', handler, { passive: true });
        document.addEventListener('mouseleave', cancelHandler, { passive: true });

        return () => {
            document.removeEventListener('mouseenter', handler);
            document.removeEventListener('mouseleave', cancelHandler);
        };
    }

    async _prefetchRoute(path, options) {
        if (_prefetchCache.has(path)) {
            const cached = _prefetchCache.get(path);
            if (Date.now() - cached.timestamp < 60000) return cached.promise;
        }

        if (_prefetchActive >= _prefetchConfig.maxConcurrent) {
            _prefetchQueue.add({ path, options });
            return;
        }

        _prefetchActive++;

        const promise = (async () => {
            try {
                const match = this._match(path);
                if (!match) return;

                const controller = new AbortController();
                const timeoutId  = setTimeout(() => controller.abort(), options.timeout);

                if (match.responder && typeof match.responder.prefetch === 'function') {
                    await match.responder.prefetch({ signal: controller.signal });
                }

                clearTimeout(timeoutId);
                // Evict oldest entry if cache is at capacity (LRU-lite: insertion order)
                if (_prefetchCache.size >= PREFETCH_CACHE_MAX) {
                    _prefetchCache.delete(_prefetchCache.keys().next().value);
                }
                _prefetchCache.set(path, { promise, timestamp: Date.now(), priority: options.priority });
                this._processPrefetchQueue();
            } catch (e) {
                if (e.name !== 'AbortError') console.warn(`[oja/router] Prefetch failed for ${path}:`, e);
            } finally {
                _prefetchActive--;
                this._processPrefetchQueue();
            }
        })();

        return promise;
    }

    _processPrefetchQueue() {
        if (_prefetchQueue.size === 0 || _prefetchActive >= _prefetchConfig.maxConcurrent) return;
        const [next] = _prefetchQueue;
        _prefetchQueue.delete(next);
        this._prefetchRoute(next.path, next.options);
    }

    _normalizePath(path) {
        return path.replace(/^#/, '').split('?')[0] || '/';
    }

    // ─── Middleware ───────────────────────────────────────────────────────────

    Use(...middlewares) {
        for (const mw of middlewares.flat()) {
            if (typeof mw === 'function') this._globalMiddleware.push(mw);
        }
        return this;
    }

    // ─── Global hooks ─────────────────────────────────────────────────────────

    /** Called before every navigation — fn(ctx) */
    beforeEach(fn) { this._beforeEach.push(fn); return this; }

    /** Called after every navigation — fn(ctx) */
    afterEach(fn)  { this._afterEach.push(fn);  return this; }

    // ─── Route registration ───────────────────────────────────────────────────

    /**
     * Register a GET route.
     * responderOrChain can be an Out or [...middleware, Out].
     */
    Get(pattern, responderOrChain) {
        const { responder, middleware } = _unwrapChain(responderOrChain);
        this._addRoute(pattern, responder, middleware);
        return this;
    }

    /** Mark a route for automatic prefetching. */
    Prefetch(pattern) {
        this._findOrCreate(pattern).prefetch = true;
        return this;
    }

    NotFound(responder) { this._notFound       = responder; return this; }
    Error(responder)    { this._errorResponder = responder; return this; }

    // ─── Grouping ─────────────────────────────────────────────────────────────

    /**
     * Create a scoped sub-router at a path prefix.
     * The group shares the parent's navigate(), named routes, and lifecycle —
     * it is a proxy, not a new Router instance.
     *
     *   const app = r.Group('/app');
     *   app.Use(auth.middleware());
     *   app.Get('/hosts', Out.c('pages/hosts.html'));   // → /app/hosts
     *
     *   // Nested
     *   const hosts = app.Group('/hosts');
     *   hosts.Get('/{id}', Out.c('pages/host.html')); // → /app/hosts/{id}
     */
    Group(prefix, fn) {
        const group = new _GroupProxy(this, prefix, [...this._globalMiddleware]);
        if (fn) fn(group);
        return group;
    }

    /**
     * Register a nested route block — used for URL param segments.
     */
    Route(pattern, fn) {
        const sub = new _GroupProxy(this, pattern, [...this._globalMiddleware]);
        fn(sub);
        return this;
    }

    // ─── Query string ─────────────────────────────────────────────────────────

    /**
     * Update URL query params without triggering a full navigation.
     */
    setQuery(params = {}) {
        if (!this._current) return this;
        const cleanPath = this._current.split('?')[0];
        const qs        = _buildQuery(params);
        const url       = (this._mode === 'hash' ? '#' : '') + cleanPath + (qs ? '?' + qs : '');
        window.history.replaceState({ path: cleanPath, params }, '', url);
        this._params = { ...this._params, ...params };
        return this;
    }

    getQuery() {
        const { query } = this._parseURL();
        return query;
    }

    // ─── Start ────────────────────────────────────────────────────────────────

    async start(defaultPath = '/') {
        if (this._started) return;
        this._started = true;

        const eventName = this._mode === 'hash' ? 'hashchange' : 'popstate';
        // Store handler ref so destroy() can remove it
        this._urlHandler = () => this._handleURL(defaultPath);
        window.addEventListener(eventName, this._urlHandler);

        await this._handleURL(defaultPath);

        if (this._prefetchEnabled) this._setupPrefetchDetection();
    }

    _setupPrefetchDetection() {
        const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting) {
                    const link = entry.target;
                    const href = link.getAttribute('href') || link.dataset.href || link.dataset.page;
                    if (href) {
                        const path = this._normalizePath(href);
                        const node = this._match(path);
                        if (node?.prefetch) this._prefetchRoute(path, { priority: 'low' });
                    }
                }
            }
        });
        document.querySelectorAll('[data-prefetch], a[data-page]').forEach(el => observer.observe(el));
    }

    async _handleURL(defaultPath = '/') {
        const { path, query } = this._parseURL();
        await this.navigate(path || defaultPath, { query });
    }

    // ─── Navigation ───────────────────────────────────────────────────────────

    /**
     * Navigate to a path — updates URL, runs middleware chain, renders Out.
     * Race-safe: only the most recent navigate() call is allowed to complete.
     */
    async navigate(path, options = {}) {
        // if path is a known route name, resolve it
        if (this._namedRoutes.has(path)) {
            path = this.path(path, options.params || {});
        }
        const currentNavId = ++this._navId;

        // Abort any in-flight render from the previous navigation.
        // This cancels fetch() calls inside Out.fn() that were passed
        // container.signal — they get AbortError instead of resolving into
        // a DOM node that may no longer be the active page.
        if (this._navController) this._navController.abort();
        this._navController = new AbortController();
        const navSignal = this._navController.signal;

        const [pathname, qs] = path.split('?');
        const query          = { ...options.query, ..._parseQuery(qs || '') };
        const container      = document.querySelector(this._outlet);

        if (!options._replace) this._pushURL(pathname, query);

        _emit('oja:navigate:start', { path: pathname });

        if (this._loadingResponder && container) {
            container.innerHTML = '';
            await this._loadingResponder.render(container, {});
        }

        if (currentNavId !== this._navId) return;

        const match = this._match(pathname);
        const ctx = {
            path:     pathname,
            params:   {},
            query,
            outlet:   this._outlet,
            redirect: (to, opts) => this.navigate(to, opts),
            replace:  (to, opts) => this.navigate(to, { ...opts, _replace: true }),
        };

        if (container) await component._runUnmount(container);

        if (!match) {
            for (const fn of this._beforeEach) await fn(ctx);
            await this._render(this._notFound, ctx);
            for (const fn of this._afterEach) await fn(ctx);
            if (container) await component._runMount(container);
            return;
        }

        ctx.params = { ...match.params, ...query };

        // Fire global runtime navigate hooks — allows analytics, permission guards,
        // and A/B middleware to observe or cancel navigation before beforeEach runs.
        const navResult = runtime.runNavigateHooks({
            from:   this._current,
            to:     pathname,
            route:  match.route,
            params: match.params,
            query,
        });
        if (navResult.cancelled) {
            if (navResult.redirectTo) await this.navigate(navResult.redirectTo);
            return;
        }

        for (const fn of this._beforeEach) {
            const stop = await fn(ctx);
            if (stop === false) return;
        }

        // Deduplicate the middleware chain. Route nodes store global middleware
        // already baked in from _addRoute(), so we must not prepend
        // _globalMiddleware again — doing so would run it twice per request.
        const seen  = new Set();
        const chain = match.middleware.filter(mw => {
            if (seen.has(mw)) return false;
            seen.add(mw);
            return true;
        });

        let stopped = false;

        const runChain = async (index) => {
            if (index >= chain.length || currentNavId !== this._navId) return;
            const mw = chain[index];
            let nextCalled = false;

            const next = async () => {
                nextCalled = true;
                await runChain(index + 1);
            };

            const result = await mw(ctx, next);

            if (currentNavId !== this._navId) return;

            if (result === false) { stopped = true; return; }

            if (Out.is(result)) {
                await this._render(result, ctx);
                stopped = true;
                return;
            }

            if (result && typeof result === 'object' && !nextCalled) {
                Object.assign(ctx, result);
                await runChain(index + 1);
            }
        };

        try {
            await runChain(0);
        } catch (err) {
            console.error('[oja/router] middleware chain error:', err);
            await this._render(this._errorResponder, { ...ctx, error: err });
            return;
        }

        if (stopped || currentNavId !== this._navId) return;

        this._current = pathname;
        this._params  = ctx.params;
        _store.set('page',   pathname);
        _store.set('params', ctx.params);

        try {
            await this._render(match.responder, ctx);
        } catch (err) {
            console.error('[oja/router] render error:', err);
            await this._render(this._errorResponder, { ...ctx, error: err });
            return;
        }

        if (currentNavId !== this._navId) return;

        this._updateNav(pathname);

        for (const fn of this._afterEach) await fn(ctx);

        if (currentNavId !== this._navId) return;

        if (container) await component._runMount(container);

        if (currentNavId !== this._navId) return;

        _emit('oja:navigate:end',  { path: pathname, params: ctx.params });
        _emit('oja:navigate',      { path: pathname, params: ctx.params });
    }

    async _render(responder, ctx) {
        const container = document.querySelector(this._outlet);
        if (!container) return;

        container.classList.add('oja-leaving');
        await _wait(150);
        container.classList.remove('oja-leaving');

        container.innerHTML = '';
        // Pass the navigation AbortSignal through context so Out.fn() and
        // other async responders can cancel in-flight work on next navigation.
        const renderCtx = this._navController
            ? { ...ctx, signal: this._navController.signal }
            : ctx;
        await responder.render(container, renderCtx);

        container.classList.add('oja-entering');
        await _wait(50);
        container.classList.remove('oja-entering');
    }

    back()    { window.history.back(); }

    async refresh() {
        if (!this._current) return;
        await this.navigate(this._current, { query: this._params, _replace: true });
    }

    async replace(path, options = {}) {
        await this.navigate(path, { ...options, _replace: true });
    }

    current() { return this._current; }

    /**
     * Register a named route pattern.
     * Allows URL generation from name + params instead of string construction.
     *
     *   router.name('host.routes', '/hosts/{id}/routes');
     *   router.navigate('host.routes', { id: 42 });
     *   router.path('host.routes', { id: 42 }); // → '/hosts/42/routes'
     */
    name(routeName, pattern) {
        this._namedRoutes.set(routeName, pattern);
        return this;
    }

    /**
     * Build a URL path from a named route and params.
     */
    path(routeName, params = {}) {
        const pattern = this._namedRoutes.get(routeName);
        if (!pattern) {
            console.warn(`[oja/router] unknown route name: "${routeName}"`);
            return '/';
        }
        return pattern.replace(/\{(\w+)\}/g, (_, key) =>
            params[key] !== undefined ? encodeURIComponent(params[key]) : `{${key}}`
        );
    }

    /**
     * Navigate to a named route.
     */
    navigateTo(routeName, params = {}, options = {}) {
        return this.navigate(this.path(routeName, params), options);
    }

    /**
     * Remove the URL event listener.    /**
     * Remove the URL event listener. Call when replacing a router instance.
     */
    destroy() {
        if (!this._urlHandler) return;
        const eventName = this._mode === 'hash' ? 'hashchange' : 'popstate';
        window.removeEventListener(eventName, this._urlHandler);
        this._urlHandler = null;
        this._started = false;
    }

    /**
     * Check if the current path matches a pattern.
     * Supports * wildcards: router.is('/hosts/*')
     * Returns true if current route matches.
     *
     *   navLink.classList.toggle('active', router.is('/hosts/*'));
     */
    is(pattern) {
        if (!this._current) return false;
        const current = this._current.split('?')[0];
        if (pattern === current) return true;
        // Convert pattern to regex: /hosts/* → /hosts/.*
        const regexStr = '^' + pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*') + '$';
        return new RegExp(regexStr).test(current);
    }

    /**
     * Get a single param by name from the current route + query params.
     *
     *   const id = router.param('id');  // vs router.params().id
     */
    param(name) {
        return this._params?.[name] ?? null;
    }
    params()  { return { ...this._params }; }

    // ─── URL helpers ──────────────────────────────────────────────────────────

    _parseURL() {
        if (this._mode === 'hash') {
            const hash            = window.location.hash.slice(1) || '';
            const withoutFragment = hash.split('#')[0];
            const [path, qs]      = withoutFragment.split('?');
            return { path: path || '', query: _parseQuery(qs || '') };
        } else {
            const path = window.location.pathname;
            const qs   = window.location.search.slice(1);
            return { path: path || '/', query: _parseQuery(qs) };
        }
    }

    _buildURL(path, params = {}) {
        const qs = _buildQuery(params);
        if (this._mode === 'hash') return '#' + path + (qs ? '?' + qs : '');
        return path + (qs ? '?' + qs : '');
    }

    _pushURL(path, params = {}) {
        try {
            const url = this._buildURL(path, params);
            if (window.location.href !== new URL(url, window.location.href).href) {
                window.history.pushState({ path, params }, '', url);
            }
        } catch (e) {
            if (e.name !== 'SecurityError') {
                console.error('[oja/router] pushState failed:', e);
            }
        }
    }

    _updateNav(path) {
        document.querySelectorAll('[data-page]').forEach(el => {
            const active = el.dataset.page === path;
            el.classList.toggle('active', active);
            el.setAttribute('aria-current', active ? 'page' : null);
        });
        document.querySelectorAll('[data-href]').forEach(el => {
            const active = el.dataset.href === path;
            el.classList.toggle('active', active);
            el.setAttribute('aria-current', active ? 'page' : null);
        });
    }

    _addRoute(pattern, responder, routeMiddleware = []) {
        const node      = this._findOrCreate(pattern);
        node.responder  = responder;
        // Store only the route-specific middleware here. Global middleware is
        // already on this._globalMiddleware and will be prepended in navigate()
        // via the match.middleware array — storing it here too would cause it
        // to run twice per request.
        node.middleware = routeMiddleware;
    }

    _findOrCreate(pattern) {
        const segments = _segments(pattern);
        let   node     = this._root;

        for (const seg of segments) {
            if (seg.startsWith('{') && seg.endsWith('}')) {
                if (!node.paramChild) {
                    node.paramChild           = new _RouteNode(seg);
                    node.paramChild.paramName = seg.slice(1, -1);
                }
                node = node.paramChild;
            } else {
                if (!node.children.has(seg)) node.children.set(seg, new _RouteNode(seg));
                node = node.children.get(seg);
            }
        }
        return node;
    }

    _match(pathname) {
        const parts      = _segments(pathname);
        const params     = {};
        const routeSegs  = [];
        let   node       = this._root;

        for (const part of parts) {
            if (node.children.has(part)) {
                node = node.children.get(part);
                routeSegs.push(part);
            } else if (node.paramChild) {
                node = node.paramChild;
                params[node.paramName] = decodeURIComponent(part);
                routeSegs.push(`:${node.paramName}`);
            } else {
                return null;
            }
        }

        if (!node.responder) return null;

        // Compose the full middleware chain: global first, then route-specific.
        // This is the single place where global middleware is included — _addRoute
        // no longer bakes global middleware into the node, so there is no duplication.
        return {
            responder:  node.responder,
            params,
            middleware: [...this._globalMiddleware, ...node.middleware],
            route:      '/' + routeSegs.join('/'),
        };
    }
}

// A lightweight proxy over a parent Router that scopes route registration to a
// path prefix. Does NOT create a new Router instance — all navigation, named
// routes, and lifecycle stay on the parent. This means:
//   - group.name() registers on the parent → visible to parent.navigate()
//   - group.Use() adds to the group's own middleware stack, not the parent's
//   - group.Get('/foo') registers at prefix + '/foo' in the parent's trie

class _GroupProxy {
    constructor(parent, prefix, inheritedMiddleware = []) {
        this._parent     = parent;
        this._prefix     = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
        this._middleware = [...inheritedMiddleware];
    }

    // Resolve a group-relative path to a full path
    _full(pattern) {
        if (!pattern || pattern === '/') return this._prefix || '/';
        const p = pattern.startsWith('/') ? pattern : '/' + pattern;
        return this._prefix + p;
    }

    Use(...middlewares) {
        for (const mw of middlewares.flat()) {
            if (typeof mw === 'function') this._middleware.push(mw);
        }
        return this;
    }

    Get(pattern, responderOrChain) {
        const { responder, middleware } = _unwrapChain(responderOrChain);
        this._parent._addRoute(this._full(pattern), responder, [
            ...this._middleware,
            ...middleware,
        ]);
        return this;
    }

    Group(prefix, fn) {
        const group = new _GroupProxy(
            this._parent,
            this._full(prefix),
            [...this._middleware],
        );
        if (fn) fn(group);
        return group;
    }

    Route(pattern, fn) {
        const sub = new _GroupProxy(
            this._parent,
            this._full(pattern),
            [...this._middleware],
        );
        fn(sub);
        return this;
    }

    // Named routes — delegate to parent so navigate() can resolve them
    name(routeName, pattern) {
        this._parent.name(routeName, this._full(pattern));
        return this;
    }

    // Prefetch — delegate to parent's trie
    Prefetch(pattern) {
        this._parent.Prefetch(this._full(pattern));
        return this;
    }

    NotFound(responder) { this._parent.NotFound(responder); return this; }
    Error(responder)    { this._parent.Error(responder);    return this; }
    beforeEach(fn)      { this._parent.beforeEach(fn);      return this; }
    afterEach(fn)       { this._parent.afterEach(fn);       return this; }
}


Router.middleware = {

    /**
     * Timing middleware — logs render time for every route.
     *   r.Use(Router.middleware.timing);
     */
    timing: async (ctx, next) => {
        const t = Date.now();
        await next();
        console.debug(`[oja/router] ${ctx.path} — ${Date.now() - t}ms`);
    },

    /**
     * Error boundary — catches errors in the chain and renders error Out.
     *   r.Use(Router.middleware.errorBoundary(Out.c('pages/error.html')));
     */
    errorBoundary: (errorResponder) => async (ctx, next) => {
        try {
            await next();
        } catch (err) {
            ctx.error = err;
            const container = document.querySelector(ctx.outlet);
            if (container) await errorResponder.render(container, ctx);
        }
    },

    /**
     * Scroll to top after every navigation.
     *   r.afterEach(Router.middleware.scrollTop);
     */
    scrollTop: async () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    /**
     * Page title updater — reads data-title from the rendered page's root element.
     *   r.afterEach(Router.middleware.pageTitle('Oja Example'));
     */
    pageTitle: (appName = '') => async (ctx) => {
        const container = document.querySelector(ctx.outlet);
        const title     = container?.querySelector('[data-title]')?.dataset?.title;
        document.title  = title ? `${title} — ${appName}` : appName;
    },

    /**
     * Prefetch middleware — automatically prefetches linked routes after render.
     */
    prefetch: (router) => async (ctx, next) => {
        await next();
        if (router._prefetchEnabled) {
            document.querySelectorAll('[data-page], [data-href]').forEach(link => {
                const path = link.dataset.page || link.dataset.href;
                if (path) router._prefetchRoute(path, { priority: 'low' });
            });
        }
    },
};


function _segments(path) {
    return path.split('/').filter(Boolean);
}

function _unwrapChain(responderOrChain) {
    if (Array.isArray(responderOrChain)) {
        return {
            responder:  responderOrChain[responderOrChain.length - 1],
            middleware: responderOrChain.slice(0, -1),
        };
    }
    return { responder: responderOrChain, middleware: [] };
}

function _parseQuery(qs = '') {
    if (!qs) return {};
    return Object.fromEntries(new URLSearchParams(qs).entries());
}

function _buildQuery(params = {}) {
    const entries = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '');
    return entries.length ? new URLSearchParams(entries).toString() : '';
}

function _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}