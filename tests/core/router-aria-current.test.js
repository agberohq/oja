/**
 * tests/core/router-aria-current.test.js
 *
 * Promoted from tests/bugs/007-router-aria-current-null.test.js after the fix.
 *
 * `_updateNav()` called `setAttribute('aria-current', active ? 'page' : null)`.
 * `setAttribute` stringifies its second argument, so every inactive nav link was
 * given the literal attribute `aria-current="null"` — an invalid token for
 * assistive technology (the valid set is page/step/location/date/time/true/false).
 *
 * The inactive branch must remove the attribute instead.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Router } from '../../src/js/core/router.js';
import { Out }    from '../../src/js/core/out.js';

let router;

afterEach(() => {
    router?.destroy();
    router = null;
    document.body.innerHTML = '';
});

describe('router — aria-current on nav links', () => {
    it('marks the active link and removes the attribute elsewhere', async () => {
        document.body.innerHTML = `
            <div id="app"></div>
            <a id="link-a" data-page="/a">A</a>
            <a id="link-b" data-page="/b">B</a>
            <a id="link-c" data-href="/a">C</a>`;

        router = new Router({ mode: 'hash', outlet: '#app' });
        router.Get('/a', Out.html('<p>a</p>'));

        await router.navigate('/a');

        const activePage   = document.querySelector('#link-a');
        const inactivePage = document.querySelector('#link-b');
        const activeHref   = document.querySelector('#link-c');

        expect(activePage.getAttribute('aria-current')).toBe('page');
        expect(activeHref.getAttribute('aria-current')).toBe('page');

        expect(inactivePage.hasAttribute('aria-current')).toBe(false);
        expect(inactivePage.getAttribute('aria-current')).toBeNull();
    });

    it('does not leave aria-current behind after navigating away', async () => {
        document.body.innerHTML = `
            <div id="app"></div>
            <a id="link-a" data-page="/a">A</a>
            <a id="link-b" data-page="/b">B</a>`;

        router = new Router({ mode: 'hash', outlet: '#app' });
        router.Get('/a', Out.html('<p>a</p>'));
        router.Get('/b', Out.html('<p>b</p>'));

        await router.navigate('/a');
        await router.navigate('/b');

        expect(document.querySelector('#link-a').hasAttribute('aria-current')).toBe(false);
        expect(document.querySelector('#link-b').getAttribute('aria-current')).toBe('page');
    });
});
