import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// template

import { render, renderRaw, fill, each, template } from '../../src/js/core/template.js';

describe('template — render()', () => {
    it('interpolates {{variable}} tokens', () => {
        expect(render('Hello {{name}}!', { name: 'Ade' })).toBe('Hello Ade!');
    });

    it('escapes HTML in values', () => {
        const out = render('<p>{{val}}</p>', { val: '<script>xss</script>' });
        expect(out).not.toContain('<script>');
        expect(out).toContain('&lt;script&gt;');
    });

    it('replaces undefined tokens with empty string', () => {
        expect(render('{{a}} {{b}}', { a: 'hi' })).toBe('hi ');
    });

    it('handles nested dot-access', () => {
        const out = render('{{user.name}}', { user: { name: 'Temi' } });
        expect(out).toBe('Temi');
    });
});

describe('template — renderRaw()', () => {
    it('does NOT escape HTML values', () => {
        const out = renderRaw('<p>{{html}}</p>', { html: '<b>bold</b>' });
        expect(out).toContain('<b>bold</b>');
    });

    it('still interpolates tokens', () => {
        expect(renderRaw('{{x}}', { x: 'ok' })).toBe('ok');
    });
});

describe('template — fill()', () => {
    // fill() uses data-bind="attr:key" syntax (not just data-bind="key")
    // Text interpolation uses {{var}} tokens in text nodes
    it('interpolates {{var}} in text nodes', () => {
        document.body.innerHTML = '<div id="t">Hello {{name}}!</div>';
        fill(document.getElementById('t'), { name: 'Ola' });
        expect(document.getElementById('t').textContent).toBe('Hello Ola!');
    });

    it('sets href via data-bind="href:key"', () => {
        document.body.innerHTML = '<div><a data-bind="href:url">link</a></div>';
        fill(document.body, { url: 'https://oja.dev' });
        expect(document.querySelector('a').getAttribute('href')).toBe('https://oja.dev');
    });

    it('does nothing for null container', () => {
        expect(() => fill(null, { x: 1 })).not.toThrow();
    });

    afterEach(() => { document.body.innerHTML = ''; });
});

