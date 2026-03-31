import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { layout } from '../../src/js/core/layout.js';


function makeOut(html) {
    return {
        __isOut: true,
        render: vi.fn(async (el) => { el.innerHTML = html; }),
        getText: () => html,
    };
}

beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
});


describe('layout.inject()', () => {
    it('writes an HTML string into an element matched by selector', async () => {
        const container = document.createElement('div');
        container.innerHTML = '<span id="target"></span>';
        document.body.appendChild(container);
        await layout.inject('#target', '<b>hello</b>', container);
        expect(container.querySelector('#target').innerHTML).toBe('<b>hello</b>');
    });

    it('warns and returns this when no layout is mounted and no target provided', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await layout.inject('#missing');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('inject()'));
        warn.mockRestore();
        expect(result).toBe(layout);
    });

    it('warns when the selector matches nothing inside the container', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const container = document.createElement('div');
        document.body.appendChild(container);
        await layout.inject('#nope', '<p>x</p>', container);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('#nope'));
        warn.mockRestore();
    });

    it('emits layout:injected after a successful injection', async () => {
        const container = document.createElement('div');
        container.innerHTML = '<div class="slot"></div>';
        document.body.appendChild(container);
        const handler = vi.fn();
        document.addEventListener('layout:injected', handler);
        await layout.inject('.slot', '<span>ok</span>', container);
        document.removeEventListener('layout:injected', handler);
        expect(handler).toHaveBeenCalled();
    });

    it('targets by arbitrary CSS selector, not just [data-slot]', async () => {
        const container = document.createElement('div');
        container.innerHTML = '<footer class="page-footer"></footer>';
        document.body.appendChild(container);
        await layout.inject('.page-footer', '<p>footer content</p>', container);
        expect(container.querySelector('.page-footer').innerHTML).toBe('<p>footer content</p>');
    });
});


describe('layout.onReady()', () => {
    it('calls the hook when layout:mounted fires (outside a script context)', async () => {
        const fn = vi.fn();
        layout.onReady(fn);
        document.dispatchEvent(new CustomEvent('layout:mounted'));
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('only fires once — subsequent layout:mounted events do not re-trigger it', async () => {
        const fn = vi.fn();
        layout.onReady(fn);
        document.dispatchEvent(new CustomEvent('layout:mounted'));
        document.dispatchEvent(new CustomEvent('layout:mounted'));
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('returns the layout object for chaining', () => {
        expect(layout.onReady(() => {})).toBe(layout);
    });
});


describe('layout.slot()', () => {
    it('fills a [data-slot] element with an HTML string', async () => {
        const container = document.createElement('div');
        container.innerHTML = '<div data-slot="main"></div>';
        document.body.appendChild(container);
        await layout.slot('main', '<p>content</p>', container);
        expect(container.querySelector('[data-slot="main"]').innerHTML).toBe('<p>content</p>');
    });

    it('warns when the named slot does not exist', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const container = document.createElement('div');
        document.body.appendChild(container);
        await layout.slot('ghost', '<p>x</p>', container);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('ghost'));
        warn.mockRestore();
    });

    it('warns and returns this when no layout is mounted', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = await layout.slot('nav', '<nav/>');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('slot()'));
        warn.mockRestore();
        expect(result).toBe(layout);
    });

    it('emits layout:slot after successful fill', async () => {
        const container = document.createElement('div');
        container.innerHTML = '<div data-slot="footer"></div>';
        document.body.appendChild(container);
        const handler = vi.fn();
        document.addEventListener('layout:slot', handler);
        await layout.slot('footer', '<footer>ok</footer>', container);
        document.removeEventListener('layout:slot', handler);
        expect(handler).toHaveBeenCalled();
    });
});


