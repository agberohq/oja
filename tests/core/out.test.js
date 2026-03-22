import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Out } from '../../src/js/core/out.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeContainer() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

function cleanup(el) {
    if (el?.parentNode) el.remove();
}

// Stub fetch so Out.component() does not hit the network
function stubFetch(html) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok:   true,
        status: 200,
        text: () => Promise.resolve(html),
    }));
}

// ─── Out.raw() ────────────────────────────────────────────────────────────────

describe('Out.raw()', () => {
    let el;
    afterEach(() => { cleanup(el); Out.clearCache(); vi.restoreAllMocks(); });

    it('sets innerHTML', async () => {
        el = makeContainer();
        await Out.raw('<p>hello</p>').render(el);
        expect(el.innerHTML).toBe('<p>hello</p>');
    });

    it('type is "raw"', () => {
        expect(Out.raw('<p/>').type).toBe('raw');
    });

    it('does not execute inline scripts (no execScripts call)', async () => {
        el = makeContainer();
        // If execScripts ran it would throw in jsdom — raw should not call it
        await expect(Out.raw('<p>safe</p>').render(el)).resolves.not.toThrow();
        expect(el.querySelector('p').textContent).toBe('safe');
    });

    it('getText() returns text content without tags', () => {
        expect(Out.raw('<strong>bold</strong>').getText()).toBe('bold');
    });
});

// ─── Out.if() ─────────────────────────────────────────────────────────────────

describe('Out.if()', () => {
    let el;
    afterEach(() => { cleanup(el); Out.clearCache(); vi.restoreAllMocks(); });

    it('throws when condition is not a function', () => {
        expect(() => Out.if(true, Out.text('a'))).toThrow('[oja/out] Out.if()');
    });

    it('type is "if"', () => {
        expect(Out.if(() => true, Out.text('a')).type).toBe('if');
    });

    it('renders thenOut when condition returns true', async () => {
        el = makeContainer();
        await Out.if(() => true, Out.text('yes'), Out.text('no')).render(el);
        expect(el.textContent).toBe('yes');
    });

    it('renders elseOut when condition returns false', async () => {
        el = makeContainer();
        await Out.if(() => false, Out.text('yes'), Out.text('no')).render(el);
        expect(el.textContent).toBe('no');
    });

    it('renders Out.empty() when condition is false and no elseOut is provided', async () => {
        el = makeContainer();
        el.textContent = 'before';
        await Out.if(() => false, Out.text('yes')).render(el);
        expect(el.innerHTML).toBe('');
    });

    it('evaluates condition at render time, not at construction time', async () => {
        el = makeContainer();
        let flag = false;
        const out = Out.if(() => flag, Out.text('on'), Out.text('off'));

        await out.render(el);
        expect(el.textContent).toBe('off');

        flag = true;
        await out.render(el);
        expect(el.textContent).toBe('on');
    });

    it('passes context to the chosen branch', async () => {
        el = makeContainer();
        let received;
        const branch = Out.fn(async (c, ctx) => { received = ctx; });
        await Out.if(() => true, branch).render(el, { user: 'ada' });
        expect(received).toMatchObject({ user: 'ada' });
    });
});

// ─── Out.promise() ────────────────────────────────────────────────────────────

describe('Out.promise()', () => {
    let el;
    afterEach(() => { cleanup(el); Out.clearCache(); vi.restoreAllMocks(); });

    it('throws when states.success is absent', () => {
        expect(() => Out.promise(Promise.resolve(), {})).toThrow('[oja/out] Out.promise()');
    });

    it('type is "promise"', () => {
        expect(Out.promise(Promise.resolve(), { success: Out.empty() }).type).toBe('promise');
    });

    it('shows loading Out while promise is pending, then success', async () => {
        el = makeContainer();
        const steps = [];

        let resolve;
        const p = new Promise(r => { resolve = r; });

        const loading = Out.fn(async (c) => { steps.push('loading'); c.textContent = 'loading'; });
        const success = Out.fn(async (c) => { steps.push('success'); c.textContent = 'done'; });

        const renderPromise = Out.promise(p, { loading, success }).render(el);
        expect(steps).toContain('loading');

        resolve('value');
        await renderPromise;
        expect(steps).toContain('success');
        expect(el.textContent).toBe('done');
    });

    it('calls success factory with resolved value when success is a function', async () => {
        el = makeContainer();
        const p = Promise.resolve({ name: 'Ada' });
        await Out.promise(p, {
            success: (user) => Out.text(user.name),
        }).render(el);
        expect(el.textContent).toBe('Ada');
    });

    it('renders error Out when promise rejects', async () => {
        el = makeContainer();
        const p = Promise.reject(new Error('boom'));
        await Out.promise(p, {
            success: Out.text('ok'),
            error:   Out.text('failed'),
        }).render(el);
        expect(el.textContent).toBe('failed');
    });

    it('calls error factory with the error when error is a function', async () => {
        el = makeContainer();
        const p = Promise.reject(new Error('network down'));
        await Out.promise(p, {
            success: Out.text('ok'),
            error:   (e) => Out.text(e.message),
        }).render(el);
        expect(el.textContent).toBe('network down');
    });

    it('renders nothing on rejection when no error Out is provided', async () => {
        el = makeContainer();
        el.textContent = 'before';
        const p = Promise.reject(new Error('err'));
        await Out.promise(p, { success: Out.text('ok') }).render(el);
        expect(el.innerHTML).toBe('');
    });

    it('passes resolved value as context when value is a plain object', async () => {
        el = makeContainer();
        const p = Promise.resolve({ role: 'admin' });
        let ctx;
        await Out.promise(p, {
            success: Out.fn(async (c, context) => { ctx = context; }),
        }).render(el);
        expect(ctx).toMatchObject({ role: 'admin' });
    });
});

