/**
 * Tests for modal.open() body/footer string auto-wrap.
 * Covers the plan.md fix: plain HTML strings passed as body/footer
 * are now automatically wrapped as Out.html() instead of being silently ignored.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { modal } from '../../src/js/ui/modal.js';
import { Out }   from '../../src/js/core/out.js';


function makeModal(id = 'test-modal') {
    const overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = 'pg-modal-overlay';

    const inner = document.createElement('div');
    inner.className = 'pg-modal';

    const body = document.createElement('div');
    body.setAttribute('data-modal-body', '');

    const footer = document.createElement('div');
    footer.setAttribute('data-modal-footer', '');

    inner.appendChild(body);
    inner.appendChild(footer);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);
    return overlay;
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(()  => { document.body.innerHTML = ''; modal.closeAll(); });


describe('modal.open() — string body auto-wrap', () => {
    it('renders an HTML string passed as body into [data-modal-body]', async () => {
        makeModal('m1');
        modal.open('m1', { body: '<p id="injected">Hello from string</p>' });
        await Promise.resolve(); // allow async render
        const body = document.querySelector('[data-modal-body]');
        expect(body.querySelector('#injected')).not.toBeNull();
        expect(body.querySelector('#injected').textContent).toBe('Hello from string');
    });

    it('renders an Out.html body the same as before', async () => {
        makeModal('m2');
        modal.open('m2', { body: Out.html('<p id="out-body">Out body</p>') });
        await Promise.resolve();
        const body = document.querySelector('[data-modal-body]');
        expect(body.querySelector('#out-body')).not.toBeNull();
    });

    it('renders a string footer into [data-modal-footer]', async () => {
        makeModal('m3');
        modal.open('m3', { footer: '<button id="ftr-btn">OK</button>' });
        await Promise.resolve();
        const footer = document.querySelector('[data-modal-footer]');
        expect(footer.querySelector('#ftr-btn')).not.toBeNull();
    });

    it('renders an Out.html footer the same as before', async () => {
        makeModal('m4');
        modal.open('m4', { footer: Out.html('<button id="out-ftr">Cancel</button>') });
        await Promise.resolve();
        const footer = document.querySelector('[data-modal-footer]');
        expect(footer.querySelector('#out-ftr')).not.toBeNull();
    });

    it('does not render when body is undefined', async () => {
        makeModal('m5');
        modal.open('m5', {});
        await Promise.resolve();
        const body = document.querySelector('[data-modal-body]');
        expect(body.innerHTML).toBe('');
    });

    it('does not render when body is null', async () => {
        makeModal('m6');
        modal.open('m6', { body: null });
        await Promise.resolve();
        const body = document.querySelector('[data-modal-body]');
        expect(body.innerHTML).toBe('');
    });

    it('string body with special chars renders safely (not double-escaped)', async () => {
        makeModal('m7');
        modal.open('m7', { body: '<strong>bold &amp; clear</strong>' });
        await Promise.resolve();
        const body = document.querySelector('[data-modal-body]');
        expect(body.querySelector('strong')).not.toBeNull();
    });

    it('body and footer can both be strings simultaneously', async () => {
        makeModal('m8');
        modal.open('m8', {
            body:   '<p id="b">Body</p>',
            footer: '<p id="f">Footer</p>',
        });
        await Promise.resolve();
        expect(document.getElementById('b')).not.toBeNull();
        expect(document.getElementById('f')).not.toBeNull();
    });
});