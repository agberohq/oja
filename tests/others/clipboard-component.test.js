/**
 * Tests for clipboard.copyComponent() / pasteComponent() / hasComponent() / clearComponent()
 * Written against the actual implementation in src/js/ui/clipboard.js
 *
 * Key API facts from the source:
 *   - copyComponent(target, { data, component }) — target must exist in DOM
 *   - pasteComponent({ onPaste }) — onPaste receives { html, data, component, copiedAt }
 *   - state stored on this._componentClipboard (not module-level)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clipboard } from '../../src/js/ui/clipboard.js';

function makeEl(content = 'test') {
    const el = document.createElement('div');
    el.id = 'test-el';
    el.textContent = content;
    document.body.appendChild(el);
    return el;
}

beforeEach(() => {
    document.body.innerHTML = '';
    clipboard.clearComponent();
});
afterEach(() => {
    document.body.innerHTML = '';
    clipboard.clearComponent();
});

// ─── hasComponent ─────────────────────────────────────────────────────────────

describe('clipboard.hasComponent()', () => {
    it('returns false initially', () => {
        expect(clipboard.hasComponent()).toBe(false);
    });

    it('returns true after a successful copyComponent()', () => {
        const el = makeEl();
        clipboard.copyComponent(el, {});
        expect(clipboard.hasComponent()).toBe(true);
    });

    it('returns false after clearComponent()', () => {
        const el = makeEl();
        clipboard.copyComponent(el, {});
        clipboard.clearComponent();
        expect(clipboard.hasComponent()).toBe(false);
    });
});

// ─── copyComponent ────────────────────────────────────────────────────────────

describe('clipboard.copyComponent()', () => {
    it('returns true when element is found', () => {
        const el = makeEl();
        expect(clipboard.copyComponent(el, {})).toBe(true);
    });

    it('returns false and warns when element not found via selector', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = clipboard.copyComponent('#nonexistent', {});
        expect(result).toBe(false);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('returns false and warns when null passed as target', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = clipboard.copyComponent(null, {});
        expect(result).toBe(false);
        warn.mockRestore();
    });

    it('snapshots outerHTML at copy time', () => {
        const el = makeEl('original content');
        clipboard.copyComponent(el, {});

        el.textContent = 'mutated after copy';

        const received = [];
        clipboard.pasteComponent({ onPaste: (snap) => received.push(snap.html) });
        expect(received[0]).toContain('original content');
    });

    it('calls data() at copy time and stores the result', () => {
        const el = makeEl();
        let n = 0;
        clipboard.copyComponent(el, { data: () => ({ count: ++n }) });
        n = 99; // mutate after copy

        const received = [];
        clipboard.pasteComponent({ onPaste: (snap) => received.push(snap.data) });
        expect(received[0].count).toBe(1);
    });

    it('stores the component URL', () => {
        const el = makeEl();
        clipboard.copyComponent(el, { component: 'components/card.html' });

        const received = [];
        clipboard.pasteComponent({ onPaste: (snap) => received.push(snap.component) });
        expect(received[0]).toBe('components/card.html');
    });

    it('component is null when not provided', () => {
        const el = makeEl();
        clipboard.copyComponent(el, {});

        const received = [];
        clipboard.pasteComponent({ onPaste: (snap) => received.push(snap.component) });
        expect(received[0]).toBeNull();
    });

    it('overwrites previous copy', () => {
        const el = makeEl('first');
        clipboard.copyComponent(el, { data: () => ({ v: 1 }) });

        el.textContent = 'second';
        clipboard.copyComponent(el, { data: () => ({ v: 2 }) });

        const received = [];
        clipboard.pasteComponent({ onPaste: (snap) => received.push(snap.data) });
        expect(received[0].v).toBe(2);
    });

    it('accepts a CSS selector string for existing element', () => {
        makeEl('selector test');
        const result = clipboard.copyComponent('#test-el', {});
        expect(result).toBe(true);
    });
});

// ─── pasteComponent ───────────────────────────────────────────────────────────

describe('clipboard.pasteComponent()', () => {
    it('returns false when clipboard is empty', () => {
        expect(clipboard.pasteComponent({ onPaste: vi.fn() })).toBe(false);
    });

    it('warns when clipboard is empty', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        clipboard.pasteComponent({});
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('returns true when something is on the clipboard', () => {
        clipboard.copyComponent(makeEl(), {});
        expect(clipboard.pasteComponent({ onPaste: () => {} })).toBe(true);
    });

    it('calls onPaste with { html, data, component, copiedAt }', () => {
        const onPaste = vi.fn();
        clipboard.copyComponent(makeEl('hello'), {
            data:      () => ({ x: 42 }),
            component: 'components/box.html',
        });
        clipboard.pasteComponent({ onPaste });

        expect(onPaste).toHaveBeenCalledOnce();
        const arg = onPaste.mock.calls[0][0];
        expect(arg).toHaveProperty('html');
        expect(arg).toHaveProperty('data');
        expect(arg).toHaveProperty('component', 'components/box.html');
        expect(arg).toHaveProperty('copiedAt');
        expect(arg.data.x).toBe(42);
    });

    it('passes a deep clone of data — mutating it does not affect clipboard', () => {
        clipboard.copyComponent(makeEl(), { data: () => ({ x: 10 }) });

        clipboard.pasteComponent({ onPaste: (snap) => { snap.data.x = 999; } });

        const second = [];
        clipboard.pasteComponent({ onPaste: (snap) => second.push(snap.data) });
        expect(second[0].x).toBe(10);
    });

    it('can paste multiple times from one copy', () => {
        const onPaste = vi.fn();
        clipboard.copyComponent(makeEl(), {});
        clipboard.pasteComponent({ onPaste });
        clipboard.pasteComponent({ onPaste });
        clipboard.pasteComponent({ onPaste });
        expect(onPaste).toHaveBeenCalledTimes(3);
    });

    it('does not throw when no onPaste provided', () => {
        clipboard.copyComponent(makeEl(), {});
        expect(() => clipboard.pasteComponent({})).not.toThrow();
    });

    it('data is null in snapshot when no data fn provided', () => {
        clipboard.copyComponent(makeEl(), {});
        const received = [];
        clipboard.pasteComponent({ onPaste: (s) => received.push(s.data) });
        expect(received[0]).toBeNull();
    });
});

// ─── clearComponent ───────────────────────────────────────────────────────────

describe('clipboard.clearComponent()', () => {
    it('does not throw when already empty', () => {
        expect(() => clipboard.clearComponent()).not.toThrow();
    });

    it('prevents paste after clear', () => {
        clipboard.copyComponent(makeEl(), {});
        clipboard.clearComponent();
        expect(clipboard.pasteComponent({ onPaste: vi.fn() })).toBe(false);
    });

    it('hasComponent() returns false after clear', () => {
        clipboard.copyComponent(makeEl(), {});
        clipboard.clearComponent();
        expect(clipboard.hasComponent()).toBe(false);
    });
});
