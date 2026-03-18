/**
 * oja/wasm.js
 * WebAssembly loader — clean API for today, ready for the Component Model tomorrow.
 *
 * Today's WASM requires manual fetch + instantiate + memory management.
 * OjaWasm abstracts all of that into a single clean interface.
 *
 * ─── Why this matters ─────────────────────────────────────────────────────────
 *
 *   The WebAssembly Component Model (in development) will eventually allow:
 *     import { processImage } from './processor.wasm';
 *
 *   Until browsers support that natively, OjaWasm provides the same clean API
 *   surface today. When the Component Model lands, OjaWasm can switch to the
 *   native path transparently — your call sites stay identical.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { OjaWasm } from '../oja/wasm.js';
 *
 *   const wasm = new OjaWasm('/modules/image-processor.wasm');
 *   await wasm.ready();
 *
 *   const result = await wasm.call('processImage', imageBuffer);
 *   wasm.close();
 *
 * ─── With JS imports (WASM needs functions from JS) ──────────────────────────
 *
 *   const wasm = new OjaWasm('/modules/heavy.wasm', {
 *       imports: {
 *           env: {
 *               log    : (ptr, len) => console.log(wasm.getString(ptr, len)),
 *               random : ()         => Math.random(),
 *           }
 *       }
 *   });
 *   await wasm.ready();
 *
 * ─── Run in a Worker (non-blocking — recommended for heavy WASM) ──────────────
 *
 *   const wasm = new OjaWasm('/modules/stable-diffusion.wasm', { worker: true });
 *   await wasm.ready();
 *
 *   // Main thread stays free — WASM runs off-thread
 *   const imageData = await wasm.call('generate', { prompt, width: 512, height: 512 });
 *
 * ─── Memory helpers ───────────────────────────────────────────────────────────
 *
 *   // Read a string from WASM memory (pointer + length)
 *   const str = wasm.getString(ptr, length);
 *
 *   // Write a string into WASM memory — returns pointer
 *   const ptr = wasm.setString('hello world');
 *
 *   // Read a typed array from WASM memory
 *   const arr = wasm.getBytes(ptr, length);   // → Uint8Array
 *
 *   // Write bytes into WASM memory — returns pointer
 *   const ptr = wasm.setBytes(new Uint8Array(buffer));
 *
 *   // Direct memory access
 *   wasm.memory   // → WebAssembly.Memory
 *   wasm.exports  // → all exported functions
 *
 * ─── Real-world patterns ──────────────────────────────────────────────────────
 *
 *   // Generative image — runs WASM off-thread, state on main thread
 *   const generator = new OjaWasm('/wasm/generator.wasm', { worker: true });
 *   await generator.ready();
 *
 *   on('#generate-btn', 'click', async (e, el) => {
 *       ui(el).loading('Generating...');
 *       const output = await generator.call('generate', {
 *           prompt : document.getElementById('prompt').value,
 *           width  : 512,
 *           height : 512,
 *       });
 *       setImageResult(output);  // reactive state → DOM updates
 *       ui(el).reset();
 *   });
 *   component.onUnmount(() => generator.close());
 *
 *   // ID card editor — synchronous WASM on main thread
 *   const renderer = new OjaWasm('/wasm/card-renderer.wasm');
 *   await renderer.ready();
 *   const cardPng = await renderer.call('renderCard', cardData);
 */

import { OjaWorker } from './worker.js';
import { debug }     from './debug.js';

export class OjaWasm {
    /**
     * @param {string} url       — path to .wasm file
     * @param {Object} options
     *   imports  : Object       — JS functions the WASM module imports
     *   worker   : boolean      — run WASM in a Worker thread (default: false)
     *   name     : string       — debug name
     */
    constructor(url, options = {}) {
        this._url     = url;
        this._imports = options.imports || {};
        this._name    = options.name    || url.split('/').pop();
        this._useWorker = options.worker || false;

        this._instance = null;
        this._exports  = null;
        this._memory   = null;
        this._worker   = null;
        this._ready    = false;
        this._readyPromise = null;

        debug.log('wasm', 'created', { name: this._name, worker: this._useWorker });
    }

    // ─── Loading ──────────────────────────────────────────────────────────────

