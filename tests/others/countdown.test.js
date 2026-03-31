import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { countdown } from '../../src/js/ui/countdown.js';

beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
});

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
});


describe('countdown.attach()', () => {
    it('returns a handle with destroy()', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        const handle = countdown.attach(el, Date.now() + 10_000);
        expect(typeof handle.destroy).toBe('function');
    });

    it('sets textContent immediately on attach', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        countdown.attach(el, Date.now() + 65_000);
        expect(el.textContent).toMatch(/1m/);
    });

    it('uses a custom format function', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        countdown.attach(el, Date.now() + 5_000, {
            format: (ms) => `${Math.ceil(ms / 1000)}s left`,
        });
        expect(el.textContent).toContain('s left');
    });

    it('updates textContent after each second', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        countdown.attach(el, Date.now() + 10_000, {
            format: (ms) => String(Math.ceil(ms / 1000)),
        });
        const before = el.textContent;
        vi.advanceTimersByTime(1000);
        expect(el.textContent).not.toBe(before);
    });

    it('calls onExpire when time runs out', () => {
        const onExpire = vi.fn();
        const el = document.createElement('div');
        document.body.appendChild(el);
        countdown.attach(el, Date.now() + 2_000, { onExpire });
        vi.advanceTimersByTime(3_000);
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('calls onExpire exactly once even if interval fires multiple times after expiry', () => {
        const onExpire = vi.fn();
        const el = document.createElement('div');
        document.body.appendChild(el);
        countdown.attach(el, Date.now() + 1_000, { onExpire });
        vi.advanceTimersByTime(5_000);
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('calls onWarn when msLeft crosses below warn threshold', () => {
        const onWarn = vi.fn();
        const el = document.createElement('div');
        document.body.appendChild(el);
        countdown.attach(el, Date.now() + 10_000, {
            warn: 5_000,
            onWarn,
        });
        vi.advanceTimersByTime(6_000);
        expect(onWarn).toHaveBeenCalledTimes(1);
    });

    it('calls onWarn exactly once even after multiple ticks below threshold', () => {
        const onWarn = vi.fn();
        const el = document.createElement('div');
        document.body.appendChild(el);
        countdown.attach(el, Date.now() + 10_000, {
            warn: 8_000,
            onWarn,
        });
        vi.advanceTimersByTime(10_000);
        expect(onWarn).toHaveBeenCalledTimes(1);
    });

    it('destroy() stops the interval — textContent no longer updates', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        const handle = countdown.attach(el, Date.now() + 60_000, {
            format: (ms) => String(Math.ceil(ms / 1000)),
        });
        handle.destroy();
        const snapshot = el.textContent;
        vi.advanceTimersByTime(3_000);
        expect(el.textContent).toBe(snapshot);
    });

    it('destroy() after expiry does not throw', () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        const handle = countdown.attach(el, Date.now() + 500);
        vi.advanceTimersByTime(2_000);
        expect(() => handle.destroy()).not.toThrow();
    });

    it('warns and returns no-op handle when target not found', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const handle = countdown.attach('#nonexistent-element', Date.now() + 5_000);
        expect(typeof handle.destroy).toBe('function');
        expect(() => handle.destroy()).not.toThrow();
        warnSpy.mockRestore();
    });
});


describe('countdown.start()', () => {
    it('returns a handle with stop() and reset()', () => {
        const handle = countdown.start(Date.now() + 10_000);
        expect(typeof handle.stop).toBe('function');
        expect(typeof handle.reset).toBe('function');
        handle.stop();
    });

    it('calls onTick on every second with msLeft', () => {
        const onTick = vi.fn();
        const handle = countdown.start(Date.now() + 5_000, { onTick });
        vi.advanceTimersByTime(3_000);
        handle.stop();
        expect(onTick.mock.calls.length).toBeGreaterThanOrEqual(3);
        expect(onTick.mock.calls[0][0]).toBeGreaterThan(0);
    });

    it('calls onExpire once when time runs out', () => {
        const onExpire = vi.fn();
        const handle = countdown.start(Date.now() + 2_000, { onExpire });
        vi.advanceTimersByTime(4_000);
        expect(onExpire).toHaveBeenCalledTimes(1);
        handle.stop();
    });

    it('stop() halts ticking — onTick not called after stop', () => {
        const onTick = vi.fn();
        const handle = countdown.start(Date.now() + 10_000, { onTick });
        vi.advanceTimersByTime(1_000);
        handle.stop();
        const callsAfterStop = onTick.mock.calls.length;
        vi.advanceTimersByTime(5_000);
        expect(onTick.mock.calls.length).toBe(callsAfterStop);
    });

    it('reset() restarts with a new expiresAt', () => {
        const onExpire = vi.fn();
        const handle = countdown.start(Date.now() + 2_000, { onExpire });
        vi.advanceTimersByTime(1_000);
        // Reset to 5 seconds from now
        handle.reset(Date.now() + 5_000);
        vi.advanceTimersByTime(2_500);
        // Should not have expired yet after reset
        expect(onExpire).not.toHaveBeenCalled();
        vi.advanceTimersByTime(4_000);
        expect(onExpire).toHaveBeenCalledTimes(1);
        handle.stop();
    });

    it('reset() clears warn state so onWarn can fire again', () => {
        const onWarn = vi.fn();
        const handle = countdown.start(Date.now() + 10_000, {
            warn: 5_000,
            onWarn,
        });
        vi.advanceTimersByTime(6_000);
        expect(onWarn).toHaveBeenCalledTimes(1);

        handle.reset(Date.now() + 10_000);
        vi.advanceTimersByTime(6_000);
        expect(onWarn).toHaveBeenCalledTimes(2);
        handle.stop();
    });

    it('onTick receives 0 (not negative) when time is up', () => {
        const onTick = vi.fn();
        const handle = countdown.start(Date.now() + 500, { onTick });
        vi.advanceTimersByTime(2_000);
        handle.stop();
        const lastArg = onTick.mock.calls[onTick.mock.calls.length - 1]?.[0];
        expect(lastArg).toBeGreaterThanOrEqual(0);
    });
});


