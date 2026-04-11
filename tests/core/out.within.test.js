/**
 * tests/core/out.within.test.js
 *
 * Tests for:
 *   - Out.within(container).to(selector)  — scoped rendering
 *   - Out.to(target).composite(...)       — fluent composite on OutTarget
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Out } from '../../src/js/core/out.js';

// helpers

function make(html) {
    const el = document.createElement('div');
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
}

function cleanup(el) {
    el?.parentNode?.removeChild(el);
    document.querySelectorAll('style[data-oja-composite-style]').forEach(s => s.remove());
}

async function flush() {
    for (let i = 0; i < 4; i++) await Promise.resolve();
}

function cleanScopeKeys() {
    for (const k of Object.keys(window)) {
        if (k.startsWith('__oja_scope_')) delete window[k];
    }
}

// Out.within()

describe('Out.within()', () => {
    let root;
    afterEach(() => { cleanup(root); Out.clearCache(); vi.restoreAllMocks(); });

    it('returns an object with a to() method', () => {
        root = make('<div id="inner"></div>');
        const scope = Out.within(root);
        expect(typeof scope.to).toBe('function');
    });

    it('to() resolves selector within the scope element only', () => {
        root = make('<div id="panel"><span id="target"></span></div>');
        // Duplicate id at page level to verify scoping
        const sibling = make('<span id="target"></span>');

        const target = Out.within(root).to('#target').el();
        expect(target).toBe(root.querySelector('#target'));
        expect(target).not.toBe(sibling);

        cleanup(sibling);
    });

    it('to() returns an OutTarget that can render html', async () => {
        root = make('<div id="slot"></div>');
        const slot = root.querySelector('#slot');

        await Out.within(root).to('#slot').html('<p>scoped</p>').render();

        expect(slot.textContent).toContain('scoped');
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
        const scope = Out.within('not-an-element');
        const target = scope.to('#whatever');
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Out.within()'));
        // el() on a null target returns null without throwing
        expect(target.el()).toBeNull();
        warnSpy.mockRestore();
    });

    it('warns when selector not found inside scope', () => {
        root = make('<div></div>');
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        Out.within(root).to('#nonexistent');
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
        warnSpy.mockRestore();
    });

    it('to() accepts an Element directly (no selector lookup)', () => {
        root = make('<div><span class="x"></span></div>');
        const span = root.querySelector('.x');
        const target = Out.within(root).to(span);
        expect(target.el()).toBe(span);
    });

    it('isolates from global document.querySelector', async () => {
        // Two containers each with a differently-keyed slot — Out.within() must
        // scope its querySelector so rendering into container A cannot bleed into B.
        const a = make('<div id="comp-a"><div class="slot" data-owner="a"></div></div>');
        const b = make('<div id="comp-b"><div class="slot" data-owner="b"></div></div>');

        const slotA = a.querySelector('.slot[data-owner="a"]');
        const slotB = b.querySelector('.slot[data-owner="b"]');

        await Out.within(a).to('.slot').html('<p>A</p>').render();
        await Out.within(b).to('.slot').html('<p>B</p>').render();

        expect(slotA.textContent).toBe('A');
        expect(slotB.textContent).toBe('B');

        cleanup(a);
        cleanup(b);
    });
});

// Out.to().composite()

describe('Out.to().composite()', () => {
    let el;
    beforeEach(() => {
        el = document.createElement('div');
        document.body.appendChild(el);
        cleanScopeKeys();
    });
    afterEach(() => {
        cleanup(el);
        Out.clearCache();
        cleanScopeKeys();
        vi.restoreAllMocks();
    });

    it('is a function on OutTarget', () => {
        expect(typeof Out.to(el).composite).toBe('function');
    });

    it('returns the OutTarget for chaining', () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, text: () => Promise.resolve('<div></div>'),
        }));
        const target = Out.to(el);
        const returned = target.composite('t.html', 't.js');
        expect(returned).toBe(target);
    });

    it('renders HTML from fetch into the target element', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, text: () => Promise.resolve('<p class="done">OK</p>'),
        }));

        const pending = Out.to(el).composite('t.html', 't.js');
        await flush();
        const key = Object.keys(window).find(k => k.startsWith('__oja_scope_'));
        if (key) window[key].ready();
        await pending.render();

        expect(el.querySelector('.done')).toBeTruthy();
    });

    it('accepts object form Out.to().composite({ html, js })', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, text: () => Promise.resolve('<span id="x">hi</span>'),
        }));

        const pending = Out.to(el).composite({ html: 't.html', js: 't.js' });
        await flush();
        const key = Object.keys(window).find(k => k.startsWith('__oja_scope_'));
        if (key) window[key].ready();
        await pending.render();

        expect(el.querySelector('#x').textContent).toBe('hi');
    });

    it('throws on duplicate file types just like Out.composite()', () => {
        expect(() => Out.to(el).composite('a.html', 'b.html', 'p.js'))
            .toThrow('two HTML files');
    });

    it('respects .when() condition — skips render when false', () => {
        vi.stubGlobal('fetch', vi.fn());
        Out.to(el).when(() => false).composite('t.html', 't.js');
        expect(fetch).not.toHaveBeenCalled();
    });
});

// Out.within() + Out.to().composite() combined

describe('Out.within() + composite()', () => {
    let root;
    beforeEach(() => { root = make('<div id="slot"></div>'); cleanScopeKeys(); });
    afterEach(() => { cleanup(root); Out.clearCache(); cleanScopeKeys(); vi.restoreAllMocks(); });

    it('can chain within().to().composite()', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, text: () => Promise.resolve('<p id="r">rendered</p>'),
        }));

        const pending = Out.within(root).to('#slot').composite('t.html', 't.js');
        await flush();
        const key = Object.keys(window).find(k => k.startsWith('__oja_scope_'));
        if (key) window[key].ready();
        await pending.render();

        expect(root.querySelector('#slot #r').textContent).toBe('rendered');
    });
});
