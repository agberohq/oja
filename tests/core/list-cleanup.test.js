import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { list, listAsync } from '../../src/js/core/engine.js';

const row = (text) => {
    const el = document.createElement('div');
    el.textContent = text;
    return el;
};

beforeEach(() => {
    document.body.innerHTML = '';
});

afterEach(() => {
    delete globalThis.__OJA_DEV__;
    vi.restoreAllMocks();
});

describe('engine.list() — unkeyed children', () => {
    it('removes an unkeyed loading/empty child when rows arrive', () => {
        const parent = document.createElement('div');
        parent.innerHTML = '<p class="loading">Loading…</p>';
        document.body.appendChild(parent);

        list(parent, [{ id: 1, name: 'a' }], {
            key: x => x.id,
            render: x => row(x.name),
        });

        expect(parent.querySelector('.loading')).toBeNull();
        expect(parent.textContent).toBe('a');
    });

    it('removes a keyed empty state when rows arrive', () => {
        const parent = document.createElement('div');
        parent.innerHTML = '<p data-oja-key="__empty">Nothing yet</p>';
        document.body.appendChild(parent);

        list(parent, [{ id: 1 }], {
            key: x => x.id,
            render: () => row('row'),
        });

        expect(parent.querySelector('[data-oja-key="__empty"]')).toBeNull();
        expect(parent.textContent).toBe('row');
    });

    it('warns in dev mode and still removes the unkeyed child', () => {
        globalThis.__OJA_DEV__ = true;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const parent = document.createElement('div');
        parent.innerHTML = '<p>Loading…</p>';
        document.body.appendChild(parent);

        list(parent, [{ id: 1 }], {
            key: x => x.id,
            render: () => row('row'),
        });

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('unkeyed child'));
        expect(parent.textContent).toBe('row');
    });

    it('does not warn when every child is keyed', () => {
        globalThis.__OJA_DEV__ = true;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const parent = document.createElement('div');
        document.body.appendChild(parent);

        list(parent, [{ id: 1 }], {
            key: x => x.id,
            render: x => {
                const el = row('row');
                el.setAttribute('data-oja-key', String(x.id));
                return el;
            },
        });

        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('unkeyed child'));
    });
});

describe('engine.listAsync() — unkeyed children', () => {
    it('removes unkeyed children as well', async () => {
        const parent = document.createElement('div');
        parent.innerHTML = '<p>Loading…</p>';
        document.body.appendChild(parent);

        await listAsync(parent, [{ id: 1 }], {
            key: x => x.id,
            render: async () => row('row'),
        });

        expect(parent.textContent).toBe('row');
    });
});
