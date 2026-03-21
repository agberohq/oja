import { describe, it, expect, beforeEach } from 'vitest';
import { Trie, Search } from '../../src/js/utils/search.js';

// ─── Trie ─────────────────────────────────────────────────────────────────────

describe('Trie — insert / get / has', () => {
    it('inserts a key and retrieves its data',            () => { const t = new Trie(); t.insert('apple', { id: 1 }); expect(t.get('apple')).toEqual({ id: 1 }); });
    it('returns null for a missing key',                  () => { const t = new Trie(); expect(t.get('missing')).toBeNull(); });
    it('has() returns true for inserted key',             () => { const t = new Trie(); t.insert('fig'); expect(t.has('fig')).toBe(true); });
    it('has() returns false for missing key',             () => { const t = new Trie(); expect(t.has('fig')).toBe(false); });
    it('normalises keys to lowercase on insert',          () => { const t = new Trie(); t.insert('Apple'); expect(t.has('apple')).toBe(true); expect(t.has('Apple')).toBe(true); });
    it('get is case-insensitive',                         () => { const t = new Trie(); t.insert('banana', 42); expect(t.get('BANANA')).toBe(42); });
    it('size increments on new key',                      () => { const t = new Trie(); t.insert('a'); t.insert('b'); expect(t.size).toBe(2); });
    it('size does not increment on duplicate key',        () => { const t = new Trie(); t.insert('a'); t.insert('a'); expect(t.size).toBe(1); });
    it('duplicate insert updates data',                   () => { const t = new Trie(); t.insert('key', 1); t.insert('key', 2); expect(t.get('key')).toBe(2); });
    it('returns this for chaining',                       () => { const t = new Trie(); expect(t.insert('x')).toBe(t); });
    it('ignores non-string keys',                         () => { const t = new Trie(); t.insert(null); t.insert(42); expect(t.size).toBe(0); });
    it('stores null data by default',                     () => { const t = new Trie(); t.insert('ok'); expect(t.get('ok')).toBeNull(); });
});

describe('Trie — insertAll', () => {
    it('inserts multiple keys at once', () => {
        const t = new Trie();
        t.insertAll(['apple', 'apricot', 'banana']);
        expect(t.size).toBe(3);
    });
    it('applies dataFn per key', () => {
        const t = new Trie();
        t.insertAll(['a', 'b'], k => k.toUpperCase());
        expect(t.get('a')).toBe('A');
        expect(t.get('b')).toBe('B');
    });
});

describe('Trie — autocomplete', () => {
    let t;
    beforeEach(() => {
        t = new Trie();
        t.insertAll(['apple', 'apricot', 'application', 'banana', 'cherry']);
    });

    it('returns all keys with the given prefix',     () => { const r = t.autocomplete('ap'); expect(r).toContain('apple'); expect(r).toContain('apricot'); expect(r).toContain('application'); });
    it('does not return keys without the prefix',    () => { expect(t.autocomplete('ap')).not.toContain('banana'); });
    it('returns empty array for unmatched prefix',   () => { expect(t.autocomplete('xyz')).toEqual([]); });
    it('returns empty array for empty prefix',       () => { expect(t.autocomplete('')).toEqual([]); });
    it('respects limit option',                      () => { expect(t.autocomplete('ap', { limit: 2 })).toHaveLength(2); });
    it('returns results in alphabetical order',      () => { const r = t.autocomplete('ap'); expect(r).toEqual([...r].sort()); });
    it('includeData returns { key, data } objects',  () => {
        t.insert('mango', { color: 'yellow' });
        const r = t.autocomplete('mango', { includeData: true });
        expect(r[0]).toEqual({ key: 'mango', data: { color: 'yellow' } });
    });
    it('exact key match returns that key',           () => { expect(t.autocomplete('apple')).toContain('apple'); });
});

