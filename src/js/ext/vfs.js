/**
 * oja/vfs.js
 * Virtual filesystem for the browser.
 *
 * Persistent file storage backed by IndexedDB, with background fetch,
 * offline-first mounting from remote URLs, and reactive change notifications.
 *
 * All I/O runs in a background Runner (Worker) — the main thread is never
 * blocked. File reads return on the main thread via request(). File writes
 * are fire-and-forget with an optional flush() for guaranteed persistence.
 *
 * ─── Core operations ─────────────────────────────────────────────────────────
 *
 *   const vfs = new VFS('my-app');
 *
 *   await vfs.write('index.html', '<h1>Hello</h1>');   // fire and forget
 *   await vfs.flush();                                  // guarantee all pending writes landed
 *   const html  = await vfs.readText('index.html');
 *   const bytes = await vfs.read('pages/logo.png');     // ArrayBuffer for binary
 *   await vfs.rm('old.html');
 *   const files = await vfs.ls('/');                    // flat list
 *   const tree  = await vfs.tree('/');                  // nested tree
 *   await vfs.clear();                                  // wipe entire namespace
 *
 * ─── Remote mounting ──────────────────────────────────────────────────────────
 *
 *   // Mount from a vfs.json file at the remote root
 *   await vfs.mount('https://raw.githubusercontent.com/agberohq/oja/main/example/hello/');
 *
 *   // Mount with polling — re-syncs every 60 seconds when online
 *   await vfs.mount('https://example.com/app/', { poll: 60000 });
 *
 *   // Mount with a specific manifest path
 *   await vfs.mount('https://example.com/app/', { manifest: 'files.json' });
 *
 *   // Force re-fetch everything even if already cached
 *   await vfs.mount('https://example.com/app/', { force: true });
 *
 * ─── Conflict policy during sync ─────────────────────────────────────────────
 *
 *   Remote changed + local NOT modified  →  overwrite silently
 *   Remote changed + local IS modified   →  keep local, emit 'conflict' event
 *
 * ─── Change notifications ─────────────────────────────────────────────────────
 *
 *   vfs.onChange('/', (path, content) => runPreview());
 *   vfs.onChange('pages/', (path) => console.log('page changed:', path));
 *   vfs.on('conflict', ({ path, remote, local }) => showConflictBadge(path));
 *   vfs.on('mounted',  ({ base, files }) => console.log('mounted', files.length, 'files'));
 *   vfs.on('synced',   ({ base, updated }) => console.log('synced', updated, 'files'));
 *
 * ─── Blob URL map — for iframe rendering ─────────────────────────────────────
 *
 *   const blobMap = await vfs.toBlobMap();
 *   // { 'index.html': 'blob:...', 'app.js': 'blob:...', ... }
 *   // Revoke when done:
 *   vfs.revokeBlobMap(blobMap);
 *
 * ─── Offline-first router integration ────────────────────────────────────────
 *
 *   const vfs    = new VFS('my-app');
 *   const router = new Router({ mode: 'hash', outlet: '#app', vfs });
 *
 *   await vfs.mount('https://raw.githubusercontent.com/me/my-app/main/');
 *   router.start('/');
 *   // Router checks VFS before network for every Out.component() call.
 */

import { Runner } from './runner.js';
import { state }  from '../core/reactive.js';
import { Out }    from '../core/out.js';

const MIME = {
    '.html' : 'text/html',
    '.js'   : 'text/javascript',
    '.css'  : 'text/css',
    '.json' : 'application/json',
    '.svg'  : 'image/svg+xml',
    '.png'  : 'image/png',
    '.jpg'  : 'image/jpeg',
    '.jpeg' : 'image/jpeg',
    '.gif'  : 'image/gif',
    '.webp' : 'image/webp',
    '.wasm' : 'application/wasm',
    '.txt'  : 'text/plain',
    '.md'   : 'text/markdown',
};

function mimeFor(path) {
    const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
    return MIME[ext] || 'application/octet-stream';
}

// All IndexedDB and fetch logic runs here — never on the main thread.

