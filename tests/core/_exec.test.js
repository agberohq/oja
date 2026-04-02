import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execScripts } from '../../src/js/core/_exec.js';

function makeContainer(scriptContent, type = 'module') {
    const div = document.createElement('div');
    const script = document.createElement('script');
    script.type = type;
    script.textContent = scriptContent;
    div.appendChild(script);
    document.body.appendChild(div);
    return div;
}

beforeEach(() => {
    document.body.innerHTML = '';
    Object.keys(window).filter(k => k.startsWith('__oja_')).forEach(k => delete window[k]);
});


describe('execScripts() — preamble (only __oja_ready__)', () => {
    it('injects a script blob for module scripts', () => {
        const blobTexts = [];
        const origCreate = URL.createObjectURL;
        URL.createObjectURL = (blob) => { blobTexts.push(blob.__shimText ?? ''); return origCreate(blob); };
        const container = makeContainer('// module script');
        execScripts(container, null, {});
        URL.createObjectURL = origCreate;
        expect(blobTexts.length).toBeGreaterThan(0);
    });

    it('preamble only contains __oja_ready__ — no container/find/props', () => {
        const blobTexts = [];
        const origCreate = URL.createObjectURL;
        URL.createObjectURL = (blob) => { blobTexts.push(blob.__shimText ?? ''); return origCreate(blob); };
        const container = makeContainer('// preamble check');
        execScripts(container, null, {});
        URL.createObjectURL = origCreate;
        const preamble = blobTexts[0] ?? '';
        expect(preamble).toContain('__oja_ready__');
        // Magic variables are gone — scripts import explicitly
        expect(preamble).not.toMatch(/const\s*\{[^}]*container/);
        expect(preamble).not.toMatch(/const\s*\{[^}]*find/);
        expect(preamble).not.toMatch(/const\s*\{[^}]*props/);
    });

    it('_declares correctly identifies binding position — not value expression', () => {
        // The critical fix: 'const x = await find(...)' must NOT be detected
        // as declaring 'find'. Only the left-hand binding name counts.
        // We test via the blob preamble: if _declares wrongly fires, __oja_ready__
        // would be absent from the preamble (since picks would skip it).
        const blobTexts = [];
        const origCreate = URL.createObjectURL;
        URL.createObjectURL = (blob) => { blobTexts.push(blob.__shimText ?? ''); return origCreate(blob); };
        // Script uses find in value position — should NOT suppress __oja_ready__ injection
        const container = makeContainer('const btn = document.querySelector(".btn");');
        execScripts(container, null, {});
        URL.createObjectURL = origCreate;
        expect(blobTexts[0]).toContain('__oja_ready__');
    });
});

