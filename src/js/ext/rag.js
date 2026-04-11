/**
 * oja/rag.js
 * BM25-based retrieval for retrieval-augmented generation (RAG).
 *
 * Uses Oja's existing Store or VFS for document persistence — no new
 * storage layer needed. The BM25 index is rebuilt in memory on load;
 * only the raw documents are persisted (index is deterministic).
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { RAG } from '../ext/rag.js';
 *
 *   const rag = new RAG();
 *   rag.add('The cat sat on the mat.');
 *   rag.add('Dogs are loyal companions.');
 *   rag.add('Cats are independent animals.');
 *
 *   const results = rag.retrieve('feline behavior', { topK: 2 });
 *   // → [{ id, text, score, metadata }]
 *
 *   const context = rag.getContext('feline behavior');
 *   // → 'The cat sat on the mat.\n\n---\n\nCats are independent...'
 *
 * ─── With Store persistence ───────────────────────────────────────────────────
 *
 *   import { Store } from '../core/store.js';
 *   import { RAG }   from '../ext/rag.js';
 *
 *   const store = new Store('rag-docs', { prefer: 'local' });
 *   const rag   = new RAG({ store });
 *   // Documents survive page reload; index rebuilt automatically.
 *
 * ─── With VFS persistence (large document sets) ───────────────────────────────
 *
 *   import { VFS } from '../ext/vfs.js';
 *   import { RAG } from '../ext/rag.js';
 *
 *   const vfs = new VFS('my-app');
 *   const rag = new RAG({ vfs, namespace: 'rag' });
 *   await rag.ready();
 *
 * ─── With Claude API (full RAG pipeline) ──────────────────────────────────────
 *
 *   const context  = rag.getContext(userQuery, { topK: 3 });
 *   const response = await fetch('https://api.anthropic.com/v1/messages', {
 *       method:  'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body:    JSON.stringify({
 *           model:      'claude-sonnet-4-20250514',
 *           max_tokens: 1000,
 *           messages:   [{
 *               role:    'user',
 *               content: `Context:\n${context}\n\nQuestion: ${userQuery}`,
 *           }],
 *       }),
 *   });
 *
 * ─── API ──────────────────────────────────────────────────────────────────────
 *
 *   rag.add(text, metadata?, id?)           — add a document
 *   rag.addMany([{ text, metadata? }])      — batch add
 *   rag.remove(id)                          — remove document + rebuild index
 *   rag.get(id)                             — { id, text, metadata }
 *   rag.clear()                             — remove all documents
 *   rag.count()                             — number of documents
 *
 *   rag.retrieve(query, options?)
 *     options.topK     {number}  default 3
 *     options.minScore {number}  default 0
 *   → [{ id, text, metadata, score }]
 *
 *   rag.getContext(query, options?, separator?)  → string
 *
 *   rag.getStats()   → { documentCount, vocabularySize, avgDocLength, bm25 }
 *   await rag.ready()
 */

import { tokenize } from '../utils/similarity.js';

// BM25 defaults (Robertson & Walker, well-validated values)
const BM25_K1 = 1.2;
const BM25_B  = 0.75;

export class RAG {
    /**
     * @param {Object}   [options]
     * @param {Object}   [options.store]      — Oja Store instance
     * @param {Object}   [options.vfs]        — Oja VFS instance
     * @param {string}   [options.namespace]  — storage key prefix (default: 'rag')
     * @param {number}   [options.k1]         — BM25 TF saturation (default 1.2)
     * @param {number}   [options.b]          — BM25 length norm (default 0.75)
     * @param {number}   [options.ngram]      — max n-gram size (default 1)
     * @param {string[]} [options.stopwords]  — words to exclude from index
     */
    constructor(options = {}) {
        this._store  = options.store  || null;
        this._vfs    = options.vfs    || null;
        this._ns     = options.namespace || 'rag';

        this.k1 = options.k1 ?? BM25_K1;
        this.b  = options.b  ?? BM25_B;

        this._ngram     = options.ngram ?? 1;
        this._stopwords = options.stopwords || _DEFAULT_STOPWORDS;

        // Document store: id → { text, metadata }
        this._docs = new Map();
        this._counter = 0;

        // BM25 index (rebuilt on demand — never persisted)
        this._vocab    = [];        // term[] sorted
        this._termIdx  = new Map(); // term → index
        this._idf      = [];        // idf[termIdx]
        this._docVecs  = new Map(); // id → Float32Array (BM25 weights, L2-normalised)
        this._dirty    = true;      // rebuild needed

        this._ready = this._vfs ? this._loadFromVFS() : this._loadFromStore();
    }

