/**
 * oja/similarity.js
 * Pure stateless similarity and distance functions.
 * No storage, no DOM, no classes — just math.
 * Safe to import in any environment: browser, Worker, Node, Bun, Deno.
 *
 * ─── Vector similarity ────────────────────────────────────────────────────────
 *
 *   import { cosine, euclidean, manhattan, dot } from '../utils/similarity.js';
 *
 *   cosine([1, 0, 0], [1, 0, 0]);      // → 1   (identical)
 *   cosine([1, 0, 0], [0, 1, 0]);      // → 0   (orthogonal)
 *   euclidean([0, 0], [3, 4]);         // → 5
 *   manhattan([0, 0], [3, 4]);         // → 7
 *   dot([1, 2, 3], [4, 5, 6]);         // → 32
 *
 * ─── Text similarity ──────────────────────────────────────────────────────────
 *
 *   import { jaccard, jaccardNgram, tokenize } from '../utils/similarity.js';
 *
 *   jaccard('the cat sat', 'the cat hat');   // → 0.5  (word-level)
 *   jaccardNgram('hello', 'helo', 2);        // → 0.6  (bigram character-level)
 *
 * ─── L2 normalization ─────────────────────────────────────────────────────────
 *
 *   import { normalize } from '../utils/similarity.js';
 *
 *   normalize([3, 4]);  // → [0.6, 0.8]  (unit vector)
 */

// Vector math

/**
 * Cosine similarity between two numeric vectors.
 * Returns a value in [-1, 1] — 1 means identical direction.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function cosine(a, b) {
    if (a.length !== b.length) throw new Error(`[oja/similarity] cosine: dimension mismatch ${a.length} vs ${b.length}`);
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        na  += a[i] * a[i];
        nb  += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
}

/**
 * Euclidean (L2) distance between two vectors.
 * Returns 0 for identical vectors, larger values for farther vectors.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function euclidean(a, b) {
    if (a.length !== b.length) throw new Error(`[oja/similarity] euclidean: dimension mismatch ${a.length} vs ${b.length}`);
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
    return Math.sqrt(sum);
}

/**
 * Manhattan (L1) distance between two vectors.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function manhattan(a, b) {
    if (a.length !== b.length) throw new Error(`[oja/similarity] manhattan: dimension mismatch ${a.length} vs ${b.length}`);
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum;
}

/**
 * Dot product of two vectors.
 * Equivalent to cosine similarity when both vectors are unit-length.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function dot(a, b) {
    if (a.length !== b.length) throw new Error(`[oja/similarity] dot: dimension mismatch ${a.length} vs ${b.length}`);
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
}

/**
 * L2-normalize a vector to unit length.
 * Returns a new array — does not mutate the input.
 *
 * @param {number[]} v
 * @returns {number[]}
 */
export function normalize(v) {
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    if (norm === 0) return v.slice();
    return v.map(x => x / norm);
}

// Text similarity

/**
 * Tokenize text into lowercase words (stopword-free by default).
 * Strips punctuation, splits on whitespace, removes single-character tokens.
 *
 * @param {string}   text
 * @param {string[]} [stopwords]  — words to exclude (default: none)
 * @returns {string[]}
 */
export function tokenize(text, stopwords = []) {
    const sw = stopwords.length ? new Set(stopwords) : null;
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1 && (!sw || !sw.has(w)));
}

/**
 * Jaccard similarity between two texts (word-level).
 * Returns a value in [0, 1] — 1 means identical word sets.
 *
 *   jaccard('the cat sat', 'the cat hat')  // → 0.5
 *
 * @param {string|Set|string[]} a  — text, Set of tokens, or token array
 * @param {string|Set|string[]} b
 * @param {string[]} [stopwords]
 * @returns {number}
 */
export function jaccard(a, b, stopwords = []) {
    const setA = _toSet(a, stopwords);
    const setB = _toSet(b, stopwords);
    if (setA.size === 0 && setB.size === 0) return 0;
    let intersect = 0;
    for (const token of setA) if (setB.has(token)) intersect++;
    return intersect / (setA.size + setB.size - intersect);
}

/**
 * Character n-gram Jaccard similarity.
 * Better than word-level Jaccard for short texts, typos, and non-English.
 *
 *   jaccardNgram('hello', 'helo', 2)  // → 0.6  (bigram similarity)
 *
 * @param {string} a
 * @param {string} b
 * @param {number} [n=2]  — n-gram size
 * @returns {number}
 */
export function jaccardNgram(a, b, n = 2) {
    const setA = _charNgrams(a, n);
    const setB = _charNgrams(b, n);
    if (setA.size === 0 && setB.size === 0) return 0;
    let intersect = 0;
    for (const ng of setA) if (setB.has(ng)) intersect++;
    return intersect / (setA.size + setB.size - intersect);
}

