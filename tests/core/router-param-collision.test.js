/**
 * tests/core/router-param-collision.test.js
 *
 * Promoted from tests/bugs/006-router-param-collision.test.js after the fix.
 *
 * A trie node holds a single `paramChild`, so two different parameter names at
 * the same path position collapse into one node. The framework keeps the first
 * name (params are keyed by it), which silently leaves the second route reading
 * `undefined` from `params()`.
 *
 * Registration cannot throw here without breaking existing apps, so the router
 * now warns with the conflicting names and points at the fix. This file pins
 * both directions: a conflict is reported, and a legitimate re-registration of
 * the same name is not.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Router } from '../../src/js/core/router.js';
import { Out }    from '../../src/js/core/out.js';

let router;

function captureWarnings() {
    return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

const warnText = (spy) => spy.mock.calls.map(args => args.join(' ')).join('\n');

afterEach(() => {
    router?.destroy();
    router = null;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('router — conflicting param names', () => {
    it('reports a different param name at the same path position', () => {
        const warn = captureWarnings();

        router = new Router({ mode: 'hash', outlet: '#app' });
        router.Get('/users/{id}',   Out.html('<p>id</p>'));
        router.Get('/users/{slug}', Out.html('<p>slug</p>'));

        const text = warnText(warn);
        expect(text).toMatch(/conflicting param name/i);
        expect(text).toContain('{id}');
        expect(text).toContain('{slug}');
    });

    it('reports conflicts registered through route groups', () => {
        const warn = captureWarnings();

        router = new Router({ mode: 'hash', outlet: '#app' });
        router.Group('/users').Get('/{id}',   Out.html('<p>id</p>'));
        router.Group('/users').Get('/{slug}', Out.html('<p>slug</p>'));

        expect(warnText(warn)).toMatch(/conflicting param name/i);
    });

    it('does not warn when the same param name is registered twice', () => {
        const warn = captureWarnings();

        router = new Router({ mode: 'hash', outlet: '#app' });
        router.Get('/users/{id}', Out.html('<p>one</p>'));
        router.Get('/users/{id}', Out.html('<p>two</p>'));

        expect(warnText(warn)).not.toMatch(/conflicting param name/i);
    });

    it('still registers both routes (a warning, not a throw)', () => {
        const warn = captureWarnings();

        router = new Router({ mode: 'hash', outlet: '#app' });
        expect(() => {
            router.Get('/users/{id}',   Out.html('<p>id</p>'));
            router.Get('/users/{slug}', Out.html('<p>slug</p>'));
        }).not.toThrow();

        expect(warn).toHaveBeenCalled();
    });
});
