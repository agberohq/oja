/**
 * tests/core/out-module.test.js
 *
 * Tests for Out.module() — the ESM-native rendering primitive.
 *
 * Out.module(fn, html?, data?, options?) accepts:
 *   - An async function called directly:  async (scope) => void
 *   - A dynamic import factory:           () => import('./page.js')
 *   - A module object:                    { default: async (scope) => void }
 *
 * The scope object injected into the function:
 *   { container, props, find, findAll, ready, onUnmount, router, inject }
 *
 * No window[] handshake. No document.currentScript. Full ES imports available
 * in the page module function.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    const mock = vi.fn().mockResolvedValue({
        ok:   true,
        status: 200,
        text: () => Promise.resolve(html),
    });
    vi.stubGlobal('fetch', mock);
    return mock;
}

afterEach(() => {
    Out.clearCache();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

// Factory

describe('Out.module — factory', () => {
    it('type is "module"', () => {
        const out = Out.module(async () => {});
        expect(out.type).toBe('module');
    });

    it('Out.is() recognises an Out.module instance', () => {
        expect(Out.is(Out.module(async () => {}))).toBe(true);
    });

    it('throws when fn is falsy', () => {
        expect(() => Out.module(null)).toThrow('[oja/out] Out.module()');
        expect(() => Out.module(undefined)).toThrow('[oja/out] Out.module()');
    });

    it('does not throw for a direct async function', () => {
        expect(() => Out.module(async () => {})).not.toThrow();
    });

    it('does not throw for a dynamic import factory', () => {
        expect(() => Out.module(() => Promise.resolve({ default: async () => {} }))).not.toThrow();
    });

    it('does not throw for a module object', () => {
        expect(() => Out.module({ default: async () => {} })).not.toThrow();
    });
});

// Scope injection

describe('Out.module — scope object', () => {
    it('injects container into the function', async () => {
        const el = makeContainer();
        let received;
        await Out.module(async (scope) => { received = scope.container; }).render(el);
        expect(received).toBe(el);
        cleanup(el);
    });

    it('injects props merged from data and context', async () => {
        const el = makeContainer();
        let received;
        await Out.module(
            async (scope) => { received = scope.props; },
            '',
            { fromData: true }
        ).render(el, { fromContext: true });
        expect(received.fromData).toBe(true);
        expect(received.fromContext).toBe(true);
        cleanup(el);
    });

    it('data wins over context on key conflict', async () => {
        const el = makeContainer();
        let received;
        await Out.module(
            async (scope) => { received = scope.props.msg; },
            '',
            { msg: 'from-data' }
        ).render(el, { msg: 'from-context' });
        expect(received).toBe('from-data');
        cleanup(el);
    });

    it('injects find() scoped to the container', async () => {
        const el = makeContainer();
        el.innerHTML = '<span id="target">hit</span>';
        let found;
        await Out.module(async (scope) => {
            found = scope.find('#target');
        }).render(el);
        expect(found).not.toBeNull();
        expect(found.textContent).toBe('hit');
        cleanup(el);
    });

    it('find() returns null for elements outside the container', async () => {
        const el = makeContainer();
        const outside = document.createElement('span');
        outside.id = 'outside';
        document.body.appendChild(outside);
        let found;
        await Out.module(async (scope) => {
            found = scope.find('#outside');
        }).render(el);
        expect(found).toBeNull();
        outside.remove();
        cleanup(el);
    });

    it('injects findAll() returning an Array', async () => {
        const el = makeContainer();
        el.innerHTML = '<li>a</li><li>b</li><li>c</li>';
        let items;
        await Out.module(async (scope) => {
            items = scope.findAll('li');
        }).render(el);
        expect(Array.isArray(items)).toBe(true);
        expect(items).toHaveLength(3);
        cleanup(el);
    });

    it('injects ready as a function', async () => {
        const el = makeContainer();
        let readyType;
        await Out.module(async (scope) => {
            readyType = typeof scope.ready;
        }).render(el);
        expect(readyType).toBe('function');
        cleanup(el);
    });

    it('injects onUnmount as a function', async () => {
        const el = makeContainer();
        let type;
        await Out.module(async (scope) => { type = typeof scope.onUnmount; }).render(el);
        expect(type).toBe('function');
        cleanup(el);
    });

    it('injects inject as a function', async () => {
        const el = makeContainer();
        let type;
        await Out.module(async (scope) => { type = typeof scope.inject; }).render(el);
        expect(type).toBe('function');
        cleanup(el);
    });

    it('inject() returns undefined when no layout provide() has been called', async () => {
        const el = makeContainer();
        let val;
        await Out.module(async (scope) => {
            val = scope.inject('nonexistent');
        }).render(el);
        expect(val).toBeUndefined();
        cleanup(el);
    });
});

// HTML template rendering

describe('Out.module — HTML template', () => {
    it('renders the HTML template before calling the function', async () => {
        stubFetch('<div class="shell"><span id="hi">Hello</span></div>');
        const el = makeContainer();
        let foundEl;
        await Out.module(async (scope) => {
            foundEl = scope.find('#hi');
        }, 'layouts/shell.html').render(el);
        expect(foundEl).not.toBeNull();
        expect(foundEl.textContent).toBe('Hello');
        cleanup(el);
    });

    it('interpolates data into the HTML template', async () => {
        stubFetch('<p>Hello {{name}}</p>');
        const el = makeContainer();
        await Out.module(async () => {}, 'page.html', { name: 'Oja' }).render(el);
        expect(el.textContent).toContain('Hello Oja');
        cleanup(el);
    });

    it('renders with no HTML when html arg is omitted', async () => {
        const el = makeContainer();
        el.innerHTML = '<p id="existing">keep</p>';
        await Out.module(async () => {}).render(el);
        // No fetch, no innerHTML replacement
        expect(el.querySelector('#existing')).not.toBeNull();
        cleanup(el);
    });

    it('renders with no HTML when html is empty string', async () => {
        const el = makeContainer();
        el.innerHTML = '<p id="existing">keep</p>';
        await Out.module(async () => {}, '').render(el);
        expect(el.querySelector('#existing')).not.toBeNull();
        cleanup(el);
    });
});

// Dynamic import resolution

describe('Out.module — dynamic import fn', () => {
    it('calls default export when fn is a dynamic import factory', async () => {
        const el = makeContainer();
        const defaultFn = vi.fn(async () => {});
        const factory = () => Promise.resolve({ default: defaultFn });
        await Out.module(factory).render(el);
        expect(defaultFn).toHaveBeenCalledTimes(1);
        expect(defaultFn).toHaveBeenCalledWith(expect.objectContaining({ container: el }));
        cleanup(el);
    });

    it('passes scope to the resolved default export', async () => {
        const el = makeContainer();
        el.innerHTML = '<span id="check">x</span>';
        let foundEl;
        const factory = () => Promise.resolve({
            default: async ({ find }) => { foundEl = find('#check'); }
        });
        await Out.module(factory).render(el);
        expect(foundEl?.textContent).toBe('x');
        cleanup(el);
    });

    it('accepts a module object directly (no factory wrapping)', async () => {
        const el = makeContainer();
        const called = { yes: false };
        const mod = { default: async () => { called.yes = true; } };
        await Out.module(mod).render(el);
        expect(called.yes).toBe(true);
        cleanup(el);
    });

    it('accepts a direct async function (no dynamic import)', async () => {
        const el = makeContainer();
        let ran = false;
        await Out.module(async () => { ran = true; }).render(el);
        expect(ran).toBe(true);
        cleanup(el);
    });
});

// Function can mutate the DOM

describe('Out.module — DOM manipulation', () => {
    it('function can write to the container', async () => {
        const el = makeContainer();
        await Out.module(async ({ container }) => {
            container.innerHTML = '<p id="written">done</p>';
        }).render(el);
        expect(el.querySelector('#written')).not.toBeNull();
        cleanup(el);
    });

    it('function can use find() to update elements from the HTML template', async () => {
        stubFetch('<output id="result"></output>');
        const el = makeContainer();
        await Out.module(async ({ find }) => {
            const out = find('#result');
            if (out) out.textContent = 'computed';
        }, 'page.html').render(el);
        expect(el.querySelector('#result')?.textContent).toBe('computed');
        cleanup(el);
    });
});

// Error handling

describe('Out.module — error handling', () => {
    it('logs error but does not throw when function throws', async () => {
        const el = makeContainer();
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(
            Out.module(async () => { throw new Error('oops'); }).render(el)
        ).resolves.toBeUndefined();
        expect(errSpy).toHaveBeenCalledWith(
            expect.stringContaining('Out.module'),
            expect.any(Error)
        );
        cleanup(el);
    });

    it('logs error but does not throw when dynamic import rejects', async () => {
        const el = makeContainer();
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const factory = () => Promise.reject(new Error('import failed'));
        await expect(Out.module(factory).render(el)).resolves.toBeUndefined();
        expect(errSpy).toHaveBeenCalled();
        cleanup(el);
    });

    it('warns when timeout is exceeded', async () => {
        const el = makeContainer();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await Out.module(
            async () => { await new Promise(r => setTimeout(r, 200)); },
            '',
            {},
            { timeout: 50 }
        ).render(el);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('timeout'));
        cleanup(el);
    });
});

// OutTarget.module() — fluent API

describe('OutTarget.module() — fluent', () => {
    it('Out.to(el).module(fn) renders via the fluent chain', async () => {
        const el = makeContainer();
        let ran = false;
        Out.to(el).module(async () => { ran = true; });
        // Give the microtask queue a tick
        await new Promise(r => setTimeout(r, 0));
        expect(ran).toBe(true);
        cleanup(el);
    });

    it('returns the OutTarget for chaining', () => {
        const el = makeContainer();
        const target = Out.to(el);
        const result = target.module(async () => {});
        expect(result).toBe(target);
        cleanup(el);
    });
});

// Out.page() uses Out.module when js is provided

describe('Out.page() — backed by Out.module when js provided', () => {
    it('html-only Out.page returns type "component"', () => {
        expect(Out.page('about.html').type).toBe('component');
    });

    it('Out.page with js arg returns type "module"', () => {
        expect(Out.page('dashboard.html', 'dashboard.js').type).toBe('module');
    });

    it('Out.is() recognises Out.page with js', () => {
        expect(Out.is(Out.page('p.html', 'p.js'))).toBe(true);
    });
});

// Prefetch

describe('Out.module — prefetch', () => {
    it('prefetch() fetches the HTML template', async () => {
        const fetchMock = stubFetch('<div></div>');
        await Out.module(async () => {}, 'shell.html').prefetch();
        expect(fetchMock).toHaveBeenCalledWith('shell.html', expect.any(Object));
    });

    it('prefetch() does not throw when no html provided', async () => {
        await expect(Out.module(async () => {}).prefetch()).resolves.not.toThrow();
    });

    it('prefetch() triggers the dynamic import factory to warm the module cache', async () => {
        const factory = vi.fn(() => Promise.resolve({ default: async () => {} }));
        await Out.module(factory).prefetch();
        expect(factory).toHaveBeenCalledTimes(1);
    });
});

// URL string form — all four call sites
//
// Out.module(url, html)
// Out.to(el).module(url, html)
// Out.within(root).to(sel).module(url, html)
// Out.page(html, url)
//
// All wrap the URL as () => import(url) internally. We fake the dynamic import
// by stubbing the module default export so we can verify scope is passed.

describe('Out.module — URL string accepted by all call sites', () => {
    let el, root;

    beforeEach(() => {
        el   = document.createElement('div');
        root = document.createElement('div');
        root.innerHTML = '<div id="slot"></div>';
        document.body.appendChild(el);
        document.body.appendChild(root);
    });

    afterEach(() => {
        el.remove();
        root.remove();
        Out.clearCache();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    // Helper — builds a fake module whose default export captures the scope
    function fakeModule(captureFn) {
        return { [Symbol.toStringTag]: 'Module', default: async (scope) => captureFn(scope) };
    }

    it('Out.module(url, html) — constructs correctly', () => {
        const out = Out.module('pages/dashboard.js', 'pages/dashboard.html');
        expect(out.type).toBe('module');
        expect(out._html).toBe('pages/dashboard.html');
        expect(typeof out._payload).toBe('function');
        expect(out._payload.length).toBe(0); // wrapped factory
    });

    it('Out.module(url, html) — renders HTML and passes scope to default export', async () => {
        stubFetch('<p id="p">hello</p>');
        let received;
        // Intercept the dynamic import by patching the payload after construction
        const out = Out.module('pages/dashboard.js', 'pages/dashboard.html');
        out._payload = () => Promise.resolve(fakeModule(s => { received = s; }));
        await out.render(el);
        expect(el.querySelector('#p')).not.toBeNull();
        expect(received.container).toBe(el);
        expect(typeof received.find).toBe('function');
        expect(typeof received.ready).toBe('function');
    });

    it('Out.to(el).module(url, html) — same construction as Out.module', () => {
        const target = Out.to(el);
        // returns the OutTarget for chaining
        expect(target.module('pages/dashboard.js', 'pages/dashboard.html')).toBe(target);
    });

    it('Out.to(el).module(url, html) — renders HTML and passes scope', async () => {
        stubFetch('<span id="s">world</span>');
        let received;
        // Use an inline fn (length>=1) so no factory probe
        await Out.to(el).module(async (scope) => { received = scope; }, 'shell.html').render();
        expect(el.querySelector('#s')).not.toBeNull();
        expect(received.container).toBe(el);
    });

    it('Out.within(root).to(sel).module(url, html) — scopes to slot', async () => {
        stubFetch('<b id="b">scoped</b>');
        let received;
        await Out.within(root).to('#slot').module(async (scope) => { received = scope; }, 'shell.html').render();
        expect(root.querySelector('#slot #b')).not.toBeNull();
        expect(received.container).toBe(root.querySelector('#slot'));
    });

    it('Out.page(html, url) — returns module type when js provided', () => {
        const out = Out.page('pages/dashboard.html', 'pages/dashboard.js');
        expect(out.type).toBe('module');
        expect(out._html).toBe('pages/dashboard.html');
        expect(typeof out._payload).toBe('function');
        expect(out._options._isPage).toBe(true);
    });

    it('Out.page(url, html) — order-independent', () => {
        const out = Out.page('pages/dashboard.js', 'pages/dashboard.html');
        expect(out.type).toBe('module');
        expect(out._html).toBe('pages/dashboard.html');
    });

    it('Out.page(html) — html-only falls back to component', () => {
        const out = Out.page('pages/about.html');
        expect(out.type).toBe('component');
    });

    it('throws when url is empty string', () => {
        expect(() => Out.module('')).toThrow('[oja/out] Out.module() requires');
    });

    it('throws when url is null', () => {
        expect(() => Out.module(null)).toThrow('[oja/out] Out.module() requires');
    });
});

// scope.on / scope.off

describe('Out.module — scope.on / scope.off', () => {
    let el;
    beforeEach(() => { el = document.createElement('div'); document.body.appendChild(el); });
    afterEach(() => { el.remove(); Out.clearCache(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

    it('on(selector, event, handler) delegates within container only', async () => {
        el.innerHTML = '<button id="btn">click</button>';
        let count = 0;
        await Out.module(async ({ on }) => {
            on('#btn', 'click', () => count++);
        }).render(el);
        el.querySelector('#btn').click();
        expect(count).toBe(1);
    });

    it('on(selector) does not fire for elements outside container', async () => {
        const outside = document.createElement('button');
        outside.id = 'outside-btn';
        document.body.appendChild(outside);
        let count = 0;
        await Out.module(async ({ on }) => {
            on('#outside-btn', 'click', () => count++);
        }).render(el);
        outside.click();
        expect(count).toBe(0);
        outside.remove();
    });

    it('on(element, event, handler) binds directly to a specific element', async () => {
        el.innerHTML = '<input id="inp">';
        let fired = false;
        await Out.module(async ({ find, on }) => {
            const inp = find('#inp');
            on(inp, 'input', () => { fired = true; });
        }).render(el);
        el.querySelector('#inp').dispatchEvent(new Event('input'));
        expect(fired).toBe(true);
    });

    it('on() passes the matched element as second arg to handler', async () => {
        el.innerHTML = '<span class="item">x</span>';
        let received = null;
        await Out.module(async ({ on }) => {
            on('.item', 'click', (e, target) => { received = target; });
        }).render(el);
        el.querySelector('.item').click();
        expect(received).toBe(el.querySelector('.item'));
    });

    it('off() removes the listener early', async () => {
        el.innerHTML = '<button id="btn">x</button>';
        let count = 0;
        await Out.module(async ({ on, off }) => {
            const unsub = on('#btn', 'click', () => count++);
            off(unsub);
        }).render(el);
        el.querySelector('#btn').click();
        expect(count).toBe(0);
    });

    it('on() returns an unsub function', async () => {
        el.innerHTML = '<button id="btn">x</button>';
        let unsub;
        await Out.module(async ({ on }) => {
            unsub = on('#btn', 'click', () => {});
        }).render(el);
        expect(typeof unsub).toBe('function');
    });

    it('scope includes on and off as functions', async () => {
        let types = {};
        await Out.module(async (scope) => {
            types = { on: typeof scope.on, off: typeof scope.off };
        }).render(el);
        expect(types.on).toBe('function');
        expect(types.off).toBe('function');
    });
});
