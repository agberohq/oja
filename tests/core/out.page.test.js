/**
 * tests/core/out.page.test.js
 *
 * Tests for Out.page() — the router-semantic alias for Out.module().
 *
 * Out.page(html, js?, data?, options?)
 *   - Both argument orders accepted: (html, js) or (js, html)
 *   - html-only  → returns _ComponentOut (type 'component')
 *   - html + js  → returns _ModuleOut    (type 'module', _isPage: true)
 *   - Object form: Out.page({ html, js, data })
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Out } from '../../src/js/core/out.js';

function makeContainer() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}
function cleanup(el) { if (el?.parentNode) el.remove(); }
function stubFetch(html) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true, status: 200,
        text: () => Promise.resolve(html),
    }));
}

afterEach(() => { Out.clearCache(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

// Factory

describe('Out.page — factory', () => {

    it('html-only falls back to component type', () => {
        expect(Out.page('about.html').type).toBe('component');
    });

    it('html + js returns module type', () => {
        expect(Out.page('dashboard.html', 'dashboard.js').type).toBe('module');
    });

    it('order-independent — js before html', () => {
        const p = Out.page('dashboard.js', 'dashboard.html');
        expect(p.type).toBe('module');
        // _html stores the html url; _payload is the import factory fn
        expect(p._html).toBe('dashboard.html');
        expect(typeof p._payload).toBe('function');
    });

    it('passes data through', () => {
        expect(Out.page('p.html', 'p.js', { user: 'x' })._data).toEqual({ user: 'x' });
    });

    it('sets _isPage option flag', () => {
        expect(Out.page('p.html', 'p.js')._options._isPage).toBe(true);
    });

    it('Out.is() recognises Out.page result', () => {
        expect(Out.is(Out.page('p.html', 'p.js'))).toBe(true);
        expect(Out.is(Out.page('about.html'))).toBe(true);
    });

    it('object form { html, js, data }', () => {
        const p = Out.page({ html: 'dash.html', js: 'dash.js', data: { x: 1 } });
        expect(p.type).toBe('module');
        expect(p._html).toBe('dash.html');
        expect(p._data).toEqual({ x: 1 });
    });

    it('has a prefetch() method', () => {
        expect(typeof Out.page('p.html', 'p.js').prefetch).toBe('function');
    });
});

// Router compatibility

describe('Out.page — router compatibility', () => {
    let el;
    beforeEach(() => { el = makeContainer(); });
    afterEach(() => { cleanup(el); Out.clearCache(); vi.restoreAllMocks(); });

    it('html-only page renders template into container', async () => {
        stubFetch('<h1>About</h1>');
        await Out.page('about.html').render(el);
        expect(el.textContent).toContain('About');
    });

    it('html + js page renders HTML then calls module fn with scope', async () => {
        stubFetch('<p>{{title}}</p>');
        const ctx = { title: 'Dashboard' };
        // js module that just checks it received a scope with find()
        let receivedFind;
        const fakeMod = { default: async (scope) => { receivedFind = scope.find; } };
        // Patch import() by passing an inline module-object factory
        const responder = new (Out.page('d.html', 'd.js').constructor)(
            () => Promise.resolve(fakeMod),
            'd.html',
            {},
            { _isPage: true }
        );
        await responder.render(el, ctx);
        expect(typeof receivedFind).toBe('function');
    });
});