const WORKER_FN = function(self) {
    const DB_VERSION = 1;
    let   db         = null;
    let   ns         = '';            // namespace (VFS instance name)
    const dirty           = new Set();     // paths modified locally since last sync
    const pollTimers      = new Map();     // base → timer id
    const conflictWaiters = new Map();     // path → resolve fn — awaited during sync

    // IndexedDB helpers

    function openDB(name) {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('oja-vfs-' + name, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const d = e.target.result;
                if (!d.objectStoreNames.contains('files')) {
                    d.createObjectStore('files', { keyPath: 'path' });
                }
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror   = (e) => reject(e.target.error);
        });
    }

    function tx(mode, fn) {
        return new Promise((resolve, reject) => {
            const t   = db.transaction('files', mode);
            const req = fn(t.objectStore('files'));
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror   = (e) => reject(e.target.error);
        });
    }

    function dbPut(path, content, meta = {}) {
        return tx('readwrite', store =>
            store.put({ path, content, meta, updatedAt: Date.now() })
        );
    }

    function dbGet(path) {
        return tx('readonly', store => store.get(path));
    }

    function dbDelete(path) {
        return tx('readwrite', store => store.delete(path));
    }

    function dbGetAll() {
        return tx('readonly', store => store.getAll());
    }

    function dbClear() {
        return tx('readwrite', store => store.clear());
    }

    // MIME (worker copy)

    const MIME_MAP = {
        '.html':'.html','.js':'.js','.css':'.css','.json':'.json',
        '.svg':'.svg','.png':'.png','.jpg':'.jpg','.jpeg':'.jpeg',
        '.gif':'.gif','.webp':'.webp','.wasm':'.wasm',
        '.txt':'.txt','.md':'.md',
    };

    function isBinary(path) {
        const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
        return ['.png','.jpg','.jpeg','.gif','.webp','.wasm','.ico','.pdf'].includes(ext);
    }

    // Fetch helpers

    async function fetchFile(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
        if (isBinary(url)) {
            return await res.arrayBuffer();
        }
        return await res.text();
    }

    // Pause sync for a conflicting path until the main thread sends resolveConflict.
    // Returns 'local' or 'remote'. Resolves immediately with 'local' if no handler
    // is registered on the main thread (safe default — never loses local changes).
    function waitForResolution(path) {
        return new Promise(resolve => {
            conflictWaiters.set(path, resolve);
            // Safety timeout — if main thread never responds, keep local after 5s
            setTimeout(() => {
                if (conflictWaiters.has(path)) {
                    conflictWaiters.delete(path);
                    resolve('local');
                }
            }, 5000);
        });
    }

    // Tries oja.config.json then vfs.json (legacy) unless a specific manifest
    // name is provided via opts.manifest. Normalises the result so callers
    // always receive a plain { files: string[] } shape regardless of which
    // format the project uses (oja schema: manifest.vfs.files, legacy: manifest.files).
    async function fetchManifest(base, manifestName) {
        const candidates = manifestName
            ? [manifestName]
            : ['oja.config.json', 'vfs.json'];

        for (const name of candidates) {
            const res = await fetch(base + name);
            if (!res.ok) continue;
            const data = await res.json();
            return { files: data.vfs?.files ?? data.files ?? [] };
        }

        throw new Error(`No manifest found at ${base} (tried: ${candidates.join(', ')})`);
    }

    // Mount

    async function doMount(base, opts) {
        const manifestName = opts.manifest || null;
        const force        = opts.force    || false;

        const manifest = await fetchManifest(base, manifestName);
        const files    = manifest.files || [];

        const results  = await Promise.allSettled(
            files.map(async (file) => {
                const path = file.startsWith('/') ? file.slice(1) : file;
                const url  = base + path;

                // Skip if file exists locally and not forcing
                if (!force) {
                    const existing = await dbGet(path);
                    if (existing) return { path, skipped: true };
                }

                const content = await fetchFile(url);
                await dbPut(path, content, { remote: url, base });
                return { path, fetched: true };
            })
        );

        const fetched = results
            .filter(r => r.status === 'fulfilled' && r.value.fetched)
            .map(r => r.value.path);

        const failed = results
            .filter(r => r.status === 'rejected')
            .map(r => r.reason?.message || String(r.reason));

        return { base, files: files.length, fetched, failed };
    }

    // Sync (poll)

    async function doSync(base, opts) {
        const manifestName = opts.manifest || null;
        let   manifest;

        try {
            manifest = await fetchManifest(base, manifestName);
        } catch {
            return { base, updated: [], conflicts: [] };
        }

        const files     = manifest.files || [];
        const updated   = [];
        const conflicts = [];

        await Promise.allSettled(
            files.map(async (file) => {
                const path = file.startsWith('/') ? file.slice(1) : file;
                const url  = base + path;

                let remote;
                try { remote = await fetchFile(url); }
                catch { return; }

                const existing = await dbGet(path);

                if (!existing) {
                    await dbPut(path, remote, { remote: url, base });
                    updated.push(path);
                    return;
                }

                const isDirty = dirty.has(path);

                if (isDirty) {
                    // Emit conflict and wait for main-thread resolution before deciding
                    self.reply('conflict', { path, remote, local: existing.content });
                    const resolution = await waitForResolution(path);
                    if (resolution === 'remote') {
                        await dbPut(path, remote, { remote: url, base });
                        dirty.delete(path);
                        updated.push(path);
                    }
                    return;
                }

                if (existing.content !== remote) {
                    await dbPut(path, remote, { remote: url, base });
                    updated.push(path);
                }
            })
        );

        return { base, updated, conflicts };
    }

    // DB readiness gate — resolves when openDB() completes.
    // Any handler that calls tx() must await dbReady() first, otherwise
    // messages that arrive on the worker before 'init' finishes crash with
    // "Cannot read properties of null (reading 'transaction')".
    let dbReadyResolve = null;
    const dbReadyPromise = new Promise(res => { dbReadyResolve = res; });
    function dbReady() { return dbReadyPromise; }

    // Message handlers

    self.on('init', async ({ name }) => {
        ns = name;
        db = await openDB(name);
        dbReadyResolve(); // unblock all waiting handlers
        return { ready: true };
    });

    self.on('write', async ({ path, content }) => {
        await dbReady();
        await dbPut(path, content);
        dirty.add(path);
        self.reply('changed', { path, content });
        return { path };
    });

    self.on('flush', async () => {
        await dbReady();
        // All writes are synchronous in IndexedDB transactions — flush is a
        // sentinel that confirms the previous write queue is drained.
        return { flushed: true };
    });

    self.on('read', async ({ path }) => {
        await dbReady();
        const rec = await dbGet(path);
        if (!rec) return { path, content: null, found: false };
        return { path, content: rec.content, found: true };
    });

    self.on('rm', async ({ path, recursive }) => {
        await dbReady();
        const isDir = path.endsWith('/');
        const dirPath = path ? (isDir ? path : path + '/') : '';

        // Delete exact match
        if (path) {
            await dbDelete(path);
            dirty.delete(path);
            self.reply('changed', { path, content: null, deleted: true });
        }

        // Delete directory marker if implied by a bare path
        if (path && !isDir) {
            await dbDelete(dirPath);
            dirty.delete(dirPath);
        }

        // Recursive deletion of all nested items
        if (recursive) {
            const all = await dbGetAll();
            for (const r of all) {
                if (r.path.startsWith(dirPath)) {
                    await dbDelete(r.path);
                    dirty.delete(r.path);
                    self.reply('changed', { path: r.path, content: null, deleted: true });
                }
            }
        }

        return { path };
    });

    self.on('cp', async ({ src, dst }) => {
        await dbReady();
        const rec = await dbGet(src);
        if (!rec) throw new Error(`Source not found: ${src}`);
        await dbPut(dst, rec.content, rec.meta);
        dirty.add(dst);
        self.reply('changed', { path: dst, content: rec.content });
        return { src, dst };
    });

    self.on('mv', async ({ src, dst }) => {
        await dbReady();
        const rec = await dbGet(src);
        if (!rec) throw new Error(`Source not found: ${src}`);
        await dbPut(dst, rec.content, rec.meta);
        await dbDelete(src);
        dirty.add(dst);
        dirty.delete(src);
        self.reply('changed', { path: src, content: null, deleted: true });
        self.reply('changed', { path: dst, content: rec.content });
        return { src, dst };
    });

    self.on('mkdir', async ({ path }) => {
        await dbReady();
        // Automatically create parent directories
        let current = '';
        const parts = path.split('/').filter(Boolean);
        for (let i = 0; i < parts.length; i++) {
            current += parts[i] + '/';
            const existing = await dbGet(current);
            if (!existing) {
                await dbPut(current, '', { type: 'directory' });
                dirty.add(current);
                self.reply('changed', { path: current, content: '' });
            }
        }
        return { path };
    });

    self.on('isDir', async ({ path }) => {
        await dbReady();
        const rec = await dbGet(path);
        if (rec) return { isDir: true, path };
        // Implicit check — does anything live under this prefix?
        const all = await dbGetAll();
        const dirPath = path ? (path.endsWith('/') ? path : path + '/') : '';
        const hasChildren = all.some(r => r.path.startsWith(dirPath) && r.path !== dirPath);
        return { isDir: hasChildren, path };
    });

    self.on('exists', async ({ path }) => {
        await dbReady();
        const rec = await dbGet(path);
        return { exists: !!rec, path };
    });

    self.on('stat', async ({ path }) => {
        await dbReady();
        const rec = await dbGet(path);
        const isDirReq = path.endsWith('/');

        if (!rec) {
            if (isDirReq) {
                const all = await dbGetAll();
                const children = new Set();
                let hasChildren = false;
                for (const r of all) {
                    if (r.path.startsWith(path) && r.path !== path) {
                        hasChildren = true;
                        const relative = r.path.slice(path.length);
                        const firstPart = relative.split('/')[0];
                        if (firstPart) children.add(firstPart);
                    }
                }
                if (hasChildren) {
                    return { found: true, path, type: 'directory', size: 0, items: children.size, updatedAt: null };
                }
            }
            return { found: false, path };
        }

        const isDirMarker = rec.path.endsWith('/') && (rec.content === '' || rec.meta?.type === 'directory');
        if (isDirMarker) {
            const all = await dbGetAll();
            const prefix = rec.path;
            const children = new Set();
            for (const r of all) {
                if (r.path === prefix) continue;
                if (r.path.startsWith(prefix)) {
                    const relative = r.path.slice(prefix.length);
                    const firstPart = relative.split('/')[0];
                    if (firstPart) children.add(firstPart);
                }
            }
            return { found: true, path, type: 'directory', size: 0, items: children.size, updatedAt: rec.updatedAt };
        }

        return {
            found: true, path, type: 'file',
            size: typeof rec.content === 'string' ? rec.content.length : (rec.content?.byteLength || 0),
            updatedAt: rec.updatedAt,
        };
    });

    self.on('dir', async ({ prefix }) => {
        await dbReady();
        const all = await dbGetAll();
        const dirPrefix = prefix ? (prefix.endsWith('/') ? prefix : prefix + '/') : '';
        const items = new Map();

        for (const r of all) {
            if (!r.path.startsWith(dirPrefix) || r.path === dirPrefix) continue;
            const relative = r.path.slice(dirPrefix.length);
            const parts = relative.split('/').filter(Boolean);
            const name = parts[0];
            if (!name || items.has(name)) continue;

            const isDirMarker = r.path.endsWith('/') && parts.length === 1;
            const isNested    = parts.length > 1;

            if (isDirMarker) {
                items.set(name, { name, path: r.path, type: 'directory', size: 0, dirty: dirty.has(r.path), updatedAt: r.updatedAt });
            } else if (isNested) {
                items.set(name, { name, path: dirPrefix + name + '/', type: 'directory', size: 0, dirty: false, updatedAt: null });
            } else {
                items.set(name, {
                    name, path: r.path, type: 'file',
                    size: typeof r.content === 'string' ? r.content.length : (r.content?.byteLength || 0),
                    dirty: dirty.has(r.path), updatedAt: r.updatedAt,
                });
            }
        }

        const sorted = Array.from(items.values()).sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        return { items: sorted };
    });

    self.on('ls', async ({ prefix }) => {
        await dbReady();
        const all   = await dbGetAll();
        const p     = prefix === '/' ? '' : (prefix || '');
        const files = all
            .filter(r => r.path.startsWith(p))
            .map(r => ({
                path      : r.path,
                size      : typeof r.content === 'string'
                    ? r.content.length
                    : (r.content?.byteLength ?? 0),
                dirty     : dirty.has(r.path),
                updatedAt : r.updatedAt,
            }));
        return { files };
    });

    self.on('tree', async ({ prefix }) => {
        await dbReady();
        const all = await dbGetAll();
        const p   = prefix === '/' ? '' : (prefix || '');

        const tree = { name: p || '/', children: [] };
        const dirs = new Map();
        dirs.set(p || '/', tree);

        all
            .filter(r => r.path.startsWith(p))
            .sort((a, b) => a.path.localeCompare(b.path))
            .forEach(r => {
                const parts = r.path.slice(p.length).split('/').filter(Boolean);
                let   node  = tree;

                parts.forEach((part, i) => {
                    const isFile = i === parts.length - 1;
                    const dirKey = p + parts.slice(0, i + 1).join('/');

                    if (isFile) {
                        node.children.push({
                            name : part,
                            path : r.path,
                            size : typeof r.content === 'string'
                                ? r.content.length
                                : (r.content?.byteLength ?? 0),
                            dirty: dirty.has(r.path),
                        });
                    } else {
                        if (!dirs.has(dirKey)) {
                            const dir = { name: part, path: dirKey + '/', children: [] };
                            dirs.set(dirKey, dir);
                            node.children.push(dir);
                        }
                        node = dirs.get(dirKey);
                    }
                });
            });

        return tree;
    });

    self.on('getAll', async () => {
        await dbReady();
        const all = await dbGetAll();
        const map = {};
        all.forEach(r => { map[r.path] = r.content; });
        return { files: map };
    });

    self.on('clear', async () => {
        await dbReady();
        await dbClear();
        dirty.clear();
        for (const [, timer] of pollTimers) clearInterval(timer);
        pollTimers.clear();
        return { cleared: true };
    });

    self.on('clearDirty', async ({ path }) => {
        await dbReady();
        if (path) dirty.delete(path);
        else      dirty.clear();
        return { ok: true };
    });

    // Called by main thread in response to a 'conflict' event.
    // resolution: 'local' | 'remote'
    self.on('resolveConflict', ({ path, resolution }) => {
        const resolve = conflictWaiters.get(path);
        if (resolve) {
            conflictWaiters.delete(path);
            resolve(resolution === 'remote' ? 'remote' : 'local');
        }
        return { ok: true };
    });

    self.on('mount', async ({ base, opts }) => {
        await dbReady();
        const result = await doMount(base, opts || {});

        // Start polling if requested
        if (opts?.poll && opts.poll > 0) {
            if (pollTimers.has(base)) clearInterval(pollTimers.get(base));
            pollTimers.set(base, setInterval(async () => {
                const syncResult = await doSync(base, opts);
                self.reply('synced', syncResult);
                if (syncResult.conflicts.length > 0) {
                    syncResult.conflicts.forEach(c => self.reply('conflict', c));
                }
            }, opts.poll));
        }

        return result;
    });

    self.on('sync', async ({ base, opts }) => {
        await dbReady();
        return await doSync(base, opts || {});
    });

    self.on('stopPoll', async ({ base }) => {
        if (pollTimers.has(base)) {
            clearInterval(pollTimers.get(base));
            pollTimers.delete(base);
        }
        return { ok: true };
    });
};

