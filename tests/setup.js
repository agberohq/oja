// tests/setup.js
// Provides Worker, URL.createObjectURL/revokeObjectURL, and IndexedDB shims
// so Runner and VFS tests run fully in-process under jsdom/Vitest.
//
// Worker shim design constraint: Runner calls URL.createObjectURL(blob) then
// immediately passes the URL to new Worker(url). The shim must have the source
// text available synchronously — any async read drops messages and causes timeouts.
// We intercept Blob construction to capture text at creation time.

// ─── Blob interception ────────────────────────────────────────────────────────

const _blobSources = new Map();
let   _blobCounter = 0;

const _NativeBlob = globalThis.Blob;
globalThis.Blob = class extends _NativeBlob {
    constructor(parts, opts) {
        super(parts, opts);
        this.__shimText = parts.map(p => (typeof p === 'string' ? p : '')).join('');
    }
};

URL.createObjectURL = (blob) => {
    const url = `blob:shim-${++_blobCounter}`;
    _blobSources.set(url, blob.__shimText ?? '');
    return url;
};

URL.revokeObjectURL = (url) => {
    _blobSources.delete(url);
};

// ─── Worker shim ──────────────────────────────────────────────────────────────
// Evaluates the worker source synchronously via new Function so #workerOnmessage
// is captured before the constructor returns and no messages are dropped.
//
// The Runner bootstrap uses bare globals: postMessage(...) and onmessage = fn.
// We inject postMessage as a parameter and capture the onmessage assignment
// via a __capture__ sentinel appended to the wrapped source.

class WorkerShim {
    #workerOnmessage = null;
    #mainOnmessage   = null;

    set onmessage(fn) { this.#mainOnmessage = fn; }
    get onmessage()   { return this.#mainOnmessage; }

    onerror = null;

    constructor(blobUrl, _options) {
        // Resolve source from blob: shim registry OR data: URL directly.
        let src;
        if (blobUrl.startsWith('data:')) {
            // data: URL — decode the source directly (used by inline-module mode).
            // Format: data:text/javascript;charset=utf-8,<encoded-source>
            // Module bootstrap uses self.onmessage (not bare onmessage), so we
            // handle both assignment styles in the capture step below.
            const encoded = blobUrl.slice(blobUrl.indexOf(',') + 1);
            src = decodeURIComponent(encoded);
        } else {
            src = _blobSources.get(blobUrl);
            if (src === undefined) throw new Error(`[shim/Worker] unknown blob URL: ${blobUrl}`);
        }

        // Delivers worker responses to Runner's #route() on the next microtask,
        // matching real Worker async delivery without blocking the call stack.
        const workerPostMessage = (data) => {
            queueMicrotask(() => {
                if (this.#mainOnmessage) this.#mainOnmessage({ data });
            });
        };

        // Evaluate worker source synchronously.
        // Classic bootstrap assigns bare `onmessage = ...` (captured by let).
        // Module bootstrap assigns `self.onmessage = ...` (captured via self proxy).
        // We handle both: inject a `self` proxy and capture whichever is set.
        const selfProxy = { onmessage: null };
        const wrapped = `'use strict';
let onmessage;
const self = __self__;
${src}
__capture__(onmessage ?? self.onmessage);`;
        const factory = new Function('postMessage', '__capture__', '__self__', wrapped);
        factory(workerPostMessage, (fn) => { this.#workerOnmessage = fn; }, selfProxy);
    }

    // Called by Runner — runs the worker handler and lets it complete async
    postMessage(data) {
        if (!this.#workerOnmessage) return;
        Promise.resolve(this.#workerOnmessage({ data })).catch(() => {});
    }

    terminate() {
        this.#workerOnmessage = null;
        this.#mainOnmessage   = null;
    }
}

global.Worker = WorkerShim;

// ─── IndexedDB shim ───────────────────────────────────────────────────────────
// VFS uses: indexedDB.open, onupgradeneeded, onsuccess, onerror,
// objectStoreNames.contains, createObjectStore, db.transaction,
// store.put({ path, content, meta, updatedAt }), store.get(key),
// store.getAll(), store.delete(key), store.clear().
// All callbacks fire on the next microtask to match real IDB async behaviour.

const _idbDatabases = new Map(); // dbName → Map<path, record>

function _makeRequest(valueFn) {
    const req = { onsuccess: null, onerror: null, result: undefined, error: null };
    queueMicrotask(() => {
        try {
            req.result = valueFn();
            if (req.onsuccess) req.onsuccess({ target: req });
        } catch (e) {
            req.error = e;
            if (req.onerror) req.onerror({ target: req });
        }
    });
    return req;
}

function _makeStore(data) {
    return {
        put(record)  { return _makeRequest(() => { data.set(record.path, record); return record.path; }); },
        get(key)     { return _makeRequest(() => data.get(key)); },
        getAll()     { return _makeRequest(() => [...data.values()]); },
        delete(key)  { return _makeRequest(() => { data.delete(key); }); },
        clear()      { return _makeRequest(() => { data.clear(); }); },
    };
}

globalThis.indexedDB = {
    open(name) {
        const req = {
            onsuccess:       null,
            onerror:         null,
            onupgradeneeded: null,
            result:          null,
        };

        queueMicrotask(() => {
            const isNew = !_idbDatabases.has(name);
            if (isNew) _idbDatabases.set(name, new Map());
            const data = _idbDatabases.get(name);

            const db = {
                objectStoreNames: {
                    contains: () => !isNew,
                },
                createObjectStore: () => _makeStore(data),
                transaction: (_store, _mode) => ({
                    objectStore: () => _makeStore(data),
                }),
            };

            req.result = db;

            if (isNew && req.onupgradeneeded) {
                req.onupgradeneeded({ target: req });
            }
            if (req.onsuccess) req.onsuccess({ target: req });
        });

        return req;
    },
};

// ─── LocalStorage / SessionStorage Shim (Node 22 support) ──────────────────────

const mockStorage = () => {
    let store = new Map();
    return {
        getItem: (k) => store.has(k) ? store.get(k) : null,
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear(),
        get length() { return store.size; },
        key: (i) => Array.from(store.keys())[i] || null
    };
};

// Node 22 introduces a native localStorage that breaks if --localstorage-file is not provided.
// This overrides it so Vitest environments don't throw `TypeError: setItem is not a function`.
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage.setItem) {
    Object.defineProperty(globalThis, 'localStorage', { value: mockStorage(), writable: true });
}
if (typeof globalThis.sessionStorage === 'undefined' || !globalThis.sessionStorage.setItem) {
    Object.defineProperty(globalThis, 'sessionStorage', { value: mockStorage(), writable: true });
}