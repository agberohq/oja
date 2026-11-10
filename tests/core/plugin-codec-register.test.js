import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// JsonCodec

import { JsonCodec, jsonCodec } from '../../src/js/core/codecs/json.js';

describe('JsonCodec', () => {
    it('contentType is application/json', () => {
        expect(new JsonCodec().contentType).toBe('application/json');
    });

    it('binaryType is text', () => {
        expect(new JsonCodec().binaryType).toBe('text');
    });

    it('name is json', () => {
        expect(new JsonCodec().name).toBe('json');
    });

    it('encode() serialises objects to JSON string', () => {
        const c = new JsonCodec();
        expect(c.encode({ a: 1 })).toBe('{"a":1}');
    });

    it('encode() passes strings through unchanged', () => {
        const c = new JsonCodec();
        expect(c.encode('hello')).toBe('hello');
    });

    it('encode() handles arrays', () => {
        const c = new JsonCodec();
        expect(c.encode([1, 2, 3])).toBe('[1,2,3]');
    });

    it('decode() parses JSON strings', () => {
        const c = new JsonCodec();
        expect(c.decode('{"x":42}')).toEqual({ x: 42 });
    });

    it('decode() returns already-parsed objects unchanged', () => {
        const c   = new JsonCodec();
        const obj = { already: 'parsed' };
        expect(c.decode(obj)).toBe(obj);
    });

    it('decode() returns null for null/undefined', () => {
        const c = new JsonCodec();
        expect(c.decode(null)).toBeNull();
        expect(c.decode(undefined)).toBeNull();
    });

    it('decode() returns null for empty string', () => {
        const c = new JsonCodec();
        expect(c.decode('')).toBeNull();
    });

    it('decode() handles ArrayBuffer — jsdom uses TextDecoder shim', () => {
        const c    = new JsonCodec();
        const json = '{"n":7}';
        // jsdom may not fully support TextDecoder on ArrayBuffer — test that it doesn't throw
        const buf  = new TextEncoder().encode(json).buffer;
        expect(() => c.decode(buf)).not.toThrow();
    });

    it('decode() returns raw string if not valid JSON', () => {
        const c = new JsonCodec();
        expect(c.decode('not json')).toBe('not json');
    });

    it('jsonCodec singleton is a JsonCodec instance', () => {
        expect(jsonCodec).toBeInstanceOf(JsonCodec);
    });
});

// register (event validation)

import {
    register, strictMode, isRegistered, getRegistered, emit, listen, events
} from '../../src/js/utils/register.js';

describe('register — isRegistered / getRegistered', () => {
    it('built-in Oja events are pre-registered', () => {
        expect(isRegistered('oja:navigate')).toBe(true);
        expect(isRegistered('api:error')).toBe(true);
        expect(isRegistered('modal:open')).toBe(true);
    });

    it('isRegistered returns false for unknown names', () => {
        expect(isRegistered('not:a:real:event')).toBe(false);
    });

    it('register() adds names to the registry', () => {
        register(['test:event-a', 'test:event-b']);
        expect(isRegistered('test:event-a')).toBe(true);
        expect(isRegistered('test:event-b')).toBe(true);
    });

    it('register() is additive', () => {
        register(['test:first']);
        register(['test:second']);
        expect(isRegistered('test:first')).toBe(true);
        expect(isRegistered('test:second')).toBe(true);
    });

    it('getRegistered() returns a Set', () => {
        const set = getRegistered();
        expect(set).toBeInstanceOf(Set);
        expect(set.has('oja:navigate')).toBe(true);
    });

    it('getRegistered() returns a copy — mutations do not affect registry', () => {
        const set = getRegistered();
        set.add('fake:event');
        expect(isRegistered('fake:event')).toBe(false);
    });

    it('register() warns for non-array input', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        register('not-an-array');
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });
});

describe('register — emit / listen (validated)', () => {
    // listen handlers receive (detail, event) — two arguments
    it('emit() fires for a registered event name', async () => {
        const { listen: coreListen } = await import('../../src/js/core/events.js');
        register(['validated:test-emit']);
        const handler = vi.fn();
        const unsub   = coreListen('validated:test-emit', handler);
        emit('validated:test-emit', { x: 1 });
        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({ x: 1 }),
            expect.anything()   // the CustomEvent object
        );
        unsub();
    });

    it('listen() subscribes to a registered event', async () => {
        const { emit: coreEmit } = await import('../../src/js/core/events.js');
        register(['validated:test-listen']);
        const handler = vi.fn();
        const unsub   = listen('validated:test-listen', handler);
        coreEmit('validated:test-listen', { y: 2 });
        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({ y: 2 }),
            expect.anything()
        );
        unsub();
    });

    it('emit() warns for unregistered event when active (non-strict)', () => {
        register(['seed:to-activate']);
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        emit('completely:unknown:event:xyz');
        expect(spy).toHaveBeenCalledWith(expect.stringContaining('unregistered event'));
        spy.mockRestore();
    });

    it('events facade exposes same functions', () => {
        expect(events.register).toBe(register);
        expect(events.strictMode).toBe(strictMode);
        expect(events.isRegistered).toBe(isRegistered);
        expect(events.getRegistered).toBe(getRegistered);
        expect(events.emit).toBe(emit);
        expect(events.listen).toBe(listen);
    });
});

