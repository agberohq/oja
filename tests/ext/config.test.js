import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { config } from '../../src/js/ext/config.js';


function mockFetch(responses) {
    const fn = vi.fn().mockImplementation((url) => {
        if (url in responses) {
            const resp = responses[url];
            if (resp === 404) {
                return Promise.resolve({ ok: false, status: 404 });
            }
            if (resp instanceof Error) {
                return Promise.reject(resp);
            }
            return Promise.resolve({
                ok:   true,
                status: 200,
                json: () => Promise.resolve(resp),
            });
        }
        return Promise.resolve({ ok: false, status: 404 });
    });
    vi.stubGlobal('fetch', fn);
    return fn;
}

const FULL_CONFIG = {
    version: '1.0.0',
    name:    'test-app',
    vfs: {
        manifest:   'vfs.json',
        conflict:   'keep-local',
        sync: { auto: true, interval: 30000 },
    },
    routes: {
        protected: ['/admin', '/settings'],
        fallback:  '/index.html',
    },
    auth: {
        loginPath:   '/login',
        defaultPath: '/dashboard',
    },
};


describe('config — load()', () => {
    beforeEach(() => config.reset());
    afterEach(() => vi.restoreAllMocks());

    it('returns false and does not throw when config file is absent (404)', async () => {
        mockFetch({ 'oja.config.json': 404 });
        const result = await config.load();
        expect(result).toBe(false);
        expect(config.loaded).toBe(false);
    });

    it('returns false when fetch throws a network error', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')));
        const result = await config.load();
        expect(result).toBe(false);
        expect(config.loaded).toBe(false);
    });

    it('returns true and sets loaded when config is found', async () => {
        mockFetch({ 'oja.config.json': FULL_CONFIG });
        const result = await config.load();
        expect(result).toBe(true);
        expect(config.loaded).toBe(true);
    });

    it('loads from a base URL', async () => {
        mockFetch({ 'https://cdn.example.com/app/oja.config.json': FULL_CONFIG });
        const result = await config.load('https://cdn.example.com/app/');
        expect(result).toBe(true);
    });

    it('appends trailing slash to base URL if missing', async () => {
        mockFetch({ 'https://cdn.example.com/app/oja.config.json': FULL_CONFIG });
        const result = await config.load('https://cdn.example.com/app');
        expect(result).toBe(true);
    });

    it('throws when server returns a non-404 error', async () => {
        mockFetch({ 'oja.config.json': 500 });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
        await expect(config.load()).rejects.toThrow('HTTP 500');
    });

    it('throws on invalid JSON', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok:   true,
            status: 200,
            json: () => Promise.reject(new SyntaxError('Unexpected token')),
        }));
        await expect(config.load()).rejects.toThrow();
    });

    it('replaces cached config on second load()', async () => {
        mockFetch({ 'oja.config.json': { version: '1.0.0', name: 'v1' } });
        await config.load();
        expect(config.get('name')).toBe('v1');

        mockFetch({ 'oja.config.json': { version: '2.0.0', name: 'v2' } });
        await config.load();
        expect(config.get('name')).toBe('v2');
    });
});


describe('config — get()', () => {
    beforeEach(async () => {
        config.reset();
        mockFetch({ 'oja.config.json': FULL_CONFIG });
        await config.load();
    });
    afterEach(() => vi.restoreAllMocks());

    it('returns a top-level section by key', () => {
        expect(config.get('version')).toBe('1.0.0');
        expect(config.get('name')).toBe('test-app');
    });

    it('returns the vfs section as an object', () => {
        expect(config.get('vfs')).toEqual(FULL_CONFIG.vfs);
    });

    it('returns null for an absent key', () => {
        expect(config.get('nonexistent')).toBeNull();
    });

    it('returns null when config is not loaded', () => {
        config.reset();
        expect(config.get('name')).toBeNull();
    });
});


describe('config — all()', () => {
    afterEach(() => { vi.restoreAllMocks(); config.reset(); });

    it('returns empty object when not loaded', () => {
        expect(config.all()).toEqual({});
    });

    it('returns full config when loaded', async () => {
        mockFetch({ 'oja.config.json': FULL_CONFIG });
        await config.load();
        expect(config.all()).toEqual(FULL_CONFIG);
    });

    it('returns a copy — mutations do not affect the cache', async () => {
        mockFetch({ 'oja.config.json': { name: 'app' } });
        await config.load();
        const copy = config.all();
        copy.name = 'mutated';
        expect(config.get('name')).toBe('app');
    });
});


describe('config — reset()', () => {
    afterEach(() => vi.restoreAllMocks());

    it('clears loaded state', async () => {
        mockFetch({ 'oja.config.json': { name: 'app' } });
        await config.load();
        expect(config.loaded).toBe(true);
        config.reset();
        expect(config.loaded).toBe(false);
        expect(config.get('name')).toBeNull();
    });
});