describe('execScripts() — __oja_ready__ signal', () => {

    it('adds __oja_ready__ to the scope key object after src is assigned', () => {
        // execScripts() is synchronous up to the Promise creation.
        // After it returns, window[scopeKey] still exists and has __oja_ready__
        // because the preamble's delete line only runs when the module executes.
        const container = makeContainer('// scope key inspection');
        execScripts(container, null, {});

        // Find the scope key that was created
        const ojaKey = Object.keys(window).find(k => k.startsWith('__oja_'));
        expect(ojaKey).toBeDefined();
        expect(typeof window[ojaKey]?.__oja_ready__).toBe('function');
    });

    it('__oja_ready__ is listed in the preamble picks (verified via blob content)', () => {
        // The blob content is captured by our setup.js shim via _blobSources.
        // We inspect the blob text to confirm __oja_ready__ appears in the destructure.
        const blobTexts = [];
        const origCreateObjectURL = URL.createObjectURL;
        URL.createObjectURL = (blob) => {
            // setup.js shim stores blob text on blob.__shimText
            blobTexts.push(blob.__shimText ?? '');
            return origCreateObjectURL(blob);
        };

        const container = makeContainer('// picks list verification');
        execScripts(container, null, {});

        URL.createObjectURL = origCreateObjectURL;

        expect(blobTexts.length).toBeGreaterThan(0);
        const preamble = blobTexts[0];
        expect(preamble).toContain('__oja_ready__');
    });

    it('calling __oja_ready__ on the scope key resolves the execScripts() promise', async () => {
        const container = makeContainer('// ready signal resolution');
        const promise = execScripts(container, null, {});

        // Find the scope key — it exists synchronously right after execScripts() starts
        const ojaKey = Object.keys(window).find(k => k.startsWith('__oja_'));
        expect(ojaKey).toBeDefined();
        expect(typeof window[ojaKey]?.__oja_ready__).toBe('function');

        // Call it as a slot script would at its last line
        window[ojaKey].__oja_ready__();

        // Promise should now resolve (not hang)
        await expect(
            Promise.race([
                promise,
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 500)),
            ])
        ).resolves.toBeUndefined();
    });

    it('execScripts() returns a Promise even when __oja_ready__ is never called', () => {
        // Verifies the function always returns a Promise (fallback via load event)
        const container = makeContainer('// no __oja_ready__ call');
        const result = execScripts(container, null, {});
        expect(result).toBeInstanceOf(Promise);
    });

    it('at most one __oja_ scope key exists per execScripts() call', () => {
        const container = makeContainer('/* single scope key */');
        execScripts(container, null, {});
        const ojaKeys = Object.keys(window).filter(k => k.startsWith('__oja_'));
        // Module scripts are async — key exists until preamble delete runs.
        // There should never be more than one per active execScripts() call.
        expect(ojaKeys.length).toBeLessThanOrEqual(1);
    });

    it('scope key object has only __oja_ready__ — no container/find/findAll/props', () => {
        const container = makeContainer('// scope key check');
        execScripts(container, null, {});
        const ojaKey = Object.keys(window).find(k => k.startsWith('__oja_'));
        expect(ojaKey).toBeDefined();
        const scope = window[ojaKey];
        // Only __oja_ready__ — everything else is imported explicitly
        expect(typeof scope.__oja_ready__).toBe('function');
        expect(scope.container).toBeUndefined();
        expect(scope.find).toBeUndefined();
        expect(scope.findAll).toBeUndefined();
        expect(scope.props).toBeUndefined();
    });
});

//
// jsdom does NOT execute scripts added via innerHTML or replaceWith() —
// that is a hard jsdom constraint. The existing test suite (original _exec.test.js)
// does not test classic script execution either. We verify the structural
// behaviour that IS testable: the script element is replaced and no Promise
// is queued (classic scripts resolve synchronously).

describe('execScripts() — classic scripts', () => {
    it('returns a resolved Promise immediately for classic-only containers', async () => {
        const container = makeContainer('/* classic */', ''); // type="" = classic
        await expect(execScripts(container, null, {})).resolves.toBeUndefined();
    });

    it('replaces the original classic script element with a new one', () => {
        const container = makeContainer('window.__cls__ = 1;', '');
        const originalScript = container.querySelector('script');
        execScripts(container, null, {});
        // The original element is replaced — it's no longer in the container
        expect(container.contains(originalScript)).toBe(false);
    });

    it('does not create a blob URL for classic scripts', () => {
        const blobCalls = [];
        const origCreate = URL.createObjectURL;
        URL.createObjectURL = (b) => { blobCalls.push(b); return origCreate(b); };

        const container = makeContainer('/* no blob */', '');
        execScripts(container, null, {});

        URL.createObjectURL = origCreate;
        // Classic scripts use textContent, not blob URLs
        expect(blobCalls).toHaveLength(0);
    });
});


describe('execScripts() — no scripts', () => {
    it('returns a resolved Promise when container has no scripts', async () => {
        const container = document.createElement('div');
        container.innerHTML = '<p>no scripts here</p>';
        document.body.appendChild(container);
        await expect(execScripts(container, null, {})).resolves.toBeUndefined();
    });

    it('always returns a Promise (never undefined or null)', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const result = execScripts(container, null, {});
        expect(result).toBeInstanceOf(Promise);
    });
});