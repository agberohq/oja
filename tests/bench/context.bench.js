/**
 * tests/bench/context.bench.js
 *
 * Benchmarks for the _context.js stack operations.
 *
 * These measure the raw overhead of the execution context mechanism itself —
 * push, pop, currentContainer(). Since these are called on every execScripts()
 * invocation (i.e. every component mount), they must be essentially free.
 *
 * Expected: all operations < 100ns. Any regression here means the stack
 * is doing unnecessary work at mount time.
 */

import { describe, bench } from 'vitest';
import {
    pushContainer,
    popContainer,
    currentContainer,
    _getProps,
    _setReadyFn,
    _getReadyFn,
} from '../../src/js/core/_context.js';

const el = document.createElement('div');

// Stack operations

describe('_context — stack push/pop', () => {
    bench('pushContainer + popContainer (empty props)', () => {
        pushContainer(el);
        popContainer();
    });

    bench('pushContainer + popContainer (with props object)', () => {
        pushContainer(el, { title: 'Test', count: 42, active: true });
        popContainer();
    });

    bench('currentContainer() — stack depth 1', () => {
        pushContainer(el);
        const c = currentContainer();
        popContainer();
        return c;
    });

    bench('currentContainer() — empty stack (null path)', () => {
        currentContainer();
    });
});

// Props lookup

describe('_context — props lookup', () => {
    const props = { title: 'Note', tags: ['a', 'b'], count: 99 };

    bench('_getProps() — depth 1 stack', () => {
        pushContainer(el, props);
        const p = _getProps(el);
        popContainer();
        return p;
    });

    bench('_getProps() — depth 5 stack (nested components)', () => {
        const containers = Array.from({ length: 5 }, () => document.createElement('div'));
        containers.forEach((c, i) => pushContainer(c, { depth: i }));
        const p = _getProps(containers[0]); // deepest search
        containers.forEach(() => popContainer());
        return p;
    });
});

// Ready fn bridge

describe('_context — ready fn set/get', () => {
    const noop = () => {};

    bench('_setReadyFn + _getReadyFn', () => {
        _setReadyFn(el, noop);
        return _getReadyFn(el);
    });
});

// Nested mount simulation
// Simulates what happens when a layout mounts 5 slots in parallel.
// Each slot calls pushContainer/popContainer around its script execution.

describe('_context — parallel slot mount simulation', () => {
    const slots = Array.from({ length: 5 }, () => document.createElement('div'));

    bench('5 sequential push+pop cycles (slot mount pattern)', () => {
        for (const slot of slots) {
            pushContainer(slot, { name: 'slot' });
            currentContainer(); // find() would call this
            popContainer();
        }
    });
});
