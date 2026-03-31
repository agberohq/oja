import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { modal } from '../../src/js/ui/modal.js';

function makeModal(id, withBody = true) {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'modal-overlay';
    if (withBody) {
        const body = document.createElement('div');
        body.setAttribute('data-modal-body', '');
        el.appendChild(body);
    }
    const btn = document.createElement('button');
    btn.setAttribute('data-action', 'modal-close');
    el.appendChild(btn);
    document.body.appendChild(el);
    return el;
}

beforeEach(() => {
    document.body.innerHTML = '';
    modal.closeAll();
});


describe('modal.open() returns Promise<Element>', () => {
    it('returns a Promise', () => {
        makeModal('m1');
        const result = modal.open('m1');
        expect(result).toBeInstanceOf(Promise);
        modal.closeAll();
    });

    it('resolves with the modal Element', async () => {
        makeModal('m2');
        const el = await modal.open('m2');
        expect(el).toBeInstanceOf(HTMLElement);
        expect(el.id).toBe('m2');
        modal.closeAll();
    });

    it('resolves null when modal id not found', async () => {
        const result = await modal.open('nonexistent-modal');
        expect(result).toBeNull();
    });
});


describe('modal.prompt()', () => {
    it('is a function', () => {
        expect(typeof modal.prompt).toBe('function');
    });

    it('auto-injects a prompt modal when none exists', async () => {
        const promptPromise = modal.prompt('Enter a name', { default: 'Alice' });
        await new Promise(r => setTimeout(r, 50));

        const input = document.querySelector('[data-prompt-input]');
        expect(input).not.toBeNull();
        expect(input.value).toBe('Alice');

        // Click OK
        const ok = document.querySelector('[data-prompt-ok]');
        ok?.click();

        const result = await promptPromise;
        expect(result).toBe('Alice');
    });

    it('resolves null when cancel is clicked', async () => {
        const promptPromise = modal.prompt('Enter value');
        await new Promise(r => setTimeout(r, 50));

        const cancel = document.querySelector('[data-prompt-cancel]');
        cancel?.click();

        const result = await promptPromise;
        expect(result).toBeNull();
    });
});


describe('modal.beforeClose() guard', () => {
    it('prevents close when guard returns false', async () => {
        makeModal('guarded');
        modal.open('guarded');

        let closedId = null;
        const off = modal.beforeClose('guarded', async () => false);

        await modal.close();
        // Stack should still have 'guarded' since close was blocked
        expect(modal.isOpen('guarded')).toBe(true);

        off(); // remove guard
        await modal.close();
        expect(modal.isOpen('guarded')).toBe(false);
    });

    it('allows close when guard returns true', async () => {
        makeModal('allowed');
        modal.open('allowed');
        modal.beforeClose('allowed', async () => true);
        await modal.close();
        expect(modal.isOpen('allowed')).toBe(false);
    });
});


describe('modal.open() size option', () => {
    it('adds oja-modal-{size} class to modal inner', async () => {
        const outer = document.createElement('div');
        outer.id = 'sized-modal';
        outer.className = 'modal-overlay';
        const inner = document.createElement('div');
        inner.className = 'modal';
        outer.appendChild(inner);
        document.body.appendChild(outer);

        await modal.open('sized-modal', { size: 'lg' });
        expect(inner.classList.contains('oja-modal-lg')).toBe(true);
        modal.closeAll();
    });
});