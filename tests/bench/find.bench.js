/**
 * tests/bench/find.bench.js
 *
 * Benchmarks for find() with the new context-stack scope.
 *
 * Groups:
 *   baseline    — raw querySelector for reference.
 *   in context  — find() with stack depth 1 (normal component execution).
 *   no context  — find() outside a component; falls back to document.
 *   scope opt   — explicit scope= bypasses stack read entirely.
 *   miss        — element not found; _warnMiss path cost.
 *   stack depth — verifies currentContainer() is O(1) at depth 10.
 *
 * Key comparison: find() vs container.querySelector should be within ~50ns.
 * The stack read is _stack.at(-1) — one array access.
 * _renderable() adds one WeakMap lookup per element on first call.
 */

import { describe, bench, beforeEach, afterEach } from 'vitest';
import { find, findAll }               from '../../src/js/core/ui.js';
import { pushContainer, popContainer } from '../../src/js/core/_context.js';

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
        <input id="search" type="text">
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

// find() inside component context (stack depth 1)
// Context is pushed in beforeEach and popped in afterEach — bench body is pure find().

describe('find() inside context (stack depth 1)', () => {
    beforeEach(() => { setup(); pushContainer(container); });
    afterEach(() => popContainer());

    bench('find() by id', () => {
        find('#save-btn');
    });

    bench('find() by class', () => {
        find('.btn');
    });

    bench('findAll() .item — 50 results', () => {
        findAll('.item');
    });
});

// find() outside context

describe('find() outside context (empty stack)', () => {
    beforeEach(setup);

    bench('find() by id — document fallback', () => {
        find('#save-btn');
    });
});

// find() with explicit scope option

describe('find() with explicit scope option', () => {
    beforeEach(setup);

    bench('find() with scope option (bypasses stack)', () => {
        find('#save-btn', { scope: container });
    });
});

// find() miss

describe('find() — element not found', () => {
    beforeEach(setup);

    bench('find() miss — element does not exist', () => {
        find('#nonexistent-element-404');
    });
});

// Stack depth scaling
// currentContainer() is _stack.at(-1) — should be O(1) regardless of depth.

describe('find() — stack depth scaling', () => {
    beforeEach(() => {
        setup();
        for (let i = 0; i < 10; i++) pushContainer(container);
    });
    afterEach(() => {
        for (let i = 0; i < 10; i++) popContainer();
    });

    bench('find() at stack depth 10', () => {
        find('#save-btn');
    });
});