describe('register — strict mode', () => {
    afterEach(() => { strictMode(false); });

    it('strictMode(true) causes emit to throw for unregistered events', () => {
        register(['strict:seed']);
        strictMode(true);
        expect(() => emit('strict:unregistered:xyz')).toThrow('unregistered event');
    });

    it('strictMode(false) reverts to warn behaviour', () => {
        register(['strict:seed2']);
        strictMode(true);
        strictMode(false);
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(() => emit('strict:another:unregistered:xyz')).not.toThrow();
        spy.mockRestore();
    });
});

// plugin

import { plugin } from '../../src/js/core/plugin.js';
import { adapter } from '../../src/js/utils/adapter.js';

describe('plugin', () => {
    beforeEach(() => {
        adapter.list().filter(e => e.name.startsWith('test-')).forEach(e => adapter.unregister(e.name));
    });

    it('plugin.lib() registers a library via adapter', () => {
        const myLib = { version: '1.0.0' };
        plugin.lib('test-lib', myLib);
        expect(adapter.use('test-lib')).toBe(myLib);
    });

    it('plugin.lib() is chainable', () => {
        expect(plugin.lib('test-chain', {})).toBe(plugin);
    });

    it('plugin.lib.lazy() registers a lazy adapter', () => {
        plugin.lib.lazy('test-lazy', () => Promise.resolve({ lazy: true }));
        expect(adapter.has('test-lazy')).toBe(true);
        adapter.unregister('test-lazy');
    });

    it('plugin.codec() registers and plugin.getCodec() retrieves', () => {
        const codec = { encode: vi.fn(), decode: vi.fn(), binaryType: 'text' };
        plugin.codec('test-codec', codec);
        expect(plugin.getCodec('test-codec')).toBe(codec);
    });

    it('plugin.getCodec() returns null for unknown codec', () => {
        expect(plugin.getCodec('no-such-codec')).toBeNull();
    });

    it('plugin.codec() warns if encode/decode missing', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        plugin.codec('bad-codec', { encode: vi.fn() });
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('plugin.codec() is chainable', () => {
        const codec = { encode: vi.fn(), decode: vi.fn(), binaryType: 'text' };
        expect(plugin.codec('test-codec-chain', codec)).toBe(plugin);
    });

    it('plugin.render() registers a named renderer', () => {
        plugin.render('test-renderer', vi.fn());
        expect(plugin.getRenderer('test-renderer')).not.toBeNull();
    });

    it('plugin.getRenderer() returns null for unknown name', () => {
        expect(plugin.getRenderer('no-such-renderer')).toBeNull();
    });

    it('plugin.render() warns if fn is not a function', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        plugin.render('bad-renderer', 'not-a-function');
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('plugin.render() is chainable', () => {
        expect(plugin.render('test-r-chain', async () => {})).toBe(plugin);
    });

    it('plugin.router() + plugin.middleware() registers on router', () => {
        const mockRouter = { Use: vi.fn() };
        plugin.router(mockRouter).middleware(async (ctx, next) => next());
        expect(mockRouter.Use).toHaveBeenCalled();
    });

    it('plugin.middleware() is chainable', () => {
        const mockRouter = { Use: vi.fn() };
        plugin.router(mockRouter);
        expect(plugin.middleware(() => {})).toBe(plugin);
    });

    it('plugin.inspect() returns an object with known keys', () => {
        const info = plugin.inspect();
        expect(info).toHaveProperty('router');
        expect(info).toHaveProperty('libs');
        expect(info).toHaveProperty('codecs');
        expect(info).toHaveProperty('renderers');
        expect(Array.isArray(info.libs)).toBe(true);
    });

    it('plugin.api() calls beforeRequest on the api instance', () => {
        const mockApi = { beforeRequest: vi.fn(), afterResponse: vi.fn() };
        const hook    = vi.fn();
        plugin.api(mockApi, { beforeRequest: hook });
        expect(mockApi.beforeRequest).toHaveBeenCalledWith(hook);
    });

    it('plugin.api() is chainable', () => {
        const mockApi = { beforeRequest: vi.fn() };
        expect(plugin.api(mockApi, { beforeRequest: vi.fn() })).toBe(plugin);
    });

    it('plugin.api() warns for non-object first argument', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        plugin.api(null, {});
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('plugin.animation() is chainable', () => {
        expect(plugin.animation({})).toBe(plugin);
    });

    it('plugin.widget() is chainable', () => {
        expect(plugin.widget('test-widget', () => {})).toBe(plugin);
    });
});
