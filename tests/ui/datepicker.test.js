import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { datepicker } from '../../src/js/ui/datepicker.js';

function setup(opts = {}) {
    document.body.innerHTML = '<input id="dp" type="text" />';
    const handle = datepicker.attach('#dp', opts);
    return { handle, input: document.getElementById('dp') };
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('datepicker.attach()', () => {
    it('returns null for missing target', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(datepicker.attach('#nonexistent')).toBeNull();
        spy.mockRestore();
    });

    it('wraps input in .oja-dp-wrap', () => {
        setup();
        expect(document.querySelector('.oja-dp-wrap')).not.toBeNull();
    });

    it('sets readonly and placeholder on input', () => {
        const { input } = setup({ format: 'YYYY-MM-DD', placeholder: 'Pick date' });
        expect(input.getAttribute('readonly')).not.toBeNull();
        expect(input.getAttribute('placeholder')).toBe('Pick date');
    });

    it('applies custom classes and accessibility labels', () => {
        const { handle } = setup({
            ariaLabel: 'Pick a delivery date',
            classes: { popup: 'my-pop', day: 'my-day', footer: 'my-footer', button: 'my-btn' },
        });
        handle.open();
        const pop = document.querySelector('.oja-dp-popup');
        expect(pop.classList.contains('my-pop')).toBe(true);
        expect(pop.getAttribute('role')).toBe('dialog');
        expect(pop.getAttribute('aria-label')).toBe('Pick a delivery date');
        expect(document.querySelector('.oja-dp-nav button').getAttribute('aria-label')).toBe('Previous month');
        expect(document.querySelectorAll('.oja-dp-day.my-day').length).toBeGreaterThan(0);
        expect(document.querySelector('.oja-dp-footer').classList.contains('my-footer')).toBe(true);
        expect(document.querySelector('.oja-dp-footer button').classList.contains('my-btn')).toBe(true);
        expect(document.querySelector('.oja-dp-day').getAttribute('role')).toBe('gridcell');
        handle.close();
    });

    it('respects initial value', () => {
        const { handle } = setup({ value: new Date(2025, 0, 15) }); // Jan 15 2025
        const v = handle.getValue();
        expect(v.getFullYear()).toBe(2025);
        expect(v.getMonth()).toBe(0);
        expect(v.getDate()).toBe(15);
    });
});

describe('datepicker — getValue / getFormatted / setValue / clear', () => {
    it('getValue() returns null initially', () => {
        const { handle } = setup();
        expect(handle.getValue()).toBeNull();
    });

    it('setValue() sets a date', () => {
        const { handle } = setup({ format: 'YYYY-MM-DD' });
        handle.setValue(new Date(2026, 3, 11)); // Apr 11 2026
        expect(handle.getFormatted()).toBe('2026-04-11');
    });

    it('getFormatted() returns empty string when null', () => {
        const { handle } = setup();
        expect(handle.getFormatted()).toBe('');
    });

    it('setValue(null) clears the value', () => {
        const { handle } = setup();
        handle.setValue(new Date(2026, 0, 1));
        handle.setValue(null);
        expect(handle.getValue()).toBeNull();
    });

    it('clear() calls onChange with null', () => {
        const onChange = vi.fn();
        const { handle } = setup({ onChange });
        handle.setValue(new Date(2026, 0, 1));
        handle.clear();
        expect(handle.getValue()).toBeNull();
        expect(onChange).toHaveBeenCalledWith(null, '');
    });
});

describe('datepicker — format', () => {
    it('formats YYYY-MM-DD correctly', () => {
        const { handle } = setup({ format: 'YYYY-MM-DD' });
        handle.setValue(new Date(2026, 11, 5)); // Dec 5 2026
        expect(handle.getFormatted()).toBe('2026-12-05');
    });

    it('formats DD/MM/YYYY correctly', () => {
        const { handle } = setup({ format: 'DD/MM/YYYY' });
        handle.setValue(new Date(2026, 5, 9)); // Jun 9 2026
        expect(handle.getFormatted()).toBe('09/06/2026');
    });
});

describe('datepicker — open / close', () => {
    it('open() appends popup to wrap and sets aria-expanded', () => {
        const { handle, input } = setup();
        expect(input.getAttribute('aria-haspopup')).toBe('dialog');
        expect(input.getAttribute('aria-expanded')).toBe('false');
        handle.open();
        expect(document.querySelector('.oja-dp-popup')).not.toBeNull();
        expect(input.getAttribute('aria-expanded')).toBe('true');
        handle.close();
        expect(input.getAttribute('aria-expanded')).toBe('false');
    });

    it('close() removes popup', () => {
        const { handle } = setup();
        handle.open();
        handle.close();
        expect(document.querySelector('.oja-dp-popup')).toBeNull();
    });

    it('open() is idempotent — only one popup at a time', () => {
        const { handle } = setup();
        handle.open();
        handle.open();
        expect(document.querySelectorAll('.oja-dp-popup').length).toBe(1);
    });

    it('clicking input opens the picker', () => {
        const { input } = setup();
        input.click();
        expect(document.querySelector('.oja-dp-popup')).not.toBeNull();
    });

    it('clicking input again closes it', () => {
        const { input } = setup();
        input.click();
        input.click();
        expect(document.querySelector('.oja-dp-popup')).toBeNull();
    });
});