export class VFS {
    #runner         = null;
    #changeWatchers = [];   // [{ prefix, fn }]
    #blobCache      = {};   // path → { url, content } for toBlobMap()
    #readyPromise   = null; // resolves when worker init completes

    // Reactive signals — main thread can effect() on these
    #fileCount    = null;
    #setFileCount = null;

    /**
     * Create a VFS instance backed by IndexedDB.
     *
     * Every VFS is isolated by name — two instances with the same name share
     * the same IndexedDB store. Use different names for different apps or
     * environments (e.g. 'my-app', 'my-app-preview').
     *
     * @param {string} name       — IndexedDB namespace. Required. Use a stable,
     *                              app-specific string — e.g. 'my-app', 'playground'.
     *                              Changing the name creates a separate store.
     *
     * @param {object} [options]
     *
     *   debug : boolean
     *     Log all operations (mount, sync, read, write, conflict) to the console.
     *     Useful during development. Default: false.
     *
     *   manifest : string
     *     Override the manifest filename for mount() and sync(). When omitted,
     *     the cascade is: oja.config.json → vfs.json (legacy).
     *     Override per-call:  vfs.mount(base, { manifest: 'custom.json' })
     *
     *   onConflict : 'keep-local' | 'take-remote' | function(path, local, remote) => 'local'|'remote'
     *     Policy when a remote sync finds a file modified both locally and remotely.
     *     'keep-local'  — never overwrite local changes (default).
     *     'take-remote' — always accept the remote version, discard local edits.
     *     function      — called per conflicting file; return 'local' or 'remote'.
     *
     * ─── Quick start ──────────────────────────────────────────────────────────
     *
     *   const vfs = new VFS('my-app');
     *   await vfs.ready();
     *
     * ─── With all options ─────────────────────────────────────────────────────
     *
     *   const vfs = new VFS('my-app', {
     *       debug:      true,
     *       manifest:   'vfs.json',
     *       onConflict: 'keep-local',
     *   });
     *
     * ─── Mount from remote on first load, read from cache after ──────────────
     *
     *   const vfs = new VFS('my-app');
     *   await vfs.ready();
     *   await vfs.mount('https://cdn.example.com/my-app/');
     *
     *   const router = new Router({ outlet: '#app', vfs });
     *   router.start('/');
     *
     * ─── Plug into Out directly (without Router) ──────────────────────────────
     *
     *   const vfs = new VFS('my-app');
     *   await vfs.ready();
     *
     *   Out.vfsUse(vfs);
     *   // All Out.component() calls now check VFS before the network.
     *
     *   // Or use vfs.component() for a VFS-scoped Out without global registration:
     *   router.Get('/home', vfs.component('pages/home.html'));
     */
    constructor(name, options = {}) {
        if (!name) throw new Error('[oja/vfs] name is required');

        this.name    = name;
        this.options = options;

        [this.#fileCount, this.#setFileCount] = state(0);

        this.#runner = new Runner(WORKER_FN);

        this.#runner.on('changed',  (data) => this.#onChanged(data));
        this.#runner.on('synced',   (data) => this.#onSynced(data));
        this.#runner.on('conflict', (data) => this.#onConflict(data));
        this.#runner.on('error',    (data) => console.error('[oja/vfs] worker error:', data));

        // Init is async — single Promise stored so ready() never polls.
        this.#readyPromise = this.#runner.request('init', { name }).then(() => {
            return this.#refreshCount();
        });
        this.#readyPromise.catch(() => {});
    }

    // Core operations

    /**
     * Write a file. Fire and forget — returns immediately.
     * Use flush() after to guarantee the write has landed in IndexedDB.
     *
     *   vfs.write('index.html', html);
     *   await vfs.flush();
     */
    write(path, content) {
        const normalised = this._normPath(path);
        if (this.options.encrypt?.seal) {
            // Invoke seal() synchronously so the call is registered immediately.
            // The resolved value is sent to the worker once the promise settles.
            // write() still returns undefined (fire and forget contract is preserved).
            const sealPromise = Promise.resolve(this.options.encrypt.seal(content));
            sealPromise.then(sealed => {
                this.#runner.send('write', { path: normalised, content: sealed });
            });
        } else {
            this.#runner.send('write', { path: normalised, content });
        }
    }

    /**
     * Guarantee all pending writes have been committed to IndexedDB.
     *
     *   vfs.write('a.html', a);
     *   vfs.write('b.html', b);
     *   await vfs.flush();  // both are now durable
     */
    async flush() {
        await this.#runner.request('flush');
    }

    /**
     * Read a file. Returns ArrayBuffer for binary files, string for text.
     *
     *   const html  = await vfs.readText('index.html');
     *   const bytes = await vfs.read('logo.png');
     */
    async read(path) {
        const { content, found } = await this.#runner.request('read', {
            path: this._normPath(path),
        });
        if (!found) return null;
        return content;
    }

    // Read a file as text — convenience wrapper over read()
    async readText(path) {
        const raw = await this.read(path);
        if (raw === null) return null;
        let text;
        if (raw instanceof ArrayBuffer) {
            text = new TextDecoder().decode(raw);
        } else {
            text = raw;
        }
        // Decrypt if encrypt hook is configured and content is sealed
        if (this.options.encrypt?.open && this.options.encrypt?.isSealed?.(text)) {
            text = await this.options.encrypt.open(text);
        }
        return text;
    }

    /**
     * Delete a file.
     *
     *   await vfs.rm('old.html');
     */
    /**
     * Delete a file or directory.
     * @param {string}  path            — path to remove
     * @param {boolean} [recursive]     — if true, remove all contents of a directory
     */
    async rm(path, recursive = false) {
        await this.#runner.request('rm', { path: this._normPath(path), recursive });
        this.#refreshCount();
    }

    /**
     * Copy a file from src to dst.
     *
     *   await vfs.cp('src/app.js', 'dist/app.js');
     */
    async cp(src, dst) {
        await this.#runner.request('cp', {
            src: this._normPath(src),
            dst: this._normPath(dst),
        });
        this.#refreshCount();
    }

    /**
     * Move / rename a file from src to dst.
     *
     *   await vfs.mv('old.html', 'new.html');
     */
    async mv(src, dst) {
        await this.#runner.request('mv', {
            src: this._normPath(src),
            dst: this._normPath(dst),
        });
        this.#refreshCount();
    }

    /**
     * Trigger a browser download of a VFS file.
     *
     *   await vfs.download('report.csv');
     */
    async download(path) {
        const content = await this.readText(path);
        if (content === null) return;
        const filename = path.split('/').pop() || 'download';
        const blob = new Blob([content], { type: this.mime(path) || 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    /**
     * Create a directory. Parent directories are created automatically.
     *
     *   await vfs.mkdir('assets/images');
     */
    async mkdir(path) {
        const normalised = this._normPath(path);
        const dirPath = normalised.endsWith('/') ? normalised : normalised + '/';
        await this.#runner.request('mkdir', { path: dirPath });
        this.#refreshCount();
    }

    /**
     * Check if a path is a directory (explicit marker or implicit from children).
     *
     *   const isDir = await vfs.isDir('assets');
     */
    async isDir(path) {
        const normalised = this._normPath(path);
        if (!normalised) return true; // root is always a directory
        const dirPath = normalised.endsWith('/') ? normalised : normalised + '/';
        const { isDir } = await this.#runner.request('isDir', { path: dirPath });
        return isDir;
    }

    /**
     * Check if a path exists (file or directory).
     *
     *   const exists = await vfs.exists('file.txt');
     *   const exists = await vfs.exists('folder');   // true if folder/ marker or children exist
     */
    async exists(path) {
        const normalised = this._normPath(path);
        if (!normalised) return true; // root always exists
        const fileCheck = await this.#runner.request('exists', { path: normalised });
        if (fileCheck.exists) return true;
        return this.isDir(path);
    }

    /**
     * Get metadata for a file or directory.
     *
     *   const s = await vfs.stat('app.js');
     *   // { type: 'file', size: 1234, updatedAt: 1712345678 }
     *
     *   const s = await vfs.stat('src');
     *   // { type: 'directory', items: 3, size: 0, updatedAt: null }
     */
    async stat(path) {
        const normalised = this._normPath(path);
        if (!normalised) {
            const rootItems = await this.dir('/');
            return { found: true, path: '/', type: 'directory', size: 0, items: rootItems.length, updatedAt: null };
        }
        const result = await this.#runner.request('stat', { path: normalised });
        if (result.found) return result;
        const dirPath = normalised.endsWith('/') ? normalised : normalised + '/';
        const dirResult = await this.#runner.request('stat', { path: dirPath });
        if (dirResult.found) return dirResult;
        return null;
    }

    /**
     * List directory contents with full type awareness.
     * Returns array of { name, path, type, size, dirty, updatedAt }.
     * Directories sort before files; both groups are alphabetical.
     *
     *   const items = await vfs.dir('/');
     *   const items = await vfs.dir('src');
     */
    async dir(dir = '/') {
        const normalised = this._normPath(dir);
        const { items } = await this.#runner.request('dir', { prefix: normalised });
        return items;
    }


    async ls(prefix = '/') {
        const { files } = await this.#runner.request('ls', { prefix });
        return files;
    }

    /**
     * Get a nested tree of files under a prefix.
     *
     *   const tree = await vfs.tree('/');
     */
    async tree(prefix = '/') {
        return await this.#runner.request('tree', { prefix });
    }

    /**
     * Get all files as a flat { path: content } map.
     *
     *   const all = await vfs.getAll();
     */
    async getAll() {
        const { files } = await this.#runner.request('getAll');
        return files;
    }

    /**
     * Wipe all files in this VFS namespace.
     *
     *   await vfs.clear();
     */
    async clear() {
        await this.#runner.request('clear');
        this.#setFileCount(0);
    }

    // Remote mounting

    /**
     * Mount files from a remote URL into the VFS.
     * Looks for oja.config.json then vfs.json (legacy) at the remote base.
     * The oja.config.json format uses vfs.files; vfs.json uses a top-level files array.
     *
     *   await vfs.mount('https://raw.githubusercontent.com/me/repo/main/example/');
     *   await vfs.mount('https://example.com/app/', { poll: 60000, force: true });
     *
     * @param {string} base      — base URL (must end with /)
     * @param {object} [opts]
     *   manifest : string  — override manifest filename (skips cascade)
     *   poll     : number  — poll interval in ms, 0 = no polling
     *   force    : boolean — re-fetch even if files exist locally
     */
    async mount(base, opts = {}) {
        if (!base.endsWith('/')) base += '/';
        const result = await this.#runner.request('mount', { base, opts });
        this.#refreshCount();
        this.#emit('mounted', result);
        if (this.options.debug) {
            console.log(`[oja/vfs] mounted ${base} — ${result.fetched.length} files fetched`);
        }
        return result;
    }

    /**
     * Manually trigger a sync against a previously mounted remote.
     * Respects the dirty bit — local modifications are never overwritten.
     *
     *   const { updated, conflicts } = await vfs.sync('https://example.com/app/');
     */
    async sync(base, opts = {}) {
        if (!base.endsWith('/')) base += '/';
        const result = await this.#runner.request('sync', { base, opts });
        if (result.updated.length > 0) this.#refreshCount();
        this.#emit('synced', result);
        return result;
    }

    /**
     * Stop polling a previously mounted remote.
     *
     *   await vfs.stopPoll('https://example.com/app/');
     */
    async stopPoll(base) {
        if (!base.endsWith('/')) base += '/';
        await this.#runner.request('stopPoll', { base });
    }

    /**
     * Mark a file as clean (not locally modified).
     * Call after accepting a remote update to allow future syncs to overwrite.
     *
     *   await vfs.clearDirty('pages/home.html');
     */
    async clearDirty(path) {
        await this.#runner.request('clearDirty', {
            path: path ? this._normPath(path) : null,
        });
    }

    // Out integration

    /**
     * Produce an Out scoped to this VFS instance.
     *
     * Reads from this VFS before the network, writes back on a network fetch.
     * Does not require Out.vfsUse() to be called globally — useful when you
     * have multiple VFS instances or want explicit per-route control.
     *
     *   // Global registration (one VFS for all routes):
     *   Out.vfsUse(vfs);
     *   router.Get('/', Out.c('pages/home.html'));
     *
     *   // Per-route VFS (explicit, no global side effect):
     *   router.Get('/', vfs.component('pages/home.html'));
     *   router.Get('/admin', adminVfs.component('pages/admin.html'));
     *
     *   // With data and lists — identical signature to Out.component():
     *   router.Get('/user', vfs.component('pages/user.html', { role: 'admin' }));
     *   router.Get('/list', vfs.component('pages/list.html', {}, { items: rows }));
     *
     * @param {string} path      — file path within the VFS (e.g. 'pages/home.html')
     * @param {object} [data]    — template data merged with route context
     * @param {object} [lists]   — named arrays passed to each() in the template
     * @param {object} [options] — same options as Out.component() — error, bypassCache
     */
    component(path, data = {}, lists = {}, options = {}) {
        // Pass this VFS instance directly into _ComponentOut via options.vfs.
        // _fetchHTML reads options.vfsOverride per-call — no global state touched,
        // so concurrent Out.list() renders each using their own VFS are safe.
        return Out.component(path, data, lists, { ...options, vfs: this });
    }

    // Shorthand alias matching Out.c()
    c(path, data, lists, options) {
        return this.component(path, data, lists, options);
    }

    // Blob URL map — for iframe rendering

    /**
     * Build a { path: blobUrl } map for all files.
     * Used by the playground and router to serve files to an iframe.
     * Call revokeBlobMap() when done to free memory.
     *
     *   const map = await vfs.toBlobMap();
     *   vfs.revokeBlobMap(map);
     */
    async toBlobMap() {
        const all = await this.getAll();
        const map = {};
        for (const [path, content] of Object.entries(all)) {
            const mime = mimeFor(path);
            const data = typeof content === 'string'
                ? [content]
                : [content];
            const blob = new Blob(data, { type: mime });
            map[path]  = URL.createObjectURL(blob);
        }
        return map;
    }

    // Revoke all blob URLs produced by toBlobMap()
    revokeBlobMap(map) {
        Object.values(map).forEach(url => URL.revokeObjectURL(url));
    }

    // Change watchers

    /**
     * Watch for file changes under a path prefix.
     * Called whenever a file is written, deleted, or synced from remote.
     * Returns an unsubscribe function.
     *
     *   const off = vfs.onChange('/', (path, content) => runPreview());
     *   const off = vfs.onChange('pages/', (path) => reloadPage(path));
     *   off(); // stop watching
     */
    onChange(prefix, fn) {
        const watcher = { prefix: prefix === '/' ? '' : prefix, fn };
        this.#changeWatchers.push(watcher);
        return () => {
            this.#changeWatchers = this.#changeWatchers.filter(w => w !== watcher);
        };
    }

    /**
     * Listen for VFS lifecycle events.
     * Events: 'mounted', 'synced', 'conflict'
     * Returns an unsubscribe function.
     *
     *   vfs.on('conflict', ({ path, remote, local }) => showBadge(path));
     *   vfs.on('mounted',  ({ base, fetched }) => console.log('ready'));
     */
    on(event, fn) {
        return this.#runner.on(event, fn);
    }

    // Reactive file count

    /**
     * Reactive signal — current number of files in the VFS.
     * Use inside effect() to react when files are added or removed.
     *
     *   effect(() => {
     *       console.log('files in VFS:', vfs.count());
     *   });
     */
    get count() { return this.#fileCount; }

    // Utilities

    /**
     * Resolves when the VFS worker is initialised and ready.
     * Safe to call multiple times — returns the same Promise each time.
     *
     *   const vfs = new VFS('my-app');
     *   await vfs.ready();
     *   const html = await vfs.readText('index.html');
     */
    /**
     * Resolves when the VFS worker is ready. Also requests durable storage
     * on first call so the browser won't evict notes under storage pressure.
     */
    async ready() {
        await this.#readyPromise;
        // Request durable storage once — fire-and-forget, non-fatal if denied.
        this.persist().catch(() => {});
        return this;
    }

    /**
     * Request durable (persistent) storage for this origin.
     * When granted, the browser requires explicit user action to evict data
     * rather than doing so silently under storage pressure.
     *
     *   const granted = await vfs.persist();
     *   if (!granted) console.warn('Storage may be evicted under pressure');
     *
     * @returns {Promise<boolean>}
     */
    async persist() {
        if (!navigator?.storage?.persist) return false;
        const already = await navigator.storage.persisted().catch(() => false);
        if (already) return true;
        return navigator.storage.persist().catch(() => false);
    }

    /**
     * Return storage usage and quota for this origin.
     *
     *   const { usedMB, quotaMB, percent } = await vfs.quota();
     *   console.log(`Using ${usedMB} MB of ${quotaMB} MB (${percent}%)`);
     *
     * @returns {Promise<{ used, quota, usedMB, quotaMB, percent } | null>}
     */
    async quota() {
        if (!navigator?.storage?.estimate) return null;
        const { usage = 0, quota = 0 } = await navigator.storage.estimate().catch(() => ({}));
        return {
            used:    usage,
            quota,
            usedMB:  (usage  / 1024 / 1024).toFixed(1),
            quotaMB: (quota  / 1024 / 1024).toFixed(0),
            percent: quota > 0 ? Math.round((usage / quota) * 100) : 0,
        };
    }

    // Returns the MIME type for a path
    mime(path) { return mimeFor(path); }

    /**
     * Shut down the VFS and release all resources.
     */
    close() {
        this.#runner.close();
        this.#changeWatchers = [];
    }

    // Internal

    #onChanged({ path, content, deleted }) {
        if (!path) return;
        this.#refreshCount();
        this.#changeWatchers.forEach(({ prefix, fn }) => {
            if (path.startsWith(prefix)) fn(path, deleted ? null : content);
        });
    }

    #onSynced({ updated }) {
        if (updated?.length > 0) {
            updated.forEach(path => this.#onChanged({ path, content: null }));
        }
    }

    #onConflict(data) {
        const policy = this.options.onConflict || 'keep-local';
        let resolution = 'local';

        if (policy === 'take-remote') {
            resolution = 'remote';
        } else if (typeof policy === 'function') {
            try {
                const result = policy(data.path, data.local, data.remote);
                resolution = result === 'remote' ? 'remote' : 'local';
            } catch (e) {
                console.warn('[oja/vfs] onConflict function threw — keeping local:', e);
                resolution = 'local';
            }
        }

        if (this.options.debug) {
            console.warn(`[oja/vfs] conflict on ${data.path} — resolution: ${resolution}`);
        }

        this.#runner.send('resolveConflict', { path: data.path, resolution });
    }

    #emit(event, data) {
        // Directly notify change watchers for mount/sync events
        if (event === 'mounted' && data.fetched) {
            data.fetched.forEach(path =>
                this.#changeWatchers.forEach(({ prefix, fn }) => {
                    if (path.startsWith(prefix)) fn(path, null);
                })
            );
        }
    }

    async #refreshCount() {
        const files = await this.ls('/');
        this.#setFileCount(files.length);
    }

    _normPath(path) {
        if (!path) throw new Error('[oja/vfs] path is required');
        // Strip leading slash — VFS uses relative paths internally
        return path.startsWith('/') ? path.slice(1) : path;
    }

    // Storage management

}