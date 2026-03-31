import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploader } from '../../src/js/ext/uploader.js';

// Node has a native File class since v20, but it lacks the .content property that
// the FileReader mock relies on. Always override so the worker receives an object
// with .content, .slice(), and .arrayBuffer() that work in this environment.
class MockFile {
    constructor(content, name, options = {}) {
        this.content = Array.isArray(content) ? content[0] : content;
        this.name = name;
        this.type = options.type || 'text/plain';
        this.size = typeof this.content === 'string' ? this.content.length : 0;
        this.lastModified = Date.now();
    }
    slice(start, end) {
        return new MockFile([this.content.substring(start, end)], this.name);
    }
    arrayBuffer() {
        return Promise.resolve(new TextEncoder().encode(this.content).buffer);
    }
}
// Override unconditionally — Node's native File lacks .content/.slice compatibility
globalThis.File = MockFile;

// Uses setTimeout(10) to simulate async read — same latency as the XHR mock.
globalThis.FileReader = class {
    readAsDataURL(blob) {
        setTimeout(() => {
            // blob is a MockFile; blob.content is the raw string content
            this.result = `data:text/plain;base64,` + btoa(blob.content ?? '');
            if (this.onload) this.onload();
        }, 10);
    }
};

// Drain pending microtasks (Promise continuations, queueMicrotask callbacks).
// Does NOT advance fake timers.
async function flushMicrotasks(n = 5) {
    for (let i = 0; i < n; i++) await Promise.resolve();
}

