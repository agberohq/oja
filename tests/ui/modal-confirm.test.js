import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { modal } from '../../src/js/ui/modal.js';

const tick = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
    document.body.innerHTML = '';
    modal.closeAll();
});

afterEach(() => {
    modal.closeAll();
    document.body.innerHTML = '';
});

describe('modal.confirm() — auto-created dialog', () => {
    it('creates #confirmModal when the app has no markup', async () => {
        const p = modal.confirm('Delete this host?');
        await tick();

        const el = document.getElementById('confirmModal');
        expect(el).toBeTruthy();
        expect(el.classList.contains('oja-confirm-overlay')).toBe(true);
        expect(el.querySelector('.oja-confirm')).toBeTruthy();
        expect(el.querySelector('[data-modal-field="message"]').textContent).toBe('Delete this host?');
        expect(el.getAttribute('role')).toBe('dialog');
        expect(el.getAttribute('aria-modal')).toBe('true');

        el.querySelector('[data-confirm-ok]').click();
        await expect(p).resolves.toBe(true);
        await tick();
        expect(document.getElementById('confirmModal')).toBeNull();
    });

    it('resolves false on cancel', async () => {
        const p = modal.confirm('Discard changes?');
        await tick();
        document.querySelector('[data-confirm-cancel]').click();
        await expect(p).resolves.toBe(false);
        await tick();
        expect(document.getElementById('confirmModal')).toBeNull();
    });

    it('supports title, labels, danger and custom classes', async () => {
        const p = modal.confirm('Delete asset?', {
            title: 'Delete asset',
            okLabel: 'Delete',
            cancelLabel: 'Keep',
            danger: true,
            classes: { overlay: 'my-overlay', modal: 'my-confirm', ok: 'my-ok' },
        });
        await tick();

        const el = document.getElementById('confirmModal');
        expect(el.classList.contains('my-overlay')).toBe(true);
        expect(el.querySelector('.my-confirm')).toBeTruthy();
        expect(el.querySelector('[data-modal-field="title"]').textContent).toBe('Delete asset');
        expect(el.querySelector('[data-confirm-ok]').textContent).toBe('Delete');
        expect(el.querySelector('[data-confirm-cancel]').textContent).toBe('Keep');
        expect(el.querySelector('[data-confirm-ok]').getAttribute('aria-label')).toBe('Delete');
        expect(el.querySelector('[data-confirm-ok]').classList.contains('my-ok')).toBe(true);
        expect(el.querySelector('.my-confirm').getAttribute('data-variant')).toBe('danger');

        el.querySelector('[data-confirm-ok]').click();
        await p;
    });

    it('resolves false on Escape and cleans up', async () => {
        const p = modal.confirm('Close me');
        await tick();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await expect(p).resolves.toBe(false);
        await tick();
        expect(document.getElementById('confirmModal')).toBeNull();
    });

    it('uses an existing #confirmModal instead of creating one', async () => {
        document.body.innerHTML = `
            <div id="confirmModal" class="modal-overlay">
                <div class="modal">
                    <h3 data-modal-field="title">Existing</h3>
                    <p data-modal-field="message"></p>
                    <button data-confirm-cancel>No</button>
                    <button data-confirm-ok>Yes</button>
                </div>
            </div>`;
        const original = document.getElementById('confirmModal');

        const p = modal.confirm('Use existing?', { title: 'Custom title' });
        await tick();
        expect(document.getElementById('confirmModal')).toBe(original);
        expect(document.querySelector('[data-modal-field="title"]').textContent).toBe('Custom title');
        expect(original.classList.contains('active')).toBe(true);

        document.querySelector('[data-confirm-ok]').click();
        await expect(p).resolves.toBe(true);
        expect(document.getElementById('confirmModal')).toBe(original);
    });

    it('does not leave click listeners on existing markup across calls', async () => {
        document.body.innerHTML = `
            <div id="confirmModal">
                <p data-modal-field="message"></p>
                <button data-confirm-cancel>No</button>
                <button data-confirm-ok>Yes</button>
            </div>`;
        const ok = document.querySelector('[data-confirm-ok]');
        const spy = vi.fn();
        ok.addEventListener('click', spy);

        const first = modal.confirm('one');
        await tick();
        document.querySelector('[data-confirm-cancel]').click();
        await first;

        const second = modal.confirm('two');
        await tick();
        ok.click();
        await expect(second).resolves.toBe(true);
        expect(spy).toHaveBeenCalledTimes(1);
    });
});
