
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runtime } from '../../src/js/core/runtime.js';

/** Capture all runtime:error events fired on document */
function listenRuntimeError() {
    const events = [];
    const handler = (e) => events.push(e.detail);
    document.addEventListener('runtime:error', handler);
    return {
        events,
        stop: () => document.removeEventListener('runtime:error', handler),
    };
}

afterEach(() => {
    runtime.destroy();
});

describe('runtime.env()', () => {
    it('defaults to development', () => {
        expect(runtime.env()).toBe('development');
    });

    it('setter returns this for chaining', () => {
        expect(runtime.env('production')).toBe(runtime);
    });

    it('getter returns the set value', () => {
        runtime.env('test');
        expect(runtime.env()).toBe('test');
    });

    it('accepts all three valid envs', () => {
        for (const name of ['development', 'production', 'test']) {
            runtime.env(name);
            expect(runtime.env()).toBe(name);
        }
    });

    it('throws on invalid env name', () => {
        expect(() => runtime.env('staging')).toThrow('[oja/runtime]');
    });
});

describe('runtime.define() / runtime.get()', () => {
    it('round-trips a string', () => {
        runtime.define('apiBase', 'https://api.example.com');
        expect(runtime.get('apiBase')).toBe('https://api.example.com');
    });

    it('round-trips a function', () => {
        const fn = () => 42;
        runtime.define('myFn', fn);
        expect(runtime.get('myFn')).toBe(fn);
    });

    it('round-trips an object', () => {
        const obj = { x: 1 };
        runtime.define('cfg', obj);
        expect(runtime.get('cfg')).toBe(obj);
    });

    it('returns undefined for unknown key by default', () => {
        expect(runtime.get('nope')).toBeUndefined();
    });

    it('returns the provided fallback for unknown key', () => {
        expect(runtime.get('nope', 'fallback')).toBe('fallback');
    });

    it('define() returns this for chaining', () => {
        expect(runtime.define('x', 1)).toBe(runtime);
    });

    it('overwriting a key updates the value', () => {
        runtime.define('x', 1);
        runtime.define('x', 2);
        expect(runtime.get('x')).toBe(2);
    });
});

describe('runtime.sandbox()', () => {
    it('defaults to false', () => {
        expect(runtime.isSandboxed()).toBe(false);
    });

    it('sandbox(true) sets sandboxed', () => {
        runtime.sandbox(true);
        expect(runtime.isSandboxed()).toBe(true);
    });

    it('sandbox(false) clears sandboxed', () => {
        runtime.sandbox(true);
        runtime.sandbox(false);
        expect(runtime.isSandboxed()).toBe(false);
    });

    it('sandbox() returns this for chaining', () => {
        expect(runtime.sandbox(true)).toBe(runtime);
    });

    it('coerces truthy values to boolean', () => {
        runtime.sandbox(1);
        expect(runtime.isSandboxed()).toBe(true);
    });
});

describe('runtime.allowOrigins() / runtime.isOriginAllowed()', () => {
    it('empty list allows everything (default)', () => {
        expect(runtime.isOriginAllowed('https://evil.com/anything')).toBe(true);
    });

    it('populated list blocks non-matching origin', () => {
        runtime.allowOrigins(['https://api.myapp.com']);
        expect(runtime.isOriginAllowed('https://evil.com/payload')).toBe(false);
    });

    it('populated list allows matching origin', () => {
        runtime.allowOrigins(['https://api.myapp.com']);
        expect(runtime.isOriginAllowed('https://api.myapp.com/v1/users')).toBe(true);
    });

    it('allows multiple whitelisted origins', () => {
        runtime.allowOrigins(['https://api.myapp.com', 'https://cdn.myapp.com']);
        expect(runtime.isOriginAllowed('https://cdn.myapp.com/lib.js')).toBe(true);
    });

    it('relative URLs are always allowed (same-origin)', () => {
        runtime.allowOrigins(['https://api.myapp.com']);
        expect(runtime.isOriginAllowed('/api/v1/users')).toBe(true);
    });

    it('is case-insensitive for origins', () => {
        runtime.allowOrigins(['https://API.MYAPP.COM']);
        expect(runtime.isOriginAllowed('https://api.myapp.com/data')).toBe(true);
    });

    it('allowOrigins() returns this for chaining', () => {
        expect(runtime.allowOrigins([])).toBe(runtime);
    });

    it('throws if argument is not an array', () => {
        expect(() => runtime.allowOrigins('https://api.myapp.com')).toThrow('[oja/runtime]');
    });
});