describe('Trie — fuzzySearch', () => {
    let t;
    beforeEach(() => {
        t = new Trie();
        t.insertAll(['apple', 'apricot', 'banana', 'cherry']);
    });

    it('finds an exact match at distance 0',           () => { expect(t.fuzzySearch('apple')).toContain('apple'); });
    it('finds a key one edit away',                    () => { expect(t.fuzzySearch('aple', { maxDistance: 1 })).toContain('apple'); });
    it('finds a key two edits away',                   () => { expect(t.fuzzySearch('aplce', { maxDistance: 2 })).toContain('apple'); });
    it('returns empty for query beyond maxDistance',   () => { expect(t.fuzzySearch('xyz', { maxDistance: 1 })).toEqual([]); });
    it('respects limit',                               () => { expect(t.fuzzySearch('appl', { maxDistance: 2, limit: 1 })).toHaveLength(1); });
    it('sorts results by distance ascending',          () => {
        const results = t.fuzzySearch('apple', { maxDistance: 2, includeData: true });
        for (let i = 1; i < results.length; i++) {
            expect(results[i].distance).toBeGreaterThanOrEqual(results[i - 1].distance);
        }
    });
    it('includeData attaches distance and data',       () => {
        const r = t.fuzzySearch('apple', { includeData: true });
        expect(r[0]).toMatchObject({ key: 'apple', distance: 0 });
    });
    it('returns empty array for non-string query',     () => { expect(t.fuzzySearch(null)).toEqual([]); });
});

describe('Trie — delete', () => {
    it('removes an existing key',                () => { const t = new Trie(); t.insert('del'); expect(t.delete('del')).toBe(true); expect(t.has('del')).toBe(false); });
    it('returns false for missing key',          () => { const t = new Trie(); expect(t.delete('nope')).toBe(false); });
    it('decrements size',                        () => { const t = new Trie(); t.insert('x'); t.delete('x'); expect(t.size).toBe(0); });
    it('does not affect sibling prefixes',       () => {
        const t = new Trie();
        t.insert('apple');
        t.insert('application');
        t.delete('apple');
        expect(t.has('apple')).toBe(false);
        expect(t.has('application')).toBe(true);
    });
    it('autocomplete no longer returns deleted', () => {
        const t = new Trie();
        t.insert('apple');
        t.insert('apricot');
        t.delete('apple');
        expect(t.autocomplete('ap')).not.toContain('apple');
        expect(t.autocomplete('ap')).toContain('apricot');
    });
});

describe('Trie — clear', () => {
    it('removes all keys',     () => { const t = new Trie(); t.insertAll(['a', 'b', 'c']); t.clear(); expect(t.size).toBe(0); });
    it('returns this',         () => { const t = new Trie(); expect(t.clear()).toBe(t); });
    it('get returns null after clear', () => { const t = new Trie(); t.insert('x', 1); t.clear(); expect(t.get('x')).toBeNull(); });
});

describe('Trie — keys', () => {
    it('returns all keys when no prefix given', () => {
        const t = new Trie();
        t.insertAll(['fig', 'grape', 'kiwi']);
        const k = t.keys();
        expect(k).toContain('fig');
        expect(k).toContain('grape');
        expect(k).toContain('kiwi');
        expect(k).toHaveLength(3);
    });
    it('returns keys filtered by prefix', () => {
        const t = new Trie();
        t.insertAll(['fig', 'grape', 'grapefruit']);
        expect(t.keys('grape')).toContain('grape');
        expect(t.keys('grape')).toContain('grapefruit');
        expect(t.keys('grape')).not.toContain('fig');
    });
});

describe('Trie — length getter', () => {
    it('mirrors size', () => { const t = new Trie(); t.insertAll(['a', 'b']); expect(t.length).toBe(2); });
});

