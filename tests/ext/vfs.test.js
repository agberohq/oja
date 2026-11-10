import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VFS } from '../../src/js/ext/vfs.js';

let nsCounter = 0;
function ns() { return `test-vfs-${Date.now()}-${++nsCounter}`; }

async function freshVFS() {
    const vfs = new VFS(ns());
    await vfs.ready();
    return vfs;
}

describe('VFS — construction', () => {
    it('throws when name is missing', () => {
        expect(() => new VFS('')).toThrow('[oja/vfs] name is required');
    });

    it('creates and becomes ready', async () => {
        const vfs = new VFS(ns());
        await expect(vfs.ready()).resolves.toBeDefined();
        vfs.close();
    });
});

describe('VFS — write and read', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('writes and reads a text file', async () => {
        vfs.write('index.html', '<h1>Hello</h1>');
        await vfs.flush();
        expect(await vfs.readText('index.html')).toBe('<h1>Hello</h1>');
    });

    it('returns null for a file that does not exist', async () => {
        expect(await vfs.readText('nonexistent.html')).toBeNull();
    });

    it('overwrites an existing file', async () => {
        vfs.write('app.js', 'const a = 1;'); await vfs.flush();
        vfs.write('app.js', 'const a = 2;'); await vfs.flush();
        expect(await vfs.readText('app.js')).toBe('const a = 2;');
    });

    it('strips leading slash from path', async () => {
        vfs.write('/index.html', '<h1>Slashed</h1>'); await vfs.flush();
        expect(await vfs.readText('index.html')).toBe('<h1>Slashed</h1>');
    });

    it('write() is fire and forget — does not return a promise', () => {
        expect(vfs.write('a.html', 'x')).toBeUndefined();
    });

    it('flush() guarantees write durability', async () => {
        vfs.write('a.html', 'aaa'); vfs.write('b.html', 'bbb'); vfs.write('c.html', 'ccc');
        await vfs.flush();
        const [a, b, c] = await Promise.all([vfs.readText('a.html'), vfs.readText('b.html'), vfs.readText('c.html')]);
        expect(a).toBe('aaa'); expect(b).toBe('bbb'); expect(c).toBe('ccc');
    });
});

describe('VFS — rm', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('deletes a file', async () => {
        vfs.write('old.html', 'x'); await vfs.flush();
        await vfs.rm('old.html');
        expect(await vfs.readText('old.html')).toBeNull();
    });

    it('does not throw when deleting a nonexistent file', async () => {
        await expect(vfs.rm('ghost.html')).resolves.not.toThrow();
    });

    it('recursively deletes a directory when recursive flag is true', async () => {
        await vfs.mkdir('project/src');
        vfs.write('project/src/index.js', 'code'); await vfs.flush();
        vfs.write('project/package.json', '{}'); await vfs.flush();

        await vfs.rm('project/', true);

        expect(await vfs.exists('project')).toBe(false);
        expect(await vfs.exists('project/src/index.js')).toBe(false);
        expect(await vfs.exists('project/package.json')).toBe(false);
    });
});

describe('VFS — ls', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('lists all files', async () => {
        vfs.write('index.html', 'a'); vfs.write('app.js', 'b'); await vfs.flush();
        const paths = (await vfs.ls('/')).map(f => f.path);
        expect(paths).toContain('index.html'); expect(paths).toContain('app.js');
    });

    it('lists files under a prefix', async () => {
        vfs.write('pages/home.html', 'a'); vfs.write('pages/about.html', 'b'); vfs.write('app.js', 'c');
        await vfs.flush();
        const paths = (await vfs.ls('pages/')).map(f => f.path);
        expect(paths).toContain('pages/home.html'); expect(paths).toContain('pages/about.html');
        expect(paths).not.toContain('app.js');
    });

    it('returns empty array when no files match prefix', async () => {
        expect(await vfs.ls('nonexistent/')).toEqual([]);
    });
});

describe('VFS — tree', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('returns a nested tree structure', async () => {
        vfs.write('index.html', 'a'); vfs.write('pages/home.html', 'b'); await vfs.flush();
        const tree = await vfs.tree('/');
        expect(tree.children).toBeDefined();
        const names = tree.children.map(c => c.name);
        expect(names).toContain('index.html'); expect(names).toContain('pages');
    });
});

describe('VFS — clear', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('removes all files', async () => {
        vfs.write('a.html', 'a'); vfs.write('b.html', 'b'); await vfs.flush();
        await vfs.clear();
        expect(await vfs.ls('/')).toHaveLength(0);
    });
});