    /**
     * Load and instantiate the WASM module.
     * Must be called before any wasm.call() or memory access.
     * Safe to call multiple times — only loads once.
     *
     *   await wasm.ready();
     */
    ready() {
        if (this._readyPromise) return this._readyPromise;

        this._readyPromise = this._useWorker
            ? this._loadInWorker()
            : this._loadDirect();

        return this._readyPromise;
    }

    async _loadDirect() {
        try {
            debug.log('wasm', 'loading', { name: this._name });

            const result = await WebAssembly.instantiateStreaming(
                fetch(this._url),
                this._imports
            );

            this._instance = result.instance;
            this._exports  = result.instance.exports;
            this._memory   = result.instance.exports.memory || null;
            this._ready    = true;

            debug.log('wasm', 'ready', { name: this._name });
        } catch (e) {
            // instantiateStreaming can fail if server doesn't send correct MIME type
            // Fall back to fetch + ArrayBuffer
            debug.log('wasm', 'streaming-failed-retrying', { name: this._name });
            const bytes  = await fetch(this._url).then(r => r.arrayBuffer());
            const result = await WebAssembly.instantiate(bytes, this._imports);

            this._instance = result.instance;
            this._exports  = result.instance.exports;
            this._memory   = result.instance.exports.memory || null;
            this._ready    = true;

            debug.log('wasm', 'ready', { name: this._name });
        }
        return this;
    }

    async _loadInWorker() {
        // Serialize the imports — functions can't be transferred to workers,
        // so we note which imports exist and reconstruct stubs in the worker.
        // Real function imports must be handled differently — see docs.
        const importNames = {};
        for (const [ns, fns] of Object.entries(this._imports)) {
            importNames[ns] = Object.keys(fns);
        }

        this._worker = new OjaWorker((self) => {
            // ⚠️ Self-contained — cannot access outer scope
            let _exports = null;
            let _memory  = null;

            self.handle('__load__', async ({ url, importNames }) => {
                // Reconstruct import stubs — real functions can't cross threads
                const imports = {};
                for (const [ns, names] of Object.entries(importNames)) {
                    imports[ns] = {};
                    for (const name of names) {
                        // Stub — logs a warning if called
                        imports[ns][name] = (...args) => {
                            console.warn(`[oja/wasm] Worker import called: ${ns}.${name}`, args);
                        };
                    }
                }

                try {
                    const result = await WebAssembly.instantiateStreaming(fetch(url), imports);
                    _exports = result.instance.exports;
                    _memory  = result.instance.exports.memory || null;
                    return { ok: true, exportNames: Object.keys(_exports) };
                } catch {
                    const bytes  = await fetch(url).then(r => r.arrayBuffer());
                    const result = await WebAssembly.instantiate(bytes, imports);
                    _exports = result.instance.exports;
                    _memory  = result.instance.exports.memory || null;
                    return { ok: true, exportNames: Object.keys(_exports) };
                }
            });

            self.handle('__call__', async ({ fn, args }) => {
                if (!_exports) throw new Error('WASM not loaded');
                if (!_exports[fn]) throw new Error(`No export: ${fn}`);

                // Convert plain objects back to typed arrays if needed
                const processed = args.map(arg => {
                    if (arg && arg.__type === 'Uint8Array') {
                        return new Uint8Array(arg.buffer);
                    }
                    return arg;
                });

                const result = await _exports[fn](...processed);
                return result;
            });

            self.handle('__getMemory__', async ({ ptr, len }) => {
                if (!_memory) throw new Error('No memory export');
                const bytes = new Uint8Array(_memory.buffer, ptr, len);
                return bytes.slice().buffer; // copy out as ArrayBuffer
            });

            self.handle('__setMemory__', async ({ data }) => {
                if (!_memory) throw new Error('No memory export');
                if (!_exports.malloc) throw new Error('No malloc export');
                const bytes = new Uint8Array(data);
                const ptr   = _exports.malloc(bytes.length);
                new Uint8Array(_memory.buffer, ptr, bytes.length).set(bytes);
                return { ptr, len: bytes.length };
            });

        }, { name: this._name });

        const result = await this._worker.call('__load__', {
            url         : this._url,
            importNames,
        });

        this._exportNames = result.exportNames;
        this._ready       = true;
        debug.log('wasm', 'ready-worker', { name: this._name });
        return this;
    }

