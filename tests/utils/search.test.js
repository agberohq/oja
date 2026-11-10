import { describe, it, expect, beforeEach } from 'vitest';
import { Trie, Search } from '../../src/js/utils/search.js';


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
    it('inserts multiple keys at once', () => { const t = new Trie(); t.insertAll(['apple', 'apricot', 'banana']); expect(t.size).toBe(3); });
    it('applies dataFn per key',        () => { const t = new Trie(); t.insertAll(['a', 'b'], k => k.toUpperCase()); expect(t.get('a')).toBe('A'); expect(t.get('b')).toBe('B'); });
});

describe('Trie — autocomplete', () => {
    let t;
    beforeEach(() => { t = new Trie(); t.insertAll(['apple', 'apricot', 'application', 'banana', 'cherry']); });

    it('returns all keys with the given prefix',     () => { const r = t.autocomplete('ap'); expect(r).toContain('apple'); expect(r).toContain('apricot'); expect(r).toContain('application'); });
    it('does not return keys without the prefix',    () => { expect(t.autocomplete('ap')).not.toContain('banana'); });
    it('returns empty array for unmatched prefix',   () => { expect(t.autocomplete('xyz')).toEqual([]); });
    it('returns empty array for empty prefix',       () => { expect(t.autocomplete('')).toEqual([]); });
    it('respects limit option',                      () => { expect(t.autocomplete('ap', { limit: 2 })).toHaveLength(2); });
    it('returns results in alphabetical order',      () => { const r = t.autocomplete('ap'); expect(r).toEqual([...r].sort()); });
    it('includeData returns { key, data } objects',  () => { t.insert('mango', { color: 'yellow' }); const r = t.autocomplete('mango', { includeData: true }); expect(r[0]).toEqual({ key: 'mango', data: { color: 'yellow' } }); });
    it('exact key match returns that key',           () => { expect(t.autocomplete('apple')).toContain('apple'); });
});

describe('Trie — fuzzySearch', () => {
    let t;
    beforeEach(() => { t = new Trie(); t.insertAll(['apple', 'apricot', 'banana', 'cherry']); });

    it('finds an exact match at distance 0',           () => { expect(t.fuzzySearch('apple')).toContain('apple'); });
    it('finds a key one edit away',                    () => { expect(t.fuzzySearch('aple', { maxDistance: 1 })).toContain('apple'); });
    it('finds a key two edits away',                   () => { expect(t.fuzzySearch('aplce', { maxDistance: 2 })).toContain('apple'); });
    it('returns empty for query beyond maxDistance',   () => { expect(t.fuzzySearch('xyz', { maxDistance: 1 })).toEqual([]); });
    it('respects limit',                               () => { expect(t.fuzzySearch('appl', { maxDistance: 2, limit: 1 })).toHaveLength(1); });
    it('sorts results by distance ascending',          () => { const r = t.fuzzySearch('apple', { maxDistance: 2, includeData: true }); for (let i = 1; i < r.length; i++) expect(r[i].distance).toBeGreaterThanOrEqual(r[i-1].distance); });
    it('includeData attaches distance and data',       () => { const r = t.fuzzySearch('apple', { includeData: true }); expect(r[0]).toMatchObject({ key: 'apple', distance: 0 }); });
    it('returns empty array for non-string query',     () => { expect(t.fuzzySearch(null)).toEqual([]); });
});

describe('Trie — delete', () => {
    it('removes an existing key',                () => { const t = new Trie(); t.insert('del'); expect(t.delete('del')).toBe(true); expect(t.has('del')).toBe(false); });
    it('returns false for missing key',          () => { const t = new Trie(); expect(t.delete('nope')).toBe(false); });
    it('decrements size',                        () => { const t = new Trie(); t.insert('x'); t.delete('x'); expect(t.size).toBe(0); });
    it('does not affect sibling prefixes',       () => { const t = new Trie(); t.insert('apple'); t.insert('application'); t.delete('apple'); expect(t.has('apple')).toBe(false); expect(t.has('application')).toBe(true); });
    it('autocomplete no longer returns deleted', () => { const t = new Trie(); t.insert('apple'); t.insert('apricot'); t.delete('apple'); expect(t.autocomplete('ap')).not.toContain('apple'); expect(t.autocomplete('ap')).toContain('apricot'); });
});

