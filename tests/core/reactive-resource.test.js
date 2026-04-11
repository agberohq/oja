import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createResource, state, effect } from '../../src/js/core/reactive.js';

// Drain effect microtasks
async function flush(n = 5) {
    for (let i = 0; i < n; i++) await Promise.resolve();
}

describe('createResource — immediate fetch (defer:false)', () => {
    it('starts loading and resolves data', async () => {
        const fetcher = vi.fn().mockResolvedValue(['a', 'b']);
        const [data, { loading, error }] = createResource(fetcher);

        // Before fetch resolves
        expect(loading()).toBe(true);
        expect(data()).toBeNull();
        expect(error()).toBeNull();

        await flush(10);

        expect(loading()).toBe(false);
        expect(data()).toEqual(['a', 'b']);
        expect(error()).toBeNull();
        expect(fetcher).toHaveBeenCalledOnce();
    });

    it('captures fetch errors in error signal', async () => {
        const err     = new Error('Not Found');
        const fetcher = vi.fn().mockRejectedValue(err);
        const [data, { loading, error }] = createResource(fetcher);

        await flush(10);

        expect(loading()).toBe(false);
        expect(data()).toBeNull();
        expect(error()).toBe(err);
    });

    it('uses initialValue before fetch resolves', async () => {
        const fetcher = vi.fn().mockResolvedValue('done');
        const [data]  = createResource(fetcher, { initialValue: 'placeholder' });
        expect(data()).toBe('placeholder');
        await flush(10);
        expect(data()).toBe('done');
    });
});

describe('createResource — deferred (defer:true)', () => {
    it('does not fetch on creation when defer:true', async () => {
        const fetcher = vi.fn().mockResolvedValue('result');
        const [data, { loading }] = createResource(fetcher, { defer: true });

        await flush(10);

        expect(fetcher).not.toHaveBeenCalled();
        expect(loading()).toBe(false);
        expect(data()).toBeNull();
    });

    it('fetches when refetch() is called', async () => {
        const fetcher = vi.fn().mockResolvedValue('result');
        const [data, { loading, refetch }] = createResource(fetcher, { defer: true });

        refetch();
        expect(loading()).toBe(true);
        await flush(10);
        expect(loading()).toBe(false);
        expect(data()).toBe('result');
        expect(fetcher).toHaveBeenCalledOnce();
    });

    it('can refetch multiple times', async () => {
        let count = 0;
        const fetcher = vi.fn(async () => ++count);
        const [data, { refetch }] = createResource(fetcher, { defer: true });

        refetch();
        await flush(10);
        expect(data()).toBe(1);

        refetch();
        await flush(10);
        expect(data()).toBe(2);
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
});

describe('createResource — stale-response cancellation', () => {
    it('ignores results from a superseded fetch', async () => {
        let resolveFirst;
        const slow = new Promise(r => { resolveFirst = r; });
        let call = 0;
        const fetcher = vi.fn(async () => {
            call++;
            if (call === 1) return slow;
            return 'fast-result';
        });

        const [data, { refetch }] = createResource(fetcher, { defer: true });

        refetch(); // slow first fetch
        refetch(); // fast second fetch — supersedes first

        await flush(10); // fast resolves
        expect(data()).toBe('fast-result');

        // Now resolve slow — should be ignored
        resolveFirst('slow-result');
        await flush(10);
        expect(data()).toBe('fast-result');
    });
});

describe('createResource — mutate()', () => {
    it('sets data directly without re-fetching', async () => {
        const fetcher = vi.fn().mockResolvedValue([1, 2, 3]);
        const [data, { mutate }] = createResource(fetcher);
        await flush(10);
        expect(data()).toEqual([1, 2, 3]);

        mutate([1, 2, 3, 4]);
        expect(data()).toEqual([1, 2, 3, 4]);
        expect(fetcher).toHaveBeenCalledOnce(); // no extra fetch
    });

    it('accepts an updater function', async () => {
        const fetcher = vi.fn().mockResolvedValue({ count: 5 });
        const [data, { mutate }] = createResource(fetcher);
        await flush(10);

        mutate(prev => ({ ...prev, count: prev.count + 1 }));
        expect(data().count).toBe(6);
    });
});

describe('createResource — reactive source re-fetch', () => {
    it('re-fetches when a reactive signal read inside fetcher changes', async () => {
        const [userId, setUserId] = state(1);
        const fetcher = vi.fn(async () => `user-${userId()}`);

        const [data] = createResource(fetcher);
        await flush(10);
        expect(data()).toBe('user-1');
        expect(fetcher).toHaveBeenCalledTimes(1);

        setUserId(2);
        await flush(10);
        expect(data()).toBe('user-2');
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('clears error on successful re-fetch', async () => {
        const [flag, setFlag] = state(false);
        let attempt = 0;
        const fetcher = vi.fn(async () => {
            flag(); // track signal
            attempt++;
            if (attempt === 1) throw new Error('fail');
            return 'ok';
        });

        const [data, { error }] = createResource(fetcher);
        await flush(10);
        expect(error()).not.toBeNull();

        setFlag(true);
        await flush(10);
        expect(error()).toBeNull();
        expect(data()).toBe('ok');
    });
});