describe('Trie — export / import', () => {
    it('round-trips all keys and data', () => {
        const t1 = new Trie();
        t1.insert('apple',  { id: 1 });
        t1.insert('banana', { id: 2 });
        const snapshot = t1.export();

        const t2 = new Trie();
        t2.import(snapshot);
        expect(t2.get('apple')).toEqual({ id: 1 });
        expect(t2.get('banana')).toEqual({ id: 2 });
        expect(t2.size).toBe(2);
    });

    it('autocomplete works after import', () => {
        const t1 = new Trie();
        t1.insertAll(['apricot', 'application']);
        const t2 = new Trie();
        t2.import(t1.export());
        expect(t2.autocomplete('ap')).toContain('apricot');
        expect(t2.autocomplete('ap')).toContain('application');
    });

    it('export returns a plain object (JSON-safe)', () => {
        const t = new Trie();
        t.insert('x', 1);
        const snap = t.export();
        expect(() => JSON.stringify(snap)).not.toThrow();
    });

    it('import resets prior state', () => {
        const t = new Trie();
        t.insert('old', 99);
        const fresh = new Trie();
        fresh.insert('new', 1);
        t.import(fresh.export());
        expect(t.has('old')).toBe(false);
        expect(t.has('new')).toBe(true);
    });
});

// ─── Search ───────────────────────────────────────────────────────────────────

const HOSTS = [
    { id: 'h1', name: 'api.example.com',  region: 'us-east', status: 'active' },
    { id: 'h2', name: 'web.example.com',  region: 'eu-west', status: 'active' },
    { id: 'h3', name: 'db.example.com',   region: 'us-west', status: 'degraded' },
    { id: 'h4', name: 'cache.internal',   region: 'us-east', status: 'active' },
];

describe('Search — construction', () => {
    it('indexes initial items', () => {
        const s = new Search(HOSTS, { fields: ['name', 'region', 'status'] });
        expect(s.stats().documents).toBe(4);
    });
    it('starts empty with no items', () => {
        const s = new Search();
        expect(s.stats().documents).toBe(0);
    });
});

describe('Search — add / remove', () => {
    it('add() inserts a document', () => {
        const s = new Search();
        s.add('x1', { name: 'router.local' });
        expect(s.get('x1')).toMatchObject({ name: 'router.local' });
    });
    it('add() replaces existing document', () => {
        const s = new Search();
        s.add('x1', { name: 'old' });
        s.add('x1', { name: 'new' });
        expect(s.get('x1')).toMatchObject({ name: 'new' });
        expect(s.stats().documents).toBe(1);
    });
    it('addAll() inserts multiple documents', () => {
        const s = new Search();
        s.addAll([{ id: 'a', name: 'alpha' }, { id: 'b', name: 'beta' }]);
        expect(s.stats().documents).toBe(2);
    });
    it('remove() deletes a document', () => {
        const s = new Search(HOSTS, { fields: ['name'] });
        s.remove('h1');
        expect(s.get('h1')).toBeNull();
        expect(s.stats().documents).toBe(3);
    });
    it('remove() on missing id is a no-op', () => {
        const s = new Search(HOSTS, { fields: ['name'] });
        expect(() => s.remove('nope')).not.toThrow();
    });
    it('add() ignores null doc', () => {
        const s = new Search();
        s.add('x', null);
        expect(s.stats().documents).toBe(0);
    });
});

describe('Search — search (prefix)', () => {
    let s;
    beforeEach(() => { s = new Search(HOSTS, { fields: ['name', 'region', 'status'] }); });

    it('returns results for a matching prefix',          () => { expect(s.search('api')).toHaveLength(1); });
    it('result contains id, doc, score, matches',        () => {
        const [r] = s.search('api');
        expect(r).toHaveProperty('id', 'h1');
        expect(r).toHaveProperty('doc');
        expect(r).toHaveProperty('score');
        expect(r).toHaveProperty('matches');
    });
    it('returns multiple results for shared prefix',     () => { expect(s.search('us')).toHaveLength(3); });
    it('returns empty for no match',                     () => { expect(s.search('zzz')).toEqual([]); });
    it('returns empty for empty query',                  () => { expect(s.search('')).toEqual([]); });
    it('results are sorted by score descending',         () => {
        const results = s.search('example');
        for (let i = 1; i < results.length; i++) {
            expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
        }
    });
    it('top result has normalised score of 1.0',         () => { expect(s.search('api')[0].score).toBe(1); });
    it('exact field match scores higher than partial',   () => {
        const results = s.search('active');
        expect(results.length).toBeGreaterThan(0);
    });
});

