import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Out } from '../../src/js/core/out.js';

beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
});

function makeContainer() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

describe('Out.skeleton()', () => {

    it('injects skeleton HTML synchronously before async render resolves', async () => {
        const el = makeContainer();

        let resolveFetch;
        const p = new Promise(r => { resolveFetch = r; });

        // Mock a slow component Out using Out.fn
        const slowOut = Out.fn(async (c) => {
            await p;
            c.innerHTML = '<p>Loaded!</p>';
        });

        // Start render
        const renderPromise = Out.skeleton(el, 'card', { lines: 2 }).render(slowOut);

        // Synchronous check — skeleton should be injected immediately
        expect(el.innerHTML).toContain('oja-skeleton-wrapper');
        expect(el.innerHTML).toContain('oja-skel-avatar');
        expect(el.querySelectorAll('.oja-skel-line').length).toBe(3); // 1 title helper + 2 lines

        // Resolve fetch and await completion
        resolveFetch();
        await renderPromise;

        // Skeleton should be gone, replaced by content
        expect(el.innerHTML).toBe('<p>Loaded!</p>');
    });

    it('supports chained syntax', () => {
        const el = makeContainer();
        const target = Out.skeleton(el, 'table');
        expect(target).toHaveProperty('html');
        expect(target).toHaveProperty('component');
    });

});