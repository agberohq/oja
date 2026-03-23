/**
 * oja/clipboard.js
 * Clipboard API utilities for copy/paste operations.
 * Provides simple, promise-based clipboard access with fallbacks.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { clipboard } from '../oja/clipboard.js';
 *
 *   // Copy text
 *   await clipboard.write('Hello World');
 *
 *   // Read text
 *   const text = await clipboard.read();
 *
 *   // Copy with feedback
 *   on('#copy-btn', 'click', async (e, el) => {
 *       const success = await clipboard.write('Text to copy');
 *       if (success) {
 *           notify.success('Copied!');
 *       } else {
 *           notify.error('Copy failed');
 *       }
 *   });
 *
 * ─── Copy from element ────────────────────────────────────────────────────────
 *
 *   // Copy input value
 *   clipboard.from('#host-input');
 *
 *   // Copy element text content
 *   clipboard.from('#host-ip', { type: 'text' });
 *
 *   // Copy attribute
 *   clipboard.from('#avatar', { attribute: 'src' });
 *
 * ─── Rich content ─────────────────────────────────────────────────────────────
 *
 *   // Copy HTML
 *   await clipboard.writeHtml('<b>Bold text</b>');
 *
 *   // Copy multiple formats
 *   await clipboard.write({
 *       'text/plain': 'Plain text',
 *       'text/html': '<b>HTML</b>',
 *       'text/rtf': '{\\rtf1\\b HTML}',
 *   });
 *
 * ─── Images ───────────────────────────────────────────────────────────────────
 *
 *   // Copy image from canvas
 *   const canvas = document.querySelector('#chart');
 *   await clipboard.writeImage(canvas);
 *
 *   // Copy image from URL
 *   await clipboard.writeImageFromUrl('/assets/diagram.png');
 *
 *   // Read image
 *   const blob = await clipboard.readImage();
 *   const url = URL.createObjectURL(blob);
 *   imgElement.src = url;
 *
 * ─── Files ────────────────────────────────────────────────────────────────────
 *
 *   // Copy files
 *   await clipboard.writeFiles(fileList);
 *
 *   // Read files
 *   const files = await clipboard.readFiles();
 *
 * ─── Cut operations ───────────────────────────────────────────────────────────
 *
 *   // Cut from input
 *   clipboard.cut('#search-input');
 *
 *   // Cut with custom data
 *   clipboard.cut({
 *       'text/plain': 'Selected text',
 *       'custom/type': JSON.stringify(data),
 *   });
 *
 * ─── Event handlers ───────────────────────────────────────────────────────────
 *
 *   // Handle paste events
 *   clipboard.onPaste('#editor', (data) => {
 *       if (data['text/html']) {
 *           insertHtml(data['text/html']);
 *       } else {
 *           insertText(data['text/plain']);
 *       }
 *   });
 *
 *   // Handle copy/cut events
 *   clipboard.onCopy('#table', (e) => {
 *       e.preventDefault();
 *       clipboard.write(generateTableData());
 *   });
 */

// ─── State ────────────────────────────────────────────────────────────────────

// Check if Clipboard API is supported
const HAS_CLIPBOARD = !!(navigator.clipboard?.write);
const HAS_PICKER = !!(navigator.clipboard?.read);

// Fallback for older browsers
let _fallbackTextarea    = null;

// ─── Core API ─────────────────────────────────────────────────────────────────