describe('template — each()', () => {
    function mkTpl(name = 'items', as = 'item') {
        document.body.innerHTML = `
            <div id="wrap">
                <template data-each="${name}" data-as="${as}">
                    <div data-each-item="${name}" class="row">{{${as}.name}}</div>
                </template>
                <div data-empty="${name}" style="display:none">No items</div>
            </div>`;
        return document.getElementById('wrap');
    }

    afterEach(() => { document.body.innerHTML = ''; });

    it('renders each item', () => {
        const wrap = mkTpl();
        each(wrap, 'items', [{ name: 'Alpha' }, { name: 'Beta' }]);
        const rows = wrap.querySelectorAll('.row');
        expect(rows.length).toBe(2);
        expect(rows[0].textContent.trim()).toContain('Alpha');
    });

    it('shows empty element when list is empty', () => {
        const wrap = mkTpl();
        each(wrap, 'items', []);
        const empty = wrap.querySelector('[data-empty="items"]');
        expect(empty.style.display).not.toBe('none');
    });

    it('warns when template is missing', () => {
        document.body.innerHTML = '<div id="w2"></div>';
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        each(document.getElementById('w2'), 'ghost', [{ x: 1 }]);
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('not found'));
        spy.mockRestore();
    });

    it('applies filter option', () => {
        const wrap = mkTpl();
        each(wrap, 'items',
            [{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Gamma' }],
            { filter: i => i.name !== 'Beta' }
        );
        const rows = wrap.querySelectorAll('.row');
        expect(rows.length).toBe(2);
        expect([...rows].some(r => r.textContent.includes('Beta'))).toBe(false);
    });

    it('removes previous items before re-render', () => {
        const wrap = mkTpl();
        each(wrap, 'items', [{ name: 'A' }]);
        each(wrap, 'items', [{ name: 'B' }, { name: 'C' }]);
        expect(wrap.querySelectorAll('.row').length).toBe(2);
    });
});

describe('template — filter registration', () => {
    it('filter() registers a custom filter function', () => {
        template.filter('upper', v => String(v).toUpperCase());
        const out = render('{{name|upper}}', { name: 'ade' });
        expect(out).toBe('ADE');
    });
});

// diff

import {
    diff, diffLines, diffWords, diffSequence, diffJson, renderDiff, unifiedDiff
} from '../../src/js/utils/diff.js';

// diff() returns 'keep' not 'equal' for unchanged chars
describe('diff() — character diff', () => {
    it('identical strings produce only keep hunks', () => {
        const result = diff('abc', 'abc');
        expect(result.every(h => h.type === 'keep')).toBe(true);
    });

    it('detects added characters', () => {
        const result = diff('ab', 'abc');
        expect(result.some(h => h.type === 'add' && h.value.includes('c'))).toBe(true);
    });

    it('detects removed characters', () => {
        const result = diff('abc', 'ab');
        expect(result.some(h => h.type === 'remove' && h.value.includes('c'))).toBe(true);
    });
});

describe('diffLines()', () => {
    it('identical lines produce only keep hunks', () => {
        const a = 'line1\nline2';
        const b = 'line1\nline2';
        const result = diffLines(a, b);
        expect(result.every(h => h.type === 'keep')).toBe(true);
    });

    it('detects added line', () => {
        const result = diffLines('line1', 'line1\nline2');
        expect(result.some(h => h.type === 'add')).toBe(true);
    });

    it('detects removed line', () => {
        const result = diffLines('line1\nline2', 'line1');
        expect(result.some(h => h.type === 'remove')).toBe(true);
    });
});

describe('diffWords()', () => {
    it('detects word substitution', () => {
        const result = diffWords('hello world', 'hello earth');
        expect(result.some(h => h.type === 'add'    && h.value.includes('earth'))).toBe(true);
        expect(result.some(h => h.type === 'remove' && h.value.includes('world'))).toBe(true);
    });

    it('equal strings produce only keep hunks', () => {
        const result = diffWords('same text', 'same text');
        expect(result.every(h => h.type === 'keep')).toBe(true);
    });
});

describe('diffSequence()', () => {
    it('compares arrays element-by-element', () => {
        const result = diffSequence([1, 2, 3], [1, 2, 4]);
        expect(result.some(e => e.type === 'remove' && e.value === 3)).toBe(true);
        expect(result.some(e => e.type === 'add'    && e.value === 4)).toBe(true);
    });

    it('empty arrays produce no changes', () => {
        expect(diffSequence([], [])).toEqual([]);
    });

    it('adding to empty returns all adds', () => {
        const result = diffSequence([], [1, 2]);
        expect(result.every(e => e.type === 'add')).toBe(true);
    });
});

// diffJson returns an array of change objects, not a string
describe('diffJson()', () => {
    it('returns empty array for identical objects', () => {
        expect(diffJson({ a: 1 }, { a: 1 })).toEqual([]);
    });

    it('reports added keys', () => {
        const result = diffJson({ a: 1 }, { a: 1, b: 2 });
        expect(result.some(c => c.path === 'b' && c.type === 'add')).toBe(true);
    });

    it('reports changed values', () => {
        const result = diffJson({ a: 1 }, { a: 2 });
        expect(result.some(c => c.path === 'a' && c.type === 'change')).toBe(true);
    });

    it('reports removed keys', () => {
        const result = diffJson({ a: 1, b: 2 }, { a: 1 });
        expect(result.some(c => c.path === 'b' && c.type === 'remove')).toBe(true);
    });
});

describe('renderDiff()', () => {
    it('renders HTML string for a diff result', () => {
        const hunks = diffLines('old line', 'new line');
        const html  = renderDiff(hunks);
        expect(typeof html).toBe('string');
        expect(html.length).toBeGreaterThan(0);
    });
});

describe('unifiedDiff()', () => {
    it('returns a string with context', () => {
        const result = unifiedDiff('line1\nline2', 'line1\nline3');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('returns empty string for identical content', () => {
        const result = unifiedDiff('same\ncontent', 'same\ncontent');
        expect(result.trim()).toBe('');
    });
});

// webrtc

import { webrtc } from '../../src/js/ext/webrtc.js';

describe('webrtc — supported', () => {
    it('returns a boolean', () => {
        expect(typeof webrtc.supported).toBe('boolean');
    });
});

describe('webrtc — getUserMedia()', () => {
    beforeEach(() => {
        // jsdom does not provide mediaDevices — stub it
        if (!navigator.mediaDevices) {
            Object.defineProperty(navigator, 'mediaDevices', {
                value: { getUserMedia: vi.fn(), getDisplayMedia: vi.fn() },
                writable: true, configurable: true,
            });
        }
    });

    afterEach(() => { vi.restoreAllMocks(); });

    it('resolves with stream when supported', async () => {
        const fakeStream = { id: 'stream-1', getTracks: () => [] };
        navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue(fakeStream);
        const stream = await webrtc.getUserMedia({ video: true, audio: false });
        expect(stream).toBe(fakeStream);
    });

    it('throws when getUserMedia fails', async () => {
        navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(new Error('Denied'));
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(webrtc.getUserMedia()).rejects.toThrow('Denied');
        spy.mockRestore();
    });
});

describe('webrtc — closePeer()', () => {
    it('does not throw for unknown peer id', () => {
        // RTCPeerConnection not available in jsdom — skip if so
        expect(() => webrtc.closePeer('nonexistent')).not.toThrow();
    });
});

// Wasm

import { Wasm } from '../../src/js/ext/wasm.js';

describe('Wasm — construction', () => {
    it('stores url and options', () => {
        const w = new Wasm('/module.wasm', { name: 'test' });
        expect(w._url).toBe('/module.wasm');
        expect(w._name).toBe('test');
    });

    it('derives name from URL when not provided', () => {
        const w = new Wasm('/path/to/parser.wasm');
        expect(w._name).toBe('parser.wasm');
    });

    it('is not ready before load', () => {
        const w = new Wasm('/module.wasm');
        expect(w._ready).toBe(false);
        expect(w._instance).toBeNull();
    });
});

describe('Wasm — ready()', () => {
    afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

    it('returns the same promise on multiple calls', () => {
        vi.stubGlobal('WebAssembly', {
            instantiateStreaming: vi.fn().mockResolvedValue({
                instance: { exports: { memory: null } }
            }),
            instantiate: vi.fn(),
        });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
        const w  = new Wasm('/module.wasm');
        const p1 = w.ready();
        const p2 = w.ready();
        expect(p1).toBe(p2);
    });

    it('resolves and marks ready', async () => {
        vi.stubGlobal('WebAssembly', {
            instantiateStreaming: vi.fn().mockResolvedValue({
                instance: { exports: { memory: null } }
            }),
            instantiate: vi.fn(),
        });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
        const w = new Wasm('/module.wasm');
        await w.ready();
        expect(w._ready).toBe(true);
    });
});

describe('Wasm — call()', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('throws if not ready', async () => {
        const w = new Wasm('/module.wasm');
        // call() signature is call(fn, ...args) - spreads args
        await expect(w.call('myFunc')).rejects.toThrow();
    });

    it('calls exported function when ready', async () => {
        vi.stubGlobal('WebAssembly', {
            instantiateStreaming: vi.fn().mockResolvedValue({
                instance: { exports: { add: (a, b) => a + b, memory: null } }
            }),
            instantiate: vi.fn(),
        });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
        const w = new Wasm('/module.wasm');
        await w.ready();
        // call(fn, ...args) - pass args as spread, not array
        const result = await w.call('add', 3, 4);
        expect(result).toBe(7);
    });

    it('throws for unknown export', async () => {
        vi.stubGlobal('WebAssembly', {
            instantiateStreaming: vi.fn().mockResolvedValue({
                instance: { exports: { memory: null } }
            }),
            instantiate: vi.fn(),
        });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
        const w = new Wasm('/module.wasm');
        await w.ready();
        await expect(w.call('nonexistent')).rejects.toThrow();
    });
});
