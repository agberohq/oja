/**
 * tests/utils/similarity.test.js
 * Pure math — no DOM, no storage, no mocks needed.
 */
import { describe, it, expect } from 'vitest';
import {
    cosine, euclidean, manhattan, dot, normalize,
    tokenize, jaccard, jaccardNgram,
} from '../../src/js/utils/similarity.js';

// cosine

describe('cosine()', () => {
    it('identical vectors → 1', () => {
        expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    });
    it('orthogonal vectors → 0', () => {
        expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
    });
    it('opposite vectors → -1', () => {
        expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1);
    });
    it('general case', () => {
        expect(cosine([1, 2, 3], [4, 5, 6])).toBeCloseTo(0.9746, 3);
    });
    it('zero vector returns 0 (no NaN)', () => {
        expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0);
    });
    it('throws on dimension mismatch', () => {
        expect(() => cosine([1, 2], [1, 2, 3])).toThrow('dimension mismatch');
    });
});

// euclidean

describe('euclidean()', () => {
    it('identical → 0', () => {
        expect(euclidean([1, 2, 3], [1, 2, 3])).toBe(0);
    });
    it('3-4-5 triangle', () => {
        expect(euclidean([0, 0], [3, 4])).toBeCloseTo(5);
    });
    it('throws on mismatch', () => {
        expect(() => euclidean([1], [1, 2])).toThrow();
    });
});

// manhattan

describe('manhattan()', () => {
    it('identical → 0', () => {
        expect(manhattan([1, 2], [1, 2])).toBe(0);
    });
    it('taxicab distance', () => {
        expect(manhattan([0, 0], [3, 4])).toBe(7);
    });
});

// dot

describe('dot()', () => {
    it('basic dot product', () => {
        expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
    });
    it('unit vectors = cosine', () => {
        const a = normalize([1, 2, 3]);
        const b = normalize([4, 5, 6]);
        expect(dot(a, b)).toBeCloseTo(cosine(a, b), 5);
    });
    it('throws on mismatch', () => {
        expect(() => dot([1, 2], [1])).toThrow();
    });
});

// normalize

describe('normalize()', () => {
    it('produces unit vector', () => {
        const n = normalize([3, 4]);
        expect(n[0]).toBeCloseTo(0.6);
        expect(n[1]).toBeCloseTo(0.8);
        // magnitude = 1
        expect(Math.sqrt(n[0] ** 2 + n[1] ** 2)).toBeCloseTo(1);
    });
    it('does not mutate input', () => {
        const v = [3, 4];
        normalize(v);
        expect(v).toEqual([3, 4]);
    });
    it('zero vector returned as-is (no NaN)', () => {
        const n = normalize([0, 0, 0]);
        expect(n).toEqual([0, 0, 0]);
    });
});

// tokenize

describe('tokenize()', () => {
    it('lowercases and splits on whitespace', () => {
        expect(tokenize('Hello World')).toEqual(['hello', 'world']);
    });
    it('strips punctuation', () => {
        expect(tokenize('cats, dogs!')).toEqual(['cats', 'dogs']);
    });
    it('removes single-character tokens', () => {
        expect(tokenize('a cat')).toEqual(['cat']);
    });
    it('applies stopwords', () => {
        expect(tokenize('the cat sat', ['the', 'sat'])).toEqual(['cat']);
    });
    it('empty string returns empty array', () => {
        expect(tokenize('')).toEqual([]);
    });
});

// jaccard

describe('jaccard()', () => {
    it('identical text → 1', () => {
        expect(jaccard('cat sat mat', 'cat sat mat')).toBeCloseTo(1);
    });
    it('disjoint text → 0', () => {
        expect(jaccard('cat dog', 'fish bird')).toBe(0);
    });
    it('partial overlap', () => {
        // cat sat mat / cat sat hat: intersection={cat,sat} union={cat,sat,mat,hat}
        expect(jaccard('cat sat mat', 'cat sat hat')).toBeCloseTo(2 / 4);
    });
    it('accepts Set arguments', () => {
        const a = new Set(['cat', 'dog']);
        const b = new Set(['cat', 'fish']);
        expect(jaccard(a, b)).toBeCloseTo(1 / 3);
    });
    it('accepts array arguments', () => {
        expect(jaccard(['cat', 'dog'], ['cat', 'fish'])).toBeCloseTo(1 / 3);
    });
    it('both empty → 0', () => {
        expect(jaccard('', '')).toBe(0);
    });
    it('respects stopwords param', () => {
        // without stopwords 'the' would be counted
        const withStop    = jaccard('the cat', 'the dog', ['the']);
        const withoutStop = jaccard('the cat', 'the dog');
        expect(withStop).not.toBe(withoutStop);
    });
});

// jaccardNgram

describe('jaccardNgram()', () => {
    it('identical → 1', () => {
        expect(jaccardNgram('hello', 'hello')).toBeCloseTo(1);
    });
    it('completely different → 0', () => {
        expect(jaccardNgram('abc', 'xyz')).toBe(0);
    });
    it('bigrams: hello vs helo', () => {
        // hello bigrams: he el ll lo (4)
        // helo  bigrams: he el lo     (3)
        // intersection: he el lo (3), union: 4 → 3/4 = 0.75
        expect(jaccardNgram('hello', 'helo', 2)).toBeCloseTo(0.75, 2);
    });
    it('trigrams', () => {
        const r = jaccardNgram('abcde', 'abcde', 3);
        expect(r).toBeCloseTo(1);
    });
    it('both empty → 0', () => {
        expect(jaccardNgram('', '')).toBe(0);
    });
    it('n defaults to 2', () => {
        const r2 = jaccardNgram('hello', 'helo', 2);
        const rd = jaccardNgram('hello', 'helo');
        expect(rd).toBeCloseTo(r2);
    });
});
