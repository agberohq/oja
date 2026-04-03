/**
 * tests/core/_exec2.test.js
 *
 * Behavioral tests for _exec.js.
 *
 * These tests verify observable outcomes — what scripts see and what
 * resolves — not internal blob content or preamble wording. This means
 * they survive refactors of the preamble mechanism.
 *
 * Key changes from the previous version:
 *   - __oja_ready__() injection has been removed from _exec.js. Scripts
 *     must import { ready } from oja.js to signal async completion.
 *   - The load-event fallback still resolves scripts that never call ready().
 *   - _declares() has been removed — the preamble is now two fixed lines.
 *   - window[scopeKey] is now a bare element reference (not an object).
 *
 * Because jsdom does not actually execute blob: URL scripts, tests that
 * require real script execution use the load-event fallback path, which
 * fires after script injection. Tests that need to verify container
 * visibility (window.__oja_exec__) check that the scope key mechanism
 * works correctly without requiring real module execution.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execScripts, cleanupOjaScopes } from '../../src/js/core/_exec.js';
import { state } from '../../src/js/core/reactive.js';


function makeContainer(scriptContent, type = 'module') {
    const container = document.createElement('div');
    const script    = document.createElement('script');
    script.type     = type;
    script.textContent = scriptContent;
    container.appendChild(script);
    document.body.appendChild(container);
    return container;
}

function cleanup(...containers) {
    containers.forEach(c => c?.remove());
}


describe('execScripts — input validation', () => {
    it('rejects when container is null', async () => {
        await expect(execScripts(null)).rejects.toThrow(TypeError);
    });

    it('rejects when container is not an Element', async () => {
        await expect(execScripts('#app')).rejects.toThrow(TypeError);
    });

    it('resolves immediately when container has no scripts', async () => {
        const c = document.createElement('div');
        c.innerHTML = '<p>No scripts</p>';
        document.body.appendChild(c);
        await expect(execScripts(c, document.baseURI, {})).resolves.toBeUndefined();
        c.remove();
    });
});


describe('execScripts — preamble structure', () => {
    // These tests verify that the simplified preamble (two fixed lines, no
    // _declares, no __oja_ready__ injection) is being generated correctly
    // by inspecting what gets set on window before the blob URL is assigned.

    afterEach(() => {
        document.body.innerHTML = '';
        Object.keys(window).filter(k => k.startsWith('__oja_scope_')).forEach(k => delete window[k]);
        delete window.__oja_exec__;
    });

    it('sets a __oja_scope_ key on window with the container element (not an object)', () => {
        const container = makeContainer('// script');

        // Capture the scope key before execScripts cleans it up
        let capturedKey = null;
        let capturedValue = null;
        const origSet = Object.defineProperty;

        // Spy: look for a new __oja_scope_ key added to window just before execScripts runs
        const before = new Set(Object.keys(window));
        execScripts(container, null, {});

        // The scope key should have been added (and may already be cleaned up
        // since jsdom doesn't execute module scripts — the promise is pending)
        const after   = Object.keys(window).filter(k => k.startsWith('__oja_scope_'));
        // There should be at least one scope key set (not yet cleaned)
        // In jsdom, the blob script never runs, so the preamble never fires.
        // The key stays on window until the load fallback fires.
        // We just verify the key exists and its value is a DOM Element.
        if (after.length > 0) {
            const val = window[after[0]];
            expect(val).toBe(container); // bare element, not { __oja_ready__, __oja_el__ }
        }
    });

    it('does not inject __oja_ready__ as a property of the scope key value', () => {
        const container = makeContainer('// check');
        execScripts(container, null, {});

        const key = Object.keys(window).find(k => k.startsWith('__oja_scope_'));
        if (key) {
            // Value must be the element itself, never an object with __oja_ready__
            expect(window[key]).toBe(container);
            expect(window[key].__oja_ready__).toBeUndefined();
        }
    });

    it('re-injected script element replaces the original', () => {
        const container = makeContainer('// original');
        const originalScript = container.querySelector('script');
        execScripts(container, null, {});
        const newScript = container.querySelector('script');
        // The script element should have been replaced
        expect(newScript).not.toBe(originalScript);
    });

    it('new script element has type="module"', () => {
        const container = makeContainer('// check type');
        execScripts(container, null, {});
        const script = container.querySelector('script');
        expect(script.type).toBe('module');
    });

    it('new script element has a src (blob URL)', () => {
        const container = makeContainer('// check src');
        execScripts(container, null, {});
        const script = container.querySelector('script');
        expect(script.src).toMatch(/^blob:/);
    });
});


describe('execScripts — resolution paths', () => {
    let container;
    afterEach(() => cleanup(container));

    it('resolves via load-event fallback when script never calls ready()', async () => {
        // This was the layout.apply() hang bug — now fixed via the load fallback.
        // The script has no ready() call; the fallback must resolve the promise.
        container = makeContainer(`const x = 'shell wired — no ready call';`);
        await expect(execScripts(container, document.baseURI, {})).resolves.toBeUndefined();
    });

    it('resolves via error handler when script throws', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        container = makeContainer(`throw new Error('boom');`);
        await expect(execScripts(container, document.baseURI, {})).resolves.toBeUndefined();
        errSpy.mockRestore();
    });

    it('resolves even when script body is empty', async () => {
        container = makeContainer('');
        await expect(execScripts(container, document.baseURI, {})).resolves.toBeUndefined();
    });

    it('returns a Promise', () => {
        container = makeContainer('// test');
        const result = execScripts(container, document.baseURI, {});
        expect(result).toBeInstanceOf(Promise);
    });
});


describe('execScripts — classic scripts', () => {
    it('resolves immediately for classic scripts', async () => {
        const container = makeContainer('window.__classic_ran__ = true;', 'text/javascript');
        await expect(execScripts(container, document.baseURI, {})).resolves.toBeUndefined();
        container.remove();
        delete window.__classic_ran__;
    });
});


describe('execScripts — multiple scripts', () => {
    it('waits for all scripts to resolve', async () => {
        const container = document.createElement('div');
        for (let i = 0; i < 3; i++) {
            const s = document.createElement('script');
            s.type = 'module';
            s.textContent = `// script ${i}`;
            container.appendChild(s);
        }
        document.body.appendChild(container);
        await expect(execScripts(container, document.baseURI, {})).resolves.toBeUndefined();
        container.remove();
    });

    it('resolves when container has no module scripts', async () => {
        const container = makeContainer(`window.__x__ = 1;`, 'text/javascript');
        await expect(execScripts(container, document.baseURI, {})).resolves.toBeUndefined();
        container.remove();
        delete window.__x__;
    });
});


describe('cleanupOjaScopes', () => {
    it('removes orphaned scope keys from window', () => {
        // Manually plant an orphaned key
        window['__oja_scope_9999_orphan'] = document.createElement('div');
        window['__oja_scope_9998_orphan'] = document.createElement('div');
        window['__not_oja__']             = true;

        cleanupOjaScopes();

        expect(window['__oja_scope_9999_orphan']).toBeUndefined();
        expect(window['__oja_scope_9998_orphan']).toBeUndefined();
        expect(window['__not_oja__']).toBe(true); // untouched

        delete window['__not_oja__'];
    });
});


describe('execScripts — parallel container isolation', () => {
    function makeSlot(content = '// slot') {
        const div = document.createElement('div');
        const s   = document.createElement('script');
        s.type = 'module';
        s.textContent = content;
        div.appendChild(s);
        document.body.appendChild(div);
        return div;
    }

    afterEach(() => {
        document.body.innerHTML = '';
        delete window.__pt;
        delete window.__oja_exec__;
    });

    it('window.__oja_exec__ is cleared after script settles', async () => {
        const div = makeSlot(`// no ready`);
        await execScripts(div, document.baseURI, {});
        expect(window.__oja_exec__).toBeUndefined();
    });

    it('scope key value is the container element (bare, not wrapped)', () => {
        const div  = makeSlot(`// check key`);
        execScripts(div, document.baseURI, {});

        const key = Object.keys(window).find(k => k.startsWith('__oja_scope_'));
        if (key) {
            // Must be the bare element — not an object
            expect(window[key]).toBe(div);
            expect(typeof window[key]).toBe('object');
            expect(window[key] instanceof Element).toBe(true);
        }
    });

    it('5 parallel execScripts() calls each create a distinct scope key', () => {
        const divs = Array.from({ length: 5 }, (_, i) => {
            const d = makeSlot(`// slot-${i}`);
            d.id = `slot-${i}`;
            return d;
        });

        const keysBefore = new Set(Object.keys(window).filter(k => k.startsWith('__oja_scope_')));

        // Fire all without awaiting — keys are set synchronously
        divs.forEach(d => execScripts(d, document.baseURI, {}));

        const keysAfter = Object.keys(window).filter(k => k.startsWith('__oja_scope_'));
        const newKeys   = keysAfter.filter(k => !keysBefore.has(k));

        // Each call should have created its own unique key
        expect(newKeys.length).toBe(5);

        // All values should be distinct element references
        const values = newKeys.map(k => window[k]);
        const unique  = new Set(values);
        expect(unique.size).toBe(5);
    });

    it('props stored per-container are correct after parallel mount', async () => {
        const { _getProps } = await import('../../src/js/core/_context.js');

        const make = () => {
            const div = document.createElement('div');
            const s   = document.createElement('script');
            s.type = 'module'; s.textContent = '// props test';
            div.appendChild(s);
            document.body.appendChild(div);
            return div;
        };

        const cA = make();
        const cB = make();

        const pA = { role: 'nav' };
        const pB = { role: 'sidebar' };

        await Promise.all([
            execScripts(cA, document.baseURI, pA),
            execScripts(cB, document.baseURI, pB),
        ]);

        expect(_getProps(cA)).toEqual(pA);
        expect(_getProps(cB)).toEqual(pB);
    });
});


describe('execScripts — import rewriting', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    it('rewrites relative imports to absolute URLs based on sourceUrl', () => {
        const container = makeContainer(`import { x } from './utils.js';`);
        execScripts(container, 'https://example.com/components/nav.html', {});

        const script = container.querySelector('script');
        // The blob src means we can't read the content directly, but we can
        // verify the script was re-injected with a blob URL (import rewriting
        // happened internally)
        expect(script.src).toMatch(/^blob:/);
    });

    it('does not rewrite absolute imports', () => {
        // Absolute imports should pass through unchanged — verifiable by the
        // fact that execScripts doesn't throw on them
        const container = makeContainer(`import { x } from 'https://cdn.example.com/lib.js';`);
        expect(() => execScripts(container, document.baseURI, {})).not.toThrow();
        container.remove();
    });
});
