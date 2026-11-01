/**
 * tests/core/out-scripts.test.js
 *
 * Promoted from tests/bugs/003-out-scripts-not-awaited.test.js after the fix.
 *
 * The defect: `_ComponentOut.render()` called `execScripts()` without awaiting
 * it (out.js:530), so `render()` resolved while page scripts were still
 * loading. The router drains component lifecycle hooks immediately after a
 * responder renders (router.js:596), so hooks registered inside a page script
 * (component.onMount / onReady / onUnmount) were queued *after* the drain and
 * silently lost on the first render.
 *
 * Same omission existed in `_HtmlOut.render()` and in the string branch of
 * `_FnOut.render()`; all three now await.
 *
 * These tests isolate the contract with a deferred execScripts mock rather than
 * relying on browser timing, because jsdom's blob-script shim (tests/setup.js)
 * executes scripts in a microtask and would hide the ordering bug.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Deferred execScripts — the test decides when page scripts "finish".
const h = vi.hoisted(() => ({ called: 0, release: null }));

vi.mock('../../src/js/core/_exec.js', () => ({
    execScripts: () => {
        h.called++;
        return new Promise(resolve => { h.release = resolve; });
    },
    cleanupOjaScopes: () => {},
}));

const { Out } = await import('../../src/js/core/out.js');

function host() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

beforeEach(() => {
    h.called  = 0;
    h.release = null;
    document.body.innerHTML = '';
    Out.clearCache();
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => '<div class="page">page</div><script type="module">/* page script */</script>',
    })));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('Out — component scripts are awaited', () => {
    it('Out.component() executes page scripts', async () => {
        const el = host();
        const render = Out.component('./page.html').render(el, {});

        await vi.waitFor(() => expect(h.called).toBe(1));
        h.release();
        await render;

        expect(el.innerHTML).toContain('page');
    });

    it('Out.component().render() does not settle while scripts are pending', async () => {
        const el = host();

        let settled = false;
        const render = Out.component('./page.html')
            .render(el, {})
            .then(() => { settled = true; });

        await vi.waitFor(() => expect(h.called).toBe(1));
        expect(settled).toBe(false);

        h.release();
        await render;
        expect(settled).toBe(true);
    });

    it('Out.html() does not settle while scripts are pending', async () => {
        const el = host();

        let settled = false;
        const render = Out.html('<div>x</div><script type="module">/* x */</script>')
            .render(el)
            .then(() => { settled = true; });

        await vi.waitFor(() => expect(h.called).toBe(1));
        expect(settled).toBe(false);

        h.release();
        await render;
        expect(settled).toBe(true);
    });

    it('Out.fn() returning HTML does not settle while scripts are pending', async () => {
        const el = host();

        let settled = false;
        const render = Out.fn(async () => '<div>y</div><script type="module">/* y */</script>')
            .render(el)
            .then(() => { settled = true; });

        await vi.waitFor(() => expect(h.called).toBe(1));
        expect(settled).toBe(false);

        h.release();
        await render;
        expect(settled).toBe(true);
    });
});
