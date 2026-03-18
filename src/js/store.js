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
 *   store.get('page');           // → 'hosts'
 *   store.get('missing', 'dashboard'); // → 'dashboard'
 *   store.has('page');           // → true
 *   store.clear('page');         // remove one key
 *   store.clear();               // remove all keys for this namespace
 *   store.all();                 // → { page: 'hosts', ... }
 *
 * ─── Encrypted store (for tokens and sensitive data) ─────────────────────────
 *
 *   const secure = new Store('admin', { encrypt: true });
 *   await secure.setAsync('token', jwt);   // encrypted before storage
 *   await secure.getAsync('token');        // decrypted on retrieval
 *
 * ─── Storage preference ───────────────────────────────────────────────────────
 *
 *   // Prefer localStorage (survives tab close — for remember-me)
 *   const persistent = new Store('admin', { prefer: 'local' });
 *
 *   // Session only (cleared on tab close — default)
 *   const session = new Store('admin', { prefer: 'session' });
 *
 * ─── Events ───────────────────────────────────────────────────────────────────
 *
 *   store.onChange('page', (newVal, oldVal) => console.log('page changed'));
 *   store.offChange('page', handler);
 */

// ─── Storage adapters ─────────────────────────────────────────────────────────

class _SessionAdapter {
    get name() { return 'session'; }
    available() {
        try {
            sessionStorage.setItem('__oja__', '1');
            sessionStorage.removeItem('__oja__');
            return true;
        } catch { return false; }
    }
    get(k)      { return sessionStorage.getItem(k); }
    set(k, v)   { sessionStorage.setItem(k, v); }
    remove(k)   { sessionStorage.removeItem(k); }
    keys()      {
        const out = [];
        for (let i = 0; i < sessionStorage.length; i++) out.push(sessionStorage.key(i));
        return out;
    }
}

class _LocalAdapter {
    get name() { return 'local'; }
    available() {
        try {
            localStorage.setItem('__oja__', '1');
            localStorage.removeItem('__oja__');
            return true;
        } catch { return false; }
    }
    get(k)      { return localStorage.getItem(k); }
    set(k, v)   { localStorage.setItem(k, v); }
    remove(k)   { localStorage.removeItem(k); }
    keys()      {
        const out = [];
        for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i));
        return out;
    }
}

class _MemoryAdapter {
    get name() { return 'memory'; }
    constructor() { this._map = new Map(); }
    available()  { return true; }
    get(k)       { return this._map.has(k) ? this._map.get(k) : null; }
    set(k, v)    { this._map.set(k, v); }
    remove(k)    { this._map.delete(k); }
    keys()       { return [...this._map.keys()]; }
}

// ─── Encryption (Web Crypto API) ──────────────────────────────────────────────

const _ENC_PREFIX = '__oja_enc__:';

// Derive a 256-bit AES-GCM key from a passphrase using PBKDF2
async function _deriveKey(passphrase, salt) {
    const enc      = new TextEncoder();
    const keyMat   = await crypto.subtle.importKey(
        'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
        keyMat,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function _encrypt(plaintext, passphrase, salt) {
    const key  = await _deriveKey(passphrase, salt);
    const iv   = crypto.getRandomValues(new Uint8Array(12));
    const enc  = new TextEncoder();
    const ct   = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));

    // Pack: iv (12 bytes) + ciphertext → base64
    const buf  = new Uint8Array(12 + ct.byteLength);
    buf.set(iv, 0);
    buf.set(new Uint8Array(ct), 12);
    return _ENC_PREFIX + btoa(String.fromCharCode(...buf));
}

async function _decrypt(stored, passphrase, salt) {
    if (!stored.startsWith(_ENC_PREFIX)) return stored; // not encrypted
    const raw  = atob(stored.slice(_ENC_PREFIX.length));
    const buf  = Uint8Array.from(raw, c => c.charCodeAt(0));
    const iv   = buf.slice(0, 12);
    const ct   = buf.slice(12);
    const key  = await _deriveKey(passphrase, salt);
    const dec  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(dec);
}

function _hasCrypto() {
    return typeof crypto !== 'undefined' &&
        typeof crypto.subtle !== 'undefined' &&
        typeof crypto.getRandomValues === 'function';
}

// ─── Store ────────────────────────────────────────────────────────────────────

export class Store {
    /**
     * @param {string} namespace   — scopes all keys, prevents collisions between apps
     * @param {Object} options
     *   prefer  : 'session' | 'local'   — preferred storage layer (default: 'session')
     *   encrypt : boolean                — enable AES-GCM encryption (default: false)
     *   secret  : string                 — encryption passphrase (default: namespace)
     */
    constructor(namespace = 'oja', options = {}) {
        this._ns      = namespace + ':';
        this._opts    = options;
        this._secret  = options.secret   || namespace;
        this._encrypt = options.encrypt  && _hasCrypto();
        this._layer   = null;
        this._changes = new Map(); // key → Set of handler fns

        this._init(options.prefer || 'session');
    }