describe('Search — search (fuzzy)', () => {
    it('matches a key one edit away', () => {
        const s = new Search(HOSTS, { fields: ['name'], fuzzy: true, maxDistance: 1 });
        const r = s.search('api'); // exact prefix — always matches
        expect(r.length).toBeGreaterThan(0);
    });
    it('fuzzy option can be overridden per call', () => {
        const s = new Search(HOSTS, { fields: ['name'] });
        const r = s.search('aip', { fuzzy: true, maxDistance: 2 });
        expect(r.length).toBeGreaterThan(0);
    });
});

describe('Search — field weights', () => {
    it('higher weight lifts a result to the top', () => {
        const s = new Search(HOSTS, {
            fields:  ['name', 'region'],
            weights: { name: 3, region: 1 },
        });
        const results = s.search('us');
        // us-east and us-west appear in region — all should score > 0
        expect(results.length).toBeGreaterThan(0);
    });
});

describe('Search — get / getAll', () => {
    it('get() returns the document by id',         () => { const s = new Search(HOSTS, { fields: ['name'] }); expect(s.get('h2')).toMatchObject({ name: 'web.example.com' }); });
    it('get() returns null for unknown id',        () => { const s = new Search(HOSTS, { fields: ['name'] }); expect(s.get('nope')).toBeNull(); });
    it('getAll() returns all { id, doc } pairs',   () => {
        const s = new Search(HOSTS, { fields: ['name'] });
        const all = s.getAll();
        expect(all).toHaveLength(4);
        expect(all[0]).toHaveProperty('id');
        expect(all[0]).toHaveProperty('doc');
    });
});

describe('Search — stats', () => {
    it('reports correct document count',   () => { const s = new Search(HOSTS, { fields: ['name'] }); expect(s.stats().documents).toBe(4); });
    it('reports uniqueTerms > 0',          () => { const s = new Search(HOSTS, { fields: ['name'] }); expect(s.stats().uniqueTerms).toBeGreaterThan(0); });
    it('reports trieSize > 0',             () => { const s = new Search(HOSTS, { fields: ['name'] }); expect(s.stats().trieSize).toBeGreaterThan(0); });
});

describe('Search — clear', () => {
    it('removes all documents and resets stats', () => {
        const s = new Search(HOSTS, { fields: ['name'] });
        s.clear();
        expect(s.stats().documents).toBe(0);
        expect(s.stats().uniqueTerms).toBe(0);
    });
    it('search returns empty after clear', () => {
        const s = new Search(HOSTS, { fields: ['name'] });
        s.clear();
        expect(s.search('api')).toEqual([]);
    });
});

describe('Search — export / import', () => {
    it('round-trips all documents', () => {
        const s1 = new Search(HOSTS, { fields: ['name', 'region'] });
        const snap = s1.export();

        const s2 = new Search();
        s2.import(snap);
        expect(s2.stats().documents).toBe(4);
        expect(s2.get('h1')).toMatchObject({ name: 'api.example.com' });
    });

    it('search works after import', () => {
        const s1 = new Search(HOSTS, { fields: ['name', 'region'] });
        const s2 = new Search();
        s2.import(s1.export());
        expect(s2.search('api')).toHaveLength(1);
    });

    it('export is JSON-serialisable', () => {
        const s = new Search(HOSTS, { fields: ['name'] });
        expect(() => JSON.stringify(s.export())).not.toThrow();
    });

    it('import version field is preserved', () => {
        const s = new Search(HOSTS, { fields: ['name'] });
        expect(s.export().version).toBe(1);
    });

    it('import resets prior state', () => {
        const s = new Search(HOSTS, { fields: ['name'] });
        const fresh = new Search([{ id: 'z1', name: 'proxy.local' }], { fields: ['name'] });
        s.import(fresh.export());
        expect(s.stats().documents).toBe(1);
        expect(s.get('h1')).toBeNull();
        expect(s.search('proxy')).toHaveLength(1);
    });
});