describe('countdown.daysLeft()', () => {
    it('returns null for null input', () => {
        expect(countdown.daysLeft(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
        expect(countdown.daysLeft(undefined)).toBeNull();
    });

    it('returns null for invalid date string', () => {
        expect(countdown.daysLeft('not-a-date')).toBeNull();
    });

    it('returns a positive integer for a future date', () => {
        const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
        const result = countdown.daysLeft(future);
        expect(result).toBeGreaterThan(0);
        expect(Number.isInteger(result)).toBe(true);
    });

    it('returns 0 for a date less than 24 hours in the future', () => {
        const almostTomorrow = new Date(Date.now() + 23 * 3_600_000).toISOString();
        expect(countdown.daysLeft(almostTomorrow)).toBe(0);
    });

    it('returns a negative integer for a past date', () => {
        const past = new Date(Date.now() - 3 * 86_400_000).toISOString();
        expect(countdown.daysLeft(past)).toBeLessThan(0);
    });

    it('accepts a numeric ms timestamp', () => {
        const futureMs = Date.now() + 5 * 86_400_000;
        expect(countdown.daysLeft(futureMs)).toBeGreaterThan(0);
    });
});


describe('countdown.daysLabel()', () => {
    it('returns "—" for null', () => {
        expect(countdown.daysLabel(null)).toBe('—');
    });

    it('returns "—" for undefined', () => {
        expect(countdown.daysLabel(undefined)).toBe('—');
    });

    it('returns "Expired" for negative daysLeft', () => {
        expect(countdown.daysLabel(-1)).toBe('Expired');
        expect(countdown.daysLabel(-100)).toBe('Expired');
    });

    it('returns "Today" for daysLeft === 0', () => {
        expect(countdown.daysLabel(0)).toBe('Today');
    });

    it('returns "Xd" for positive daysLeft number', () => {
        expect(countdown.daysLabel(12)).toBe('12d');
        expect(countdown.daysLabel(730)).toBe('730d');
    });

    it('accepts an ISO date string directly', () => {
        const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
        expect(countdown.daysLabel(future)).toMatch(/^\d+d$/);
    });

    it('never produces "nulld" for null input (regression guard)', () => {
        expect(countdown.daysLabel(null)).not.toContain('null');
        expect(countdown.daysLabel(null)).not.toContain('d');
    });
});


describe('countdown.daysColor()', () => {
    it('returns var(--danger) for null', () => {
        expect(countdown.daysColor(null)).toBe('var(--danger)');
    });

    it('returns var(--danger) for negative daysLeft', () => {
        expect(countdown.daysColor(-1)).toBe('var(--danger)');
    });

    it('returns var(--warning) for daysLeft < 7', () => {
        expect(countdown.daysColor(3)).toBe('var(--warning)');
        expect(countdown.daysColor(6)).toBe('var(--warning)');
    });

    it('returns var(--info) for daysLeft between 7 and 29', () => {
        expect(countdown.daysColor(7)).toBe('var(--info)');
        expect(countdown.daysColor(29)).toBe('var(--info)');
    });

    it('returns var(--success) for daysLeft >= 30', () => {
        expect(countdown.daysColor(30)).toBe('var(--success)');
        expect(countdown.daysColor(730)).toBe('var(--success)');
    });

    it('accepts an ISO string directly', () => {
        const future = new Date(Date.now() + 60 * 86_400_000).toISOString();
        expect(countdown.daysColor(future)).toBe('var(--success)');
    });
});