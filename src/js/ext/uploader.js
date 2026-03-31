/**
 * oja/uploader.js
 * Enterprise-grade chunked file uploader.
 * Runs entirely off the main thread via Web Worker (Runner).
 * Supports resumable uploads across page reloads, concurrency limits,
 * speed calculation, pause/resume/cancel, and native drag-and-drop.
 *
 * ─── Basic Usage ──────────────────────────────────────────────────────────────
 *
 *   import { uploader } from '../oja/uploader.js';
 *
 *   const up = uploader.create({
 *       url: '/api/upload',
 *       chunkSize: 5 * 1024 * 1024, // 5MB chunks
 *       chunkFormat: 'blob',        // 'blob' | 'base64' | 'arraybuffer' | 'uint8array'
 *       parallel: 2,                // 2 files at a time
 *       dropZone: '#upload-area',   // Auto-wires drag & drop!
 *       onProgress: (file, pct, speed) => {
 *           console.log(`${file.name}: ${pct}% (${speed})`);
 *       },
 *       onComplete: (file, res) => notify.success(`${file.name} uploaded!`),
 *   });
 *
 * ─── Resuming after refresh ───────────────────────────────────────────────────
 *
 *   Upload progress is automatically persisted to local storage based on a
 *   fingerprint of the file (name + size + lastModified).
 *   If the user refreshes the page, they simply drop the file again. The uploader
 *   will instantly skip the uploaded chunks and resume exactly where it left off.
 */

import { Runner } from './runner.js';
import { Store } from '../core/store.js';
import { emit } from '../core/events.js';
import { dragdrop } from '../ui/dragdrop.js';
import { formatBytes } from '../utils/formatter.js';

// This runs entirely in the background. Main thread is never blocked.

const WORKER_FN = function(self) {
    const files = new Map();
    let activeUploads = 0;
    let opts = {};

    function formatBytesWorker(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes =['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
    }

    function processQueue() {
        if (activeUploads >= opts.parallel) return;

        for (const [id, state] of files) {
            if (state.status === 'queued') {
                activeUploads++;
                state.status = 'uploading';
                // Notify main thread immediately so its mirror state reflects 'uploading'
                // without waiting for the first progress event (which has a 500ms threshold).
                self.reply('started', { id: state.id });
                uploadNextChunk(state);
                break;
            }
        }

        if (activeUploads < opts.parallel) {
            let hasMore = false;
            for (const state of files.values()) {
                if (state.status === 'queued') hasMore = true;
            }
            if (hasMore) processQueue();
        }
    }

    async function uploadNextChunk(state) {
        if (state.status !== 'uploading') return;

        const start = state.uploadedBytes;
        const end = Math.min(start + opts.chunkSize, state.size);
        // Off-thread slicing!
        const chunk = state.size > 0 ? state.file.slice(start, end) : state.file;
        const isLastChunk = end >= state.size;

        // Convert format if requested
        let payload = chunk;
        try {
            if (opts.chunkFormat === 'arraybuffer' || opts.chunkFormat === 'uint8array') {
                const buf = await chunk.arrayBuffer();
                payload = opts.chunkFormat === 'uint8array' ? new Uint8Array(buf) : buf;
            } else if (opts.chunkFormat === 'base64') {
                payload = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const res = reader.result;
                        resolve(res.includes(',') ? res.split(',')[1] : btoa(res));
                    };
                    reader.onerror = () => reject(new Error('FileReader error'));
                    reader.readAsDataURL(chunk);
                });
            }
        } catch (e) {
            handleChunkError(state, 'Format conversion failed');
            return;
        }

        // State might have changed (e.g. paused) while awaiting format conversion
        if (state.status !== 'uploading') return;

        const xhr = new XMLHttpRequest();
        state._xhr = xhr;

        xhr.open(opts.method, opts.url, true);
        xhr.setRequestHeader('Content-Range', `bytes ${start}-${Math.max(0, end - 1)}/${state.size}`);
        xhr.setRequestHeader('X-File-Id', state.id);
        xhr.setRequestHeader('X-File-Name', encodeURIComponent(state.name));

        if (opts.headers) {
            for (const k of Object.keys(opts.headers)) {
                xhr.setRequestHeader(k, opts.headers[k]);
            }
        }

        xhr.upload.onprogress = (e) => {
            if (!e.lengthComputable || state.status !== 'uploading') return;
            updateProgress(state, start + e.loaded);
        };

        xhr.onload = () => {
            if (state.status !== 'uploading') return;

            if (xhr.status >= 200 && xhr.status < 300) {
                state._retries = 0;
                state.uploadedBytes = end;
                updateProgress(state, end, true); // force update

                if (isLastChunk) {
                    state.status = 'complete';
                    state._xhr = null;
                    activeUploads--;

                    let responseData = xhr.responseText;
                    try { responseData = JSON.parse(responseData); } catch {}

                    self.reply('complete', { id: state.id, response: responseData });
                    processQueue();
                } else {
                    uploadNextChunk(state);
                }
            } else {
                handleChunkError(state, `HTTP ${xhr.status}`);
            }
        };

        xhr.onerror = () => handleChunkError(state, 'Network error');
        xhr.ontimeout = () => handleChunkError(state, 'Upload timeout');

        xhr.send(payload);
    }

    function handleChunkError(state, msg) {
        if (state.status !== 'uploading') return;
        if (state._retries < opts.retries) {
            state._retries++;
            setTimeout(() => uploadNextChunk(state), 1000 * state._retries);
            return;
        }
        state.status = 'error';
        state._xhr = null;
        activeUploads--;
        self.reply('error', { id: state.id, error: msg });
        processQueue();
    }

    function updateProgress(state, currentBytes, force = false) {
        state.progress = state.size === 0 ? 100 : Math.min(100, Math.round((currentBytes / state.size) * 100));

        const now = Date.now();
        const timeDiff = (now - state._lastUploadedTime) / 1000;

        if (timeDiff > 0.5 || force) {
            const bytesDiff = currentBytes - state._lastUploadedBytes;
            const currentSpeed = timeDiff > 0 ? bytesDiff / timeDiff : 0;

            state._speedHistory.push(currentSpeed);
            if (state._speedHistory.length > 5) state._speedHistory.shift();

            const avgSpeed = state._speedHistory.reduce((a, b) => a + b, 0) / state._speedHistory.length;
            state.speed = formatBytesWorker(avgSpeed) + '/s';

            state._lastUploadedTime = now;
            state._lastUploadedBytes = currentBytes;

            self.reply('progress', {
                id: state.id,
                progress: state.progress,
                speed: state.speed,
                uploadedBytes: currentBytes
            });
        }
    }

    self.on('init', (options) => { opts = options; });

    self.on('add', (data) => {
        files.set(data.id, {
            ...data,
            status: 'queued',
            _speedHistory:[],
            _lastUploadedTime: Date.now(),
            _lastUploadedBytes: data.uploadedBytes,
            _retries: 0,
            _xhr: null
        });
        processQueue();
    });

    self.on('pause', ({ id }) => {
        const state = files.get(id);
        if (state && state.status === 'uploading') {
            state.status = 'paused';
            if (state._xhr) state._xhr.abort();
            activeUploads--;
            self.reply('paused', { id });
            processQueue();
        }
    });

    self.on('resume', ({ id }) => {
        const state = files.get(id);
        if (state && (state.status === 'paused' || state.status === 'error')) {
            state.status = 'queued';
            self.reply('resumed', { id });
            processQueue();
        }
    });

    self.on('cancel', ({ id }) => {
        const state = files.get(id);
        if (!state) return;
        const wasUploading = state.status === 'uploading';
        state.status = 'canceled';
        if (state._xhr) state._xhr.abort();
        files.delete(id);
        if (wasUploading) {
            activeUploads--;
        }
        self.reply('canceled', { id });
        processQueue();
    });
};