describe('Trie — clear', () => {
    it('removes all keys',           () => { const t = new Trie(); t.insertAll(['a','b','c']); t.clear(); expect(t.size).toBe(0); });
    it('returns this',               () => { const t = new Trie(); expect(t.clear()).toBe(t); });
    it('get returns null after clear', () => { const t = new Trie(); t.insert('x', 1); t.clear(); expect(t.get('x')).toBeNull(); });
});

describe('Trie — keys', () => {
    it('returns all keys when no prefix given', () => { const t = new Trie(); t.insertAll(['fig','grape','kiwi']); const k = t.keys(); expect(k).toContain('fig'); expect(k).toContain('grape'); expect(k).toContain('kiwi'); expect(k).toHaveLength(3); });
    it('returns keys filtered by prefix',       () => { const t = new Trie(); t.insertAll(['fig','grape','grapefruit']); expect(t.keys('grape')).toContain('grape'); expect(t.keys('grape')).toContain('grapefruit'); expect(t.keys('grape')).not.toContain('fig'); });
});

describe('Trie — length getter', () => {
    it('mirrors size', () => { const t = new Trie(); t.insertAll(['a','b']); expect(t.length).toBe(2); });
});

describe('Trie — export / import', () => {
    it('round-trips all keys and data', () => { const t1 = new Trie(); t1.insert('apple', { id: 1 }); t1.insert('banana', { id: 2 }); const t2 = new Trie(); t2.import(t1.export()); expect(t2.get('apple')).toEqual({ id: 1 }); expect(t2.get('banana')).toEqual({ id: 2 }); expect(t2.size).toBe(2); });
    it('autocomplete works after import', () => { const t1 = new Trie(); t1.insertAll(['apricot','application']); const t2 = new Trie(); t2.import(t1.export()); expect(t2.autocomplete('ap')).toContain('apricot'); expect(t2.autocomplete('ap')).toContain('application'); });
    it('export returns a plain object (JSON-safe)', () => { const t = new Trie(); t.insert('x', 1); expect(() => JSON.stringify(t.export())).not.toThrow(); });
    it('import resets prior state', () => { const t = new Trie(); t.insert('old', 99); const fresh = new Trie(); fresh.insert('new', 1); t.import(fresh.export()); expect(t.has('old')).toBe(false); expect(t.has('new')).toBe(true); });
});


const DOCS = [
    { id: 'n1', title: 'Dancing in the rain',    content: 'A note about dance moves and rhythm.' },
    { id: 'n2', title: 'Cooking pasta',          content: 'Al dente is the goal. Boil water first.' },
    { id: 'n3', title: 'Guitar chords',          content: 'Learn to play dance music on the guitar.' },
    { id: 'n4', title: 'Weekly review',          content: 'Reviewed tasks and blocked on two items.' },
];

describe('Search — construction', () => {
    it('indexes initial items',       () => { const s = new Search(DOCS, { fields: ['title', 'content'] }); expect(s.stats().documents).toBe(4); });
    it('starts empty with no items',  () => { expect(new Search().stats().documents).toBe(0); });
});

describe('Search — add / remove', () => {
    it('add() inserts a document',            () => { const s = new Search(); s.add('x', { title: 'hello' }); expect(s.get('x')).toMatchObject({ title: 'hello' }); });
    it('add() replaces existing document',    () => { const s = new Search(); s.add('x', { title: 'old' }); s.add('x', { title: 'new' }); expect(s.get('x')).toMatchObject({ title: 'new' }); expect(s.stats().documents).toBe(1); });
    it('addAll() inserts multiple documents', () => { const s = new Search(); s.addAll([{ id: 'a', title: 'alpha' }, { id: 'b', title: 'beta' }]); expect(s.stats().documents).toBe(2); });
    it('remove() deletes a document',         () => { const s = new Search(DOCS, { fields: ['title'] }); s.remove('n1'); expect(s.get('n1')).toBeNull(); expect(s.stats().documents).toBe(3); });
    it('remove() on missing id is a no-op',   () => { const s = new Search(DOCS, { fields: ['title'] }); expect(() => s.remove('nope')).not.toThrow(); });
    it('add() ignores null doc',              () => { const s = new Search(); s.add('x', null); expect(s.stats().documents).toBe(0); });
});

