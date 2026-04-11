/**
 * oja/vector.js
 * In-memory vector store with optional persistence via Store or VFS.
 *
 * Works standalone (no persistence) or wired to Oja's existing storage:
 *   - Store  — session/local/memory storage (JSON, synchronous)
 *   - VFS    — IndexedDB-backed virtual filesystem (async, larger datasets)
 *
 * Uses similarity.js for distance math — no external dependencies.
 *
 * ─── Basic usage (in-memory, no persistence) ──────────────────────────────────
 *
 *   import { Vector } from '../ext/vector.js';
 *
 *   const db = new Vector();
 *   db.insert([0.1, 0.9, 0.3], { label: 'cat' });
 *   db.insert([0.8, 0.2, 0.1], { label: 'dog' });
 *
 *   db.search([0.1, 0.85, 0.25], { topK: 1 });
 *   // → [{ id, score: 0.999, metadata: { label: 'cat' } }]
 *
 * ─── With Store persistence ───────────────────────────────────────────────────
 *
 *   import { Store }  from '../core/store.js';
 *   import { Vector } from '../ext/vector.js';
 *
 *   const store = new Store('embeddings', { prefer: 'local' });
 *   const db    = new Vector({ store });
 *   // Vectors survive page reload
 *
 * ─── With VFS persistence (IndexedDB, large datasets) ────────────────────────
 *
 *   import { VFS }    from '../ext/vfs.js';
 *   import { Vector } from '../ext/vector.js';
 *
 *   const vfs = new VFS('my-app');
 *   const db  = new Vector({ vfs, namespace: 'embeddings' });
 *
 *   await db.ready(); // wait for initial VFS load
 *
 * ─── API ──────────────────────────────────────────────────────────────────────
 *
 *   db.insert(vector, metadata?, id?)   — add; throws on duplicate id
 *   db.upsert(vector, metadata, id?)    — add or replace
 *   db.get(id)                          — { id, vector, metadata }
 *   db.has(id)                          — boolean
 *   db.delete(id)                       — boolean
 *   db.clear()                          — remove all
 *   db.count(filter?)                   — number of entries
 *   db.ids()                            — string[]
 *
 *   db.search(queryVector, options?)
 *     options.topK     {number}   default 10
 *     options.minScore {number}   default 0     (0–1 for cosine, 0+ for others)
 *     options.metric   {string}   'cosine' | 'euclidean' | 'manhattan' | 'dot'
 *     options.filter   {Function} (metadata) => boolean
 *   → [{ id, score, metadata }]  sorted by score descending
 *
 *   db.save()                           — force persist (when autoSave false)
 *   await db.ready()                    — wait for VFS load
 *
 * ─── Static helpers ───────────────────────────────────────────────────────────
 *
 *   Vector.hashVector(text, dims=128)   — deterministic hash embedding (BoW-ish)
 *   Vector.normalize(v)                 — L2 unit vector
 */

import { cosine, euclidean, manhattan, dot, normalize } from '../utils/similarity.js';

const _METRICS = { cosine, euclidean, manhattan, dot };

// For cosine/dot higher = better; for euclidean/manhattan lower = better
const _HIGHER_IS_BETTER = { cosine: true, dot: true, euclidean: false, manhattan: false };

export class Vector {
    /**
     * @param {Object}  [options]
     * @param {Object}  [options.store]      — Oja Store instance for JSON persistence
     * @param {Object}  [options.vfs]        — Oja VFS instance for IndexedDB persistence
     * @param {string}  [options.namespace]  — storage key prefix (default: 'vec')
     * @param {string}  [options.metric]     — default search metric (default: 'cosine')
     * @param {boolean} [options.autoSave]   — persist on every write (default: true)
     * @param {number}  [options.dimensions] — optional dimension validation
     */
    constructor(options = {}) {
        this._store     = options.store     || null;
        this._vfs       = options.vfs       || null;
        this._ns        = options.namespace || 'vec';
        this._metric    = options.metric    || 'cosine';
        this._autoSave  = options.autoSave  !== false;
        this._dims      = options.dimensions || null;

        // In-memory map: id → { vector: number[], metadata: Object }
        this._map = new Map();

        // Monotonic counter for stable id generation
        this._counter = 0;

        // VFS load promise — resolves when initial load completes
        this._ready = this._vfs ? this._loadFromVFS() : this._loadFromStore();
    }

