/**
 * oja/store.js
 * Persistent state with storage cascade and optional encryption.
 *
 * Storage cascade — tries each layer in order, falls back automatically:
 *   sessionStorage → localStorage → memory (Map)
 *
 * This means the same code works unchanged across:
 *   Web (normal)    → sessionStorage
 *   Web (private)   → memory
 *   Mobile webview  → sessionStorage or localStorage
 *   Embedded iframe → memory
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { Store } from '../oja/store.js';
 *
 *   const store = new Store('admin');
 *   store.set('page', 'hosts');
 *   store.get('page');                   // → 'hosts'
 *   store.get('missing', 'dashboard');   // → 'dashboard'
 *   store.has('page');                   // → true
 *   store.clear('page');                 // remove one key
 *   store.clear();                       // remove all keys for this namespace
 *   store.all();                         // → { page: 'hosts', ... }
 *   store.size;                          // → number of keys in namespace
 *   store.getOrSet('id', () => uuid());  // read or compute+store
 *   store.ttl('flashMsg', 3000);         // auto-expire key after 3s
 *   store.onChange('page', (n, o) => console.log(n));
 *   store.onChange('*', (k, n, o) => console.log(k, n));
 *
 * ─── Encrypted store (for tokens and sensitive data) ─────────────────────────
 *
 *   const secure = new Store('admin', { encrypt: true });
 *   // encrypt:true → set() and get() return Promises
 *   await secure.set('token', jwt);
 *   await secure.get('token');
 *
 * ─── Storage preference ───────────────────────────────────────────────────────
 *
 *   const persistent = new Store('admin', { prefer: 'local' });
 *   const session    = new Store('admin', { prefer: 'session' });
 *
 * ─── Events ───────────────────────────────────────────────────────────────────
 *
 *   store.onChange('page', (newVal, oldVal) => console.log('page changed'));
 *   // Wildcard — fires for every key change in this namespace:
 *   store.onChange('*', (key, newVal, oldVal) => console.log(key, newVal));
 *   store.offChange('page', handler);
 */

import { encrypt } from '../utils/encrypt.js';

class _SessionAdapter {
    get name() { return 'session'; }
    available() {
        try { sessionStorage.setItem('__oja__', '1'); sessionStorage.removeItem('__oja__'); return true; }
        catch { return false; }
    }
    get(k)    { return sessionStorage.getItem(k); }
    set(k, v) { sessionStorage.setItem(k, v); }
    remove(k) { sessionStorage.removeItem(k); }
    keys()    { const out = []; for (let i = 0; i < sessionStorage.length; i++) out.push(sessionStorage.key(i)); return out; }
    // clear() must only remove namespace-prefixed keys, not all storage.
    // Callers must pass the prefix; the adapter itself cannot scope without it.
    clearNamespace(prefix) { this.keys().filter(k => k.startsWith(prefix)).forEach(k => sessionStorage.removeItem(k)); }
}

class _LocalAdapter {
    get name() { return 'local'; }
    available() {
        try { localStorage.setItem('__oja__', '1'); localStorage.removeItem('__oja__'); return true; }
        catch { return false; }
    }
    get(k)    { return localStorage.getItem(k); }
    set(k, v) { localStorage.setItem(k, v); }
    remove(k) { localStorage.removeItem(k); }
    keys()    { const out = []; for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i)); return out; }
    clearNamespace(prefix) { this.keys().filter(k => k.startsWith(prefix)).forEach(k => localStorage.removeItem(k)); }
}

class _MemoryAdapter {
    get name() { return 'memory'; }
    constructor() { this._map = new Map(); }
    available()  { return true; }
    get(k)       { return this._map.has(k) ? this._map.get(k) : null; }
    set(k, v)    { this._map.set(k, v); }
    remove(k)    { this._map.delete(k); }
    keys()       { return [...this._map.keys()]; }
    clearNamespace(prefix) { for (const k of [...this._map.keys()]) if (k.startsWith(prefix)) this._map.delete(k); }
}

export class Store {
    /**
     * @param {string} namespace   — scopes all keys
     * @param {Object} options
     *   prefer  : 'session' | 'local'   — preferred storage layer (default: 'session')
     *   encrypt : boolean                — enable AES-GCM encryption (default: false)
     *   secret  : string                 — encryption passphrase (default: namespace)
     *   aad     : string                 — additional authenticated data (optional)
     */
    constructor(namespace = 'oja', options = {}) {
        this._ns      = namespace + ':';
        this._opts    = options;
        this._secret  = options.secret  || namespace;
        this._aad     = options.aad     || null;
        this._encrypt = options.encrypt && encrypt.available();
        this._layer   = null;
        this._changes = new Map();   // key → Set<fn>
        this._wildcardListeners = new Set(); // for onChange('*')
        this._ttlTimers = new Map(); // key → timer id

        this._init(options.prefer || 'session');
    }

