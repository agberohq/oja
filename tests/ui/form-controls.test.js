import { describe, it, expect } from 'vitest';
import { form } from '../../src/js/ui/form.js';

describe('form control builders', () => {
    it('field() wraps a control with label, hint and error', () => {
        const input = document.createElement('input');
        const wrap = form.field({ label: 'Name', control: input, hint: 'Your name', error: 'Required', required: true });

        expect(wrap.className).toBe('oja-field');
        const label = wrap.querySelector('.oja-field-label');
        expect(label.textContent).toBe('Name');
        expect(label.getAttribute('for')).toBe(input.id);
        expect(input.id).toMatch(/^oja-field-/);
        expect(input.hasAttribute('required')).toBe(true);
        expect(wrap.querySelector('.oja-field-hint').textContent).toBe('Your name');
        expect(wrap.querySelector('.oja-field-error').textContent).toBe('Required');
        expect(wrap.contains(input)).toBe(true);
    });

    it('field() warns and returns null without a control', () => {
        const warn = console.warn;
        console.warn = () => {};
        expect(form.field({ label: 'Nope' })).toBeNull();
        console.warn = warn;
    });

    it('row() creates .oja-control-row and flattens arrays', () => {
        const a = document.createElement('input');
        const b = document.createElement('button');
        const row = form.row(a, [b]);
        expect(row.className).toBe('oja-control-row');
        expect(row.children).toHaveLength(2);
        expect(row.children[0]).toBe(a);
        expect(row.children[1]).toBe(b);
    });

    it('input() creates .oja-input and supports label wrapping', () => {
        const plain = form.input({ type: 'number', value: '3' });
        expect(plain.className).toBe('oja-input');
        expect(plain.type).toBe('number');
        expect(plain.value).toBe('3');

        const wrapped = form.input({ label: 'Count', type: 'text', value: 'x' });
        expect(wrapped.className).toBe('oja-field');
        expect(wrapped.querySelector('input').className).toBe('oja-input');
    });

    it('select() creates .oja-select-input with options and value', () => {
        const sel = form.select({
            options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
            value: 'b',
        });
        expect(sel.className).toBe('oja-select-input');
        expect(sel.options).toHaveLength(2);
        expect(sel.value).toBe('b');

        const wrapped = form.select({ label: 'Pick', options: [{ value: 1, label: 'One' }], value: 1 });
        expect(wrapped.className).toBe('oja-field');
        expect(wrapped.querySelector('select').className).toBe('oja-select-input');
    });

    it('preserves existing form methods', () => {
        expect(typeof form.on).toBe('function');
        expect(typeof form.collect).toBe('function');
        expect(typeof form.validate).toBe('function');
        expect(typeof form.serialize).toBe('function');
    });
});
