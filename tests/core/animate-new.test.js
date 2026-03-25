import { describe, it, expect, vi, beforeEach } from 'vitest';
import { animate } from '../../src/js/core/animate.js';

beforeEach(() => { document.body.innerHTML = ''; });

function el(style = '') {
    const div = document.createElement('div');
    if (style) div.style.cssText = style;
    document.body.appendChild(div);
    return div;
}

// ─── animate.collapse / animate.expand ─────────────────────────────────

describe('animate.collapse() and animate.expand()', () => {
    it('collapse() sets display:none after completing', async () => {
        const div = el('height:100px');
        await animate.collapse(div, { duration: 10 });
        expect(div.style.display).toBe('none');
    });

    it('collapse() is a no-op when already hidden', async () => {
        const div = el('display:none');
        await expect(animate.collapse(div, { duration: 10 })).resolves.toBeUndefined();
        expect(div.style.display).toBe('none');
    });

    it('expand() restores display and clears height', async () => {
        const div = el('display:none');
        await animate.expand(div, { duration: 10 });
        expect(div.style.display).not.toBe('none');
        expect(div.style.height).toBe('');
    });

    it('collapse() accepts a CSS selector', async () => {
        const div = el();
        div.id = 'col-target';
        await animate.collapse('#col-target', { duration: 10 });
        expect(div.style.display).toBe('none');
    });

    it('expand() handles null element gracefully', async () => {
        await expect(animate.expand(null, { duration: 10 })).resolves.toBeUndefined();
    });
});

// ─── animate.countUp() ─────────────────────────────────────────────────

describe('animate.countUp(element, from, to, options)', () => {
    it('sets the "from" value synchronously before animation starts', () => {
        vi.useFakeTimers();
        const div = el();
        animate.countUp(div, 0, 100, { duration: 500 });
        // countUp sets the initial value synchronously, no timers needed
        expect(div.textContent).toBe('0');
        vi.useRealTimers();
    });

    it('returns a handle with stop()', () => {
        vi.useFakeTimers();
        const div = el();
        const handle = animate.countUp(div, 0, 1000, { duration: 1000 });
        expect(typeof handle?.stop).toBe('function');
        expect(() => handle.stop()).not.toThrow();
        vi.useRealTimers();
    });

    it('applies prefix and suffix and uses correct easing key', () => {
        vi.useFakeTimers();
        const div = el();
        // Use 'ease' (valid key) instead of 'easeOut' (invalid)
        animate.countUp(div, 0, 50, { duration: 500, prefix: '$', suffix: ' USD', decimals: 2, easing: 'ease' });
        vi.runAllTimers();
        // After all timers, should have reached ~50
        expect(div.textContent).toContain('$');
        expect(div.textContent).toContain('USD');
        vi.useRealTimers();
    });

    it('accepts ease-out easing key', () => {
        vi.useFakeTimers();
        const div = el();
        // 'ease-out' is the correct key (kebab-case)
        expect(() => animate.countUp(div, 0, 10, { duration: 100, easing: 'ease-out' })).not.toThrow();
        vi.useRealTimers();
    });

    it('returns null for non-existent element', () => {
        const result = animate.countUp('#nonexistent', 0, 100);
        expect(result).toBeNull();
    });
});

// ─── F-40: animate.typewriter() ──────────────────────────────────────────────

describe('animate.typewriter(element, text, options)', () => {
    it('returns a handle with stop() and promise', () => {
        vi.useFakeTimers();
        const div = el();
        const handle = animate.typewriter(div, 'Hello', { speed: 50 });
        expect(typeof handle.stop).toBe('function');
        expect(handle.promise).toBeInstanceOf(Promise);
        handle.stop();
        vi.useRealTimers();
    });

    it('stop() immediately sets the full text', () => {
        vi.useFakeTimers();
        const div = el();
        const handle = animate.typewriter(div, 'Full text', { speed: 100, cursor: false });
        vi.advanceTimersByTime(50);
        handle.stop();
        expect(div.textContent).toBe('Full text');
        vi.useRealTimers();
    });

    it('promise resolves when typing completes', async () => {
        vi.useFakeTimers();
        const div = el();
        const handle = animate.typewriter(div, 'Hi', { speed: 10, cursor: false });
        vi.runAllTimers();
        await handle.promise;
        expect(div.textContent).toBe('Hi');
        vi.useRealTimers();
    });

    it('handles null element gracefully', () => {
        const handle = animate.typewriter(null, 'test');
        expect(typeof handle.stop).toBe('function');
        expect(handle.promise).toBeInstanceOf(Promise);
    });
});

// ─── animate.shake() ───────────────────────────────────────────────────

describe('animate.shake(element)', () => {
    it('returns a Promise', () => {
        const div = el();
        const result = animate.shake(div, { duration: 10 });
        expect(result).toBeInstanceOf(Promise);
    });

    it('resolves after the shake completes', async () => {
        vi.useFakeTimers();
        const div = el();
        const p = animate.shake(div, { duration: 50 });
        vi.runAllTimers();
        await expect(p).resolves.toBeUndefined();
        vi.useRealTimers();
    });

    it('accepts a CSS selector', async () => {
        vi.useFakeTimers();
        const div = el();
        div.id = 'shake-me';
        const p = animate.shake('#shake-me', { duration: 50 });
        vi.runAllTimers();
        await expect(p).resolves.toBeUndefined();
        vi.useRealTimers();
    });

    it('resolves immediately for null element', async () => {
        await expect(animate.shake(null)).resolves.toBeUndefined();
    });
});
