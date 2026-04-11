/**
 * tests/core/events.scoped.test.js
 *
 * Tests for scopedListen() — auto-cleanup event subscriptions tied to
 * the active component lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { scopedListen, listen, emit } from '../../src/js/core/events.js';
import { component, _setActiveForTest } from '../../src/js/core/component.js';

// helpers

function makeEl() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

function cleanup(el) {
    el?.parentNode?.removeChild(el);
}

// scopedListen — outside component context

describe('scopedListen — outside component context', () => {
    afterEach(() => vi.restoreAllMocks());

    it('behaves like listen() when called outside a component', () => {
        const handler = vi.fn();
        const unsub   = scopedListen('test:event-outside', handler);

        emit('test:event-outside', { value: 42 });
        expect(handler).toHaveBeenCalledWith({ value: 42 }, expect.anything());

        unsub(); // manual cleanup
        emit('test:event-outside', { value: 99 });
        expect(handler).toHaveBeenCalledTimes(1); // not called again
    });

    it('returns an unsub function', () => {
        const unsub = scopedListen('test:unsub-shape', () => {});
        expect(typeof unsub).toBe('function');
        unsub();
    });

    it('unsub stops the listener', () => {
        const handler = vi.fn();
        const unsub   = scopedListen('test:stop', handler);
        unsub();
        emit('test:stop', {});
        expect(handler).not.toHaveBeenCalled();
    });
});

// scopedListen — inside component context

describe('scopedListen — inside component context', () => {
    let el;
    beforeEach(() => { el = makeEl(); });
    afterEach(() => {
        _setActiveForTest(null); // clear context
        cleanup(el);
        vi.restoreAllMocks();
    });

    it('registers the unsub with the active component scope', async () => {
        _setActiveForTest(el);

        const handler = vi.fn();
        scopedListen('test:scoped-reg', handler);

        emit('test:scoped-reg', { x: 1 });
        expect(handler).toHaveBeenCalledWith({ x: 1 }, expect.anything());

        // Simulate navigation — _runUnmount calls all registered unsubs
        _setActiveForTest(null);
        await component._runUnmount(el);

        // Handler should no longer fire
        emit('test:scoped-reg', { x: 2 });
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('multiple scopedListen calls all cleaned up on unmount', async () => {
        _setActiveForTest(el);

        const h1 = vi.fn();
        const h2 = vi.fn();
        scopedListen('test:multi-1', h1);
        scopedListen('test:multi-2', h2);

        emit('test:multi-1', {});
        emit('test:multi-2', {});
        expect(h1).toHaveBeenCalledTimes(1);
        expect(h2).toHaveBeenCalledTimes(1);

        _setActiveForTest(null);
        await component._runUnmount(el);

        emit('test:multi-1', {});
        emit('test:multi-2', {});
        expect(h1).toHaveBeenCalledTimes(1); // unchanged
        expect(h2).toHaveBeenCalledTimes(1); // unchanged
    });

    it('early manual unsub works even when scoped', async () => {
        _setActiveForTest(el);

        const handler = vi.fn();
        const unsub   = scopedListen('test:early-unsub', handler);

        // Manually unsubscribe before unmount
        unsub();
        emit('test:early-unsub', {});
        expect(handler).not.toHaveBeenCalled();

        // Unmount should not throw even though handler is already unsubbed
        _setActiveForTest(null);
        await expect(component._runUnmount(el)).resolves.not.toThrow();
    });

    it('does not affect other components when one unmounts', async () => {
        const el2 = makeEl();

        _setActiveForTest(el);
        const h1 = vi.fn();
        scopedListen('test:isolation', h1);
        _setActiveForTest(null);

        _setActiveForTest(el2);
        const h2 = vi.fn();
        scopedListen('test:isolation', h2);
        _setActiveForTest(null);

        // Unmount only el — h1 should stop, h2 should continue
        await component._runUnmount(el);

        emit('test:isolation', {});
        expect(h1).toHaveBeenCalledTimes(0);
        expect(h2).toHaveBeenCalledTimes(1);

        // Cleanup el2
        await component._runUnmount(el2);
        cleanup(el2);
    });
});

// composite scope — onUnmount injection

describe('registerUnmount — composite scope integration', () => {
    let el;
    beforeEach(() => { el = makeEl(); });
    afterEach(() => { cleanup(el); vi.restoreAllMocks(); });

    it('registerUnmount hooks into component._runUnmount', async () => {
        const { registerUnmount } = await import('../../src/js/core/component.js');
        const cleanup_fn = vi.fn();

        registerUnmount(el, cleanup_fn);
        await component._runUnmount(el);

        expect(cleanup_fn).toHaveBeenCalledOnce();
    });

    it('registerUnmount ignores non-function second arg', async () => {
        const { registerUnmount } = await import('../../src/js/core/component.js');
        expect(() => registerUnmount(el, 'not-a-function')).not.toThrow();
        expect(() => registerUnmount(el, null)).not.toThrow();
        expect(() => registerUnmount(el, 42)).not.toThrow();
    });

    it('registerUnmount ignores null first arg', async () => {
        const { registerUnmount } = await import('../../src/js/core/component.js');
        expect(() => registerUnmount(null, () => {})).not.toThrow();
    });
});
