/**
 * Tests for OjaWorker options.scripts — external script loading.
 * Covers plan.md fix: importScripts injected before user function.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OjaWorker } from '../../src/js/ext/worker.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────
// The Worker shim in setup.js runs the blob source synchronously via new Function.
// importScripts() is not available in that context, so we stub it as a global
// that records calls, letting us verify injection without real network requests.

let importScriptsCalls = [];

beforeEach(() => {
    importScriptsCalls = [];
    // Inject importScripts into the global scope used by the Worker shim
    global.importScripts = (...urls) => { importScriptsCalls.push(...urls); };
});

afterEach(() => {
    delete global.importScripts;
});

// ─── scripts option ───────────────────────────────────────────────────────────

describe('OjaWorker — options.scripts', () => {
    it('calls importScripts with a single URL before the worker function', async () => {
        const w = new OjaWorker(
            (self) => { self.handle('ping', () => 'pong'); },
            { scripts: ['https://example.com/lib.js'] }
        );

        await w.call('ping');
        expect(importScriptsCalls).toContain('https://example.com/lib.js');
        w.close();
    });

    it('calls importScripts with multiple URLs in order', async () => {
        const w = new OjaWorker(
            (self) => { self.handle('ping', () => 'pong'); },
            { scripts: ['https://example.com/a.js', 'https://example.com/b.js'] }
        );

        await w.call('ping');
        expect(importScriptsCalls[0]).toBe('https://example.com/a.js');
        expect(importScriptsCalls[1]).toBe('https://example.com/b.js');
        w.close();
    });

    it('does not call importScripts when scripts option is absent', async () => {
        const w = new OjaWorker(
            (self) => { self.handle('ping', () => 'pong'); }
        );

        await w.call('ping');
        expect(importScriptsCalls).toHaveLength(0);
        w.close();
    });

    it('does not call importScripts when scripts is an empty array', async () => {
        const w = new OjaWorker(
            (self) => { self.handle('ping', () => 'pong'); },
            { scripts: [] }
        );

        await w.call('ping');
        expect(importScriptsCalls).toHaveLength(0);
        w.close();
    });

    it('scripts are loaded before the handler function body runs', async () => {
        // We simulate a library loaded by importScripts by pre-setting a global
        // that the worker function reads. In the shim, importScripts is synchronous
        // so the global will be set when the worker function runs.
        global.importScripts = (...urls) => {
            importScriptsCalls.push(...urls);
            // Simulate the library being available after importScripts
            global.__testLib = { version: '1.0' };
        };

        let libVersionInsideWorker;
        const w = new OjaWorker(
            (self) => {
                // __testLib was set by importScripts before this ran
                self.handle('getVersion', () => {
                    return typeof __testLib !== 'undefined' ? __testLib.version : 'missing';
                });
            },
            { scripts: ['https://example.com/testlib.js'] }
        );

        const version = await w.call('getVersion');
        expect(version).toBe('1.0');

        delete global.__testLib;
        w.close();
    });

    it('name option still works alongside scripts', async () => {
        const w = new OjaWorker(
            (self) => { self.handle('ping', () => 'pong'); },
            { scripts: ['https://example.com/x.js'], name: 'my-worker' }
        );

        const result = await w.call('ping');
        expect(result).toBe('pong');
        w.close();
    });
});

// ─── Existing OjaWorker behaviour unchanged ───────────────────────────────────

describe('OjaWorker — core behaviour unchanged', () => {
    it('call() resolves with handler return value', async () => {
        const w = new OjaWorker((self) => {
            self.handle('double', (n) => n * 2);
        });
        expect(await w.call('double', 5)).toBe(10);
        w.close();
    });

    it('call() rejects when handler throws', async () => {
        const w = new OjaWorker((self) => {
            self.handle('fail', () => { throw new Error('worker error'); });
        });
        await expect(w.call('fail')).rejects.toThrow('worker error');
        w.close();
    });

    it('call() rejects after close()', async () => {
        const w = new OjaWorker((self) => { self.handle('ping', () => 'pong'); });
        w.close();
        await expect(w.call('ping')).rejects.toThrow('closed');
    });
});
