/**
 * tests/bench/reactive.bench.js
 *
 * Benchmarks for the reactive system hot paths.
 *
 * What each group measures and why it matters:
 *
 *   state read          — raw signal read cost; called on every render pass.
 *   state write         — write + subscriber notification; every user action.
 *   effect (N deps)     — re-run cost as fan-out grows; critical for large lists.
 *   derived chain       — propagation through a computed dependency chain.
 *   batch (N writes)    — cost of flushing N state changes as one atomic update.
 *   effect setup        — registration cost; paid once at mount time.
 *   effect dispose      — cleanup cost; paid on unmount.
 *
 * Numbers to watch when optimising:
 *   - state read should be < 1µs (it's called thousands of times per frame)
 *   - batch(100 writes) should not be 100× slower than batch(1 write)
 *   - effect fan-out: 1000 subscribers should be < 10× slower than 10
 */

import { describe, bench, beforeEach } from 'vitest';
import { state, effect, derived, batch } from '../../src/js/core/reactive.js';

// State read

describe('reactive — state read', () => {
    const [count] = state(0);

    bench('read a signal 1× per iteration', () => {
        count();
    });

    bench('read a signal 100× per iteration', () => {
        for (let i = 0; i < 100; i++) count();
    });
});

// State write

describe('reactive — state write (no subscribers)', () => {
    const [, setCount] = state(0);

    bench('write with no subscribers', () => {
        setCount(1);
    });
});

describe('reactive — state write (with subscribers)', () => {
    let setValue;

    beforeEach(() => {
        const [val, set] = state(0);
        setValue = set;

        // Register 10 effects that depend on this state
        for (let i = 0; i < 10; i++) {
            effect(() => { val(); });
        }
    });

    bench('write with 10 subscribers', async () => {
        setValue(v => (v ?? 0) + 1);
        // Flush is async (queueMicrotask) — await one tick
        await Promise.resolve();
    });
});

// Effect fan-out
// Measures how write cost scales with subscriber count.
// The ratio between N=10 and N=1000 reveals whether the scheduler is O(N).

describe('reactive — effect fan-out scaling', () => {
    function makeFanOut(n) {
        const [val, set] = state(0);
        for (let i = 0; i < n; i++) effect(() => { val(); });
        return set;
    }

    const set10   = makeFanOut(10);
    const set100  = makeFanOut(100);
    const set1000 = makeFanOut(1000);

    bench('write → 10 subscribers', async () => {
        set10(v => (v ?? 0) + 1);
        await Promise.resolve();
    });

    bench('write → 100 subscribers', async () => {
        set100(v => (v ?? 0) + 1);
        await Promise.resolve();
    });

    bench('write → 1000 subscribers', async () => {
        set1000(v => (v ?? 0) + 1);
        await Promise.resolve();
    });
});

// Derived chain
// A → B → C → D propagation. Each derived depends on the previous.
// Measures whether each step in the chain is paid or deduped.

describe('reactive — derived chain propagation', () => {
    const [a, setA] = state(0);
    const b = derived(() => a() * 2);
    const c = derived(() => b() + 1);
    const d = derived(() => c() * c());

    // One effect consuming the tail — ensures the chain actually runs
    effect(() => { d(); });

    bench('write to root of 3-step derived chain', async () => {
        setA(v => (v ?? 0) + 1);
        await Promise.resolve();
    });
});

// Batch writes
// batch() should collapse N writes into one flush.
// If batch(100) ≈ batch(1), the deduplication is working.

describe('reactive — batch write collapse', () => {
    const signals = Array.from({ length: 100 }, () => state(0));

    bench('batch 1 write', () => {
        batch(() => { signals[0][1](1); });
    });

    bench('batch 10 writes', () => {
        batch(() => {
            for (let i = 0; i < 10; i++) signals[i][1](i);
        });
    });

    bench('batch 100 writes', () => {
        batch(() => {
            for (let i = 0; i < 100; i++) signals[i][1](i);
        });
    });
});

// Effect lifecycle
// Registration and disposal cost — paid at mount/unmount time.
// Should be cheap enough that components with 20+ effects start fast.

describe('reactive — effect registration and disposal', () => {
    const [val] = state(0);

    bench('register + immediately dispose 1 effect', () => {
        const dispose = effect(() => { val(); });
        dispose();
    });

    bench('register + immediately dispose 10 effects', () => {
        const disposers = Array.from({ length: 10 }, () => effect(() => { val(); }));
        disposers.forEach(d => d());
    });
});
