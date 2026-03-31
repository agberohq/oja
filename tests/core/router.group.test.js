import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Router } from '../../src/js/core/router.js';
import { Out } from '../../src/js/core/out.js';

function makeOutlet() {
    const div = document.createElement('div');
    div.id = 'app';
    document.body.appendChild(div);
    return div;
}

beforeEach(() => {
    document.body.innerHTML = '';
    window.location.hash = '';
});


describe('Router.Group() — prefix composition', () => {
    it('composes group prefix with child routes', () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });
        const app = r.Group('/app');
        app.Get('/hosts', Out.html('<p>hosts</p>'));

        const match = r._match('/app/hosts');
        expect(match).not.toBeNull();
        expect(match.responder).toBeDefined();
    });

    it('nested groups compose correctly', () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });
        const app = r.Group('/app');
        const hosts = app.Group('/hosts');
        hosts.Get('/{id}', Out.html('<p>detail</p>'));

        const match = r._match('/app/hosts/42');
        expect(match).not.toBeNull();
        expect(match.params.id).toBe('42');
    });

    it('group with trailing slash handles child routes correctly', () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });
        const app = r.Group('/app/');
        app.Get('/dashboard', Out.html('<p>dash</p>'));

        const match = r._match('/app/dashboard');
        expect(match).not.toBeNull();
    });

    it('group root path registers correctly', () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });
        const app = r.Group('/app');
        app.Get('/', Out.html('<p>root</p>'));

        const match = r._match('/app');
        expect(match).not.toBeNull();
    });
});


describe('Router.Group() — middleware scoping', () => {
    it('group Use() does not affect parent routes', () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });
        const groupMw = vi.fn(async (ctx, next) => next());

        r.Get('/public', Out.html('<p>public</p>'));

        const app = r.Group('/app');
        app.Use(groupMw);
        app.Get('/private', Out.html('<p>private</p>'));

        const publicMatch  = r._match('/public');
        const privateMatch = r._match('/app/private');

        expect(publicMatch.middleware).not.toContain(groupMw);
        expect(privateMatch.middleware).toContain(groupMw);
    });

    it('group inherits parent global middleware', () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });
        const globalMw = vi.fn(async (ctx, next) => next());
        r.Use(globalMw);

        const app = r.Group('/app');
        app.Get('/hosts', Out.html('<p>hosts</p>'));

        const match = r._match('/app/hosts');
        expect(match.middleware).toContain(globalMw);
    });

    it('nested group stacks middleware correctly', () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });
        const mwA = vi.fn(async (ctx, next) => next());
        const mwB = vi.fn(async (ctx, next) => next());

        const app   = r.Group('/app');
        app.Use(mwA);
        const admin = app.Group('/admin');
        admin.Use(mwB);
        admin.Get('/users', Out.html('<p>users</p>'));

        const match = r._match('/app/admin/users');
        expect(match.middleware).toContain(mwA);
        expect(match.middleware).toContain(mwB);
        expect(match.middleware.indexOf(mwA)).toBeLessThan(match.middleware.indexOf(mwB));
    });
});


describe('Router.Group() — named routes', () => {
    it('group.name() registers on the parent router', () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });
        const app = r.Group('/app');
        app.Get('/hosts/{id}', Out.html('<p>host</p>'));
        app.name('host.detail', '/hosts/{id}');

        const url = r.path('host.detail', { id: 42 });
        expect(url).toBe('/app/hosts/42');
    });

    it('parent can navigate to group named route', () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });
        const app = r.Group('/app');
        app.name('dashboard', '/dashboard');
        app.Get('/dashboard', Out.html('<p>dash</p>'));

        expect(r.path('dashboard', {})).toBe('/app/dashboard');
    });
});


describe('Router.Route() — param blocks', () => {
    it('Route() registers nested param routes', () => {
        const r = new Router({ mode: 'hash', outlet: '#app' });

        r.Route('/hosts/{id}', hosts => {
            hosts.Get('/', Out.html('<p>detail</p>'));
            hosts.Get('/routes', Out.html('<p>routes</p>'));
        });

        expect(r._match('/hosts/42')).not.toBeNull();
        expect(r._match('/hosts/42/routes')).not.toBeNull();
        expect(r._match('/hosts/42/routes').params.id).toBe('42');
    });
});