/**
 * tests/bench/engine.bench.js
 *
 * Benchmarks for engine.list() — the DOM reconciler.
 *
 * Groups:
 *   initial render      — cold mount: N items from empty container.
 *   single update       — 1 item changed in a pre-populated list of N.
 *   full replace        — all keys change; worst-case churn.
 *   append / delete     — add or remove one item.
 *   reorder             — same keys, different order.
 *
 * Diagnostic: update 1 of 100 vs update 1 of 1000 shows whether the
 * Map lookup + _reorderChildren scale sublinearly (they should).
 */

import { describe, bench, beforeEach } from 'vitest';
import { list } from '../../src/js/core/engine.js';

function makeItems(n, offset = 0) {
    return Array.from({ length: n }, (_, i) => ({
        id:    `item-${i + offset}`,
        label: `Item ${i + offset}`,
        value: i + offset,
    }));
}

const OPTIONS = {
    key:    item => item.id,
    render: (item, existing) => {
        const el = existing ?? document.createElement('li');
        el.textContent = item.label;
        return el;
    },
};

// Initial render
// Each bench gets a dedicated container via beforeEach — all start empty.
// Container is NOT cleared inside the bench body so vitest's warmup iterations
// don't contaminate the measurement. Each iteration re-renders from the same
// pre-populated state (list() on an already-populated list = update, not cold).
// To measure cold: beforeEach provides a fresh empty container each iteration.

describe('engine.list() — initial render', () => {
    let c10, c100, c1000;

    beforeEach(() => {
        document.body.innerHTML = '';
        c10   = Object.assign(document.createElement('ul'), { id: 'c10' });
        c100  = Object.assign(document.createElement('ul'), { id: 'c100' });
        c1000 = Object.assign(document.createElement('ul'), { id: 'c1000' });
        document.body.append(c10, c100, c1000);
    });

    bench('render 10 items (cold)', () => {
        c10.innerHTML = '';
        list(c10, makeItems(10), OPTIONS);
    });

    bench('render 100 items (cold)', () => {
        c100.innerHTML = '';
        list(c100, makeItems(100), OPTIONS);
    });

    bench('render 1000 items (cold)', () => {
        c1000.innerHTML = '';
        list(c1000, makeItems(1000), OPTIONS);
    });
});

// Single item update — 100 items

describe('engine.list() — single item changed (100 items)', () => {
    let container;
    const base    = makeItems(100);
    const updated = base.map((item, i) => i === 50 ? { ...item, label: 'Changed' } : item);

    beforeEach(() => {
        document.body.innerHTML = '';
        container = document.createElement('ul');
        document.body.appendChild(container);
        list(container, base, OPTIONS);
    });

    bench('update 1 of 100 items', () => {
        list(container, updated, OPTIONS);
        list(container, base, OPTIONS);
    });
});

// Single item update — 1000 items

describe('engine.list() — single item changed (1000 items)', () => {
    let container;
    const base    = makeItems(1000);
    const updated = base.map((item, i) => i === 500 ? { ...item, label: 'Changed' } : item);

    beforeEach(() => {
        document.body.innerHTML = '';
        container = document.createElement('ul');
        document.body.appendChild(container);
        list(container, base, OPTIONS);
    });

    bench('update 1 of 1000 items', () => {
        list(container, updated, OPTIONS);
        list(container, base, OPTIONS);
    });
});

// Full key replace

describe('engine.list() — full key churn (100 items)', () => {
    let container;
    const base    = makeItems(100);
    const replace = makeItems(100, 100);

    beforeEach(() => {
        document.body.innerHTML = '';
        container = document.createElement('ul');
        document.body.appendChild(container);
        list(container, base, OPTIONS);
    });

    bench('replace all 100 keys', () => {
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
        container = document.createElement('ul');
        document.body.appendChild(container);
        list(container, base, OPTIONS);
    });

    bench('append 1 item to list of 99', () => {
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
        container = document.createElement('ul');
        document.body.appendChild(container);
        list(container, base, OPTIONS);
    });

    bench('remove 1 item from middle of 100', () => {
        list(container, without, OPTIONS);
        list(container, base, OPTIONS);
    });
});

// Reorder

describe('engine.list() — reorder (100 items)', () => {
    let container;
    const base     = makeItems(100);
    const reversed = [...base].reverse();
    const rotated  = [...base.slice(1), base[0]];

    beforeEach(() => {
        document.body.innerHTML = '';
        container = document.createElement('ul');
        document.body.appendChild(container);
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