describe('VFS — count signal', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('count() is a reactive signal', () => {
        expect(typeof vfs.count).toBe('function');
        expect(vfs.count.__isOjaSignal).toBe(true);
    });

    it('updates count after writes', async () => {
        vfs.write('a.html', 'x'); vfs.write('b.html', 'y'); await vfs.flush();
        await new Promise(r => setTimeout(r, 50));
        expect(vfs.count()).toBe(2);
    });
});

describe('VFS — onChange', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('fires when a file is written', async () => {
        const changes = [];
        vfs.onChange('/', (path) => changes.push(path));
        vfs.write('index.html', 'x');
        await new Promise(r => setTimeout(r, 50));
        expect(changes).toContain('index.html');
    });

    it('fires only for matching prefix', async () => {
        const pageChanges = [];
        vfs.onChange('pages/', (path) => pageChanges.push(path));
        vfs.write('app.js', 'x'); vfs.write('pages/home.html', 'y');
        await new Promise(r => setTimeout(r, 50));
        expect(pageChanges).toContain('pages/home.html');
        expect(pageChanges).not.toContain('app.js');
    });

    it('returns an unsubscribe function', async () => {
        const changes = [];
        const off = vfs.onChange('/', (path) => changes.push(path));
        vfs.write('a.html', 'x'); await new Promise(r => setTimeout(r, 50));
        off();
        vfs.write('b.html', 'y'); await new Promise(r => setTimeout(r, 50));
        expect(changes).toContain('a.html');
        expect(changes).not.toContain('b.html');
    });

    it('fires with null content when a file is deleted', async () => {
        const deletions = [];
        vfs.onChange('/', (path, content) => { if (content === null) deletions.push(path); });
        vfs.write('temp.html', 'x'); await vfs.flush();
        await vfs.rm('temp.html');
        await new Promise(r => setTimeout(r, 50));
        expect(deletions).toContain('temp.html');
    });
});

describe('VFS — toBlobMap', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('returns blob URLs for all files', async () => {
        vfs.write('index.html', '<h1>Hi</h1>'); vfs.write('app.js', 'console.log(1)');
        await vfs.flush();
        const map = await vfs.toBlobMap();
        expect(map['index.html']).toMatch(/^blob:/);
        expect(map['app.js']).toMatch(/^blob:/);
        vfs.revokeBlobMap(map);
    });

    it('revokeBlobMap() does not throw', async () => {
        vfs.write('x.html', 'x'); await vfs.flush();
        const map = await vfs.toBlobMap();
        expect(() => vfs.revokeBlobMap(map)).not.toThrow();
    });
});

describe('VFS — mime()', () => {
    it('returns correct MIME types', () => {
        const vfs = new VFS(ns());
        expect(vfs.mime('index.html')).toBe('text/html');
        expect(vfs.mime('app.js')).toBe('text/javascript');
        expect(vfs.mime('style.css')).toBe('text/css');
        expect(vfs.mime('logo.png')).toBe('image/png');
        expect(vfs.mime('data.json')).toBe('application/json');
        expect(vfs.mime('unknown.xyz')).toBe('application/octet-stream');
        vfs.close();
    });
});