// ─── Out.list() ───────────────────────────────────────────────────────────────

describe('Out.list()', () => {
    let el;
    afterEach(() => { cleanup(el); Out.clearCache(); vi.restoreAllMocks(); });

    it('throws when itemFn is not a function', () => {
        expect(() => Out.list([1, 2], 'not a fn')).toThrow('[oja/out] Out.list()');
    });

    it('type is "list"', () => {
        expect(Out.list([], () => Out.empty()).type).toBe('list');
    });

    it('renders one slot per item', async () => {
        el = makeContainer();
        await Out.list(['a', 'b', 'c'], (item) => Out.text(item)).render(el);
        const slots = el.querySelectorAll('[data-list-index]');
        expect(slots).toHaveLength(3);
        expect(slots[0].textContent).toBe('a');
        expect(slots[1].textContent).toBe('b');
        expect(slots[2].textContent).toBe('c');
    });

    it('passes item and index to itemFn', async () => {
        el = makeContainer();
        const calls = [];
        await Out.list(['x', 'y'], (item, index) => {
            calls.push({ item, index });
            return Out.empty();
        }).render(el);
        expect(calls).toEqual([{ item: 'x', index: 0 }, { item: 'y', index: 1 }]);
    });

    it('renders Out.empty() by default when items array is empty', async () => {
        el = makeContainer();
        el.textContent = 'before';
        await Out.list([], () => Out.text('item')).render(el);
        expect(el.innerHTML).toBe('');
    });

    it('renders custom empty Out when provided via options', async () => {
        el = makeContainer();
        await Out.list([], () => Out.text('item'), {
            empty: Out.text('nothing here'),
        }).render(el);
        expect(el.textContent).toBe('nothing here');
    });

    it('throws when itemFn returns a non-Out value', async () => {
        el = makeContainer();
        await expect(
            Out.list([1], () => 'not an out').render(el)
        ).rejects.toThrow('[oja/out] Out.list() itemFn must return an Out');
    });

    it('clears container before rendering', async () => {
        el = makeContainer();
        el.innerHTML = '<p>stale</p>';
        await Out.list(['a'], (item) => Out.text(item)).render(el);
        expect(el.querySelector('p')).toBeNull();
    });

    it('accepts a function as items (evaluated at render time)', async () => {
        el = makeContainer();
        let items = ['a'];
        const out = Out.list(() => items, (item) => Out.text(item));

        await out.render(el);
        expect(el.querySelectorAll('[data-list-index]')).toHaveLength(1);

        items = ['a', 'b'];
        el.innerHTML = '';
        await out.render(el);
        expect(el.querySelectorAll('[data-list-index]')).toHaveLength(2);
    });
});

// ─── Out.vfsUse / vfsGet ──────────────────────────────────────────────────────

describe('Out — vfsUse() and vfsGet()', () => {
    afterEach(() => { Out.vfsUse(null); vi.restoreAllMocks(); });

    it('vfsGet() returns null before registration', () => {
        Out.vfsUse(null);
        expect(Out.vfsGet()).toBeNull();
    });

    it('vfsUse() registers and vfsGet() returns the instance', () => {
        const fakeVfs = { readText: vi.fn() };
        Out.vfsUse(fakeVfs);
        expect(Out.vfsGet()).toBe(fakeVfs);
    });

    it('vfsUse() returns Out for chaining', () => {
        expect(Out.vfsUse(null)).toBe(Out);
    });
});

// ─── vfsOverride (instance-scoped VFS) ───────────────────────────────────────