export const clipboard = {
    /**
     * Check if Clipboard API is supported
     */
    get supported() {
        return HAS_CLIPBOARD;
    },

    /**
     * Check if read is supported
     */
    get canRead() {
        return HAS_PICKER;
    },

    /**
     * Write text to clipboard
     */
    async write(text, options = {}) {
        const { format = 'text/plain' } = options;

        try {
            if (HAS_CLIPBOARD) {
                if (format === 'text/plain') {
                    await navigator.clipboard.writeText(text);
                } else {
                    const blob = new Blob([text], { type: format });
                    await navigator.clipboard.write([
                        new ClipboardItem({
                            [format]: blob,
                        }),
                    ]);
                }
                return true;
            }
            return this._fallbackWrite(text);
        } catch (err) {
            console.warn('[oja/clipboard] Write failed:', err);
            return this._fallbackWrite(text);
        }
    },

    /**
     * Write multiple formats to clipboard
     */
    async writeMul(data) {
        if (!HAS_CLIPBOARD) {
            // Fallback to first available format
            const firstFormat = Object.values(data)[0];
            return this.write(firstFormat);
        }

        try {
            const items = {};
            for (const [type, content] of Object.entries(data)) {
                items[type] = new Blob([content], { type });
            }
            await navigator.clipboard.write([new ClipboardItem(items)]);
            return true;
        } catch (err) {
            console.warn('[oja/clipboard] Multi-format write failed:', err);
            return false;
        }
    },

    /**
     * Write HTML to clipboard
     */
    async writeHtml(html) {
        return this.write({
            'text/html': html,
            'text/plain': this._stripHtml(html),
        });
    },

    /**
     * Write image to clipboard from canvas
     */
    async writeImage(canvas, options = {}) {
        const { format = 'image/png', quality = 1 } = options;

        return new Promise((resolve) => {
            canvas.toBlob(async (blob) => {
                try {
                    if (HAS_CLIPBOARD) {
                        await navigator.clipboard.write([
                            new ClipboardItem({
                                [format]: blob,
                            }),
                        ]);
                        resolve(true);
                    } else {
                        console.warn('[oja/clipboard] Image copy not supported in this browser');
                        resolve(false);
                    }
                } catch {
                    resolve(false);
                }
            }, format, quality);
        });
    },

    /**
     * Write image from URL
     */
    async writeImageFromUrl(url, options = {}) {
        try {
            const img = new Image();
            img.crossOrigin = 'anonymous';

            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = url;
            });

            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            return this.writeImage(canvas, options);
        } catch (err) {
            console.warn('[oja/clipboard] Failed to load image:', err);
            return false;
        }
    },

    /**
     * Write files to clipboard
     */
    async writeFiles(files) {
        if (!HAS_CLIPBOARD || files.length === 0) return false;

        try {
            const items = {};
            for (const file of files) {
                items[file.type || 'application/octet-stream'] = file;
            }
            await navigator.clipboard.write([new ClipboardItem(items)]);
            return true;
        } catch (err) {
            console.warn('[oja/clipboard] File copy failed:', err);
            return false;
        }
    },

    /**
     * Read text from clipboard
     */
    async read() {
        try {
            if (HAS_PICKER) {
                return await navigator.clipboard.readText();
            }
            return this._fallbackRead();
        } catch (err) {
            console.warn('[oja/clipboard] Read failed:', err);
            return null;
        }
    },

    /**
     * Read all formats from clipboard
     */
    async readAll() {
        if (!HAS_PICKER) {
            const text = await this.read();
            return text ? { 'text/plain': text } : null;
        }

        try {
            const items = await navigator.clipboard.read();
            const result = {};

            for (const item of items) {
                for (const type of item.types) {
                    const blob = await item.getType(type);
                    if (type.startsWith('text/')) {
                        result[type] = await blob.text();
                    } else {
                        result[type] = blob;
                    }
                }
            }

            return result;
        } catch (err) {
            console.warn('[oja/clipboard] Read all failed:', err);
            return null;
        }
    },

    /**
     * Read image from clipboard
     */
    async readImage() {
        if (!HAS_PICKER) return null;

        try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
                for (const type of item.types) {
                    if (type.startsWith('image/')) {
                        return await item.getType(type);
                    }
                }
            }
            return null;
        } catch (err) {
            console.warn('[oja/clipboard] Read image failed:', err);
            return null;
        }
    },

    /**
     * Read files from clipboard
     */
    async readFiles() {
        if (!HAS_PICKER) return [];

        try {
            const items = await navigator.clipboard.read();
            const files = [];

            for (const item of items) {
                for (const type of item.types) {
                    if (!type.startsWith('text/') && !type.startsWith('image/')) {
                        const blob = await item.getType(type);
                        files.push(blob);
                    }
                }
            }

            return files;
        } catch (err) {
            console.warn('[oja/clipboard] Read files failed:', err);
            return [];
        }
    },

    /**
     * Copy from element
     */
    from(selector, options = {}) {
        const { type = 'value', attribute = null } = options;
        const el = typeof selector === 'string'
            ? document.querySelector(selector)
            : selector;

        if (!el) return false;

        let content = '';
        if (attribute) {
            content = el.getAttribute(attribute) || '';
        } else if (type === 'value' && (el.value !== undefined)) {
            content = el.value;
        } else {
            content = el.textContent || el.innerText || '';
        }

        return this.write(content);
    },

    /**
     * Cut operation (copy + clear)
     */
    async cut(data) {
        if (typeof data === 'string') {
            const success = await this.write(data);
            if (success && document.activeElement) {
                const el = document.activeElement;
                if (el.value !== undefined) {
                    const start = el.selectionStart;
                    const end = el.selectionEnd;
                    if (start !== undefined && end !== undefined) {
                        el.value = el.value.substring(0, start) + el.value.substring(end);
                    }
                }
            }
            return success;
        }

        return this.write(data);
    },

    /**
     * Handle paste events on element
     */
    onPaste(selector, handler) {
        const el = typeof selector === 'string'
            ? document.querySelector(selector)
            : selector;

        if (!el) return () => {};

        const pasteHandler = async (e) => {
            e.preventDefault();

            const data = {};

            // Try Clipboard API first
            if (e.clipboardData) {
                for (let i = 0; i < e.clipboardData.items.length; i++) {
                    const item = e.clipboardData.items[i];
                    if (item.type.startsWith('text/')) {
                        item.getAsString(text => {
                            data[item.type] = text;
                        });
                    } else {
                        data[item.type] = item.getAsFile();
                    }
                }
            }

            // Fallback to our API
            if (Object.keys(data).length === 0) {
                const allData = await this.readAll();
                if (allData) {
                    Object.assign(data, allData);
                }
            }

            handler(data, e);
        };

        el.addEventListener('paste', pasteHandler);
        return () => el.removeEventListener('paste', pasteHandler);
    },

    /**
     * Handle copy events on element
     */
    onCopy(selector, handler) {
        const el = typeof selector === 'string'
            ? document.querySelector(selector)
            : selector;

        if (!el) return () => {};

        const copyHandler = (e) => {
            handler(e);
        };

        el.addEventListener('copy', copyHandler);
        return () => el.removeEventListener('copy', copyHandler);
    },

    /**
     * Handle cut events on element
     */
    onCut(selector, handler) {
        const el = typeof selector === 'string'
            ? document.querySelector(selector)
            : selector;

        if (!el) return () => {};

        const cutHandler = (e) => {
            handler(e);
        };

        el.addEventListener('cut', cutHandler);
        return () => el.removeEventListener('cut', cutHandler);
    },

    // ─── Fallback methods ────────────────────────────────────────────────────

    _fallbackWrite(text) {
        try {
            if (!_fallbackTextarea) {
                _fallbackTextarea = document.createElement('textarea');
                _fallbackTextarea.style.position = 'fixed';
                _fallbackTextarea.style.top = '-9999px';
                _fallbackTextarea.style.left = '-9999px';
                _fallbackTextarea.style.width = '2em';
                _fallbackTextarea.style.height = '2em';
                _fallbackTextarea.style.padding = '0';
                _fallbackTextarea.style.border = 'none';
                _fallbackTextarea.style.outline = 'none';
                _fallbackTextarea.style.boxShadow = 'none';
                _fallbackTextarea.style.background = 'transparent';
                document.body.appendChild(_fallbackTextarea);
            }

            _fallbackTextarea.value = text;
            _fallbackTextarea.select();
            _fallbackTextarea.setSelectionRange(0, text.length);

            const success = document.execCommand('copy');

            if (_fallbackTextarea) {
                _fallbackTextarea.blur();
            }

            return success;
        } catch {
            return false;
        }
    },

    _fallbackRead() {
        // Can't read from clipboard with fallback
        return null;
    },

    _stripHtml(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
    },

    // ─── Component copy / paste ───────────────────────────────────────────────
    //
    // Copy a mounted Oja component (its HTML snapshot + data snapshot) to an
    // internal clipboard. Paste creates a new instance by calling onPaste with
    // the saved data — the app decides where to mount it.
    //
    // Designed for design editors (ID card, canvas tools) where you need to
    // duplicate elements with their current state.
    //
    //   // Copy — snapshot HTML + app-level data
    //   clipboard.copyComponent('#card-element', {
    //       data: () => getCardState(),          // called at copy time
    //       component: 'components/card.html',   // optional: component path for re-mounting
    //   });
    //
    //   // Paste — receives the saved snapshot
    //   clipboard.pasteComponent({
    //       onPaste: ({ html, data, component }) => {
    //           addCanvasElement(data);           // restore app state
    //       },
    //   });
    //
    //   // Or wire to keyboard shortcuts:
    //   keys({
    //       'ctrl+c': () => clipboard.copyComponent('#selected'),
    //       'ctrl+v': () => clipboard.pasteComponent({ onPaste: duplicateSelected }),
    //   });
    //
    _componentClipboard: null,

    copyComponent(target, options = {}) {
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        if (!el) {
            console.warn(`[oja/clipboard] copyComponent: element not found: ${target}`);
            return false;
        }

        const {
            data      = null,   // fn() → serialisable state snapshot
            component = null,   // component URL for re-mounting
        } = options;

        const snapshot = {
            html:      el.outerHTML,
            data:      typeof data === 'function' ? data() : (data ?? null),
            component,
            copiedAt:  Date.now(),
        };

        this._componentClipboard = snapshot;

        // Also write a text representation to the system clipboard (best-effort)
        const text = el.textContent?.trim() || '';
        if (text) {
            navigator.clipboard?.writeText(text).catch(() => {});
        }

        return true;
    },

    pasteComponent(options = {}) {
        const { onPaste = null } = options;
        const snapshot = this._componentClipboard;

        if (!snapshot) {
            console.warn('[oja/clipboard] pasteComponent: nothing in component clipboard');
            return false;
        }

        if (onPaste) {
            onPaste({
                html:      snapshot.html,
                data:      snapshot.data ? structuredClone(snapshot.data) : null,
                component: snapshot.component,
                copiedAt:  snapshot.copiedAt,
            });
        }

        return true;
    },

    /** Returns true if there is a component snapshot available to paste */
    hasComponent() {
        return this._componentClipboard !== null;
    },

    /** Clear the internal component clipboard */
    clearComponent() {
        this._componentClipboard = null;
    },
};