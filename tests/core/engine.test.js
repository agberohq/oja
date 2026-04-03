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

    it('fires onNodeAdded for inserted nodes', async () => {
        el = makeEl('');
        const added = [];
        await morph(el, '<span>x</span>', { onNodeAdded: n => added.push(n) });
        expect(added.length).toBeGreaterThan(0);
    });

    it('fires onNodeRemoved before removing nodes', async () => {
        el = makeEl('<span>old</span>');
        const removed = [];
        await morph(el, '', { onNodeRemoved: n => removed.push(n) });
        expect(removed.length).toBeGreaterThan(0);
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

    // ── Lifecycle callbacks ──────────────────────────────────────────────────

    it('onMount fires once on first render', () => {
        el = makeEl();
        const onMount = vi.fn();
        const render  = () => document.createElement('div');
        list(el, [{ id: 'a' }], { key: i => i.id, render, onMount });
        expect(onMount).toHaveBeenCalledTimes(1);
        expect(onMount).toHaveBeenCalledWith(el);
    });

    it('onMount does NOT fire on subsequent re-renders', () => {
        el = makeEl();
        const onMount = vi.fn();
        const render  = (item, existing) => existing || document.createElement('div');
        list(el, [{ id: 'a' }], { key: i => i.id, render, onMount });
        list(el, [{ id: 'a' }, { id: 'b' }], { key: i => i.id, render, onMount });
        list(el, [{ id: 'a' }], { key: i => i.id, render, onMount });
        expect(onMount).toHaveBeenCalledTimes(1);
    });

    it('onMount fires once even when initial items list is empty', () => {
        el = makeEl();
        const onMount = vi.fn();
        const render  = () => document.createElement('div');
        list(el, [], { key: i => i.id, render, onMount });
        expect(onMount).toHaveBeenCalledTimes(1);
        // second call — still once total
        list(el, [{ id: 'a' }], { key: i => i.id, render, onMount });
        expect(onMount).toHaveBeenCalledTimes(1);
    });

    it('onMount receives the container element', () => {
        el = makeEl();
        let received = null;
        const render = () => document.createElement('div');
        list(el, [{ id: 'a' }], {
            key: i => i.id, render,
            onMount: (container) => { received = container; },
        });
        expect(received).toBe(el);
    });

    it('onItemMount fires for each new item on first render', () => {
        el = makeEl();
        const mounted = [];
        const render  = (item) => {
            const d = document.createElement('div');
            d.textContent = item.id;
            return d;
        };
        list(el, [{ id: 'a' }, { id: 'b' }], {
            key: i => i.id, render,
            onItemMount: (itemEl, data, idx) => mounted.push({ data, idx }),
        });
        expect(mounted).toHaveLength(2);
        expect(mounted[0].data.id).toBe('a');
        expect(mounted[0].idx).toBe(0);
        expect(mounted[1].data.id).toBe('b');
        expect(mounted[1].idx).toBe(1);
    });

    it('onItemMount fires ONLY for new items, not for updated existing items', () => {
        el = makeEl();
        const mounted = [];
        const render  = (item, existing) => {
            const d = existing || document.createElement('div');
            d.textContent = item.id;
            return d;
        };
        // First render — creates 'a' and 'b'
        list(el, [{ id: 'a' }, { id: 'b' }], {
            key: i => i.id, render,
            onItemMount: (itemEl, data) => mounted.push(data.id),
        });
        expect(mounted).toEqual(['a', 'b']);

        // Second render — 'a' and 'b' exist, 'c' is new
        list(el, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], {
            key: i => i.id, render,
            onItemMount: (itemEl, data) => mounted.push(data.id),
        });
        // Only 'c' should be added — 'a' and 'b' were reused
        expect(mounted).toEqual(['a', 'b', 'c']);
    });

    it('onItemRemove fires before removed items are deleted', () => {
        el = makeEl();
        const removed = [];
        const render  = (item, existing) => {
            const d = existing || document.createElement('div');
            d.dataset.id = item.id;
            return d;
        };
        list(el, [{ id: 'a' }, { id: 'b' }], { key: i => i.id, render });
        list(el, [{ id: 'a' }], {
            key: i => i.id, render,
            onItemRemove: (itemEl) => removed.push(itemEl.dataset.id),
        });
        expect(removed).toEqual(['b']);
        // Element is removed from DOM after onItemRemove fires
        expect(el.querySelector('[data-oja-key="b"]')).toBeNull();
    });

    it('onItemRemove fires for all removed items when list is cleared', () => {
        el = makeEl();
        const removed = [];
        const render  = (item, existing) => {
            const d = existing || document.createElement('div');
            d.dataset.id = item.id;
            return d;
        };
        list(el, [{ id: 'x' }, { id: 'y' }, { id: 'z' }], { key: i => i.id, render });
        list(el, [], {
            key: i => i.id, render,
            onItemRemove: (itemEl) => removed.push(itemEl.dataset.id),
        });
        // With empty items, innerHTML is cleared directly — onItemRemove fires
        // for items tracked in existing map
        expect(el.children.length).toBe(0);
    });

    it('all three callbacks can be used together', () => {
        el = makeEl();
        const log1 = [];
        const log2 = [];
        const render = (item, existing) => {
            const d = existing || document.createElement('div');
            d.dataset.id = item.id;
            return d;
        };

        list(el, [{ id: 'a' }, { id: 'b' }], {
            key: i => i.id, render,
            onMount:      ()      => log1.push('mount'),
            onItemMount:  (el, d) => log1.push(`item:${d.id}`),
            onItemRemove: (el)    => log1.push(`remove:${el.dataset.id}`),
        });
        // First render: 'a' and 'b' new, onMount fires after items
        expect(log1).toEqual(['item:a', 'item:b', 'mount']);

        list(el, [{ id: 'b' }, { id: 'c' }], {
            key: i => i.id, render,
            onMount:      ()      => log2.push('mount'),
            onItemMount:  (el, d) => log2.push(`item:${d.id}`),
            onItemRemove: (el)    => log2.push(`remove:${el.dataset.id}`),
        });
        // Second render: 'a' removed, 'b' reused (not new), 'c' new, onMount NOT fired again
        expect(log2).toContain('remove:a');
        expect(log2).toContain('item:c');
        expect(log2).not.toContain('mount');       // onMount only fires once (first render)
        expect(log2).not.toContain('item:b');       // 'b' was reused, not new
        expect(log2).not.toContain('remove:b');     // 'b' was kept, not removed
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
        expect(el.children.length).toBe(2);
        expect(el.children[0].getAttribute('data-oja-key')).toBe('x');
        expect(el.children[1].getAttribute('data-oja-key')).toBe('y');
    });

    it('onMount fires once after async renders complete', async () => {
        el = makeEl();
        const onMount = vi.fn();
        const render  = async (item, existing) => existing || document.createElement('div');
        await listAsync(el, [{ id: 'a' }], { key: i => i.id, render, onMount });
        expect(onMount).toHaveBeenCalledTimes(1);
        await listAsync(el, [{ id: 'a' }, { id: 'b' }], { key: i => i.id, render, onMount });
        expect(onMount).toHaveBeenCalledTimes(1); // still once
    });

    it('onItemMount fires only for new slots in listAsync', async () => {
        el = makeEl();
        const mounted = [];
        const render  = async (item, existing) => {
            const d = existing || document.createElement('div');
            d.textContent = item.id;
            return d;
        };
        await listAsync(el, [{ id: 'a' }, { id: 'b' }], {
            key: i => i.id, render,
            onItemMount: (itemEl, data) => mounted.push(data.id),
        });
        expect(mounted).toEqual(['a', 'b']);

        await listAsync(el, [{ id: 'a' }, { id: 'c' }], {
            key: i => i.id, render,
            onItemMount: (itemEl, data) => mounted.push(data.id),
        });
        expect(mounted).toEqual(['a', 'b', 'c']); // 'a' reused, 'c' new
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


describe('bindText()', () => {
    let el;
    afterEach(() => cleanup(el));

    it('sets textContent from store', () => {
        el = makeEl('<span id="t"></span>');
        const span = el.querySelector('#t');
        const store = new Store('bt-test');
        useStore(store);
        store.set('msg', 'hello');
        bindText(span, 'msg');
        expect(span.textContent).toBe('hello');
        store.clearAll();
        useStore(null);
    });

    it('warns when selector not found', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        bindText('#not-found', 'key');
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
        useStore(null);
    });
});


describe('bindToggle()', () => {
    let el;
    afterEach(() => cleanup(el));

    it('adds activeClass when store value is truthy', () => {
        el = makeEl('<div id="b"></div>');
        const div   = el.querySelector('#b');
        const store = new Store('toggle-test');
        useStore(store);
        store.set('on', true);
        bindToggle(div, 'on', { activeClass: 'is-on' });
        expect(div.className).toBe('is-on');
        store.clearAll();
        useStore(null);
    });
});
