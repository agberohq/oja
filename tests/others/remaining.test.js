import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// History
// History.current returns state directly (not {state}), canUndo means index>0

import { History } from '../../src/js/ext/history.js';

describe('History — push / undo / redo', () => {
    it('starts empty', () => {
        const h = new History();
        expect(h.canUndo).toBe(false);
        expect(h.canRedo).toBe(false);
        expect(h.current).toBeNull();
    });

    it('push() adds an entry and current returns the state', () => {
        const h = new History();
        h.push({ count: 1 }, 'Init');
        expect(h.current).toEqual({ count: 1 });
    });

    it('canUndo is false with one entry (nothing to undo to)', () => {
        const h = new History();
        h.push({ a: 1 }, 'First');
        expect(h.canUndo).toBe(false);
    });

    it('push() second entry enables canUndo', () => {
        const h = new History();
        h.push({ a: 1 }, 'First');
        h.push({ a: 2 }, 'Second');
        expect(h.canUndo).toBe(true);
    });

    it('undo() reverts to previous state', () => {
        const h = new History();
        h.push({ n: 1 }, 'A');
        h.push({ n: 2 }, 'B');
        h.undo();
        expect(h.current).toEqual({ n: 1 });
    });

    it('undo() returns the entry it moved to', () => {
        const h = new History();
        h.push({ n: 1 });
        h.push({ n: 2 });
        const prev = h.undo();
        // undo returns the previous entry object (stack entry), not state directly
        expect(prev).not.toBeNull();
    });

    it('redo() re-applies undone state', () => {
        const h = new History();
        h.push({ n: 1 }, 'A');
        h.push({ n: 2 }, 'B');
        h.undo();
        expect(h.canRedo).toBe(true);
        h.redo();
        expect(h.current).toEqual({ n: 2 });
    });

    it('undo() returns null when nothing to undo', () => {
        const h = new History();
        expect(h.undo()).toBeNull();
    });

    it('redo() returns null when nothing to redo', () => {
        const h = new History();
        h.push({ n: 1 });
        expect(h.redo()).toBeNull();
    });

    it('push() after undo clears redo stack', () => {
        const h = new History();
        h.push({ n: 1 });
        h.push({ n: 2 });
        h.undo();
        h.push({ n: 3 });
        expect(h.canRedo).toBe(false);
    });

    it('skips duplicate entries by default', () => {
        const h = new History();
        h.push({ x: 1 }, 'A');
        h.push({ x: 1 }, 'B'); // duplicate
        expect(h.stack.length).toBe(1);
    });

    it('respects maxSize — oldest entries dropped', () => {
        const h = new History('test', 3);
        h.push({ n: 1 });
        h.push({ n: 2 });
        h.push({ n: 3 });
        h.push({ n: 4 }); // pushes out n:1
        expect(h.stack.length).toBe(3);
        expect(h.stack[0].state).toEqual({ n: 2 });
    });

    it('update() replaces last entry', () => {
        const h = new History();
        h.push({ v: 1 }, 'Initial');
        h.update({ v: 2 }, 'Updated');
        expect(h.current).toEqual({ v: 2 });
        expect(h.stack.length).toBe(1);
    });

    it('deep-clones state so mutations do not affect history', () => {
        const h   = new History();
        const obj = { arr: [1, 2, 3] };
        h.push(obj, 'Test');
        obj.arr.push(4); // mutate original
        expect(h.current.arr).toEqual([1, 2, 3]);
    });
});

describe('History — onChange / namespace', () => {
    it('onChange() fires on push', () => {
        const h  = new History();
        const fn = vi.fn();
        h.onChange(fn);
        h.push({ x: 1 }, 'A');
        expect(fn).toHaveBeenCalled();
    });

    it('onChange() fires on undo', () => {
        const h  = new History();
        const fn = vi.fn();
        h.push({ x: 1 });
        h.push({ x: 2 });
        h.onChange(fn);
        h.undo();
        expect(fn).toHaveBeenCalled();
    });

    // namespace() is on the history facade, not on History instances
    it('History class constructor sets namespace property', () => {
        const h = new History('docs');
        expect(h.namespace).toBe('docs');
    });
});

// lazy

import { lazy } from '../../src/js/ext/lazy.js';

