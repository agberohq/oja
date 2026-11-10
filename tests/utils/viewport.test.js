import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { preventFocusZoom } from '../../src/js/utils/viewport.js';

function setMeta(content) {
    document.head.innerHTML = content == null ? '' : `<meta name="viewport" content="${content}">`;
}

function setIOS(isIOS) {
    // CSS.supports is the first check; the UA fallback is covered by force tests.
    vi.stubGlobal('CSS', { supports: () => isIOS });
    Object.defineProperty(navigator, 'userAgent', {
        value: isIOS ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' : 'Mozilla/5.0 (Macintosh)',
        configurable: true,
    });
    Object.defineProperty(navigator, 'platform', { value: isIOS ? 'iPhone' : 'MacIntel', configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: isIOS ? 5 : 0, configurable: true });
}

beforeEach(() => {
    document.head.innerHTML = '';
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.head.innerHTML = '';
});

describe('preventFocusZoom()', () => {
    it('does nothing outside iOS', () => {
        setIOS(false);
        setMeta('width=device-width, initial-scale=1');
        expect(preventFocusZoom()).toBe(false);
        expect(document.querySelector('meta[name="viewport"]').content).toBe('width=device-width, initial-scale=1');
    });

    it('adds maximum-scale=1 on iOS', () => {
        setIOS(true);
        setMeta('width=device-width, initial-scale=1');
        expect(preventFocusZoom()).toBe(true);
        const content = document.querySelector('meta[name="viewport"]').content;
        expect(content).toContain('maximum-scale=1');
        expect(content).toContain('width=device-width');
    });

    it('creates the viewport meta if it is missing', () => {
        setIOS(true);
        expect(preventFocusZoom()).toBe(true);
        const meta = document.querySelector('meta[name="viewport"]');
        expect(meta).toBeTruthy();
        expect(meta.content).toContain('maximum-scale=1');
    });

    it('replaces an existing maximum-scale instead of duplicating it', () => {
        setIOS(true);
        setMeta('width=device-width, initial-scale=1, maximum-scale=5');
        preventFocusZoom();
        const content = document.querySelector('meta[name="viewport"]').content;
        expect(content.match(/maximum-scale/g)).toHaveLength(1);
        expect(content).toContain('maximum-scale=1');
        expect(content).not.toContain('maximum-scale=5');
    });

    it('is idempotent', () => {
        setIOS(true);
        setMeta('width=device-width');
        preventFocusZoom();
        const first = document.querySelector('meta[name="viewport"]').content;
        preventFocusZoom();
        expect(document.querySelector('meta[name="viewport"]').content).toBe(first);
    });

    it('supports force for embedded webviews/tests', () => {
        setIOS(false);
        expect(preventFocusZoom({ force: true })).toBe(true);
        expect(document.querySelector('meta[name="viewport"]').content).toContain('maximum-scale=1');
    });
});
