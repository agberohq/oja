import { describe, it, expect, beforeEach } from 'vitest';
import { Trie, Search } from '../../src/js/utils/search.js';


describe('B-05: Search.import() — restores state on malformed data', () => {
    it('keeps previous state when import data is invalid', () => {
        const s = new Search([{ id: '1', name: 'apple' }], { fields: ['name'] });
        expect(s.search('apple')).toHaveLength(1);

        s.import({ options: null, trie: null, documents: null }); // should not throw
        // Previous state should be intact
        expect(s.search('apple')).toHaveLength(1);
    });

    it('does not throw on malformed trie data', () => {
        const s = new Search();
        expect(() => s.import({ options: {}, trie: { bad: true }, documents: [] })).not.toThrow();
    });

    it('successfully imports valid data', () => {
        const s1 = new Search([{ id: 'a', name: 'hello' }], { fields: ['name'] });
        const exported = s1.export();
        const s2 = new Search();
        s2.import(exported);
        expect(s2.search('hello')).toHaveLength(1);
    });
});


describe('D-04: Search — _fieldForTerm uses index-time cache', () => {
    it('search results include correct field in matches', () => {
        const s = new Search([{ id: '1', title: 'Oja Framework', description: 'reactive' }], {
            fields: ['title', 'description'], weights: { title: 2 },
        });
        const results = s.search('oja');
        expect(results.length).toBeGreaterThan(0);
        const match = results[0].matches.find(m => m.term === 'oja');
        expect(match?.field).toBe('title');
    });
});


describe('F-42: Trie.startsWith(prefix)', () => {
    it('returns true when any key starts with prefix', () => {
        const t = new Trie();
        t.insert('apple'); t.insert('apricot');
        expect(t.startsWith('ap')).toBe(true);
        expect(t.startsWith('apple')).toBe(true);
    });

    it('returns false when no key starts with prefix', () => {
        const t = new Trie();
        t.insert('banana');
        expect(t.startsWith('ap')).toBe(false);
    });

    it('returns true for empty prefix (any key exists)', () => {
        const t = new Trie();
        t.insert('x');
        expect(t.startsWith('')).toBe(true);
    });

    it('returns false on empty trie', () => {
        expect(new Trie().startsWith('a')).toBe(false);
    });
});


describe('F-43: Search.suggest(query)', () => {
    it('returns closest matching term for a typo', () => {
        const s = new Search(
            [{ id: '1', name: 'hosts' }, { id: '2', name: 'config' }],
            { fields: ['name'] }
        );
        const suggestion = s.suggest('hsts'); // typo for 'hosts'
        expect(suggestion).toBeTruthy();
        // Should suggest something close to 'hosts'
        expect(typeof suggestion).toBe('string');
    });

    it('returns null for empty query', () => {
        const s = new Search([{ id: '1', name: 'test' }], { fields: ['name'] });
        expect(s.suggest('')).toBeNull();
        expect(s.suggest(null)).toBeNull();
    });

    it('returns null on empty index', () => {
        expect(new Search().suggest('anything')).toBeNull();
    });
});


describe('D-05/D-06: fuzzy search visit cap', () => {
    it('completes fuzzy search without hanging on a large index', () => {
        const items = Array.from({ length: 200 }, (_, i) => ({
            id: String(i), name: `item-number-${i}-abcdef-ghijkl`,
        }));
        const s = new Search(items, { fields: ['name'], fuzzy: true });
        // Should complete quickly (not timeout)
        const results = s.search('ietm', { fuzzy: true, maxDistance: 2 });
        expect(Array.isArray(results)).toBe(true);
    });
});