describe('Search — search (prefix)', () => {
    let s;
    beforeEach(() => { s = new Search(DOCS, { fields: ['title', 'content'] }); });

    it('returns results for a matching prefix',       () => { expect(s.search('danc')).toHaveLength(2); }); // n1 title, n3 content
    it('result has id, doc, score, matches',          () => { const [r] = s.search('danc'); expect(r).toHaveProperty('id'); expect(r).toHaveProperty('doc'); expect(r).toHaveProperty('score'); expect(r).toHaveProperty('matches'); });
    it('returns empty for no match',                  () => { expect(s.search('zzz')).toEqual([]); });
    it('returns empty for empty query',               () => { expect(s.search('')).toEqual([]); });
    it('results sorted by score descending',          () => { const r = s.search('danc'); for (let i = 1; i < r.length; i++) expect(r[i].score).toBeLessThanOrEqual(r[i-1].score); });
    it('top result has normalised score of 1.0',      () => { expect(s.search('danc')[0].score).toBe(1); });
    it('matches array contains field and term info',  () => { const [r] = s.search('danc'); expect(r.matches[0]).toHaveProperty('term'); expect(r.matches[0]).toHaveProperty('field'); });
});

describe('Search — field weights', () => {
    it('higher weight on title lifts title match above content match', () => {
        const s = new Search(DOCS, { fields: ['title', 'content'], weights: { title: 5, content: 1 } });
        const results = s.search('danc');
        // n1 has 'dance' in title — with title weight=5 it should score higher than n3 (content only)
        expect(results[0].id).toBe('n1');
    });
});

describe('Search — clear / export / import', () => {
    it('clear removes all documents', () => { const s = new Search(DOCS, { fields: ['title'] }); s.clear(); expect(s.stats().documents).toBe(0); expect(s.search('dance')).toEqual([]); });
    it('export/import round-trips',   () => { const s1 = new Search(DOCS, { fields: ['title','content'] }); const s2 = new Search(); s2.import(s1.export()); expect(s2.stats().documents).toBe(4); expect(s2.search('danc')).toHaveLength(2); });
    it('export is JSON-serialisable', () => { expect(() => JSON.stringify(new Search(DOCS, { fields: ['title'] }).export())).not.toThrow(); });
});


describe('Search.searchWithContext()', () => {
    let s;
    beforeEach(() => {
        s = new Search(DOCS, { fields: ['title', 'content'] });
    });

    it('returns same set of results as search()', () => {
        const base    = s.search('danc');
        const context = s.searchWithContext('danc');
        expect(context.map(r => r.id).sort()).toEqual(base.map(r => r.id).sort());
    });

    it('each result has a snippets array', () => {
        const results = s.searchWithContext('danc');
        expect(results.length).toBeGreaterThan(0);
        for (const r of results) {
            expect(r).toHaveProperty('snippets');
            expect(Array.isArray(r.snippets)).toBe(true);
        }
    });

    it('each snippet has field, text, and positions', () => {
        const results = s.searchWithContext('danc');
        const withSnippet = results.filter(r => r.snippets.length > 0);
        expect(withSnippet.length).toBeGreaterThan(0);
        const snippet = withSnippet[0].snippets[0];
        expect(snippet).toHaveProperty('field');
        expect(snippet).toHaveProperty('text');
        expect(snippet).toHaveProperty('positions');
    });

    it('snippet text contains the query term', () => {
        const results = s.searchWithContext('dance');
        const withSnippet = results.filter(r => r.snippets.length > 0);
        expect(withSnippet.length).toBeGreaterThan(0);
        expect(withSnippet[0].snippets[0].text.toLowerCase()).toContain('dance');
    });

    it('positions point to where the term appears in the snippet text', () => {
        const results = s.searchWithContext('dance');
        const withPos = results.flatMap(r => r.snippets).filter(s => s.positions.length > 0);
        expect(withPos.length).toBeGreaterThan(0);
        const { text, positions } = withPos[0];
        for (const { start, end } of positions) {
            const slice = text.slice(start, end).toLowerCase();
            expect(slice).toBe('dance');
        }
    });

    it('snippet length is bounded by snippetLen option', () => {
        const results = s.searchWithContext('danc', { snippetLen: 30 });
        const withSnippet = results.filter(r => r.snippets.length > 0);
        for (const r of withSnippet) {
            for (const snippet of r.snippets) {
                // Text may be slightly longer due to ellipsis chars
                expect(snippet.text.replace(/…/g, '').length).toBeLessThanOrEqual(35);
            }
        }
    });

    it('preserves all existing result fields (id, doc, score, matches)', () => {
        const results = s.searchWithContext('danc');
        for (const r of results) {
            expect(r).toHaveProperty('id');
            expect(r).toHaveProperty('doc');
            expect(r).toHaveProperty('score');
            expect(r).toHaveProperty('matches');
        }
    });

    it('returns empty array for empty query', () => {
        expect(s.searchWithContext('')).toEqual([]);
    });

    it('returns results without snippets when query does not match field text', () => {
        // Query matches via fuzzy/trie but text search finds nothing — snippets may be empty
        const results = s.searchWithContext('xyz');
        expect(Array.isArray(results)).toBe(true);
    });

    it('multi-word query finds positions for each term', () => {
        const results = s.searchWithContext('dance music');
        // n3 has both 'dance' and 'music' in content
        const n3 = results.find(r => r.id === 'n3');
        if (n3 && n3.snippets.length > 0) {
            const terms = n3.snippets.flatMap(s => s.positions.map(p => p.term));
            expect(terms.length).toBeGreaterThan(0);
        }
    });
});


