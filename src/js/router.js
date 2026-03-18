/**
 * oja/router.js
 * SPA navigation — Go-style middleware, groups, and Race-Safe rendering.
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
 *   import { Responder } from '../oja/responder.js';
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
 *   r.Get('/login',  Responder.component('pages/login.html'));
 *   r.Get('/about',  Responder.component('pages/about.html'));
 *
 *   // Protected group — middleware applied to all routes inside
 *   const app = r.Group('/');
 *   app.Use(auth.middleware('protected', '/login'));
 *   app.Get('dashboard', Responder.component('pages/dashboard.html'));
 *   app.Get('hosts',     Responder.component('pages/hosts.html'));
 *
 *   // Nested group with URL params
 *   app.Route('hosts/{id}', host => {
 *       host.Use(loadHostMiddleware);
 *       host.Get('/', Responder.component('pages/host-detail.html'));
 *   });
 *
 *   // Chain of responsibility on a single route
 *   r.Get('/audit', [requireAuth, requireAuditor,
 *       Responder.component('pages/audit.html')
 *   ]);
 *
 *   r.NotFound(Responder.component('pages/404.html'));
 *   r.start('/login');
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
 *   // Useful for syncing filter/sort state to the URL so it's shareable.
 *   router.setQuery({ filter: 'alive', sort: 'name' });
 *
 *   // Read current query params
 *   router.params();  // → { filter: 'alive', sort: 'name', ...routeParams }
 */

import { Store }     from './store.js';
import { Responder } from './responder.js';
import { component } from './component.js';

const _store = new Store('oja:router');

// ─── Route trie node ──────────────────────────────────────────────────────────

