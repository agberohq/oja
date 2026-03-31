import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    morph, shouldMorph,
    scan, unbind, enableAutoBind, disableAutoBind,
    bindText, bindHtml, bindClass, bindAttr, bindToggle,
    list, listAsync,
    nextFrame,
    formatters,
    useStore,
} from '../../src/js/core/engine.js';
import { Store } from '../../src/js/core/store.js';


function makeEl(html = '') {
    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div);
    return div;
}

function cleanup(...els) {
    for (const el of els) el?.remove();
}


describe('morph()', () => {
    let el;
    afterEach(() => cleanup(el));

    it('patches text content without replacing the container', async () => {
        el = makeEl('<span id="s">old</span>');
        const span = el.querySelector('#s');
        await morph(el, '<span id="s">new</span>');
        expect(el.querySelector('#s').textContent).toBe('new');
        expect(el.querySelector('#s')).toBe(span);   // same node — not replaced
    });

    it('adds new nodes', async () => {
        el = makeEl('<span>a</span>');
        await morph(el, '<span>a</span><span>b</span>');
        expect(el.querySelectorAll('span').length).toBe(2);
    });

    it('removes stale nodes', async () => {
        el = makeEl('<span>a</span><span>b</span>');
        await morph(el, '<span>a</span>');
        expect(el.querySelectorAll('span').length).toBe(1);
    });

    it('syncs attributes', async () => {
        el = makeEl('<div class="old"></div>');
        await morph(el, '<div class="new"></div>');
        expect(el.querySelector('div').className).toBe('new');
    });

    it('short-circuits on identical HTML — returns same element', async () => {
        el = makeEl('<span>x</span>');
        await morph(el, '<span>x</span>');
        const result = await morph(el, '<span>x</span>');
        expect(result).toBe(el);
    });

    it('returns null when container not found', async () => {
        const result = await morph('#does-not-exist', '<span>x</span>');
        expect(result).toBeNull();
    });

    it('does not clobber value of focused input', async () => {
        el = makeEl('<input id="i" value="typed">');
        const input = el.querySelector('#i');
        input.focus();
        input.value = 'typed-by-user';
        await morph(el, '<input id="i" value="from-server">');
        expect(input.value).toBe('typed-by-user');
    });

    it('reuses keyed nodes', async () => {
        el = makeEl('<div data-oja-key="a">A</div><div data-oja-key="b">B</div>');
        const nodeA = el.querySelector('[data-oja-key="a"]');
        await morph(el, '<div data-oja-key="b">B2</div><div data-oja-key="a">A2</div>');
        expect(el.querySelector('[data-oja-key="a"]')).toBe(nodeA);
        expect(el.querySelector('[data-oja-key="a"]').textContent).toBe('A2');
    });
});


describe('shouldMorph()', () => {
    let el;
    afterEach(() => cleanup(el));

    it('returns true before first morph', () => {
        el = makeEl();
        expect(shouldMorph(el, '<span>x</span>')).toBe(true);
    });

    it('returns false after morphing with the same HTML', async () => {
        el = makeEl();
        await morph(el, '<span>x</span>');
        expect(shouldMorph(el, '<span>x</span>')).toBe(false);
    });

    it('returns true after content changes', async () => {
        el = makeEl();
        await morph(el, '<span>x</span>');
        expect(shouldMorph(el, '<span>y</span>')).toBe(true);
    });
});


describe('bindText()', () => {
    let el, store;
    beforeEach(() => { store = new Store('engine-test-bt'); useStore(store); });
    afterEach(() => { cleanup(el); store.clearAll(); });

    it('sets initial textContent from store', () => {
        store.set('cpu', '50%');
        el = makeEl('<span></span>');
        bindText(el.querySelector('span'), 'cpu');
        expect(el.querySelector('span').textContent).toBe('50%');
    });

    it('updates textContent when store changes', () => {
        store.set('cpu', '50%');
        el = makeEl('<span></span>');
        bindText(el.querySelector('span'), 'cpu');
        store.set('cpu', '72%');
        expect(el.querySelector('span').textContent).toBe('72%');
    });

    it('returns an unsubscribe function that stops updates', () => {
        store.set('val', 'a');
        el = makeEl('<span></span>');
        const unsub = bindText(el.querySelector('span'), 'val');
        unsub();
        store.set('val', 'b');
        expect(el.querySelector('span').textContent).toBe('a');
    });

    it('applies transform function', () => {
        store.set('name', 'hello');
        el = makeEl('<span></span>');
        bindText(el.querySelector('span'), 'name', v => v.toUpperCase());
        expect(el.querySelector('span').textContent).toBe('HELLO');
    });

    it('warns and returns noop when element not found', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const unsub = bindText('#nope', 'key');
        expect(typeof unsub).toBe('function');
        warnSpy.mockRestore();
    });

    it('guards against duplicate binding on same element+key', () => {
        store.set('dup', 'x');
        el = makeEl('<span></span>');
        const span = el.querySelector('span');
        bindText(span, 'dup');
        bindText(span, 'dup');   // second call — should not double-register
        store.set('dup', 'y');
        expect(span.textContent).toBe('y');   // updated once, not twice
    });
});