// Internal helpers

function _toSet(input, stopwords) {
    if (input instanceof Set) return input;
    if (Array.isArray(input)) return new Set(input);
    return new Set(tokenize(input, stopwords));
}

function _charNgrams(text, n) {
    const clean = text.toLowerCase().replace(/[^\w]/g, '');
    const out   = new Set();
    for (let i = 0; i <= clean.length - n; i++) out.add(clean.slice(i, i + n));
    return out;
}

// Similarity class

/**
 * Similarity — stateful document store with Jaccard-based search and
 * batch deduplication. A class wrapper around the pure functions above.
 *
 * Designed for: RSS deduplication, note similarity, search suggestions,
 * tag matching — any case where you maintain a corpus and query against it.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { Similarity } from '../utils/similarity.js';
 *
 *   const sim = new Similarity();
 *   sim.add('The cat sat on the mat.', { id: 'note-1' });
 *   sim.add('Dogs are loyal companions.', { id: 'note-2' });
 *
 *   sim.findSimilar('feline behavior', { topK: 2 });
 *   // → [{ id, text, metadata, score }]
 *
 * ─── Batch dedup (RSS / feed pattern) ────────────────────────────────────────
 *
 *   // Efficiently dedup incoming items against an existing corpus
 *   const { unique, duplicateOf } = sim.deduplicateBatch(
 *       incoming,            // Array<{ id, title, ... }>
 *       existing,            // Array<{ id, title, ... }>
 *       { threshold: 0.65, key: 'title' }
 *   );
 *
 * ─── Weighted mode (TF-weighted intersection) ─────────────────────────────────
 *
 *   const sim = new Similarity({ weighted: true });
 *   // Higher-frequency shared terms count more toward similarity
 *
 * @param {Object}  [options]
 * @param {boolean} [options.weighted]   — TF-weighted Jaccard (default: false)
 * @param {number}  [options.ngram]      — word n-gram size (default: 1)
 * @param {string[]}[options.stopwords]  — words to exclude
 */
export class Similarity {
    constructor(options = {}) {
        this._weighted  = options.weighted   || false;
        this._ngram     = options.ngram      || 1;
        this._stopwords = options.stopwords  || [];
        this._docs      = new Map(); // id → { text, metadata, tokens }
        this._counter   = 0;
    }

    // Document management

    /**
     * Add a document to the corpus.
     * @param {string} text
     * @param {Object} [metadata]
     * @param {string} [id]       — auto-generated if omitted
     * @returns {string} id
     */
    add(text, metadata = {}, id = null) {
        const did    = id || `sim_${Date.now().toString(36)}_${(++this._counter).toString(36)}`;
        const tokens = this._tokenize(text);
        this._docs.set(did, { text: text.trim(), metadata: { ...metadata }, tokens });
        return did;
    }

    /**
     * Add only if no document with this id already exists.
     * @param {string} text
     * @param {Object} [metadata]
     * @param {string} id        — required; used as the uniqueness key
     * @returns {string|null}    — id if added, null if already present
     */
    addIfNew(text, metadata = {}, id) {
        if (!id || this._docs.has(id)) return null;
        return this.add(text, metadata, id);
    }

    /** Remove a document by id. @returns {boolean} */
    remove(id) { return this._docs.delete(id); }

    /** Remove all documents. */
    clear() { this._docs.clear(); }

    /** @returns {number} */
    count() { return this._docs.size; }

    // Search

    /**
     * Find the most similar documents to a query string.
     *
     * @param {string} query
     * @param {Object} [options]
     * @param {number} [options.topK=5]
     * @param {number} [options.threshold=0]  — minimum score
     * @returns {Array<{ id, text, metadata, score }>}
     */
    findSimilar(query, options = {}) {
        const { topK = 5, threshold = 0 } = options;
        if (this._docs.size === 0) return [];
        const qt = this._tokenize(query);
        const results = [];
        for (const [id, { text, metadata, tokens }] of this._docs) {
            const score = this._sim(qt, tokens);
            if (score >= threshold) results.push({ id, text, metadata: { ...metadata }, score });
        }
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }

    /**
     * Find the single most similar document, or null if nothing exceeds threshold.
     * @param {string} query
     * @param {number} [threshold=0]
     * @returns {{ id, text, metadata, score }|null}
     */
    findMostSimilar(query, threshold = 0) {
        const r = this.findSimilar(query, { topK: 1, threshold });
        return r.length ? r[0] : null;
    }

    /**
     * Compare two raw strings without adding them to the corpus.
     * @param {string} a
     * @param {string} b
     * @returns {number} similarity score 0–1
     */
    compare(a, b) {
        return this._sim(this._tokenize(a), this._tokenize(b));
    }