class _RouteNode {
    constructor(segment = '') {
        this.segment    = segment;
        this.responder  = null;       // Responder instance
        this.middleware = [];         // middleware declared at this node
        this.children   = new Map();  // static children: segment → node
        this.paramChild = null;       // single param child node
        this.paramName  = null;       // name of the param (e.g. 'id')
    }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export class Router {
    /**
     * @param {Object} options
     *   mode    : 'hash' | 'path'  — URL strategy (default: 'hash')
     *   outlet  : string           — CSS selector for page container (default: '#app')
     *   loading : Responder        — shown immediately while page loads (default: none)
     */
    constructor({ mode = 'hash', outlet = '#app', loading = null } = {}) {
        this._mode             = mode;
        this._outlet           = outlet;
        this._loadingResponder = loading;
        this._root             = new _RouteNode();
        this._globalMiddleware = [];
        this._notFound         = Responder.html('<div class="oja-404"><h2>404</h2><p>Page not found</p></div>');
        this._errorResponder   = Responder.html('<div class="oja-error"><h2>Error</h2><p>Something went wrong</p></div>');
        this._current          = null;
        this._params           = {};
        this._started          = false;
        this._navId            = 0;
        this._beforeEach       = [];
        this._afterEach        = [];
    }

    // ─── Middleware ───────────────────────────────────────────────────────────

    /**
     * Add middleware to this router/group scope.
     * Runs in order before the route's Responder renders.
     * async (ctx, next) => { ... await next(); ... }
     */
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
     * responderOrChain can be a Responder or [...middleware, Responder].
     */
    Get(pattern, responderOrChain) {
        const { responder, middleware } = _unwrapChain(responderOrChain);
        this._addRoute(pattern, responder, middleware);
        return this;
    }

    /** Not found handler — shown when no route matches. */
    NotFound(responder) { this._notFound = responder; return this; }

    /** Error handler — shown when middleware or render throws. */
    Error(responder)    { this._errorResponder = responder; return this; }

    // ─── Grouping ─────────────────────────────────────────────────────────────

    /**
     * Create a scoped sub-router at a path prefix.
     * The group inherits parent middleware and can add its own.
     */
    Group(prefix, fn) {
        const groupRoot = this._findOrCreate(prefix);
        const group     = new Router({ mode: this._mode, outlet: this._outlet });
        group._root             = groupRoot;
        group._globalMiddleware = [...this._globalMiddleware];
        group._notFound         = this._notFound;
        group._errorResponder   = this._errorResponder;
        if (fn) fn(group);
        return group;
    }

    /**
     * Register a nested route block — used for URL param segments.
     */
    Route(pattern, fn) {
        const node = this._findOrCreate(pattern);
        const sub  = new Router({ mode: this._mode, outlet: this._outlet });
        sub._root             = node;
        sub._globalMiddleware = [...this._globalMiddleware];
        sub._notFound         = this._notFound;
        sub._errorResponder   = this._errorResponder;
        fn(sub);
        return this;
    }

    // ─── Query string ─────────────────────────────────────────────────────────

    /**
     * Update URL query params without triggering a full navigation.
     * Use to sync reactive filter/sort state to the URL so links are shareable.
     */
    setQuery(params = {}) {
        if (!this._current) return this;

        // Ensure current path is stripped of existing query strings before appending
        const cleanPath = this._current.split('?')[0];
        const qs  = _buildQuery(params);

        const url = (this._mode === 'hash' ? '#' : '') + cleanPath + (qs ? '?' + qs : '');

        window.history.replaceState({ path: cleanPath, params }, '', url);
        this._params = { ...this._params, ...params };
        return this;
    }

    // ─── Start ────────────────────────────────────────────────────────────────

    /**
     * Start the router — reads current URL, sets up history listeners.
     */
    async start(defaultPath = '/') {
        if (this._started) return;
        this._started = true;

        const eventName = this._mode === 'hash' ? 'hashchange' : 'popstate';
        window.addEventListener(eventName, () => this._handleURL(defaultPath));

        await this._handleURL(defaultPath);
    }

    async _handleURL(defaultPath = '/') {
        const { path, query } = this._parseURL();
        await this.navigate(path || defaultPath, { query });
    }

    // ─── Navigation ───────────────────────────────────────────────────────────

    /**
     * Navigate to a path — updates URL, runs middleware chain, renders Responder.
     * Race-safe: only the most recent navigate() call is allowed to complete.
     */
    async navigate(path, options = {}) {
        const currentNavId = ++this._navId; // Capture current navigation version
        const [pathname, qs] = path.split('?');
        const query          = { ...options.query, ..._parseQuery(qs || '') };
        const container      = document.querySelector(this._outlet);

        if (!options._replace) this._pushURL(pathname, query);

        // Emit navigate:start — ui.js uses this to show loading indicators
        document.dispatchEvent(new CustomEvent('oja:navigate:start', {
            detail: { path: pathname }
        }));

        // Show loading Responder immediately if provided
        if (this._loadingResponder && container) {
            container.innerHTML = '';
            await this._loadingResponder.render(container, {});
        }

        // RACE CHECK: Stop if user navigated elsewhere during initial phase
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

        // SCOPED LIFECYCLE: Teardown outgoing page before rendering new one
        if (container) await component._runUnmount(container);

        if (!match) {
            for (const fn of this._beforeEach) await fn(ctx);
            await this._render(this._notFound, ctx);
            for (const fn of this._afterEach) await fn(ctx);
            if (container) await component._runMount(container); // Mount 404
            return;
        }

        ctx.params = { ...match.params, ...query };

        for (const fn of this._beforeEach) {
            const stop = await fn(ctx);
            if (stop === false) return;
        }

        // Build and deduplicate middleware chain
        const allMiddleware = [...this._globalMiddleware, ...match.middleware];
        const seen  = new Set();
        const chain = allMiddleware.filter(mw => {
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

            // RACE CHECK: middleware often hits network — check lock again
            if (currentNavId !== this._navId) return;

            if (result === false) { stopped = true; return; }

            if (Responder.is(result)) {
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
        _store.set('page', pathname);
        _store.set('params', ctx.params);

        try {
            await this._render(match.responder, ctx);
        } catch (err) {
            console.error('[oja/router] render error:', err);
            await this._render(this._errorResponder, { ...ctx, error: err });
            return;
        }

        this._updateNav(pathname);

        for (const fn of this._afterEach) await fn(ctx);

        // SCOPED LIFECYCLE: Initialize incoming page after render
        if (container) await component._runMount(container);

        // Notify final completion
        document.dispatchEvent(new CustomEvent('oja:navigate:end', {
            detail: { path: pathname, params: ctx.params }
        }));

        // Legacy event kept for compatibility
        document.dispatchEvent(new CustomEvent('oja:navigate', {
            detail: { path: pathname, params: ctx.params }
        }));
    }

    async _render(responder, ctx) {
        const container = document.querySelector(this._outlet);
        if (!container) return;

        // Transitions
        container.classList.add('oja-leaving');
        await _wait(150);
        container.classList.remove('oja-leaving');

        container.innerHTML = '';
        await responder.render(container, ctx);

        container.classList.add('oja-entering');
        await _wait(50);
        container.classList.remove('oja-entering');
    }

    /** Go back in browser history. */
    back() { window.history.back(); }

    /** Force re-render the current route — re-runs full middleware chain. */
    async refresh() {
        if (!this._current) return;
        await this.navigate(this._current, { query: this._params, _replace: true });
    }

    /** Navigate without adding a history entry. */
    async replace(path, options = {}) {
        await this.navigate(path, { ...options, _replace: true });
    }

    current() { return this._current; }
    params()  { return { ...this._params }; }

    // ─── URL helpers ──────────────────────────────────────────────────────────

    _parseURL() {
        if (this._mode === 'hash') {
            const hash       = window.location.hash.slice(1) || '';
            const [path, qs] = hash.split('?');
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
        const url = this._buildURL(path, params);
        if (window.location.href !== new URL(url, window.location.href).href) {
            window.history.pushState({ path, params }, '', url);
        }
    }

    _updateNav(path) {
        document.querySelectorAll('[data-page]').forEach(el => {
            el.classList.toggle('active', el.dataset.page === path);
        });
        document.querySelectorAll('[data-href]').forEach(el => {
            el.classList.toggle('active', el.dataset.href === path);
        });
    }

    _addRoute(pattern, responder, routeMiddleware = []) {
        const node = this._findOrCreate(pattern);
        node.responder  = responder;
        node.middleware = [...this._globalMiddleware, ...routeMiddleware];
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
                if (!node.children.has(seg)) {
                    node.children.set(seg, new _RouteNode(seg));
                }
                node = node.children.get(seg);
            }
        }
        return node;
    }

    _match(pathname) {
        const parts      = _segments(pathname);
        const params     = {};
        let   node       = this._root;
        const middleware = [];

        for (const part of parts) {
            if (node.children.has(part)) {
                node = node.children.get(part);
            } else if (node.paramChild) {
                node = node.paramChild;
                params[node.paramName] = decodeURIComponent(part);
            } else {
                return null;
            }
            if (node.middleware.length) middleware.push(...node.middleware);
        }

        if (!node.responder) return null;
        return { responder: node.responder, params, middleware };
    }
}

// ─── Built-in middleware ──────────────────────────────────────────────────────

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
     * Error boundary — catches errors in the chain and renders error Responder.
     *   r.Use(Router.middleware.errorBoundary(Responder.component('pages/error.html')));
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
        const title = container?.querySelector('[data-title]')?.dataset?.title;
        document.title = title ? `${title} — ${appName}` : appName;
    }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _segments(path) {
    return path.split('/').filter(Boolean);
}

function _unwrapChain(responderOrChain) {
    if (Array.isArray(responderOrChain)) {
        const last       = responderOrChain[responderOrChain.length - 1];
        const middleware = responderOrChain.slice(0, -1);
        return { responder: last, middleware };
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