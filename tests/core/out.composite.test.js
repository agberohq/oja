/**
 * tests/core/out.composite.test.js
 *
 * ── Timing model ─────────────────────────────────────────────────────────────
 * render() is async. Its first await is _fetchHTML(), which awaits fetch() then
 * .text() — two nested promise resolutions. The scope key is set synchronously
 * after that. flush() of 4 ticks is enough: 2 for fetch chain + 2 margin.
 *
 * Pattern used throughout:
 *   const render = Out.composite(...).render(el);
 *   await flushAndReady();   // drain fetch chain, call ready()
 *   await render;
 *
 * ── Scope-key leaks ───────────────────────────────────────────────────────────
 * settle() defers key deletion via setTimeout(0). Timed-out tests leave keys on
 * window that pollute subsequent tests. cleanScopeKeys() in beforeEach/afterEach
 * prevents this.
 *
 * ── Script injection in jsdom ─────────────────────────────────────────────────
 * setup.js only auto-executes blob:shim-* scripts. Real src URLs (/js/p.js) are
 * appended to the DOM but produce no load event. The render promise stays pending
 * until ready() is called or timeout fires.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Out } from '../../src/js/core/out.js';

// helpers

async function flush() {
    for (let i = 0; i < 4; i++) await Promise.resolve();
}

function makeContainer() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

function cleanup(el) {
    el?.parentNode?.removeChild(el);
    document.querySelectorAll('style[data-oja-composite-style]').forEach(s => s.remove());
    document.querySelectorAll('link[rel="preload"][as="script"]').forEach(l => l.remove());
}

function cleanScopeKeys() {
    for (const k of Object.keys(window)) {
        if (k.startsWith('__oja_scope_')) delete window[k];
    }
}

function stubFetch(htmlText, cssText = null) {
    const mock = vi.fn((url) => {
        const isCss = typeof url === 'string' && url.endsWith('.css');
        const body  = (isCss && cssText !== null) ? cssText : htmlText;
        return Promise.resolve({ ok: true, text: () => Promise.resolve(body) });
    });
    vi.stubGlobal('fetch', mock);
    return mock;
}

function scopeKey() {
    return Object.keys(window).find(k => k.startsWith('__oja_scope_')) ?? null;
}

async function flushAndReady() {
    await flush();
    const key = scopeKey();
    if (key) window[key].ready();
    return key;
}

// argument normalisation

describe('Out.composite — argument normalisation', () => {
    afterEach(() => { cleanScopeKeys(); vi.restoreAllMocks(); });

    it('html + js positional', () => {
        const c = Out.composite('page.html', 'page.js');
        expect(c.type).toBe('composite');
        expect(c._payload).toBe('page.html');
        expect(c._jsUrl).toBe('page.js');
        expect(c._cssUrl).toBeNull();
    });

    it('js + html reversed — order does not matter', () => {
        const c = Out.composite('page.js', 'page.html');
        expect(c._payload).toBe('page.html');
        expect(c._jsUrl).toBe('page.js');
    });

    it('html + js + css three args', () => {
        const c = Out.composite('page.html', 'page.js', 'page.css');
        expect(c._cssUrl).toBe('page.css');
    });

    it('js + css + html any order', () => {
        const c = Out.composite('page.js', 'page.css', 'page.html');
        expect(c._payload).toBe('page.html');
        expect(c._jsUrl).toBe('page.js');
        expect(c._cssUrl).toBe('page.css');
    });

    it('data object after files', () => {
        const c = Out.composite('page.html', 'page.js', { user: 'bob' });
        expect(c._data).toEqual({ user: 'bob' });
    });

    it('data + options objects', () => {
        const c = Out.composite('page.html', 'page.js', { user: 'bob' }, { timeout: 100 });
        expect(c._data).toEqual({ user: 'bob' });
        expect(c._options.timeout).toBe(100);
    });

    it('object form { html, js, css, data }', () => {
        const c = Out.composite({ html: 'p.html', js: 'p.js', css: 'p.css', data: { x: 1 } });
        expect(c._payload).toBe('p.html');
        expect(c._jsUrl).toBe('p.js');
        expect(c._cssUrl).toBe('p.css');
        expect(c._data).toEqual({ x: 1 });
    });

    it('throws when neither html nor js provided', () => {
        expect(() => Out.composite('styles.css')).toThrow('[oja/out] Out.composite()');
    });

    it('throws on two HTML files', () => {
        expect(() => Out.composite('a.html', 'b.html', 'page.js'))
            .toThrow('[oja/out] Out.composite() received two HTML files');
    });

    it('throws on two JS files', () => {
        expect(() => Out.composite('page.html', 'a.js', 'b.js'))
            .toThrow('[oja/out] Out.composite() received two JS files');
    });

    it('throws on two CSS files', () => {
        expect(() => Out.composite('page.html', 'page.js', 'a.css', 'b.css'))
            .toThrow('[oja/out] Out.composite() received two CSS files');
    });

    it('Out.cmp is an alias for Out.composite', () => {
        expect(Out.cmp).toBe(Out.composite);
    });
});

// Out.page factory

describe('Out.page — factory', () => {
    afterEach(() => { cleanScopeKeys(); vi.restoreAllMocks(); });

    it('html-only falls back to component type', () => {
        expect(Out.page('about.html').type).toBe('component');
    });

    it('html + js returns composite type', () => {
        expect(Out.page('dashboard.html', 'dashboard.js').type).toBe('composite');
    });

    it('order-independent like Out.composite', () => {
        const p = Out.page('dashboard.js', 'dashboard.html');
        expect(p._payload).toBe('dashboard.html');
        expect(p._jsUrl).toBe('dashboard.js');
    });

    it('passes data through', () => {
        expect(Out.page('p.html', 'p.js', { user: 'x' })._data).toEqual({ user: 'x' });
    });

    it('Out.is() recognises Out.page result', () => {
        expect(Out.is(Out.page('p.html', 'p.js'))).toBe(true);
    });

    it('throws on duplicate JS files', () => {
        expect(() => Out.page('p.html', 'a.js', 'b.js'))
            .toThrow('[oja/out] Out.composite() received two JS files');
    });
});

// HTML rendering

describe('Out.composite — HTML rendering', () => {
    let el;
    beforeEach(() => { el = makeContainer(); cleanScopeKeys(); });
    afterEach(() => { cleanup(el); Out.clearCache(); cleanScopeKeys(); vi.restoreAllMocks(); });

    it('fetches and renders HTML into container', async () => {
        stubFetch('<div class="hello">World</div>');
        const render = Out.composite('t.html', 't.js').render(el);
        await flushAndReady();
        await render;
        expect(el.querySelector('.hello')).toBeTruthy();
        expect(el.textContent).toContain('World');
    });

    it('applies mustache template interpolation from data', async () => {
        stubFetch('<p>Hello {{name}}</p>');
        const render = Out.composite('t.html', 't.js', { name: 'Oja' }).render(el);
        await flushAndReady();
        await render;
        expect(el.textContent).toContain('Hello Oja');
    });

    it('merges context into props — data wins over context on conflict', async () => {
        stubFetch('<p>{{msg}}</p>');
        const render = Out.composite('t.html', 't.js', { msg: 'from-data' })
            .render(el, { msg: 'from-context' });
        await flushAndReady();
        await render;
        expect(el.textContent).toContain('from-data');
    });

    it('sets data-oja-composite attribute on container', async () => {
        stubFetch('<div></div>');
        const render = Out.composite('t.html', 't.js').render(el);
        await flushAndReady();
        await render;
        expect(el.getAttribute('data-oja-composite')).toMatch(/^oja-cmp-/);
    });

    it('works with html-only (no js) — resolves immediately', async () => {
        stubFetch('<p>static</p>');
        await Out.composite('t.html').render(el);
        expect(el.textContent).toContain('static');
    });
});

// Script injection

describe('Out.composite — script injection', () => {
    let el;
    beforeEach(() => { el = makeContainer(); cleanScopeKeys(); });
    afterEach(() => { cleanup(el); Out.clearCache(); cleanScopeKeys(); vi.restoreAllMocks(); });

    it('injects <script src> with NO type="module"', async () => {
        stubFetch('<div></div>');
        const render = Out.composite('t.html', '/js/page.js').render(el);
        await flush(); // let fetch settle so script is appended, before calling ready

        const script = el.querySelector('script');
        expect(script).toBeTruthy();
        expect(script.src).toContain('/js/page.js');
        expect(script.type).not.toBe('module');
        expect(script.getAttribute('type')).toBeNull();

        window[scopeKey()]?.ready();
        await render;
    });

    it('sets data-oja-scope attribute on the script tag', async () => {
        stubFetch('<div></div>');
        const render = Out.composite('t.html', '/js/page.js').render(el);
        await flush();

        const script = el.querySelector('script');
        expect(script).toBeTruthy();
        expect(script.dataset.ojaScope).toMatch(/^__oja_scope_/);

        window[scopeKey()]?.ready();
        await render;
    });

    it('exposes { container, props, ready } on window[scopeKey]', async () => {
        stubFetch('<div></div>');
        const render = Out.composite('t.html', '/js/p.js', { value: 99 }).render(el);
        await flush();

        const key   = scopeKey();
        const scope = window[key];
        expect(scope).toBeDefined();
        expect(scope.container).toBe(el);
        expect(scope.props.value).toBe(99);
        expect(typeof scope.ready).toBe('function');

        scope.ready();
        await render;
    });

    it('scope key matches data-oja-scope on the script tag', async () => {
        stubFetch('<div></div>');
        const render = Out.composite('t.html', '/js/p.js').render(el);
        await flush();

        const key    = scopeKey();
        const script = el.querySelector('script');
        expect(script).toBeTruthy();
        expect(script.dataset.ojaScope).toBe(key);

        window[key]?.ready();
        await render;
    });

    it('cleans up window scope key after ready()', async () => {
        stubFetch('<div></div>');
        const render = Out.composite('t.html', '/js/p.js').render(el);
        await flushAndReady();
        await render;

        // settle() defers deletion via setTimeout(0) — flush the macrotask queue
        await new Promise(r => setTimeout(r, 10));

        const remaining = Object.keys(window).filter(k => k.startsWith('__oja_scope_'));
        expect(remaining).toHaveLength(0);
    });

    it('composite script can mutate container via scope', async () => {
        stubFetch('<span id="out"></span>');
        const render = Out.composite('t.html', '/js/p.js', { msg: 'hello' }).render(el);
        await flush();

        const { container, props, ready } = window[scopeKey()];
        container.querySelector('#out').textContent = props.msg;
        ready();
        await render;

        expect(el.querySelector('#out').textContent).toBe('hello');
    });
});

// Ready handshake

describe('Out.composite — ready handshake', () => {
    let el;
    beforeEach(() => { el = makeContainer(); cleanScopeKeys(); });
    afterEach(() => { cleanup(el); Out.clearCache(); cleanScopeKeys(); vi.restoreAllMocks(); });

    it('resolves via scope.ready()', async () => {
        stubFetch('<div></div>');
        const render = Out.composite('t.html', 't.js').render(el);
        await flushAndReady();
        await expect(render).resolves.toBeUndefined();
    });

    it('resolves via oja:composite-ready event matching scope key', async () => {
        stubFetch('<div></div>');
        const render = Out.composite('t.html', 't.js').render(el);
        await flush();

        const key = scopeKey();
        document.dispatchEvent(new CustomEvent('oja:composite-ready', { detail: { scope: key } }));

        await expect(render).resolves.toBeUndefined();
    });

    it('oja:composite-ready with wrong key does NOT resolve prematurely', async () => {
        stubFetch('<div></div>');
        let resolved = false;
        const render = Out.composite('t.html', 't.js', {}, { timeout: 80 }).render(el);
        render.then(() => { resolved = true; });

        await flush();
        document.dispatchEvent(new CustomEvent('oja:composite-ready', {
            detail: { scope: '__oja_scope_wrong_key' }
        }));
        await flush();
        expect(resolved).toBe(false);

        await new Promise(r => setTimeout(r, 100));
        expect(resolved).toBe(true);
    });

    it('ready() is idempotent — calling twice does not throw', async () => {
        stubFetch('<div></div>');
        const render = Out.composite('t.html', 't.js').render(el);
        await flush();

        const key = scopeKey();
        window[key].ready();
        window[key].ready(); // safe no-op

        await expect(render).resolves.toBeUndefined();
    });
});

// Timeout

describe('Out.composite — timeout', () => {
    let el;
    beforeEach(() => { el = makeContainer(); cleanScopeKeys(); vi.useFakeTimers(); });
    afterEach(() => {
        cleanup(el); Out.clearCache(); cleanScopeKeys();
        vi.restoreAllMocks(); vi.useRealTimers();
    });

    it('resolves after timeout when ready() is never called', async () => {
        stubFetch('<div></div>');
        const render = Out.composite('t.html', 't.js', {}, { timeout: 200 }).render(el);

        // Microtasks are not affected by fake timers — flush manually
        await Promise.resolve(); await Promise.resolve();
        await Promise.resolve(); await Promise.resolve();

        vi.advanceTimersByTime(201);
        await expect(render).resolves.toBeUndefined();
    });

    it('resolves before timeout when ready() is called early', async () => {
        stubFetch('<div></div>');
        const render = Out.composite('t.html', 't.js', {}, { timeout: 5000 }).render(el);

        await Promise.resolve(); await Promise.resolve();
        await Promise.resolve(); await Promise.resolve();

        window[scopeKey()]?.ready();
        await render;

        // Advancing past timeout must not throw — timer was cleared
        expect(() => vi.advanceTimersByTime(6000)).not.toThrow();
    });
});

// Abort signal

describe('Out.composite — abort signal', () => {
    let el;
    beforeEach(() => { el = makeContainer(); cleanScopeKeys(); });
    afterEach(() => { cleanup(el); Out.clearCache(); cleanScopeKeys(); vi.restoreAllMocks(); });

    it('resolves cleanly when aborted before script ready', async () => {
        stubFetch('<div></div>');
        const ctrl   = new AbortController();
        const render = Out.composite('t.html', 't.js', {}, { signal: ctrl.signal }).render(el);

        await flush();
        ctrl.abort();

        await expect(render).resolves.toBeUndefined();
    });

    it('removes the injected script tag on abort', async () => {
        stubFetch('<div></div>');
        const ctrl   = new AbortController();
        const render = Out.composite('t.html', 't.js', {}, { signal: ctrl.signal }).render(el);

        await flush();
        ctrl.abort();
        await render;

        expect(el.querySelector('script')).toBeNull();
    });
});

// CSS scoping

describe('Out.composite — CSS scoping', () => {
    let el;
    beforeEach(() => { el = makeContainer(); cleanScopeKeys(); });
    afterEach(() => {
        cleanup(el); Out.clearCache(); cleanScopeKeys(); vi.restoreAllMocks();
        document.querySelectorAll('style[data-oja-composite-style]').forEach(s => s.remove());
    });

    // CSS fetch is fire-and-forget (non-blocking). After render() resolves,
    // we need extra flushes to let the CSS promise chain settle.
    async function renderWithCSS(composite) {
        const render = composite.render(el);
        await flushAndReady();
        await render;
        await flush(); // settle the non-blocking CSS promise
    }

    it('injects a <style> tag into document.head', async () => {
        stubFetch('<div></div>', '.box { color: red; }');
        await renderWithCSS(Out.composite('t.html', 't.js', 't.css'));

        const scopeId = el.getAttribute('data-oja-composite');
        expect(document.head.querySelector(`style[data-oja-composite-style="${scopeId}"]`)).toBeTruthy();
    });

    it('scopes plain selectors under data-oja-composite attribute', async () => {
        stubFetch('<div></div>', '.box { color: red; }');
        await renderWithCSS(Out.composite('t.html', 't.js', 't.css'));

        const scopeId = el.getAttribute('data-oja-composite');
        const style   = document.head.querySelector(`style[data-oja-composite-style="${scopeId}"]`);
        expect(style.textContent).toContain(`[data-oja-composite="${scopeId}"] .box`);
    });

    it('scopes selectors inside @media wrappers', async () => {
        stubFetch('<div></div>', '@media (max-width: 600px) { .box { width: 100%; } }');
        await renderWithCSS(Out.composite('t.html', 't.js', 't.css'));

        const scopeId = el.getAttribute('data-oja-composite');
        const style   = document.head.querySelector(`style[data-oja-composite-style="${scopeId}"]`);
        expect(style.textContent).toContain('@media (max-width: 600px)');
        expect(style.textContent).toContain(`[data-oja-composite="${scopeId}"] .box`);
    });

    it('does NOT scope @keyframes', async () => {
        stubFetch('<div></div>', '@keyframes fade { from { opacity: 0; } to { opacity: 1; } }');
        await renderWithCSS(Out.composite('t.html', 't.js', 't.css'));

        const style = document.head.querySelector('style[data-oja-composite-style]');
        expect(style.textContent).toContain('@keyframes fade');
        expect(style.textContent).not.toMatch(/\[data-oja-composite[^\]]*\]\s*@keyframes/);
    });

    it('does NOT scope @font-face', async () => {
        stubFetch('<div></div>', '@font-face { font-family: Oja; src: url(oja.woff2); }');
        await renderWithCSS(Out.composite('t.html', 't.js', 't.css'));

        const style = document.head.querySelector('style[data-oja-composite-style]');
        expect(style.textContent).toContain('@font-face');
        expect(style.textContent).not.toMatch(/\[data-oja-composite[^\]]*\]\s*@font-face/);
    });

    it('warns but does not throw when CSS fetch fails', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn((url) => {
            if (url.endsWith('.css')) return Promise.reject(new Error('CSS 404'));
            return Promise.resolve({ ok: true, text: () => Promise.resolve('<div></div>') });
        }));

        await renderWithCSS(Out.composite('t.html', 't.js', 'bad.css'));

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('composite: failed to load CSS'),
            expect.any(Error)
        );
    });

    it('does not inject duplicate <style> for the same scopeId', async () => {
        stubFetch('<div></div>', '.a { color: blue; }');
        await renderWithCSS(Out.composite('t.html', 't.js', 't.css'));

        const scopeId = el.getAttribute('data-oja-composite');
        const count   = document.head
            .querySelectorAll(`style[data-oja-composite-style="${scopeId}"]`).length;
        expect(count).toBe(1);
    });
});

// VFS integration

describe('Out.composite — VFS integration', () => {
    let el;
    beforeEach(() => { el = makeContainer(); cleanScopeKeys(); });
    afterEach(() => { cleanup(el); Out.clearCache(); cleanScopeKeys(); vi.restoreAllMocks(); });

    it('reads HTML from VFS when provided in options', async () => {
        const vfs = { readText: vi.fn().mockResolvedValue('<p>from vfs</p>') };
        vi.stubGlobal('fetch', vi.fn());

        const render = Out.composite({ html: 't.html', js: 't.js', data: {}, vfs }).render(el);
        await flushAndReady();
        await render;

        expect(vfs.readText).toHaveBeenCalledWith('t.html');
        expect(el.textContent).toContain('from vfs');
        expect(fetch).not.toHaveBeenCalled();
    });
});

// Prefetch

describe('Out.composite — prefetch', () => {
    beforeEach(() => { cleanScopeKeys(); });
    afterEach(() => {
        Out.clearCache(); cleanScopeKeys(); vi.restoreAllMocks();
        document.querySelectorAll('link[rel="preload"][as="script"]').forEach(l => l.remove());
    });

    it('prefetches HTML and CSS, adds preload link for JS', async () => {
        const fetchMock = stubFetch('<div></div>', '.a{}');
        await Out.composite('t.html', 't.js', 't.css').prefetch();

        expect(fetchMock).toHaveBeenCalledWith('t.html', expect.any(Object));
        expect(fetchMock).toHaveBeenCalledWith('t.css', expect.any(Object));
        expect(fetchMock).not.toHaveBeenCalledWith('t.js', expect.any(Object));

        const preload = document.head.querySelector('link[rel="preload"][href="t.js"]');
        expect(preload).toBeTruthy();
        expect(preload.as).toBe('script');
    });

    it('prefetches HTML only when no CSS', async () => {
        const fetchMock = stubFetch('<div></div>');
        await Out.composite('t.html', 't.js').prefetch();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith('t.html', expect.any(Object));
    });
});

// Error handling

describe('Out.composite — error handling', () => {
    let el;
    beforeEach(() => { el = makeContainer(); cleanScopeKeys(); });
    afterEach(() => { cleanup(el); Out.clearCache(); cleanScopeKeys(); vi.restoreAllMocks(); });

    it('rejects when HTML fetch fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
        await expect(Out.composite('bad.html', 't.js').render(el)).rejects.toThrow('Network error');
    });

    it('resolves (does not throw) when script tag fires error event', async () => {
        stubFetch('<div></div>');
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const render = Out.composite('t.html', '/bad/script.js').render(el);
        await flush();

        const script = el.querySelector('script');
        expect(script).toBeTruthy();
        script.dispatchEvent(Object.assign(new Event('error'), { message: 'load failed' }));

        await expect(render).resolves.toBeUndefined();
        expect(errSpy).toHaveBeenCalledWith(
            expect.stringContaining('composite script failed'),
            expect.anything()
        );
    });
});

// Router compatibility

describe('Out.composite — router compatibility', () => {
    let el;
    beforeEach(() => { el = makeContainer(); cleanScopeKeys(); });
    afterEach(() => { cleanup(el); Out.clearCache(); cleanScopeKeys(); vi.restoreAllMocks(); });

    it('Out.is() recognises composite', () => {
        expect(Out.is(Out.composite('p.html', 'p.js'))).toBe(true);
    });

    it('has a prefetch() method', () => {
        expect(typeof Out.composite('p.html', 'p.js').prefetch).toBe('function');
    });

    it('router can render Out.page as a responder — ctx data is interpolated', async () => {
        stubFetch('<p>{{title}}</p>');
        const responder = Out.page('dashboard.html', 'dashboard.js');
        const ctx       = { path: '/dashboard', params: {}, title: 'DB' };

        const render = responder.render(el, ctx);
        await flushAndReady();
        await render;

        expect(el.textContent).toContain('DB');
    });
});

// Concurrency

describe('Out.composite — concurrency', () => {
    let containers = [];
    beforeEach(() => { cleanScopeKeys(); });
    afterEach(() => {
        containers.forEach(c => cleanup(c));
        containers = [];
        Out.clearCache(); cleanScopeKeys(); vi.restoreAllMocks();
    });

    it('multiple composites on the page have unique scope keys', async () => {
        stubFetch('<div></div>');
        containers = [makeContainer(), makeContainer(), makeContainer()];
        const renders = containers.map(c => Out.composite('t.html', 't.js').render(c));

        await flush(); // settle all three fetches

        const keys = Object.keys(window).filter(k => k.startsWith('__oja_scope_'));
        expect(keys.length).toBeGreaterThanOrEqual(3);
        expect(new Set(keys).size).toBe(keys.length);

        keys.forEach(k => window[k]?.ready?.());
        await Promise.all(renders);
    });

    it('each container gets a distinct data-oja-composite id', async () => {
        stubFetch('<div></div>');
        const c1 = makeContainer(), c2 = makeContainer();
        containers = [c1, c2];

        const r1 = Out.composite('t.html', 't.js').render(c1);
        const r2 = Out.composite('t.html', 't.js').render(c2);
        await flush();
        Object.keys(window).filter(k => k.startsWith('__oja_scope_'))
            .forEach(k => window[k]?.ready?.());
        await Promise.all([r1, r2]);

        expect(c1.getAttribute('data-oja-composite'))
            .not.toBe(c2.getAttribute('data-oja-composite'));
    });
});
