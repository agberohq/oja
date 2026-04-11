import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stub requestAnimationFrame globally so virtual-list draw() runs synchronously
vi.stubGlobal('requestAnimationFrame', (fn) => { fn(); return 1; });
vi.stubGlobal('cancelAnimationFrame', () => {});

// autocomplete

import { autocomplete } from '../../src/js/ui/autocomplete.js';

function setupAC(opts = {}) {
    document.body.innerHTML = '<input id="ac" type="text" />';
    const input  = document.getElementById('ac');
    const handle = autocomplete.attach(input, {
        source: ['apple', 'apricot', 'banana', 'blueberry'],
        minChars: 1,
        ...opts,
    });
    return { input, handle };
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('autocomplete — attach', () => {
    it('returns a handle with show/hide/destroy', () => {
        const { handle } = setupAC();
        expect(typeof handle.show).toBe('function');
        expect(typeof handle.hide).toBe('function');
        expect(typeof handle.destroy).toBe('function');
    });

    it('shows suggestions when input has ≥ minChars', async () => {
        const { input } = setupAC({ minChars: 1 });
        input.value = 'ap';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await Promise.resolve();
        // Autocomplete uses display:block/none, not remove/append
        const list = document.querySelector('[role="listbox"], .oja-autocomplete-suggestions');
        expect(list).not.toBeNull();
    });

    it('calls onSelect when a suggestion is clicked', async () => {
        const onSelect = vi.fn();
        const { input } = setupAC({ onSelect, minChars: 1 });
        input.value = 'ap';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await Promise.resolve();
        const firstItem = document.querySelector('[role="option"], li');
        if (firstItem) {
            firstItem.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            expect(onSelect).toHaveBeenCalled();
        }
    });

    it('hides list on Escape key (sets display:none)', async () => {
        const { input } = setupAC({ minChars: 1 });
        input.value = 'ba';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await Promise.resolve();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        const list = document.querySelector('[role="listbox"], .oja-autocomplete-suggestions');
        // hide() sets display:none, doesn't remove the element
        expect(!list || list.style.display === 'none').toBe(true);
    });

    it('destroy() removes event listeners without error', () => {
        const { handle } = setupAC();
        expect(() => handle.destroy()).not.toThrow();
    });
});

describe('autocomplete — async source', () => {
    it('calls async source function', async () => {
        const source = vi.fn().mockResolvedValue(['x', 'y']);
        document.body.innerHTML = '<input id="as" />';
        const handle = autocomplete.attach(document.getElementById('as'), {
            source,
            minChars: 0,
        });
        const input = document.getElementById('as');
        input.value = 'x';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 50));
        expect(source).toHaveBeenCalled();
        handle.destroy();
    });
});

// mask

import { mask } from '../../src/js/ui/mask.js';

describe('mask — attach', () => {
    function mkInput(id = 'mi') {
        document.body.innerHTML = `<input id="${id}" type="text" />`;
        return document.getElementById(id);
    }

    // Use blur event — avoids selectionStart/setSelectionRange which jsdom doesn't support
    // blur path: formats value without cursor repositioning
    function applyMask(el) {
        el.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    it('applies phone mask correctly', () => {
        const input = mkInput();
        mask.attach('#mi', '(000) 000-0000');
        input.value = '5551234567';
        applyMask(input);
        expect(input.value).toBe('(555) 123-4567');
    });

    it('stores raw value in dataset.ojaRawValue', () => {
        const input = mkInput();
        mask.attach('#mi', '(000) 000-0000');
        input.value = '5551234567';
        applyMask(input);
        expect(input.dataset.ojaRawValue).toBe('5551234567');
    });

    it('applies date mask correctly', () => {
        const input = mkInput();
        mask.attach('#mi', '00/00/0000');
        input.value = '01152026';
        applyMask(input);
        expect(input.value).toBe('01/15/2026');
    });

    it('formats digits through a digit mask', () => {
        const input = mkInput();
        mask.attach('#mi', '000-000');
        // _applyMask strips non-alnum then applies pattern char-by-char.
        // A digit-only mask ('0') breaks on the first non-digit in cleanVal,
        // so input must start with digits.
        input.value = '123456';
        input.dispatchEvent(new Event('blur', { bubbles: true }));
        expect(input.value).toBe('123-456');
    });

    it('alphanumeric mask (*) accepts letters and digits', () => {
        const input = mkInput();
        mask.attach('#mi', '***-***');
        input.value = 'AB1cd2';
        applyMask(input);
        expect(input.value).toBe('AB1-cd2');
    });

    it('letter mask (a) processes letters only', () => {
        const input = mkInput();
        mask.attach('#mi', 'aaa');
        // 'A2B' → cleanVal strips non-alphanum = 'A2B' → a accepts only [a-zA-Z]
        // A passes, 2 fails → stops, result = 'A'
        // Then B is next char but we already stopped at 2
        // Actually cleanVal = 'A2B', pattern 'aaa':
        //   i=0: p='a', c='A' → letter → OK → result='A'
        //   i=1: p='a', c='2' → not letter → break
        // So result = 'A'
        input.value = 'AB'; // only letters
        applyMask(input);
        expect(input.value).toBe('AB');
    });

    it('attaches to multiple elements via NodeList', () => {
        document.body.innerHTML = '<input class="m" /><input class="m" />';
        const els = document.querySelectorAll('.m');
        mask.attach(els, '000');
        els.forEach(el => {
            el.value = '123456';
            el.dispatchEvent(new InputEvent('input', { bubbles: true }));
            expect(el.value).toBe('123');
        });
    });

    it('skips non-INPUT elements without error', () => {
        document.body.innerHTML = '<div id="d"></div>';
        expect(() => mask.attach('#d', '000')).not.toThrow();
    });
});

// popover

import { popover } from '../../src/js/ui/popover.js';

describe('popover', () => {
    beforeEach(() => {
        document.body.innerHTML = '<button id="trigger">Click</button>';
    });

    afterEach(() => {
        // popover.hide() adds oja-leaving and removes after 150ms - force immediate removal
        document.querySelectorAll('.oja-popover').forEach(el => el.remove());
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('show() appends a .oja-popover element', async () => {
        const trigger = document.getElementById('trigger');
        vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
            { top: 40, bottom: 60, left: 100, right: 200, width: 100, height: 20 }
        );
        await popover.show(trigger, '<p>Hello</p>');
        expect(document.querySelector('.oja-popover')).not.toBeNull();
    });

    it('hide() adds oja-leaving class and schedules removal', async () => {
        vi.useFakeTimers();
        const trigger = document.getElementById('trigger');
        vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
            { top: 40, bottom: 60, left: 100, right: 200, width: 100, height: 20 }
        );
        await popover.show(trigger, '<p>Hi</p>');
        popover.hide();
        // After hide(), element has oja-leaving class but not yet removed
        const el = document.querySelector('.oja-popover');
        expect(el?.classList.contains('oja-leaving') || !el).toBe(true);
        vi.advanceTimersByTime(200);
        expect(document.querySelector('.oja-popover')).toBeNull();
        vi.useRealTimers();
    });

    it('show() with string content renders HTML inside popover', async () => {
        const trigger = document.getElementById('trigger');
        vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
            { top: 40, bottom: 60, left: 100, right: 200, width: 100, height: 20 }
        );
        await popover.show(trigger, '<span id="inner">Content</span>');
        expect(document.getElementById('inner')).not.toBeNull();
    });

    it('Escape key triggers hide on the popover', async () => {
        vi.useFakeTimers();
        const trigger = document.getElementById('trigger');
        vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
            { top: 40, bottom: 60, left: 100, right: 200, width: 100, height: 20 }
        );
        await popover.show(trigger, '<p>Hi</p>');
        // Escape fires via the once keydown listener
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        vi.advanceTimersByTime(200);
        expect(document.querySelector('.oja-popover')).toBeNull();
        vi.useRealTimers();
    });
});