    // Lifecycle

    /**
     * Await this before using VFS-backed databases to ensure initial load.
     * Store-backed and in-memory databases resolve immediately.
     *
     * @returns {Promise<this>}
     */
    async ready() {
        await this._ready;
        return this;
    }

    // Writes

    /**
     * Insert a vector. Throws if the id already exists.
     *
     * @param {number[]} vector
     * @param {Object}   [metadata]
     * @param {string}   [id]       — auto-generated if omitted
     * @returns {string}             the id
     */
    insert(vector, metadata = {}, id = null) {
        const vid = id || this._genId();
        if (this._map.has(vid)) throw new Error(`[oja/vector] id "${vid}" already exists — use upsert()`);
        this._validate(vector);
        this._map.set(vid, { vector: vector.slice(), metadata: { ...metadata } });
        if (this._autoSave) this._persist();
        return vid;
    }

    /**
     * Insert or replace a vector.
     *
     * @param {number[]} vector
     * @param {Object}   [metadata]
     * @param {string}   [id]
     * @returns {string}
     */
    upsert(vector, metadata = {}, id = null) {
        const vid = id || this._genId();
        this._validate(vector);
        const existing = this._map.get(vid);
        this._map.set(vid, {
            vector: vector.slice(),
            metadata: existing ? { ...existing.metadata, ...metadata } : { ...metadata },
        });
        if (this._autoSave) this._persist();
        return vid;
    }

    /**
     * Retrieve a stored entry by id.
     *
     * @param {string} id
     * @returns {{ id, vector, metadata }|null}
     */
    get(id) {
        const entry = this._map.get(id);
        if (!entry) return null;
        return { id, vector: entry.vector.slice(), metadata: { ...entry.metadata } };
    }

    /** @param {string} id @returns {boolean} */
    has(id) { return this._map.has(id); }

    /**
     * Remove an entry.
     *
     * @param {string} id
     * @returns {boolean}
     */
    delete(id) {
        const removed = this._map.delete(id);
        if (removed && this._autoSave) this._persist();
        return removed;
    }

    /** Remove all entries. */
    clear() {
        this._map.clear();
        if (this._autoSave) this._persist();
    }

    // Reads

    /**
     * Count entries, optionally filtered by a metadata predicate.
     *
     * @param {Function} [filter]  — (metadata) => boolean
     * @returns {number}
     */
    count(filter = null) {
        if (!filter) return this._map.size;
        let n = 0;
        for (const { metadata } of this._map.values()) if (filter(metadata)) n++;
        return n;
    }

    /** @returns {string[]} */
    ids() { return Array.from(this._map.keys()); }

    // Search

