import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Store } from '../../src/js/core/store.js';

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
});

afterEach(() => {
    vi.useRealTimers();
});


describe('B-01: store.clearAll() — namespace isolation', () => {
    it('clears only keys belonging to its own namespace', () => {
        const a = new Store('ns-a', { prefer: 'local' });
        const b = new Store('ns-b', { prefer: 'local' });
        a.set('x', 1); a.set('y', 2);
        b.set('z', 99);
        a.clearAll();
        expect(a.get('x')).toBeNull();
        expect(a.get('y')).toBeNull();
        expect(b.get('z')).toBe(99); // B-01: must survive
    });

    it('does NOT wipe third-party localStorage keys', () => {
        localStorage.setItem('third-party-key', 'safe');
        const store = new Store('my-app', { prefer: 'local' });
        store.set('foo', 'bar');
        store.clearAll();
        expect(localStorage.getItem('third-party-key')).toBe('safe');
    });

    it('clears own keys across sessionStorage too', () => {
        const store = new Store('sess-test', { prefer: 'session' });
        store.set('a', 1); store.set('b', 2);
        store.clearAll();
        expect(store.get('a')).toBeNull();
        expect(store.get('b')).toBeNull();
    });
});


describe('F-21: store.getOrSet()', () => {
    it('returns existing value without calling factory', () => {
        const store = new Store('t');
        store.set('k', 42);
        const factory = vi.fn(() => 99);
        expect(store.getOrSet('k', factory)).toBe(42);
        expect(factory).not.toHaveBeenCalled();
    });

    it('calls factory and stores result when key is absent', () => {
        const store = new Store('t2');
        const result = store.getOrSet('missing', () => 'computed');
        expect(result).toBe('computed');
        expect(store.get('missing')).toBe('computed');
    });

    it('accepts a plain value (non-function) as default', () => {
        const store = new Store('t3');
        expect(store.getOrSet('x', 'static')).toBe('static');
        expect(store.get('x')).toBe('static');
    });
});


describe('F-22: store.onChange("*") wildcard', () => {
    it('fires for any key change with (key, newVal, oldVal)', () => {
        const store = new Store('wc');
        const handler = vi.fn();
        store.onChange('*', handler);
        store.set('foo', 1);
        expect(handler).toHaveBeenCalledWith('foo', 1, null);
    });

    it('fires for multiple different keys', () => {
        const store = new Store('wc2');
        const keys = [];
        store.onChange('*', (k) => keys.push(k));
        store.set('a', 1); store.set('b', 2); store.set('c', 3);
        expect(keys).toEqual(['a', 'b', 'c']);
    });

    it('unsubscribes via returned function', () => {
        const store = new Store('wc3');
        const fn = vi.fn();
        const off = store.onChange('*', fn);
        off();
        store.set('x', 1);
        expect(fn).not.toHaveBeenCalled();
    });
});


describe('store.size', () => {
    it('returns 0 for an empty store', () => {
        expect(new Store('empty').size).toBe(0);
    });

    it('reflects the current number of keys in the namespace', () => {
        const store = new Store('sz', { prefer: 'local' });
        store.set('a', 1); store.set('b', 2);
        expect(store.size).toBe(2);
    });

    it('decrements when a key is cleared', () => {
        const store = new Store('sz2', { prefer: 'local' });
        store.set('x', 1);
        store.clear('x');
        expect(store.size).toBe(0);
    });

    it('does not count keys from other namespaces', () => {
        const a = new Store('ns-size-a', { prefer: 'local' });
        const b = new Store('ns-size-b', { prefer: 'local' });
        a.set('k1', 1); a.set('k2', 2);
        b.set('k3', 3);
        expect(a.size).toBe(2);
        expect(b.size).toBe(1);
    });
});


describe('store.ttl()', () => {
    it('removes the key after the timeout', async () => {
        vi.useFakeTimers();
        const store = new Store('ttl1', { prefer: 'local' });
        store.set('flash', 'hello').ttl('flash', 1000);
        expect(store.get('flash')).toBe('hello');
        vi.advanceTimersByTime(1001);
        expect(store.get('flash')).toBeNull();
    });

    it('does nothing if the key does not exist', () => {
        const store = new Store('ttl2');
        expect(() => store.ttl('nonexistent', 1000)).not.toThrow();
    });

    it('fires onChange when key expires', async () => {
        vi.useFakeTimers();
        const store = new Store('ttl3', { prefer: 'local' });
        const fn = vi.fn();
        store.onChange('msg', fn);
        store.set('msg', 'hi').ttl('msg', 500);
        vi.advanceTimersByTime(501);
        expect(fn).toHaveBeenCalledWith(null, 'hi');
    });
});


describe('store.onChange() unsub', () => {
    it('returns a function that removes the specific listener', () => {
        const store = new Store('unsub');
        const fn = vi.fn();
        const off = store.onChange('k', fn);
        off();
        store.set('k', 1);
        expect(fn).not.toHaveBeenCalled();
    });
});