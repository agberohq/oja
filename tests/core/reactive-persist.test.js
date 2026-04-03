/**
 * Tests for context.persist — onQuotaExceeded callback and oja:quota-exceeded event.
 *
 * Key design note:
 *   We spy on localStorage.setItem (the instance) NOT Storage.prototype.setItem.
 *   Mocking the prototype also breaks _isStorageAvailable() which calls
 *   setItem('__oja_test__') as a probe — that would make it return false and
 *   cause _savePersistent to exit before reaching the quota handler.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { context } from '../../src/js/core/reactive.js';

let keyCounter = 0;
function freshKey() { return `persist-test-${Date.now()}-${++keyCounter}`; }

function makeQuotaError() {
    return new DOMException('QuotaExceededError', 'QuotaExceededError');
}

// Spy on the localStorage INSTANCE method so _isStorageAvailable still works.
// We make the spy throw only for keys that look like real data (not the probe).
function mockSetItemQuota() {
    return vi.spyOn(localStorage, 'setItem').mockImplementation((k) => {
        if (k === '__oja_test__') return; // let availability probe pass
        throw makeQuotaError();
    });
}

describe('context.persist — onQuotaExceeded callback', () => {
    let key;
    let spy;

    beforeEach(() => { key = freshKey(); });
    afterEach(() => { spy?.mockRestore(); context.delete(key); });

    it('calls onQuotaExceeded when setItem throws QuotaExceededError', () => {
        spy = mockSetItemQuota();
        const handler = vi.fn();

        const [, setValue] = context.persist(key, 'initial', {
            onQuotaExceeded: handler,
        });

        setValue('trigger-quota');

        expect(handler).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledWith(
            expect.stringContaining(key),
            'trigger-quota',
            expect.any(DOMException)
        );
    });

    it('does not call onQuotaExceeded for non-quota errors', () => {
        spy = vi.spyOn(localStorage, 'setItem').mockImplementation((k) => {
            if (k === '__oja_test__') return;
            throw new TypeError('some other error');
        });
        const handler = vi.fn();

        const [, setValue] = context.persist(freshKey(), 'x', {
            onQuotaExceeded: handler,
        });
        setValue('boom');

        expect(handler).not.toHaveBeenCalled();
    });

    it('works without onQuotaExceeded — does not throw', () => {
        spy = mockSetItemQuota();
        const [, setValue] = context.persist(freshKey(), 'x');
        expect(() => setValue('trigger')).not.toThrow();
    });

    it('onQuotaExceeded throwing does not propagate', () => {
        spy = mockSetItemQuota();
        const[, setValue] = context.persist(freshKey(), 'x', {
            onQuotaExceeded: () => { throw new Error('handler threw'); },
        });
        expect(() => setValue('boom')).not.toThrow();
    });
});

describe('context.persist — oja:quota-exceeded window event', () => {
    let spy;
    let listener;
    let events;

    beforeEach(() => {
        events   =[];
        listener = (e) => events.push(e.detail);
        window.addEventListener('oja:quota-exceeded', listener);
    });

    afterEach(() => {
        spy?.mockRestore();
        window.removeEventListener('oja:quota-exceeded', listener);
    });

    it('dispatches oja:quota-exceeded on window when quota is hit', () => {
        spy = mockSetItemQuota();
        const k = freshKey();
        const [, setValue] = context.persist(k, 'x');
        setValue('quota-trigger');
        context.delete(k);

        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({
            key:     expect.stringContaining(k),
            storage: 'local',
            value:   'quota-trigger',
            error:   expect.any(DOMException),
        });
    });

    it('does not dispatch window event for non-quota errors', () => {
        spy = vi.spyOn(localStorage, 'setItem').mockImplementation((k) => {
            if (k === '__oja_test__') return;
            throw new TypeError('not quota');
        });
        const k = freshKey();
        const [, setValue] = context.persist(k, 'x');
        setValue('boom');
        context.delete(k);

        expect(events).toHaveLength(0);
    });

    it('fires window event even when no onQuotaExceeded callback is set', () => {
        spy = mockSetItemQuota();
        const k = freshKey();
        const[, setValue] = context.persist(k, 'x');
        setValue('quota-trigger'); // must be different from initial 'x'
        context.delete(k);

        expect(events).toHaveLength(1);
    });

    it('fires both callback AND window event when quota hit', () => {
        spy = mockSetItemQuota();
        const cbCalls = [];
        const k = freshKey();
        const [, setValue] = context.persist(k, 'x', {
            onQuotaExceeded: (key, val) => cbCalls.push({ key, val }),
        });
        setValue('both');
        context.delete(k);

        expect(cbCalls).toHaveLength(1);
        expect(events).toHaveLength(1);
    });
});

describe('context.persist — normal behaviour unchanged', () => {
    afterEach(() => {
        // Clean up any oja: prefixed keys we created
        const toRemove =[];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k?.includes('persist-test-')) toRemove.push(k);
        }
        toRemove.forEach(k => localStorage.removeItem(k));
    });

    it('persists and reads back a string value', () => {
        const k = freshKey();
        const [read, write] = context.persist(k, 'default');
        write('saved');
        expect(read()).toBe('saved');
        context.delete(k);
    });

    it('reads initial value from localStorage when present before init', () => {
        const k  = freshKey();
        const sk = `oja:${k}`;
        localStorage.setItem(sk, JSON.stringify('from-storage'));
        const [read] = context.persist(k, 'default');
        expect(read()).toBe('from-storage');
        context.delete(k);
        localStorage.removeItem(sk);
    });
});