describe('runtime.onFetch() / runtime.runFetchHooks()', () => {
    it('returns opts unchanged when no hooks are registered', () => {
        const opts = { method: 'GET', headers: {} };
        const result = runtime.runFetchHooks('/api', opts);
        expect(result).toEqual({ method: 'GET', headers: {} });
    });

    it('hook is called with correct url and opts', () => {
        const spy = vi.fn((_url, opts) => opts);
        runtime.onFetch(spy);
        runtime.runFetchHooks('/test', { method: 'GET' });
        expect(spy).toHaveBeenCalledWith('/test', { method: 'GET' });
    });

    it("hook's return value replaces opts for the next hook (pipeline)", () => {
        runtime.onFetch((_url, opts) => ({ ...opts, headers: { 'X-A': '1' } }));
        runtime.onFetch((_url, opts) => ({ ...opts, headers: { ...opts.headers, 'X-B': '2' } }));

        const result = runtime.runFetchHooks('/api', { headers: {} });
        expect(result.headers).toEqual({ 'X-A': '1', 'X-B': '2' });
    });

    it('hooks compose in registration order', () => {
        const order = [];
        runtime.onFetch((_u, opts) => { order.push(1); return opts; });
        runtime.onFetch((_u, opts) => { order.push(2); return opts; });
        runtime.runFetchHooks('/api', {});
        expect(order).toEqual([1, 2]);
    });

    it('hook that throws does not break subsequent hooks', () => {
        runtime.onFetch(() => { throw new Error('boom'); });
        const spy = vi.fn((_u, opts) => opts);
        runtime.onFetch(spy);

        expect(() => runtime.runFetchHooks('/api', {})).not.toThrow();
        expect(spy).toHaveBeenCalled();
    });

    it('hook that throws reports to onError', () => {
        const errorSpy = vi.fn();
        runtime.onError(errorSpy);
        runtime.onFetch(() => { throw new Error('boom'); });
        runtime.runFetchHooks('/api', {});
        expect(errorSpy).toHaveBeenCalledWith(expect.any(Error), 'runtime:fetch-hook');
    });

    it('unsubscribe stops subsequent calls', () => {
        const spy = vi.fn((_u, opts) => opts);
        const unsub = runtime.onFetch(spy);
        unsub();
        runtime.runFetchHooks('/api', {});
        expect(spy).not.toHaveBeenCalled();
    });

    it('hook returning a non-object falls back to previous opts', () => {
        const original = { method: 'GET' };
        runtime.onFetch(() => null);       // returns null — should be ignored
        const result = runtime.runFetchHooks('/api', original);
        expect(result).toEqual(original);
    });
});

