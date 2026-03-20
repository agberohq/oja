import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VFS } from '../../src/js/core/vfs.js';

// Each test uses a unique VFS namespace to avoid IndexedDB collisions
let nsCounter = 0;
function ns() { return `test-vfs-${Date.now()}-${++nsCounter}`; }

async function freshVFS() {
    const vfs = new VFS(ns());
    await vfs.ready();
    return vfs;
}

// ─── Construction ──────────────────────────────────────────────────────────────

describe('VFS — construction', () => {
    it('throws when name is missing', () => {
        expect(() => new VFS('')).toThrow('[oja/vfs] name is required');
    });

    it('creates and becomes ready', async () => {
        const vfs = new VFS(ns());
        await expect(vfs.ready()).resolves.toBeUndefined();
        vfs.close();
    });
});

// ─── write / readText / read ────────────────────────────────────────────────

describe('VFS — write and read', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('writes and reads a text file', async () => {
        vfs.write('index.html', '<h1>Hello</h1>');
        await vfs.flush();
        const content = await vfs.readText('index.html');
        expect(content).toBe('<h1>Hello</h1>');
    });

    it('returns null for a file that does not exist', async () => {
        const content = await vfs.readText('nonexistent.html');
        expect(content).toBeNull();
    });

    it('overwrites an existing file', async () => {
        vfs.write('app.js', 'const a = 1;');
        await vfs.flush();
        vfs.write('app.js', 'const a = 2;');
        await vfs.flush();
        expect(await vfs.readText('app.js')).toBe('const a = 2;');
    });

    it('strips leading slash from path', async () => {
        vfs.write('/index.html', '<h1>Slashed</h1>');
        await vfs.flush();
        expect(await vfs.readText('index.html')).toBe('<h1>Slashed</h1>');
    });

    it('write() is fire and forget — does not return a promise', () => {
        const result = vfs.write('a.html', 'x');
        expect(result).toBeUndefined();
    });

    it('flush() guarantees write durability', async () => {
        vfs.write('a.html', 'aaa');
        vfs.write('b.html', 'bbb');
        vfs.write('c.html', 'ccc');
        await vfs.flush();
        const [a, b, c] = await Promise.all([
            vfs.readText('a.html'),
            vfs.readText('b.html'),
            vfs.readText('c.html'),
        ]);
        expect(a).toBe('aaa');
        expect(b).toBe('bbb');
        expect(c).toBe('ccc');
    });
});

// ─── rm ────────────────────────────────────────────────────────────────────────

describe('VFS — rm', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('deletes a file', async () => {
        vfs.write('old.html', 'x');
        await vfs.flush();
        await vfs.rm('old.html');
        expect(await vfs.readText('old.html')).toBeNull();
    });

    it('does not throw when deleting a nonexistent file', async () => {
        await expect(vfs.rm('ghost.html')).resolves.not.toThrow();
    });
});

// ─── ls / tree ────────────────────────────────────────────────────────────────

describe('VFS — ls', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('lists all files', async () => {
        vfs.write('index.html', 'a');
        vfs.write('app.js', 'b');
        await vfs.flush();
        const files = await vfs.ls('/');
        const paths = files.map(f => f.path);
        expect(paths).toContain('index.html');
        expect(paths).toContain('app.js');
    });

    it('lists files under a prefix', async () => {
        vfs.write('pages/home.html', 'a');
        vfs.write('pages/about.html', 'b');
        vfs.write('app.js', 'c');
        await vfs.flush();
        const files = await vfs.ls('pages/');
        const paths = files.map(f => f.path);
        expect(paths).toContain('pages/home.html');
        expect(paths).toContain('pages/about.html');
        expect(paths).not.toContain('app.js');
    });

    it('returns empty array when no files match prefix', async () => {
        const files = await vfs.ls('nonexistent/');
        expect(files).toEqual([]);
    });
});

describe('VFS — tree', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('returns a nested tree structure', async () => {
        vfs.write('index.html', 'a');
        vfs.write('pages/home.html', 'b');
        vfs.write('pages/about.html', 'c');
        await vfs.flush();
        const tree = await vfs.tree('/');
        expect(tree.children).toBeDefined();
        const names = tree.children.map(c => c.name);
        expect(names).toContain('index.html');
        expect(names).toContain('pages');
    });
});

// ─── clear ────────────────────────────────────────────────────────────────────

describe('VFS — clear', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('removes all files', async () => {
        vfs.write('a.html', 'a');
        vfs.write('b.html', 'b');
        await vfs.flush();
        await vfs.clear();
        const files = await vfs.ls('/');
        expect(files).toHaveLength(0);
    });
});

// ─── count signal ─────────────────────────────────────────────────────────────

describe('VFS — count signal', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('count() is a reactive signal', () => {
        expect(typeof vfs.count).toBe('function');
        expect(vfs.count.__isOjaSignal).toBe(true);
    });

    it('updates count after writes', async () => {
        vfs.write('a.html', 'x');
        vfs.write('b.html', 'y');
        await vfs.flush();
        await new Promise(r => setTimeout(r, 50));
        expect(vfs.count()).toBe(2);
    });
});

// ─── onChange ─────────────────────────────────────────────────────────────────

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

        vfs.write('app.js', 'x');
        vfs.write('pages/home.html', 'y');
        await new Promise(r => setTimeout(r, 50));

        expect(pageChanges).toContain('pages/home.html');
        expect(pageChanges).not.toContain('app.js');
    });

    it('returns an unsubscribe function', async () => {
        const changes = [];
        const off = vfs.onChange('/', (path) => changes.push(path));

        vfs.write('a.html', 'x');
        await new Promise(r => setTimeout(r, 50));
        off();

        vfs.write('b.html', 'y');
        await new Promise(r => setTimeout(r, 50));

        expect(changes).toContain('a.html');
        expect(changes).not.toContain('b.html');
    });

    it('fires with null content when a file is deleted', async () => {
        const deletions = [];
        vfs.onChange('/', (path, content) => {
            if (content === null) deletions.push(path);
        });

        vfs.write('temp.html', 'x');
        await vfs.flush();
        await vfs.rm('temp.html');
        await new Promise(r => setTimeout(r, 50));

        expect(deletions).toContain('temp.html');
    });
});

// ─── toBlobMap ────────────────────────────────────────────────────────────────

describe('VFS — toBlobMap', () => {
    let vfs;
    beforeEach(async () => { vfs = await freshVFS(); });
    afterEach(() => vfs.close());

    it('returns blob URLs for all files', async () => {
        vfs.write('index.html', '<h1>Hi</h1>');
        vfs.write('app.js', 'console.log(1)');
        await vfs.flush();

        const map = await vfs.toBlobMap();
        expect(map['index.html']).toMatch(/^blob:/);
        expect(map['app.js']).toMatch(/^blob:/);

        vfs.revokeBlobMap(map);
    });

    it('revokeBlobMap() does not throw', async () => {
        vfs.write('x.html', 'x');
        await vfs.flush();
        const map = await vfs.toBlobMap();
        expect(() => vfs.revokeBlobMap(map)).not.toThrow();
    });
});

// ─── mime ────────────────────────────────────────────────────────────────────

describe('VFS — mime()', () => {
    it('returns correct MIME types', async () => {
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