    _init(prefer) {
        const session = new _SessionAdapter();
        const local   = new _LocalAdapter();
        const memory  = new _MemoryAdapter();

        if (prefer === 'local') {
            this._layer = local.available()   ? local   : session.available() ? session : memory;
        } else {
            this._layer = session.available() ? session : local.available()   ? local   : memory;
        }
    }

    get storageLayer() { return this._layer.name; }

    // API

    set(key, value) {
        if (this._encrypt) return this._setEncrypted(key, value);
        return this._setSync(key, value);
    }

    get(key, fallback = null) {
        if (this._encrypt) return this._getEncrypted(key, fallback);
        return this._getSync(key, fallback);
    }

    has(key) {
        // NOTE: for encrypted stores this only checks raw key presence,
        // not whether decryption would succeed. Use get() for reliable reads.
        return this._layer.get(this._ns + key) !== null;
    }

    clear(key) {
        if (key !== undefined) {
            const old = this._getSync(key);
            this._cancelTtl(key);
            this._layer.remove(this._ns + key);
            this._notify(key, null, old);
        } else {
            // clear all keys in this namespace only.
            this._layer.keys()
                .filter(k => k.startsWith(this._ns))
                .forEach(k => {
                    const shortKey = k.slice(this._ns.length);
                    const old = this._getSync(shortKey);
                    this._cancelTtl(shortKey);
                    this._layer.remove(k);
                    this._notify(shortKey, null, old);
                });
        }
        return this;
    }

    // clearAll() previously called this._layer.clear() which wiped
    // ALL browser storage. Now scoped to this namespace only.
    clearAll() {
        // Cancel all TTL timers first
        for (const key of this._ttlTimers.keys()) this._cancelTtl(key);
        this._layer.clearNamespace(this._ns);
        this._changes.clear();
        this._wildcardListeners.clear();
        return this;
    }

    all() {
        const result = {};
        this._layer.keys()
            .filter(k => k.startsWith(this._ns))
            .forEach(k => { result[k.slice(this._ns.length)] = this._getSync(k.slice(this._ns.length)); });
        return result;
    }

    // number of keys in this namespace
    get size() {
        return this._layer.keys().filter(k => k.startsWith(this._ns)).length;
    }

    // read or compute-and-store
    getOrSet(key, defaultFn) {
        if (this._encrypt) {
            return (async () => {
                const existing = await this._getEncrypted(key);
                if (existing !== null) return existing;
                const value = typeof defaultFn === 'function' ? await defaultFn() : defaultFn;
                await this._setEncrypted(key, value);
                return value;
            })();
        }
        const existing = this._getSync(key);
        if (existing !== null) return existing;
        const value = typeof defaultFn === 'function' ? defaultFn() : defaultFn;
        this._setSync(key, value);
        return value;
    }

    // auto-expire a key after ms milliseconds
    ttl(key, ms) {
        this._cancelTtl(key);
        if (!this.has(key)) return this;
        const id = setTimeout(() => {
            this._ttlTimers.delete(key);
            this.clear(key);
        }, ms);
        this._ttlTimers.set(key, id);
        return this;
    }

    // Sync internals

    _setSync(key, value) {
        const old = this._getSync(key);
        try {
            this._layer.set(this._ns + key, JSON.stringify(value));
            this._notify(key, value, old);
        } catch (e) {
            console.warn('[oja/store] set failed:', key, e);
        }
        return this;
    }

    _getSync(key, fallback = null) {
        try {
            const raw = this._layer.get(this._ns + key);
            if (raw === null || raw === undefined) return fallback;
            return JSON.parse(raw);
        } catch { return fallback; }
    }

    // Encrypted internals

    async _setEncrypted(key, value) {
        const serialised = JSON.stringify(value);
        let stored = serialised;
        try { stored = await encrypt.seal(serialised, this._secret, this._ns, this._aad); }
        catch (e) { console.warn('[oja/store] encryption failed, storing plain:', e); }
        const old = await this._getEncrypted(key);
        try { this._layer.set(this._ns + key, stored); this._notify(key, value, old); }
        catch (e) { console.warn('[oja/store] set failed:', key, e); }
        return this;
    }

