/**
 * oja/codecs/msgpack.js
 * MessagePack codec — binary serialisation, smaller payloads than JSON.
 * Opt-in: only use when both client and server support MessagePack.
 *
 * Agbero supports MessagePack natively when the client sends:
 *   Content-Type: application/msgpack
 *   Accept: application/msgpack
 *
 * ─── Usage with api.js ────────────────────────────────────────────────────────
 *
 *   import { MsgPackCodec } from '../oja/codecs/msgpack.js';
 *
 *   const api = new Api({
 *       base  : window.location.origin,
 *       codec : new MsgPackCodec()
 *   });
 *
 * ─── Usage with socket.js ─────────────────────────────────────────────────────
 *
 *   import { MsgPackCodec } from '../oja/codecs/msgpack.js';
 *
 *   const ws = new Socket('wss://api.example.com/live', {
 *       codec: new MsgPackCodec()
 *   });
 *
 *   // Server must also speak MessagePack on this endpoint.
 *
 * ─── Why MessagePack? ─────────────────────────────────────────────────────────
 *
 *   JSON:       {"hostname":"api.example.com","alive":true,"reqs":1024}
 *   MsgPack:    ~30% smaller, binary, no string escaping overhead
 *
 *   Real benefit shows up in:
 *   - High-frequency WebSocket frames (metrics, logs streaming)
 *   - Large API responses (hundreds of hosts/routes)
 *   - Mobile clients on slow connections
 *
 * ─── Dependencies ─────────────────────────────────────────────────────────────
 *
 *   This codec requires the @msgpack/msgpack library.
 *   It is loaded lazily — only fetched when MsgPackCodec is first used.
 *
 *   Via CDN (no install):
 *     The codec loads from esm.sh automatically.
 *
 *   Via npm (if you have a build step):
 *     npm install @msgpack/msgpack
 *     Then pass the instance manually:
 *       import * as msgpack from '@msgpack/msgpack';
 *       const codec = new MsgPackCodec({ msgpack });
 */

const CDN_URL = 'https://esm.sh/@msgpack/msgpack@3';

export class MsgPackCodec {
    /**
     * @param {Object} options
     *   msgpack : the @msgpack/msgpack module (optional — auto-loaded from CDN)
     */
    constructor(options = {}) {
        this._lib   = options.msgpack || null;
        this._ready = null; // Promise<lib>
    }

    get contentType() { return 'application/msgpack'; }
    get binaryType()  { return 'binary'; }
    get name()        { return 'msgpack'; }

    // Lazy load

    async _ensure() {
        if (this._lib) return this._lib;
        if (!this._ready) {
            this._ready = import(CDN_URL).then(mod => {
                this._lib = mod;
                return mod;
            });
        }
        return this._ready;
    }

    // Codec interface

    /**
     * Encode data to a Uint8Array.
     * Called by api.js before fetch body, and by socket.js before ws.send().
     */
    async encode(data) {
        const lib = await this._ensure();
        return lib.encode(data);  // → Uint8Array
    }

    /**
     * Decode a received ArrayBuffer or Uint8Array.
     * Called by api.js after response.arrayBuffer(), and by socket.js onmessage.
     */
    async decode(raw) {
        if (raw === null || raw === undefined) return null;

        const lib = await this._ensure();

        if (raw instanceof ArrayBuffer) {
            return lib.decode(new Uint8Array(raw));
        }
        if (raw instanceof Uint8Array) {
            return lib.decode(raw);
        }

        // Fallback — if somehow we got text, try JSON
        if (typeof raw === 'string') {
            try { return JSON.parse(raw); } catch { return raw; }
        }

        return lib.decode(raw);
    }

    /**
     * Synchronous encode — only safe if lib is already loaded.
     * Call after first async encode/decode to warm the cache.
     */
    encodeSync(data) {
        if (!this._lib) throw new Error('[oja/msgpack] codec not loaded yet — use encode() first');
        return this._lib.encode(data);
    }

    decodeSync(raw) {
        if (!this._lib) throw new Error('[oja/msgpack] codec not loaded yet — use decode() first');
        if (raw instanceof ArrayBuffer) return this._lib.decode(new Uint8Array(raw));
        return this._lib.decode(raw);
    }

    /**
     * Pre-load the library without encoding anything.
     * Call in app.js init if you want zero-latency on first use.
     *
     *   const codec = new MsgPackCodec();
     *   await codec.preload();
     */
    async preload() {
        await this._ensure();
        return this;
    }

    /**
     * Check if the library is loaded.
     */
    get isLoaded() {
        return this._lib !== null;
    }
}
