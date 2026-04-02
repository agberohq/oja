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
 *   append              — 1 new item appended to list of N.
 *   delete one          — 1 item removed from list of N.
 *   reorder             — same items, shuffled key order; tests _reorderChildren.
 *
 * Key diagnostic: does list(1000 items, 1 change) approach list(1 item, 1 change)?
 * The Map lookup is O(1) and _reorderChildren touches only moved nodes,
 * so the 1000-item case should be within 2–3× of the 100-item case.
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
        container.innerHTML = '';
        list(container, makeItems(10), OPTIONS);
    });

    bench('render 100 items (cold)', () => {
        container.innerHTML = '';
        list(container, makeItems(100), OPTIONS);
    });

    bench('render 1000 items (cold)', () => {
        container.innerHTML = '';
        list(container, makeItems(1000), OPTIONS);
    });
});

// Single item update — 100 items

describe('engine.list() — single item changed (100 items)', () => {
    let container;
    let items;

    beforeEach(() => {
        document.body.innerHTML = '';
        container = makeContainer();
        items = makeItems(100);
        list(container, items, OPTIONS); // pre-populate
    });

    bench('update 1 of 100 items', () => {
        const updated = [...items];
        updated[50] = { ...updated[50], label: 'Changed' };
        list(container, updated, OPTIONS);
        // reset so next iteration starts from the same state
        list(container, items, OPTIONS);
    });
});

// Single item update — 1000 items

describe('engine.list() — single item changed (1000 items)', () => {
    let container;
    let items;

    beforeEach(() => {
        document.body.innerHTML = '';
        container = makeContainer();
        items = makeItems(1000);
        list(container, items, OPTIONS); // pre-populate
    });

    bench('update 1 of 1000 items', () => {
        const updated = [...items];
        updated[500] = { ...updated[500], label: 'Changed' };
        list(container, updated, OPTIONS);
        list(container, items, OPTIONS);
    });
});

// Full key replace

describe('engine.list() — full key churn', () => {
    let container;
    const base    = makeItems(100);
    const replace = makeItems(100, 100);

    beforeEach(() => {
        document.body.innerHTML = '';
        container = makeContainer();
        list(container, base, OPTIONS);
    });

    bench('replace all 100 keys with new keys', () => {
        list(container, replace, OPTIONS);
        list(container, base, OPTIONS);
    });
});

// Append

describe('engine.list() — append one item', () => {
    let container;
    const base    = makeItems(99);
    const withNew = [...base, { id: 'item-99', label: 'Item 99', value: 99 }];

    beforeEach(() => {
        document.body.innerHTML = '';
        container = makeContainer();
        list(container, base, OPTIONS);
    });

    bench('append 1 item to list of 99 (→ 100)', () => {
        list(container, withNew, OPTIONS);
        list(container, base, OPTIONS);
    });
});

// Delete one

describe('engine.list() — delete one item', () => {
    let container;
    const base    = makeItems(100);
    const without = base.filter((_, i) => i !== 50);

    beforeEach(() => {
        document.body.innerHTML = '';
        container = makeContainer();
        list(container, base, OPTIONS);
    });

    bench('remove 1 item from middle of 100', () => {
        list(container, without, OPTIONS);
        list(container, base, OPTIONS);
    });
});

// Reorder

describe('engine.list() — reorder', () => {
    let container;
    const base     = makeItems(100);
    const reversed = [...base].reverse();
    const rotated  = [...base.slice(1), base[0]];

    beforeEach(() => {
        document.body.innerHTML = '';
        container = makeContainer();
        list(container, base, OPTIONS);
    });

    bench('reverse 100 items (worst-case reorder)', () => {
        list(container, reversed, OPTIONS);
        list(container, base, OPTIONS);
    });

    bench('move first item to end (common reorder)', () => {
        list(container, rotated, OPTIONS);
        list(container, base, OPTIONS);
    });
});