describe('config — applyVFS()', () => {
    afterEach(() => { vi.restoreAllMocks(); config.reset(); });

    it('is a no-op when config is not loaded', async () => {
        const vfs = { mount: vi.fn() };
        await config.applyVFS(vfs, 'https://cdn.example.com/');
        expect(vfs.mount).not.toHaveBeenCalled();
    });

    it('is a no-op when vfs section is absent', async () => {
        mockFetch({ 'oja.config.json': { version: '1.0.0' } });
        await config.load();
        const vfs = { mount: vi.fn() };
        await config.applyVFS(vfs, 'https://cdn.example.com/');
        expect(vfs.mount).not.toHaveBeenCalled();
    });

    it('calls vfs.mount() with the base URL', async () => {
        mockFetch({ 'oja.config.json': { vfs: {} } });
        await config.load();
        const vfs = { mount: vi.fn().mockResolvedValue({}) };
        await config.applyVFS(vfs, 'https://cdn.example.com/app/');
        expect(vfs.mount).toHaveBeenCalledWith('https://cdn.example.com/app/', expect.any(Object));
    });

    it('passes manifest from config to mount opts', async () => {
        mockFetch({ 'oja.config.json': { vfs: { manifest: 'custom.json' } } });
        await config.load();
        const vfs = { mount: vi.fn().mockResolvedValue({}) };
        await config.applyVFS(vfs, 'https://cdn.example.com/');
        const opts = vfs.mount.mock.calls[0][1];
        expect(opts.manifest).toBe('custom.json');
    });

    it('passes poll interval when sync.auto is true', async () => {
        mockFetch({ 'oja.config.json': { vfs: { sync: { auto: true, interval: 60000 } } } });
        await config.load();
        const vfs = { mount: vi.fn().mockResolvedValue({}) };
        await config.applyVFS(vfs, 'https://cdn.example.com/');
        const opts = vfs.mount.mock.calls[0][1];
        expect(opts.poll).toBe(60000);
    });

    it('does not pass poll when sync.auto is false', async () => {
        mockFetch({ 'oja.config.json': { vfs: { sync: { auto: false, interval: 60000 } } } });
        await config.load();
        const vfs = { mount: vi.fn().mockResolvedValue({}) };
        await config.applyVFS(vfs, 'https://cdn.example.com/');
        const opts = vfs.mount.mock.calls[0][1];
        expect(opts.poll).toBeUndefined();
    });

    it('passes conflict policy to mount opts', async () => {
        mockFetch({ 'oja.config.json': { vfs: { conflict: 'take-remote' } } });
        await config.load();
        const vfs = { mount: vi.fn().mockResolvedValue({}) };
        await config.applyVFS(vfs, 'https://cdn.example.com/');
        const opts = vfs.mount.mock.calls[0][1];
        expect(opts.onConflict).toBe('take-remote');
    });
});


describe('config — applyRouter()', () => {
    afterEach(() => { vi.restoreAllMocks(); config.reset(); });

    it('is a no-op when config is not loaded', () => {
        const router = { Use: vi.fn() };
        config.applyRouter(router, {});
        expect(router.Use).not.toHaveBeenCalled();
    });

    it('is a no-op when routes section is absent', async () => {
        mockFetch({ 'oja.config.json': { version: '1.0.0' } });
        await config.load();
        const router = { Use: vi.fn() };
        config.applyRouter(router, {});
        expect(router.Use).not.toHaveBeenCalled();
    });

    it('does not register middleware when auth dep is missing', async () => {
        mockFetch({ 'oja.config.json': { routes: { protected: ['/admin'] } } });
        await config.load();
        const router = { Use: vi.fn() };
        config.applyRouter(router, {});
        expect(router.Use).not.toHaveBeenCalled();
    });

    it('registers Use middleware for each protected route when auth is provided', async () => {
        mockFetch({ 'oja.config.json': { routes: { protected: ['/admin', '/settings'] } } });
        await config.load();
        const router = { Use: vi.fn() };
        const auth   = { session: { isActive: vi.fn().mockReturnValue(true) } };
        config.applyRouter(router, { auth });
        expect(router.Use).toHaveBeenCalledTimes(2);
    });

    it('middleware calls next() when session is active and path matches', async () => {
        mockFetch({ 'oja.config.json': { routes: { protected: ['/admin'] } } });
        await config.load();

        let capturedMw;
        const router = { Use: vi.fn((mw) => { capturedMw = mw; }) };
        const auth   = { session: { isActive: vi.fn().mockReturnValue(true) } };
        config.applyRouter(router, { auth });

        const next = vi.fn();
        await capturedMw({ path: '/admin/users' }, next);
        expect(next).toHaveBeenCalled();
    });

    it('middleware redirects to /login when session is not active', async () => {
        mockFetch({ 'oja.config.json': { routes: { protected: ['/admin'] } } });
        await config.load();

        let capturedMw;
        const router = { Use: vi.fn((mw) => { capturedMw = mw; }) };
        const auth   = { session: { isActive: vi.fn().mockReturnValue(false) } };
        config.applyRouter(router, { auth });

        const ctx = { path: '/admin/users', redirect: vi.fn() };
        await capturedMw(ctx, vi.fn());
        expect(ctx.redirect).toHaveBeenCalledWith('/login');
    });

    it('middleware calls next() for non-matching paths', async () => {
        mockFetch({ 'oja.config.json': { routes: { protected: ['/admin'] } } });
        await config.load();

        let capturedMw;
        const router = { Use: vi.fn((mw) => { capturedMw = mw; }) };
        const auth   = { session: { isActive: vi.fn().mockReturnValue(false) } };
        config.applyRouter(router, { auth });

        const next = vi.fn();
        await capturedMw({ path: '/login', redirect: vi.fn() }, next);
        expect(next).toHaveBeenCalled();
    });

    it('uses custom loginPath from auth config', async () => {
        mockFetch({ 'oja.config.json': {
                routes: { protected: ['/admin'] },
                auth:   { loginPath: '/sign-in' },
            }});
        await config.load();

        let capturedMw;
        const router = { Use: vi.fn((mw) => { capturedMw = mw; }) };
        const auth   = { session: { isActive: vi.fn().mockReturnValue(false) } };
        config.applyRouter(router, { auth });

        const ctx = { path: '/admin', redirect: vi.fn() };
        await capturedMw(ctx, vi.fn());
        expect(ctx.redirect).toHaveBeenCalledWith('/sign-in');
    });
});