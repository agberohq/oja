/**
 * tests/core/reactive-inspect.test.js
 *
 * Promoted from tests/bugs/005-reactive-inspect-stale.test.js after the fix.
 *
 * The defect: `_createState()` kept the live value in a closure, and `_states`
 * was written once at creation. `write()` never updated the Map entry (while
 * `_setValue()` updated only the Map), so the two copies diverged:
 *   - `window.__OJA_REACTIVE__.inspect()` reported creation-time values
 *   - Redux DevTools snapshots, JUMP_TO_STATE and RESET operated on stale data
 *     and could not actually change what `read()` returned
 *
 * Contract now enforced: the bookkeeping entry and the closure stay in sync, in
 * both directions (write() updates the entry; _setValue() writes through to the
 * closure via the stored `applyValue`).
 */

import { describe, it, expect } from 'vitest';
import { state } from '../../src/js/core/reactive.js';

const inspect  = () => window.__OJA_REACTIVE__.inspect();
const findEntry = (name) => inspect().states.find(s => s.name === name);

describe('reactive — inspect()', () => {
    it('tracks state entries by name', () => {
        state(7, 'inspect:guard');
        expect(findEntry('inspect:guard')).toBeDefined();
    });

    it('reports the current value after writes', () => {
        const [count, setCount] = state(0, 'inspect:count');

        setCount(42);

        expect(count()).toBe(42);
        expect(findEntry('inspect:count').value).toBe(42);
    });

    it('keeps the entry in sync across updater writes', () => {
        const [count, setCount] = state(1, 'inspect:updater');

        setCount(v => v + 10);
        setCount(v => v + 10);

        expect(findEntry('inspect:updater').value).toBe(21);
    });

    it('tracks object replacement', () => {
        const [obj, setObj] = state({ n: 1 }, 'inspect:object');

        setObj({ n: 2 });

        expect(obj()).toEqual({ n: 2 });
        expect(findEntry('inspect:object').value).toEqual({ n: 2 });
    });
});
