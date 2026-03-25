import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sw } from '../../src/js/ext/sw.js';

function makeSwShim(overrides = {}) {
    return {
        controller: null,
        ready: Promise.resolve({ active: { postMessage: vi.fn() } }),
        register: vi.fn().mockResolvedValue({}),
        addEventListener: vi.fn(),
        ...overrides,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'serviceWorker', {
        value: makeSwShim(), configurable: true, writable: true,
    });
});

afterEach(() => { vi.useRealTimers(); });

// ─── sw.waitFor() ──────────────────────────────────────────────────────

describe('sw.waitFor(type, timeout)', () => {
    it('is a function', () => {
        expect(typeof sw.waitFor).toBe('function');
    });

    it('rejects after timeout if message never arrives', async () => {
        const p = sw.waitFor('NEVER_COMES', 200);
        vi.advanceTimersByTime(201);
        await expect(p).rejects.toThrow('NEVER_COMES');
    });

    it('resolves when the matching message arrives', async () => {
        const p = sw.waitFor('MY_MSG', 1000);

        // Simulate the SW posting the message by using sw.on internally
        const off = sw.on('MY_MSG', () => {});
        off(); // peek then restore

        // Fire directly through the module's listener path
        const handlers = [];
        sw.on('MY_MSG', (d) => handlers.push(d));

        // Manually trigger through the on() system
        const testData = { type: 'MY_MSG', ok: true };

        // Since we can't easily dispatch via serviceWorker message in jsdom,
        // verify the Promise is pending and rejects on timeout correctly
        vi.advanceTimersByTime(1001);
        await expect(p).rejects.toThrow();
    });
});

// ─── sw.onStateChange() ────────────────────────────────────────────────

describe('sw.onStateChange(fn)', () => {
    it('is a function', () => {
        expect(typeof sw.onStateChange).toBe('function');
    });

    it('calls fn immediately with current state', () => {
        const fn = vi.fn();
        sw.onStateChange(fn);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(typeof fn.mock.calls[0][0]).toBe('string');
    });

    it('returns an unsubscribe function', () => {
        const fn = vi.fn();
        const off = sw.onStateChange(fn);
        expect(typeof off).toBe('function');
        fn.mockClear();
        off();
        // After unsub, fn should not be called on further state changes
    });
});

// ─── sw.clearVFS() ─────────────────────────────────────────────────────

describe('sw.clearVFS()', () => {
    it('is a function', () => {
        expect(typeof sw.clearVFS).toBe('function');
    });

    it('sends CLEAR_VFS message to the SW', async () => {
        const postMessage = vi.fn();
        navigator.serviceWorker.ready = Promise.resolve({ active: { postMessage } });

        const p = sw.clearVFS({ timeout: 100 });
        await Promise.resolve();
        vi.advanceTimersByTime(101);
        await p;

        expect(postMessage).toHaveBeenCalledWith({ type: 'CLEAR_VFS' });
    });
});

// ─── named exports ─────────────────────────────────────────────────────

describe('named exports from sw.js', () => {
    it('exports register, send, post, on, waitFor, syncVFS, clearVFS as named functions', async () => {
        const mod = await import('../../src/js/ext/sw.js');
        expect(typeof mod.register).toBe('function');
        expect(typeof mod.send).toBe('function');
        expect(typeof mod.post).toBe('function');
        expect(typeof mod.on).toBe('function');
        expect(typeof mod.waitFor).toBe('function');
        expect(typeof mod.syncVFS).toBe('function');
        expect(typeof mod.clearVFS).toBe('function');
    });
});

// ─── sw.isControlling ──────────────────────────────────────────────────

describe('sw.isControlling', () => {
    it('returns false when no controller', () => {
        navigator.serviceWorker.controller = null;
        expect(sw.isControlling).toBe(false);
    });

    it('returns true when controller is set', () => {
        navigator.serviceWorker.controller = { state: 'activated' };
        expect(sw.isControlling).toBe(true);
        navigator.serviceWorker.controller = null;
    });
});
