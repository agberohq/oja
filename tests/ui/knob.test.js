import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createKnob, knob } from '../../src/js/ui/knob.js';

let instances = [];
function build(opts = {}) {
    const k = createKnob(opts);
    instances.push(k);
    document.body.appendChild(k.el);
    return k;
}

beforeEach(() => {
    document.body.innerHTML = '';
    instances = [];
});

afterEach(() => {
    for (const k of instances) { try { k.destroy(); } catch {} }
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('knob.create() — continuous dial', () => {
    it('exports a factory object', () => {
        expect(typeof knob.create).toBe('function');
    });

    it('renders a slider with ARIA and value text', () => {
        const k = build({ label: 'Gain', min: -24, max: 12, step: 0.5, value: -6, format: v => `${v.toFixed(1)} dB` });
        const el = k.el;
        expect(el.getAttribute('role')).toBe('slider');
        expect(el.getAttribute('aria-label')).toBe('Gain');
        expect(el.getAttribute('aria-valuemin')).toBe('-24');
        expect(el.getAttribute('aria-valuemax')).toBe('12');
        expect(el.getAttribute('aria-valuenow')).toBe('-6');
        expect(el.getAttribute('aria-valuetext')).toBe('-6.0 dB');
        expect(el.querySelector('.oja-knob-track')).toBeTruthy();
        expect(el.querySelector('.oja-knob-arc')).toBeTruthy();
        expect(el.querySelector('.oja-knob-pointer')).toBeTruthy();
        expect(el.querySelector('.oja-knob-label').textContent).toBe('Gain');
        expect(el.querySelector('.oja-knob-value').textContent).toBe('-6.0 dB');
    });

    it('clamps and quantizes setValue', () => {
        const k = build({ min: 0, max: 10, step: 2, value: 0 });
        k.setValue(7);
        expect(k.value).toBe(8);
        k.setValue(100);
        expect(k.value).toBe(10);
        k.setValue(-5);
        expect(k.value).toBe(0);
        expect(k.el.getAttribute('aria-valuenow')).toBe('0');
    });

    it('emits onChange only for real changes with a source', () => {
        const fn = vi.fn();
        const k = build({ min: 0, max: 10, step: 1, value: 5, onChange: fn });
        k.setValue(5, { emit: true });
        expect(fn).not.toHaveBeenCalled();
        k.setValue(6, { emit: true, source: 'key' });
        expect(fn).toHaveBeenCalledWith(6, { source: 'key', item: undefined });
    });

    it('supports keyboard stepping, page, home and end', () => {
        const k = build({ min: 0, max: 100, step: 1, value: 50 });
        k.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
        expect(k.value).toBe(51);
        k.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        expect(k.value).toBe(50);
        k.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true, cancelable: true }));
        expect(k.value).toBe(60);
        k.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
        expect(k.value).toBe(100);
        k.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
        expect(k.value).toBe(0);
    });

    it('resets on double-click', () => {
        const k = build({ min: 0, max: 10, step: 1, value: 4, defaultValue: 2 });
        k.el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        expect(k.value).toBe(2);
    });

    it('changes on pointer drag', () => {
        const k = build({ min: 0, max: 100, step: 1, value: 50 });
        k.el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 100 }));
        window.dispatchEvent(new MouseEvent('pointermove', { clientY: 80 }));
        window.dispatchEvent(new MouseEvent('pointerup', { clientY: 80 }));
        expect(k.value).toBeGreaterThan(50);
    });

    it('supports direct angle dragging when dragMode is "angle"', () => {
        const k = build({ min: 0, max: 100, step: 1, value: 50, dragMode: 'angle' });
        const dial = k.el.querySelector('.oja-knob-body');
        dial.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
        k.el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 50 }));
        window.dispatchEvent(new MouseEvent('pointerup'));
        expect(k.value).toBeGreaterThan(80);
        expect(k.value).toBeLessThan(100);
    });

    it('wheel changes only while focused by default', () => {
        const k = build({ min: 0, max: 100, step: 1, value: 50 });
        const ev = new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true });
        k.el.dispatchEvent(ev);
        expect(k.value).toBe(50);

        k.el.focus();
        k.el.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true, cancelable: true }));
        expect(k.value).toBe(51);
    });

    it('supports log scale without NaN', () => {
        const k = build({ min: 1, max: 100, scale: 'log', step: 1, value: 10 });
        expect(k.value).toBe(10);
        k.setValue(100);
        expect(k.value).toBe(100);
        expect(k.el.getAttribute('aria-valuenow')).toBe('100');
        expect(Number.isNaN(k.value)).toBe(false);
    });

    it('handles a zero-width range and a zero step without NaN', () => {
        const k = build({ min: 5, max: 5, step: 0, value: 5 });
        expect(k.value).toBe(5);
        k.setValue(99);
        expect(k.value).toBe(5);
        expect(Number.isNaN(k.value)).toBe(false);
    });

    it('falls back to linear for log with min <= 0 and warns', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const k = build({ min: 0, max: 10, scale: 'log', step: 1, value: 5 });
        expect(k.value).toBe(5);
        k.setValue(10);
        expect(k.value).toBe(10);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('scale:"log" requires min > 0'));
    });
});

