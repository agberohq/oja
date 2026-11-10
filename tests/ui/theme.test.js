import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { theme } from '../../src/js/ui/theme.js';

function mockSystem(dark) {
    if (typeof window.matchMedia !== 'function') {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    }
    const listeners = new Set();
    const mql = {
        matches: dark,
        addEventListener: (_, fn) => listeners.add(fn),
        removeEventListener: (_, fn) => listeners.delete(fn),
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
        _emit(next) { this.matches = next; listeners.forEach(fn => fn({ matches: next })); },
    };
    vi.spyOn(window, 'matchMedia').mockReturnValue(mql);
    return mql;
}

beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
    theme.destroy();
    theme.configure({ storageKey: 'test-theme', attr: 'data-theme' });
});

afterEach(() => {
    theme.destroy();
    vi.restoreAllMocks();
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
});

describe('theme', () => {
    it('applies and persists an explicit theme', () => {
        expect(theme.apply('dark')).toBe('dark');
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
        expect(localStorage.getItem('test-theme')).toBe('dark');
        expect(theme.current()).toBe('dark');
        expect(theme.mode()).toBe('dark');
    });

    it('resolves system to light/dark and follows changes', () => {
        const mql = mockSystem(true);
        theme.apply('system');
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
        expect(theme.mode()).toBe('system');

        mql._emit(false);
        expect(document.documentElement.getAttribute('data-theme')).toBe('light');

        mql._emit(true);
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('toggle switches the resolved theme and stores it explicitly', () => {
        mockSystem(true);
        theme.apply('system');
        expect(theme.toggle()).toBe('light');
        expect(theme.mode()).toBe('light');
        expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('notifies watchers and supports unsubscribe', () => {
        const fn = vi.fn();
        const off = theme.watch(fn);
        theme.apply('dark');
        expect(fn).toHaveBeenCalledWith('dark', 'dark');
        off();
        theme.apply('light');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('is safe when matchMedia and storage are unavailable', () => {
        vi.spyOn(window, 'matchMedia').mockImplementation(() => { throw new Error('no matchMedia'); });
        expect(() => theme.apply('system')).not.toThrow();
        expect(['light', 'dark']).toContain(document.documentElement.getAttribute('data-theme'));
    });

    it('ignores invalid modes and falls back to system', () => {
        mockSystem(false);
        expect(theme.apply('neon')).toBe('light');
        expect(theme.mode()).toBe('system');
    });
});
