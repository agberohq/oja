/**
 * oja/search.js
 * Pure data structures for prefix-based search and full-document indexing.
 * No DOM dependency — safe to import in any environment including Node/Vitest.
 *
 * ─── Trie — fast prefix tree ──────────────────────────────────────────────────
 *
 *   import { Trie } from '../oja/src/js/utils/search.js';
 *
 *   const trie = new Trie();
 *   trie.insert('apple', { id: 1 });
 *   trie.insert('apricot', { id: 2 });
 *
 *   trie.autocomplete('ap');           // → ['apple', 'apricot']
 *   trie.get('apple');                 // → { id: 1 }
 *   trie.fuzzySearch('aple', { maxDistance: 1 }); // → ['apple']
 *
 *   // Persistence
 *   const snapshot = trie.export();
 *   const trie2 = new Trie();
 *   trie2.import(snapshot);
 *
 * ─── Search — multi-field document index ─────────────────────────────────────
 *
 *   import { Search } from '../oja/src/js/utils/search.js';
 *
 *   const search = new Search(hosts, {
 *       fields:  ['name', 'region', 'status'],
 *       weights: { name: 2 },
 *       fuzzy:   true,
 *   });
 *
 *   const results = search.search('api');
 *   // → [{ id, doc, score, matches }]  sorted by score desc
 *
 *   // Persistence
 *   localStorage.setItem('idx', JSON.stringify(search.export()));
 *   const search2 = new Search();
 *   search2.import(JSON.parse(localStorage.getItem('idx')));
 */

// ─── Trie node ────────────────────────────────────────────────────────────────

class TrieNode {
    constructor() {
        this.children = new Map();
        this.isEnd    = false;
        this.data     = null;
    }
}

// ─── Trie ─────────────────────────────────────────────────────────────────────

// ─── Runtime-configurable fuzzy visit cap ───────────────────────────────
// Default: 10_000 visited nodes per fuzzy search. Increase for large indexes:
//   import { runtime } from './runtime.js';
//   runtime.define('search.fuzzyVisitCap', 50_000);
function _getFuzzyCap() {
    try {
        return globalThis.__oja_runtime_get?.('search.fuzzyVisitCap') ?? 10_000;
    } catch { return 10_000; }
}

export class Trie {
    constructor() {
        this.root = new TrieNode();
        this.size = 0;
    }

    /**
     * Insert a key with optional associated data.
     * Inserting the same key twice updates the data without changing size.
     */
    insert(key, data = null) {
        if (!key || typeof key !== 'string') return this;

        let node = this.root;
        const normalized = key.toLowerCase();

        for (const char of normalized) {
            if (!node.children.has(char)) node.children.set(char, new TrieNode());
            node = node.children.get(char);
        }

        if (!node.isEnd) {
            node.isEnd = true;
            this.size++;
        }
        node.data = data;
        return this;
    }

    /**
     * Insert multiple keys, with an optional function to produce data per key.
     */
    insertAll(keys, dataFn = null) {
        for (const key of keys) this.insert(key, dataFn ? dataFn(key) : null);
        return this;
    }

    /**
     * Return the data stored at an exact key, or null if not found.
     */
    get(key) {
        if (!key || typeof key !== 'string') return null;
        let node = this.root;
        for (const char of key.toLowerCase()) {
            if (!node.children.has(char)) return null;
            node = node.children.get(char);
        }
        return node.isEnd ? node.data : null;
    }

    /**
     * Return true if any key starts with the given prefix.
     * Cheaper than autocomplete(prefix, { limit: 1 }).length > 0.
     *
     *   trie.startsWith('ap'); // → true
     */
    startsWith(prefix) {
        if (!prefix || typeof prefix !== 'string') return this.root.children.size > 0;
        let node = this.root;
        for (const char of prefix.toLowerCase()) {
            if (!node.children.has(char)) return false;
            node = node.children.get(char);
        }
        return true;
    }

    /**
     * Return true if the key exists in the trie.
     */
    has(key) {
        if (!key || typeof key !== 'string') return false;
        let node = this.root;
        for (const char of key.toLowerCase()) {
            if (!node.children.has(char)) return false;
            node = node.children.get(char);
        }
        return node.isEnd;
    }

