/**
 * tests/core/out.within.test.js
 *
 * Tests for:
 *   - Out.within(container).to(selector)  — scoped rendering
 *   - Out.to(target).module(...)          — fluent module on OutTarget
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Out } from '../../src/js/core/out.js';

function make(html) {
    const el = document.createElement('div');
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
}
function cleanup(el) { el?.parentNode?.removeChild(el); }
async function flush() { for (let i = 0; i < 4; i++) await Promise.resolve(); }

// Out.within()

describe('Out.within()', () => {
    let root;
    afterEach(() => { cleanup(root); Out.clearCache(); vi.restoreAllMocks(); });

    it('returns an object with a to() method', () => {
        root = make('<div></div>');
        expect(typeof Out.within(root).to).toBe('function');
    });

    it('to() resolves selector within the scope element only', () => {
        root = make('<div><span id="target"></span></div>');
        const sibling = make('<span id="target"></span>');
        const target = Out.within(root).to('#target').el();
        expect(target).toBe(root.querySelector('#target'));
        expect(target).not.toBe(sibling);
        cleanup(sibling);
    });

    it('to() returns an OutTarget that can render html', async () => {
        root = make('<div id="slot"></div>');
        await Out.within(root).to('#slot').html('<p>scoped</p>').render();
        expect(root.querySelector('#slot').textContent).toContain('scoped');
    });

    it('to() returns an OutTarget that can render component', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, text: () => Promise.resolve('<p>loaded</p>'),
        }));
        root = make('<div id="slot"></div>');
        Out.within(root).to('#slot').component('page.html');
        await flush();
        expect(root.querySelector('#slot').textContent).toContain('loaded');
    });

    it('warns and returns no-op when called with non-Element', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const target = Out.within('not-an-element').to('#whatever');
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Out.within()'));
        expect(target.el()).toBeNull();
    });

    it('warns when selector not found inside scope', () => {
        root = make('<div></div>');
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        Out.within(root).to('#nonexistent');
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('to() accepts an Element directly', () => {
        root = make('<div><span class="x"></span></div>');
        const span = root.querySelector('.x');
        expect(Out.within(root).to(span).el()).toBe(span);
    });

    it('isolates from global document.querySelector', async () => {
        const a = make('<div><div class="slot" data-owner="a"></div></div>');
        const b = make('<div><div class="slot" data-owner="b"></div></div>');
        await Out.within(a).to('.slot').html('<p>A</p>').render();
        await Out.within(b).to('.slot').html('<p>B</p>').render();
        expect(a.querySelector('.slot').textContent).toBe('A');
        expect(b.querySelector('.slot').textContent).toBe('B');
        cleanup(a); cleanup(b);
    });
});

// Out.to().module() — fluent

describe('Out.to().module()', () => {
    let el;
    beforeEach(() => { el = document.createElement('div'); document.body.appendChild(el); });
    afterEach(() => { cleanup(el); Out.clearCache(); vi.restoreAllMocks(); });

    it('is a function on OutTarget', () => {
        expect(typeof Out.to(el).module).toBe('function');
    });

    it('returns the OutTarget for chaining', () => {
        const target = Out.to(el);
        expect(target.module(async (_scope) => {})).toBe(target);
    });

    it('renders HTML into the target element', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, text: () => Promise.resolve('<p class="done">OK</p>'),
        }));
        await Out.to(el).module(async (_scope) => {}, 't.html').render();
        expect(el.querySelector('.done')).toBeTruthy();
    });

    it('passes scope to the function', async () => {
        let received;
        await Out.to(el).module(async (scope) => { received = scope; }).render();
        expect(received.container).toBe(el);
        expect(typeof received.find).toBe('function');
        expect(typeof received.ready).toBe('function');
    });

    it('respects .when() condition — skips render when false', () => {
        vi.stubGlobal('fetch', vi.fn());
        Out.to(el).when(() => false).module(async (_scope) => {}, 't.html');
        expect(fetch).not.toHaveBeenCalled();
    });
});

// Out.within() + Out.to().module() combined

describe('Out.within() + module()', () => {
    let root;
    beforeEach(() => { root = make('<div id="slot"></div>'); });
    afterEach(() => { cleanup(root); Out.clearCache(); vi.restoreAllMocks(); });

    it('can chain within().to().module()', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, text: () => Promise.resolve('<p id="r">rendered</p>'),
        }));
        await Out.within(root).to('#slot').module(async (_scope) => {}, 't.html').render();
        expect(root.querySelector('#slot #r').textContent).toBe('rendered');
    });

    it('scope.find() is scoped to the slot', async () => {
        root.innerHTML = '<div id="slot"><span id="x"></span></div>';
        let foundEl;
        await Out.within(root).to('#slot').module(async (scope) => {
            foundEl = scope.find('#x');
        }).render();
        expect(foundEl).toBe(root.querySelector('#x'));
    });
});