describe('datepicker — calendar rendering', () => {
    it('renders day-of-week headers', () => {
        const { handle } = setup({ firstDay: 1 });
        handle.open();
        const dows = document.querySelectorAll('.oja-dp-dow');
        expect(dows.length).toBe(7);
        expect(dows[0].textContent).toBe('Mo'); // firstDay:1
    });

    it('renders day cells for the current month', () => {
        const { handle } = setup({ value: new Date(2026, 3, 1) }); // April 2026
        handle.open();
        const days = document.querySelectorAll('.oja-dp-day');
        expect(days.length).toBeGreaterThan(0);
    });

    it('marks selected date', () => {
        const { handle } = setup({ value: new Date(2026, 3, 11) }); // Apr 11
        handle.open();
        const selected = document.querySelector('.oja-dp-day.selected');
        expect(selected).not.toBeNull();
        expect(selected.textContent).toBe('11');
    });

    it('prev/next month navigation updates heading', () => {
        const { handle } = setup({ value: new Date(2026, 3, 1) }); // April 2026
        handle.open();
        const prevBtn = document.querySelector('.oja-dp-nav button');
        prevBtn.click(); // → March 2026
        const heading = document.querySelector('.oja-dp-heading');
        expect(heading.textContent).toContain('March');
    });
});

describe('datepicker — clicking a day', () => {
    it('picking a day sets value and calls onChange', () => {
        const onChange = vi.fn();
        const { handle } = setup({ onChange, value: new Date(2026, 3, 1) }); // April 2026
        handle.open();
        // Find a non-other-month, non-disabled day
        const day = [...document.querySelectorAll('.oja-dp-day')]
            .find(el => !el.classList.contains('other-month') && !el.classList.contains('disabled') && el.textContent === '15');
        day?.click();
        expect(handle.getValue()?.getDate()).toBe(15);
        expect(onChange).toHaveBeenCalled();
    });

    it('picking a day without showTime closes the popup', () => {
        const { handle } = setup({ value: new Date(2026, 3, 1) });
        handle.open();
        const day = [...document.querySelectorAll('.oja-dp-day')]
            .find(el => !el.classList.contains('other-month') && !el.classList.contains('disabled'));
        day?.click();
        expect(document.querySelector('.oja-dp-popup')).toBeNull();
    });
});

describe('datepicker — min / max constraints', () => {
    it('days before min are marked disabled', () => {
        const min = new Date(2026, 3, 10); // Apr 10
        const { handle } = setup({ value: new Date(2026, 3, 1), min });
        handle.open();
        const day5 = [...document.querySelectorAll('.oja-dp-day')]
            .find(el => !el.classList.contains('other-month') && el.textContent === '5');
        expect(day5?.classList.contains('disabled')).toBe(true);
    });
});

describe('datepicker — showTime', () => {
    it('renders time inputs when showTime:true', () => {
        const { handle } = setup({ showTime: true });
        handle.open();
        expect(document.querySelector('.oja-dp-time')).not.toBeNull();
        expect(document.querySelector('.oja-dp-h')).not.toBeNull();
        expect(document.querySelector('.oja-dp-m')).not.toBeNull();
    });

    it('shows footer buttons', () => {
        const { handle } = setup({ value: new Date(2026, 3, 1) });
        handle.open();
        expect(document.querySelector('.oja-dp-footer')).not.toBeNull();
    });
});

describe('datepicker — destroy()', () => {
    it('removes wrap and restores input', () => {
        const { handle } = setup();
        handle.destroy();
        expect(document.querySelector('.oja-dp-wrap')).toBeNull();
        const input = document.getElementById('dp');
        expect(input).not.toBeNull();
        expect(input.getAttribute('readonly')).toBeNull();
    });
});

describe('datepicker — keyboard grid', () => {
    const tick = () => new Promise(r => setTimeout(r, 0));

    it('opens with ArrowDown and focuses a day', async () => {
        const { handle, input } = setup({ value: new Date(2026, 3, 11) });
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        await tick();
        expect(document.querySelector('.oja-dp-popup')).not.toBeNull();
        expect(document.activeElement.dataset.date).toBe('2026-04-11');
    });

    it('moves with arrows and selects with Enter', async () => {
        const { handle } = setup({ value: new Date(2026, 3, 11) });
        handle.open();
        await tick();
        const day = document.activeElement;
        day.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        expect(document.activeElement.dataset.date).toBe('2026-04-12');
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        expect(handle.getFormatted()).toBe('2026-04-12');
    });

    it('crosses a month boundary with ArrowLeft', async () => {
        const { handle } = setup({ value: new Date(2026, 3, 1) });
        handle.open();
        await tick();
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
        expect(document.activeElement.dataset.date).toBe('2026-03-31');
        expect(handle.getFormatted()).toBe('2026-04-01');
    });

    it('closes with Escape and returns focus to the input', async () => {
        const { handle, input } = setup({ value: new Date(2026, 3, 11) });
        handle.open();
        await tick();
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        expect(document.querySelector('.oja-dp-popup')).toBeNull();
        expect(document.activeElement).toBe(input);
    });
});
