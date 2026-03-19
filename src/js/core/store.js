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
    clear()     { sessionStorage.clear(); }
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
    clear()     { localStorage.clear(); }
}

class _MemoryAdapter {
    get name() { return 'memory'; }
    constructor() { this._map = new Map(); }
    available()  { return true; }
    get(k)       { return this._map.has(k) ? this._map.get(k) : null; }
    set(k, v)    { this._map.set(k, v); }
    remove(k)    { this._map.delete(k); }
    keys()       { return [...this._map.keys()]; }
    clear()      { this._map.clear(); }
}

// ─── Encryption (Web Crypto API) ──────────────────────────────────────────────

const ENC_PREFIX = '__oja_enc__:';
const KEY_VERSION = 1;

async function _deriveKey(passphrase, salt, iterations = 100000) {
    const enc      = new TextEncoder();
    const keyMat   = await crypto.subtle.importKey(
        'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' },
        keyMat,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function _encrypt(plaintext, passphrase, salt, aad = null) {
    const key  = await _deriveKey(passphrase, salt);
    const iv   = crypto.getRandomValues(new Uint8Array(12));
    const enc  = new TextEncoder();
    const ct   = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv,
            additionalData: aad ? enc.encode(aad) : undefined
        },
        key,
        enc.encode(plaintext)
    );

    const version = KEY_VERSION;
    const buf  = new Uint8Array(1 + 12 + ct.byteLength);
    buf[0] = version;
    buf.set(iv, 1);
    buf.set(new Uint8Array(ct), 13);
    return ENC_PREFIX + btoa(String.fromCharCode(...buf));
}

async function _decrypt(stored, passphrase, salt, aad = null) {
    if (!stored.startsWith(ENC_PREFIX)) return stored;

    const raw  = atob(stored.slice(ENC_PREFIX.length));
    const buf  = Uint8Array.from(raw, c => c.charCodeAt(0));
    const version = buf[0];
    const iv   = buf.slice(1, 13);
    const ct   = buf.slice(13);
    const enc  = new TextEncoder();

    const key  = await _deriveKey(passphrase, salt);
    const dec  = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv,
            additionalData: aad ? enc.encode(aad) : undefined
        },
        key,
        ct
    );
    return new TextDecoder().decode(dec);
}

async function _reencrypt(stored, oldPassphrase, newPassphrase, salt, aad = null) {
    const plaintext = await _decrypt(stored, oldPassphrase, salt, aad);
    return _encrypt(plaintext, newPassphrase, salt, aad);
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
     *   aad     : string                 — additional authenticated data (optional)
     */
    constructor(namespace = 'oja', options = {}) {
        this._ns      = namespace + ':';
        this._opts    = options;
        this._secret  = options.secret   || namespace;
        this._aad     = options.aad      || null;
        this._encrypt = options.encrypt  && _hasCrypto();
        this._layer   = null;
        this._changes = new Map();

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

    clearAll() {
        this._layer.clear();
        this._changes.clear();
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

    async setAsync(key, value) {
        const serialised = JSON.stringify(value);
        let stored = serialised;

        if (this._encrypt) {
            try {
                stored = await _encrypt(serialised, this._secret, this._ns, this._aad);
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

    async getAsync(key, fallback = null) {
        try {
            const raw = this._layer.get(this._ns + key);
            if (raw === null || raw === undefined) return fallback;

            let plain = raw;
            if (this._encrypt && raw.startsWith(ENC_PREFIX)) {
                try {
                    plain = await _decrypt(raw, this._secret, this._ns, this._aad);
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

    /**
     * Rotate encryption key for all stored values.
     * Re-encrypts all data with a new passphrase while preserving existing values.
     * Returns number of keys successfully re-encrypted.
     */
    async rotateKey(newSecret, options = {}) {
        if (!this._encrypt) {
            throw new Error('[oja/store] Cannot rotate key on non-encrypted store');
        }

        const {
            oldSecret = this._secret,
            onProgress = null,
            batchSize = 10
        } = options;

        const keys = this._layer.keys()
            .filter(k => k.startsWith(this._ns))
            .map(k => k.slice(this._ns.length));

        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < keys.length; i += batchSize) {
            const batch = keys.slice(i, i + batchSize);
            await Promise.all(batch.map(async (key) => {
                try {
                    const raw = this._layer.get(this._ns + key);
                    if (!raw || !raw.startsWith(ENC_PREFIX)) {
                        errorCount++;
                        return;
                    }

                    const reencrypted = await _reencrypt(
                        raw,
                        oldSecret,
                        newSecret,
                        this._ns,
                        this._aad
                    );

                    this._layer.set(this._ns + key, reencrypted);
                    successCount++;

                    if (onProgress) {
                        onProgress({ key, success: true });
                    }
                } catch (e) {
                    errorCount++;
                    console.warn(`[oja/store] Failed to re-encrypt key: ${key}`, e);
                    if (onProgress) {
                        onProgress({ key, success: false, error: e.message });
                    }
                }
            }));
        }

        if (successCount > 0) {
            this._secret = newSecret;
            _emit('store:key-rotated', {
                namespace: this._ns,
                successCount,
                errorCount
            });
        }

        return { successCount, errorCount };
    }

    /**
     * Export all encrypted data with current key.
     * Useful for backup or migration.
     */
    async exportEncrypted() {
        if (!this._encrypt) {
            throw new Error('[oja/store] Cannot export from non-encrypted store');
        }

        const data = {};
        const keys = this._layer.keys()
            .filter(k => k.startsWith(this._ns));

        for (const fullKey of keys) {
            const raw = this._layer.get(fullKey);
            if (raw && raw.startsWith(ENC_PREFIX)) {
                const shortKey = fullKey.slice(this._ns.length);
                data[shortKey] = raw;
            }
        }

        return {
            namespace: this._ns,
            version: KEY_VERSION,
            data
        };
    }

    /**
     * Import encrypted data.
     * Expects format from exportEncrypted().
     */
    async importEncrypted(exported) {
        if (!this._encrypt) {
            throw new Error('[oja/store] Cannot import to non-encrypted store');
        }

        if (exported.namespace !== this._ns) {
            throw new Error('[oja/store] Namespace mismatch on import');
        }

        for (const [key, value] of Object.entries(exported.data)) {
            this._layer.set(this._ns + key, value);
        }

        _emit('store:imported', { namespace: this._ns, count: Object.keys(exported.data).length });
        return this;
    }

    // ─── Change listeners ─────────────────────────────────────────────────────

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

    increment(key, n = 1) {
        const current = this.get(key, 0);
        this.set(key, (typeof current === 'number' ? current : 0) + n);
        return this;
    }

    push(key, value) {
        const arr = this.get(key, []);
        if (!Array.isArray(arr)) return this;
        arr.push(value);
        this.set(key, arr);
        return this;
    }

    merge(key, partial) {
        const current = this.get(key, {});
        this.set(key, { ...current, ...partial });
        return this;
    }
}

function _emit(name, detail = {}) {
    if (typeof document === 'undefined') return;
    document.dispatchEvent(new CustomEvent(name, { detail }));
}