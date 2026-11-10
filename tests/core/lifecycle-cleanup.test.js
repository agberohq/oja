import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { onUnmount, registerUnmount, component, _setActiveForTest, _getScopeForTest } from '../../src/js/core/component.js';
import { signal, state, watch } from '../../src/js/core/reactive.js';
import { Store } from '../../src/js/core/store.js';

function makeEl(tag = 'div') {
    const el = document.createElement(tag);
    document.body.appendChild(el);
    return el;
}

beforeEach(() => {
    document.body.innerHTML = '';
    _setActiveForTest(null);
});

afterEach(() => {
    _setActiveForTest(null);
    vi.restoreAllMocks();
});

describe('onUnmount()', () => {
    it('registers a teardown callback on the current component scope', async () => {
        const container = makeEl();
        _setActiveForTest(container);

        const fn = vi.fn();
        onUnmount(fn);

        expect(_getScopeForTest(container).unmount).toContain(fn);

        _setActiveForTest(null);
        await component._runUnmount(container);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('returns an unregister function', async () => {
        const container = makeEl();
        _setActiveForTest(container);

        const fn = vi.fn();
        const cancel = onUnmount(fn);
        cancel();
        expect(_getScopeForTest(container).unmount).not.toContain(fn);

        _setActiveForTest(null);
        await component._runUnmount(container);
        expect(fn).not.toHaveBeenCalled();
    });

    it('warns and returns a no-op outside a component context', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const cancel = onUnmount(() => {});
        expect(typeof cancel).toBe('function');
        expect(() => cancel()).not.toThrow();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('onUnmount() called outside a component context'));
    });

    it('still supports registerUnmount(el, fn) for explicit containers', async () => {
        const container = makeEl();
        const fn = vi.fn();
        registerUnmount(container, fn);
        await component._runUnmount(container);
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe('subscription auto-cleanup', () => {
    it('signal.subscribe() is disposed when the component unmounts', async () => {
        const container = makeEl();
        _setActiveForTest(container);

        const fn = vi.fn();
        const sig = signal('test:cleanup:signal');
        const off = sig.subscribe(fn);
        expect(_getScopeForTest(container).ons).toContain(off);

        sig.set('before');
        expect(fn).toHaveBeenCalledTimes(1);

        _setActiveForTest(null);
        await component._runUnmount(container);

        sig.set('after');
        expect(fn).toHaveBeenCalledTimes(1); // unsubscribed
        sig.destroy();
    });

    it('Store.onChange() is disposed when the component unmounts', async () => {
        const container = makeEl();
        _setActiveForTest(container);

        const store = new Store('test:cleanup:store', { prefer: 'memory' });
        const fn = vi.fn();
        const off = store.onChange('name', fn);
        expect(_getScopeForTest(container).ons).toContain(off);

        store.set('name', 'before');
        expect(fn).toHaveBeenCalledWith('before', null);

        _setActiveForTest(null);
        await component._runUnmount(container);

        store.set('name', 'after');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('watch() is disposed when the component unmounts', async () => {
        const container = makeEl();
        _setActiveForTest(container);

        const [count, setCount] = state(0);
        const fn = vi.fn();
        const off = watch(count, fn);
        expect(_getScopeForTest(container).ons).toContain(off);

        setCount(1);
        await Promise.resolve();
        expect(fn).toHaveBeenCalled();
        const calls = fn.mock.calls.length;

        _setActiveForTest(null);
        await component._runUnmount(container);
        setCount(2);
        expect(fn.mock.calls.length).toBe(calls);
    });

    it('manual unsubscribe still works after auto-registration', () => {
        const container = makeEl();
        _setActiveForTest(container);

        const fn = vi.fn();
        const sig = signal('test:cleanup:manual');
        const off = sig.subscribe(fn);
        off();
        sig.set('x');
        expect(fn).not.toHaveBeenCalled();
        sig.destroy();
        _setActiveForTest(null);
    });
});
