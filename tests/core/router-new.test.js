import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Router } from '../../src/js/core/router.js';

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    window.location.hash = '';
});


describe('router.destroy()', () => {
    it('exposes a destroy() method', () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });
        expect(typeof r.destroy).toBe('function');
    });

    it('can be called before start() without throwing', () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });
        expect(() => r.destroy()).not.toThrow();
    });

    it('removes the hashchange listener so a second router can take over', async () => {
        const r1 = new Router({ mode: 'hash', outlet: '#app' });
        r1.Get('/', { render: () => {} });
        await r1.start('/');
        r1.destroy();

        // r2 should work independently without double-firing from r1
        const r2 = new Router({ mode: 'hash', outlet: '#app' });
        expect(() => r2.start('/')).not.toThrow();
    });
});


describe('router.name() / router.path() / router.navigateTo()', () => {
    it('path() returns URL built from named route and params', () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });
        r.name('host.routes', '/hosts/{id}/routes');
        expect(r.path('host.routes', { id: '42' })).toBe('/hosts/42/routes');
    });

    it('path() encodes param values', () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });
        r.name('search', '/search/{q}');
        expect(r.path('search', { q: 'hello world' })).toBe('/search/hello%20world');
    });

    it('path() warns and returns "/" for unknown name', () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(r.path('unknown.route', {})).toBe('/');
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('name() returns router for chaining', () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });
        expect(r.name('test', '/test')).toBe(r);
    });
});


describe('router.is(pattern)', () => {
    it('returns false when no current route', () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });
        expect(r.is('/hosts')).toBe(false);
    });

    it('matches exact path', async () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });
        r.Get('/hosts', { render: async () => {} });
        await r.start('/hosts');
        await r.navigate('/hosts');
        expect(r.is('/hosts')).toBe(true);
    });

    it('matches wildcard pattern', async () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });
        r.Get('/hosts/{id}', { render: async () => {} });
        await r.start('/hosts/42');
        await r.navigate('/hosts/42');
        expect(r.is('/hosts/*')).toBe(true);
        expect(r.is('/config/*')).toBe(false);
    });
});


describe('router.param(name)', () => {
    it('returns null when no params', () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });
        expect(r.param('id')).toBeNull();
    });

    it('returns the value of a named param after navigation', async () => {
        let capturedParams = null;
        const r = new Router({ mode: 'hash', outlet: '#app' });
        r.Get('/hosts/{id}', {
            render: async () => { capturedParams = r.params(); },
        });
        r.start('/hosts/abc');
        await r.navigate('/hosts/abc');
        expect(r.param('id')).toBe('abc');
    });
});