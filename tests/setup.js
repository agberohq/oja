
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

// Always install our mock storage implementation.
// writable: true lets subsequent Object.defineProperty calls override if needed.
Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage(),
    writable: true,
    configurable: true,
});
Object.defineProperty(globalThis, 'sessionStorage', {
    value: mockStorage(),
    writable: true,
    configurable: true,
});
// jsdom cannot execute blob: URL module scripts — setting script.src to a
// blob: URL does nothing and the load event never fires. This causes all
// _exec.js tests to timeout waiting for Promise resolution.
//
// This shim intercepts document.createElement('script'), and when .src is
// set to a blob:shim-* URL (created by our URL.createObjectURL shim above),
// it:
//   1. Retrieves the source text from _blobSources
//   2. Evaluates it via new Function so __oja_ready__ and window vars work
//   3. Dispatches the load event on the next microtask
//
// This faithfully reproduces the _exec.js execution model:
//   - preamble runs synchronously (destructures + deletes window[scopeKey])
//   - script body runs synchronously until first await
//   - load event fires after execution, just like a real browser

const _nativeCreateElement = document.createElement.bind(document);

document.createElement = function(tag, options) {
    const el = _nativeCreateElement(tag, options);
    if (tag.toLowerCase() !== 'script') return el;

    // Intercept .src assignment on script elements
    let _src = '';
    Object.defineProperty(el, 'src', {
        get() { return _src; },
        set(url) {
            _src = url;
            if (!url.startsWith('blob:shim-')) return;

            const source = _blobSources.get(url);
            if (source === undefined) return;

            // Execute synchronously on next microtask — matches browser behaviour
            // where module scripts execute after the current task completes.
            queueMicrotask(() => {
                try {
                    // Use Function constructor to evaluate in a scope where
                    // window globals (including window[scopeKey]) are accessible.
                    // We wrap in an async IIFE to support top-level await syntax.
                    const fn = new Function(source);
                    const result = fn();
                    // If the script is async, wait for it before firing load
                    if (result && typeof result.then === 'function') {
                        result.then(() => el.dispatchEvent(new Event('load')))
                            .catch(() => el.dispatchEvent(new Event('error')));
                    } else {
                        el.dispatchEvent(new Event('load'));
                    }
                } catch (err) {
                    el.dispatchEvent(Object.assign(new Event('error'), { error: err }));
                }
            });
        },
        configurable: true,
    });

    return el;
};