describe('OjaUploader', () => {
    let xhrInstances = [];

    beforeEach(() => {
        vi.useFakeTimers();
        xhrInstances = [];

        class MockXHR {
            constructor() {
                this.upload = {};
                this.headers = {};
                xhrInstances.push(this);
            }
            open(method, url) {
                this.method = method;
                this.url = url;
            }
            setRequestHeader(k, v) { this.headers[k] = v; }
            send(body) {
                this.body = body;
                // Simulate async network — fires 10ms after send() is called
                setTimeout(() => {
                    if (this.upload.onprogress) {
                        const loaded = body?.size || body?.length || body?.byteLength || 0;
                        this.upload.onprogress({ lengthComputable: true, loaded, total: loaded });
                    }
                    this.status = 200;
                    this.responseText = '{"ok":true}';
                    if (this.onload) this.onload();
                }, 10);
            }
            abort() {
                this.status = 0;
                if (this.onabort) this.onabort();
            }
        }

        vi.stubGlobal('XMLHttpRequest', MockXHR);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    // ── Basic ──────────────────────────────────────────────────────────────────

    it('creates an uploader instance', () => {
        const up = uploader.create({ url: '/test' });
        expect(up).toBeDefined();
        expect(up.getQueue()).toEqual([]);
        up.destroy();
    });

    it('adds files to the queue and generates an ID', async () => {
        const up = uploader.create({ url: '/test' });
        const file = new File(['hello'], 'test.txt');
        const ids = up.add(file);

        expect(ids.length).toBe(1);
        const queue = up.getQueue();
        expect(queue.length).toBe(1);
        expect(queue[0].name).toBe('test.txt');
        // Synchronously 'queued'; becomes 'uploading' after the worker replies 'started'
        expect(['queued', 'uploading']).toContain(queue[0].status);
        up.destroy();
    });

    it('processes chunks using Content-Range and completes', async () => {
        const onComplete = vi.fn();
        const up = uploader.create({ url: '/test', chunkSize: 3, onComplete });

        const file = new File(['1234567'], 'data.txt'); // 7 bytes → 3 chunks
        up.add(file);

        await flushMicrotasks();

        vi.advanceTimersByTime(15); await flushMicrotasks(); // chunk 1
        vi.advanceTimersByTime(15); await flushMicrotasks(); // chunk 2
        vi.advanceTimersByTime(15); await flushMicrotasks(); // chunk 3

        expect(xhrInstances.length).toBe(3);
        expect(xhrInstances[0].headers['Content-Range']).toBe('bytes 0-2/7');
        expect(xhrInstances[1].headers['Content-Range']).toBe('bytes 3-5/7');
        expect(xhrInstances[2].headers['Content-Range']).toBe('bytes 6-6/7');
        expect(onComplete).toHaveBeenCalled();
        expect(up.getQueue()[0].status).toBe('complete');
        expect(up.getQueue()[0].progress).toBe(100);

        up.destroy();
    });

    it('respects parallel upload limits', async () => {
        const up = uploader.create({ url: '/test', parallel: 1 });

        const f1 = new File(['a'], '1.txt');
        const f2 = new File(['b'], '2.txt');
        up.add([f1, f2]);

        // Drain: worker init → add(f1) → processQueue → reply 'started'(f1) → main receives it
        await flushMicrotasks(8);

        const q = up.getQueue();
        expect(q[0].status).toBe('uploading');
        expect(q[1].status).toBe('queued'); // parallel=1 blocks f2

        // Advance exactly 10ms — fires xhr1 (scheduled at T=10) but NOT xhr2.
        // xhr2 is scheduled inside xhr1.onload at T=10+10=T=20, which this advance won't reach.
        vi.advanceTimersByTime(10);
        // Drain: xhr1.onload → worker: f1 complete, processQueue → f2 starts → reply 'started'(f2)
        //        + reply 'complete'(f1) — all delivered to main thread
        await flushMicrotasks(10);

        const q2 = up.getQueue();
        expect(q2[0].status).toBe('complete');
        expect(q2[1].status).toBe('uploading');

        up.destroy();
    });

    it('pauses and resumes uploads', async () => {
        const up = uploader.create({ url: '/test' });
        const file = new File(['abc'], 'test.txt');
        const [id] = up.add(file);

        // Wait for 'started' reply to arrive
        await flushMicrotasks(8);
        expect(up.getQueue()[0].status).toBe('uploading');

        // Pause before the XHR fires (XHR is at T=10, we're still at T=0)
        up.pause(id);
        await flushMicrotasks(8);

        expect(up.getQueue()[0].status).toBe('paused');

        // Resume — worker sets f back to 'queued' → processQueue → new XHR → reply 'started'
        up.resume(id);
        await flushMicrotasks(8);

        // After resume, status should be 'uploading' (XHR hasn't fired yet — no timer advance)
        expect(up.getQueue()[0].status).toBe('uploading');

        up.destroy();
    });

    it('cancels and removes uploads', async () => {
        const up = uploader.create({ url: '/test' });
        const file = new File(['abc'], 'test.txt');
        const [id] = up.add(file);

        await flushMicrotasks(4);

        up.cancel(id);
        await flushMicrotasks(4);

        expect(up.getQueue().length).toBe(0);
        up.destroy();
    });

    it('rejects files larger than maxSize', () => {
        const onError = vi.fn();
        const up = uploader.create({ url: '/test', maxSize: 5, onError });

        const file = new File(['123456'], 'big.txt'); // 6 bytes > 5
        up.add(file);

        expect(up.getQueue().length).toBe(0);
        expect(onError).toHaveBeenCalled();
        up.destroy();
    });

    // ── Chunk formats ──────────────────────────────────────────────────────────

    it('handles base64 chunkFormat correctly', async () => {
        const up = uploader.create({ url: '/test', chunkSize: 10, chunkFormat: 'base64' });
        const file = new File(['hello'], 'data.txt');
        up.add(file);

        // Drain worker startup microtasks
        await flushMicrotasks(6);

        // Fire FileReader.readAsDataURL's setTimeout (10ms)
        vi.advanceTimersByTime(10);
        // Worker promise resolves → xhr.send() scheduled inside same tick
        await flushMicrotasks(4);

        // Fire XHR's setTimeout (10ms)
        vi.advanceTimersByTime(10);
        await flushMicrotasks(4);

        expect(xhrInstances.length).toBe(1);
        expect(xhrInstances[0].body).toBe(btoa('hello'));

        up.destroy();
    });

    it('handles arraybuffer chunkFormat correctly', async () => {
        const up = uploader.create({ url: '/test', chunkSize: 10, chunkFormat: 'arraybuffer' });
        const file = new File(['hello'], 'data.txt');
        up.add(file);

        // chunk.arrayBuffer() resolves as a microtask (Promise.resolve)
        await flushMicrotasks(8);

        // Fire XHR's setTimeout (10ms)
        vi.advanceTimersByTime(10);
        await flushMicrotasks(4);

        expect(xhrInstances.length).toBe(1);
        // Use constructor.name instead of instanceof — ArrayBuffer identity can differ
        // across realms (jsdom window vs Node global) in the vitest/jsdom environment.
        expect(xhrInstances[0].body?.constructor?.name).toBe('ArrayBuffer');

        up.destroy();
    });

    it('handles uint8array chunkFormat correctly', async () => {
        const up = uploader.create({ url: '/test', chunkSize: 10, chunkFormat: 'uint8array' });
        const file = new File(['hello'], 'data.txt');
        up.add(file);

        // chunk.arrayBuffer() resolves as a microtask (Promise.resolve)
        await flushMicrotasks(8);

        // Fire XHR's setTimeout (10ms)
        vi.advanceTimersByTime(10);
        await flushMicrotasks(4);

        expect(xhrInstances.length).toBe(1);
        expect(xhrInstances[0].body instanceof Uint8Array).toBe(true);

        up.destroy();
    });
});