    _init(prefer) {
        const session = new _SessionAdapter();
        const local   = new _LocalAdapter();
        const memory  = new _MemoryAdapter();

        if (prefer === 'local') {
            this._layer = local.available()   ? local
                : session.available() ? session
                    : memory;
        } else {
            this._layer = session.available() ? session
                : local.available()   ? local
                    : memory;
        }
    }

    /** Which storage layer is active — useful for debugging */
    get storageLayer() { return this._layer.name; }

    // ─── Synchronous API (no encryption) ─────────────────────────────────────

    set(key, value) {
        const old = this.get(key);
        try {
            this._layer.set(this._ns + key, JSON.stringify(value));
            this._notify(key, value, old);
        } catch (e) {
            console.warn('[oja/store] set failed:', key, e);
        }
        return this;
    }

    get(key, fallback = null) {
        try {
            const raw = this._layer.get(this._ns + key);
            if (raw === null || raw === undefined) return fallback;
            return JSON.parse(raw);
        } catch {
            return fallback;
        }
    }

    has(key) {
        return this._layer.get(this._ns + key) !== null;
    }

    clear(key) {
        if (key !== undefined) {
            const old = this.get(key);
            this._layer.remove(this._ns + key);
            this._notify(key, null, old);
        } else {
            this._layer.keys()
                .filter(k => k.startsWith(this._ns))
                .forEach(k => {
                    const shortKey = k.slice(this._ns.length);
                    const old = this.get(shortKey);
                    this._layer.remove(k);
                    this._notify(shortKey, null, old);
                });
        }
        return this;
    }

    all() {
        const result = {};
        this._layer.keys()
            .filter(k => k.startsWith(this._ns))
            .forEach(k => {
                const shortKey = k.slice(this._ns.length);
                result[shortKey] = this.get(shortKey);
            });
        return result;
    }

    // ─── Async API (with optional encryption) ────────────────────────────────

    /**
     * Store a value — encrypted if store was created with { encrypt: true }.
     * Falls back to plain storage if Web Crypto is unavailable.
     */
    async setAsync(key, value) {
        const serialised = JSON.stringify(value);
        let stored = serialised;

        if (this._encrypt) {
            try {
                stored = await _encrypt(serialised, this._secret, this._ns);
            } catch (e) {
                console.warn('[oja/store] encryption failed, storing plain:', e);
            }
        }

        const old = await this.getAsync(key);
        try {
            this._layer.set(this._ns + key, stored);
            this._notify(key, value, old);
        } catch (e) {
            console.warn('[oja/store] setAsync failed:', key, e);
        }
        return this;
    }

    /**
     * Retrieve a value — decrypted if store was created with { encrypt: true }.
     */
    async getAsync(key, fallback = null) {
        try {
            const raw = this._layer.get(this._ns + key);
            if (raw === null || raw === undefined) return fallback;

            let plain = raw;
            if (this._encrypt && raw.startsWith(_ENC_PREFIX)) {
                try {
                    plain = await _decrypt(raw, this._secret, this._ns);
                } catch (e) {
                    console.warn('[oja/store] decryption failed:', key, e);
                    return fallback;
                }
            }

            return JSON.parse(plain);
        } catch {
            return fallback;
        }
    }

    // ─── Change listeners ─────────────────────────────────────────────────────

    /**
     * Watch a key for changes.
     * Handler is called with (newValue, oldValue) whenever the key changes.
     * Returns an unsubscribe function.
     *
     *   const unsub = store.onChange('page', (next, prev) => console.log(next));
     *   unsub(); // stop watching
     */
    onChange(key, handler) {
        if (!this._changes.has(key)) this._changes.set(key, new Set());
        this._changes.get(key).add(handler);
        return () => this.offChange(key, handler);
    }

    offChange(key, handler) {
        this._changes.get(key)?.delete(handler);
    }

    _notify(key, newVal, oldVal) {
        if (newVal === oldVal) return;
        this._changes.get(key)?.forEach(fn => {
            try { fn(newVal, oldVal); } catch (e) {
                console.warn('[oja/store] onChange handler error:', e);
            }
        });
    }

    // ─── Convenience ─────────────────────────────────────────────────────────

    /** Increment a numeric value by n (default 1) */
    increment(key, n = 1) {
        const current = this.get(key, 0);
        this.set(key, (typeof current === 'number' ? current : 0) + n);
        return this;
    }

    /** Push a value onto an array — creates the array if it doesn't exist */
    push(key, value) {
        const arr = this.get(key, []);
        if (!Array.isArray(arr)) return this;
        arr.push(value);
        this.set(key, arr);
        return this;
    }

    /** Merge an object into a stored object */
    merge(key, partial) {
        const current = this.get(key, {});
        this.set(key, { ...current, ...partial });
        return this;
    }
}