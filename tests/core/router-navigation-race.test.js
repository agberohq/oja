/**
 * tests/core/router-navigation-race.test.js
 *
 * Promoted from tests/bugs/002-router-navigation-race.test.js after the fix.
 *
 * The defect: `router._render()` had no navigation guard around its DOM work, and
 * `_ComponentOut.render()` fetched without the navigation AbortSignal. A slow
 * page could therefore finish loading *after* the user navigated elsewhere and
 * overwrite the newer page — leaving the outlet showing a route the user had
 * already left, while `router.current()` reported the new one.
 *
 * Fix, in three layers:
 *   1. `_fetchHTML()` throws a real AbortError instead of a plain Error, and does
 *      not emit `out:fetch-error` for aborts.
 *   2. `_ComponentOut.render()` passes `context.signal` to the fetch and
 *      re-checks it immediately before the DOM write, so a fetch that ignored
 *      the abort (cache hit, polyfill) still cannot paint over the new page.
 *      An aborted render is rethrown without rendering error UI.
 *   3. `_render()` captures `_navId` + the signal at entry and bails after the
 *      transition wait and after the responder resolves; `navigate()` never
 *      routes an AbortError into the error responder.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Router } from '../../src/js/core/router.js';
import { Out }    from '../../src/js/core/out.js';

let router;
let fetchMock;

function abortError() {
    const err = new Error('The operation was aborted.');
    err.name = 'AbortError';
    return err;
}

function stubFetch() {
    return vi.fn(async (url, opts = {}) => {
        const slow = String(url).includes('slow');
        await new Promise((resolve, reject) => {
            const id = setTimeout(resolve, slow ? 400 : 5);
            // Honour a real AbortSignal like the browser would.
            if (opts.signal) {
                if (opts.signal.aborted) { clearTimeout(id); reject(abortError()); return; }
                opts.signal.addEventListener('abort', () => {
                    clearTimeout(id);
                    reject(abortError());
                }, { once: true });
            }
        });
        return {
            ok: true,
            status: 200,
            text: async () => `<p>${slow ? 'SLOW PAGE' : 'FAST PAGE'}</p>`,
        };
    });
}

beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    Out.clearCache();
    fetchMock = stubFetch();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    router?.destroy();
    router = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

function makeRouter() {
    router = new Router({ mode: 'hash', outlet: '#app' });
    router.Get('/slow', Out.component('./slow.html'));
    router.Get('/fast', Out.component('./fast.html'));
    return router;
}

describe('router — superseded navigation', () => {
    it('a superseded navigation cannot overwrite the newer page', async () => {
        makeRouter();

        // Let the slow navigation pass its 150 ms transition so its fetch is
        // genuinely in flight before it is superseded.
        const slowNav = router.navigate('/slow');
        await new Promise(res => setTimeout(res, 200));

        await router.navigate('/fast');

        // The abandoned navigation must resolve cleanly — an abort is not an
        // error the caller has to handle.
        await expect(slowNav).resolves.toBeUndefined();

        // Give the abandoned fetch time to land; it must not touch the outlet.
        await new Promise(res => setTimeout(res, 450));

        const outlet = document.querySelector('#app');
        expect(outlet.textContent.trim()).toBe('FAST PAGE');
        expect(outlet.querySelector('.oja-error')).toBeNull();
        expect(router.current()).toBe('/fast');
    });

    it('a navigation superseded during its transition never starts its fetch', async () => {
        makeRouter();

        const slowNav = router.navigate('/slow');
        await new Promise(res => setTimeout(res, 20));   // still inside the 150 ms wait

        await router.navigate('/fast');
        await slowNav;

        const requested = fetchMock.mock.calls.map(([url]) => String(url));
        expect(requested.some(url => url.includes('slow'))).toBe(false);

        expect(document.querySelector('#app').textContent.trim()).toBe('FAST PAGE');
    });
});
