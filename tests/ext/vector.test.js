/**
 * tests/others/vector.test.js
 * Vector store — in-memory, Store-backed, and VFS-backed modes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Vector } from '../../src/js/ext/vector.js';

// Helpers

function makeStore(initial = null) {
    // Minimal Store-compatible object for testing
    const _data = {};
    if (initial) Object.assign(_data, initial);
    return {
        get: (key) => _data[key] ?? null,
        set: (key, val) => { _data[key] = val; },
        _data,
    };
}

function makeVFS(initial = null) {
    const _files = {};
    if (initial) Object.assign(_files, initial);
    return {
        readText: vi.fn(async (path) => _files[path] ?? null),
        write:    vi.fn(async (path, content) => { _files[path] = content; }),
        _files,
    };
}

// In-memory mode

describe('Vector — in-memory (no persistence)', () => {
    let db;
    beforeEach(() => { db = new Vector(); });

    it('insert and retrieve by id', () => {
        const id = db.insert([1, 0, 0], { label: 'x' });
        const entry = db.get(id);
        expect(entry.id).toBe(id);
        expect(entry.vector).toEqual([1, 0, 0]);
        expect(entry.metadata.label).toBe('x');
    });

    it('insert returns unique ids', () => {
        const a = db.insert([1, 0]);
        const b = db.insert([0, 1]);
        expect(a).not.toBe(b);
    });

    it('insert with explicit id', () => {
        db.insert([1, 0], {}, 'custom-id');
        expect(db.has('custom-id')).toBe(true);
    });

    it('insert throws on duplicate id', () => {
        db.insert([1, 0], {}, 'dup');
        expect(() => db.insert([0, 1], {}, 'dup')).toThrow('already exists');
    });

    it('upsert adds new entry', () => {
        const id = db.upsert([1, 0], { x: 1 });
        expect(db.has(id)).toBe(true);
    });

    it('upsert replaces existing vector', () => {
        db.upsert([1, 0], { v: 'old' }, 'u1');
        db.upsert([0, 1], { v: 'new' }, 'u1');
        expect(db.get('u1').vector).toEqual([0, 1]);
    });

    it('upsert merges metadata', () => {
        db.upsert([1, 0], { a: 1 }, 'u2');
        db.upsert([1, 0], { b: 2 }, 'u2');
        const m = db.get('u2').metadata;
        expect(m.a).toBe(1);
        expect(m.b).toBe(2);
    });

    it('has() returns true/false', () => {
        const id = db.insert([1, 0]);
        expect(db.has(id)).toBe(true);
        expect(db.has('nonexistent')).toBe(false);
    });

    it('get() returns null for missing id', () => {
        expect(db.get('nope')).toBeNull();
    });

    it('get() returns copies not references', () => {
        const id = db.insert([1, 2, 3], { x: 1 });
        const entry = db.get(id);
        entry.vector[0] = 99;
        entry.metadata.x = 99;
        expect(db.get(id).vector[0]).toBe(1);
        expect(db.get(id).metadata.x).toBe(1);
    });

    it('delete() removes entry', () => {
        const id = db.insert([1, 0]);
        expect(db.delete(id)).toBe(true);
        expect(db.has(id)).toBe(false);
    });

    it('delete() returns false for missing id', () => {
        expect(db.delete('nope')).toBe(false);
    });

    it('clear() empties the store', () => {
        db.insert([1, 0]);
        db.insert([0, 1]);
        db.clear();
        expect(db.count()).toBe(0);
    });

    it('count() with no filter', () => {
        db.insert([1, 0]);
        db.insert([0, 1]);
        expect(db.count()).toBe(2);
    });

    it('count() with filter', () => {
        db.insert([1, 0], { type: 'a' });
        db.insert([0, 1], { type: 'b' });
        expect(db.count(m => m.type === 'a')).toBe(1);
    });

    it('ids() returns all ids', () => {
        db.insert([1, 0], {}, 'p');
        db.insert([0, 1], {}, 'q');
        expect(db.ids().sort()).toEqual(['p', 'q']);
    });

    it('throws on empty vector', () => {
        expect(() => db.insert([])).toThrow();
    });

    it('throws on non-array', () => {
        expect(() => db.insert('not a vector')).toThrow();
    });

    it('validates dimensions when set', () => {
        const d = new Vector({ dimensions: 3 });
        expect(() => d.insert([1, 2])).toThrow('dimensions');
        expect(() => d.insert([1, 2, 3])).not.toThrow();
    });
});

// Search

describe('Vector — search', () => {
    let db;
    beforeEach(() => {
        db = new Vector({ metric: 'cosine' });
        db.insert([1, 0, 0], { label: 'x-axis' }, 'x');
        db.insert([0, 1, 0], { label: 'y-axis' }, 'y');
        db.insert([0, 0, 1], { label: 'z-axis' }, 'z');
        db.insert([1, 1, 0], { label: 'xy-diag' }, 'xy');
    });

    it('returns topK results', () => {
        const r = db.search([1, 0, 0], { topK: 2 });
        expect(r.length).toBe(2);
    });

    it('top result is most similar', () => {
        const r = db.search([1, 0, 0]);
        expect(r[0].id).toBe('x');
    });

    it('scores are in descending order', () => {
        const r = db.search([1, 0.1, 0]);
        for (let i = 1; i < r.length; i++) {
            expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
        }
    });

    it('results include metadata', () => {
        const r = db.search([1, 0, 0], { topK: 1 });
        expect(r[0].metadata.label).toBe('x-axis');
    });

    it('minScore filters low-similarity results', () => {
        // orthogonal vectors have cosine = 0; score = 0
        const r = db.search([0, 0, 1], { minScore: 0.5 });
        // only z-axis should pass
        expect(r.every(e => e.score >= 0.5)).toBe(true);
    });

    it('filter predicate on metadata', () => {
        const r = db.search([1, 0, 0], { filter: m => m.label.includes('axis') });
        expect(r.every(e => e.metadata.label.includes('axis'))).toBe(true);
        expect(r.some(e => e.id === 'xy')).toBe(false);
    });

    it('empty store returns empty array', () => {
        const empty = new Vector();
        expect(empty.search([1, 0, 0])).toEqual([]);
    });

    it('euclidean metric — closest vector wins', () => {
        const edb = new Vector({ metric: 'euclidean' });
        edb.insert([1, 0], {}, 'a');
        edb.insert([10, 0], {}, 'b');
        const r = edb.search([1.1, 0]);
        expect(r[0].id).toBe('a');
    });

    it('manhattan metric returns results', () => {
        const mdb = new Vector({ metric: 'manhattan' });
        mdb.insert([1, 0], {}, 'a');
        mdb.insert([5, 0], {}, 'b');
        const r = mdb.search([1, 0]);
        expect(r[0].id).toBe('a');
    });

    it('metric can be overridden per-search', () => {
        const r = db.search([1, 0, 0], { metric: 'dot', topK: 1 });
        expect(r.length).toBe(1);
    });
});

// Static helpers

describe('Vector — static helpers', () => {
    it('normalize() returns unit vector', () => {
        const n = Vector.normalize([3, 4]);
        const mag = Math.sqrt(n.reduce((s, v) => s + v * v, 0));
        expect(mag).toBeCloseTo(1);
    });

    it('hashVector() returns array of correct length', () => {
        const v = Vector.hashVector('hello world', 64);
        expect(v.length).toBe(64);
    });

    it('hashVector() is deterministic', () => {
        const a = Vector.hashVector('cat');
        const b = Vector.hashVector('cat');
        expect(a).toEqual(b);
    });

    it('hashVector() differs for different text', () => {
        const a = Vector.hashVector('cat');
        const b = Vector.hashVector('dog');
        expect(a).not.toEqual(b);
    });

    it('hashVector() produces unit vector', () => {
        const v = Vector.hashVector('testing');
        const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
        expect(mag).toBeCloseTo(1);
    });
});

// Store persistence

describe('Vector — Store persistence', () => {
    it('loads existing data from Store on construction', () => {
        const store = makeStore();
        const db1   = new Vector({ store, namespace: 'emb' });
        db1.insert([1, 0], { tag: 'a' }, 'id1');

        // New instance — loads from same store
        const db2 = new Vector({ store, namespace: 'emb' });
        expect(db2.has('id1')).toBe(true);
        expect(db2.get('id1').metadata.tag).toBe('a');
    });

    it('persists on insert', () => {
        const store = makeStore();
        const db    = new Vector({ store, namespace: 'emb' });
        db.insert([1, 0], {}, 'x1');
        expect(store._data['emb:data']).toBeTruthy();
    });

    it('persists on delete', () => {
        const store = makeStore();
        const db    = new Vector({ store, namespace: 'emb' });
        db.insert([1, 0], {}, 'del1');
        db.delete('del1');
        // Reload
        const db2 = new Vector({ store, namespace: 'emb' });
        expect(db2.has('del1')).toBe(false);
    });

    it('persists on clear', () => {
        const store = makeStore();
        const db    = new Vector({ store, namespace: 'emb' });
        db.insert([1, 0], {}, 'c1');
        db.clear();
        const db2 = new Vector({ store, namespace: 'emb' });
        expect(db2.count()).toBe(0);
    });

    it('autoSave: false — does not persist until save() called', () => {
        const store = makeStore();
        const db    = new Vector({ store, namespace: 'emb', autoSave: false });
        db.insert([1, 0], {}, 'ns1');
        expect(store._data['emb:data']).toBeFalsy();
        db.save();
        expect(store._data['emb:data']).toBeTruthy();
    });
});

// VFS persistence

describe('Vector — VFS persistence', () => {
    it('ready() resolves', async () => {
        const vfs = makeVFS();
        const db  = new Vector({ vfs, namespace: 'vemb' });
        await expect(db.ready()).resolves.toBeTruthy();
    });

    it('loads existing data from VFS on construction', async () => {
        const vfs = makeVFS();
        const db1 = new Vector({ vfs, namespace: 'vemb' });
        await db1.ready();
        db1.insert([1, 0], { tag: 'vfs' }, 'vid1');
        // wait for async VFS write
        await new Promise(r => setTimeout(r, 10));

        const db2 = new Vector({ vfs, namespace: 'vemb' });
        await db2.ready();
        expect(db2.has('vid1')).toBe(true);
        expect(db2.get('vid1').metadata.tag).toBe('vfs');
    });

    it('calls vfs.write on insert', async () => {
        const vfs = makeVFS();
        const db  = new Vector({ vfs, namespace: 'vemb' });
        await db.ready();
        db.insert([1, 0]);
        await new Promise(r => setTimeout(r, 10));
        expect(vfs.write).toHaveBeenCalled();
    });
});
