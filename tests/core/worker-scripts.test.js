/**
 * Tests for OjaWorker options.scripts
 *
 * Root cause of previous failures:
 *   WORKER_BOOTSTRAP used `self.onmessage = async (e) => {...}`
 *   The WorkerShim captures a bare local `let onmessage` variable.
 *   `self.onmessage` sets on globalThis — shadowed by the local `let onmessage`.
 *   Result: __capture__(onmessage) captured undefined, no messages were handled.
 *
 * Fix applied to worker.js:
 *   Changed to `onmessage = self.onmessage = async (e) => {...}`
 *   Now both the local variable (for the shim) and self.onmessage (for real Workers)
 *   are assigned, making OjaWorker work correctly in both environments.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OjaWorker } from '../../src/js/ext/worker.js';

// ─── importScripts shim ───────────────────────────────────────────────────────
// In real Workers, importScripts() is a global function.
// In the WorkerShim, the worker source runs via new Function() in the global scope,
// so globalThis.importScripts is accessible as a bare call.

let importScriptsCalls = [];

beforeEach(() => {
    importScriptsCalls = [];
    globalThis.importScripts = (...urls) => { importScriptsCalls.push(...urls); };
});

afterEach(() => {
    delete globalThis.importScripts;
    vi.restoreAllMocks();
});

// ─── scripts injection ────────────────────────────────────────────────────────

describe('OjaWorker — options.scripts', () => {
    it('calls importScripts with a single URL before handler runs', async () => {
        const w = new OjaWorker(
            (self) => { self.handle('ping', () => 'pong'); },
            { scripts: ['https://example.com/lib.js'] }
        );
        await w.call('ping');
        expect(importScriptsCalls).toContain('https://example.com/lib.js');
        w.close();
    });

    it('calls importScripts with multiple URLs in the correct order', async () => {
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
        const w = new OjaWorker((self) => { self.handle('ping', () => 'pong'); });
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

    it('scripts run before the handler body — globals are available to handlers', async () => {
        // Simulate a library loaded by importScripts setting a global
        globalThis.importScripts = (...urls) => {
            importScriptsCalls.push(...urls);
            globalThis.__testLib = { version: '3.0' };
        };

        const w = new OjaWorker(
            (self) => {
                // __testLib was set by importScripts before this function ran
                self.handle('version', () => {
                    return typeof __testLib !== 'undefined' ? __testLib.version : 'missing';
                });
            },
            { scripts: ['https://example.com/testlib.js'] }
        );

        const version = await w.call('version');
        expect(version).toBe('3.0');

        delete globalThis.__testLib;
        w.close();
    });

    it('name option still works alongside scripts', async () => {
        const w = new OjaWorker(
            (self) => { self.handle('ping', () => 'pong'); },
            { scripts: ['https://example.com/x.js'], name: 'named-worker' }
        );
        expect(await w.call('ping')).toBe('pong');
        w.close();
    });

    it('generated source contains importScripts call when scripts provided', () => {
        // Verify the blob source via the shim's __shimText property
        const captured = [];
        const origCreate = URL.createObjectURL;
        URL.createObjectURL = (blob) => {
            captured.push(blob.__shimText ?? '');
            return origCreate(blob);
        };

        try {
            const w = new OjaWorker(
                (self) => { self.handle('ping', () => 'pong'); },
                { scripts: ['https://cdn.example.com/marked.min.js'] }
            );
            w.close();
        } finally {
            URL.createObjectURL = origCreate;
        }

        expect(captured[0]).toContain('importScripts(');
        expect(captured[0]).toContain('https://cdn.example.com/marked.min.js');
    });

    it('generated source has no importScripts when scripts option absent', () => {
        const captured = [];
        const origCreate = URL.createObjectURL;
        URL.createObjectURL = (blob) => {
            captured.push(blob.__shimText ?? '');
            return origCreate(blob);
        };

        try {
            const w = new OjaWorker((self) => { self.handle('ping', () => 'pong'); });
            w.close();
        } finally {
            URL.createObjectURL = origCreate;
        }

        expect(captured[0].trimStart().startsWith('importScripts')).toBe(false);
    });
});

// ─── Core OjaWorker behaviour unchanged ───────────────────────────────────────

describe('OjaWorker — core behaviour unchanged', () => {
    it('call() resolves with the handler return value', async () => {
        const w = new OjaWorker((self) => {
            self.handle('double', (n) => n * 2);
        });
        expect(await w.call('double', 5)).toBe(10);
        w.close();
    });

    it('call() rejects when the handler throws', async () => {
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

    it('handles multiple concurrent calls correctly', async () => {
        const w = new OjaWorker((self) => {
            self.handle('echo', (x) => x);
        });
        const results = await Promise.all([
            w.call('echo', 1),
            w.call('echo', 2),
            w.call('echo', 3),
        ]);
        expect(results).toEqual([1, 2, 3]);
        w.close();
    });
});
