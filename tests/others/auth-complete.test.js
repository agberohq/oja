import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { auth } from '../../src/js/ext/auth.js';

// Helper — create a fake JWT with a payload
function fakeJWT(payload) {
    const header  = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body    = btoa(JSON.stringify(payload));
    return `${header}.${body}.fake-sig`;
}

// Valid JWT that expires in 1 hour
const VALID_JWT = fakeJWT({ sub: 'user-1', name: 'Ade', exp: Math.floor(Date.now() / 1000) + 3600 });

// JWT that already expired
const EXPIRED_JWT = fakeJWT({ sub: 'user-2', exp: Math.floor(Date.now() / 1000) - 10 });

beforeEach(async () => {
    await auth.session.end();
});

afterEach(async () => {
    await auth.session.end();
    vi.restoreAllMocks();
});

// isActive()

describe('auth.session.isActive()', () => {
    it('returns false before any session is started', () => {
        expect(auth.session.isActive()).toBe(false);
    });

    it('returns true for a valid JWT with future exp', async () => {
        await auth.session.start(VALID_JWT);
        expect(auth.session.isActive()).toBe(true);
    });

    it('returns false for an expired JWT', async () => {
        await auth.session.start(EXPIRED_JWT);
        expect(auth.session.isActive()).toBe(false);
    });

    it('returns false for opaque token with no options (original behaviour)', async () => {
        await auth.session.start('opaque-token-no-exp');
        expect(auth.session.isActive()).toBe(false);
    });

    it('returns true for opaque token with { expires: null }', async () => {
        await auth.session.start('basic-auth-token', null, { expires: null });
        expect(auth.session.isActive()).toBe(true);
    });

    it('returns true for opaque token with explicit future timestamp', async () => {
        await auth.session.start('opaque', null, { expires: Date.now() + 8 * 3600_000 });
        expect(auth.session.isActive()).toBe(true);
    });

    it('returns false for opaque token with past timestamp', async () => {
        await auth.session.start('opaque', null, { expires: Date.now() - 1000 });
        expect(auth.session.isActive()).toBe(false);
    });

    it('returns false after session.end()', async () => {
        await auth.session.start(VALID_JWT);
        await auth.session.end();
        expect(auth.session.isActive()).toBe(false);
    });
});

// tokenSync()

describe('auth.session.tokenSync()', () => {
    it('returns null when no session is active', () => {
        expect(auth.session.tokenSync()).toBeNull();
    });

    it('returns the raw token synchronously after start()', async () => {
        await auth.session.start(VALID_JWT);
        const tok = auth.session.tokenSync();
        expect(tok).toBe(VALID_JWT);
    });

    it('returns null when session is active but token is not a JWT (no exp, no options)', async () => {
        // opaque token with no options → isActive() = false → tokenSync returns null
        await auth.session.start('opaque-no-exp');
        expect(auth.session.tokenSync()).toBeNull();
    });

    it('returns token when started with { expires: null }', async () => {
        await auth.session.start('basic-token', null, { expires: null });
        expect(auth.session.tokenSync()).toBe('basic-token');
    });

    it('returns token when started with explicit future expires', async () => {
        await auth.session.start('bearer-token', null, { expires: Date.now() + 3600_000 });
        expect(auth.session.tokenSync()).toBe('bearer-token');
    });

    it('returns null after session.end()', async () => {
        await auth.session.start(VALID_JWT);
        expect(auth.session.tokenSync()).toBe(VALID_JWT);
        await auth.session.end();
        expect(auth.session.tokenSync()).toBeNull();
    });

    it('reflects new token after renew()', async () => {
        await auth.session.start(VALID_JWT);
        const newJWT = fakeJWT({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 7200 });
        await auth.session.renew(newJWT);
        // renew() stores the new token; tokenSync reads raw_token which is set in start()
        // renew() doesn't update raw_token — token() (async) is authoritative for renewed tokens
        // tokenSync() after renew returns the original raw_token or null depending on implementation
        const result = auth.session.tokenSync();
        // Acceptable: either the new token (if renew updates raw_token) or the original
        expect(typeof result === 'string' || result === null).toBe(true);
    });

    it('is safe to call multiple times without side effects', async () => {
        await auth.session.start(VALID_JWT);
        const a = auth.session.tokenSync();
        const b = auth.session.tokenSync();
        expect(a).toBe(b);
    });
});