    // Batch dedup

    /**
     * Deduplicate a batch of incoming items against an existing corpus.
     * Runs in O(incoming × existing) — use on bounded batches (< 500 each).
     *
     * Both incoming and existing are plain arrays of objects. `key` names the
     * text field to compare — defaults to 'title', falls back to 'text'.
     *
     *   const { unique, duplicateOf } = sim.deduplicateBatch(
     *       newItems, existingItems, { threshold: 0.65, key: 'title' }
     *   );
     *   // unique     → Array of items that are genuinely new
     *   // duplicateOf → Map<incoming.id, existing.id>
     *
     * @param {Object[]} incoming  — new items (must have .id + text field)
     * @param {Object[]} existing  — reference corpus (must have .id + text field)
     * @param {Object}   [options]
     * @param {number}   [options.threshold=0.65]
     * @param {string}   [options.key='title']   — which field to compare
     * @returns {{ unique: Object[], duplicateOf: Map<string,string> }}
     */
    deduplicateBatch(incoming, existing, options = {}) {
        const { threshold = 0.65, key = 'title' } = options;

        // Build a temp index from existing items
        const idx = new Similarity({ weighted: this._weighted, stopwords: this._stopwords });
        for (const ex of existing) {
            const text = ex[key] || ex.text || '';
            if (text) idx.add(text, {}, ex.id);
        }

        const unique      = [];
        const duplicateOf = new Map();
        // Track intra-batch duplicates too
        const seenTexts   = new Map(); // text → id

        for (const item of incoming) {
            const text = item[key] || item.text || '';
            if (!text) { unique.push(item); continue; }

            // Intra-batch check first
            let foundDupe = false;
            for (const [seenText, seenId] of seenTexts) {
                if (this.compare(text, seenText) >= threshold) {
                    duplicateOf.set(item.id, seenId);
                    foundDupe = true;
                    break;
                }
            }
            if (foundDupe) continue;

            // Check against existing corpus
            const match = idx.findMostSimilar(text, threshold);
            if (match) {
                duplicateOf.set(item.id, match.id);
            } else {
                unique.push(item);
                seenTexts.set(text, item.id);
                // Add to idx so later items in this batch are checked against it
                idx.add(text, {}, item.id);
            }
        }

        return { unique, duplicateOf };
    }

    /**
     * Find groups of near-duplicate documents within the current corpus.
     * Useful for corpus cleanup.
     *
     * @param {number} [threshold=0.8]
     * @returns {Array<Array<{ id, text, metadata, score }>>}
     */
    findDuplicates(threshold = 0.8) {
        const docs     = Array.from(this._docs.entries());
        const assigned = new Set();
        const groups   = [];

        for (let i = 0; i < docs.length; i++) {
            if (assigned.has(i)) continue;
            const [aid, a] = docs[i];
            const group    = [{ id: aid, text: a.text, metadata: { ...a.metadata }, score: 1 }];
            assigned.add(i);

            for (let j = i + 1; j < docs.length; j++) {
                if (assigned.has(j)) continue;
                const [bid, b] = docs[j];
                const score    = this._sim(a.tokens, b.tokens);
                if (score >= threshold) {
                    group.push({ id: bid, text: b.text, metadata: { ...b.metadata }, score });
                    assigned.add(j);
                }
            }
            if (group.length > 1) groups.push(group);
        }
        return groups;
    }

    // Internal

    _tokenize(text) {
        const words = tokenize(text, this._stopwords);
        if (this._ngram > 1) {
            const out = [...words];
            for (let n = 2; n <= this._ngram; n++) {
                for (let i = 0; i <= words.length - n; i++) {
                    out.push(words.slice(i, i + n).join('_'));
                }
            }
            if (this._weighted) return this._freq(out);
            return new Set(out);
        }
        if (this._weighted) return this._freq(words);
        return new Set(words);
    }

    _freq(tokens) {
        const m = new Map();
        for (const t of tokens) m.set(t, (m.get(t) || 0) + 1);
        return m;
    }

    _sim(a, b) {
        if (this._weighted) {
            // TF-weighted Jaccard: sum(min(tf_a, tf_b)) / sum(max(tf_a, tf_b))
            let inter = 0, union = 0;
            const keys = new Set([...a.keys(), ...b.keys()]);
            for (const k of keys) {
                const av = a.get(k) || 0, bv = b.get(k) || 0;
                inter += Math.min(av, bv);
                union += Math.max(av, bv);
            }
            return union === 0 ? 0 : inter / union;
        }
        if (a.size === 0 && b.size === 0) return 0;
        let inter = 0;
        for (const t of a) if (b.has(t)) inter++;
        return inter / (a.size + b.size - inter);
    }
}