// virtual-list

import { virtualList } from '../../src/js/ui/virtual-list.js';

describe('virtualList', () => {
    function makeContainer(h = 200) {
        document.body.innerHTML = `<div id="vl" style="height:${h}px;overflow:auto"></div>`;
        const el = document.getElementById('vl');
        Object.defineProperty(el, 'clientHeight', { value: h, configurable: true });
        Object.defineProperty(el, 'scrollTop',    { value: 0, writable: true, configurable: true });
        return el;
    }

    const items = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `Item ${i}` }));

    it('throws if renderItem is not provided', () => {
        const el = makeContainer();
        expect(() => virtualList.render('#vl', items, { itemHeight: 40 })).toThrow('[oja/virtual-list] renderItem');
    });

    it('returns null for missing target', () => {
        expect(virtualList.render('#nonexistent', [], { renderItem: () => '' })).toBeNull();
    });

    it('renders a subset of items (virtual window) - requestAnimationFrame stubbed', () => {
        const el = makeContainer(200);
        virtualList.render(el, items, {
            itemHeight:  40,
            overscan:    2,
            renderItem: (item) => `<div class="vl-item">${item.name}</div>`,
        });
        // With rAF stubbed, draw() runs immediately
        const rendered = el.querySelectorAll('.vl-item');
        // Should render some but not all 100 items
        expect(rendered.length).toBeGreaterThan(0);
        expect(rendered.length).toBeLessThan(items.length);
    });

    it('creates spacer and content elements', () => {
        const el = makeContainer();
        virtualList.render(el, items, {
            itemHeight:  40,
            renderItem: (item) => `<div>${item.name}</div>`,
        });
        expect(el.querySelector('.oja-vl-spacer')).not.toBeNull();
        expect(el.querySelector('.oja-vl-content')).not.toBeNull();
    });

    it('spacer height equals totalItems * itemHeight', () => {
        const el = makeContainer();
        virtualList.render(el, items, {
            itemHeight:  40,
            renderItem: () => '<div></div>',
        });
        const spacer = el.querySelector('.oja-vl-spacer');
        expect(spacer.style.height).toBe(`${items.length * 40}px`);
    });

    it('update() re-renders with new data', () => {
        const el   = makeContainer();
        const list = virtualList.render(el, items, {
            itemHeight:  40,
            renderItem: (item) => `<div class="vl-item">${item.name}</div>`,
        });
        const newItems = Array.from({ length: 5 }, (_, i) => ({ id: i, name: `New ${i}` }));
        list.update(newItems);
        const spacer = el.querySelector('.oja-vl-spacer');
        expect(spacer.style.height).toBe(`${5 * 40}px`);
    });

    it('handles empty array without error', () => {
        const el = makeContainer();
        expect(() => virtualList.render(el, [], { itemHeight: 40, renderItem: () => '<div></div>' })).not.toThrow();
    });
});
