/**
 * tests/core/ui.test.js
 * Covers: ui() fluent API, ui.btn static API, track(), UiElement states
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ui, find, query, make } from '../../src/js/core/ui.js';

function makeBtn(text = 'Save') {
    const btn = document.createElement('button');
    btn.textContent = text;
    document.body.appendChild(btn);
    return btn;
}

function makeLink(text = 'Go') {
    const a = document.createElement('a');
    a.textContent = text;
    document.body.appendChild(a);
    return a;
}

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('ui() — element targeting', () => {
    it('accepts an element directly', () => {
        const btn = makeBtn();
        expect(ui(btn)).toBeDefined();
    });

    it('accepts a CSS selector string', () => {
        const btn = makeBtn();
        btn.id = 'test-btn';
        expect(ui('#test-btn')).toBeDefined();
    });

    it('returns a no-op stub when element not found', () => {
        const stub = ui('#does-not-exist');
        expect(() => stub.loading('msg')).not.toThrow();
        expect(() => stub.done('msg')).not.toThrow();
        expect(() => stub.error('msg')).not.toThrow();
        expect(() => stub.reset()).not.toThrow();
    });
});

describe('ui().loading()', () => {
    it('disables the element', () => {
        const btn = makeBtn();
        ui(btn).loading('Working…');
        expect(btn.hasAttribute('disabled')).toBe(true);
    });

    it('adds .oja-loading class', () => {
        const btn = makeBtn();
        ui(btn).loading();
        expect(btn.classList.contains('oja-loading')).toBe(true);
    });

    it('sets aria-busy', () => {
        const btn = makeBtn();
        ui(btn).loading();
        expect(btn.getAttribute('aria-busy')).toBe('true');
    });

    it('shows the message text', () => {
        const btn = makeBtn();
        ui(btn).loading('Saving…');
        expect(btn.textContent).toContain('Saving…');
    });

    it('uses data-loading attribute as fallback label', () => {
        const btn = makeBtn();
        btn.dataset.loading = 'Please wait';
        ui(btn).loading();
        expect(btn.textContent).toContain('Please wait');
    });

    it('preserves original content for later reset', () => {
        const btn = makeBtn('Submit');
        ui(btn).loading('Working');
        ui(btn).reset();
        expect(btn.textContent).toBe('Submit');
    });
});

describe('ui().done()', () => {
    it('removes disabled and loading class', () => {
        const btn = makeBtn();
        ui(btn).loading('…');
        ui(btn).done('✓ Done');
        expect(btn.hasAttribute('disabled')).toBe(false);
        expect(btn.classList.contains('oja-loading')).toBe(false);
    });

    it('adds .oja-done class', () => {
        const btn = makeBtn();
        ui(btn).done('Done');
        expect(btn.classList.contains('oja-done')).toBe(true);
    });

    it('shows the success message', () => {
        const btn = makeBtn();
        ui(btn).done('Saved ✓');
        expect(btn.textContent).toBe('Saved ✓');
    });

    it('auto-resets after 2s', () => {
        vi.useFakeTimers();
        const btn = makeBtn('Save');
        ui(btn).done('Saved');
        expect(btn.classList.contains('oja-done')).toBe(true);
        vi.advanceTimersByTime(2000);
        expect(btn.classList.contains('oja-done')).toBe(false);
        expect(btn.textContent).toBe('Save');
        vi.useRealTimers();
    });
});

describe('ui().error()', () => {
    it('adds .oja-error class and removes loading', () => {
        const btn = makeBtn();
        ui(btn).loading('…');
        ui(btn).error('Failed');
        expect(btn.classList.contains('oja-error')).toBe(true);
        expect(btn.classList.contains('oja-loading')).toBe(false);
    });

    it('is not disabled after error', () => {
        const btn = makeBtn();
        ui(btn).loading();
        ui(btn).error('Try again');
        expect(btn.hasAttribute('disabled')).toBe(false);
    });

    it('auto-resets after 3s', () => {
        vi.useFakeTimers();
        const btn = makeBtn('Save');
        ui(btn).error('Failed');
        vi.advanceTimersByTime(3000);
        expect(btn.classList.contains('oja-error')).toBe(false);
        expect(btn.textContent).toBe('Save');
        vi.useRealTimers();
    });
});

describe('ui().reset()', () => {
    it('restores original content', () => {
        const btn = makeBtn('Original');
        ui(btn).loading('Working');
        ui(btn).reset();
        expect(btn.textContent).toBe('Original');
    });

    it('removes all state classes', () => {
        const btn = makeBtn();
        ui(btn).loading();
        ui(btn).reset();
        expect(btn.classList.contains('oja-loading')).toBe(false);
        expect(btn.classList.contains('oja-done')).toBe(false);
        expect(btn.classList.contains('oja-error')).toBe(false);
    });

    it('removes disabled attribute', () => {
        const btn = makeBtn();
        ui(btn).loading();
        ui(btn).reset();
        expect(btn.hasAttribute('disabled')).toBe(false);
    });
});

describe('ui().isLoading', () => {
    it('returns true during loading', () => {
        const btn = makeBtn();
        ui(btn).loading();
        expect(ui(btn).isLoading).toBe(true);
    });

    it('returns false after reset', () => {
        const btn = makeBtn();
        ui(btn).loading();
        ui(btn).reset();
        expect(ui(btn).isLoading).toBe(false);
    });
});

describe('ui().track()', () => {
    it('shows loading state while promise is pending', () => {
        const btn = makeBtn();
        let resolve;
        const p = new Promise(r => { resolve = r; });
        ui(btn).track(p, { loading: 'Saving…' });
        expect(btn.classList.contains('oja-loading')).toBe(true);
        expect(btn.textContent).toContain('Saving…');
        resolve();
    });

    it('transitions to done on resolve', async () => {
        const btn = makeBtn('Save');
        await ui(btn).track(Promise.resolve(), { success: 'Saved ✓', resetAfter: 0 });
        expect(btn.classList.contains('oja-done')).toBe(true);
        expect(btn.textContent).toBe('Saved ✓');
    });

    it('transitions to error on reject', async () => {
        const btn = makeBtn('Save');
        try {
            await ui(btn).track(Promise.reject(new Error('oops')), { error: 'Failed' });
        } catch {}
        expect(btn.classList.contains('oja-error')).toBe(true);
        expect(btn.textContent).toBe('Failed');
    });

    it('error option can be a function receiving the error', async () => {
        const btn = makeBtn('Save');
        try {
            await ui(btn).track(
                Promise.reject(new Error('Network timeout')),
                { error: (e) => `Error: ${e.message}` }
            );
        } catch {}
        expect(btn.textContent).toBe('Error: Network timeout');
    });

    it('returns the original promise', () => {
        const btn = makeBtn();
        const p = Promise.resolve(42);
        expect(ui(btn).track(p)).toBe(p);
    });

    it('auto-resets after resetAfter ms on success', async () => {
        vi.useFakeTimers();
        const btn = makeBtn('Save');
        ui(btn).track(Promise.resolve(), { success: '✓', resetAfter: 1000 });
        await Promise.resolve(); // flush promise
        vi.advanceTimersByTime(1000);
        expect(btn.textContent).toBe('Save');
        vi.useRealTimers();
    });
});

describe('ui.btn — static API', () => {
    it('ui.btn.loading(el, msg) mirrors ui(el).loading(msg)', () => {
        const btn = makeBtn();
        ui.btn.loading(btn, 'Working…');
        expect(btn.classList.contains('oja-loading')).toBe(true);
        expect(btn.textContent).toContain('Working…');
    });

    it('ui.btn.done(el, msg) mirrors ui(el).done(msg)', () => {
        vi.useFakeTimers();
        const btn = makeBtn();
        ui.btn.done(btn, 'Done ✓');
        expect(btn.classList.contains('oja-done')).toBe(true);
        expect(btn.textContent).toBe('Done ✓');
        vi.useRealTimers();
    });

    it('ui.btn.error(el, msg) mirrors ui(el).error(msg)', () => {
        vi.useFakeTimers();
        const btn = makeBtn();
        ui.btn.error(btn, 'Failed');
        expect(btn.classList.contains('oja-error')).toBe(true);
        vi.useRealTimers();
    });

    it('ui.btn.reset(el) mirrors ui(el).reset()', () => {
        const btn = makeBtn('Save');
        ui.btn.loading(btn, '…');
        ui.btn.reset(btn);
        expect(btn.textContent).toBe('Save');
        expect(btn.hasAttribute('disabled')).toBe(false);
    });

    it('ui.btn.track(el, promise, opts) mirrors ui(el).track()', async () => {
        const btn = makeBtn('Save');
        await ui.btn.track(btn, Promise.resolve(), { success: 'Saved', resetAfter: 0 });
        expect(btn.classList.contains('oja-done')).toBe(true);
    });

    it('works on <a> elements', () => {
        const a = makeLink('Go');
        ui.btn.loading(a, 'Loading…');
        expect(a.classList.contains('oja-loading')).toBe(true);
        ui.btn.reset(a);
        expect(a.textContent).toBe('Go');
    });
});

describe('rapid consecutive calls — original content stability', () => {
    it('reset after multiple loading/done cycles restores original', () => {
        vi.useFakeTimers();
        const btn = makeBtn('Submit');
        ui(btn).loading('A');
        ui(btn).done('Done');
        vi.advanceTimersByTime(2000); // auto reset
        ui(btn).loading('B');
        ui(btn).reset();
        expect(btn.textContent).toBe('Submit');
        vi.useRealTimers();
    });
});

describe('find() and query() null behaviour', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    it('find() returns null when element is not found', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(find('#does-not-exist')).toBeNull();
        warnSpy.mockRestore();
    });

    it('query() returns null when element is not found', () => {
        expect(query('#absolutely-does-not-exist')).toBeNull();
    });

    it('find() warns in console with selector when element is not found', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        find('#missing-el');
        expect(warnSpy).toHaveBeenCalled();
        expect(warnSpy.mock.calls[0][0]).toContain('[oja/ui]');
        expect(warnSpy.mock.calls[0][0]).toContain('#missing-el');
        warnSpy.mockRestore();
    });

    it('find() does NOT warn when element is found', () => {
        const div = document.createElement('div');
        div.id = 'real-el';
        document.body.appendChild(div);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        find('#real-el');
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('find() returns the element when it exists', () => {
        const div = document.createElement('div');
        div.id = 'existing';
        document.body.appendChild(div);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const el = find('#existing');
        expect(el).not.toBeNull();
        expect(el.tagName).toBe('DIV');
        warnSpy.mockRestore();
    });

    it('query() does not warn on miss (query is silent by design)', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        query('#not-here');
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});

// make() placement — _resolveTarget guard
// Regression: passing empty string or null/undefined to placement methods
// (appendTo, insertBefore, etc.) must NOT call querySelector('') which throws
// DOMException in browsers and logs spurious "[oja/make] insertBefore: target
// not found: " warnings.

describe('make() placement — _resolveTarget guard', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    it('appendTo("") does not throw and logs no warn', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(() => make.div().appendTo('')).not.toThrow();
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('insertBefore("") does not throw and logs no warn', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(() => make.div().insertBefore('')).not.toThrow();
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('appendTo(null) does not throw', () => {
        expect(() => make.div().appendTo(null)).not.toThrow();
    });

    it('appendTo(undefined) does not throw', () => {
        expect(() => make.div().appendTo(undefined)).not.toThrow();
    });

    it('appendTo(validSelector) works correctly', () => {
        const host = document.createElement('div');
        host.id = 'host';
        document.body.appendChild(host);
        make.span({}, 'hello').appendTo('#host');
        expect(host.querySelector('span')?.textContent).toBe('hello');
    });

    it('insertBefore(validSelector) works correctly', () => {
        const host = document.createElement('div');
        const ref  = document.createElement('p');
        ref.id = 'ref';
        host.appendChild(ref);
        document.body.appendChild(host);
        make.span({}, 'before').insertBefore('#ref');
        expect(host.firstChild?.tagName).toBe('SPAN');
    });
});
