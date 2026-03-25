import { describe, it, expect, vi, beforeEach } from 'vitest';
import { auth } from '../../src/js/ext/auth.js';

beforeEach(async () => {
    await auth.session.end();
});

// ─── auth.session.start() with non-JWT token ───────────────────────────

describe('auth.session.start() — non-JWT token support', () => {
    it('isActive() returns false for opaque token with no options (original behaviour)', async () => {
        await auth.session.start('opaque-token-no-exp');
        expect(auth.session.isActive()).toBe(false);
    });

    it('isActive() returns true for opaque token with { expires: null }', async () => {
        await auth.session.start('basic-auth-token', null, { expires: null });
        expect(auth.session.isActive()).toBe(true);
    });

    it('isActive() returns true for opaque token with explicit future expires', async () => {
        const future = Date.now() + 8 * 3600_000;
        await auth.session.start('opaque-token', null, { expires: future });
        expect(auth.session.isActive()).toBe(true);
    });

    it('isActive() returns false for expired opaque token', async () => {
        const past = Date.now() - 1000;
        await auth.session.start('expired-token', null, { expires: past });
        expect(auth.session.isActive()).toBe(false);
    });

    it('session.end() clears no-expiry session', async () => {
        await auth.session.start('basic-token', null, { expires: null });
        expect(auth.session.isActive()).toBe(true);
        await auth.session.end();
        expect(auth.session.isActive()).toBe(false);
    });

    it('standard JWT still works unchanged', async () => {
        // Create a fake JWT with future exp
        const payload = { sub: 'user1', exp: Math.floor(Date.now() / 1000) + 3600 };
        const encoded = btoa(JSON.stringify({ alg: 'HS256' })) + '.' +
                        btoa(JSON.stringify(payload)) + '.sig';
        await auth.session.start(encoded);
        expect(auth.session.isActive()).toBe(true);
    });
});

// ─── auth.middleware() with callback ────────────────────────────────────

describe('auth.middleware() — callback redirect support', () => {
    it('calls a function instead of ctx.redirect when guard fails', async () => {
        auth.level('test-level', () => false);
        const onFail = vi.fn();
        const middleware = auth.middleware('test-level', onFail);

        const ctx = { path: '/protected', params: {}, redirect: vi.fn() };
        const next = vi.fn();

        await middleware(ctx, next);

        expect(onFail).toHaveBeenCalled();
        expect(ctx.redirect).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
    });

    it('accepts { onFail } object form', async () => {
        auth.level('test-level-2', () => false);
        const onFail = vi.fn();
        const middleware = auth.middleware('test-level-2', { onFail });

        const ctx = { path: '/protected', params: {}, redirect: vi.fn() };
        await middleware(ctx, vi.fn());

        expect(onFail).toHaveBeenCalledWith(ctx);
    });

    it('still works with string redirect path', async () => {
        auth.level('test-level-3', () => false);
        const middleware = auth.middleware('test-level-3', '/login');

        const ctx = { path: '/secret', params: {}, redirect: vi.fn() };
        await middleware(ctx, vi.fn());
        expect(ctx.redirect).toHaveBeenCalledWith('/login');
    });

    it('calls next() when guard passes', async () => {
        auth.level('open-level', () => true);
        const middleware = auth.middleware('open-level', '/login');
        const ctx = { path: '/', params: {}, redirect: vi.fn() };
        const next = vi.fn();
        await middleware(ctx, next);
        expect(next).toHaveBeenCalled();
    });
});
