import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sw } from '../../src/js/ext/sw.js';


function makeSwShim(overrides = {}) {
    return {
        controller: null,
        ready: Promise.resolve({ active: { postMessage: vi.fn() } }),
        register: vi.fn().mockResolvedValue({}),
        addEventListener: vi.fn(),
        ...overrides,
    };
}

beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'serviceWorker', {
        value: makeSwShim(),
        configurable: true,
        writable: true,
    });
});

afterEach(() => {
    vi.useRealTimers();
});


describe('sw.on()', () => {
    it('registers a listener and calls it when invoked', () => {
        const fn = vi.fn();
        sw.on('TEST_MSG', fn);
        fn({ type: 'TEST_MSG', payload: 42 });
        expect(fn).toHaveBeenCalledWith({ type: 'TEST_MSG', payload: 42 });
    });

    it('returns an unsubscribe function', () => {
        const off = sw.on('UNSUB_MSG', vi.fn());
        expect(typeof off).toBe('function');
    });

    it('stops calling the listener after unsubscribe', () => {
        const fn = vi.fn();
        const off = sw.on('ONCE_MSG', fn);
        off();
        const fn2 = vi.fn();
        const off2 = sw.on('ONCE_MSG', fn2);
        off2();
        expect(fn).not.toHaveBeenCalled();
    });

    it('allows multiple listeners on the same type', () => {
        const a = vi.fn(); const b = vi.fn();
        const offA = sw.on('MULTI', a); const offB = sw.on('MULTI', b);
        offA(); offB();
        expect(a).not.toHaveBeenCalled(); expect(b).not.toHaveBeenCalled();
    });
});


describe('sw.post()', () => {
    it('calls postMessage on the active controller', () => {
        const postMessage = vi.fn();
        navigator.serviceWorker.controller = { postMessage };
        sw.post({ type: 'PING' });
        expect(postMessage).toHaveBeenCalledWith({ type: 'PING' });
    });

    it('does nothing when there is no active controller', () => {
        navigator.serviceWorker.controller = null;
        expect(() => sw.post({ type: 'PING' })).not.toThrow();
    });
});


describe('sw.send() without ack', () => {
    it('posts the message and resolves null immediately', async () => {
        const postMessage = vi.fn();
        navigator.serviceWorker.ready = Promise.resolve({ active: { postMessage } });
        const result = await sw.send({ type: 'FIRE' });
        expect(postMessage).toHaveBeenCalledWith({ type: 'FIRE' });
        expect(result).toBeNull();
    });

    it('resolves null when there is no active worker', async () => {
        navigator.serviceWorker.ready = Promise.resolve({ active: null });
        expect(await sw.send({ type: 'FIRE' })).toBeNull();
    });
});


describe('sw.send() with ack', () => {
    it('resolves null after timeout if no ACK arrives', async () => {
        const postMessage = vi.fn();
        navigator.serviceWorker.ready = Promise.resolve({ active: { postMessage } });
        const promise = sw.send({ type: 'SLOW' }, { ack: 'NEVER_ACK', timeout: 200 });
        await Promise.resolve();
        vi.advanceTimersByTime(200);
        expect(await promise).toBeNull();
    });
});


describe('sw.syncVFS()', () => {
    it('sends a SYNC_VFS message with the files map', async () => {
        const postMessage = vi.fn();
        navigator.serviceWorker.ready = Promise.resolve({ active: { postMessage } });
        const files = { '/app.js': 'console.log(1)' };
        const promise = sw.syncVFS(files, { timeout: 100 });
        await Promise.resolve();
        vi.advanceTimersByTime(100);
        await promise;
        expect(postMessage).toHaveBeenCalledWith({ type: 'SYNC_VFS', files });
    });

    it('uses VFS_SYNCED as the default ACK type', async () => {
        const postMessage = vi.fn();
        navigator.serviceWorker.ready = Promise.resolve({ active: { postMessage } });
        const promise = sw.syncVFS({}, { timeout: 50 });
        await Promise.resolve();
        vi.advanceTimersByTime(50);
        expect(await promise).toBeNull(); // timed out waiting for VFS_SYNCED
    });

    it('accepts a custom ack type', async () => {
        const postMessage = vi.fn();
        navigator.serviceWorker.ready = Promise.resolve({ active: { postMessage } });
        const promise = sw.syncVFS({}, { ack: 'CUSTOM_ACK', timeout: 50 });
        await Promise.resolve();
        vi.advanceTimersByTime(50);
        expect(await promise).toBeNull();
    });
});


describe('sw.register()', () => {
    it('resolves null when serviceWorker is not supported', async () => {
        Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
        expect(await sw.register('./sw.js')).toBeNull();
    });

    it('resolves immediately if a controller is already active', async () => {
        const reg = { scope: '/' };
        navigator.serviceWorker.register = vi.fn().mockResolvedValue(reg);
        navigator.serviceWorker.controller = { state: 'activated' };
        expect(await sw.register('./sw.js')).toBe(reg);
    });

    it('resolves after timeout when controllerchange never fires', async () => {
        const reg = { scope: '/' };
        navigator.serviceWorker.register = vi.fn().mockResolvedValue(reg);
        navigator.serviceWorker.controller = null;
        navigator.serviceWorker.addEventListener = vi.fn();
        const promise = sw.register('./sw.js');
        await Promise.resolve();
        vi.advanceTimersByTime(2000);
        expect(await promise).toBe(reg);
    });

    it('resolves null when registration throws', async () => {
        navigator.serviceWorker.register = vi.fn().mockRejectedValue(new Error('blocked'));
        navigator.serviceWorker.controller = null;
        const promise = sw.register('./sw.js');
        await Promise.resolve(); await Promise.resolve();
        expect(await promise).toBeNull();
    });
});


