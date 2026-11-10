import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Queue } from '../../src/js/ext/queue.js';

// Minimal Api stub
function makeApi(responses = {}) {
    return {
        get:    vi.fn(async (path) => responses[path] ?? { ok: true }),
        post:   vi.fn(async (path) => responses[path] ?? { ok: true }),
        put:    vi.fn(async (path) => responses[path] ?? { ok: true }),
        patch:  vi.fn(async (path) => responses[path] ?? { ok: true }),
        delete: vi.fn(async (path) => responses[path] ?? { ok: true }),
    };
}

// Minimal Store stub
function makeStore(initial = []) {
    const mem = new Map();
    if (initial.length) mem.set('queue:pending', initial);
    return {
        get: vi.fn((k) => mem.get(k) ?? null),
        set: vi.fn((k, v) => { mem.set(k, v); }),
        data: mem,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    // Default navigator.onLine = true in jsdom
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('Queue — construction', () => {
    it('throws if api is missing', () => {
        expect(() => new Queue({})).toThrow('[oja/queue] options.api is required');
    });

    it('constructs with defaults', () => {
        const q = new Queue({ api: makeApi() });
        expect(q.size).toBe(0);
        expect(q.pending).toEqual([]);
    });

    it('loads persisted requests from store on construction', () => {
        const stored = [{ id: 'q_abc', method: 'POST', path: '/x', body: null, opts: {}, queuedAt: 1, attempts: 0 }];
        const store  = makeStore(stored);
        const q      = new Queue({ api: makeApi(), store });
        expect(q.size).toBe(1);
        expect(q.pending[0].id).toBe('q_abc');
    });
});

describe('Queue — request() when online', () => {
    it('executes immediately when online', async () => {
        const api = makeApi();
        const q   = new Queue({ api });
        await q.request('POST', '/hosts', { ip: '1.2.3.4' });
        expect(api.post).toHaveBeenCalledWith('/hosts', { ip: '1.2.3.4' }, {});
        expect(q.size).toBe(0);
    });

    it('enqueues when api throws a network error', async () => {
        const api  = makeApi();
        api.post = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        const q    = new Queue({ api });
        const result = await q.request('POST', '/hosts', { ip: '1.2.3.4' });
        expect(result).toBeNull();
        expect(q.size).toBe(1);
    });

    it('re-throws non-network errors', async () => {
        const api  = makeApi();
        api.post = vi.fn().mockRejectedValue(new Error('Validation failed'));
        const q    = new Queue({ api });
        await expect(q.request('POST', '/hosts', {})).rejects.toThrow('Validation failed');
        expect(q.size).toBe(0);
    });
});

describe('Queue — request() when offline', () => {
    it('enqueues without calling api when offline', async () => {
        const api = makeApi();
        const q   = new Queue({ api });
        q._online = false;

        const result = await q.request('DELETE', '/route/42');
        expect(api.delete).not.toHaveBeenCalled();
        expect(result).toBeNull();
        expect(q.size).toBe(1);
        expect(q.pending[0].method).toBe('DELETE');
        expect(q.pending[0].path).toBe('/route/42');
    });

    it('convenience methods delegate to request()', async () => {
        const api = makeApi();
        const q   = new Queue({ api });
        q._online = false;

        await q.post('/a', { x: 1 });
        await q.put('/b', { y: 2 });
        await q.patch('/c', { z: 3 });
        await q.delete('/d');

        expect(q.size).toBe(4);
        const methods = q.pending.map(r => r.method);
        expect(methods).toEqual(['POST', 'PUT', 'PATCH', 'DELETE']);
    });
});

describe('Queue — maxSize', () => {
    it('drops requests beyond maxSize', async () => {
        const api = makeApi();
        const q   = new Queue({ api, maxSize: 2 });
        q._online = false;
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await q.request('POST', '/a');
        await q.request('POST', '/b');
        const result = await q.request('POST', '/c');  // dropped

        expect(result).toBeNull();
        expect(q.size).toBe(2);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('max queue size'));
    });
});

describe('Queue — flush()', () => {
    it('replays all queued requests', async () => {
        const api = makeApi();
        const q   = new Queue({ api });
        q._online = false;

        await q.post('/a', { n: 1 });
        await q.post('/b', { n: 2 });
        expect(q.size).toBe(2);

        q._online = true;
        const { succeeded, failed } = await q.flush();
        expect(succeeded).toBe(2);
        expect(failed).toBe(0);
        expect(q.size).toBe(0);
        expect(api.post).toHaveBeenCalledTimes(2);
    });

    it('returns 0/0 when queue is empty', async () => {
        const q = new Queue({ api: makeApi() });
        const result = await q.flush();
        expect(result).toEqual({ succeeded: 0, failed: 0 });
    });

    it('is idempotent — second concurrent flush is a no-op', async () => {
        vi.useRealTimers();

        const api = makeApi();
        api.post = vi.fn(() => Promise.resolve({ ok: true }));
        const q   = new Queue({ api });
        q._online = false;
        await q.post('/a');

        q._online = true;
        const p1 = q.flush();
        const p2 = q.flush(); // concurrent — should be no-op
        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1.succeeded).toBe(1);
        expect(r2).toEqual({ succeeded: 0, failed: 0 }); // second was no-op
    });

    it('keeps failed requests in queue after flush', async () => {
        const api = makeApi();
        api.post = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        const q   = new Queue({ api, retries: 0 });
        q._online = false;
        await q.post('/a');
        q._online = true;

        const { succeeded, failed } = await q.flush();
        expect(succeeded).toBe(0);
        expect(failed).toBe(1);
        expect(q.size).toBe(1); // still in queue
    });

    it('retries on network error up to options.retries times', async () => {
        // Use real timers for this test — fake timers + async retry sleeps causes deadlocks
        vi.useRealTimers();

        const api    = makeApi();
        let callCount = 0;
        api.post = vi.fn(async () => {
            callCount++;
            if (callCount < 3) throw new TypeError('network');
            return { ok: true };
        });

        // Use retries:2 but override _sleep to resolve immediately
        const q = new Queue({ api, retries: 2 });
        q._sleep = () => Promise.resolve(); // no actual delay
        q._online = false;
        await q.post('/a');
        q._online = true;

        const { succeeded } = await q.flush();
        expect(succeeded).toBe(1);
        expect(callCount).toBe(3);
    }, 10000);
});