export class OjaUploader {
    constructor(options = {}) {
        this.options = {
            url: '/upload',
            method: 'POST',
            chunkSize: 5 * 1024 * 1024, // 5MB
            chunkFormat: 'blob',        // blob, base64, arraybuffer, uint8array
            parallel: 2,
            retries: 3,
            headers: {},
            autoStart: true,
            dropZone: null,
            accept:[],
            maxSize: Infinity,
            onAdded: null,
            onProgress: null,
            onComplete: null,
            onError: null,
            ...options
        };

        this.files = new Map(); // Main thread mirror of worker state

        // Persist upload progress across page refreshes
        this._store = new Store('oja:uploads', { prefer: 'local' });

        this._runner = new Runner(WORKER_FN);
        this._runner.send('init', this.options);

        // ─── Wire Worker Events ───────────────────────────────────────────────

        // 'started' fires as soon as the worker begins uploading a file — before the
        // first progress event (which has a 500ms throttle). This keeps the main-thread
        // mirror in sync so getQueue() reflects 'uploading' immediately.
        this._runner.on('started', (data) => {
            const state = this.files.get(data.id);
            if (state) {
                state.status = 'uploading';
                emit('uploader:started', this._sanitizeState(state));
            }
        });

        this._runner.on('progress', (data) => {
            const state = this.files.get(data.id);
            if (state) {
                state.progress = data.progress;
                state.speed = data.speed;
                state.uploadedBytes = data.uploadedBytes;
                state.status = 'uploading';

                // Save progress for refresh-resilience
                this._store.set(state.id, state.uploadedBytes);

                if (this.options.onProgress) this.options.onProgress(this._sanitizeState(state), state.progress, state.speed);
                emit('uploader:progress', this._sanitizeState(state));
            }
        });

        this._runner.on('complete', (data) => {
            const state = this.files.get(data.id);
            if (state) {
                state.status = 'complete';
                state.progress = 100;

                // Clear from persistent store — it's done!
                this._store.clear(state.id);

                if (this.options.onComplete) this.options.onComplete(this._sanitizeState(state), data.response);
                emit('uploader:complete', { file: this._sanitizeState(state), response: data.response });
            }
        });

        this._runner.on('error', (data) => {
            const state = this.files.get(data.id);
            if (state) {
                state.status = 'error';
                if (this.options.onError) this.options.onError(this._sanitizeState(state), new Error(data.error));
                emit('uploader:error', { file: this._sanitizeState(state), error: new Error(data.error) });
            }
        });

        this._runner.on('paused', (data) => {
            const state = this.files.get(data.id);
            if (state) { state.status = 'paused'; emit('uploader:paused', this._sanitizeState(state)); }
        });

        this._runner.on('resumed', (data) => {
            const state = this.files.get(data.id);
            if (state) { state.status = 'queued'; emit('uploader:resumed', this._sanitizeState(state)); }
        });

        this._runner.on('canceled', (data) => {
            const state = this.files.get(data.id);
            if (state) {
                state.status = 'canceled';
                this._store.clear(state.id); // clear persistent cache
                emit('uploader:canceled', this._sanitizeState(state));
                this.files.delete(data.id);
            }
        });

        if (this.options.dropZone) {
            this.attachDropZone(this.options.dropZone);
        }
    }

