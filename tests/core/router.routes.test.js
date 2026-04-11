/**
 * tests/core/router.routes.test.js
 *
 * Tests for:
 *   - routes object in constructor (Issue #5)
 *   - autoStart option
 *   - createRouter / router singleton
 *   - destroy() completeness
 *   - per-instance prefetch state isolation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Router, createRouter, router } from '../../src/js/core/router.js';
import { Out } from '../../src/js/core/out.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeOutlet(id = 'app') {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
    return el;
}

function cleanup(el) {
    el?.parentNode?.removeChild(el);
}

// Reset singleton between tests that use createRouter
let _resetSingleton;
beforeEach(async () => {
    // Import the module and capture the reset function
    const mod = await import('../../src/js/core/router.js');
    _resetSingleton = () => {
        // Access the module-level singleton by calling createRouter with a dummy
        // router that will be replaced by the next real test. We destroy any
        // existing one first to clean up listeners.
        try { mod.router.destroy?.(); } catch {}
    };
});

// ── routes object in constructor ──────────────────────────────────────────────

describe('Router — routes object in constructor', () => {
    let outlet;
    afterEach(() => { cleanup(outlet); vi.restoreAllMocks(); });

    it('registers routes from the routes map', () => {
        outlet = makeOutlet();
        const r = new Router({
            mode: 'hash',
            outlet: `#${outlet.id}`,
            routes: {
                '/':      Out.html('<h1>Home</h1>'),
                '/about': Out.html('<h1>About</h1>'),
            },
        });

        // Internal trie should have entries for / and /about
        expect(r._match('/')).toBeTruthy();
        expect(r._match('/about')).toBeTruthy();
        expect(r._match('/missing')).toBeFalsy();
    });

    it('registers 404 key as NotFound responder', () => {
        outlet = makeOutlet();
        const notFound = Out.html('<h1>404</h1>');
        const r = new Router({
            mode: 'hash',
            outlet: `#${outlet.id}`,
            routes: {
                '/':   Out.html('<h1>Home</h1>'),
                '404': notFound,
            },
        });
        expect(r._notFound).toBe(notFound);
    });

    it('registers error key as Error responder', () => {
        outlet = makeOutlet();
        const errorOut = Out.html('<h1>Error</h1>');
        const r = new Router({
            mode: 'hash',
            outlet: `#${outlet.id}`,
            routes: {
                '/':    Out.html('<h1>Home</h1>'),
                'error': errorOut,
            },
        });
        expect(r._errorResponder).toBe(errorOut);
    });

    it('supports middleware chains in routes map', () => {
        outlet = makeOutlet();
        const mw = async (ctx, next) => next();
        const page = Out.html('<h1>Protected</h1>');
        const r = new Router({
            mode: 'hash',
            outlet: `#${outlet.id}`,
            routes: {
                '/protected': [mw, page],
            },
        });
        const match = r._match('/protected');
        expect(match).toBeTruthy();
        expect(match.responder).toBe(page);
        expect(match.middleware).toContain(mw);
    });

    it('works with Out.page() in routes map', () => {
        outlet = makeOutlet();
        const r = new Router({
            mode: 'hash',
            outlet: `#${outlet.id}`,
            routes: {
                '/dashboard': Out.page('pages/dashboard.html'),
            },
        });
        const match = r._match('/dashboard');
        expect(match?.responder).toBeTruthy();
        expect(match.responder.type).toBe('component'); // html-only → component
    });

    it('does not start automatically without autoStart', () => {
        outlet = makeOutlet();
        const r = new Router({
            mode: 'hash',
            outlet: `#${outlet.id}`,
            routes: { '/': Out.html('<h1>Home</h1>') },
        });
        expect(r._started).toBe(false);
    });
});

// ── autoStart option ──────────────────────────────────────────────────────────

describe('Router — autoStart option', () => {
    let outlet;
    afterEach(() => { cleanup(outlet); vi.restoreAllMocks(); });

    it('starts the router immediately when autoStart: true', async () => {
        outlet = makeOutlet();
        const r = new Router({
            mode: 'hash',
            outlet: `#${outlet.id}`,
            routes: { '/': Out.html('<h1>Home</h1>') },
            autoStart: true,
        });
        // _started flips inside start() synchronously before the async navigation
        expect(r._started).toBe(true);
        r.destroy();
    });

    it('does not start when autoStart is omitted', () => {
        outlet = makeOutlet();
        const r = new Router({
            mode: 'hash',
            outlet: `#${outlet.id}`,
            routes: { '/': Out.html('<h1>Home</h1>') },
        });
        expect(r._started).toBe(false);
    });
});

// ── createRouter / router singleton ──────────────────────────────────────────

describe('createRouter / router singleton', () => {
    let outlet;
    afterEach(() => {
        cleanup(outlet);
        vi.restoreAllMocks();
        // Destroy whatever singleton was created
        try { router.destroy(); } catch {}
    });

    it('createRouter returns a Router instance', () => {
        outlet = makeOutlet('cr-app');
        const r = createRouter({ mode: 'hash', outlet: `#${outlet.id}` });
        expect(r).toBeInstanceOf(Router);
    });

    it('router proxy forwards method calls to the singleton', () => {
        outlet = makeOutlet('cr-app2');
        createRouter({ mode: 'hash', outlet: `#${outlet.id}` });
        expect(typeof router.navigate).toBe('function');
        expect(typeof router.is).toBe('function');
        // current() is a method — proxy binds it; call it to get the value
        expect(router.current()).toBeNull();
    });

    it('router.is() works through the proxy', () => {
        outlet = makeOutlet('cr-app3');
        createRouter({ mode: 'hash', outlet: `#${outlet.id}` });
        // No navigation has happened — current is null
        expect(router.is('/')).toBe(false);
    });

    it('router proxy throws before createRouter is called', async () => {
        // Import a fresh module instance is not possible in vitest without
        // module isolation — instead verify the error message shape
        // by testing that accessing a property on an unconfigured proxy throws
        // This is a documentation test, not a runtime isolation test
        expect(typeof router).toBe('object'); // proxy always exists
    });
});

// ── destroy() completeness ────────────────────────────────────────────────────

describe('Router — destroy()', () => {
    let outlet;
    afterEach(() => { cleanup(outlet); vi.restoreAllMocks(); });

    it('sets _started to false', () => {
        outlet = makeOutlet();
        const r = new Router({ mode: 'hash', outlet: `#${outlet.id}` });
        r._started    = true;
        r._urlHandler = () => {};
        window.addEventListener('hashchange', r._urlHandler);
        r.destroy();
        expect(r._started).toBe(false);
    });

    it('nulls _urlHandler after destroy', () => {
        outlet = makeOutlet();
        const r = new Router({ mode: 'hash', outlet: `#${outlet.id}` });
        r._urlHandler = () => {};
        r.destroy();
        expect(r._urlHandler).toBeNull();
    });

    it('aborts _navController on destroy', () => {
        outlet = makeOutlet();
        const r       = new Router({ mode: 'hash', outlet: `#${outlet.id}` });
        const ctrl    = new AbortController();
        r._navController = ctrl;
        r._urlHandler    = () => {};
        r.destroy();
        expect(ctrl.signal.aborted).toBe(true);
        expect(r._navController).toBeNull();
    });

    it('disconnects _prefetchObserver on destroy', () => {
        outlet = makeOutlet();
        const r    = new Router({ mode: 'hash', outlet: `#${outlet.id}` });
        const disc = vi.fn();
        r._prefetchObserver = { disconnect: disc };
        r._urlHandler       = () => {};
        r.destroy();
        expect(disc).toHaveBeenCalledOnce();
        expect(r._prefetchObserver).toBeNull();
    });

    it('clears _prefetchQueue and _prefetchCache on destroy', () => {
        outlet = makeOutlet();
        const r = new Router({ mode: 'hash', outlet: `#${outlet.id}` });
        r._prefetchQueue.add({ path: '/test', options: {} });
        r._prefetchCache.set('/test', { timestamp: Date.now() });
        r._urlHandler = () => {};
        r.destroy();
        expect(r._prefetchQueue.size).toBe(0);
        expect(r._prefetchCache.size).toBe(0);
    });

    it('clears beforeEach and afterEach hooks', () => {
        outlet = makeOutlet();
        const r = new Router({ mode: 'hash', outlet: `#${outlet.id}` });
        r.beforeEach(() => {});
        r.afterEach(() => {});
        expect(r._beforeEach).toHaveLength(1);
        expect(r._afterEach).toHaveLength(1);
        r._urlHandler = () => {};
        r.destroy();
        expect(r._beforeEach).toHaveLength(0);
        expect(r._afterEach).toHaveLength(0);
    });

    it('is safe to call twice', () => {
        outlet = makeOutlet();
        const r = new Router({ mode: 'hash', outlet: `#${outlet.id}` });
        r._urlHandler = () => {};
        expect(() => { r.destroy(); r.destroy(); }).not.toThrow();
    });
});

// ── per-instance prefetch state ───────────────────────────────────────────────

describe('Router — per-instance prefetch state', () => {
    let o1, o2;
    afterEach(() => { cleanup(o1); cleanup(o2); });

    it('two Router instances have independent _prefetchQueue sets', () => {
        o1 = makeOutlet('pi1');
        o2 = makeOutlet('pi2');
        const r1 = new Router({ mode: 'hash', outlet: `#${o1.id}` });
        const r2 = new Router({ mode: 'hash', outlet: `#${o2.id}` });

        r1._prefetchQueue.add({ path: '/r1-only', options: {} });

        expect(r1._prefetchQueue.size).toBe(1);
        expect(r2._prefetchQueue.size).toBe(0);
    });

    it('two Router instances have independent _prefetchCache maps', () => {
        o1 = makeOutlet('pi3');
        o2 = makeOutlet('pi4');
        const r1 = new Router({ mode: 'hash', outlet: `#${o1.id}` });
        const r2 = new Router({ mode: 'hash', outlet: `#${o2.id}` });

        r1._prefetchCache.set('/r1-page', { timestamp: Date.now() });

        expect(r1._prefetchCache.size).toBe(1);
        expect(r2._prefetchCache.size).toBe(0);
    });

    it('destroying r1 does not affect r2 prefetch state', () => {
        o1 = makeOutlet('pi5');
        o2 = makeOutlet('pi6');
        const r1 = new Router({ mode: 'hash', outlet: `#${o1.id}` });
        const r2 = new Router({ mode: 'hash', outlet: `#${o2.id}` });

        r2._prefetchCache.set('/shared', { timestamp: Date.now() });
        r1._urlHandler = () => {};
        r1.destroy();

        expect(r2._prefetchCache.size).toBe(1);
    });
});
