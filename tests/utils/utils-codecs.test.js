import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// adapter

import { adapter } from '../../src/js/utils/adapter.js';

describe('adapter', () => {
    beforeEach(() => {
        adapter.list().forEach(({ name }) => adapter.unregister(name));
    });

    it('register() + use() returns the library instance', () => {
        const d3 = { version: '7.8.5', select: vi.fn() };
        adapter.register('d3', d3);
        expect(adapter.use('d3')).toBe(d3);
    });

    it('use() throws if library not registered', () => {
        expect(() => adapter.use('nonexistent')).toThrow('[oja/adapter] "nonexistent" is not registered');
    });

    it('use() throws if library is lazy (not yet loaded)', () => {
        adapter.lazy('chart', () => Promise.resolve({}));
        expect(() => adapter.use('chart')).toThrow('"chart" is a lazy adapter');
    });

    it('has() returns true for registered library', () => {
        adapter.register('mylib', {});
        expect(adapter.has('mylib')).toBe(true);
    });

    it('has() returns false for unregistered library', () => {
        expect(adapter.has('ghost')).toBe(false);
    });

    it('version() returns version string', () => {
        adapter.register('mylib', { version: '1.2.3' });
        expect(adapter.version('mylib')).toBe('1.2.3');
    });

    it('version() detects VERSION property', () => {
        adapter.register('mylib', { VERSION: '2.0.0' });
        expect(adapter.version('mylib')).toBe('2.0.0');
    });

    it('unregister() removes library', () => {
        adapter.register('tmp', {});
        adapter.unregister('tmp');
        expect(adapter.has('tmp')).toBe(false);
    });

    it('list() returns all registered adapters', () => {
        adapter.register('libA', {});
        adapter.register('libB', {});
        const names = adapter.list().map(e => e.name);
        expect(names).toContain('libA');
        expect(names).toContain('libB');
    });

    it('list() shows lazy=true for lazy adapters', () => {
        adapter.lazy('lazyLib', () => Promise.resolve({}));
        const entry = adapter.list().find(e => e.name === 'lazyLib');
        expect(entry.lazy).toBe(true);
        expect(entry.loaded).toBe(false);
    });

    it('useAsync() resolves lazy factory', async () => {
        const lib = { render: vi.fn() };
        adapter.lazy('asyncLib', async () => lib);
        const result = await adapter.useAsync('asyncLib');
        expect(result).toBe(lib);
    });

    it('useAsync() handles module with default export', async () => {
        const lib = { draw: vi.fn() };
        adapter.lazy('esLib', async () => ({ default: lib }));
        const result = await adapter.useAsync('esLib');
        expect(result).toBe(lib);
    });

    it('useAsync() caches after first load', async () => {
        const factory = vi.fn(async () => ({ fn: vi.fn() }));
        adapter.lazy('cachedLib', factory);
        await adapter.useAsync('cachedLib');
        await adapter.useAsync('cachedLib');
        expect(factory).toHaveBeenCalledTimes(1);
    });

    it('useAsync() throws if not registered', async () => {
        await expect(adapter.useAsync('nothing')).rejects.toThrow('"nothing" is not registered');
    });
});

// debug

import { debug } from '../../src/js/utils/debug.js';

