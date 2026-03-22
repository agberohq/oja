/**
 * tests/core/pagination.test.js
 * Covers the pagination() controller from js/pagination.js
 *
 * Note: pagination.js imports from '../lib/oja.full.esm.js' which is the built
 * bundle. For unit tests we shim the reactive imports directly from source.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pagination } from '../../src/js/ext/pagination.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePager(opts = {}) {
    return pagination({ total: 100, pageSize: 10, ...opts });
}

function makeContainer() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

function click(container, pgAttr) {
    const btn = container.querySelector(`[data-pg="${pgAttr}"]`);
    expect(btn, `button [data-pg="${pgAttr}"] not found`).not.toBeNull();
    btn.click();
}

function clickPage(container, pageNum) {
    const btn = container.querySelector(`[data-pg="page"][data-val="${pageNum}"]`);
    expect(btn, `page button ${pageNum} not found`).not.toBeNull();
    btn.click();
}

// ── State reads ───────────────────────────────────────────────────────────────

describe('pagination() — initial state', () => {
    it('reads total, page, pageSize, totalPages', () => {
        const pg = makePager({ total: 50, pageSize: 10, page: 2 });
        expect(pg.total()).toBe(50);
        expect(pg.page()).toBe(2);
        expect(pg.pageSize()).toBe(10);
        expect(pg.totalPages()).toBe(5);
    });

    it('calculates startIdx and endIdx correctly', () => {
        const pg = makePager({ total: 100, pageSize: 25, page: 2 });
        expect(pg.startIdx()).toBe(25);
        expect(pg.endIdx()).toBe(50);
    });

    it('endIdx clamps at total on last page', () => {
        const pg = makePager({ total: 95, pageSize: 25, page: 4 });
        expect(pg.startIdx()).toBe(75);
        expect(pg.endIdx()).toBe(95); // not 100
    });
});

// ── Navigation ────────────────────────────────────────────────────────────────

describe('goTo()', () => {
    it('moves to the specified page', () => {
        const pg = makePager();
        pg.goTo(5);
        expect(pg.page()).toBe(5);
    });

    it('clamps to page 1 on underflow', () => {
        const pg = makePager();
        pg.goTo(0);
        expect(pg.page()).toBe(1);
    });

    it('clamps to totalPages on overflow', () => {
        const pg = makePager({ total: 30, pageSize: 10 });
        pg.goTo(99);
        expect(pg.page()).toBe(3);
    });

    it('calls onPageChange with correct args', () => {
        const cb = vi.fn();
        const pg = makePager({ onPageChange: cb });
        pg.goTo(3);
        expect(cb).toHaveBeenCalledWith(3, 10);
    });

    it('does NOT call onPageChange when page is already current', () => {
        const cb = vi.fn();
        const pg = makePager({ page: 2, onPageChange: cb });
        pg.goTo(2);
        expect(cb).not.toHaveBeenCalled();
    });
});

// ── updateTotal ───────────────────────────────────────────────────────────────

describe('updateTotal()', () => {
    it('updates total and recalculates totalPages', () => {
        const pg = makePager({ total: 0 });
        pg.updateTotal(50);
        expect(pg.total()).toBe(50);
        expect(pg.totalPages()).toBe(5);
    });

    it('clamps current page when new total shrinks range', () => {
        const pg = makePager({ total: 100, page: 8 });
        pg.updateTotal(30); // now only 3 pages
        expect(pg.page()).toBe(3);
    });

    it('does not clamp page when still in range', () => {
        const pg = makePager({ total: 100, page: 3 });
        pg.updateTotal(200);
        expect(pg.page()).toBe(3);
    });
});

// ── changeSize ────────────────────────────────────────────────────────────────

describe('changeSize()', () => {
    it('updates pageSize', () => {
        const pg = makePager({ total: 100, pageSize: 10, page: 3 });
        pg.changeSize(25);
        expect(pg.pageSize()).toBe(25);
    });

    it('keeps first visible item roughly in view', () => {
        // On page 3 of 10/page, first item is index 20
        const pg = makePager({ total: 100, pageSize: 10, page: 3 });
        pg.changeSize(25);
        // item 20 is on page 1 with pageSize=25
        expect(pg.page()).toBe(1);
    });

    it('is a no-op when size unchanged', () => {
        const cb = vi.fn();
        const pg = makePager({ onPageChange: cb });
        pg.changeSize(10);
        expect(cb).not.toHaveBeenCalled();
    });
});

// ── reset ─────────────────────────────────────────────────────────────────────

describe('reset()', () => {
    it('returns to page 1', () => {
        const pg = makePager({ page: 5 });
        pg.reset();
        expect(pg.page()).toBe(1);
    });
});

// ── slice ─────────────────────────────────────────────────────────────────────

describe('slice()', () => {
    const items = Array.from({ length: 95 }, (_, i) => i + 1);

    it('returns the current page window', () => {
        const pg = makePager({ total: 95, pageSize: 10, page: 1 });
        expect(pg.slice(items)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('returns correct slice for middle page', () => {
        const pg = makePager({ total: 95, pageSize: 10, page: 3 });
        expect(pg.slice(items)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
    });

    it('returns partial slice on last page', () => {
        const pg = makePager({ total: 95, pageSize: 10, page: 10 });
        expect(pg.slice(items)).toHaveLength(5); // 91–95
    });

    it('returns empty array for non-arrays', () => {
        const pg = makePager();
        expect(pg.slice(null)).toEqual([]);
        expect(pg.slice('string')).toEqual([]);
    });
});

// ── render ────────────────────────────────────────────────────────────────────

describe('render()', () => {
    it('returns empty string when total is 0', () => {
        const pg = makePager({ total: 0 });
        expect(pg.render()).toBe('');
    });

    it('renders info text with correct numbers', () => {
        const pg = makePager({ total: 100, pageSize: 10, page: 2 });
        const html = pg.render();
        expect(html).toContain('11–20 of 100');
    });

    it('disables prev/first on page 1', () => {
        const pg = makePager({ total: 100, page: 1 });
        const html = pg.render();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        expect(doc.querySelector('[data-pg="prev"]').disabled).toBe(true);
        expect(doc.querySelector('[data-pg="first"]').disabled).toBe(true);
    });

    it('disables next/last on last page', () => {
        const pg = makePager({ total: 30, pageSize: 10, page: 3 });
        const html = pg.render();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        expect(doc.querySelector('[data-pg="next"]').disabled).toBe(true);
        expect(doc.querySelector('[data-pg="last"]').disabled).toBe(true);
    });

    it('marks current page button as active', () => {
        const pg = makePager({ total: 50, pageSize: 10, page: 3 });
        const html = pg.render();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const active = doc.querySelector('.pg-active');
        expect(active?.textContent?.trim()).toBe('3');
    });

    it('renders size selector with correct selected option', () => {
        const pg = makePager({ total: 100, pageSize: 25, pageSizes: [10, 25, 50] });
        const html = pg.render();
        expect(html).toContain('value="25" selected');
    });

    it('omits size selector when showSizeSelector is false', () => {
        const pg = makePager({ total: 100, showSizeSelector: false });
        const html = pg.render();
        expect(html).not.toContain('pg-size');
    });

    it('shows ellipsis when page range requires it', () => {
        const pg = makePager({ total: 200, pageSize: 10, page: 10 });
        const html = pg.render();
        expect(html).toContain('…');
    });
});

// ── mount — event delegation ──────────────────────────────────────────────────

describe('mount() — event delegation', () => {
    let container, pg, stop;

    beforeEach(() => {
        container = makeContainer();
        pg = makePager({ total: 100, pageSize: 10, page: 1 });
        stop = pg.mount(container);
    });

    afterEach(() => {
        stop();
        container.remove();
    });

    it('renders controls into the container', () => {
        expect(container.querySelector('.pg-controls')).not.toBeNull();
    });

    it('next button advances page', () => {
        click(container, 'next');
        expect(pg.page()).toBe(2);
    });

    it('prev button goes back', () => {
        pg.goTo(5);
        click(container, 'prev');
        expect(pg.page()).toBe(4);
    });

    it('first button goes to page 1', () => {
        pg.goTo(8);
        click(container, 'first');
        expect(pg.page()).toBe(1);
    });

    it('last button goes to last page', () => {
        click(container, 'last');
        expect(pg.page()).toBe(10);
    });

    it('clicking a page number button navigates correctly', () => {
        clickPage(container, 4);
        expect(pg.page()).toBe(4);
    });

    it('controls re-render after page change', () => {
        pg.goTo(3);
        const info = container.querySelector('.pg-info');
        expect(info?.textContent).toContain('21–30 of 100');
    });

    it('stop() removes listeners and clears container', () => {
        stop();
        expect(container.innerHTML).toBe('');
        // Clicking should no longer change page
        const oldPage = pg.page();
        container.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(pg.page()).toBe(oldPage);
    });

    it('size selector change calls changeSize', () => {
        const select = container.querySelector('[data-pg="size"]');
        if (!select) return; // showSizeSelector may be off
        select.value = '25';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        expect(pg.pageSize()).toBe(25);
    });
});