describe('runtime.onError() / runtime.reportError()', () => {
    it('fires all registered handlers', () => {
        const spy1 = vi.fn();
        const spy2 = vi.fn();
        runtime.onError(spy1);
        runtime.onError(spy2);

        const err = new Error('test');
        runtime.reportError(err, 'test-source');

        expect(spy1).toHaveBeenCalledWith(err, 'test-source');
        expect(spy2).toHaveBeenCalledWith(err, 'test-source');
    });

    it('swallows errors thrown inside error hooks', () => {
        runtime.onError(() => { throw new Error('handler exploded'); });
        expect(() => runtime.reportError(new Error('original'), 'src')).not.toThrow();
    });

    it('emits runtime:error event on document', () => {
        const listener = listenRuntimeError();
        const err = new Error('evt');
        runtime.reportError(err, 'mod');
        listener.stop();

        expect(listener.events).toHaveLength(1);
        expect(listener.events[0]).toEqual({ err, source: 'mod' });
    });

    it('unsubscribe stops subsequent calls', () => {
        const spy = vi.fn();
        const unsub = runtime.onError(spy);
        unsub();
        runtime.reportError(new Error('x'), 'src');
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('runtime.onNavigate() / runtime.runNavigateHooks()', () => {
    const base = {
        from:   '/home',
        to:     '/users/42',
        route:  '/users/:id',
        params: { id: '42' },
        query:  {},
    };

    it('fires hook with the full nav context', () => {
        const spy = vi.fn();
        runtime.onNavigate(spy);
        runtime.runNavigateHooks(base);

        expect(spy).toHaveBeenCalledOnce();
        const nav = spy.mock.calls[0][0];
        expect(nav.from).toBe('/home');
        expect(nav.to).toBe('/users/42');
        expect(nav.route).toBe('/users/:id');
        expect(nav.params).toEqual({ id: '42' });
    });

    it('nav exposes cancel() and redirect()', () => {
        runtime.onNavigate((nav) => {
            expect(typeof nav.cancel).toBe('function');
            expect(typeof nav.redirect).toBe('function');
        });
        runtime.runNavigateHooks(base);
    });

    it('cancel() sets cancelled in result', () => {
        runtime.onNavigate((nav) => nav.cancel());
        const result = runtime.runNavigateHooks(base);
        expect(result.cancelled).toBe(true);
        expect(result.redirectTo).toBeNull();
    });

    it('redirect() sets redirectTo and cancels', () => {
        runtime.onNavigate((nav) => nav.redirect('/login'));
        const result = runtime.runNavigateHooks(base);
        expect(result.cancelled).toBe(true);
        expect(result.redirectTo).toBe('/login');
    });

    it('stops firing remaining hooks once cancelled', () => {
        const spy = vi.fn();
        runtime.onNavigate((nav) => nav.cancel());
        runtime.onNavigate(spy);
        runtime.runNavigateHooks(base);
        expect(spy).not.toHaveBeenCalled();
    });

    it('returns cancelled:false when no hook cancels', () => {
        runtime.onNavigate(() => {});
        const result = runtime.runNavigateHooks(base);
        expect(result.cancelled).toBe(false);
        expect(result.redirectTo).toBeNull();
    });

    it('unsubscribe stops subsequent calls', () => {
        const spy = vi.fn();
        const unsub = runtime.onNavigate(spy);
        unsub();
        runtime.runNavigateHooks(base);
        expect(spy).not.toHaveBeenCalled();
    });
});

describe('runtime.ready()', () => {
    it('fires immediately (via microtask) when DOM is already loaded', async () => {
        const spy = vi.fn();
        runtime.ready(spy);
        // jsdom sets readyState to 'complete' — so ready() schedules via Promise.resolve()
        await Promise.resolve();
        expect(spy).toHaveBeenCalledOnce();
    });

    it('ready() returns this for chaining', () => {
        expect(runtime.ready(() => {})).toBe(runtime);
    });

    it('throws when argument is not a function', () => {
        expect(() => runtime.ready('not a function')).toThrow('[oja/runtime]');
    });

    it('errors in ready callbacks are reported, not thrown', async () => {
        const errorSpy = vi.fn();
        runtime.onError(errorSpy);
        runtime.ready(() => { throw new Error('callback boom'); });
        await Promise.resolve();
        expect(errorSpy).toHaveBeenCalledWith(expect.any(Error), 'runtime:ready');
    });
});

describe('runtime.destroy()', () => {
    it('clears all fetch hooks', () => {
        const spy = vi.fn((_u, opts) => opts);
        runtime.onFetch(spy);
        runtime.destroy();
        runtime.runFetchHooks('/api', {});
        expect(spy).not.toHaveBeenCalled();
    });

    it('clears all error hooks', () => {
        const spy = vi.fn();
        runtime.onError(spy);
        runtime.destroy();
        runtime.reportError(new Error('x'), 'src');
        expect(spy).not.toHaveBeenCalled();
    });

    it('clears all navigate hooks', () => {
        const spy = vi.fn();
        runtime.onNavigate(spy);
        runtime.destroy();
        runtime.runNavigateHooks({ from: '/', to: '/about', route: '/about', params: {}, query: {} });
        expect(spy).not.toHaveBeenCalled();
    });

    it('get() returns fallback after destroy', () => {
        runtime.define('key', 'value');
        runtime.destroy();
        expect(runtime.get('key', 'fallback')).toBe('fallback');
    });

    it('resets sandbox to false', () => {
        runtime.sandbox(true);
        runtime.destroy();
        expect(runtime.isSandboxed()).toBe(false);
    });

    it('resets allowOrigins to empty (allow all)', () => {
        runtime.allowOrigins(['https://api.myapp.com']);
        runtime.destroy();
        expect(runtime.isOriginAllowed('https://anywhere.com')).toBe(true);
    });

    it('resets env to development', () => {
        runtime.env('production');
        runtime.destroy();
        expect(runtime.env()).toBe('development');
    });

    it('emits runtime:destroy event', () => {
        const spy = vi.fn();
        document.addEventListener('runtime:destroy', spy, { once: true });
        runtime.destroy();
        expect(spy).toHaveBeenCalledOnce();
    });
});

describe('method chaining', () => {
    it('all setters chain correctly', () => {
        expect(() => {
            // Setter methods return this — these chain.
            runtime
                .env('production')
                .define('x', 1)
                .allowOrigins(['https://api.example.com'])
                .sandbox(false)
                .ready(() => {});

            // Hook registration methods return an unsubscribe fn — called standalone.
            runtime.onFetch((_u, opts) => opts);
            runtime.onError(() => {});
            runtime.onNavigate(() => {});
        }).not.toThrow();
    });
});
