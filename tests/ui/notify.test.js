import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { notify } from '../../src/js/ui/notify.js';

beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
    // Reset internal container state by calling dismissAll
    notify.dismissAll();
    notify.setPosition('top-right');
});

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
});


describe('notify.dismiss(id)', () => {
    it('removes the toast with the matching id', () => {
        const id = notify.info('Hello');
        expect(document.getElementById(id)).not.toBeNull();

        notify.dismiss(id);
        vi.advanceTimersByTime(300);

        expect(document.getElementById(id)).toBeNull();
    });

    it('is safe to call with a stale id after the toast has already gone', () => {
        const id = notify.info('Hello');
        notify.dismiss(id);
        vi.advanceTimersByTime(300);

        expect(() => notify.dismiss(id)).not.toThrow();
    });

    it('is safe to call with null or undefined', () => {
        notify.success('Alive');
        expect(() => notify.dismiss(null)).not.toThrow();
        expect(() => notify.dismiss(undefined)).not.toThrow();
    });

    it('only removes the targeted toast, leaving others intact', () => {
        const id1 = notify.info('First');
        const id2 = notify.info('Second');

        notify.dismiss(id1);
        vi.advanceTimersByTime(300);

        expect(document.getElementById(id1)).toBeNull();
        expect(document.getElementById(id2)).not.toBeNull();
    });

    it('returns the notify object for chaining', () => {
        const id = notify.info('Hi');
        expect(notify.dismiss(id)).toBe(notify);
    });

    it('adds oja-toast-leaving class before the removal timeout', () => {
        const id = notify.success('Bye');
        notify.dismiss(id);

        const toast = document.getElementById(id);
        expect(toast?.classList.contains('oja-toast-leaving')).toBe(true);
    });
});


describe('notify.dismissAll()', () => {
    it('removes all visible toasts', () => {
        notify.info('A');
        notify.warn('B');
        notify.error('C');

        expect(notify.count()).toBe(3);

        notify.dismissAll();
        vi.advanceTimersByTime(300);

        expect(notify.count()).toBe(0);
    });

    it('is safe to call when no toasts are visible', () => {
        expect(() => notify.dismissAll()).not.toThrow();
    });

    it('returns the notify object for chaining', () => {
        expect(notify.dismissAll()).toBe(notify);
    });
});


describe('notify.success / info / warn / error', () => {
    it('each returns a string id', () => {
        expect(typeof notify.success('ok')).toBe('string');
        expect(typeof notify.info('ok')).toBe('string');
        expect(typeof notify.warn('ok')).toBe('string');
        expect(typeof notify.error('ok')).toBe('string');
    });

    it('auto-dismisses after the default duration', () => {
        const id = notify.info('Fading', { duration: 1000 });
        expect(document.getElementById(id)).not.toBeNull();

        vi.advanceTimersByTime(1000);
        vi.advanceTimersByTime(300); // removal animation

        expect(document.getElementById(id)).toBeNull();
    });

    it('does not auto-dismiss when duration is 0', () => {
        const id = notify.info('Persistent', { duration: 0 });
        vi.advanceTimersByTime(10_000);
        expect(document.getElementById(id)).not.toBeNull();
    });
});


describe('notify.count()', () => {
    it('returns 0 when no toasts are shown', () => {
        expect(notify.count()).toBe(0);
    });

    it('reflects the number of active toasts', () => {
        notify.info('One', { duration: 0 });
        notify.info('Two', { duration: 0 });
        expect(notify.count()).toBe(2);
    });

    it('decrements after dismiss', () => {
        const id = notify.info('One', { duration: 0 });
        notify.info('Two', { duration: 0 });
        expect(notify.count()).toBe(2);

        notify.dismiss(id);
        vi.advanceTimersByTime(300);
        expect(notify.count()).toBe(1);
    });
});