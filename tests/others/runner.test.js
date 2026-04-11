import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Runner } from '../../src/js/ext/runner.js';

// Runner uses real Worker — jsdom supports them via vitest's jsdom environment.
// Each test creates and closes its own Runner to avoid state leakage.

// Simple echo worker used across tests
function echoWorker(self) {
    self.on('echo', (data) => {
        return data;
    });

    self.on('shout', (data) => {
        self.reply('shouted', { msg: (data.msg || '').toUpperCase() });
    });

    self.on('slow', async (data) => {
        await new Promise(r => setTimeout(r, data.ms || 50));
        return { done: true };
    });

    self.on('fail', () => {
        throw new Error('intentional worker error');
    });
}

describe('Runner — construction', () => {
    it('throws when workerFn is not a function', () => {
        expect(() => new Runner('not a function')).toThrow('[oja/runner] workerFn must be a function');
    });

    it('creates a runner and is not closed', () => {
        const runner = new Runner(echoWorker);
        expect(runner.closed).toBe(false);
        runner.close();
    });
});

describe('Runner — send()', () => {
    let runner;
    beforeEach(() => { runner = new Runner(echoWorker); });
    afterEach(() => runner.close());

    it('sends without throwing — fire and forget', () => {
        expect(() => runner.send('echo', { x: 1 })).not.toThrow();
    });

    it('throws when runner is closed', () => {
        runner.close();
        expect(() => runner.send('echo', {})).toThrow('[oja/runner] Runner is closed');
    });
});

describe('Runner — post()', () => {
    let runner;
    beforeEach(() => { runner = new Runner(echoWorker); });
    afterEach(() => runner.close());

    it('resolves when worker receives the message', async () => {
        await expect(runner.post('echo', { x: 1 })).resolves.toBeUndefined();
    });

    it('resolves before slow handler finishes', async () => {
        const start = Date.now();
        await runner.post('slow', { ms: 80 });
        // post() resolves on receipt — should be much faster than 80ms
        expect(Date.now() - start).toBeLessThan(60);
    });

    it('rejects when runner is closed before resolving', async () => {
        const p = runner.post('slow', { ms: 200 });
        runner.close();
        await expect(p).rejects.toThrow();
    });
});

describe('Runner — request()', () => {
    let runner;
    beforeEach(() => { runner = new Runner(echoWorker); });
    afterEach(() => { if (!runner.closed) runner.close(); });

    it('returns data from the handler', async () => {
        const result = await runner.request('echo', { hello: 'world' });
        expect(result).toEqual({ hello: 'world' });
    });

    it('rejects when the handler throws', async () => {
        await expect(runner.request('fail')).rejects.toThrow('intentional worker error');
    });

    it('rejects for unknown message types', async () => {
        await expect(runner.request('nonexistent')).rejects.toThrow('No handler for: nonexistent');
    });

    it('handles concurrent requests independently', async () => {
        const [a, b, c] = await Promise.all([
            runner.request('echo', { n: 1 }),
            runner.request('echo', { n: 2 }),
            runner.request('echo', { n: 3 }),
        ]);
        expect(a).toEqual({ n: 1 });
        expect(b).toEqual({ n: 2 });
        expect(c).toEqual({ n: 3 });
    });
});

describe('Runner — on() events', () => {
    let runner;
    beforeEach(() => { runner = new Runner(echoWorker); });
    afterEach(() => { if (!runner.closed) runner.close(); });

    it('receives events emitted by self.reply()', async () => {
        const received = [];
        runner.on('shouted', (data) => received.push(data));

        runner.send('shout', { msg: 'hello' });
        await new Promise(r => setTimeout(r, 50));

        expect(received).toHaveLength(1);
        expect(received[0].msg).toBe('HELLO');
    });

    it('on() returns an unsubscribe function', async () => {
        const received = [];
        const off = runner.on('shouted', (data) => received.push(data));

        runner.send('shout', { msg: 'first' });
        await new Promise(r => setTimeout(r, 50));

        off();
        runner.send('shout', { msg: 'second' });
        await new Promise(r => setTimeout(r, 50));

        expect(received).toHaveLength(1);
        expect(received[0].msg).toBe('FIRST');
    });
});

describe('Runner — close()', () => {
    it('close() is idempotent — calling twice does not throw', () => {
        const runner = new Runner(echoWorker);
        runner.close();
        expect(() => runner.close()).not.toThrow();
    });

    it('marks runner as closed', () => {
        const runner = new Runner(echoWorker);
        runner.close();
        expect(runner.closed).toBe(true);
    });

    it('rejects pending requests on close', async () => {
        const runner = new Runner(echoWorker);
        const p = runner.request('slow', { ms: 500 });
        runner.close();
        await expect(p).rejects.toThrow();
    });
});