describe('debug', () => {
    beforeEach(() => { debug.disable(); debug.clear(); });
    afterEach(() => { debug.disable(); debug.clear(); });

    it('is a no-op when disabled', () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        debug.log('router', 'navigate', { path: '/' });
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('enable("*") activates all namespaces and logs via console.debug', () => {
        debug.enable('*');
        // debug._record uses console.debug with %c styling
        const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        debug.log('router', 'navigate', { path: '/' });
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('enable("router") only logs router namespace', () => {
        debug.enable('router');
        const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        debug.log('router', 'navigate', {});
        debug.log('api',    'GET',      {});
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });

    it('warn() logs a warning via console.debug', () => {
        debug.enable('*');
        const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        debug.warn('component', 'slow render', { ms: 500 });
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('export() returns object with entries array', () => {
        debug.enable('*');
        debug.log('router', 'navigate', { path: '/admin' });
        const exported = debug.export();
        // debug.export() returns { exported, entries, userAgent, url }
        expect(Array.isArray(exported.entries)).toBe(true);
        expect(exported.entries.length).toBeGreaterThan(0);
        expect(exported.entries[0]).toMatchObject({ ns: 'router', action: 'navigate' });
    });

    it('disable() turns off logging', () => {
        debug.enable('*');
        debug.disable();
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        debug.log('router', 'navigate', {});
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('clear() empties the timeline', () => {
        debug.enable('*');
        debug.log('router', 'navigate', {});
        debug.clear();
        const exported = debug.export();
        expect(exported.entries.length).toBe(0);
    });
});

// logger

import { logger } from '../../src/js/utils/logger.js';

describe('logger', () => {
    afterEach(() => { logger.setLevel('INFO'); });

    it('info() logs via console.info at INFO level', () => {
        // logger uses console.info for INFO level
        const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
        logger.setLevel('INFO');
        logger.info('auth', 'User login', { userId: 1 });
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('debug() suppressed at INFO level', () => {
        const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
        logger.setLevel('INFO');
        logger.debug('router', 'navigate', {});
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('warn() logs via console.warn', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        logger.warn('api', 'Slow response', { ms: 1200 });
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('error() logs via console.error', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        logger.error('component', 'Load failed', { url: 'hosts.html' });
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('setLevel("NONE") silences all logs', () => {
        logger.setLevel('NONE');
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        logger.error('test', 'ignored');
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it('setLevel("ERROR") logs errors only', () => {
        logger.setLevel('ERROR');
        const infoSpy  = vi.spyOn(console, 'info').mockImplementation(() => {});
        const warnSpy  = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const errSpy   = vi.spyOn(console, 'error').mockImplementation(() => {});
        logger.info('x', 'info');
        logger.warn('x', 'warn');
        logger.error('x', 'error');
        expect(infoSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
        expect(errSpy).toHaveBeenCalled();
        infoSpy.mockRestore(); warnSpy.mockRestore(); errSpy.mockRestore();
    });

    it('onLog() handler receives structured entry', () => {
        const handler = vi.fn();
        logger.setLevel('DEBUG');
        const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
        const off = logger.onLog(handler);
        logger.info('auth', 'Signed in', { userId: 42 });
        expect(handler).toHaveBeenCalledWith(expect.objectContaining({
            level: 'INFO', component: 'auth', message: 'Signed in',
        }));
        off?.();
        spy.mockRestore();
    });

    it('history() returns recent entries', () => {
        logger.setLevel('DEBUG');
        const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
        logger.info('test', 'msg1');
        const hist = logger.history();
        expect(Array.isArray(hist)).toBe(true);
        expect(hist.length).toBeGreaterThan(0);
        spy.mockRestore();
    });
});

// MsgPackCodec

import { MsgPackCodec } from '../../src/js/core/codecs/msgpack.js';

describe('MsgPackCodec', () => {
    it('has correct contentType and name', () => {
        const c = new MsgPackCodec();
        expect(c.contentType).toBe('application/msgpack');
        expect(c.name).toBe('msgpack');
        expect(c.binaryType).toBe('binary');
    });

    it('encode() and decode() round-trip using injected msgpack lib', async () => {
        const fakeLib = {
            encode: (data) => new Uint8Array([...JSON.stringify(data)].map(c => c.charCodeAt(0))),
            decode: (buf)  => JSON.parse(String.fromCharCode(...new Uint8Array(buf))),
        };
        const c = new MsgPackCodec({ msgpack: fakeLib });
        const payload = { id: 1, name: 'Ade', active: true };
        const encoded = await c.encode(payload);
        expect(encoded instanceof Uint8Array).toBe(true);
        const decoded = await c.decode(encoded);
        expect(decoded).toEqual(payload);
    });

    it('encode() returns Uint8Array', async () => {
        const fakeLib = {
            encode: () => new Uint8Array([1, 2, 3]),
            decode: ()  => ({}),
        };
        const c = new MsgPackCodec({ msgpack: fakeLib });
        const result = await c.encode({ x: 1 });
        expect(result instanceof Uint8Array).toBe(true);
    });
});

// cssVars

import { cssVars } from '../../src/js/ext/cssvars.js';

describe('cssVars', () => {
    afterEach(() => {
        document.documentElement.style.removeProperty('--test-color');
        document.documentElement.style.removeProperty('--test-size');
        document.documentElement.style.removeProperty('--bg');
    });

    it('set() and get() round-trip a single variable', () => {
        cssVars.set('--test-color', '#ff0000');
        expect(cssVars.get('--test-color').trim()).toBe('#ff0000');
    });

    it('set() accepts an object of multiple variables', () => {
        cssVars.set({ '--test-color': '#abc', '--test-size': '16px' });
        expect(cssVars.get('--test-color').trim()).toBe('#abc');
        expect(cssVars.get('--test-size').trim()).toBe('16px');
    });

    it('get() returns a string (empty or fallback) for unset variable', () => {
        const val = cssVars.get('--nonexistent-var-xyz', '#fallback');
        expect(typeof val).toBe('string');
    });

    it('set() on a specific element scopes the variable', () => {
        document.body.innerHTML = '<div id="scoped"></div>';
        const el = document.getElementById('scoped');
        cssVars.set('--bg', 'blue', '#scoped');
        expect(el.style.getPropertyValue('--bg').trim()).toBe('blue');
        expect(document.documentElement.style.getPropertyValue('--bg').trim()).toBe('');
        document.body.innerHTML = '';
    });

    it('applyTheme() sets multiple variables', () => {
        const theme = { '--test-color': 'red', '--test-size': '14px' };
        cssVars.applyTheme(theme);
        expect(cssVars.get('--test-color').trim()).toBe('red');
        expect(cssVars.get('--test-size').trim()).toBe('14px');
    });
});