    /**
     * Return all keys that start with prefix.
     * @param {string} prefix
     * @param {{ limit?: number, includeData?: boolean }} options
     * @returns {Array<string | { key: string, data: any }>}
     */
    autocomplete(prefix, options = {}) {
        const { limit = 10, includeData = false } = options;
        if (!prefix || typeof prefix !== 'string') return [];

        let node = this.root;
        const normalized = prefix.toLowerCase();

        for (const char of normalized) {
            if (!node.children.has(char)) return [];
            node = node.children.get(char);
        }

        const results = [];
        this._collect(node, normalized, results, limit, includeData);
        return results;
    }

    /**
     * Return keys within maxDistance edits of query (Levenshtein).
     * @param {string} query
     * @param {{ maxDistance?: number, limit?: number, includeData?: boolean }} options
     * @returns {Array<string | { key: string, data: any, distance: number }>}
     */
    fuzzySearch(query, options = {}) {
        const { maxDistance = 2, limit = 10, includeData = false } = options;
        if (!query || typeof query !== 'string') return [];

        const normalized = query.toLowerCase();
        const candidates = [];
        const visited    = new Map();

        this._fuzzyCollect(this.root, '', normalized, candidates, maxDistance, visited);

        candidates.sort((a, b) => a.distance - b.distance || a.key.localeCompare(b.key));

        const limited = candidates.slice(0, limit);
        if (includeData) return limited;
        return limited.map(r => r.key);
    }

    /**
     * Delete a key. Returns true if deleted, false if not found.
     */
    delete(key) {
        if (!key || typeof key !== 'string') return false;

        const normalized = key.toLowerCase();
        const path = [];
        let node = this.root;

        for (const char of normalized) {
            if (!node.children.has(char)) return false;
            path.push({ node, char });
            node = node.children.get(char);
        }

        if (!node.isEnd) return false;

        node.isEnd = false;
        node.data  = null;
        this.size--;

        for (let i = path.length - 1; i >= 0; i--) {
            const { node: parent, char } = path[i];
            const child = parent.children.get(char);
            if (child.children.size === 0 && !child.isEnd) {
                parent.children.delete(char);
            } else {
                break;
            }
        }

        return true;
    }

    /**
     * Remove all entries.
     */
    clear() {
        this.root = new TrieNode();
        this.size = 0;
        return this;
    }

    /**
     * Return all keys, optionally filtered to those starting with prefix.
     */
    keys(prefix = '') {
        if (!prefix) {
            const results = [];
            this._collect(this.root, '', results, Infinity, false);
            return results;
        }
        return this.autocomplete(prefix, { limit: Infinity });
    }

    get length() {
        return this.size;
    }

    /**
     * Serialize the trie to a plain object for JSON persistence.
     */
    export() {
        const serialize = (node) => {
            const obj = {};
            if (node.isEnd) obj.d = node.data;
            if (node.children.size > 0) {
                obj.c = {};
                for (const [char, child] of node.children) obj.c[char] = serialize(child);
            }
            return obj;
        };
        return serialize(this.root);
    }

    /**
     * Restore a trie from a previously exported snapshot.
     */
    import(data) {
        this.root = new TrieNode();
        this.size = 0;

        const deserialize = (obj) => {
            const node = new TrieNode();
            if (obj.d !== undefined) {
                node.isEnd = true;
                node.data  = obj.d;
                this.size++;
            }
            if (obj.c) {
                for (const [char, childObj] of Object.entries(obj.c)) {
                    node.children.set(char, deserialize(childObj));
                }
            }
            return node;
        };

        this.root = deserialize(data);
        return this;
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    _collect(node, current, results, limit, includeData) {
        if (results.length >= limit) return;
        if (node.isEnd) {
            results.push(includeData ? { key: current, data: node.data } : current);
        }
        // Sort children for consistent ordering across environments
        const sorted = Array.from(node.children.keys()).sort();
        for (const char of sorted) {
            if (results.length >= limit) break;
            this._collect(node.children.get(char), current + char, results, limit, includeData);
        }
    }

    _fuzzyCollect(node, current, query, results, maxDistance, visited) {
        if (!node) return;
        // Safety cap prevents unbounded visited map growth.
        // Cap is runtime-configurable via runtime.define('search.fuzzyVisitCap', N).
        const cap = _getFuzzyCap();
        if (visited.size > cap) return;

        const distance = _levenshtein(current, query);
        if (distance <= maxDistance) {
            const best = visited.get(current);
            if (best === undefined || distance < best) {
                visited.set(current, distance);
                if (node.isEnd) results.push({ key: current, data: node.data, distance });
            }
        }

        // Prune branches that can't possibly reach maxDistance
        if (current.length > query.length + maxDistance) return;

        for (const [char, child] of node.children) {
            this._fuzzyCollect(child, current + char, query, results, maxDistance, visited);
        }
    }
}

// ─── Search ───────────────────────────────────────────────────────────────────

export class Search {
    /**
     * @param {Array<Object>} items  Initial documents (each must have an id field)
     * @param {Object} options
     *   fields      : string[]  Fields to index  (default: ['name','title','description','content'])
     *   weights     : Object    Per-field score multiplier (default: 1 for all)
     *   fuzzy       : boolean   Enable fuzzy matching  (default: false)
     *   maxDistance : number    Max Levenshtein distance for fuzzy  (default: 2)
     *   minScore    : number    Minimum normalised score to include  (default: 0.2)
     */
    constructor(items = [], options = {}) {
        this._opts = {
            fields:      ['name', 'title', 'description', 'content'],
            weights:     {},
            fuzzy:       false,
            maxDistance: 2,
            minScore:    0.2,
            ...options,
        };

        this._trie       = new Trie();
        this._docs       = new Map(); // id → document
        this._index      = new Map(); // term → Set<id>
        this._fieldCache = new Map(); // D-04: id:term → field (built at add() time)

        for (const item of items) {
            if (item.id != null) this.add(String(item.id), item);
        }
    }

