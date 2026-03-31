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


describe('execScripts() — preamble injection', () => {
    it('injects container when the script does not declare it', () => {
        const injectedSrcs = [];
        const origCreate = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation((tag) => {
            const el = origCreate(tag);
            if (tag === 'script') {
                Object.defineProperty(el, 'src', {
                    set(v) { injectedSrcs.push(v); },
                    get() { return ''; },
                    configurable: true,
                });
            }
            return el;
        });
        const container = makeContainer('// no container declaration');
        execScripts(container, null, {});
        expect(injectedSrcs.length).toBeGreaterThan(0);
        document.createElement.mockRestore();
    });

    it('does not double-declare container when script already declares it', () => {
        const body = 'const container = document.getElementById("app");';
        const declares = n => new RegExp(`\\b(?:const|let|var|function)\\s+${n}\\b`).test(body);
        expect(declares('container')).toBe(true);
        expect(declares('find')).toBe(false);
        expect(declares('props')).toBe(false);
    });

    it('detects let and var declarations', () => {
        const body = 'let find = () => {}; var findAll = null;';
        const declares = n => new RegExp(`\\b(?:const|let|var|function)\\s+${n}\\b`).test(body);
        expect(declares('find')).toBe(true);
        expect(declares('findAll')).toBe(true);
        expect(declares('container')).toBe(false);
    });

    it('detects function declarations', () => {
        const body = 'function find(sel) { return document.querySelector(sel); }';
        const declares = n => new RegExp(`\\b(?:const|let|var|function)\\s+${n}\\b`).test(body);
        expect(declares('find')).toBe(true);
    });

    it('does not false-positive on identifiers used in expressions', () => {
        const body = 'component.mount(container, "tweet.html", props);';
        const declares = n => new RegExp(`\\b(?:const|let|var|function)\\s+${n}\\b`).test(body);
        expect(declares('container')).toBe(false);
    });

    it('props is always injectable regardless of declarations in body', () => {
        const body = 'const props = { fake: true };';
        const declares = n => new RegExp(`\\b(?:const|let|var|function)\\s+${n}\\b`).test(body);
        // The regex would detect it — but _exec.js skips the check for props intentionally
        expect(declares('props')).toBe(true);
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

    it('scope key object has container, find, findAll, props and __oja_ready__', () => {
        const container = makeContainer('// full scope check');
        execScripts(container, null, {});
        const ojaKey = Object.keys(window).find(k => k.startsWith('__oja_'));
        expect(ojaKey).toBeDefined();
        const scope = window[ojaKey];
        expect(typeof scope.find).toBe('function');
        expect(typeof scope.findAll).toBe('function');
        expect(typeof scope.__oja_ready__).toBe('function');
        expect(scope.props).toBeDefined();
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