    // Lifecycle

    /** @returns {Promise<this>} */
    async ready() { await this._ready; return this; }

    // Writes

    /**
     * Add a single document.
     *
     * @param {string} text
     * @param {Object} [metadata]
     * @param {string} [id]
     * @returns {string} id
     */
    add(text, metadata = {}, id = null) {
        const did = id || this._genId();
        this._docs.set(did, { text: text.trim(), metadata: { ...metadata } });
        this._dirty = true;
        if (this._store || this._vfs) this._persist();
        return did;
    }

    /**
     * Add multiple documents efficiently (one index rebuild).
     *
     * @param {Array<string|{ text: string, metadata?: Object, id?: string }>} items
     */
    addMany(items) {
        for (const item of items) {
            const isStr = typeof item === 'string';
            const did   = (isStr ? null : item.id) || this._genId();
            const text  = isStr ? item : item.text;
            const meta  = isStr ? {} : (item.metadata || {});
            this._docs.set(did, { text: text.trim(), metadata: { ...meta } });
        }
        this._dirty = true;
        if (this._store || this._vfs) this._persist();
    }

    /**
     * Remove a document and invalidate the index.
     *
     * @param {string} id
     * @returns {boolean}
     */
    remove(id) {
        const removed = this._docs.delete(id);
        if (removed) {
            this._dirty = true;
            this._docVecs.delete(id);
            if (this._store || this._vfs) this._persist();
        }
        return removed;
    }

    /**
     * Retrieve a document by id.
     *
     * @param {string} id
     * @returns {{ id, text, metadata }|null}
     */
    get(id) {
        const doc = this._docs.get(id);
        if (!doc) return null;
        return { id, text: doc.text, metadata: { ...doc.metadata } };
    }

    /** Remove all documents and clear the index. */
    clear() {
        this._docs.clear();
        this._vocab   = [];
        this._termIdx = new Map();
        this._idf     = [];
        this._docVecs = new Map();
        this._dirty   = false;
        if (this._store || this._vfs) this._persist();
    }

    /** @returns {number} */
    count() { return this._docs.size; }

    /**
     * Add a document only if no document with this id already exists.
     * Idempotent — safe to call repeatedly with the same key (RSS feeds,
     * polling patterns). Returns the id if added, null if already present.
     *
     *   // Safe to call on every RSS poll — won't re-index duplicates
     *   rag.addDocumentIfNew(item.title, { url: item.link }, item.id);
     *
     * @param {string} text
     * @param {Object} [metadata]
     * @param {string} id        — required; the uniqueness key
     * @returns {string|null}
     */
    addDocumentIfNew(text, metadata = {}, id) {
        if (!id || this._docs.has(id)) return null;
        return this.add(text, metadata, id);
    }

    /**
     * Remove the N oldest documents to cap corpus size.
     * "Oldest" = insertion order (Map preserves insertion order in JS).
     *
     *   // Keep corpus bounded to 500 documents
     *   rag.add(newDoc);
     *   if (rag.count() > 500) rag.evictOldest(rag.count() - 500);
     *
     * @param {number} n  — number of documents to remove
     * @returns {string[]} ids of evicted documents
     */
    evictOldest(n) {
        const ids     = Array.from(this._docs.keys()).slice(0, n);
        let   changed = false;
        for (const id of ids) { this._docs.delete(id); this._docVecs.delete(id); changed = true; }
        if (changed) this._dirty = true;
        if (this._store || this._vfs) this._persist();
        return ids;
    }

