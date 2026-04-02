/**
 * tests/bench/find.bench.js
 *
 * Benchmarks for find() — now reads from the _context stack.
 *
 * What we're measuring:
 *
 *   baseline querySelector  — raw DOM cost with no Oja overhead.
 *   find() inside context   — stack read + querySelector + _renderable().
 *   find() outside context  — falls back to document; no stack overhead.
 *   find() with scope opt   — explicit scope bypasses stack entirely.
 *   find() miss             — element not found; _warnMiss path.
 *   findAll()               — querySelectorAll variant.
 *
 * The overhead of the stack read (currentContainer()) should be
 * a single array `.at(-1)` call — effectively zero cost.
 * The _renderable() enhancement adds one WeakMap lookup per element.
 * If find() is > 2× slower than querySelector, something is wrong.
 */

import { describe, bench, beforeEach } from 'vitest';
import { find, findAll }        from '../../src/js/core/ui.js';
import { pushContainer, popContainer } from '../../src/js/core/_context.js';

// Setup

let container;

function setup() {
    document.body.innerHTML = '';
    container = document.createElement('div');
    container.innerHTML = `
        <ul id="list">
            ${Array.from({ length: 50 }, (_, i) =>
                `<li class="item" data-id="${i}"><span class="label">Item ${i}</span></li>`
            ).join('')}
        </ul>
        <button id="save-btn" class="btn primary">Save</button>
        <input id="search" type="text" placeholder="Search…">
    `;
    document.body.appendChild(container);
}

// Baseline — raw querySelector

describe('find() baseline — raw DOM', () => {
    beforeEach(setup);

    bench('document.querySelector by id', () => {
        document.querySelector('#save-btn');
    });

    bench('container.querySelector by id', () => {
        container.querySelector('#save-btn');
    });

    bench('document.querySelectorAll .item (50 nodes)', () => {
        document.querySelectorAll('.item');
    });
});

// find() inside component context
// Stack has one entry — the common case during component script execution.

describe('find() inside context (stack depth 1)', () => {
    beforeEach(() => {
        setup();
        pushContainer(container);
    });

    // afterEach equivalent via bench — pop after each group
    // (vitest bench doesn't support afterEach, so we pop at the start of each bench)

    bench('find() by id — hit', () => {
        const el = find('#save-btn');
        popContainer();
        pushContainer(container);
        return el;
    });

    bench('find() by class — hit', () => {
        const el = find('.btn');
        popContainer();
        pushContainer(container);
        return el;
    });

    bench('findAll() .item — 50 results', () => {
        const els = findAll('.item');
        popContainer();
        pushContainer(container);
        return els;
    });
});

// find() outside context
// Stack is empty — falls back to document. Tests the null-stack path.

describe('find() outside context (empty stack)', () => {
    beforeEach(setup);

    bench('find() by id — document fallback', () => {
        find('#save-btn');
    });
});

// find() with explicit scope
// options.scope bypasses the stack entirely.

describe('find() with explicit scope option', () => {
    beforeEach(setup);

    bench('find() with scope option (bypasses stack)', () => {
        find('#save-btn', { scope: container });
    });
});

// find() miss
// Element not found — tests the _warnMiss path.

describe('find() — element not found', () => {
    beforeEach(setup);

    bench('find() miss — element does not exist', () => {
        find('#nonexistent-element-that-does-not-exist');
    });
});

// Stack depth scaling
// currentContainer() is _stack.at(-1). This should be O(1) regardless of depth.

describe('find() — stack depth scaling', () => {
    beforeEach(() => {
        setup();
        // Push nested containers (simulates nested component trees)
        for (let i = 0; i < 10; i++) pushContainer(container);
    });

    bench('find() at stack depth 10', () => {
        const el = find('#save-btn');
        return el;
    });
});