    async _getEncrypted(key, fallback = null) {
        try {
            const raw = this._layer.get(this._ns + key);
            if (raw === null || raw === undefined) return fallback;
            let plain = raw;
            if (encrypt.isSealed(raw)) {
                try { plain = await encrypt.open(raw, this._secret, this._ns, this._aad); }
                catch (e) { console.warn('[oja/store] decryption failed:', key, e); return fallback; }
            }
            return JSON.parse(plain);
        } catch { return fallback; }
    }

    async rotateKey(newSecret, options = {}) {
        if (!this._encrypt) throw new Error('[oja/store] Cannot rotate key on non-encrypted store');
        const { oldSecret = this._secret, onProgress = null, batchSize = 10 } = options;
        const keys = this._layer.keys().filter(k => k.startsWith(this._ns)).map(k => k.slice(this._ns.length));
        let successCount = 0, errorCount = 0;
        for (let i = 0; i < keys.length; i += batchSize) {
            await Promise.all(keys.slice(i, i + batchSize).map(async (key) => {
                try {
                    const raw = this._layer.get(this._ns + key);
                    if (!raw || !encrypt.isSealed(raw)) { errorCount++; return; }
                    const reencrypted = await encrypt.rotate(raw, oldSecret, newSecret, this._ns, this._aad);
                    this._layer.set(this._ns + key, reencrypted);
                    successCount++;
                    onProgress?.({ key, success: true });
                } catch (e) {
                    errorCount++;
                    console.warn('[oja/store] failed to re-encrypt key:', key, e);
                    onProgress?.({ key, success: false, error: e.message });
                }
            }));
        }
        if (successCount > 0) { this._secret = newSecret; _emit('store:key-rotated', { namespace: this._ns, successCount, errorCount }); }
        return { successCount, errorCount };
    }

    async exportEncrypted() {
        if (!this._encrypt) throw new Error('[oja/store] Cannot export from non-encrypted store');
        const data = {};
        this._layer.keys().filter(k => k.startsWith(this._ns)).forEach(fullKey => {
            const raw = this._layer.get(fullKey);
            if (encrypt.isSealed(raw)) data[fullKey.slice(this._ns.length)] = raw;
        });
        return { namespace: this._ns, version: 1, data };
    }

    async importEncrypted(exported) {
        if (!this._encrypt) throw new Error('[oja/store] Cannot import to non-encrypted store');
        if (exported.namespace !== this._ns) throw new Error('[oja/store] Namespace mismatch on import');
        for (const [key, value] of Object.entries(exported.data)) this._layer.set(this._ns + key, value);
        _emit('store:imported', { namespace: this._ns, count: Object.keys(exported.data).length });
        return this;
    }

    // Change listeners

    /**
     * Listen for changes on a specific key, or '*' for all keys.
     *
     *   store.onChange('page', (newVal, oldVal) => ...)
     *   store.onChange('*',    (key, newVal, oldVal) => ...)   // F-22 wildcard
     *
     * Returns an unsubscribe function.
     */
    onChange(key, handler) {
        if (key === '*') {
            this._wildcardListeners.add(handler);
            return () => this._wildcardListeners.delete(handler);
        }
        if (!this._changes.has(key)) this._changes.set(key, new Set());
        this._changes.get(key).add(handler);
        return () => this.offChange(key, handler);
    }

    offChange(key, handler) {
        if (key === '*') { this._wildcardListeners.delete(handler); return; }
        this._changes.get(key)?.delete(handler);
    }

    _notify(key, newVal, oldVal) {
        if (newVal === oldVal) return;
        this._changes.get(key)?.forEach(fn => {
            try { fn(newVal, oldVal); } catch (e) { console.warn('[oja/store] onChange handler error:', e); }
        });
        // wildcard listeners get (key, newVal, oldVal)
        if (this._wildcardListeners.size > 0) {
            this._wildcardListeners.forEach(fn => {
                try { fn(key, newVal, oldVal); } catch (e) { console.warn('[oja/store] onChange(*) handler error:', e); }
            });
        }
    }

    _cancelTtl(key) {
        const id = this._ttlTimers.get(key);
        if (id !== undefined) { clearTimeout(id); this._ttlTimers.delete(key); }
    }

    // Convenience

    increment(key, n = 1) {
        const current = this._getSync(key, 0);
        this._setSync(key, (typeof current === 'number' ? current : 0) + n);
        return this;
    }

    push(key, value) {
        const arr = this._getSync(key, []);
        if (!Array.isArray(arr)) return this;
        arr.push(value);
        this._setSync(key, arr);
        return this;
    }

    merge(key, partial) {
        const current = this._getSync(key, {});
        this._setSync(key, { ...current, ...partial });
        return this;
    }
}

function _emit(name, detail = {}) {
    if (typeof document === 'undefined') return;
    document.dispatchEvent(new CustomEvent(name, { detail }));
}
