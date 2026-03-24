/**
 * tests/others/worker-scripts.test.js
 *
 * OjaWorker — options.scripts + three-mode tests.
 * Mirrors tests/core/worker-scripts.test.js with focus on the others/ suite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OjaWorker, _resetWorkerDetectionCache } from '../../src/js/ext/worker.js';

// ─── Setup ────────────────────────────────────────────────────────────────────

let importScriptsCalls = [];

beforeEach(() => {
    importScriptsCalls = [];
    globalThis.importScripts = (...urls) => { importScriptsCalls.push(...urls); };
    // Reset detection cache so each test gets a fresh probe.
    // Important in jsdom where module detection may be environment-dependent.
    _resetWorkerDetectionCache();
});

afterEach(() => {
    delete globalThis.importScripts;
    delete globalThis.__testLib;
    _resetWorkerDetectionCache();
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

    it('calls importScripts with multiple URLs preserving order', async () => {
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

    it('scripts run before the handler body so globals are available', async () => {
        globalThis.importScripts = (...urls) => {
            importScriptsCalls.push(...urls);
            globalThis.__testLib = { version: '2.0' };
        };
        const w = new OjaWorker(
            (self) => {
                self.handle('version', () =>
                    typeof __testLib !== 'undefined' ? __testLib.version : 'missing'
                );
            },
            { scripts: ['https://example.com/testlib.js'] }
        );
        const version = await w.call('version');
        expect(version).toBe('2.0');
        w.close();
    });

    it('name option works alongside scripts', async () => {
        const w = new OjaWorker(
            (self) => { self.handle('ping', () => 'pong'); },
            { scripts: ['https://example.com/x.js'], name: 'named-worker' }
        );
        expect(await w.call('ping')).toBe('pong');
        w.close();
    });

    it('worker source contains importScripts call when scripts provided', () => {
        const blobs = [];
        const origCreate = URL.createObjectURL;
        URL.createObjectURL = (blob) => { blobs.push(blob.__shimText ?? ''); return origCreate(blob); };
        try {
            new OjaWorker(
                (self) => { self.handle('ping', () => 'pong'); },
                { scripts: ['https://cdn.example.com/marked.min.js'] }
            ).close();
        } finally { URL.createObjectURL = origCreate; }
        // _detect() also calls createObjectURL for its probe, so blobs may
        // have multiple entries. Find the one with the actual worker source.
        const workerBlob = blobs.find(b => b.includes('importScripts('));
        expect(workerBlob).toBeDefined();
        expect(workerBlob).toContain('https://cdn.example.com/marked.min.js');
    });

    it('worker source has NO importScripts when scripts option absent', () => {
        const blobs = [];
        const origCreate = URL.createObjectURL;
        URL.createObjectURL = (blob) => { blobs.push(blob.__shimText ?? ''); return origCreate(blob); };
        try {
            new OjaWorker((self) => { self.handle('ping', () => 'pong'); }).close();
        } finally { URL.createObjectURL = origCreate; }
        // Filter out the _detect() probe blob; check the actual worker blob.
        const workerBlob = blobs.find(b => b.includes('handle('));
        expect(workerBlob).toBeDefined();
        expect(workerBlob.trimStart().startsWith('importScripts')).toBe(false);
    });
});

// ─── Core OjaWorker behaviour ─────────────────────────────────────────────────

describe('OjaWorker — core behaviour unchanged', () => {
    it('call() resolves with handler return value', async () => {
        const w = new OjaWorker((self) => { self.handle('double', (n) => n * 2); });
        expect(await w.call('double', 5)).toBe(10);
        w.close();
    });

    it('call() rejects when handler throws', async () => {
        const w = new OjaWorker((self) => { self.handle('fail', () => { throw new Error('worker error'); }); });
        await expect(w.call('fail')).rejects.toThrow('worker error');
        w.close();
    });

    it('call() rejects after close()', async () => {
        const w = new OjaWorker((self) => { self.handle('ping', () => 'pong'); });
        w.close();
        await expect(w.call('ping')).rejects.toThrow('closed');
    });
});

// ─── Mode awareness ───────────────────────────────────────────────────────────

describe('OjaWorker — mode', () => {
    it('auto mode resolves to classic or inline-module', () => {
        const w = new OjaWorker((self) => { self.handle('ping', () => 'pong'); });
        expect(['classic', 'inline-module']).toContain(w.mode);
        w.close();
    });

    it('explicit classic mode sets mode getter', () => {
        const w = new OjaWorker((self) => { self.handle('ping', () => 'pong'); }, { type: 'classic' });
        expect(w.mode).toBe('classic');
        w.close();
    });

    it('scripts force classic mode in auto', () => {
        const w = new OjaWorker(
            (self) => { self.handle('ping', () => 'pong'); },
            { scripts: ['https://example.com/lib.js'] }
        );
        expect(w.mode).toBe('classic');
        w.close();
    });

    it('OjaWorker.detect() returns an object with boolean keys', () => {
        const caps = OjaWorker.detect();
        expect(typeof caps.classic).toBe('boolean');
        expect(typeof caps.module).toBe('boolean');
        expect(typeof caps.inlineModule).toBe('boolean');
    });

    it('unknown type throws TypeError immediately', () => {
        expect(() => new OjaWorker(
            (self) => { self.handle('ping', () => 'pong'); },
            { type: 'nonexistent' }
        )).toThrow(TypeError);
    });
});
