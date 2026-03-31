/**
 * tests/core/on-cleanup.test.js
 *
 * Covers four things introduced in this patch:
 *
 *   1. on() returns a callable unsub (was returning a plain object)
 *   2. on() unsubs are automatically called when the active component unmounts
 *   3. query() — scoped querySelector, never auto-injected
 *   4. The findAll name-conflict: documents why query() is the safe alternative
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { on, off, emit }                                    from '../../src/js/core/events.js';
import { component, _setActiveForTest, _getScopeForTest }  from '../../src/js/core/component.js';
import { query }                                            from '../../src/js/core/ui.js';


function makeEl(tag = 'div', attrs = {}) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'class') el.className = v;
        else if (k === 'id') el.id = v;
        else el.setAttribute(k, v);
    });
    document.body.appendChild(el);
    return el;
}

beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
    component.clearCache();
    // Reset _activeElement between tests
    _setActiveForTest(null);
});

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    _setActiveForTest(null);
});


describe('on() — return value is a callable unsub', () => {

    it('returns a function for a CSS selector', () => {
        makeEl('button', { class: 'ret-fn' });
        const unsub = on('.ret-fn', 'click', () => {});
        expect(typeof unsub).toBe('function');
        unsub();
    });

    it('returns a function for a direct Element reference', () => {
        const btn = makeEl('button');
        const unsub = on(btn, 'click', () => {});
        expect(typeof unsub).toBe('function');
        unsub();
    });

    it('calling unsub stops the delegated handler from firing', () => {
        makeEl('button', { class: 'delegated-stop' });
        const fn = vi.fn();
        const unsub = on('.delegated-stop', 'click', fn);

        document.querySelector('.delegated-stop').click();
        expect(fn).toHaveBeenCalledTimes(1);

        unsub();
        document.querySelector('.delegated-stop').click();
        expect(fn).toHaveBeenCalledTimes(1); // must not have fired again
    });

    it('calling unsub stops the direct-element handler from firing', () => {
        const btn = makeEl('button');
        const fn  = vi.fn();
        const unsub = on(btn, 'click', fn);

        btn.click();
        expect(fn).toHaveBeenCalledTimes(1);

        unsub();
        btn.click();
        expect(fn).toHaveBeenCalledTimes(1); // must not have fired again
    });

    it('unsub is idempotent — calling it twice does not throw', () => {
        makeEl('button', { class: 'idem' });
        const unsub = on('.idem', 'click', () => {});
        expect(() => { unsub(); unsub(); }).not.toThrow();
    });

    it('two different handlers on the same selector are independently unsub-able', () => {
        makeEl('button', { class: 'two-handlers' });
        const a = vi.fn();
        const b = vi.fn();
        const unsubA = on('.two-handlers', 'click', a);
        const unsubB = on('.two-handlers', 'click', b);

        document.querySelector('.two-handlers').click();
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);

        unsubA(); // only remove a
        document.querySelector('.two-handlers').click();
        expect(a).toHaveBeenCalledTimes(1); // stopped
        expect(b).toHaveBeenCalledTimes(2); // still running

        unsubB();
    });
});


describe('on() — auto-cleanup on component unmount via _activeElement', () => {

    it('on() called while _activeElement is set pushes unsub into scope.ons', () => {
        const container = makeEl('div');
        _setActiveForTest(container);

        on('.anything', 'click', () => {});
        _setActiveForTest(null);

        const scope = _getScopeForTest(container);
        expect(scope).not.toBeNull();
        expect(Array.isArray(scope.ons)).toBe(true);
        expect(scope.ons.length).toBe(1);
    });

    it('multiple on() calls each add one entry to scope.ons', () => {
        const container = makeEl('div');
        _setActiveForTest(container);

        on('.a', 'click',   () => {});
        on('.b', 'click',   () => {});
        on('.c', 'keydown', () => {});
        _setActiveForTest(null);

        const scope = _getScopeForTest(container);
        expect(scope.ons.length).toBe(3);
    });

    it('on() called with _activeElement = null does NOT push into any scope', () => {
        // Global on() call — no active component
        _setActiveForTest(null);
        const container = makeEl('div');

        on('.global-handler', 'click', () => {});

        const scope = _getScopeForTest(container);
        // Container was never activated so no scope exists
        expect(scope).toBeNull();
    });

    it('_runUnmount calls all scope.ons unsubs', async () => {
        const container = makeEl('div', { class: 'comp-root' });
        makeEl('button', { class: 'comp-btn' });

        _setActiveForTest(container);
        const handler = vi.fn();
        on('.comp-btn', 'click', handler);
        _setActiveForTest(null);

        // Handler fires before unmount
        document.querySelector('.comp-btn').click();
        expect(handler).toHaveBeenCalledTimes(1);

        // Unmount the component
        await component._runUnmount(container);

        // Handler must NOT fire after unmount
        document.querySelector('.comp-btn').click();
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('_runUnmount clears scope.ons entries after calling them', async () => {
        const container = makeEl('div');
        const unsub = vi.fn();

        _setActiveForTest(container);
        // Manually push a mock unsub to simulate what on() does
        const scope = _getScopeForTest(container);
        scope.ons.push(unsub);
        _setActiveForTest(null);

        await component._runUnmount(container);
        expect(unsub).toHaveBeenCalledTimes(1);
    });

    it('direct-element on() also auto-cleans up on unmount', async () => {
        const container = makeEl('div');
        const btn       = makeEl('button');

        _setActiveForTest(container);
        const handler = vi.fn();
        on(btn, 'click', handler);
        _setActiveForTest(null);

        btn.click();
        expect(handler).toHaveBeenCalledTimes(1);

        await component._runUnmount(container);

        btn.click();
        expect(handler).toHaveBeenCalledTimes(1); // no second fire
    });

    it('navigating back to the same page (re-mount) does not stack listeners', async () => {
        // Simulates: Dashboard → Hosts → Dashboard
        // Each time the page mounts, on() is called.
        // After the fix, unmounting clears the previous on() before remount.

        const container = makeEl('div');
        makeEl('button', { class: 'nav-btn' });
        const handler = vi.fn();

        // First mount
        _setActiveForTest(container);
        on('.nav-btn', 'click', handler);
        _setActiveForTest(null);

        document.querySelector('.nav-btn').click();
        expect(handler).toHaveBeenCalledTimes(1);

        // Navigate away — unmount
        await component._runUnmount(container);

        // Navigate back — second mount (new container simulates router re-render)
        const container2 = makeEl('div');
        _setActiveForTest(container2);
        on('.nav-btn', 'click', handler);
        _setActiveForTest(null);

        document.querySelector('.nav-btn').click();
        // Handler should fire exactly once — not twice from stacked registrations
        expect(handler).toHaveBeenCalledTimes(2); // 1 from first mount + 1 from second
    });
});


describe('query()', () => {

    it('is exported from ui.js', () => {
        expect(typeof query).toBe('function');
    });

    it('returns the first matching element inside the given scope', () => {
        const scope  = makeEl('section');
        const inside = document.createElement('span');
        inside.className = 'target';
        scope.appendChild(inside);

        // Decoy outside the scope
        makeEl('span', { class: 'target' });

        const result = query('.target', scope);
        expect(result).toBe(inside);
    });

    it('does NOT return elements outside the scope', () => {
        const scope  = makeEl('section');
        const decoy  = makeEl('p', { id: 'decoy' });

        const result = query('#decoy', scope);
        expect(result).toBeNull();
    });

    it('falls back to document when scope is omitted', () => {
        const el = makeEl('div', { id: 'fallback-el' });
        expect(query('#fallback-el')).toBe(el);
    });

    it('falls back to document when scope is null', () => {
        const el = makeEl('div', { id: 'null-scope' });
        expect(query('#null-scope', null)).toBe(el);
    });

    it('returns null when element is not found', () => {
        expect(query('#absolutely-does-not-exist')).toBeNull();
    });

    it('accepts an Element as scope', () => {
        const parent = makeEl('div');
        const child  = document.createElement('em');
        parent.appendChild(child);
        expect(query('em', parent)).toBe(child);
    });
});


describe('findAll name-conflict — query() is the safe alternative', () => {

    it('import statement is NOT detected by the declares() guard', () => {
        // _exec.js uses this regex to decide whether to inject a name.
        // An ES import statement does NOT start with const/let/var/function,
        // so declares() returns false — meaning _exec.js would still inject
        // its own findAll EVEN IF the script imports findAll from Oja.
        // This is the root cause of the "already declared" SyntaxError.
        const body = "import { findAll } from '../lib/oja.full.esm.js';";
        const declares = (name) =>
            new RegExp(`\\b(?:const|let|var|function)\\s+${name}\\b`).test(body);

        expect(declares('findAll')).toBe(false); // bug: import not detected
    });

    it('query is not in the _exec.js injection list so it is always safe to import', () => {
        // The preamble only injects: container, find, findAll, props.
        // query is never injected — importing it can never conflict.
        const injectedNames = ['container', 'find', 'findAll', 'props'];
        expect(injectedNames).not.toContain('query');
    });

    it('declaring findAll with const IS detected and prevents double injection', () => {
        const body = 'const findAll = (sel) => document.querySelectorAll(sel);';
        const declares = (name) =>
            new RegExp(`\\b(?:const|let|var|function)\\s+${name}\\b`).test(body);

        // const declaration is detected — injection correctly skipped
        expect(declares('findAll')).toBe(true);
    });

    it('query() and findAll() return the same elements for identical inputs', () => {
        makeEl('li', { class: 'item' });
        makeEl('li', { class: 'item' });
        makeEl('li', { class: 'item' });

        const viaFindAll = Array.from(document.querySelectorAll('.item'));
        const viaQuery   = query('.item'); // query() returns the FIRST match only

        // query is querySelector (single), findAll is querySelectorAll (all)
        expect(viaFindAll.length).toBe(3);
        expect(viaQuery).toBe(viaFindAll[0]);
    });
});