describe('lazy — script()', () => {
    afterEach(() => { lazy.clearCache?.(); });

    it('returns a promise', () => {
        const p = lazy.script('https://example.com/test.js');
        expect(p && typeof p.then === 'function').toBe(true);
    });

    it('caches second call — returns same promise', () => {
        const p1 = lazy.script('https://example.com/cached.js');
        const p2 = lazy.script('https://example.com/cached.js');
        expect(p1).toBe(p2);
    });
});

describe('lazy — style()', () => {
    afterEach(() => { document.head.querySelectorAll('link[href*="example.com"]').forEach(l => l.remove()); });

    it('appends a link element to head', () => {
        lazy.style('https://example.com/test.css');
        const link = document.head.querySelector('link[href="https://example.com/test.css"]');
        expect(link).not.toBeNull();
    });

    it('second call with same url does not add duplicate', () => {
        lazy.style('https://example.com/dup.css');
        lazy.style('https://example.com/dup.css');
        const links = document.head.querySelectorAll('link[href="https://example.com/dup.css"]');
        expect(links.length).toBe(1);
    });
});

describe('lazy — supports()', () => {
    it('returns boolean', () => {
        expect(typeof lazy.supports('webgl')).toBe('boolean');
        expect(typeof lazy.supports('canvas')).toBe('boolean');
    });

    it('returns false for unsupported feature names', () => {
        expect(lazy.supports('nonexistent-feature-xyz')).toBe(false);
    });
});

describe('lazy — all()', () => {
    it('resolves when all promises resolve', async () => {
        const p1 = Promise.resolve('a');
        const p2 = Promise.resolve('b');
        const results = await lazy.all([p1, p2]);
        expect(results).toEqual(['a', 'b']);
    });
});

describe('lazy — component()', () => {
    it('returns a handle with load and mount', () => {
        const comp = lazy.component('/components/test.html');
        expect(typeof comp.load).toBe('function');
        expect(typeof comp.mount).toBe('function');
        expect(typeof comp.add).toBe('function');
    });
});

// exporter

import { exporter } from '../../src/js/ext/export.js';

describe('exporter — csv()', () => {
    let downloadSpy;
    beforeEach(() => { downloadSpy = vi.spyOn(exporter, '_download').mockImplementation(() => {}); });
    afterEach(() => { downloadSpy.mockRestore(); });

    it('generates correct CSV headers from object keys', () => {
        exporter.csv([{ name: 'Ade', role: 'Admin' }], 'test.csv');
        const [content] = downloadSpy.mock.calls[0];
        expect(content).toContain('name');
        expect(content).toContain('role');
    });

    it('generates data rows', () => {
        exporter.csv([{ name: 'Ade', role: 'Admin' }], 'test.csv');
        const [content] = downloadSpy.mock.calls[0];
        expect(content).toContain('Ade');
        expect(content).toContain('Admin');
    });

    it('respects custom columns option', () => {
        exporter.csv([{ name: 'Ade', role: 'Admin', secret: 'hidden' }], 'test.csv', { columns: ['name', 'role'] });
        const [content] = downloadSpy.mock.calls[0];
        expect(content).not.toContain('secret');
    });

    it('respects custom headers option', () => {
        exporter.csv([{ name: 'Ade', role: 'Admin' }], 'test.csv', { headers: ['Full Name', 'User Role'] });
        const [content] = downloadSpy.mock.calls[0];
        expect(content).toContain('Full Name');
    });

    it('uses semicolon delimiter when specified', () => {
        exporter.csv([{ a: 1, b: 2 }], 'test.csv', { delimiter: ';' });
        const [content] = downloadSpy.mock.calls[0];
        expect(content).toContain(';');
    });

    it('escapes values containing commas', () => {
        exporter.csv([{ name: 'Smith, John', role: 'Admin' }], 'test.csv');
        const [content] = downloadSpy.mock.calls[0];
        expect(content).toContain('"Smith, John"');
    });

    it('returns false for empty data', () => {
        const result = exporter.csv([], 'empty.csv');
        expect(result).toBe(false);
    });
});

describe('exporter — json()', () => {
    let downloadSpy;
    beforeEach(() => { downloadSpy = vi.spyOn(exporter, '_download').mockImplementation(() => {}); });
    afterEach(() => { downloadSpy.mockRestore(); });

    it('serialises data as JSON', () => {
        exporter.json([{ id: 1, name: 'test' }], 'export.json');
        const [content] = downloadSpy.mock.calls[0];
        expect(JSON.parse(content)).toEqual([{ id: 1, name: 'test' }]);
    });

    it('uses indentation', () => {
        exporter.json({ x: 1 }, 'x.json');
        const [content] = downloadSpy.mock.calls[0];
        expect(content).toContain('\n');
    });
});