describe('bindToggle()', () => {
    let el, store;
    beforeEach(() => { store = new Store('engine-test-tog'); useStore(store); });
    afterEach(() => { cleanup(el); store.clearAll(); });

    it('adds activeClass when value is truthy', () => {
        store.set('online', true);
        el = makeEl('<div></div>');
        bindToggle(el.querySelector('div'), 'online', { activeClass: 'is-online' });
        expect(el.querySelector('div').className).toBe('is-online');
    });

    it('sets inactiveClass when value is falsy', () => {
        store.set('online', false);
        el = makeEl('<div></div>');
        bindToggle(el.querySelector('div'), 'online', { activeClass: 'is-online', inactiveClass: 'is-offline' });
        expect(el.querySelector('div').className).toBe('is-offline');
    });

    it('reacts to store changes', () => {
        store.set('flag', false);
        el = makeEl('<div></div>');
        bindToggle(el.querySelector('div'), 'flag', { activeClass: 'active' });
        store.set('flag', true);
        expect(el.querySelector('div').className).toBe('active');
    });
});


describe('bindAttr()', () => {
    let el, store;
    beforeEach(() => { store = new Store('engine-test-attr'); useStore(store); });
    afterEach(() => { cleanup(el); store.clearAll(); });

    it('sets attribute from transform return value', () => {
        store.set('disabled', true);
        el = makeEl('<button></button>');
        bindAttr(el.querySelector('button'), 'disabled', v => ({ disabled: v ? '' : null }));
        expect(el.querySelector('button').hasAttribute('disabled')).toBe(true);
    });

    it('removes attribute when value is null', () => {
        store.set('disabled', false);
        el = makeEl('<button disabled></button>');
        bindAttr(el.querySelector('button'), 'disabled', v => ({ disabled: v ? '' : null }));
        expect(el.querySelector('button').hasAttribute('disabled')).toBe(false);
    });

    it('warns when transform is not a function', () => {
        el = makeEl('<button></button>');
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        bindAttr(el.querySelector('button'), 'key', 'not-a-function');
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});


describe('unbind()', () => {
    let el, store;
    beforeEach(() => { store = new Store('engine-test-unbind'); useStore(store); });
    afterEach(() => { cleanup(el); store.clearAll(); });

    it('stops all bindings within the container after unbind()', () => {
        store.set('val', 'a');
        el = makeEl('<span data-oja-bind="val"></span>');
        scan(el);
        unbind(el);
        store.set('val', 'b');
        expect(el.querySelector('span').textContent).toBe('a');
    });
});


describe('scan()', () => {
    let el, store;
    beforeEach(() => { store = new Store('engine-test-scan'); useStore(store); });
    afterEach(() => { cleanup(el); store.clearAll(); });

    it('binds data-oja-bind elements within container', () => {
        store.set('label', 'hello');
        el = makeEl('<span data-oja-bind="label"></span>');
        scan(el);
        expect(el.querySelector('span').textContent).toBe('hello');
    });

    it('does not affect elements outside the container', () => {
        store.set('outside', 'x');
        const sibling = makeEl('<span data-oja-bind="outside"></span>');
        el = makeEl('<div></div>');
        scan(el);
        expect(sibling.querySelector('span').textContent).toBe('');
        cleanup(sibling);
    });

    it('applies data-oja-transform formatter', () => {
        store.set('pct', 0.75);
        el = makeEl('<span data-oja-bind="pct" data-oja-transform="formatPercent"></span>');
        scan(el);
        expect(el.querySelector('span').textContent).toBe('0.8%');
    });
});


describe('list()', () => {
    let el;
    afterEach(() => cleanup(el));

    it('renders items into container', () => {
        el = makeEl();
        list(el, [{ id: 'a' }, { id: 'b' }], {
            key:    item => item.id,
            render: (item) => {
                const d = document.createElement('div');
                d.textContent = item.id;
                return d;
            },
        });
        expect(el.children.length).toBe(2);
    });

    it('reuses existing keyed nodes on update', () => {
        el = makeEl();
        const render = (item, existing) => {
            const d = existing || document.createElement('div');
            d.textContent = item.id;
            return d;
        };
        list(el, [{ id: 'a' }, { id: 'b' }], { key: i => i.id, render });
        const nodeA = el.querySelector('[data-oja-key="a"]');
        list(el, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], { key: i => i.id, render });
        expect(el.querySelector('[data-oja-key="a"]')).toBe(nodeA);
        expect(el.children.length).toBe(3);
    });

    it('removes stale keyed nodes', () => {
        el = makeEl();
        const render = (item) => { const d = document.createElement('div'); d.textContent = item.id; return d; };
        list(el, [{ id: 'a' }, { id: 'b' }], { key: i => i.id, render });
        list(el, [{ id: 'a' }], { key: i => i.id, render });
        expect(el.children.length).toBe(1);
        expect(el.querySelector('[data-oja-key="b"]')).toBeNull();
    });

    it('shows empty handler when items is empty', () => {
        el = makeEl();
        const emptyEl = document.createElement('div');
        emptyEl.textContent = 'No items';
        list(el, [], {
            key:    i => i.id,
            render: i => document.createElement('div'),
            empty:  () => emptyEl,
        });
        expect(el.textContent).toBe('No items');
    });

    it('clears container when items is empty with no empty handler', () => {
        el = makeEl('<div data-oja-key="x">x</div>');
        list(el, [], { key: i => i.id, render: i => document.createElement('div') });
        expect(el.children.length).toBe(0);
    });

    it('warns when render is missing', () => {
        el = makeEl();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        list(el, [{ id: 'a' }], { key: i => i.id });
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('warns when key is missing', () => {
        el = makeEl();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        list(el, [{ id: 'a' }], { render: i => document.createElement('div') });
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});


describe('listAsync()', () => {
    let el;
    afterEach(() => cleanup(el));

    it('renders items via async render function', async () => {
        el = makeEl();
        await listAsync(el, [{ id: 'a' }, { id: 'b' }], {
            key:    item => item.id,
            render: async (item, existing) => {
                const d = existing || document.createElement('div');
                d.textContent = item.id;
                return d;
            },
        });
        expect(el.children.length).toBe(2);
    });

    it('establishes DOM order before async renders resolve', async () => {
        el = makeEl();
        const order = [];
        await listAsync(el, [{ id: 'x' }, { id: 'y' }], {
            key:    item => item.id,
            render: async (item, existing) => {
                const d = existing || document.createElement('div');
                await new Promise(r => setTimeout(r, item.id === 'x' ? 10 : 1));
                order.push(item.id);
                d.textContent = item.id;
                return d;
            },
        });
        // Both rendered despite different delays
        expect(el.children.length).toBe(2);
        // Order in DOM matches input order, not resolution order
        expect(el.children[0].getAttribute('data-oja-key')).toBe('x');
        expect(el.children[1].getAttribute('data-oja-key')).toBe('y');
    });
});


describe('useStore()', () => {
    afterEach(() => useStore(null));   // reset to lazy fallback

    it('bindings use the injected store', () => {
        const appStore = new Store('engine-app');
        useStore(appStore);
        appStore.set('x', 'injected');
        const el = makeEl('<span></span>');
        bindText(el.querySelector('span'), 'x');
        expect(el.querySelector('span').textContent).toBe('injected');
        cleanup(el);
        appStore.clearAll();
    });
});


describe('batch()', () => {
    it('resolves after the callback runs', async () => {
        let ran = false;
        await nextFrame(() => { ran = true; });
        expect(ran).toBe(true);
    });

    it('returns a Promise', () => {
        expect(nextFrame(() => {}) instanceof Promise).toBe(true);
    });
});


describe('formatters', () => {
    it('exposes formatPercent', () => expect(formatters.formatPercent(50)).toBe('50.0%'));
    it('exposes formatBytes',   () => expect(formatters.formatBytes(1024)).toBe('1.0 KB'));
    it('exposes uppercase',     () => expect(formatters.uppercase('hi')).toBe('HI'));
    it('exposes fallback',      () => expect(formatters.fallback(null, '-')).toBe('-'));
    it('is extensible',         () => {
        formatters.testFmt = v => `[${v}]`;
        expect(formatters.testFmt('x')).toBe('[x]');
        delete formatters.testFmt;
    });
});