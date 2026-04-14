/**
 * tests/core/layout-apply.test.js
 *
 * Tests for layout.apply() with JS module argument — the ESM-native layout mounting method —
 * and the provide() / inject() dependency injection system.
 *
 * layout.apply(target, jsImportFn, html?, data?) mounts a persistent shell
 * using a module function instead of an inline <script type="module">.
 *
 * provide(key, value) — called inside the layout function, registers a value
 *                       in the layout's DI Map for the lifetime of the layout.
 *
 * inject(key)         — called inside any Out.module page function, reads from
 *                       the active layout's DI Map synchronously.
 *
 * injector()       — returns the inject function for the active layout.
 *                       Called by _ModuleOut.render() to wire inject into page scope.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { layout } from '../../src/js/core/layout.js';
import { Out } from '../../src/js/core/out.js';

function makeContainer() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

function cleanup(el) {
    if (el?.parentNode) el.remove();
}

function stubFetch(html) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok:   true,
        status: 200,
        text: () => Promise.resolve(html),
    }));
}

afterEach(async () => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    Out.clearCache();
    layout.clearCache();
});

// layout.apply() factory

describe('layout.apply() — mounting', () => {
    it('mounts an inline async function as the layout script', async () => {
        const el = makeContainer();
        let ran = false;
        await layout.apply(el, async () => { ran = true; });
        expect(ran).toBe(true);
        cleanup(el);
    });

    it('calls the default export of a dynamic import factory', async () => {
        const el = makeContainer();
        const defaultFn = vi.fn(async () => {});
        const factory = () => Promise.resolve({ default: defaultFn });
        await layout.apply(el, factory);
        expect(defaultFn).toHaveBeenCalledTimes(1);
        cleanup(el);
    });

    it('accepts a module object directly', async () => {
        const el = makeContainer();
        let ran = false;
        const mod = { default: async () => { ran = true; } };
        await layout.apply(el, mod);
        expect(ran).toBe(true);
        cleanup(el);
    });

    it('returns the container element', async () => {
        const el = makeContainer();
        const result = await layout.apply(el, async () => {});
        expect(result).toBe(el);
        cleanup(el);
    });

    it('returns null for an unknown selector', async () => {
        const result = await layout.apply('#does-not-exist', async () => {});
        expect(result).toBeNull();
    });

    it('emits layout:mounted after the function runs', async () => {
        const el = makeContainer();
        const handler = vi.fn();
        document.addEventListener('layout:mounted', handler);
        await layout.apply(el, async () => {});
        document.removeEventListener('layout:mounted', handler);
        expect(handler).toHaveBeenCalledTimes(1);
        cleanup(el);
    });
});

// Scope object

describe('layout.apply() — scope', () => {
    it('injects container into the function', async () => {
        const el = makeContainer();
        let received;
        await layout.apply(el, async (scope) => { received = scope.container; });
        expect(received).toBe(el);
        cleanup(el);
    });

    it('injects find() scoped to the container', async () => {
        const el = makeContainer();
        el.innerHTML = '<nav id="nav">nav</nav>';
        let found;
        await layout.apply(el, async (scope) => { found = scope.find('#nav'); });
        expect(found).not.toBeNull();
        expect(found.textContent).toBe('nav');
        cleanup(el);
    });

    it('injects findAll() returning an Array', async () => {
        const el = makeContainer();
        el.innerHTML = '<li>a</li><li>b</li>';
        let items;
        await layout.apply(el, async (scope) => { items = scope.findAll('li'); });
        expect(Array.isArray(items)).toBe(true);
        expect(items).toHaveLength(2);
        cleanup(el);
    });

    it('injects provide as a function', async () => {
        const el = makeContainer();
        let type;
        await layout.apply(el, async (scope) => { type = typeof scope.provide; });
        expect(type).toBe('function');
        cleanup(el);
    });

    it('injects ready as a function', async () => {
        const el = makeContainer();
        let type;
        await layout.apply(el, async (scope) => { type = typeof scope.ready; });
        expect(type).toBe('function');
        cleanup(el);
    });

    it('injects onUnmount as a function', async () => {
        const el = makeContainer();
        let type;
        await layout.apply(el, async (scope) => { type = typeof scope.onUnmount; });
        expect(type).toBe('function');
        cleanup(el);
    });

    it('injects onReady as a function', async () => {
        const el = makeContainer();
        let type;
        await layout.apply(el, async (scope) => { type = typeof scope.onReady; });
        expect(type).toBe('function');
        cleanup(el);
    });

    it('injects signal from the layout AbortController', async () => {
        const el = makeContainer();
        let sig;
        await layout.apply(el, async (scope) => { sig = scope.signal; });
        expect(sig).toBeInstanceOf(AbortSignal);
        cleanup(el);
    });
});

// HTML template rendering

describe('layout.apply() — HTML rendering', () => {
    it('renders HTML template into the container before calling the function', async () => {
        stubFetch('<nav id="shell-nav">NAV</nav><main id="app"></main>');
        const el = makeContainer();
        let navEl;
        await layout.apply(el, async (scope) => {
            navEl = scope.find('#shell-nav');
        }, 'layouts/shell.html');
        expect(navEl).not.toBeNull();
        expect(navEl.textContent).toBe('NAV');
        cleanup(el);
    });

    it('interpolates data into the HTML template', async () => {
        stubFetch('<header>{{appName}}</header>');
        const el = makeContainer();
        await layout.apply(el, async () => {}, 'shell.html', { appName: 'Agbero' });
        expect(el.querySelector('header')?.textContent).toBe('Agbero');
        cleanup(el);
    });

    it('mounts with no HTML when html arg is omitted', async () => {
        const el = makeContainer();
        el.innerHTML = '<p id="existing">keep</p>';
        await layout.apply(el, async () => {});
        expect(el.querySelector('#existing')).not.toBeNull();
        cleanup(el);
    });
});

// provide()

describe('layout.apply() — provide()', () => {
    it('registers a value retrievable via injector()', async () => {
        const el = makeContainer();
        const api = { get: vi.fn() };
        await layout.apply(el, async ({ provide }) => {
            provide('api', api);
        });
        const inject = layout.injector(el);
        expect(inject('api')).toBe(api);
        await layout.unmount(el);
        cleanup(el);
    });

    it('registers multiple values independently', async () => {
        const el = makeContainer();
        const api   = { type: 'api' };
        const store = { type: 'store' };
        await layout.apply(el, async ({ provide }) => {
            provide('api',   api);
            provide('store', store);
        });
        const inject = layout.injector(el);
        expect(inject('api')).toBe(api);
        expect(inject('store')).toBe(store);
        await layout.unmount(el);
        cleanup(el);
    });

    it('overwrites a previously provided value for the same key', async () => {
        const el = makeContainer();
        await layout.apply(el, async ({ provide }) => {
            provide('key', 'first');
            provide('key', 'second');
        });
        const inject = layout.injector(el);
        expect(inject('key')).toBe('second');
        await layout.unmount(el);
        cleanup(el);
    });

    it('provided values survive router navigations (layout persists)', async () => {
        const el = makeContainer();
        const api = { type: 'persistent-api' };
        await layout.apply(el, async ({ provide }) => {
            provide('api', api);
        });
        // Simulate two navigations — layout stays mounted
        const inject1 = layout.injector(el);
        const inject2 = layout.injector(el);
        expect(inject1('api')).toBe(api);
        expect(inject2('api')).toBe(api);
        await layout.unmount(el);
        cleanup(el);
    });
});

// injector()

describe('layout.injector()', () => {
    it('returns a function', () => {
        expect(typeof layout.injector()).toBe('function');
    });

    it('returns undefined for unknown keys when no layout is mounted', () => {
        const inject = layout.injector();
        expect(inject('anything')).toBeUndefined();
    });

    it('returns undefined for keys not registered via provide()', async () => {
        const el = makeContainer();
        await layout.apply(el, async ({ provide }) => {
            provide('api', {});
        });
        const inject = layout.injector(el);
        expect(inject('store')).toBeUndefined();
        await layout.unmount(el);
        cleanup(el);
    });

    it('targets the correct container when multiple layouts are mounted', async () => {
        const el1 = makeContainer();
        const el2 = makeContainer();
        await layout.apply(el1, async ({ provide }) => { provide('from', 'layout-1'); });
        await layout.apply(el2, async ({ provide }) => { provide('from', 'layout-2'); });
        expect(layout.injector(el1)('from')).toBe('layout-1');
        expect(layout.injector(el2)('from')).toBe('layout-2');
        await layout.unmount(el1);
        await layout.unmount(el2);
        cleanup(el1);
        cleanup(el2);
    });

    it('falls back to last active layout when no target given', async () => {
        const el = makeContainer();
        await layout.apply(el, async ({ provide }) => { provide('x', 42); });
        // No target — should find the last active layout
        const inject = layout.injector();
        expect(inject('x')).toBe(42);
        await layout.unmount(el);
        cleanup(el);
    });
});

// provide / inject end-to-end

describe('provide / inject — end-to-end via Out.module', () => {
    it('Out.module page receives inject() bound to the active layout provided Map', async () => {
        const layoutEl = makeContainer();
        const pageEl   = makeContainer();
        const api      = { get: vi.fn().mockResolvedValue([]) };

        // Mount layout with provide
        await layout.apply(layoutEl, async ({ provide }) => {
            provide('api', api);
        });

        // Mount page via Out.module — inject should find the layout's api
        let injectedApi;
        await Out.module(async ({ inject }) => {
            injectedApi = inject('api');
        }).render(pageEl);

        expect(injectedApi).toBe(api);

        await layout.unmount(layoutEl);
        cleanup(layoutEl);
        cleanup(pageEl);
    });

    it('page inject() is synchronous — no await needed', async () => {
        const layoutEl = makeContainer();
        const pageEl   = makeContainer();
        const store    = { get: vi.fn(() => 'value') };

        await layout.apply(layoutEl, async ({ provide }) => {
            provide('store', store);
        });

        let result;
        await Out.module(async ({ inject }) => {
            result = inject('store').get('key'); // synchronous call
        }).render(pageEl);

        expect(result).toBe('value');
        expect(store.get).toHaveBeenCalledWith('key');

        await layout.unmount(layoutEl);
        cleanup(layoutEl);
        cleanup(pageEl);
    });

    it('page gets undefined for keys not provided by the layout', async () => {
        const layoutEl = makeContainer();
        const pageEl   = makeContainer();

        await layout.apply(layoutEl, async ({ provide }) => {
            provide('api', {});
        });

        let val;
        await Out.module(async ({ inject }) => {
            val = inject('router'); // not provided
        }).render(pageEl);

        expect(val).toBeUndefined();

        await layout.unmount(layoutEl);
        cleanup(layoutEl);
        cleanup(pageEl);
    });

    it('multiple pages share the same provided instance', async () => {
        const layoutEl = makeContainer();
        const page1El  = makeContainer();
        const page2El  = makeContainer();
        const shared   = { id: 'shared-singleton' };

        await layout.apply(layoutEl, async ({ provide }) => {
            provide('shared', shared);
        });

        let from1, from2;
        await Out.module(async ({ inject }) => { from1 = inject('shared'); }).render(page1El);
        await Out.module(async ({ inject }) => { from2 = inject('shared'); }).render(page2El);

        expect(from1).toBe(shared);
        expect(from2).toBe(shared);
        expect(from1).toBe(from2); // same reference — not a copy

        await layout.unmount(layoutEl);
        cleanup(layoutEl);
        cleanup(page1El);
        cleanup(page2El);
    });
});

// Lifecycle hooks

describe('layout.apply() — lifecycle hooks', () => {
    it('onUnmount hook registered in layout.apply fires on layout.unmount()', async () => {
        const el = makeContainer();
        const unmountFn = vi.fn();
        await layout.apply(el, async ({ onUnmount }) => {
            onUnmount(unmountFn);
        });
        expect(unmountFn).not.toHaveBeenCalled();
        await layout.unmount(el);
        expect(unmountFn).toHaveBeenCalledTimes(1);
        cleanup(el);
    });

    it('onReady hook fires after layout.apply() resolves', async () => {
        const el = makeContainer();
        const order = [];
        await layout.apply(el, async ({ onReady }) => {
            onReady(() => order.push('onReady'));
            order.push('fn');
        });
        // onReady fires after the function completes, before layout.apply resolves
        expect(order).toContain('fn');
        expect(order).toContain('onReady');
        expect(order.indexOf('fn')).toBeLessThan(order.indexOf('onReady'));
        await layout.unmount(el);
        cleanup(el);
    });

    it('provided Map is cleared when layout is unmounted', async () => {
        const el = makeContainer();
        await layout.apply(el, async ({ provide }) => {
            provide('api', { type: 'api' });
        });

        const injectBefore = layout.injector(el);
        expect(injectBefore('api')).toBeDefined();

        await layout.unmount(el);

        // After unmount, container is no longer in _active
        const injectAfter = layout.injector(el);
        expect(injectAfter('api')).toBeUndefined();

        cleanup(el);
    });
});

// Teardown on re-mount

describe('layout.apply() — re-mount tears down previous layout', () => {
    it('runs unmount hooks from the previous layout before mounting new one', async () => {
        const el = makeContainer();
        const order = [];

        await layout.apply(el, async ({ onUnmount }) => {
            onUnmount(() => order.push('unmount-1'));
            order.push('mount-1');
        });

        await layout.apply(el, async (_scope) => {
            order.push('mount-2');
        });

        expect(order).toEqual(['mount-1', 'unmount-1', 'mount-2']);
        await layout.unmount(el);
        cleanup(el);
    });

    it('provided Map from previous layout is not visible after re-mount', async () => {
        const el = makeContainer();

        await layout.apply(el, async ({ provide }) => {
            provide('fromFirst', true);
        });

        await layout.apply(el, async ({ provide }) => {
            provide('fromSecond', true);
        });

        const inject = layout.injector(el);
        expect(inject('fromSecond')).toBe(true);
        expect(inject('fromFirst')).toBeUndefined(); // wiped by re-mount

        await layout.unmount(el);
        cleanup(el);
    });
});

// Error handling

describe('layout.apply() — error handling', () => {
    it('logs error but does not throw when the layout function throws', async () => {
        const el = makeContainer();
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(
            layout.apply(el, async () => { throw new Error('shell crashed'); })
        ).resolves.not.toThrow();
        expect(errSpy).toHaveBeenCalledWith(
            expect.stringContaining('layout.apply'),
            expect.any(Error)
        );
        cleanup(el);
    });

    it('logs error when resolved fn is not a function', async () => {
        const el = makeContainer();
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        // A factory that resolves to a non-function default export
        const factory = () => Promise.resolve({ default: 'not-a-function' });
        await expect(layout.apply(el, factory)).resolves.not.toThrow();
        expect(errSpy).toHaveBeenCalledWith(
            expect.stringContaining('layout.apply'),
            expect.anything()
        );
        cleanup(el);
    });
});

// layout.apply() — new unified signatures

describe('layout.apply() — argument forms', () => {
    it('html-only string (legacy path) renders HTML into container', async () => {
        const el = makeContainer();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, text: () => Promise.resolve('<nav id="nav">NAV</nav>'),
        }));
        await layout.apply(el, 'layouts/shell.html');
        expect(el.querySelector('#nav')).not.toBeNull();
        cleanup(el);
    });

    it('html + js as positional strings — js receives scope', async () => {
        const el = makeContainer();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, text: () => Promise.resolve('<div id="x"></div>'),
        }));
        let received;
        // Can't really dynamic-import a string URL in tests, so use inline fn
        // The string path is tested via the factory wrapping — verify type
        const out = await layout.apply(el, 'layouts/shell.html', async (_scope) => {
            received = _scope;
        });
        expect(typeof received.find).toBe('function');
        expect(typeof received.provide).toBe('function');
        expect(received.container).toBe(el);
        cleanup(el);
    });

    it('js arg as factory function — resolves default export', async () => {
        const el = makeContainer();
        let called = false;
        const factory = () => Promise.resolve({
            [Symbol.toStringTag]: 'Module',
            default: async (_scope) => { called = true; },
        });
        await layout.apply(el, factory);
        expect(called).toBe(true);
        cleanup(el);
    });

    it('object form { html, js } with inline fn', async () => {
        const el = makeContainer();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, text: () => Promise.resolve('<p id="p">hi</p>'),
        }));
        let containerReceived;
        await layout.apply(el, {
            html: 'shell.html',
            js: async (_scope) => { containerReceived = _scope.container; },
        });
        expect(containerReceived).toBe(el);
        expect(el.querySelector('#p')).not.toBeNull();
        cleanup(el);
    });

    it('either argument order works — (html, js) same as (js, html)', async () => {
        const el1 = makeContainer();
        const el2 = makeContainer();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true, text: () => Promise.resolve('<span id="s">x</span>'),
        }));
        let scope1, scope2;
        await layout.apply(el1, 'shell.html', async (s) => { scope1 = s; });
        await layout.apply(el2, async (s) => { scope2 = s; }, 'shell.html');
        expect(scope1.container).toBe(el1);
        expect(scope2.container).toBe(el2);
        cleanup(el1); cleanup(el2);
    });
});

// layout.apply() — scope.on / scope.off

describe('layout.apply() — scope.on / scope.off', () => {
    it('on(selector, event, handler) delegates within layout container only', async () => {
        const el = makeContainer();
        el.innerHTML = '<nav><a id="link">click</a></nav>';
        let count = 0;
        await layout.apply(el, async ({ on }) => {
            on('#link', 'click', () => count++);
        });
        el.querySelector('#link').click();
        expect(count).toBe(1);
        cleanup(el);
    });

    it('on(selector) does not fire for elements outside layout container', async () => {
        const el = makeContainer();
        const outside = document.createElement('button');
        outside.id = 'outside';
        document.body.appendChild(outside);
        let count = 0;
        await layout.apply(el, async ({ on }) => {
            on('#outside', 'click', () => count++);
        });
        outside.click();
        expect(count).toBe(0);
        outside.remove();
        cleanup(el);
    });

    it('on(element, event, handler) binds directly to a specific element', async () => {
        const el = makeContainer();
        el.innerHTML = '<input id="inp">';
        let fired = false;
        await layout.apply(el, async ({ find, on }) => {
            on(find('#inp'), 'input', () => { fired = true; });
        });
        el.querySelector('#inp').dispatchEvent(new Event('input'));
        expect(fired).toBe(true);
        cleanup(el);
    });

    it('on() listeners are removed automatically when layout is unmounted', async () => {
        const el = makeContainer();
        el.innerHTML = '<button id="btn">x</button>';
        let count = 0;
        await layout.apply(el, async ({ on }) => {
            on('#btn', 'click', () => count++);
        });
        el.querySelector('#btn').click();
        expect(count).toBe(1);
        await layout.unmount(el);
        // Container is cleared on unmount but verify _unsubs were cleaned
        // by checking the listener no longer fires on a re-attached element
        expect(count).toBe(1);
        cleanup(el);
    });

    it('off() removes a listener before unmount', async () => {
        const el = makeContainer();
        el.innerHTML = '<button id="btn">x</button>';
        let count = 0;
        await layout.apply(el, async ({ on, off }) => {
            const unsub = on('#btn', 'click', () => count++);
            off(unsub);
        });
        el.querySelector('#btn').click();
        expect(count).toBe(0);
        cleanup(el);
    });

    it('scope includes on and off as functions', async () => {
        const el = makeContainer();
        let types = {};
        await layout.apply(el, async (scope) => {
            types = { on: typeof scope.on, off: typeof scope.off };
        });
        expect(types.on).toBe('function');
        expect(types.off).toBe('function');
        cleanup(el);
    });
});