    // ─── Calling exports ──────────────────────────────────────────────────────

    /**
     * Call a WASM exported function by name.
     * Returns a Promise regardless of whether running directly or in a Worker.
     *
     *   const result = await wasm.call('processImage', buffer);
     *   const id     = await wasm.call('generateId',   seedData);
     *
     * @param {string} fn     — exported WASM function name
     * @param {...any} args   — arguments (ArrayBuffers auto-transferred)
     */
    async call(fn, ...args) {
        if (!this._ready) {
            throw new Error(`[oja/wasm] "${this._name}" not ready — call await wasm.ready() first`);
        }

        if (this._useWorker) {
            // Serialize typed arrays for transfer
            const serialized = args.map(arg => {
                if (arg instanceof Uint8Array) return { __type: 'Uint8Array', buffer: arg.buffer };
                return arg;
            });

            // ransfers must be deduplicated to prevent detached buffer errors
            const transfers = [...new Set(args
                .filter(a => a instanceof ArrayBuffer || (a && a.buffer instanceof ArrayBuffer))
                .map(a => a instanceof ArrayBuffer ? a : a.buffer))];

            return this._worker.call('__call__', { fn, args: serialized }, transfers);
        }

        if (!this._exports[fn]) {
            throw new Error(`[oja/wasm] "${this._name}" has no export: "${fn}"`);
        }

        return Promise.resolve(this._exports[fn](...args));
    }

    // ─── Memory helpers ───────────────────────────────────────────────────────

    /**
     * Read a UTF-8 string from WASM linear memory.
     * Use when a WASM function returns a string as (pointer, length).
     *
     *   const str = wasm.getString(ptr, length);
     */
    getString(ptr, len) {
        if (!this._memory) throw new Error(`[oja/wasm] "${this._name}" has no memory export`);
        const bytes = new Uint8Array(this._memory.buffer, ptr, len);
        return new TextDecoder().decode(bytes);
    }

    /**
     * Write a UTF-8 string into WASM linear memory.
     * Requires the WASM module to export a malloc function.
     * Returns the pointer to the allocated string.
     *
     *   const ptr = wasm.setString('hello');
     */
    setString(str) {
        if (!this._memory)        throw new Error(`[oja/wasm] "${this._name}" has no memory export`);
        if (!this._exports.malloc) throw new Error(`[oja/wasm] "${this._name}" has no malloc export`);

        const bytes = new TextEncoder().encode(str);
        const ptr   = this._exports.malloc(bytes.length);
        new Uint8Array(this._memory.buffer, ptr, bytes.length).set(bytes);
        return ptr;
    }

    /**
     * Read raw bytes from WASM linear memory.
     * Returns a Uint8Array view (not a copy — don't store it long-term).
     *
     *   const bytes = wasm.getBytes(ptr, length);
     */
    getBytes(ptr, len) {
        if (!this._memory) throw new Error(`[oja/wasm] "${this._name}" has no memory export`);
        return new Uint8Array(this._memory.buffer, ptr, len);
    }

    /**
     * Write bytes into WASM linear memory.
     * Requires malloc export. Returns the pointer.
     *
     *   const ptr = wasm.setBytes(new Uint8Array(imageData));
     */
    setBytes(data) {
        if (!this._memory)         throw new Error(`[oja/wasm] "${this._name}" has no memory export`);
        if (!this._exports.malloc) throw new Error(`[oja/wasm] "${this._name}" has no malloc export`);

        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        const ptr   = this._exports.malloc(bytes.length);
        new Uint8Array(this._memory.buffer, ptr, bytes.length).set(bytes);
        return ptr;
    }

    // ─── State + cleanup ──────────────────────────────────────────────────────

    /** Direct access to all WASM exports */
    get exports() {
        return this._exports;
    }

    /** Direct access to WASM linear memory */
    get memory() {
        return this._memory;
    }

    get isReady() { return this._ready; }

    /**
     * Terminate the Worker (if running in worker mode).
     * Always call in component.onUnmount().
     *
     *   component.onUnmount(() => wasm.close());
     */
    close() {
        if (this._worker) {
            this._worker.close();
            this._worker = null;
        }
        this._ready   = false;
        this._exports = null;
        debug.log('wasm', 'closed', { name: this._name });
    }
}