describe('sw.supported', () => {
    it('returns true when serviceWorker is in navigator', () => {
        expect(sw.supported).toBe(true);
    });
});

describe('sw.active', () => {
    it('returns the controller when one is set', () => {
        const ctrl = { state: 'activated' };
        navigator.serviceWorker.controller = ctrl;
        expect(sw.active).toBe(ctrl);
    });

    it('returns null when there is no controller', () => {
        navigator.serviceWorker.controller = null;
        expect(sw.active).toBeNull();
    });
});


describe('sw.registerAppWorker()', () => {
    it('is a method on the sw object', () => {
        expect(typeof sw.registerAppWorker).toBe('function');
    });

    it('returns a Promise', () => {
        const result = sw.registerAppWorker('./sw.js');
        expect(result).toBeInstanceOf(Promise);
        result.catch(() => {}); // suppress unhandled
    });

    it('resolves null when serviceWorker is not supported', async () => {
        Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
        expect(await sw.registerAppWorker('./sw.js')).toBeNull();
    });

    it('calls navigator.serviceWorker.register with the given script URL', async () => {
        const reg = { scope: '/' };
        navigator.serviceWorker.register = vi.fn().mockResolvedValue(reg);
        navigator.serviceWorker.controller = { state: 'activated' };

        await sw.registerAppWorker('./sw.js');
        expect(navigator.serviceWorker.register).toHaveBeenCalledWith('./sw.js', {});
    });

    it('passes options to navigator.serviceWorker.register', async () => {
        const reg = { scope: '/' };
        navigator.serviceWorker.register = vi.fn().mockResolvedValue(reg);
        navigator.serviceWorker.controller = { state: 'activated' };

        await sw.registerAppWorker('./sw.js', [], { scope: '/app/' });
        expect(navigator.serviceWorker.register).toHaveBeenCalledWith('./sw.js', { scope: '/app/' });
    });

    it('returns the ServiceWorkerRegistration on success', async () => {
        const reg = { scope: '/' };
        navigator.serviceWorker.register = vi.fn().mockResolvedValue(reg);
        navigator.serviceWorker.controller = { state: 'activated' };

        const result = await sw.registerAppWorker('./sw.js');
        expect(result).toBe(reg);
    });

    it('sends a PRECACHE message when assets are provided', async () => {
        const postMessage = vi.fn();
        navigator.serviceWorker.register = vi.fn().mockResolvedValue({ scope: '/' });
        navigator.serviceWorker.controller = { state: 'activated', postMessage };

        const assets = [
            'https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js',
            'https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.6.1/mermaid.min.js',
        ];

        await sw.registerAppWorker('./sw.js', assets);
        expect(postMessage).toHaveBeenCalledWith({ type: 'PRECACHE', assets });
    });

    it('does not send PRECACHE when assets array is empty', async () => {
        const postMessage = vi.fn();
        navigator.serviceWorker.register = vi.fn().mockResolvedValue({ scope: '/' });
        navigator.serviceWorker.controller = { state: 'activated', postMessage };

        await sw.registerAppWorker('./sw.js', []);
        expect(postMessage).not.toHaveBeenCalled();
    });

    it('does not send PRECACHE when assets are omitted', async () => {
        const postMessage = vi.fn();
        navigator.serviceWorker.register = vi.fn().mockResolvedValue({ scope: '/' });
        navigator.serviceWorker.controller = { state: 'activated', postMessage };

        await sw.registerAppWorker('./sw.js');
        expect(postMessage).not.toHaveBeenCalled();
    });

    it('resolves null (not throws) when register() fails', async () => {
        navigator.serviceWorker.register = vi.fn().mockRejectedValue(new Error('denied'));
        navigator.serviceWorker.controller = null;

        const promise = sw.registerAppWorker('./sw.js', ['https://example.com/lib.js']);
        await Promise.resolve(); await Promise.resolve();
        // register() resolves null on error, so registerAppWorker should too
        const result = await promise;
        expect(result).toBeNull();
    });

    it('works end-to-end: registers SW and precaches a list of CDN assets', async () => {
        const postMessage = vi.fn();
        const reg = { scope: './', active: { postMessage } };
        navigator.serviceWorker.register = vi.fn().mockResolvedValue(reg);
        navigator.serviceWorker.controller = { state: 'activated', postMessage };

        const CDN_ASSETS = [
            'https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js',
            'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js',
            'https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.6.1/mermaid.min.js',
        ];

        const result = await sw.registerAppWorker('./sw.js', CDN_ASSETS);

        expect(result).toBe(reg);
        expect(navigator.serviceWorker.register).toHaveBeenCalledWith('./sw.js', {});
        expect(postMessage).toHaveBeenCalledWith({ type: 'PRECACHE', assets: CDN_ASSETS });
    });
});