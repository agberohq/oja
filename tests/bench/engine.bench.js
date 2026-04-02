/**
 * tests/bench/engine.bench.js
 *
 * Benchmarks for engine.list() — the DOM reconciler.
 * This is the hottest path in the sidebar note list and any reactive list.
 *
 * What each group measures:
 *
 *   initial render      — cold mount: N items, all new keys.
 *   single update       — 1 item changed in a list of N; the common case.
 *   full replace        — all items changed; worst-case key churn.
 *   append              — 1 new item appended to list of N; e.g. new note created.
 *   delete one          — 1 item removed from list of N.
 *   reorder             — same items, shuffled key order; tests _reorderChildren.
 *
 * The key question: does list(1000 items, 1 change) approach list(1 item)?
 * If not, the Map lookup or _reorderChildren is doing unnecessary work.
 */

import { describe, bench, beforeEach } from 'vitest';
import { list } from '../../src/js/core/engine.js';

// Helpers

function makeItems(n, offset = 0) {
    return Array.from({ length: n }, (_, i) => ({
        id:    `item-${i + offset}`,
        label: `Item ${i + offset}`,
        value: i + offset,
    }));
}

function makeContainer() {
    const el = document.createElement('ul');
    document.body.appendChild(el);
    return el;
}

const OPTIONS = {
    key:    item => item.id,
    render: (item, existing) => {
        const el = existing ?? document.createElement('li');
        el.textContent = item.label;
        return el;
    },
};

// Initial render (cold mount)

describe('engine.list() — initial render', () => {
    let container;
    beforeEach(() => {
        document.body.innerHTML = '';
        container = makeContainer();
    });

    bench('render 10 items (cold)', () => {
        list(container, makeItems(10), OPTIONS);
    });

    bench('render 100 items (cold)', () => {
        list(container, makeItems(100), OPTIONS);
    });

    bench('render 1000 items (cold)', () => {
        list(container, makeItems(1000), OPTIONS);
    });
});

// Single item update
// The most common real-world case: one note's title changes, list re-renders.

describe('engine.list() — single item changed', () => {
    let container;
    let items100, items1000;

    beforeEach(() => {
        document.body.innerHTML = '';
        container = makeContainer();

        items100  = makeItems(100);
        items1000 = makeItems(1000);

        // Pre-populate so the bench measures update, not initial render
        list(container, items100,  OPTIONS);
    });

    bench('update 1 of 100 items', () => {
        const updated = [...items100];
        updated[50] = { ...updated[50], label: 'Changed' };
        list(container, updated, OPTIONS);
    });

    bench('update 1 of 1000 items', () => {
        document.body.innerHTML = '';
        container = makeContainer();
        list(container, items1000, OPTIONS);
        const updated = [...items1000];
        updated[500] = { ...updated[500], label: 'Changed' };
        list(container, updated, OPTIONS);
    });
});

// Full key replace
// All keys change — every element is created fresh. Tests remove + create path.

describe('engine.list() — full key churn', () => {
    let container;

    beforeEach(() => {
        document.body.innerHTML = '';
        container = makeContainer();
        list(container, makeItems(100), OPTIONS);
    });

    bench('replace all 100 keys with new keys', () => {
        list(container, makeItems(100, 100), OPTIONS);
        // Reset for next iteration
        list(container, makeItems(100), OPTIONS);
    });
});

// Append

describe('engine.list() — append one item', () => {
    let container;
    let base;

    beforeEach(() => {
        document.body.innerHTML = '';
        container = makeContainer();
        base = makeItems(99);
        list(container, base, OPTIONS);
    });

    bench('append 1 item to list of 99 (→ 100)', () => {
        list(container, [...base, { id: 'item-99', label: 'Item 99', value: 99 }], OPTIONS);
        list(container, base, OPTIONS);
    });
});

// Delete one

describe('engine.list() — delete one item', () => {
    let container;
    let base;

    beforeEach(() => {
        document.body.innerHTML = '';
        container = makeContainer();
        base = makeItems(100);
        list(container, base, OPTIONS);
    });

    bench('remove 1 item from middle of 100', () => {
        const without = base.filter((_, i) => i !== 50);
        list(container, without, OPTIONS);
        list(container, base, OPTIONS);
    });
});

// Reorder
// Same keys, different order. Tests _reorderChildren's insertBefore path.

describe('engine.list() — reorder', () => {
    let container;
    let base;

    beforeEach(() => {
        document.body.innerHTML = '';
        container = makeContainer();
        base = makeItems(100);
        list(container, base, OPTIONS);
    });

    bench('reverse 100 items (worst-case reorder)', () => {
        list(container, [...base].reverse(), OPTIONS);
        list(container, base, OPTIONS);
    });

    bench('move first item to end (common reorder)', () => {
        list(container, [...base.slice(1), base[0]], OPTIONS);
        list(container, base, OPTIONS);
    });
});