    add(fileInput) {
        const fileList = fileInput instanceof FileList ? Array.from(fileInput) :
            Array.isArray(fileInput) ? fileInput : [fileInput];

        const addedIds =[];

        for (const file of fileList) {
            if (!(file instanceof File)) continue;

            if (file.size > this.options.maxSize) {
                const err = new Error(`File exceeds max size of ${formatBytes(this.options.maxSize)}`);
                if (this.options.onError) this.options.onError({ name: file.name }, err);
                continue;
            }

            // Fingerprint identifies the file across page reloads
            const id = this._generateId(file);

            // Check if we have progress saved from a previous session
            const savedBytes = this._store.get(id, 0);

            const state = {
                id,
                file,
                name: file.name,
                size: file.size,
                type: file.type,
                status: 'queued',
                progress: file.size > 0 ? Math.round((savedBytes / file.size) * 100) : 0,
                uploadedBytes: savedBytes,
                speed: '0 B/s'
            };

            this.files.set(id, state);
            addedIds.push(id);

            if (this.options.onAdded) this.options.onAdded(this._sanitizeState(state));
            emit('uploader:added', this._sanitizeState(state));

            // Only start uploading immediately if autoStart is true (default).
            // When autoStart is false the caller must invoke start(id) manually.
            if (this.options.autoStart) {
                this._runner.send('add', {
                    id: state.id,
                    file: state.file,
                    name: state.name,
                    size: state.size,
                    type: state.type,
                    uploadedBytes: state.uploadedBytes
                });
            }
        }

        return addedIds;
    }

    /**
     * Manually start a file that was added with autoStart: false.
     * Calling start() on a file that is already uploading/complete is a no-op.
     *
     *   const [id] = up.add(file);
     *   // ... show confirmation dialog ...
     *   up.start(id);
     */
    start(id) {
        const state = this.files.get(id);
        if (!state || state.status !== 'queued') return;
        this._runner.send('add', {
            id: state.id,
            file: state.file,
            name: state.name,
            size: state.size,
            type: state.type,
            uploadedBytes: state.uploadedBytes
        });
    }

    pause(id) { this._runner.send('pause', { id }); }
    resume(id) { this._runner.send('resume', { id }); }
    cancel(id) { this._runner.send('cancel', { id }); }

    getQueue() {
        return Array.from(this.files.values()).map(this._sanitizeState);
    }

    attachDropZone(selector) {
        return dragdrop.dropZone(selector, {
            accept: this.options.accept,
            maxSize: this.options.maxSize,
            onDrop: (files) => this.add(files),
            onError: (msg) => {
                if (this.options.onError) this.options.onError({ name: 'DropZone' }, new Error(msg));
            }
        });
    }

    destroy() {
        this._runner.close();
    }

    _generateId(file) {
        // Creates a robust fingerprint for refresh-resilience
        const str = `${file.name}-${file.size}-${file.lastModified}`;
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = Math.imul(31, hash) + str.charCodeAt(i) | 0;
        }
        return `oja-up-${hash}`;
    }

    _sanitizeState(state) {
        return {
            id: state.id,
            name: state.name,
            size: state.size,
            type: state.type,
            status: state.status,
            progress: state.progress,
            uploadedBytes: state.uploadedBytes,
            speed: state.speed
        };
    }
}

export const uploader = {
    create: (options) => new OjaUploader(options)
};