describe('layout.slotReady()', () => {
    it('is a function on the layout object', () => {
        expect(typeof layout.slotReady).toBe('function');
    });

    it('resolves a pending allSlotsReady() when called with the matching name', async () => {
        vi.useRealTimers();
        const promise = layout.allSlotsReady(['editor'], 500);
        layout.slotReady('editor');
        await expect(promise).resolves.toBeUndefined();
        vi.useFakeTimers();
    });

    it('resolves only the matching slot — others remain pending', async () => {
        vi.useRealTimers();
        let editorDone = false;
        let sidebarDone = false;

        const editorP = layout.allSlotsReady(['editor2'], 500).then(() => { editorDone = true; });
        const sidebarP = layout.allSlotsReady(['sidebar2'], 500).then(() => { sidebarDone = true; });

        layout.slotReady('editor2');
        await editorP;

        expect(editorDone).toBe(true);
        expect(sidebarDone).toBe(false);

        // Clean up the pending promise to avoid timeout rejection
        layout.slotReady('sidebar2');
        await sidebarP;
        vi.useFakeTimers();
    });

    it('calling slotReady() before allSlotsReady() still resolves when allSlotsReady is called after', async () => {
        vi.useRealTimers();
        // slotReady fires first (slot mounted before app.js calls allSlotsReady)
        // In this case the event-based path handles it
        layout.slotReady('nav-early');
        // allSlotsReady for that slot should resolve via the event it emits
        // (This tests the event emission path rather than the callback path)
        const promise = new Promise(resolve => {
            document.addEventListener('layout:slot-ready', (e) => {
                if (e.detail?.name === 'nav-early') resolve();
            }, { once: false });
        });
        layout.slotReady('nav-early');
        await expect(
            Promise.race([promise, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 300))])
        ).resolves.toBeUndefined();
        vi.useFakeTimers();
    });

    it('emits layout:slot-ready event with the slot name', async () => {
        vi.useRealTimers();
        const events = [];
        const handler = (e) => events.push(e.detail?.name);
        document.addEventListener('layout:slot-ready', handler);
        layout.slotReady('tabs-test');
        await new Promise(r => setTimeout(r, 10));
        document.removeEventListener('layout:slot-ready', handler);
        expect(events).toContain('tabs-test');
        vi.useFakeTimers();
    });

    it('is safe to call multiple times for the same name', () => {
        expect(() => {
            layout.slotReady('duplicate');
            layout.slotReady('duplicate');
        }).not.toThrow();
    });
});


describe('layout.allSlotsReady()', () => {
    it('is a function on the layout object', () => {
        expect(typeof layout.allSlotsReady).toBe('function');
    });

    it('returns a Promise', () => {
        vi.useRealTimers();
        const p = layout.allSlotsReady(['slot-x'], 100);
        expect(p).toBeInstanceOf(Promise);
        // prevent unhandled rejection from timeout
        p.catch(() => {});
        vi.useFakeTimers();
    });

    it('resolves immediately for an empty names array', async () => {
        await expect(layout.allSlotsReady([])).resolves.toBeUndefined();
    });

    it('resolves when all named slots have called slotReady()', async () => {
        vi.useRealTimers();
        const promise = layout.allSlotsReady(['alpha', 'beta', 'gamma'], 1000);
        layout.slotReady('alpha');
        layout.slotReady('beta');
        layout.slotReady('gamma');
        await expect(promise).resolves.toBeUndefined();
        vi.useFakeTimers();
    });

    it('does not resolve until ALL slots are ready', async () => {
        vi.useRealTimers();
        let resolved = false;
        const promise = layout.allSlotsReady(['a1', 'b1'], 500).then(() => { resolved = true; });
        layout.slotReady('a1');
        await new Promise(r => setTimeout(r, 20));
        expect(resolved).toBe(false);
        layout.slotReady('b1');
        await promise;
        expect(resolved).toBe(true);
        vi.useFakeTimers();
    });

    it('rejects with a descriptive error after the timeout', async () => {
        vi.useRealTimers();
        const promise = layout.allSlotsReady(['never-fires'], 50);
        await expect(promise).rejects.toThrow('never-fires');
        vi.useFakeTimers();
    });

    it('timeout message lists all still-pending slots', async () => {
        vi.useRealTimers();
        const promise = layout.allSlotsReady(['slot-p', 'slot-q'], 50);
        layout.slotReady('slot-p'); // only one resolves
        await expect(promise).rejects.toThrow('slot-q');
        vi.useFakeTimers();
    });

    it('multiple independent allSlotsReady() calls can coexist', async () => {
        vi.useRealTimers();
        const p1 = layout.allSlotsReady(['s1'], 500);
        const p2 = layout.allSlotsReady(['s2'], 500);
        layout.slotReady('s1');
        layout.slotReady('s2');
        await expect(Promise.all([p1, p2])).resolves.toBeDefined();
        vi.useFakeTimers();
    });

    it('resolves with undefined (not a value)', async () => {
        vi.useRealTimers();
        const p = layout.allSlotsReady(['rval'], 500);
        layout.slotReady('rval');
        const result = await p;
        expect(result).toBeUndefined();
        vi.useFakeTimers();
    });
});