    /**
     * Find the nearest neighbours to a query vector.
     *
     * @param {number[]} queryVector
     * @param {Object}   [options]
     * @param {number}   [options.topK=10]
     * @param {number}   [options.minScore=0]
     * @param {string}   [options.metric]    — overrides instance default
     * @param {Function} [options.filter]    — (metadata) => boolean
     * @returns {Array<{ id: string, score: number, metadata: Object }>}
     */
    search(queryVector, options = {}) {
        if (this._map.size === 0) return [];
        this._validate(queryVector);

        const metric   = options.metric   || this._metric;
        const topK     = options.topK     ?? 10;
        const minScore = options.minScore ?? 0;
        const filter   = options.filter   || null;
        const fn       = _METRICS[metric];
        if (!fn) throw new Error(`[oja/vector] unknown metric: "${metric}"`);

        const higherIsBetter = _HIGHER_IS_BETTER[metric];
        const results = [];

        for (const [id, { vector, metadata }] of this._map) {
            if (filter && !filter(metadata)) continue;
            const raw = fn(queryVector, vector);
            // Normalise to a 0-1 similarity score for uniform comparison
            const score = higherIsBetter ? raw : 1 / (1 + raw);
            if (score >= minScore) results.push({ id, score, metadata: { ...metadata } });
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }

    // Persistence

    /**
     * Force a persist cycle even when autoSave is false.
     */
    save() { this._persist(); }

    // Static helpers

    /**
     * L2-normalize a vector to unit length.
     * Delegates to similarity.js — available as a convenience.
     *
     * @param {number[]} v
     * @returns {number[]}
     */
    static normalize(v) { return normalize(v); }

    /**
     * Deterministic hash embedding.
     * Maps any text to a fixed-dimension float vector using character bigrams
     * and word hashing. Useful for demo, testing, and light similarity tasks
     * where a real embedding model is not available.
     *
     * In production, replace with an actual embedding model (e.g. via the
     * Claude API, transformers.js, or a WebAssembly model loaded via Wasm).
     *
     * @param {string} text
     * @param {number} [dimensions=128]
     * @returns {number[]}
     */
    static hashVector(text, dimensions = 128) {
        const vector = new Array(dimensions).fill(0);
        const s      = text.toLowerCase().trim();

        const hash = (str, seed = 0) => {
            let h = seed;
            for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
            return Math.abs(h);
        };

        // Character bigrams
        for (let i = 0; i < s.length - 1; i++) {
            vector[hash(s.slice(i, i + 2)) % dimensions] += 1;
        }
        // Words
        for (const word of s.split(/\s+/)) {
            if (word.length > 2) vector[hash(word, 31) % dimensions] += word.length;
        }

        return normalize(vector);
    }

    // Internal

    _genId() {
        return `${this._ns}_${Date.now().toString(36)}_${(++this._counter).toString(36)}`;
    }

    _validate(vector) {
        if (!Array.isArray(vector) || vector.length === 0) {
            throw new Error('[oja/vector] vector must be a non-empty array');
        }
        if (this._dims && vector.length !== this._dims) {
            throw new Error(`[oja/vector] expected ${this._dims} dimensions, got ${vector.length}`);
        }
    }

    // Serialize the in-memory map to a plain object for JSON storage
    _serialize() {
        return {
            ns:      this._ns,
            metric:  this._metric,
            counter: this._counter,
            entries: Array.from(this._map.entries()),
        };
    }

    // Restore from a plain object
    _deserialize(data) {
        if (!data) return;
        this._ns      = data.ns      ?? this._ns;
        this._metric  = data.metric  ?? this._metric;
        this._counter = data.counter ?? 0;
        this._map     = new Map(data.entries || []);
    }

    // Persistence backends

    _loadFromStore() {
        if (!this._store) return Promise.resolve();
        try {
            const raw = this._store.get(this._ns + ':data');
            if (raw) this._deserialize(raw);
        } catch (e) {
            console.warn('[oja/vector] failed to load from Store', e);
        }
        return Promise.resolve();
    }

    async _loadFromVFS() {
        try {
            const raw = await this._vfs.readText(`${this._ns}/.vector-index`);
            if (raw) this._deserialize(JSON.parse(raw));
        } catch {
            // Not yet persisted — start fresh
        }
    }

    _persist() {
        if (this._vfs) {
            // Fire-and-forget async VFS write
            const json = JSON.stringify(this._serialize());
            this._vfs.write(`${this._ns}/.vector-index`, json).catch(e => {
                console.warn('[oja/vector] VFS persist failed', e);
            });
        } else if (this._store) {
            try {
                this._store.set(this._ns + ':data', this._serialize());
            } catch (e) {
                console.warn('[oja/vector] Store persist failed', e);
            }
        }
        // No-op when in-memory only
    }
}