describe('exporter — fromTable()', () => {
    let downloadSpy;
    beforeEach(() => { downloadSpy = vi.spyOn(exporter, '_download').mockImplementation(() => {}); });
    afterEach(() => { downloadSpy.mockRestore(); document.body.innerHTML = ''; });

    it('returns false for missing table', () => {
        expect(exporter.fromTable('#nonexistent', 'out.csv')).toBe(false);
    });

    it('extracts table data as CSV', () => {
        document.body.innerHTML = `
            <table id="t">
                <thead><tr><th>Name</th><th>Role</th></tr></thead>
                <tbody><tr><td>Ade</td><td>Admin</td></tr></tbody>
            </table>`;
        exporter.fromTable('#t', 'table.csv');
        const [content] = downloadSpy.mock.calls[0];
        expect(content).toContain('Name');
        expect(content).toContain('Ade');
    });
});

// pullToRefresh

import { pullToRefresh } from '../../src/js/ext/pulltorefresh.js';

describe('pullToRefresh — init()', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    it('returns a handle with disable/enable/refresh/destroy', () => {
        document.body.innerHTML = '<div id="ptr"></div>';
        const handle = pullToRefresh.init('#ptr', { onRefresh: vi.fn() });
        expect(typeof handle.disable).toBe('function');
        expect(typeof handle.enable).toBe('function');
        expect(typeof handle.refresh).toBe('function');
        expect(typeof handle.destroy).toBe('function');
    });

    it('warns for missing target', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        pullToRefresh.init('#nonexistent', { onRefresh: vi.fn() });
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('destroy() cleans up without error', () => {
        document.body.innerHTML = '<div id="ptr2"></div>';
        const handle = pullToRefresh.init('#ptr2', { onRefresh: vi.fn() });
        expect(() => handle.destroy()).not.toThrow();
    });

    it('disable() and enable() do not throw', () => {
        document.body.innerHTML = '<div id="ptr3"></div>';
        const handle = pullToRefresh.init('#ptr3', { onRefresh: vi.fn() });
        expect(() => { handle.disable(); handle.enable(); }).not.toThrow();
    });
});

// infiniteScroll

import { infiniteScroll } from '../../src/js/ext/infinitescroll.js';