describe('VFS — persist()', () => {
    it('is a method on VFS instances', async () => {
        const vfs = new VFS(ns());
        expect(typeof vfs.persist).toBe('function');
        vfs.close();
    });

    it('returns a Promise', async () => {
        const vfs = new VFS(ns());
        const result = vfs.persist();
        expect(result).toBeInstanceOf(Promise);
        vfs.close();
    });

    it('resolves to a boolean', async () => {
        const vfs = new VFS(ns());
        const granted = await vfs.persist();
        expect(typeof granted).toBe('boolean');
        vfs.close();
    });

    it('returns false gracefully when navigator.storage is not available (jsdom)', async () => {
        const vfs = new VFS(ns());
        await expect(vfs.persist()).resolves.toBe(false);
        vfs.close();
    });

    it('returns true when navigator.storage.persisted() is already true', async () => {
        // Mock navigator.storage
        const origStorage = navigator.storage;
        Object.defineProperty(navigator, 'storage', {
            value: {
                persisted: async () => true,
                persist:   async () => true,
                estimate:  async () => ({ usage: 1024, quota: 1024 * 1024 }),
            },
            configurable: true,
        });

        const vfs = new VFS(ns());
        await expect(vfs.persist()).resolves.toBe(true);
        vfs.close();

        Object.defineProperty(navigator, 'storage', { value: origStorage, configurable: true });
    });

    it('calls navigator.storage.persist() when not yet persisted', async () => {
        const persistFn = vi.fn().mockResolvedValue(true);
        Object.defineProperty(navigator, 'storage', {
            value: { persisted: async () => false, persist: persistFn, estimate: async () => ({}) },
            configurable: true,
        });

        const vfs = new VFS(ns());
        const result = await vfs.persist();
        expect(persistFn).toHaveBeenCalledTimes(1);
        expect(result).toBe(true);
        vfs.close();

        Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
    });

    it('is called automatically by ready()', async () => {
        const persistFn = vi.fn().mockResolvedValue(true);
        Object.defineProperty(navigator, 'storage', {
            value: { persisted: async () => false, persist: persistFn, estimate: async () => ({}) },
            configurable: true,
        });

        const vfs = new VFS(ns());
        await vfs.ready(); // should trigger persist() automatically
        // persist is fire-and-forget — give it a microtask to complete
        await new Promise(r => setTimeout(r, 10));
        expect(persistFn).toHaveBeenCalled();
        vfs.close();

        Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true });
    });
});

describe('VFS — quota()', () => {
    it('is a method on VFS instances', () => {
        const vfs = new VFS(ns());
        expect(typeof vfs.quota).toBe('function');
        vfs.close();
    });

    it('returns a Promise', () => {
        const vfs = new VFS(ns());
        const result = vfs.quota();
        expect(result).toBeInstanceOf(Promise);
        vfs.close();
    });

    it('returns null when navigator.storage.estimate is not available', async () => {
        const vfs = new VFS(ns());
        await expect(vfs.quota()).resolves.toBeNull();
        vfs.close();
    });
});

// FILE OPERATIONS (cp, mv)

describe('VFS — cp and mv', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('copies a file using cp()', async () => {
        vfs.write('original.txt', 'test data'); await vfs.flush();
        await vfs.cp('original.txt', 'copy.txt');

        expect(await vfs.readText('original.txt')).toBe('test data');
        expect(await vfs.readText('copy.txt')).toBe('test data');
    });

    it('moves a file using mv()', async () => {
        vfs.write('old_name.txt', 'move data'); await vfs.flush();
        await vfs.mv('old_name.txt', 'new_name.txt');

        expect(await vfs.exists('old_name.txt')).toBe(false);
        expect(await vfs.readText('new_name.txt')).toBe('move data');
    });

    it('throws when source does not exist for cp()', async () => {
        await expect(vfs.cp('missing.txt', 'dest.txt')).rejects.toThrow('Source not found: missing.txt');
    });
});

// DIRECTORY OPERATIONS (mkdir, isDir, exists, stat, dir)

describe('VFS — mkdir', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('creates a directory', async () => {
        await vfs.mkdir('assets');
        const isDir = await vfs.isDir('assets');
        expect(isDir).toBe(true);
    });

    it('creates nested directories automatically', async () => {
        await vfs.mkdir('assets/images/icons');
        expect(await vfs.isDir('assets')).toBe(true);
        expect(await vfs.isDir('assets/images')).toBe(true);
        expect(await vfs.isDir('assets/images/icons')).toBe(true);
    });

    it('handles trailing slash cleanly', async () => {
        await vfs.mkdir('docs/');
        expect(await vfs.isDir('docs')).toBe(true);
        expect(await vfs.isDir('docs/')).toBe(true);
    });
});

describe('VFS — isDir', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('returns true for an explicitly created directory', async () => {
        await vfs.mkdir('src');
        expect(await vfs.isDir('src')).toBe(true);
    });

    it('returns true for an implicit directory (no marker, just nested files)', async () => {
        vfs.write('implicit/folder/data.json', '{}'); await vfs.flush();
        // Even without calling mkdir('implicit/folder'), the path exists as a directory
        expect(await vfs.isDir('implicit/folder')).toBe(true);
    });

    it('returns false for non-existing path', async () => {
        expect(await vfs.isDir('nonexistent')).toBe(false);
    });

    it('returns false for a file', async () => {
        vfs.write('file.txt', 'content'); await vfs.flush();
        expect(await vfs.isDir('file.txt')).toBe(false);
    });
});

