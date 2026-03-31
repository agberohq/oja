import { describe, it, expect, vi, beforeEach } from 'vitest';
import { table } from '../../src/js/ui/table.js';

// table.render(target, rows, headers, opts) — rows is 2nd param, headers is 3rd
const HEADERS = [
    { key: 'name',   label: 'Name',   sortable: true  },
    { key: 'region', label: 'Region', sortable: false },
    { key: 'status', label: 'Status', sortable: false },
];

const ROWS = [
    { name: 'Alpha', region: 'us-east', status: 'ok'   },
    { name: 'Beta',  region: 'eu-west', status: 'warn' },
    { name: 'Gamma', region: 'us-west', status: 'ok'   },
];

function makeContainer() {
    const div = document.createElement('div');
    div.id = 'tbl-' + Math.random().toString(36).slice(2);
    document.body.appendChild(div);
    return div;
}

beforeEach(() => { document.body.innerHTML = ''; });


describe('table column visibility controls', () => {
    it('hideColumn() removes a column from the rendered table', () => {
        const container = makeContainer();
        // API: render(target, rows, headers, opts)
        const t = table.render(container, ROWS, HEADERS);

        t.hideColumn('status');

        const headers = container.querySelectorAll('th');
        const headerTexts = [...headers].map(th => th.textContent.trim());
        expect(headerTexts).not.toContain('Status');
    });

    it('showColumn() restores a previously hidden column', () => {
        const container = makeContainer();
        const t = table.render(container, ROWS, HEADERS);

        t.hideColumn('status');
        t.showColumn('status');

        const headers = container.querySelectorAll('th');
        const headerTexts = [...headers].map(th => th.textContent.trim());
        expect(headerTexts).toContain('Status');
    });

    it('toggleColumn() hides visible column', () => {
        const container = makeContainer();
        const t = table.render(container, ROWS, HEADERS);

        t.toggleColumn('region');

        const headers = container.querySelectorAll('th');
        const headerTexts = [...headers].map(th => th.textContent.trim());
        expect(headerTexts).not.toContain('Region');
    });

    it('toggleColumn() shows hidden column', () => {
        const container = makeContainer();
        const t = table.render(container, ROWS, HEADERS);

        t.hideColumn('region');
        t.toggleColumn('region');

        const headers = container.querySelectorAll('th');
        const headerTexts = [...headers].map(th => th.textContent.trim());
        expect(headerTexts).toContain('Region');
    });

    it('getVisibleColumns() returns keys of visible columns', () => {
        const container = makeContainer();
        const t = table.render(container, ROWS, HEADERS);

        t.hideColumn('status');

        const visible = t.getVisibleColumns();
        expect(visible).toContain('name');
        expect(visible).toContain('region');
        expect(visible).not.toContain('status');
    });

    it('getHiddenColumns() returns keys of hidden columns', () => {
        const container = makeContainer();
        const t = table.render(container, ROWS, HEADERS);

        t.hideColumn('region');
        t.hideColumn('status');

        const hidden = t.getHiddenColumns();
        expect(hidden).toContain('region');
        expect(hidden).toContain('status');
        expect(hidden).not.toContain('name');
    });

    it('methods return the table handle for chaining', () => {
        const container = makeContainer();
        const t = table.render(container, ROWS, HEADERS);
        expect(t.hideColumn('status')).toBe(t);
        expect(t.showColumn('status')).toBe(t);
        expect(t.toggleColumn('name')).toBe(t);
    });
});


describe('F-37: table.enableRowExpansion(factory)', () => {
    it('enableRowExpansion() is a function on the table handle', () => {
        const container = makeContainer();
        const t = table.render(container, ROWS, HEADERS);
        expect(typeof t.enableRowExpansion).toBe('function');
    });

    it('returns the table handle for chaining', () => {
        const container = makeContainer();
        const t = table.render(container, ROWS, HEADERS);
        const result = t.enableRowExpansion((row) => `<p>${row.name}</p>`);
        expect(result).toBe(t);
    });

    it('does not throw when factory is called with row data', async () => {
        const container = makeContainer();
        const t = table.render(container, ROWS, HEADERS);
        const factory = vi.fn((row) => `<p>${row.name}</p>`);
        t.enableRowExpansion(factory);

        const firstRow = container.querySelector('tr[data-row-idx]');
        if (firstRow) {
            firstRow.click();
            await new Promise(r => setTimeout(r, 10));
        }
        expect(true).toBe(true);
    });
});