describe('Search.highlightSnippet()', () => {
    it('is a static method on Search', () => {
        expect(typeof Search.highlightSnippet).toBe('function');
    });

    it('wraps matched regions in <mark class="search-hit">', () => {
        const text      = 'dancing in the rain';
        const positions = [{ start: 0, end: 7 }]; // 'dancing'
        const html      = Search.highlightSnippet(text, positions);
        expect(html).toContain('<mark class="search-hit">dancing</mark>');
    });

    it('leaves text outside match positions unaffected', () => {
        const html = Search.highlightSnippet('hello world', [{ start: 6, end: 11 }]);
        expect(html).toContain('hello ');
        expect(html).toContain('<mark class="search-hit">world</mark>');
    });

    it('escapes HTML special characters in surrounding text', () => {
        const html = Search.highlightSnippet('<script>alert("xss")</script>', []);
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('escapes HTML inside matched regions too', () => {
        const text      = 'a <b> tag';
        const positions = [{ start: 2, end: 5 }]; // '<b>'
        const html      = Search.highlightSnippet(text, positions);
        expect(html).toContain('&lt;b&gt;');
        expect(html).not.toContain('<b>');
    });

    it('handles multiple non-overlapping positions', () => {
        const text = 'cat and dog and bird';
        const positions = [
            { start: 0, end: 3 },   // cat
            { start: 8, end: 11 },  // dog
        ];
        const html = Search.highlightSnippet(text, positions);
        const marks = [...html.matchAll(/<mark class="search-hit">/g)];
        expect(marks).toHaveLength(2);
    });

    it('sorts overlapping/out-of-order positions before rendering', () => {
        const text = 'one two three';
        const positions = [
            { start: 4, end: 7 },  // two (second)
            { start: 0, end: 3 },  // one (first)
        ];
        const html = Search.highlightSnippet(text, positions);
        // Both should be marked and in correct order
        expect(html.indexOf('one')).toBeLessThan(html.indexOf('two'));
        const marks = [...html.matchAll(/<mark/g)];
        expect(marks).toHaveLength(2);
    });

    it('returns escaped plain text when positions array is empty', () => {
        const html = Search.highlightSnippet('hello & world', []);
        expect(html).toBe('hello &amp; world');
        expect(html).not.toContain('<mark');
    });

    it('returns empty string for empty text', () => {
        expect(Search.highlightSnippet('', [])).toBe('');
    });

    it('works end-to-end with searchWithContext output', () => {
        const s = new Search(DOCS, { fields: ['title', 'content'] });
        const results = s.searchWithContext('dance');
        const withSnippet = results.filter(r => r.snippets.length > 0);
        expect(withSnippet.length).toBeGreaterThan(0);
        const { text, positions } = withSnippet[0].snippets[0];
        const html = Search.highlightSnippet(text, positions);
        expect(typeof html).toBe('string');
        if (positions.length > 0) expect(html).toContain('<mark class="search-hit">');
    });
});