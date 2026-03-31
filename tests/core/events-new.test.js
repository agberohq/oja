import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    onClickOutside, onHover, onLongPress,
    onMutation, debounce, onlyOnce,
} from '../../src/js/core/events.js';


describe('onMutation() — multiple handlers on same element', () => {
    it('supports two independent handlers on the same element', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);

        const a = vi.fn();
        const b = vi.fn();
        const offA = onMutation(el, a, { childList: true });
        const offB = onMutation(el, b, { childList: true });

        expect(typeof offA).toBe('function');
        expect(typeof offB).toBe('function');

        offA(); offB();
        document.body.removeChild(el);
    });

    it('unsubscribing one handler leaves the other intact', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        const a = vi.fn(); const b = vi.fn();
        const offA = onMutation(el, a, { childList: true });
        onMutation(el, b, { childList: true });
        offA();
        expect(() => el.appendChild(document.createElement('i'))).not.toThrow();
        document.body.removeChild(el);
    });
});


describe('debounce() — maxWait fires correctly', () => {
    it('does not fire maxWait timer on the very first call', () => {
        vi.useFakeTimers();
        const fn = vi.fn();
        const debouncedFn = debounce(fn, 200, { maxWait: 500 });

        debouncedFn();

        vi.advanceTimersByTime(100);
        expect(fn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(150); // total 250ms — debounce fires at 200ms
        expect(fn).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });

    it('fires after debounce delay when called once', () => {
        vi.useFakeTimers();
        const fn = vi.fn();
        const debouncedFn = debounce(fn, 100);

        debouncedFn();
        expect(fn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(101);
        expect(fn).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });
});


describe('onClickOutside(target, fn)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

    it('calls fn when click occurs outside the element', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        const fn = vi.fn();

        onClickOutside(el, fn);
        vi.runAllTimers(); // flush the internal setTimeout(0)

        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(fn).toHaveBeenCalled();
    });

    it('does NOT call fn when click is inside the element', () => {
        const outer = document.createElement('div');
        const inner = document.createElement('button');
        outer.appendChild(inner);
        document.body.appendChild(outer);

        const fn = vi.fn();
        onClickOutside(outer, fn);
        vi.runAllTimers();

        inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(fn).not.toHaveBeenCalled();
    });

    it('returns an unsubscribe function that stops listening', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        const fn = vi.fn();

        const off = onClickOutside(el, fn);
        vi.runAllTimers();

        off();
        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(fn).not.toHaveBeenCalled();
    });
});


describe('onHover(target, enter, leave)', () => {
    it('calls enter on mouseenter and leave on mouseleave', () => {
        const el = document.createElement('button');
        document.body.appendChild(el);
        const enter = vi.fn(); const leave = vi.fn();
        onHover(el, enter, leave);
        el.dispatchEvent(new MouseEvent('mouseenter'));
        el.dispatchEvent(new MouseEvent('mouseleave'));
        expect(enter).toHaveBeenCalledTimes(1);
        expect(leave).toHaveBeenCalledTimes(1);
        document.body.removeChild(el);
    });

    it('returns unsub that stops both listeners', () => {
        const el = document.createElement('button');
        document.body.appendChild(el);
        const enter = vi.fn(); const leave = vi.fn();
        const off = onHover(el, enter, leave);
        off();
        el.dispatchEvent(new MouseEvent('mouseenter'));
        el.dispatchEvent(new MouseEvent('mouseleave'));
        expect(enter).not.toHaveBeenCalled();
        expect(leave).not.toHaveBeenCalled();
        document.body.removeChild(el);
    });
});


describe('F-19: onLongPress(target, fn, duration)', () => {
    it('fires fn after pointer is held for duration', () => {
        vi.useFakeTimers();
        const el = document.createElement('button');
        document.body.appendChild(el);
        const fn = vi.fn();
        onLongPress(el, fn, 500);
        el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0, bubbles: true }));
        vi.advanceTimersByTime(501);
        expect(fn).toHaveBeenCalledTimes(1);
        document.body.removeChild(el);
        vi.useRealTimers();
    });

    it('cancels on pointerup before duration', () => {
        vi.useFakeTimers();
        const el = document.createElement('button');
        document.body.appendChild(el);
        const fn = vi.fn();
        onLongPress(el, fn, 500);
        el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0, bubbles: true }));
        vi.advanceTimersByTime(200);
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        vi.advanceTimersByTime(400);
        expect(fn).not.toHaveBeenCalled();
        document.body.removeChild(el);
        vi.useRealTimers();
    });
});


describe('onlyOnce export', () => {
    it('is a function', () => {
        expect(typeof onlyOnce).toBe('function');
    });

    it('ensures a function is called only once', () => {
        const fn = vi.fn(() => 42);
        const once = onlyOnce(fn);
        expect(once()).toBe(42);
        expect(once()).toBe(42);
        expect(fn).toHaveBeenCalledTimes(1);
    });
});