    /**
     * Add or replace a document. Replaces all indexed terms for that id.
     */
    add(id, doc) {
        if (id == null || !doc) return this;
        if (this._docs.has(id)) this._removeById(id);

        this._docs.set(id, doc);

        for (const field of this._opts.fields) {
            const value = doc[field];
            if (!value || typeof value !== 'string') continue;

            for (const term of _tokenize(value)) {
                if (!this._index.has(term)) {
                    this._index.set(term, new Set());
                    this._trie.insert(term, term);
                }
                this._index.get(term).add(id);
                // D-04: cache field for this id:term pair at index time
                const cacheKey = `${id} ${term}`;
                if (!this._fieldCache.has(cacheKey)) this._fieldCache.set(cacheKey, field);
            }
        }

        return this;
    }

    /**
     * Add multiple documents at once. Each must have an id property.
     */
    addAll(docs) {
        for (const doc of docs) {
            if (doc.id != null) this.add(String(doc.id), doc);
        }
        return this;
    }

    /**
     * Remove a document by id.
     */
    remove(id) {
        return this._removeById(id);
    }

    /**
     * Search documents and return scored results.
     * @param {string} query
     * @param {Object} overrides  Per-call option overrides
     * @returns {Array<{ id: string, doc: Object, score: number, matches: Array }>}
     */
    search(query, overrides = {}) {
        if (!query || typeof query !== 'string') return [];

        const opts       = { ...this._opts, ...overrides };
        const terms      = _tokenize(query.toLowerCase());
        const scores     = new Map(); // id → { doc, score, matches }

        for (const term of terms) {
            let matchedTerms;

            if (opts.fuzzy) {
                matchedTerms = this._trie.fuzzySearch(term, {
                    maxDistance: opts.maxDistance,
                    limit:       200,
                    includeData: true,
                });
            } else {
                matchedTerms = this._trie.autocomplete(term, {
                    limit:       200,
                    includeData: true,
                }).map(m => ({ key: m.key, data: m.data, distance: 0 }));
            }

            for (const { key: matched, distance } of matchedTerms) {
                const ids = this._index.get(matched);
                if (!ids) continue;

                const termScore = _termScore(term, matched, distance);

                for (const id of ids) {
                    const doc = this._docs.get(id);
                    if (!doc) continue;

                    // Determine which field this term came from for weight lookup
                    const field      = this._fieldForTerm(doc, matched, id);
                    const weight     = opts.weights[field] ?? 1;

                    if (!scores.has(id)) scores.set(id, { id, doc, score: 0, matches: [] });

                    const entry = scores.get(id);
                    entry.score += termScore * weight;
                    entry.matches.push({ term: matched, field, score: termScore });
                }
            }
        }

        // Normalise scores and apply minScore filter
        let max = 0;
        for (const entry of scores.values()) max = Math.max(max, entry.score);

        return Array.from(scores.values())
            .map(entry => ({ ...entry, score: max > 0 ? entry.score / max : 0 }))
            .filter(entry => entry.score >= opts.minScore)
            .sort((a, b) => b.score - a.score);
    }