describe('Queue — start() / stop() / api events', () => {
    it('flushes when api:online fires', async () => {
        const { emit } = await import('../../src/js/core/events.js');
        const api = makeApi();
        const q   = new Queue({ api });
        q.start();
        q._online = false;
        await q.post('/a');
        expect(q.size).toBe(1);

        emit('api:online');
        await Promise.resolve(); // allow flush microtask
        expect(api.post).toHaveBeenCalled();
        q.stop();
    });

    it('sets _online false on api:offline', async () => {
        const { emit } = await import('../../src/js/core/events.js');
        const q = new Queue({ api: makeApi() });
        q.start();
        expect(q._online).toBe(true);
        emit('api:offline');
        expect(q._online).toBe(false);
        q.stop();
    });

    it('stop() unsubscribes from events', async () => {
        const { emit } = await import('../../src/js/core/events.js');
        const api = makeApi();
        const q   = new Queue({ api });
        q.start();
        q.stop();

        q._online = false;
        await q.post('/a');
        emit('api:online');  // should NOT flush now
        await Promise.resolve();
        expect(api.post).not.toHaveBeenCalled();
    });
});

describe('Queue — clear() / remove()', () => {
    it('clear() empties the queue', async () => {
        const q = new Queue({ api: makeApi() });
        q._online = false;
        await q.post('/a');
        await q.post('/b');
        q.clear();
        expect(q.size).toBe(0);
    });

    it('remove() removes by id', async () => {
        const q = new Queue({ api: makeApi() });
        q._online = false;
        await q.post('/a');
        const id = q.pending[0].id;
        const removed = q.remove(id);
        expect(removed).toBe(true);
        expect(q.size).toBe(0);
    });

    it('remove() returns false for unknown id', () => {
        const q = new Queue({ api: makeApi() });
        expect(q.remove('nonexistent')).toBe(false);
    });
});

describe('Queue — events', () => {
    it('fires "queued" when a request is enqueued', async () => {
        const handler = vi.fn();
        const q = new Queue({ api: makeApi() });
        q.on('queued', handler);
        q._online = false;
        await q.post('/a', { x: 1 });
        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0].request.method).toBe('POST');
    });

    it('fires "replayed" on successful flush', async () => {
        const handler = vi.fn();
        const api = makeApi();
        const q   = new Queue({ api });
        q.on('replayed', handler);
        q._online = false;
        await q.post('/a');
        q._online = true;
        await q.flush();
        expect(handler).toHaveBeenCalledOnce();
    });

    it('fires "failed" for requests that exhaust retries', async () => {
        const handler = vi.fn();
        const api = makeApi();
        api.post = vi.fn().mockRejectedValue(new TypeError('network'));
        const q   = new Queue({ api, retries: 0 });
        q.on('failed', handler);
        q._online = false;
        await q.post('/a');
        q._online = true;
        await q.flush();
        expect(handler).toHaveBeenCalledOnce();
    });

    it('fires "flushed" after flush completes', async () => {
        const handler = vi.fn();
        const api = makeApi();
        const q   = new Queue({ api });
        q.on('flushed', handler);
        q._online = false;
        await q.post('/a');
        q._online = true;
        await q.flush();
        expect(handler).toHaveBeenCalledWith({ succeeded: 1, failed: 0 });
    });

    it('on() returns unsubscribe function', async () => {
        const handler = vi.fn();
        const q   = new Queue({ api: makeApi() });
        const off = q.on('queued', handler);
        off();
        q._online = false;
        await q.post('/a');
        expect(handler).not.toHaveBeenCalled();
    });
});

describe('Queue — persistence', () => {
    it('persists queue to store on enqueue', async () => {
        const store = makeStore();
        const q     = new Queue({ api: makeApi(), store });
        q._online   = false;
        await q.post('/a', { n: 1 });
        expect(store.set).toHaveBeenCalledWith('queue:pending', expect.arrayContaining([
            expect.objectContaining({ path: '/a', method: 'POST' }),
        ]));
    });

    it('persists updated queue after clear()', async () => {
        const store = makeStore();
        const q     = new Queue({ api: makeApi(), store });
        q._online   = false;
        await q.post('/a');
        q.clear();
        expect(store.set).toHaveBeenLastCalledWith('queue:pending', []);
    });
});