// IntersectionObserver must be a constructor (class), not a plain object
const _mockObserver = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
class MockIntersectionObserver {
    constructor(cb, opts) { Object.assign(this, _mockObserver); }
    observe(el)    { _mockObserver.observe(el); }
    unobserve(el)  { _mockObserver.unobserve(el); }
    disconnect()   { _mockObserver.disconnect(); }
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

describe('infiniteScroll — init()', () => {
    beforeEach(() => { vi.clearAllMocks(); });
    afterEach(() => { document.body.innerHTML = ''; });

    it('returns handle with loadMore/disable/enable/destroy', () => {
        document.body.innerHTML = '<div id="feed"></div>';
        const h = infiniteScroll.init('#feed', { onLoadMore: vi.fn() });
        expect(typeof h.loadMore).toBe('function');
        expect(typeof h.disable).toBe('function');
        expect(typeof h.enable).toBe('function');
        expect(typeof h.destroy).toBe('function');
    });

    it('warns for missing target', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        infiniteScroll.init('#nonexistent', { onLoadMore: vi.fn() });
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('appends sentinel element', () => {
        document.body.innerHTML = '<div id="list"></div>';
        infiniteScroll.init('#list', { onLoadMore: vi.fn() });
        expect(document.querySelector('.oja-infinite-sentinel')).not.toBeNull();
    });

    it('destroy() disconnects observer without error', () => {
        document.body.innerHTML = '<div id="list2"></div>';
        const h = infiniteScroll.init('#list2', { onLoadMore: vi.fn() });
        expect(() => h.destroy()).not.toThrow();
        expect(_mockObserver.disconnect).toHaveBeenCalled();
    });
});

// Socket

import { Socket, SSE } from '../../src/js/ext/socket.js';

// Socket.send() is async and buffers when not open — we need WS in OPEN state
class MockWS {
    constructor(url) {
        this.url        = url;
        this.readyState = 0; // CONNECTING
        this._sent      = [];
        MockWS._last    = this;
        // WebSocket constants
        this.CONNECTING = 0; this.OPEN = 1; this.CLOSING = 2; this.CLOSED = 3;
    }
    send(data)  { this._sent.push(data); }
    close()     { this.readyState = 3; if (this.onclose) this.onclose({ code: 1000 }); }
    _open()     { this.readyState = 1; if (this.onopen) this.onopen(); }
    _message(d) { if (this.onmessage) this.onmessage({ data: typeof d === 'string' ? d : JSON.stringify(d) }); }
}
MockWS._last = null;
MockWS.OPEN = 1; MockWS.CLOSED = 3;
vi.stubGlobal('WebSocket', MockWS);

class MockES {
    constructor(url) {
        this.url         = url;
        this.readyState  = 0;
        this._listeners  = new Map();
        MockES._last     = this;
    }
    addEventListener(ev, fn) {
        if (!this._listeners.has(ev)) this._listeners.set(ev, []);
        this._listeners.get(ev).push(fn);
    }
    removeEventListener(ev, fn) {
        const arr = this._listeners.get(ev) || [];
        this._listeners.set(ev, arr.filter(f => f !== fn));
    }
    close()  { this.readyState = 2; }
    _open()  { this.readyState = 1; if (this.onopen) this.onopen(); }
    _event(type, data) {
        const fns = this._listeners.get(type) || [];
        fns.forEach(fn => fn({ data: JSON.stringify(data) }));
    }
}
MockES._last = null;
vi.stubGlobal('EventSource', MockES);

describe('Socket — WebSocket', () => {
    beforeEach(() => { vi.useFakeTimers(); MockWS._last = null; });
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

    it('connects to WebSocket on construction', () => {
        const s = new Socket('wss://test.example.com/ws');
        expect(MockWS._last).not.toBeNull();
        s.close();
    });

    it('fires "connect" handler on open', () => {
        const onConnect = vi.fn();
        const s = new Socket('wss://test.example.com/ws');
        s.on('connect', onConnect);
        MockWS._last._open();
        expect(onConnect).toHaveBeenCalled();
        s.close();
    });

    it('fires "message" handler on incoming message', async () => {
        const onMsg = vi.fn();
        const s = new Socket('wss://test.example.com/ws');
        s.on('message', onMsg);
        MockWS._last._open();
        // Socket.onmessage is async (awaits codec.decode) — flush microtasks
        MockWS._last._message(JSON.stringify({ type: 'ping' }));
        await Promise.resolve();
        await Promise.resolve();
        expect(onMsg).toHaveBeenCalled();
        s.close();
    });

    it('send() queues message when not connected (no error)', async () => {
        const s = new Socket('wss://test.example.com/ws');
        // Not open yet — should queue without throwing
        await expect(s.send({ type: 'subscribe' })).resolves.not.toThrow();
        s.close();
    });

    it('send() delivers message when socket is open', async () => {
        const s = new Socket('wss://test.example.com/ws');
        MockWS._last._open();
        await s.send({ type: 'subscribe' });
        expect(MockWS._last._sent.length).toBeGreaterThan(0);
        s.close();
    });

    it('fires "disconnect" handler on close', () => {
        const onDisconnect = vi.fn();
        const s = new Socket('wss://test.example.com/ws');
        s.on('disconnect', onDisconnect);
        MockWS._last._open();
        MockWS._last.close();
        expect(onDisconnect).toHaveBeenCalled();
        s.close();
    });

    it('close() terminates the connection', () => {
        const s = new Socket('wss://test.example.com/ws');
        MockWS._last._open();
        s.close();
        expect(MockWS._last.readyState).toBe(3);
    });

    it('on() returns unsubscribe function', () => {
        const handler = vi.fn();
        const s = new Socket('wss://test.example.com/ws');
        const off = s.on('message', handler);
        off();
        MockWS._last._open();
        MockWS._last._message(JSON.stringify({ x: 1 }));
        expect(handler).not.toHaveBeenCalled();
        s.close();
    });
});

describe('SSE — Server-Sent Events', () => {
    beforeEach(() => { vi.useFakeTimers(); MockES._last = null; });
    afterEach(() => { vi.useRealTimers(); });

    it('creates EventSource on construction', () => {
        const sse = new SSE('https://test.example.com/events');
        expect(MockES._last).not.toBeNull();
        sse.close();
    });

    it('on() subscribes to named events and returns unsubscribe', () => {
        const sse = new SSE('https://test.example.com/events');
        const off = sse.on('metrics', vi.fn());
        expect(typeof off).toBe('function');
        sse.close();
    });

    it('close() closes the EventSource', () => {
        const sse = new SSE('https://test.example.com/events');
        sse.close();
        expect(MockES._last.readyState).toBe(2);
    });

    it('onConnect() registers without error', () => {
        const sse = new SSE('https://test.example.com/events');
        expect(() => sse.onConnect(vi.fn())).not.toThrow();
        sse.close();
    });
});

// canvas

import * as canvas from '../../src/js/ui/canvas.js';

function makeCanvas(id = 'c') {
    document.body.innerHTML = `<canvas id="${id}" width="800" height="600"></canvas>`;
    const el  = document.getElementById(id);
    const ctx = {
        scale: vi.fn(), save: vi.fn(), restore: vi.fn(),
        clearRect: vi.fn(), fillRect: vi.fn(), setTransform: vi.fn(),
        beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
        arc: vi.fn(), fill: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
        fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
        fillText: vi.fn(), measureText: vi.fn(() => ({ width: 50 })),
        drawImage: vi.fn(),
        getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
        canvas: el,
    };
    vi.spyOn(el, 'getContext').mockReturnValue(ctx);
    Object.defineProperty(el, 'clientWidth',  { value: 800, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true });
    return { el, ctx };
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('canvas — get()', () => {
    it('returns a 2D context', () => {
        const { ctx } = makeCanvas();
        const result = canvas.get('#c');
        expect(result).toBe(ctx);
    });

    it('returns null for missing target', () => {
        expect(canvas.get('#nonexistent')).toBeNull();
    });

    it('sets width and height styles when provided', () => {
        const { el } = makeCanvas();
        canvas.get('#c', { width: 400, height: 300 });
        expect(el.style.width).toBe('400px');
        expect(el.style.height).toBe('300px');
    });
});

describe('canvas — clear()', () => {
    it('calls clearRect on the context', () => {
        const { ctx } = makeCanvas();
        canvas.clear('#c');
        expect(ctx.clearRect).toHaveBeenCalled();
    });
});

describe('canvas — resize()', () => {
    it('sets canvas width/height and styles', () => {
        const { el } = makeCanvas();
        canvas.resize('#c', 1024, 768);
        expect(el.style.width).toBe('1024px');
        expect(el.style.height).toBe('768px');
    });
});

describe('canvas — getSize()', () => {
    it('returns size object', () => {
        makeCanvas();
        const size = canvas.getSize('#c');
        expect(size).toHaveProperty('width');
        expect(size).toHaveProperty('height');
    });

    it('returns null for missing target', () => {
        expect(canvas.getSize('#none')).toBeNull();
    });
});

describe('canvas — draw()', () => {
    it('calls save/restore around drawFn', () => {
        const { ctx } = makeCanvas();
        const drawFn = vi.fn();
        canvas.draw('#c', drawFn);
        expect(ctx.save).toHaveBeenCalled();
        expect(drawFn).toHaveBeenCalledWith(ctx, expect.any(Object));
        expect(ctx.restore).toHaveBeenCalled();
    });
});

describe('canvas — drawGrid()', () => {
    it('calls context drawing methods', () => {
        const { ctx } = makeCanvas();
        canvas.drawGrid(ctx, 800, 600, { step: 50 });
        expect(ctx.beginPath).toHaveBeenCalled();
    });
});

describe('canvas — barChart()', () => {
    it('renders without throwing', () => {
        makeCanvas();
        expect(() => canvas.barChart('#c', [10, 20, 30], { labels: ['A', 'B', 'C'] })).not.toThrow();
    });
});

describe('canvas — toDataURL()', () => {
    it('calls toDataURL on canvas element', () => {
        const { el } = makeCanvas();
        vi.spyOn(el, 'toDataURL').mockReturnValue('data:image/png;base64,abc');
        const url = canvas.toDataURL('#c');
        expect(url).toBe('data:image/png;base64,abc');
    });
});