describe('Out.component() — vfsOverride', () => {
    let el;
    afterEach(() => { cleanup(el); Out.clearCache(); Out.vfsUse(null); vi.restoreAllMocks(); });

    it('reads from the instance VFS when options.vfs is set', async () => {
        el = makeContainer();
        const vfs = {
            readText: vi.fn().mockResolvedValue('<p>from vfs</p>'),
            write:    vi.fn(),
        };
        await Out.component('page.html', {}, {}, { vfs }).render(el);
        expect(vfs.readText).toHaveBeenCalledWith('page.html');
        expect(el.querySelector('p').textContent).toBe('from vfs');
    });

    it('does not touch the global _vfs when using options.vfs', async () => {
        el = makeContainer();
        const globalVfs   = { readText: vi.fn().mockResolvedValue('<p>global</p>'), write: vi.fn() };
        const instanceVfs = { readText: vi.fn().mockResolvedValue('<p>instance</p>'), write: vi.fn() };

        Out.vfsUse(globalVfs);
        await Out.component('page.html', {}, {}, { vfs: instanceVfs }).render(el);

        expect(instanceVfs.readText).toHaveBeenCalled();
        expect(globalVfs.readText).not.toHaveBeenCalled();
        expect(el.querySelector('p').textContent).toBe('instance');
    });

    it('falls through to network when instance VFS returns null', async () => {
        el = makeContainer();
        const vfs = { readText: vi.fn().mockResolvedValue(null), write: vi.fn() };
        stubFetch('<p>network</p>');
        await Out.component('page.html', {}, {}, { vfs }).render(el);
        expect(vfs.readText).toHaveBeenCalled();
        expect(el.querySelector('p').textContent).toBe('network');
    });

    it('writes back to instance VFS after network fetch', async () => {
        el = makeContainer();
        const vfs = { readText: vi.fn().mockResolvedValue(null), write: vi.fn() };
        stubFetch('<p>fetched</p>');
        Out.clearCache('page.html');
        await Out.component('page.html', {}, {}, { vfs }).render(el);
        expect(vfs.write).toHaveBeenCalledWith('page.html', '<p>fetched</p>');
    });
});

// ─── Out.is() ─────────────────────────────────────────────────────────────────

describe('Out.is()', () => {
    it('returns true for any Out instance', () => {
        expect(Out.is(Out.text('x'))).toBe(true);
        expect(Out.is(Out.html('<p/>'))).toBe(true);
        expect(Out.is(Out.raw('<p/>'))).toBe(true);
        expect(Out.is(Out.empty())).toBe(true);
        expect(Out.is(Out.if(() => true, Out.empty()))).toBe(true);
        expect(Out.is(Out.list([], () => Out.empty()))).toBe(true);
    });

    it('returns false for non-Out values', () => {
        expect(Out.is(null)).toBe(false);
        expect(Out.is('string')).toBe(false);
        expect(Out.is({})).toBe(false);
        expect(Out.is(42)).toBe(false);
    });
});

// ─── cacheStats / clearCache ──────────────────────────────────────────────────

describe('Out — cacheStats() and clearCache()', () => {
    afterEach(() => { Out.clearCache(); vi.restoreAllMocks(); });

    it('clearCache() with no arg clears all entries', async () => {
        stubFetch('<p>x</p>');
        const el = makeContainer();
        await Out.component('a.html').render(el);
        cleanup(el);
        Out.clearCache();
        expect(Out.cacheStats().size).toBe(0);
    });

    it('clearCache(url) removes only that entry', async () => {
        stubFetch('<p>x</p>');
        const el = makeContainer();
        await Out.component('a.html').render(el);
        await Out.component('b.html').render(el);
        cleanup(el);
        Out.clearCache('a.html');
        const stats = Out.cacheStats();
        const paths = stats.entries.map(e => e.url);
        expect(paths).not.toContain('a.html');
        expect(paths).toContain('b.html');
        Out.clearCache();
    });
});

// ─── Out.to().render(out) — symmetry with el.render(out) ────────────────────

describe('Out.to().render(Out)', () => {
    let el;
    afterEach(() => { cleanup(el); });

    it('Out.to(el).render(Out.text()) renders into the target element', async () => {
        el = makeContainer();
        await Out.to(el).render(Out.text('hello'));
        expect(el.textContent).toBe('hello');
    });

    it('Out.to(selector).render(Out.text()) resolves the selector and renders', async () => {
        el = makeContainer();
        el.id = 'out-to-render-sel';
        await Out.to('#out-to-render-sel').render(Out.text('world'));
        expect(el.textContent).toBe('world');
    });

    it('Out.to().render(Out.html()) renders HTML content', async () => {
        el = makeContainer();
        await Out.to(el).render(Out.html('<strong>bold</strong>'));
        expect(el.innerHTML).toBe('<strong>bold</strong>');
    });

    it('Out.to().render() with no argument still works as the terminal await helper', async () => {
        el = makeContainer();
        const target = Out.to(el);
        target.text('settled');
        const resolved = await target.render();
        expect(resolved).toBe(el);
        expect(el.textContent).toBe('settled');
    });

    it('Out.to().render(Out) returns the OutTarget for chaining', async () => {
        el = makeContainer();
        const ret = await Out.to(el).render(Out.text('x'));
        expect(typeof ret).toBe('object');
        expect(ret).not.toBe(el);
    });
});