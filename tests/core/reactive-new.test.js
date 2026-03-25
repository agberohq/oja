import { describe, it, expect, vi, beforeEach } from 'vitest';
import { state, effect, watch, untrack, readonly, context } from '../../src/js/core/reactive.js';

beforeEach(() => {
    // clean any context keys between tests
    context.delete('__test_watch__');
    context.delete('__test_sub__');
    context.delete('__test_reset__');
});

// ─── watch() ───────────────────────────────────────────────────────────

describe('watch(signal, fn)', () => {
    it('does NOT run immediately by default', () => {
        const [count] = state(0);
        const fn = vi.fn();
        watch(count, fn);
        expect(fn).not.toHaveBeenCalled();
    });

    it('runs immediately when { immediate: true }', () => {
        const [count] = state(5);
        const fn = vi.fn();
        watch(count, fn, { immediate: true });
        expect(fn).toHaveBeenCalledWith(5, undefined);
    });

    it('fires with (newValue, oldValue) when signal changes', async () => {
        const [count, setCount] = state(0);
        const calls = [];
        watch(count, (n, o) => calls.push({ n, o }));
        setCount(1);
        await Promise.resolve(); await Promise.resolve();
        expect(calls).toContainEqual({ n: 1, o: 0 });
    });

    it('returns a dispose function that stops watching', async () => {
        const [count, setCount] = state(0);
        const fn = vi.fn();
        const dispose = watch(count, fn);
        dispose();
        setCount(99);
        await Promise.resolve(); await Promise.resolve();
        expect(fn).not.toHaveBeenCalled();
    });
});

// ─── F-13: untrack() ─────────────────────────────────────────────────────────

describe('untrack(fn)', () => {
    it('reads a signal value without subscribing the current effect', async () => {
        const [a, setA] = state(1);
        const [b, setB] = state(10);
        const calls = [];

        effect(() => {
            const aVal = a();                   // tracked
            const bVal = untrack(() => b());    // NOT tracked
            calls.push(aVal + bVal);
        });

        expect(calls).toHaveLength(1); // ran once on creation
        setB(20); // should NOT re-run effect
        await Promise.resolve(); await Promise.resolve();
        expect(calls).toHaveLength(1);

        setA(2); // SHOULD re-run effect
        await Promise.resolve(); await Promise.resolve();
        expect(calls).toHaveLength(2);
        expect(calls[1]).toBe(2 + 20); // picks up latest b() value
    });
});

// ─── readonly() ────────────────────────────────────────────────────────

describe('readonly(signal)', () => {
    it('returns a getter that reads the current value', () => {
        const [count, setCount] = state(42);
        const readonlyCount = readonly(count);
        expect(readonlyCount()).toBe(42);
        setCount(99);
        expect(readonlyCount()).toBe(99);
    });

    it('is marked as an Oja signal', () => {
        const [s] = state(0);
        const r = readonly(s);
        expect(r.__isOjaSignal).toBe(true);
    });

    it('is marked as readonly', () => {
        const [s] = state(0);
        const r = readonly(s);
        expect(r.__isReadonly).toBe(true);
    });
});

// ─── context.subscribe() ───────────────────────────────────────────────

describe('context.subscribe(name, fn)', () => {
    it('calls fn with (newVal, oldVal) when context changes', async () => {
        const [, setVal] = context('__test_sub__', 0);
        const calls = [];
        context.subscribe('__test_sub__', (n, o) => calls.push({ n, o }));
        setVal(5);
        await Promise.resolve(); await Promise.resolve();
        expect(calls).toContainEqual({ n: 5, o: 0 });
    });

    it('returns an unsubscribe function', async () => {
        const [, setVal] = context('__test_watch__', 0);
        const fn = vi.fn();
        const off = context.subscribe('__test_watch__', fn);
        off();
        setVal(99);
        await Promise.resolve(); await Promise.resolve();
        expect(fn).not.toHaveBeenCalled();
    });

    it('warns and returns noop for unknown context key', () => {
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const off = context.subscribe('__nonexistent__', () => {});
        expect(typeof off).toBe('function');
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });
});

// ─── context.reset() ───────────────────────────────────────────────────

describe('context.reset(name)', () => {
    it('restores the context value to its initial value', async () => {
        const [read, setVal] = context('__test_reset__', 'initial');
        setVal('changed');
        await Promise.resolve();
        expect(read()).toBe('changed');
        context.reset('__test_reset__');
        await Promise.resolve(); await Promise.resolve();
        expect(read()).toBe('initial');
    });

    it('does not throw for unknown context key', () => {
        expect(() => context.reset('__does_not_exist__')).not.toThrow();
    });
});

// ─── storage listener dedup (integration check) ────────────────────────

describe('persistentState storage listener dedup', () => {
    it('wires at most one storage listener per key', () => {
        const addSpy = vi.spyOn(window, 'addEventListener');
        // Calling context.persist multiple times with the same key
        context.persist('__b02_test__', 'x');
        context.persist('__b02_test__', 'x'); // second call — should not add another listener
        const storageCalls = addSpy.mock.calls.filter(c => c[0] === 'storage');
        // Should be at most 1 storage listener for this key
        expect(storageCalls.length).toBeLessThanOrEqual(1);
        addSpy.mockRestore();
    });
});
