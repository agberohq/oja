/**
 * tests/core/component.scoped.test.js
 *
 * Tests for the new scoped() and ref() exports.
 *
 * Both functions rely on currentContainer() from _context.js. We use
 * component._setActiveForTest() to inject a synthetic container into the
 * context stack so we can test them without going through the full mount
 * pipeline.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
    scoped,
    ref,
    _setActiveForTest,
} from '../../src/js/core/component.js';


function makeContainer(html = '') {
    const el = document.createElement('div');
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
}

afterEach(() => {
    // Clear the context stack and DOM
    _setActiveForTest(null);
    document.body.innerHTML = '';
});


describe('scoped()', () => {
    it('returns { find, findAll, el } shape', () => {
        const container = makeContainer('<span id="s">hello</span>');
        _setActiveForTest(container);

        const s = scoped();
        expect(typeof s.find).toBe('function');
        expect(typeof s.findAll).toBe('function');
        expect(s.el).toBe(container);
    });

    it('find() queries within the captured container', () => {
        const container = makeContainer('<span id="inner">yes</span>');
        _setActiveForTest(container);

        const { find } = scoped();
        expect(find('#inner')).toBe(container.querySelector('#inner'));
    });

    it('find() returns null for elements outside the container', () => {
        // Create an element outside the container
        const outside = document.createElement('div');
        outside.id = 'outside';
        document.body.appendChild(outside);

        const container = makeContainer('<span id="inner">yes</span>');
        _setActiveForTest(container);

        const { find } = scoped();
        expect(find('#outside')).toBeNull();
    });

    it('find() returns null when element not found', () => {
        const container = makeContainer('<span id="s">x</span>');
        _setActiveForTest(container);

        const { find } = scoped();
        expect(find('#nonexistent')).toBeNull();
    });

    it('findAll() returns an array of matching elements', () => {
        const container = makeContainer('<span class="item">a</span><span class="item">b</span>');
        _setActiveForTest(container);

        const { findAll } = scoped();
        const results = findAll('.item');
        expect(Array.isArray(results)).toBe(true);
        expect(results).toHaveLength(2);
    });

    it('findAll() returns empty array when no matches', () => {
        const container = makeContainer('<span>x</span>');
        _setActiveForTest(container);

        const { findAll } = scoped();
        expect(findAll('.missing')).toEqual([]);
    });

    it('captured functions remain bound after context is cleared', () => {
        const container = makeContainer('<span id="s">hello</span>');
        _setActiveForTest(container);

        const { find } = scoped(); // capture while context is active

        _setActiveForTest(null); // clear context — simulates async callback

        // find() still works because it closed over `el`, not currentContainer()
        expect(find('#s')).not.toBeNull();
        expect(find('#s').textContent).toBe('hello');
    });

    it('returns no-op when called outside a component context', () => {
        // No _setActiveForTest — no active context
        const s = scoped();
        expect(s.el).toBeNull();
        expect(s.find('#anything')).toBeNull();
        expect(s.findAll('.anything')).toEqual([]);
    });

    it('el property exposes the raw container element', () => {
        const container = makeContainer();
        _setActiveForTest(container);

        const s = scoped();
        expect(s.el).toBe(container);
    });

    it('destructuring find and findAll works correctly', () => {
        const container = makeContainer('<button id="btn">click</button>');
        _setActiveForTest(container);

        const { find, findAll } = scoped();
        expect(find('#btn').id).toBe('btn');
        expect(findAll('button')).toHaveLength(1);
    });
});


describe('ref()', () => {
    it('returns an object with an el getter', () => {
        const container = makeContainer('<span id="dot">•</span>');
        _setActiveForTest(container);

        const r = ref('#dot');
        expect(typeof r).toBe('object');
        expect(r.el).toBeDefined();
    });

    it('el returns the captured element', () => {
        const container = makeContainer('<span id="dot">•</span>');
        _setActiveForTest(container);

        const r  = ref('#dot');
        const el = container.querySelector('#dot');
        expect(r.el).toBe(el);
    });

    it('el remains accessible after context is cleared', () => {
        const container = makeContainer('<span id="dot">•</span>');
        _setActiveForTest(container);

        const r = ref('#dot'); // capture while context active

        _setActiveForTest(null); // clear — simulates async callback

        expect(r.el).not.toBeNull();
        expect(r.el.id).toBe('dot');
    });

    it('el is null when selector not found at capture time', () => {
        const container = makeContainer('<span>x</span>');
        _setActiveForTest(container);

        const r = ref('#nonexistent');
        expect(r.el).toBeNull();
    });

    it('el is null when called outside a component context with no match', () => {
        // No active context — falls back to document.querySelector
        // The element doesn't exist in document either
        const r = ref('#definitely-not-here');
        expect(r.el).toBeNull();
    });

    it('el getter always returns the same element (captured once)', () => {
        const container = makeContainer('<span id="s">x</span>');
        _setActiveForTest(container);

        const r  = ref('#s');
        const e1 = r.el;
        const e2 = r.el;
        expect(e1).toBe(e2); // same reference
    });

    it('supports modifying the captured element via el', () => {
        const container = makeContainer('<span id="s">original</span>');
        _setActiveForTest(container);

        const r = ref('#s');
        _setActiveForTest(null); // simulate async context

        r.el.textContent = 'modified';
        expect(container.querySelector('#s').textContent).toBe('modified');
    });
});
