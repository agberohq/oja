import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VFS } from '../../src/js/ext/vfs.js';


describe('VFS.persist() and VFS.quota()', () => {
    it('persist() is a function', async () => {
        const vfs = new VFS('test-persist');
        expect(typeof vfs.persist).toBe('function');
    });

    it('quota() is a function', async () => {
        const vfs = new VFS('test-quota');
        expect(typeof vfs.quota).toBe('function');
    });

    it('persist() returns false gracefully when navigator.storage is absent', async () => {
        const origStorage = navigator.storage;
        Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
        const vfs = new VFS('no-storage');
        const result = await vfs.persist();
        expect(result).toBe(false);
        Object.defineProperty(navigator, 'storage', { value: origStorage, configurable: true });
    });

    it('quota() returns null gracefully when navigator.storage is absent', async () => {
        const origStorage = navigator.storage;
        Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
        const vfs = new VFS('no-storage-q');
        const result = await vfs.quota();
        expect(result).toBeNull();
        Object.defineProperty(navigator, 'storage', { value: origStorage, configurable: true });
    });

    it('quota() returns an object with expected shape when available', async () => {
        Object.defineProperty(navigator, 'storage', {
            value: {
                estimate: () => Promise.resolve({ usage: 1024 * 1024, quota: 100 * 1024 * 1024 }),
                persist:  () => Promise.resolve(true),
                persisted:() => Promise.resolve(false),
            },
            configurable: true,
        });
        const vfs = new VFS('with-storage');
        const q = await vfs.quota();
        expect(q).not.toBeNull();
        expect(typeof q.used).toBe('number');
        expect(typeof q.usedMB).toBe('string');
        expect(typeof q.percent).toBe('number');
    });
});


describe('VFS encrypt hook', () => {
    it('calls seal() before writing when encrypt hook is provided', async () => {
        const seal = vi.fn(async (text) => `SEALED:${text}`);
        const open = vi.fn(async (text) => text.replace('SEALED:', ''));
        const isSealed = (text) => text.startsWith('SEALED:');

        const vfs = new VFS('enc-test', { encrypt: { seal, open, isSealed } });
        await vfs.ready();

        await vfs.write('test.md', 'hello world');
        expect(seal).toHaveBeenCalledWith('hello world');
    });

    it('calls open() after reading sealed content', async () => {
        const seal = vi.fn(async (text) => `SEALED:${text}`);
        const open = vi.fn(async (text) => text.replace('SEALED:', ''));
        const isSealed = (text) => text.startsWith('SEALED:');

        const vfs = new VFS('enc-test-2', { encrypt: { seal, open, isSealed } });
        await vfs.ready();

        await vfs.write('doc.md', 'secret content');
        const text = await vfs.readText('doc.md');

        expect(open).toHaveBeenCalled();
        expect(text).toBe('secret content');
    });

    it('does not seal/open when no encrypt hook provided', async () => {
        const vfs = new VFS('plain-test');
        await vfs.ready();

        await vfs.write('plain.md', 'plain text');
        const text = await vfs.readText('plain.md');
        expect(text).toBe('plain text');
    });
});