    /**
     * Pre-build the BM25 index now rather than waiting for the first retrieve().
     * Call after bulk-loading documents when you want the first query to be fast.
     *
     *   rag.addMany(allDocs);
     *   await rag.warmup();   // index built — first query is instant
     *
     * @returns {this}
     */
    warmup() {
        if (this._dirty && this._docs.size > 0) this._buildIndex();
        return this;
    }

    // Retrieval

    /**
     * Retrieve the top-K most relevant documents for a query.
     *
     * @param {string} query
     * @param {Object} [options]
     * @param {number} [options.topK=3]
     * @param {number} [options.minScore=0]
     * @returns {Array<{ id: string, text: string, metadata: Object, score: number }>}
     */
    retrieve(query, options = {}) {
        if (this._docs.size === 0) return [];
        if (this._dirty) this._buildIndex();

        const topK     = options.topK     ?? 3;
        const minScore = options.minScore ?? 0;

        const qVec    = this._queryVector(query);
        const results = [];

        for (const [id, docVec] of this._docVecs) {
            const score = _dotF32(qVec, docVec);
            if (score >= minScore) {
                const doc = this._docs.get(id);
                results.push({ id, text: doc.text, metadata: { ...doc.metadata }, score });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }

    /**
     * Retrieve relevant documents and return concatenated text.
     * Ready to paste directly into an LLM context window.
     *
     * @param {string} query
     * @param {Object} [options]        — same as retrieve()
     * @param {string} [separator]
     * @returns {string}
     */
    getContext(query, options = {}, separator = '\n\n---\n\n') {
        return this.retrieve(query, options).map(d => d.text).join(separator);
    }

    // Statistics

    getStats() {
        if (this._dirty && this._docs.size > 0) this._buildIndex();
        const totalTokens = [...this._docs.values()]
            .reduce((s, d) => s + this._tok(d.text).length, 0);
        return {
            documentCount:  this._docs.size,
            vocabularySize: this._vocab.length,
            avgDocLength:   this._docs.size > 0
                ? +(totalTokens / this._docs.size).toFixed(2)
                : 0,
            bm25: { k1: this.k1, b: this.b },
            ngram: this._ngram,
        };
    }

    // Internal — BM25 index

    _tok(text) {
        const words = tokenize(text, this._stopwords);
        if (this._ngram <= 1) return words;
        const tokens = [...words];
        for (let n = 2; n <= this._ngram; n++) {
            for (let i = 0; i <= words.length - n; i++) {
                tokens.push(words.slice(i, i + n).join('_'));
            }
        }
        return tokens;
    }

    _buildIndex() {
        this._dirty = false;
        const docs  = Array.from(this._docs.entries()); // [id, {text}]
        const N     = docs.length;
        if (N === 0) return;

        // Build vocabulary
        const vocabSet = new Set();
        const tokenized = docs.map(([, d]) => {
            const toks = this._tok(d.text);
            toks.forEach(t => vocabSet.add(t));
            return toks;
        });
        this._vocab   = Array.from(vocabSet).sort();
        this._termIdx = new Map(this._vocab.map((t, i) => [t, i]));
        const V = this._vocab.length;

        // Term frequencies and document frequencies
        const df         = new Int32Array(V);
        const docLengths = new Float32Array(N);
        const tfMatrix   = tokenized.map((toks, d) => {
            docLengths[d] = toks.length;
            const freq     = new Map();
            for (const t of toks) freq.set(t, (freq.get(t) || 0) + 1);
            const tfArr = new Float32Array(V);
            for (const [t, f] of freq) {
                const idx = this._termIdx.get(t);
                if (idx !== undefined) { tfArr[idx] = f; df[idx]++; }
            }
            return tfArr;
        });

        // IDF (BM25 variant)
        this._idf = this._vocab.map((_, i) => {
            const dfi = df[i];
            return Math.log((N - dfi + 0.5) / (dfi + 0.5) + 1);
        });

        // Average document length
        const avgdl = docLengths.reduce((a, b) => a + b, 0) / N;

        // BM25 document vectors (L2-normalised for cosine dot-product search)
        this._docVecs = new Map();
        const { k1, b } = this;

        for (let d = 0; d < N; d++) {
            const id  = docs[d][0];
            const len = docLengths[d];
            const vec = new Float32Array(V);

            for (let i = 0; i < V; i++) {
                const tf = tfMatrix[d][i];
                if (tf > 0) {
                    const num = tf * (k1 + 1);
                    const den = tf + k1 * (1 - b + b * (len / avgdl));
                    vec[i]    = this._idf[i] * (num / den);
                }
            }

            // L2 normalise
            let norm = 0;
            for (let i = 0; i < V; i++) norm += vec[i] * vec[i];
            norm = Math.sqrt(norm) || 1;
            for (let i = 0; i < V; i++) vec[i] /= norm;

            this._docVecs.set(id, vec);
        }
    }

    _queryVector(query) {
        const V    = this._vocab.length;
        const toks = this._tok(query);
        const freq = new Map();
        for (const t of toks) freq.set(t, (freq.get(t) || 0) + 1);

        const vec = new Float32Array(V);
        let norm  = 0;
        for (const [t, tf] of freq) {
            const idx = this._termIdx.get(t);
            if (idx !== undefined) {
                vec[idx] = tf * this._idf[idx];
                norm     += vec[idx] * vec[idx];
            }
        }
        norm = Math.sqrt(norm) || 1;
        for (let i = 0; i < V; i++) vec[i] /= norm;
        return vec;
    }

    // Internal — ID and persistence

    _genId() {
        return `${this._ns}_${Date.now().toString(36)}_${(++this._counter).toString(36)}`;
    }

    _serialize() {
        return {
            ns:       this._ns,
            k1:       this.k1,
            b:        this.b,
            ngram:    this._ngram,
            counter:  this._counter,
            docs:     Array.from(this._docs.entries()),
        };
    }

    _deserialize(data) {
        if (!data) return;
        this._ns      = data.ns      ?? this._ns;
        this.k1       = data.k1      ?? this.k1;
        this.b        = data.b       ?? this.b;
        this._ngram   = data.ngram   ?? this._ngram;
        this._counter = data.counter ?? 0;
        this._docs    = new Map(data.docs || []);
        this._dirty   = true; // index must be rebuilt
    }

    _loadFromStore() {
        if (!this._store) return Promise.resolve();
        try {
            const raw = this._store.get(this._ns + ':docs');
            if (raw) this._deserialize(raw);
        } catch (e) {
            console.warn('[oja/rag] failed to load from Store', e);
        }
        return Promise.resolve();
    }

    async _loadFromVFS() {
        try {
            const raw = await this._vfs.readText(`${this._ns}/.rag-index`);
            if (raw) this._deserialize(JSON.parse(raw));
        } catch {
            // Not yet persisted — start fresh
        }
    }

    _persist() {
        const data = this._serialize();
        if (this._vfs) {
            this._vfs.write(`${this._ns}/.rag-index`, JSON.stringify(data)).catch(e => {
                console.warn('[oja/rag] VFS persist failed', e);
            });
        } else if (this._store) {
            try {
                this._store.set(this._ns + ':docs', data);
            } catch (e) {
                console.warn('[oja/rag] Store persist failed', e);
            }
        }
    }
}

// Internal helpers

function _dotF32(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
}

const _DEFAULT_STOPWORDS = [
    'the','a','an','and','or','but','in','on','at','to','for','of','with',
    'is','was','are','were','be','been','being','have','has','had','do','does',
    'did','will','would','could','should','may','might','can','this','that',
    'these','those','it','its','as','by','from','up','about','into','through',
    'not','no','nor','so','yet','both','each','few','more','most','other',
    'some','such','than','too','very','just','also','there','here','when',
    'where','who','which','what','how','all','any','if','then',
];