describe('VFS — exists', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('returns true for existing file', async () => {
        vfs.write('file.txt', 'content'); await vfs.flush();
        expect(await vfs.exists('file.txt')).toBe(true);
    });

    it('returns true for existing directory', async () => {
        await vfs.mkdir('folder');
        expect(await vfs.exists('folder')).toBe(true);
    });

    it('returns false for non-existing path', async () => {
        expect(await vfs.exists('nonexistent')).toBe(false);
    });

    it('distinguishes correctly between file and directory formats', async () => {
        vfs.write('foo', 'file content'); await vfs.flush();
        await vfs.mkdir('foo_dir');

        expect(await vfs.exists('foo')).toBe(true);
        expect(await vfs.exists('foo_dir')).toBe(true);
        expect(await vfs.exists('foo_dir/')).toBe(true);
    });
});

describe('VFS — stat', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('returns file stats', async () => {
        vfs.write('file.txt', 'hello world'); await vfs.flush();
        const stats = await vfs.stat('file.txt');

        expect(stats).not.toBeNull();
        expect(stats.type).toBe('file');
        expect(stats.size).toBe(11);  // 'hello world'.length
        expect(stats).toHaveProperty('updatedAt');
    });

    it('returns directory stats for explicit directories', async () => {
        await vfs.mkdir('folder');
        vfs.write('folder/file1.txt', 'a'); await vfs.flush();
        vfs.write('folder/file2.txt', 'b'); await vfs.flush();

        const stats = await vfs.stat('folder');
        expect(stats).not.toBeNull();
        expect(stats.type).toBe('directory');
        expect(stats.items).toBe(2);
        expect(stats.size).toBe(0);
    });

    it('returns null for non-existing path', async () => {
        expect(await vfs.stat('nonexistent')).toBeNull();
    });

    it('counts nested directory items correctly (direct children only)', async () => {
        await vfs.mkdir('parent');
        vfs.write('parent/child1.txt', 'a'); await vfs.flush();
        vfs.write('parent/child2.txt', 'b'); await vfs.flush();
        await vfs.mkdir('parent/nested');
        vfs.write('parent/nested/file.txt', 'c'); await vfs.flush();

        const stats = await vfs.stat('parent');
        expect(stats.items).toBe(3);  // child1.txt, child2.txt, nested/
    });
});

describe('VFS — dir', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('lists mixed files and directories', async () => {
        vfs.write('file1.txt', 'a'); await vfs.flush();
        vfs.write('file2.txt', 'b'); await vfs.flush();
        await vfs.mkdir('folder');

        const items = await vfs.dir('/');
        expect(items).toHaveLength(3);

        const file1 = items.find(i => i.name === 'file1.txt');
        const folder = items.find(i => i.name === 'folder');

        expect(file1).toBeDefined();
        expect(file1.type).toBe('file');
        expect(folder).toBeDefined();
        expect(folder.type).toBe('directory');
    });

    it('sorts directories first, then alphabetically', async () => {
        vfs.write('zebra.txt', 'z'); await vfs.flush();
        await vfs.mkdir('alpha');
        vfs.write('beta.txt', 'b'); await vfs.flush();

        const items = await vfs.dir('/');
        const types = items.map(i => i.type);

        // Directories should come before files
        let seenFile = false;
        for (const type of types) {
            if (type === 'file') seenFile = true;
            if (type === 'directory' && seenFile) {
                throw new Error('Directory found after file');
            }
        }

        expect(items[0].name).toBe('alpha');
        expect(items[1].name).toBe('beta.txt');
        expect(items[2].name).toBe('zebra.txt');
    });

    it('includes metadata for files', async () => {
        vfs.write('test.txt', 'hello'); await vfs.flush();
        const items = await vfs.dir('/');

        const file = items[0];
        expect(file).toHaveProperty('name', 'test.txt');
        expect(file).toHaveProperty('path', 'test.txt');
        expect(file).toHaveProperty('type', 'file');
        expect(file).toHaveProperty('size', 5);
        expect(file).toHaveProperty('dirty');
        expect(file).toHaveProperty('updatedAt');
    });

    it('handles nested paths', async () => {
        await vfs.mkdir('parent/child');
        vfs.write('parent/child/file.txt', 'content'); await vfs.flush();

        const items = await vfs.dir('parent');
        expect(items).toHaveLength(1);
        expect(items[0].name).toBe('child');
        expect(items[0].type).toBe('directory');
    });

    it('returns empty array for empty directory', async () => {
        await vfs.mkdir('empty');
        const items = await vfs.dir('empty');
        expect(items).toEqual([]);
    });
});
