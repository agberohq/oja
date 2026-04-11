/**
 * tests/others/rag.test.js
 * RAG — BM25 retrieval-augmented generation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RAG } from '../../src/js/ext/rag.js';

// Helpers

function makeStore() {
    const _data = {};
    return {
        get: (key) => _data[key] ?? null,
        set: (key, val) => { _data[key] = val; },
        _data,
    };
}

function makeVFS() {
    const _files = {};
    return {
        readText: vi.fn(async (path) => _files[path] ?? null),
        write:    vi.fn(async (path, content) => { _files[path] = content; }),
        _files,
    };
}

// Document management

describe('RAG — document management', () => {
    let rag;
    beforeEach(() => { rag = new RAG(); });

    it('add() returns an id', () => {
        const id = rag.add('The cat sat on the mat.');
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
    });

    it('add() with explicit id', () => {
        rag.add('Hello world', {}, 'doc-1');
        expect(rag.get('doc-1')).toBeTruthy();
    });

    it('get() returns text and metadata', () => {
        const id = rag.add('Dogs are loyal.', { source: 'wiki' });
        const doc = rag.get(id);
        expect(doc.text).toBe('Dogs are loyal.');
        expect(doc.metadata.source).toBe('wiki');
    });

    it('get() returns null for missing id', () => {
        expect(rag.get('nope')).toBeNull();
    });

    it('get() returns metadata copy', () => {
        const id  = rag.add('text', { x: 1 });
        const doc = rag.get(id);
        doc.metadata.x = 99;
        expect(rag.get(id).metadata.x).toBe(1);
    });

    it('count() tracks documents', () => {
        expect(rag.count()).toBe(0);
        rag.add('one');
        rag.add('two');
        expect(rag.count()).toBe(2);
    });

    it('remove() returns true on success', () => {
        const id = rag.add('text');
        expect(rag.remove(id)).toBe(true);
        expect(rag.get(id)).toBeNull();
        expect(rag.count()).toBe(0);
    });

    it('remove() returns false for missing id', () => {
        expect(rag.remove('ghost')).toBe(false);
    });

    it('clear() removes all documents', () => {
        rag.add('one');
        rag.add('two');
        rag.clear();
        expect(rag.count()).toBe(0);
    });

    it('addMany() accepts string array', () => {
        rag.addMany(['first doc', 'second doc', 'third doc']);
        expect(rag.count()).toBe(3);
    });

    it('addMany() accepts object array', () => {
        rag.addMany([
            { text: 'doc one', metadata: { type: 'a' } },
            { text: 'doc two', metadata: { type: 'b' } },
        ]);
        expect(rag.count()).toBe(2);
    });

    it('addMany() respects explicit ids', () => {
        rag.addMany([{ text: 'hello', id: 'my-id' }]);
        expect(rag.get('my-id')).toBeTruthy();
    });

    it('add() trims whitespace from text', () => {
        const id = rag.add('  padded text  ');
        expect(rag.get(id).text).toBe('padded text');
    });
});

// Retrieval

describe('RAG — retrieve()', () => {
    let rag;
    beforeEach(() => {
        rag = new RAG({ stopwords: [] }); // disable stopwords for predictability
        rag.add('The cat sat on the mat.', {}, 'cat');
        rag.add('Dogs are loyal companions.', {}, 'dog');
        rag.add('Cats are independent animals.', {}, 'cats');
        rag.add('JavaScript is a programming language.', {}, 'js');
    });

    it('retrieve() returns array of results', () => {
        const r = rag.retrieve('cat behavior');
        expect(Array.isArray(r)).toBe(true);
    });

    it('most relevant doc scores highest', () => {
        const r = rag.retrieve('cat');
        expect(r[0].id).toMatch(/cat/);
    });

    it('results include text, metadata, score', () => {
        const r = rag.retrieve('cat');
        expect(typeof r[0].text).toBe('string');
        expect(typeof r[0].score).toBe('number');
        expect(typeof r[0].metadata).toBe('object');
    });

    it('results sorted by score descending', () => {
        const r = rag.retrieve('cat');
        for (let i = 1; i < r.length; i++) {
            expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
        }
    });

    it('topK limits results', () => {
        const r = rag.retrieve('animal', { topK: 2 });
        expect(r.length).toBeLessThanOrEqual(2);
    });

    it('minScore filters results', () => {
        const r = rag.retrieve('cat', { minScore: 0.5 });
        expect(r.every(e => e.score >= 0.5)).toBe(true);
    });

    it('empty store returns empty array', () => {
        const empty = new RAG();
        expect(empty.retrieve('anything')).toEqual([]);
    });

    it('unknown query returns empty or low-score results', () => {
        const r = rag.retrieve('quantum entanglement', { minScore: 0.5 });
        expect(r.length).toBe(0);
    });

    it('programming query finds JS doc', () => {
        const r = rag.retrieve('programming JavaScript');
        expect(r[0].id).toBe('js');
    });
});

// getContext

describe('RAG — getContext()', () => {
    let rag;
    beforeEach(() => {
        rag = new RAG({ stopwords: [] });
        rag.add('Cats are feline.', {}, 'c1');
        rag.add('Dogs are canine.', {}, 'c2');
    });

    it('returns concatenated text string', () => {
        const ctx = rag.getContext('feline cat');
        expect(typeof ctx).toBe('string');
        expect(ctx.length).toBeGreaterThan(0);
    });

    it('uses default separator', () => {
        rag.add('Birds can fly.', {}, 'c3');
        const ctx = rag.getContext('cat dog', { topK: 2 });
        expect(ctx).toContain('\n\n---\n\n');
    });

    it('accepts custom separator', () => {
        const ctx = rag.getContext('cat', { topK: 2 }, ' | ');
        expect(ctx).toContain(' | ');
    });

    it('empty store returns empty string', () => {
        expect(new RAG().getContext('anything')).toBe('');
    });
});

// getStats

describe('RAG — getStats()', () => {
    it('empty RAG stats', () => {
        const s = new RAG().getStats();
        expect(s.documentCount).toBe(0);
        expect(s.vocabularySize).toBe(0);
        expect(s.avgDocLength).toBe(0);
    });

    it('stats reflect added documents', () => {
        const rag = new RAG({ stopwords: [] });
        rag.add('cat sat');
        rag.add('dog ran');
        const s = rag.getStats();
        expect(s.documentCount).toBe(2);
        expect(s.vocabularySize).toBeGreaterThan(0);
        expect(s.avgDocLength).toBeGreaterThan(0);
    });

    it('stats include BM25 params', () => {
        const rag = new RAG({ k1: 1.5, b: 0.8 });
        expect(rag.getStats().bm25).toEqual({ k1: 1.5, b: 0.8 });
    });
});

// BM25 index rebuild

describe('RAG — index rebuild', () => {
    it('retrieve still works after remove()', () => {
        const rag = new RAG({ stopwords: [] });
        rag.add('alpha beta gamma', {}, 'd1');
        rag.add('delta epsilon zeta', {}, 'd2');
        rag.remove('d1');
        const r = rag.retrieve('delta epsilon');
        expect(r[0].id).toBe('d2');
    });

    it('retrieve works after clear() + re-add', () => {
        const rag = new RAG({ stopwords: [] });
        rag.add('old document', {}, 'd1');
        rag.clear();
        rag.add('fresh content', {}, 'd2');
        const r = rag.retrieve('fresh');
        expect(r[0].id).toBe('d2');
    });
});

// Store persistence

describe('RAG — Store persistence', () => {
    it('persists documents on add()', () => {
        const store = makeStore();
        const rag   = new RAG({ store, namespace: 'ragtest' });
        rag.add('persisted doc', {}, 'p1');
        expect(store._data['ragtest:docs']).toBeTruthy();
    });

    it('loads documents from Store on construction', () => {
        const store = makeStore();
        const rag1  = new RAG({ store, namespace: 'ragtest' });
        rag1.add('hello world', { src: 'test' }, 'load1');

        const rag2 = new RAG({ store, namespace: 'ragtest' });
        const doc  = rag2.get('load1');
        expect(doc).toBeTruthy();
        expect(doc.text).toBe('hello world');
        expect(doc.metadata.src).toBe('test');
    });

    it('retrieval works after loading from Store', () => {
        const store = makeStore();
        const rag1  = new RAG({ store, namespace: 'ragtest', stopwords: [] });
        rag1.add('The quick brown fox', {}, 'fox');
        rag1.add('A slow green turtle', {}, 'turtle');

        const rag2 = new RAG({ store, namespace: 'ragtest', stopwords: [] });
        const r    = rag2.retrieve('quick fox');
        expect(r[0].id).toBe('fox');
    });

    it('clear() removes stored docs', () => {
        const store = makeStore();
        const rag   = new RAG({ store, namespace: 'ragtest' });
        rag.add('something');
        rag.clear();
        const rag2 = new RAG({ store, namespace: 'ragtest' });
        expect(rag2.count()).toBe(0);
    });
});

// VFS persistence

describe('RAG — VFS persistence', () => {
    it('ready() resolves', async () => {
        const vfs = makeVFS();
        const rag = new RAG({ vfs, namespace: 'vrag' });
        await expect(rag.ready()).resolves.toBeTruthy();
    });

    it('loads docs from VFS on construction', async () => {
        const vfs  = makeVFS();
        const rag1 = new RAG({ vfs, namespace: 'vrag' });
        await rag1.ready();
        rag1.add('VFS stored doc', { x: 1 }, 'v1');
        await new Promise(r => setTimeout(r, 10));

        const rag2 = new RAG({ vfs, namespace: 'vrag' });
        await rag2.ready();
        expect(rag2.get('v1')?.text).toBe('VFS stored doc');
    });

    it('calls vfs.write on add()', async () => {
        const vfs = makeVFS();
        const rag = new RAG({ vfs, namespace: 'vrag' });
        await rag.ready();
        rag.add('some text');
        await new Promise(r => setTimeout(r, 10));
        expect(vfs.write).toHaveBeenCalledWith(
            expect.stringContaining('.rag-index'),
            expect.any(String),
        );
    });
});

// Configuration

describe('RAG — configuration', () => {
    it('custom k1 and b are stored', () => {
        const rag = new RAG({ k1: 1.5, b: 0.6 });
        expect(rag.k1).toBe(1.5);
        expect(rag.b).toBe(0.6);
    });

    it('custom stopwords exclude terms from index', () => {
        const rag = new RAG({ stopwords: ['cat', 'dog'] });
        rag.add('the cat and the dog');
        const s = rag.getStats();
        // 'cat' and 'dog' removed; remaining terms vary but vocab should be smaller
        expect(s.vocabularySize).toBeLessThan(5);
    });

    it('ngram=2 includes bigrams in vocabulary', () => {
        const rag1 = new RAG({ ngram: 1, stopwords: [] });
        const rag2 = new RAG({ ngram: 2, stopwords: [] });
        rag1.add('quick brown fox');
        rag2.add('quick brown fox');
        expect(rag2.getStats().vocabularySize).toBeGreaterThan(rag1.getStats().vocabularySize);
    });
});
