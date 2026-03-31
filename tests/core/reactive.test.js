import { describe, it, expect, vi, beforeEach } from 'vitest';
import { state, effect, derived, batch, context } from '../../src/js/core/reactive.js';

// context() is a module-level singleton — clear known keys between tests
beforeEach(() => {
    context.delete('test-counter');
    context.delete('test-user');
    context.delete('test-shared');
    context.delete('req-key');
    context.delete('req-pair');
});


describe('state()', () => {
    it('returns initial value', () => {
        const [count] = state(0);
        expect(count()).toBe(0);
    });

    it('updates value via setter', () => {
        const [count, setCount] = state(0);
        setCount(5);
        expect(count()).toBe(5);
    });

    it('supports functional update', () => {
        const [count, setCount] = state(10);
        setCount(n => n + 1);
        expect(count()).toBe(11);
    });

    it('marks the read function as an Oja signal', () => {
        const [read] = state(0);
        expect(read.__isOjaSignal).toBe(true);
    });

    it('does not notify on equal primitive re-set', async () => {
        const [count, setCount] = state(42);
        const spy = vi.fn();
        effect(() => { count(); spy(); });
        spy.mockClear();

        setCount(42);
        await Promise.resolve();
        expect(spy).not.toHaveBeenCalled();
    });

    it('always notifies when value is an object (reference comparison skipped)', async () => {
        const [obj, setObj] = state({ x: 1 });
        const spy = vi.fn();
        effect(() => { obj(); spy(); });
        spy.mockClear();

        setObj({ x: 1 });
        await Promise.resolve();
        expect(spy).toHaveBeenCalledTimes(1);
    });
});


describe('effect()', () => {
    it('runs immediately on creation', () => {
        const spy = vi.fn();
        effect(spy);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('re-runs when a dependency changes', async () => {
        const [count, setCount] = state(0);
        const spy = vi.fn();
        effect(() => { count(); spy(); });
        spy.mockClear();

        setCount(1);
        await Promise.resolve();
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does not re-run when an unread state changes', async () => {
        const [a] = state(0);
        const [, setB] = state(0);
        const spy = vi.fn();
        effect(() => { a(); spy(); });
        spy.mockClear();

        setB(99);
        await Promise.resolve();
        expect(spy).not.toHaveBeenCalled();
    });

    it('returns a dispose function that stops re-runs', async () => {
        const [count, setCount] = state(0);
        const spy = vi.fn();
        const dispose = effect(() => { count(); spy(); });
        spy.mockClear();

        dispose();
        setCount(1);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(spy).not.toHaveBeenCalled();
    });
});


describe('derived()', () => {
    it('computes initial value from dependencies', () => {
        const [count] = state(4);
        const double = derived(() => count() * 2);
        expect(double()).toBe(8);
    });

    it('updates when dependency changes', async () => {
        const [count, setCount] = state(3);
        const triple = derived(() => count() * 3);

        setCount(5);
        await Promise.resolve();
        await Promise.resolve();
        expect(triple()).toBe(15);
    });
});


describe('batch()', () => {
    it('fires effect only once for multiple updates inside a batch', async () => {
        const [a, setA] = state(0);
        const [b, setB] = state(0);
        const spy = vi.fn();
        effect(() => { a(); b(); spy(); });
        spy.mockClear();

        batch(() => {
            setA(1);
            setB(1);
        });
        await Promise.resolve();
        expect(spy).toHaveBeenCalledTimes(1);
    });
});


describe('context()', () => {
    it('creates a named reactive value', () => {
        const [count] = context('test-counter', 0);
        expect(count()).toBe(0);
    });

    it('returns the same pair on subsequent calls', () => {
        const [, setA] = context('test-counter', 0);
        const [b]      = context('test-counter');
        setA(7);
        expect(b()).toBe(7);
    });

    it('initialValue is ignored after first creation', () => {
        context('test-user', 'alice');
        const [user] = context('test-user', 'bob');
        expect(user()).toBe('alice');
    });

    it('context.has() returns true for existing keys', () => {
        context('test-shared', 'x');
        expect(context.has('test-shared')).toBe(true);
    });

    it('context.has() returns false for unknown keys', () => {
        expect(context.has('__nonexistent__')).toBe(false);
    });

    it('context.get() returns the current value', () => {
        const [, set] = context('test-counter', 0);
        set(42);
        expect(context.get('test-counter')).toBe(42);
    });

    it('context.delete() removes the entry', () => {
        context('test-shared', 'x');
        context.delete('test-shared');
        expect(context.has('test-shared')).toBe(false);
    });
});


describe('context.require()', () => {
    it('throws if the key has not been registered', () => {
        expect(() => context.require('req-key')).toThrow(/req-key/);
    });

    it('includes the key name in the error message', () => {
        expect(() => context.require('req-key')).toThrow('req-key');
    });

    it('returns the [read, write] pair when the key exists', () => {
        const [read, write] = context('req-pair', 99);
        const pair = context.require('req-pair');
        expect(Array.isArray(pair)).toBe(true);
        expect(pair[0]).toBe(read);
        expect(pair[1]).toBe(write);
    });

    it('returned read reflects current value', () => {
        const [, set] = context('req-pair', 0);
        const [read]  = context.require('req-pair');
        set(55);
        expect(read()).toBe(55);
    });

    it('does not throw after the key is registered', () => {
        context('req-key', 'hello');
        expect(() => context.require('req-key')).not.toThrow();
    });
});