import { describe, it, expect, beforeEach } from 'vitest';
import { morph } from '../../src/js/core/engine.js';

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('engine.morph() — focused field preservation', () => {
    it('keeps the same input node, value, caret and focus while updating siblings', async () => {
        const root = document.createElement('div');
        root.innerHTML = `
            <div data-oja-key="row">
                <input data-oja-key="name" value="alice">
                <span data-oja-key="status">old</span>
            </div>`;
        document.body.appendChild(root);

        const input = root.querySelector('input');
        input.focus();
        input.value = 'alice typing';
        input.setSelectionRange(2, 2);

        await morph(root, `
            <div data-oja-key="row">
                <input data-oja-key="name" value="server">
                <span data-oja-key="status">new</span>
            </div>`);

        expect(root.querySelector('input')).toBe(input);
        expect(document.activeElement).toBe(input);
        expect(input.value).toBe('alice typing');
        expect(input.selectionStart).toBe(2);
        expect(root.querySelector('[data-oja-key="status"]').textContent).toBe('new');
    });

    it('syncs value when the input is not focused', async () => {
        const root = document.createElement('div');
        root.innerHTML = `<div data-oja-key="row"><input data-oja-key="name" value="alice"></div>`;
        document.body.appendChild(root);
        const input = root.querySelector('input');

        await morph(root, `<div data-oja-key="row"><input data-oja-key="name" value="server"></div>`);

        expect(root.querySelector('input')).toBe(input);
        expect(input.value).toBe('server');
    });

    it('can opt out with preserveFocus: false', async () => {
        const root = document.createElement('div');
        root.innerHTML = `<div data-oja-key="row"><input data-oja-key="name" value="alice"></div>`;
        document.body.appendChild(root);
        const input = root.querySelector('input');
        input.focus();
        input.value = 'typing';

        await morph(root, `<div data-oja-key="row"><input data-oja-key="name" value="server"></div>`, {
            preserveFocus: false,
        });

        expect(root.querySelector('input').value).toBe('server');
    });

    it('does not replace an ancestor of the focused field on a tag mismatch', async () => {
        const root = document.createElement('div');
        root.innerHTML = `<section data-oja-key="row"><input data-oja-key="name" value="alice"></section>`;
        document.body.appendChild(root);
        const input = root.querySelector('input');
        input.focus();

        await morph(root, `<article data-oja-key="row"><input data-oja-key="name" value="server"></article>`);

        expect(root.querySelector('input')).toBe(input);
        expect(document.activeElement).toBe(input);
        expect(root.querySelector('section')).toBeTruthy();
    });

    it('preserves a focused textarea and its selection', async () => {
        const root = document.createElement('div');
        root.innerHTML = `<div data-oja-key="row"><textarea data-oja-key="note">hello</textarea></div>`;
        document.body.appendChild(root);
        const ta = root.querySelector('textarea');
        ta.focus();
        ta.value = 'hello world';
        ta.setSelectionRange(5, 5);

        await morph(root, `<div data-oja-key="row"><textarea data-oja-key="note">changed</textarea></div>`);

        expect(root.querySelector('textarea')).toBe(ta);
        expect(ta.value).toBe('hello world');
        expect(ta.selectionStart).toBe(5);
        expect(document.activeElement).toBe(ta);
    });
});
