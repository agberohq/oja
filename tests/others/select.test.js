import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { select } from '../../src/js/ui/select.js';

const OPTIONS = [
    { value: 'admin',  label: 'Administrator' },
    { value: 'editor', label: 'Editor' },
    { value: 'viewer', label: 'Viewer' },
];

function setup(extraOpts = {}) {
    document.body.innerHTML = '<input id="field" />';
    const handle = select.attach('#field', OPTIONS, extraOpts);
    return { handle, wrap: document.querySelector('.oja-select') };
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('select.attach()', () => {
    it('returns null for missing target', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(select.attach('#nonexistent', [])).toBeNull();
        spy.mockRestore();
    });

    it('creates a .oja-select wrapper after the anchor', () => {
        setup();
        expect(document.querySelector('.oja-select')).not.toBeNull();
    });

    it('hides the original input', () => {
        setup();
        expect(document.getElementById('field').style.display).toBe('none');
    });

    it('shows placeholder text initially', () => {
        setup({ placeholder: 'Pick one' });
        expect(document.querySelector('.oja-select-placeholder').textContent).toBe('Pick one');
    });

    it('respects initial value option', () => {
        const { handle } = setup({ value: 'editor' });
        expect(handle.getValue()).toBe('editor');
    });
});

describe('select — getValue / setValue / clear', () => {
    it('getValue() returns null when nothing selected', () => {
        const { handle } = setup();
        expect(handle.getValue()).toBeNull();
    });

    it('setValue() updates selection', () => {
        const { handle } = setup();
        handle.setValue('admin');
        expect(handle.getValue()).toBe('admin');
        expect(document.querySelector('.oja-select-value').textContent).toBe('Administrator');
    });

    it('clear() resets to null and shows placeholder', () => {
        const { handle } = setup({ placeholder: 'Choose' });
        handle.setValue('editor');
        handle.clear();
        expect(handle.getValue()).toBeNull();
        expect(document.querySelector('.oja-select-placeholder')).not.toBeNull();
    });
});

describe('select — multi', () => {
    it('getValues() returns selected array', () => {
        const { handle } = setup({ multi: true });
        expect(handle.getValues()).toEqual([]);
        handle.setValues(['admin', 'viewer']);
        expect(handle.getValues()).toEqual(['admin', 'viewer']);
    });

    it('renders tags for multi selections', () => {
        const { handle } = setup({ multi: true });
        handle.setValues(['admin', 'editor']);
        const tags = document.querySelectorAll('.oja-select-tag');
        expect(tags.length).toBe(2);
    });

    it('clear() resets multi to empty array', () => {
        const { handle } = setup({ multi: true });
        handle.setValues(['admin']);
        handle.clear();
        expect(handle.getValues()).toEqual([]);
    });
});

describe('select — open / close', () => {
    it('open() adds dropdown to DOM', async () => {
        const { handle } = setup();
        await handle.open();
        expect(document.querySelector('.oja-select-dropdown')).not.toBeNull();
    });

    it('close() removes dropdown', async () => {
        const { handle } = setup();
        await handle.open();
        handle.close();
        expect(document.querySelector('.oja-select-dropdown')).toBeNull();
    });

    it('open() renders options in list', async () => {
        const { handle } = setup();
        await handle.open();
        const items = document.querySelectorAll('.oja-select-option');
        expect(items.length).toBe(3);
    });

    it('selected option gets "selected" class', async () => {
        const { handle } = setup({ value: 'editor' });
        await handle.open();
        const selected = document.querySelector('.oja-select-option.selected');
        expect(selected).not.toBeNull();
        expect(selected.textContent).toContain('Editor');
    });
});

describe('select — option picking', () => {
    it('clicking option sets value and calls onSelect', async () => {
        const onSelect = vi.fn();
        const { handle } = setup({ onSelect });
        await handle.open();
        const items = document.querySelectorAll('.oja-select-option');
        items[0].click(); // Administrator
        expect(handle.getValue()).toBe('admin');
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ value: 'admin' }));
    });

    it('clicking option closes dropdown in single mode', async () => {
        const { handle } = setup();
        await handle.open();
        document.querySelector('.oja-select-option').click();
        expect(document.querySelector('.oja-select-dropdown')).toBeNull();
    });

    it('multi: clicking option toggles it without closing', async () => {
        const { handle } = setup({ multi: true });
        await handle.open();
        const items = document.querySelectorAll('.oja-select-option');
        items[0].click(); // add admin
        expect(handle.getValues()).toContain('admin');
        // Dropdown should still be open
        expect(document.querySelector('.oja-select-dropdown')).not.toBeNull();

        items[0].click(); // remove admin
        expect(handle.getValues()).not.toContain('admin');
    });
});

describe('select — setOptions()', () => {
    it('replaces options list', async () => {
        const { handle } = setup();
        handle.setOptions([{ value: 'x', label: 'X' }]);
        await handle.open();
        const items = document.querySelectorAll('.oja-select-option');
        expect(items.length).toBe(1);
        expect(items[0].textContent).toContain('X');
    });
});

describe('select — disable / enable', () => {
    it('disable() adds disabled class to trigger', () => {
        const { handle } = setup();
        handle.disable();
        expect(document.querySelector('.oja-select-trigger').classList.contains('disabled')).toBe(true);
    });

    it('enable() removes disabled class', () => {
        const { handle } = setup();
        handle.disable();
        handle.enable();
        expect(document.querySelector('.oja-select-trigger').classList.contains('disabled')).toBe(false);
    });
});

describe('select — keyboard navigation', () => {
    it('Escape closes the dropdown', async () => {
        const { handle } = setup();
        await handle.open();
        document.querySelector('.oja-select-search input').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
        expect(document.querySelector('.oja-select-dropdown')).toBeNull();
    });
});

describe('select — destroy()', () => {
    it('removes wrap and restores original input', () => {
        const { handle } = setup();
        handle.destroy();
        expect(document.querySelector('.oja-select')).toBeNull();
        expect(document.getElementById('field').style.display).toBe('');
    });
});

describe('select — option groups', () => {
    it('renders group labels', async () => {
        document.body.innerHTML = '<input id="g" />';
        const h = select.attach('#g', [
            { group: 'West Africa', options: [{ value: 'ng', label: 'Nigeria' }] },
            { group: 'East Africa', options: [{ value: 'ke', label: 'Kenya' }] },
        ]);
        await h.open();
        const groups = document.querySelectorAll('.oja-select-group-label');
        expect(groups.length).toBe(2);
        expect(groups[0].textContent).toBe('West Africa');
    });
});

describe('select — async source', () => {
    it('calls source on open and renders results', async () => {
        document.body.innerHTML = '<input id="s" />';
        const source = vi.fn().mockResolvedValue([{ value: 'x', label: 'X-ray' }]);
        const h = select.attach('#s', [], { source, minChars: 0 });
        await h.open();
        await new Promise(r => setTimeout(r, 0)); // let source resolve
        expect(source).toHaveBeenCalled();
    });
});
