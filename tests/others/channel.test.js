import { describe, it, expect } from 'vitest';
import { Channel, go } from '../../src/js/ext/channel.js';

// ─── Channel — basic send / receive ───────────────────────────────────────────

describe('Channel — unbuffered', () => {
    it('send and receive transfer a value', async () => {
        const ch = new Channel(0);

        const received = ch.receive();
        await ch.send('hello');
        const { value, ok } = await received;

        expect(value).toBe('hello');
        expect(ok).toBe(true);
    });

    it('receive returns ok:false after close with empty buffer', async () => {
        const ch = new Channel(0);
        ch.close();
        const { ok } = await ch.receive();
        expect(ok).toBe(false);
    });

    it('send on a closed channel throws', async () => {
        const ch = new Channel(0);
        ch.close();
        await expect(ch.send('x')).rejects.toThrow('closed channel');
    });
});

describe('Channel — buffered', () => {
    it('send does not block when buffer has space', async () => {
        const ch = new Channel(2);
        await ch.send('a');
        await ch.send('b');

        const r1 = await ch.receive();
        const r2 = await ch.receive();

        expect(r1.value).toBe('a');
        expect(r2.value).toBe('b');
    });

    it('drains buffer before returning ok:false after close', async () => {
        const ch = new Channel(1);
        await ch.send('last');
        ch.close();

        const { value, ok } = await ch.receive();
        expect(value).toBe('last');
        expect(ok).toBe(true);

        const closed = await ch.receive();
        expect(closed.ok).toBe(false);
    });
});

// ─── async iteration ──────────────────────────────────────────────────────────

describe('Channel — async iteration', () => {
    it('for-await collects all sent values and stops on close', async () => {
        const ch = new Channel(3);
        await ch.send(1);
        await ch.send(2);
        await ch.send(3);
        ch.close();

        const results = [];
        for await (const val of ch) {
            results.push(val);
        }

        expect(results).toEqual([1, 2, 3]);
    });
});

// ─── go ───────────────────────────────────────────────────────────────────────

describe('go()', () => {
    it('runs the async function as a fire-and-forget goroutine', async () => {
        let ran = false;
        go(async () => { ran = true; });
        // go() schedules via Promise.resolve().then() — flush one tick
        await Promise.resolve();
        expect(ran).toBe(true);
    });

    it('can consume a channel as a goroutine', async () => {
        const ch      = new Channel(2);
        const results = [];
        let   done    = false;

        go(async () => {
            for await (const val of ch) {
                results.push(val);
            }
            done = true;
        });

        await ch.send('x');
        await ch.send('y');
        ch.close();

        // Drain microtasks until the goroutine finishes
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(results).toEqual(['x', 'y']);
        expect(done).toBe(true);
    });
});