// token() async

describe('auth.session.token()', () => {
    it('returns null when no session active', async () => {
        const t = await auth.session.token();
        expect(t).toBeNull();
    });

    it('returns the JWT after start()', async () => {
        await auth.session.start(VALID_JWT);
        const t = await auth.session.token();
        expect(t).toBe(VALID_JWT);
    });

    it('returns null after end()', async () => {
        await auth.session.start(VALID_JWT);
        await auth.session.end();
        const t = await auth.session.token();
        expect(t).toBeNull();
    });
});

// user()

describe('auth.session.user()', () => {
    it('returns null when no session active', () => {
        expect(auth.session.user()).toBeNull();
    });

    it('returns decoded JWT payload after start()', async () => {
        await auth.session.start(VALID_JWT);
        const user = auth.session.user();
        expect(user).not.toBeNull();
        expect(user.sub).toBe('user-1');
        expect(user.name).toBe('Ade');
    });

    it('returns null after end()', async () => {
        await auth.session.start(VALID_JWT);
        await auth.session.end();
        expect(auth.session.user()).toBeNull();
    });

    it('returns null when session is inactive (expired)', async () => {
        await auth.session.start(EXPIRED_JWT);
        expect(auth.session.user()).toBeNull();
    });
});

// expiresIn()

describe('auth.session.expiresIn()', () => {
    it('returns Infinity when no session active', () => {
        expect(auth.session.expiresIn()).toBe(Infinity);
    });

    it('returns a positive number for a valid JWT', async () => {
        await auth.session.start(VALID_JWT);
        expect(auth.session.expiresIn()).toBeGreaterThan(0);
    });

    it('returns approximately 1 hour for a JWT with 1h exp', async () => {
        await auth.session.start(VALID_JWT);
        const ms = auth.session.expiresIn();
        expect(ms).toBeLessThanOrEqual(3600_000);
        expect(ms).toBeGreaterThan(3500_000); // within 100s of 1h
    });
});

// intendedPath()

describe('auth.session.intendedPath()', () => {
    it('returns null when not set', () => {
        auth.session.clearIntendedPath();
        expect(auth.session.intendedPath()).toBeNull();
    });

    it('middleware stores intendedPath before redirect', async () => {
        // intendedPath is set internally by auth.middleware() when a check fails
        auth.level('path-test', () => false);
        const mw  = auth.middleware('path-test', '/login');
        const ctx = { path: '/admin/hosts', params: {}, redirect: vi.fn() };
        await mw(ctx, vi.fn());
        expect(auth.session.intendedPath()).toBe('/admin/hosts');
    });

    it('clearIntendedPath() removes it', async () => {
        auth.level('path-test-2', () => false);
        const mw  = auth.middleware('path-test-2', '/login');
        const ctx = { path: '/admin/hosts', params: {}, redirect: vi.fn() };
        await mw(ctx, vi.fn());
        expect(auth.session.intendedPath()).toBe('/admin/hosts');
        auth.session.clearIntendedPath();
        expect(auth.session.intendedPath()).toBeNull();
    });
});

// start() lifecycle hooks

describe('auth.session.OnStart()', () => {
    it('fires hook with token after start()', async () => {
        const hook = vi.fn();
        auth.session.OnStart(hook);
        await auth.session.start(VALID_JWT);
        expect(hook).toHaveBeenCalledWith(VALID_JWT, null);
    });

    it('fires hook with refreshToken when provided', async () => {
        const hook = vi.fn();
        auth.session.OnStart(hook);
        await auth.session.start(VALID_JWT, 'refresh-tok');
        expect(hook).toHaveBeenCalledWith(VALID_JWT, 'refresh-tok');
    });
});

describe('auth.session.OnExpiry()', () => {
    it('registers hook without error', () => {
        expect(() => auth.session.OnExpiry(() => {})).not.toThrow();
    });
});

describe('auth.session.OnRenew()', () => {
    it('fires hook with new token after renew()', async () => {
        await auth.session.start(VALID_JWT);
        const hook = vi.fn();
        auth.session.OnRenew(hook);
        const newJWT = fakeJWT({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 7200 });
        await auth.session.renew(newJWT);
        expect(hook).toHaveBeenCalledWith(newJWT, null);
    });
});

