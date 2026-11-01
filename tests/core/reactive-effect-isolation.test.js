/**
 * tests/core/reactive-effect-isolation.test.js
 *
 * Promoted from tests/bugs/004-reactive-effect-isolation.test.js after the fix.
 *
 * The defect: `_flush()` incremented `_flushDepth` without a `finally`, and ran
 * effects without a per-effect try/catch. Consequences:
 *   - one throwing effect leaked the depth counter permanently;
 *   - effects queued after it in the same flush never ran;
 *   - the error escaped into an unhandled microtask (window.onerror) instead of
 *     reaching runtime.reportError();
 *   - when the MAX_FLUSH_DEPTH guard eventually tripped, it silently discarded
 *     the whole pending queue.
 *
 * Contract now enforced:
 *   1. flush failures are reported through `runtime.reportError(err, source)`
 *   2. later effects in the same flush still run
 *   3. `_flushDepth` returns to 0
 *   4. `batch()` does not rethrow — the scheduler isolates the failure
 *   5. with no error hook registered, the failure is logged (never silent)
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { state, effect, batch }  from '../../src/js/core/reactive.js';
import { runtime }              from '../../src/js/core/runtime.js';

const inspect = () => window.__OJA_REACTIVE__.inspect();

afterEach(() => {
    runtime.destroy();
    vi.restoreAllMocks();
});

describe('reactive — effect error isolation', () => {
    it('a throwing effect is reported and does not starve later effects', () => {
        const reported = [];
        runtime.onError((err, source) => reported.push({ err, source }));

        const [a, setA] = state(0, 'effect-isolation:a');
        const [b, setB] = state(0, 'effect-isolation:b');

        let goodRuns = 0;
        let caught   = null;

        // Registered first → enters the flush queue first.
        const disposeBad = effect(() => {
            if (a() > 0) throw new Error('boom');
        });

        const disposeGood = effect(() => {
            b();
            goodRuns++;
        });

        try {
            batch(() => { setA(1); setB(1); });
        } catch (e) {
            caught = e;
        } finally {
            disposeBad();
            disposeGood();
        }

        expect(reported.map(r => r.err.message)).toContain('boom');
        expect(reported[0]?.source).toMatch(/^reactive:/);
        expect(caught).toBeNull();
        expect(goodRuns).toBe(2);
        expect(inspect().flushDepth).toBe(0);
    });

    it('logs through console.error when no runtime error hook is registered', () => {
        runtime.destroy();                       // ensure no hooks
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const [a, setA] = state(0, 'effect-isolation:log');
        const dispose = effect(() => {
            if (a() > 0) throw new Error('logged-boom');
        });

        batch(() => setA(1));
        dispose();

        expect(spy).toHaveBeenCalled();
        expect(String(spy.mock.calls[0][0])).toContain('reactive:effect');
        expect(inspect().flushDepth).toBe(0);
    });

    it('runtime.reportError returns the number of hooks notified', () => {
        runtime.destroy();
        expect(runtime.reportError(new Error('nobody'), 'test')).toBe(0);

        runtime.onError(() => {});
        expect(runtime.reportError(new Error('one'), 'test')).toBe(1);

        runtime.onError(() => {});
        expect(runtime.reportError(new Error('two'), 'test')).toBe(2);
    });
});