    /**
     * Search with result context — extends search() to include snippet text
     * and character-level match positions for highlight rendering.
     *
     * @param {string} query
     * @param {Object} opts
     *   snippetLen : number   Characters of context around the first match (default 140)
     *   ...plus all search() overrides
     * @returns {Array<{ id, doc, score, matches, snippets: [{ field, text, positions }] }>}
     *
     *   // Render with highlights:
     *   const results = search.searchWithContext('dance');
     *   for (const r of results) {
     *     const s = r.snippets[0];
     *     if (s) el.innerHTML = Search.highlightSnippet(s.text, s.positions);
     *   }
     */
    searchWithContext(query, opts = {}) {
        const { snippetLen = 140, ...searchOpts } = opts;
        const results = this.search(query, searchOpts);
        if (!query?.trim() || !results.length) return results;

        const terms = _tokenize(query.toLowerCase());

        return results.map(result => {
            const { doc } = result;
            const snippets = [];
            const fieldsHit = new Set(result.matches.map(m => m.field).filter(Boolean));

            for (const field of fieldsHit) {
                const text = doc[field];
                if (!text || typeof text !== 'string') continue;
                const lower = text.toLowerCase();
                const positions = [];

                for (const term of terms) {
                    let idx = 0;
                    while (true) {
                        const i = lower.indexOf(term, idx);
                        if (i === -1) break;
                        positions.push({ start: i, end: i + term.length, term });
                        idx = i + term.length;
                    }
                }

                if (!positions.length) continue;

                // Build snippet window around the first match
                const first = positions[0];
                const center = Math.floor((first.start + first.end) / 2);
                const from   = Math.max(0, center - Math.floor(snippetLen / 2));
                const to     = Math.min(text.length, from + snippetLen);
                const prefix = from > 0 ? '…' : '';
                const suffix = to < text.length ? '…' : '';
                const snippet = prefix + text.slice(from, to) + suffix;

                // Positions relative to snippet
                const offset = from - (prefix ? 1 : 0);
                const relPositions = positions
                    .filter(p => p.start >= from && p.end <= to)
                    .map(p => ({ start: p.start - from + (prefix ? 1 : 0), end: p.end - from + (prefix ? 1 : 0), term: p.term }));

                snippets.push({ field, text: snippet, positions: relPositions });
            }

            return { ...result, snippets };
        });
    }

    /**
     * Convert a snippet string and its match positions into an HTML string
     * with <mark class="search-hit"> tags around each matched region.
     * Safe — escapes HTML in the surrounding text.
     *
     * @param {string} text       — the snippet text (from searchWithContext)
     * @param {Array}  positions  — [{ start, end }] from searchWithContext
     * @returns {string}          — HTML string, safe to set as innerHTML
     */
    static highlightSnippet(text, positions = []) {
        if (!text) return '';
        if (!positions.length) return _escHtml(text);

        const sorted = [...positions].sort((a, b) => a.start - b.start);
        let out = '';
        let cursor = 0;

        for (const { start, end } of sorted) {
            if (start >= cursor) {
                out += _escHtml(text.slice(cursor, start));
                out += `<mark class="search-hit">${_escHtml(text.slice(start, end))}</mark>`;
                cursor = end;
            }
        }

        out += _escHtml(text.slice(cursor));
        return out;
    }

    /**
     * Return a document by id, or null if not found.
     */
    get(id) {
        return this._docs.get(id) ?? null;
    }

    /**
     * Return all documents as an array of { id, doc } pairs.
     */
    getAll() {
        return Array.from(this._docs.entries()).map(([id, doc]) => ({ id, doc }));
    }

    /**
     * Return index statistics: document count, unique term count, trie size.
     */
    /**
     *  "Did you mean?" — returns the closest matching term when no exact
     * results are found. Returns null if the index is empty or query is blank.
     *
     *   search.suggest('hsts'); // → 'hosts'
     */
    suggest(query, options = {}) {
        if (!query || typeof query !== 'string') return null;
        const { maxDistance = 2 } = options;
        const terms = _tokenize(query.toLowerCase());
        if (!terms.length) return null;

        let best = null;
        let bestDist = Infinity;

        for (const term of terms) {
            const candidates = this._trie.fuzzySearch(term, {
                maxDistance,
                limit: 5,
                includeData: true,
            });
            for (const { key, distance } of candidates) {
                if (distance < bestDist) {
                    bestDist = distance;
                    best = key;
                }
            }
        }

        return best;
    }