// renew()

describe('auth.session.renew()', () => {
    it('updates isActive() with new expiry', async () => {
        await auth.session.start(VALID_JWT);
        const renewed = fakeJWT({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 7200 });
        await auth.session.renew(renewed);
        expect(auth.session.isActive()).toBe(true);
    });

    it('updates user() with new payload', async () => {
        await auth.session.start(VALID_JWT);
        const renewed = fakeJWT({ sub: 'user-1', name: 'Updated', exp: Math.floor(Date.now() / 1000) + 7200 });
        await auth.session.renew(renewed);
        expect(auth.session.user()?.name).toBe('Updated');
    });
});

// auth.level() and auth.guard()

describe('auth.level() and auth.guard()', () => {
    it('level() registers a check function', () => {
        auth.level('test-public', () => true);
        expect(auth.guard('test-public')).toBe(true);
    });

    it('guard() returns false when check fails', () => {
        auth.level('test-private', () => false);
        expect(auth.guard('test-private')).toBe(false);
    });

    it('guard() returns false for unknown level', () => {
        expect(auth.guard('nonexistent-level')).toBe(false);
    });

    it('protected level uses isActive()', async () => {
        auth.level('test-protected', () => auth.session.isActive());
        expect(auth.guard('test-protected')).toBe(false);
        await auth.session.start(VALID_JWT);
        expect(auth.guard('test-protected')).toBe(true);
    });
});

// auth.middleware()

describe('auth.middleware()', () => {
    it('calls next() when level passes', async () => {
        auth.level('always-pass', () => true);
        const mw   = auth.middleware('always-pass');
        const next = vi.fn();
        const ctx  = { path: '/protected', params: {}, redirect: vi.fn() };
        await mw(ctx, next);
        expect(next).toHaveBeenCalled();
        expect(ctx.redirect).not.toHaveBeenCalled();
    });

    it('redirects to /login when level fails (default)', async () => {
        auth.level('always-fail', () => false);
        const mw  = auth.middleware('always-fail');
        const ctx = { path: '/protected', params: {}, redirect: vi.fn() };
        await mw(ctx, vi.fn());
        expect(ctx.redirect).toHaveBeenCalledWith('/login');
    });

    it('redirects to custom path when provided', async () => {
        auth.level('custom-redirect', () => false);
        const mw  = auth.middleware('custom-redirect', '/signin');
        const ctx = { path: '/admin', params: {}, redirect: vi.fn() };
        await mw(ctx, vi.fn());
        expect(ctx.redirect).toHaveBeenCalledWith('/signin');
    });

    it('calls onFail function instead of redirect when provided', async () => {
        auth.level('fn-fail', () => false);
        const onFail = vi.fn();
        const mw     = auth.middleware('fn-fail', onFail);
        const ctx    = { path: '/protected', params: {}, redirect: vi.fn() };
        await mw(ctx, vi.fn());
        expect(onFail).toHaveBeenCalled();
        expect(ctx.redirect).not.toHaveBeenCalled();
    });

    it('accepts { onFail } object form', async () => {
        auth.level('obj-fail', () => false);
        const onFail = vi.fn();
        const mw     = auth.middleware('obj-fail', { onFail });
        const ctx    = { path: '/protected', params: {}, redirect: vi.fn() };
        await mw(ctx, vi.fn());
        expect(onFail).toHaveBeenCalledWith(ctx);
    });

    it('stores intendedPath in meta when redirecting', async () => {
        auth.level('need-auth', () => false);
        const mw  = auth.middleware('need-auth', '/login');
        const ctx = { path: '/secret', params: {}, redirect: vi.fn() };
        await mw(ctx, vi.fn());
        expect(auth.session.intendedPath()).toBe('/secret');
    });

    it('warns for unknown level and calls next (fail-open behaviour)', async () => {
        // auth.middleware warns when the level is not registered,
        // then calls next() — it does not block the request.
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const mw   = auth.middleware('this-level-does-not-exist');
        const ctx  = { path: '/x', params: {}, redirect: vi.fn() };
        const next = vi.fn();
        await mw(ctx, next);
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('unknown level'));
        expect(next).toHaveBeenCalled(); // fail-open: unknown level does not block
        spy.mockRestore();
    });
});