describe('knob.create() — centre readout', () => {
    it('puts the formatted value in the centre and hides the below value', () => {
        const k = build({ label: 'BPM', min: 40, max: 240, step: 1, value: 120, readout: 'center' });
        expect(k.el.dataset.variant).toBe('readout');
        expect(k.el.querySelector('.oja-knob-center').textContent).toBe('120');
        const below = k.el.querySelector('.oja-knob-value');
        expect(below.hidden).toBe(true);
        k.setValue(128);
        expect(k.el.querySelector('.oja-knob-center').textContent).toBe('128');
    });

    it('keeps the dial variant by default', () => {
        const k = build({ value: 1 });
        expect(k.el.dataset.variant).toBe('dial');
    });
});

describe('knob.create() — selector', () => {
    const items = [
        { value: 'off', label: 'Off', icon: '∅' },
        { value: 'beat', label: 'Beat', icon: '♩' },
        { value: 'bar', label: 'Bar', icon: '▥' },
    ];

    it('renders a radio group and a button cap', () => {
        const k = build({ label: 'Snap', items, value: 'beat' });
        expect(k.el.dataset.variant).toBe('selector');
        expect(k.el.querySelector('.oja-knob-cap').tagName).toBe('BUTTON');
        expect(k.el.querySelectorAll('.oja-knob-radio')).toHaveLength(3);
        expect(k.el.querySelector('.oja-knob-radio:checked').value).toBe('beat');
        expect(k.el.querySelector('.oja-knob-items').getAttribute('role')).toBe('radiogroup');
        expect(k.el.querySelector('.oja-knob-cap').getAttribute('aria-expanded')).toBe('false');
    });

    it('keeps closed radios out of the tab order', () => {
        const k = build({ label: 'Snap', items, value: 'off' });
        const radios = k.el.querySelectorAll('.oja-knob-radio');
        expect([...radios].every(r => r.tabIndex === -1)).toBe(true);
        k.open();
        expect([...radios].every(r => r.tabIndex === 0)).toBe(true);
        k.close();
        expect([...radios].every(r => r.tabIndex === -1)).toBe(true);
    });

    it('opens on cap click and closes on Escape', () => {
        const k = build({ label: 'Snap', items, value: 'off' });
        const cap = k.el.querySelector('.oja-knob-cap');
        cap.click();
        expect(k.isOpen).toBe(true);
        expect(k.el.dataset.open).toBe('true');
        expect(cap.getAttribute('aria-expanded')).toBe('true');
        k.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(k.isOpen).toBe(false);
        expect(cap.getAttribute('aria-expanded')).toBe('false');
    });

    it('selects an item, emits, and closes when closeOnSelect is true', () => {
        const fn = vi.fn();
        const k = build({ label: 'Snap', items, value: 'off', onChange: fn });
        k.open();
        const input = k.el.querySelectorAll('.oja-knob-radio')[2];
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        expect(k.value).toBe('bar');
        expect(fn).toHaveBeenCalledWith('bar', { source: 'select', item: items[2] });
        expect(k.isOpen).toBe(false);
    });

    it('can stay open after select', () => {
        const k = build({ label: 'Snap', items, value: 'off', closeOnSelect: false });
        k.open();
        const input = k.el.querySelectorAll('.oja-knob-radio')[1];
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        expect(k.value).toBe('beat');
        expect(k.isOpen).toBe(true);
    });

    it('moves selection with arrows while open', () => {
        const k = build({ label: 'Snap', items, value: 'off' });
        k.open();
        k.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        expect(k.value).toBe('beat');
        k.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
        expect(k.value).toBe('off');
    });

    it('setItems preserves a still-present value', () => {
        const k = build({ label: 'Snap', items, value: 'beat' });
        k.setItems([
            { value: 'beat', label: 'Beat', icon: '♩' },
            { value: 'bar', label: 'Bar', icon: '▥' },
        ]);
        expect(k.value).toBe('beat');
        expect(k.el.querySelectorAll('.oja-knob-radio')).toHaveLength(2);
    });

    it('supports custom icon rendering', () => {
        const k = build({
            label: 'Mode',
            items: [{ value: 'a', label: 'A' }],
            renderIcon: (item) => {
                const el = document.createElement('b');
                el.textContent = item.label;
                return el;
            },
        });
        expect(k.el.querySelector('.oja-knob-icon').textContent).toBe('A');
    });
});

describe('knob.create() — lifecycle', () => {
    it('disables interactions and ARIA', () => {
        const k = build({ min: 0, max: 10, value: 5 });
        k.setDisabled(true);
        expect(k.el.dataset.disabled).toBe('true');
        expect(k.el.getAttribute('aria-disabled')).toBe('true');
        expect(k.el.getAttribute('tabindex')).toBe('-1');
        k.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        expect(k.value).toBe(5);
    });

    it('destroy removes the root and pointer listeners', () => {
        const k = build({ min: 0, max: 10, value: 5 });
        const el = k.el;
        k.destroy();
        expect(el.isConnected).toBe(false);
        expect(() => window.dispatchEvent(new MouseEvent('pointermove', { clientY: 0 }))).not.toThrow();
    });
});