    stats() {
        return {
            documents:   this._docs.size,
            uniqueTerms: this._index.size,
            trieSize:    this._trie.size,
        };
    }

    /**
     * Clear all documents and the index.
     */
    clear() {
        this._trie.clear();
        this._docs.clear();
        this._index.clear();
        return this;
    }

    /**
     * Serialize the index for persistence (e.g. localStorage).
     */
    export() {
        return {
            version:   1,
            options:   this._opts,
            trie:      this._trie.export(),
            documents: Array.from(this._docs.entries()),
        };
    }

    /**
     * Restore from a previously exported snapshot.
     */
    import(data) {
        // Snapshot current state so we can restore on failure.
        const prevOpts  = this._opts;
        const prevTrie  = this._trie;
        const prevDocs  = this._docs;
        const prevIndex = this._index;
        try {
            if (!data || !data.options || !data.trie || !data.documents) {
                throw new Error('Invalid import data structure');
            }
            this._opts  = data.options;
            this._trie  = new Trie();
            this._trie.import(data.trie);
            this._docs  = new Map(data.documents);
            this._index = new Map();
            this._fieldCache = new Map(); // D-04: clear field cache on import
            this._rebuildIndex();
            return this;
        } catch (err) {
            console.warn('[Search] import failed, restoring previous state:', err);
            this._opts  = prevOpts;
            this._trie  = prevTrie;
            this._docs  = prevDocs;
            this._index = prevIndex;
            return this;
        }
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    _rebuildIndex() {
        this._index.clear();
        this._fieldCache.clear();
        this._trie.clear();
        for (const [id, doc] of this._docs) {
            for (const field of this._opts.fields) {
                const value = doc[field];
                if (!value || typeof value !== 'string') continue;
                for (const term of _tokenize(value)) {
                    if (!this._index.has(term)) {
                        this._index.set(term, new Set());
                        this._trie.insert(term, term);
                    }
                    this._index.get(term).add(id);
                    const cacheKey = `${id} ${term}`;
                    if (!this._fieldCache.has(cacheKey)) this._fieldCache.set(cacheKey, field);
                }
            }
        }
    }

    _removeById(id) {
        if (!this._docs.has(id)) return this;
        for (const [term, ids] of this._index) {
            ids.delete(id);
            if (ids.size === 0) {
                this._index.delete(term);
                this._trie.delete(term);
            }
        }
        // clear all cached field lookups for this document
        for (const key of this._fieldCache.keys()) {
            if (key.startsWith(id + ' ')) this._fieldCache.delete(key);
        }
        this._docs.delete(id);
        return this;
    }

    // _fieldForTerm now reads from _fieldCache built at add() time.
    // Previously re-tokenized every field on every query match — O(docs*fields*terms).
    _fieldForTerm(doc, term, id) {
        if (id !== undefined) {
            const cached = this._fieldCache.get(`${id} ${term}`);
            if (cached !== undefined) return cached;
        }
        // Fallback for callers without id (shouldn't happen in normal search flow)
        for (const field of this._opts.fields) {
            const value = doc[field];
            if (!value || typeof value !== 'string') continue;
            if (_tokenize(value).includes(term)) return field;
        }
        return null;
    }
}

// ─── Module-level pure helpers ────────────────────────────────────────────────

// Escape HTML for safe innerHTML injection in highlightSnippet().
function _escHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Split text on whitespace and common separators; discard empty tokens.
function _tokenize(text) {
    if (!text) return [];
    return text.toLowerCase().split(/[\s,.\-_]+/).filter(t => t.length > 0);
}

// Score a matched term relative to the query term.
// Exact match → 1.0, prefix match → ratio, fuzzy → distance-penalised.
function _termScore(queryTerm, matchedTerm, distance) {
    if (distance === 0) {
        if (matchedTerm === queryTerm) return 1.0;
        return Math.min(1.0, queryTerm.length / matchedTerm.length);
    }
    const maxLen = Math.max(queryTerm.length, matchedTerm.length);
    return Math.max(0, (1 - distance / maxLen) * 0.8);
}

// Compute Levenshtein edit distance between two strings.
function _levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    const curr = new Array(b.length + 1);

    for (let i = 1; i <= a.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= b.length; j++) {
            curr[j] = a[i - 1] === b[j - 1]
                ? prev[j - 1]
                : 1 + Math.min(prev[j - 1], curr[j - 1], prev[j]);
        }
        prev.splice(0, prev.length, ...curr);
    }

    return prev[b.length];
}