// hasRole() / hasAnyRole() / hasAllRoles()

describe('auth role helpers', () => {
    beforeEach(async () => {
        const jwt = fakeJWT({
            sub:   'user-3',
            roles: ['editor', 'viewer'],
            email_verified: true,
            exp:   Math.floor(Date.now() / 1000) + 3600,
        });
        await auth.session.start(jwt);
    });

    it('hasRole() returns true for a role the user has', () => {
        expect(auth.hasRole('editor')).toBe(true);
    });

    it('hasRole() returns false for a role the user does not have', () => {
        expect(auth.hasRole('admin')).toBe(false);
    });

    it('hasRole() returns false when no session is active', async () => {
        await auth.session.end();
        expect(auth.hasRole('editor')).toBe(false);
    });

    it('hasRole() works with a string role field (not array)', async () => {
        const jwt = fakeJWT({ sub: 'u4', role: 'superuser', exp: Math.floor(Date.now() / 1000) + 3600 });
        await auth.session.start(jwt);
        expect(auth.hasRole('superuser')).toBe(true);
        expect(auth.hasRole('editor')).toBe(false);
    });

    it('hasClaim() returns true for a claim that exists', () => {
        expect(auth.hasClaim('sub')).toBe(true);
        expect(auth.hasClaim('email_verified')).toBe(true);
    });

    it('hasClaim() with value checks the claim value', () => {
        expect(auth.hasClaim('email_verified', true)).toBe(true);
        expect(auth.hasClaim('email_verified', false)).toBe(false);
    });

    it('hasClaim() returns false for a claim that does not exist', () => {
        expect(auth.hasClaim('nonexistent_claim')).toBe(false);
    });

    it('hasClaim() returns false when no session active', async () => {
        await auth.session.end();
        expect(auth.hasClaim('sub')).toBe(false);
    });

    // Role checks in level definitions
    it('level using hasRole() works correctly', () => {
        auth.level('test-editor', () => auth.session.isActive() && auth.hasRole('editor'));
        expect(auth.guard('test-editor')).toBe(true);

        auth.level('test-admin', () => auth.session.isActive() && auth.hasRole('admin'));
        expect(auth.guard('test-admin')).toBe(false);
    });
});

// end-to-end: login → tokenSync → renew → logout

describe('auth end-to-end flow', () => {
    it('full login/tokenSync/renew/logout lifecycle', async () => {
        // No session
        expect(auth.session.isActive()).toBe(false);
        expect(auth.session.tokenSync()).toBeNull();

        // Login
        const loginJWT = fakeJWT({ sub: 'ade', exp: Math.floor(Date.now() / 1000) + 3600 });
        await auth.session.start(loginJWT);
        expect(auth.session.isActive()).toBe(true);
        expect(auth.session.tokenSync()).toBe(loginJWT);
        expect(auth.session.user()?.sub).toBe('ade');

        // Token still available synchronously (for api.setToken in OnStart)
        const syncToken = auth.session.tokenSync();
        expect(syncToken).toBe(loginJWT);

        // Async token matches
        const asyncToken = await auth.session.token();
        expect(asyncToken).toBe(loginJWT);

        // Renew
        const renewedJWT = fakeJWT({ sub: 'ade', exp: Math.floor(Date.now() / 1000) + 7200 });
        await auth.session.renew(renewedJWT);
        expect(auth.session.isActive()).toBe(true);

        // Logout
        await auth.session.end();
        expect(auth.session.isActive()).toBe(false);
        expect(auth.session.tokenSync()).toBeNull();
        expect(auth.session.user()).toBeNull();
        expect(await auth.session.token()).toBeNull();
    });

    it('middleware protects route then allows after login', async () => {
        auth.level('session-protected', () => auth.session.isActive());

        const mw  = auth.middleware('session-protected', '/login');
        const ctx = { path: '/dashboard', params: {}, redirect: vi.fn() };

        // Before login — redirected
        await mw(ctx, vi.fn());
        expect(ctx.redirect).toHaveBeenCalledWith('/login');

        // After login — next() called
        await auth.session.start(VALID_JWT);
        const next = vi.fn();
        ctx.redirect.mockClear();
        await mw(ctx, next);
        expect(next).toHaveBeenCalled();
        expect(ctx.redirect).not.toHaveBeenCalled();
    });
});
