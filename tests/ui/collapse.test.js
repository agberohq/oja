import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collapse, accordion } from '../../src/js/ui/collapse.js';

beforeEach(() => {
    document.body.innerHTML = '';
    // Stub animate.collapse/expand since they rely on DOM transitions
    vi.mock('../../src/js/core/animate.js', () => ({
        animate: {
            collapse: vi.fn(() => Promise.resolve()),
            expand:   vi.fn(() => Promise.resolve()),
        },
    }));
});


describe('collapse.attach(trigger, panel)', () => {
    it('returns a handle with open/close/toggle/isOpen/destroy', () => {
        const trigger = document.createElement('button');
        const panel   = document.createElement('div');
        panel.id = 'test-panel';
        document.body.appendChild(trigger);
        document.body.appendChild(panel);

        const handle = collapse.attach(trigger, panel);
        expect(typeof handle.open).toBe('function');
        expect(typeof handle.close).toBe('function');
        expect(typeof handle.toggle).toBe('function');
        expect(typeof handle.isOpen).toBe('function');
        expect(typeof handle.destroy).toBe('function');
    });

    it('starts closed by default (panel display:none)', () => {
        const trigger = document.createElement('button');
        const panel   = document.createElement('div');
        document.body.appendChild(trigger);
        document.body.appendChild(panel);

        collapse.attach(trigger, panel, { animation: false });
        expect(panel.style.display).toBe('none');
    });

    it('starts open when { open: true }', () => {
        const trigger = document.createElement('button');
        const panel   = document.createElement('div');
        document.body.appendChild(trigger);
        document.body.appendChild(panel);

        collapse.attach(trigger, panel, { open: true, animation: false });
        expect(panel.style.display).not.toBe('none');
    });

    it('isOpen() reflects state correctly', async () => {
        const trigger = document.createElement('button');
        const panel   = document.createElement('div');
        document.body.appendChild(trigger);
        document.body.appendChild(panel);

        const handle = collapse.attach(trigger, panel, { animation: false });
        expect(handle.isOpen()).toBe(false);
        await handle.open();
        expect(handle.isOpen()).toBe(true);
        await handle.close();
        expect(handle.isOpen()).toBe(false);
    });

    it('sets aria-expanded on trigger', async () => {
        const trigger = document.createElement('button');
        const panel   = document.createElement('div');
        document.body.appendChild(trigger);
        document.body.appendChild(panel);

        const handle = collapse.attach(trigger, panel, { animation: false });
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        await handle.open();
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });

    it('returns nullHandle when panel not found', () => {
        const handle = collapse.attach('#nonexistent-trigger', '#nonexistent-panel');
        expect(() => handle.open()).not.toThrow();
        expect(() => handle.close()).not.toThrow();
        expect(handle.isOpen()).toBe(false);
    });
});


describe('collapse.show() / hide() / toggle()', () => {
    it('show() makes the element visible (no animation)', async () => {
        const el = document.createElement('div');
        el.style.display = 'none';
        document.body.appendChild(el);
        await collapse.show(el, { animation: false });
        expect(el.style.display).not.toBe('none');
    });

    it('hide() sets display:none (no animation)', async () => {
        const el = document.createElement('div');
        document.body.appendChild(el);
        await collapse.hide(el, { animation: false });
        expect(el.style.display).toBe('none');
    });

    it('toggle() flips visibility', async () => {
        const el = document.createElement('div');
        el.style.display = 'none';
        document.body.appendChild(el);
        await collapse.toggle(el, { animation: false });
        expect(el.style.display).not.toBe('none');
        await collapse.toggle(el, { animation: false });
        expect(el.style.display).toBe('none');
    });
});


describe('accordion.render(container, items)', () => {
    it('renders one item per entry', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        accordion.render(container, [
            { key: 'a', label: 'Alpha', content: '<p>Content A</p>' },
            { key: 'b', label: 'Beta',  content: '<p>Content B</p>' },
        ], { animation: false });

        const items = container.querySelectorAll('.oja-accordion-item');
        expect(items.length).toBe(2);
    });

    it('renders trigger buttons with labels', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        accordion.render(container, [
            { key: 'x', label: 'My Question', content: 'Answer' },
        ], { animation: false });

        const label = container.querySelector('.oja-accordion-label');
        expect(label?.textContent).toBe('My Question');
    });

    it('returns handle with open/close/isOpen/destroy', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const handle = accordion.render(container, [
            { key: 'q1', label: 'Q1', content: 'A1' },
        ], { animation: false });

        expect(typeof handle.open).toBe('function');
        expect(typeof handle.close).toBe('function');
        expect(typeof handle.isOpen).toBe('function');
        expect(typeof handle.destroy).toBe('function');
    });

    it('openFirst: true opens the first item', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        accordion.render(container, [
            { key: 'first', label: 'First', content: 'Content' },
            { key: 'second', label: 'Second', content: 'Content 2' },
        ], { openFirst: true, animation: false });

        const firstBody = container.querySelector('.oja-accordion-body');
        expect(firstBody?.style.display).not.toBe('none');
    });

    it('destroy() clears container', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        const handle = accordion.render(container, [
            { key: 'k', label: 'L', content: 'C' },
        ], { animation: false });

        handle.destroy();
        expect(container.innerHTML).toBe('');
    });
});


describe('collapse.toggleCard()', () => {
    function makeCard(checked = false) {
        const card   = document.createElement('div');
        card.className = 'wz-toggle-card';

        const header = document.createElement('div');
        header.setAttribute('data-target', 'body1');

        const switchWrap = document.createElement('label');
        switchWrap.className = 'wz-switch';

        const cb = document.createElement('input');
        cb.type    = 'checkbox';
        cb.checked = checked;

        switchWrap.appendChild(cb);
        header.appendChild(switchWrap);

        const body = document.createElement('div');
        body.id = 'body1';

        card.appendChild(header);
        card.appendChild(body);
        document.body.appendChild(card);

        return { card, header, switchWrap, cb, body };
    }

    it('returns a handle with open/close/toggle/isOpen/destroy', () => {
        const { card, cb, body } = makeCard();
        const handle = collapse.toggleCard(card, { checkbox: cb, body });
        expect(typeof handle.open).toBe('function');
        expect(typeof handle.close).toBe('function');
        expect(typeof handle.toggle).toBe('function');
        expect(typeof handle.isOpen).toBe('function');
        expect(typeof handle.destroy).toBe('function');
    });

    it('starts closed when checkbox is unchecked', () => {
        const { card, cb, body } = makeCard(false);
        collapse.toggleCard(card, { checkbox: cb, body });
        expect(body.style.display).toBe('none');
    });

    it('starts open when checkbox is checked', () => {
        const { card, cb, body } = makeCard(true);
        collapse.toggleCard(card, { checkbox: cb, body });
        expect(body.style.display).not.toBe('none');
    });

    it('open() shows body and syncs checkbox', () => {
        const { card, cb, body } = makeCard(false);
        const handle = collapse.toggleCard(card, { checkbox: cb, body });
        handle.open();
        expect(body.style.display).not.toBe('none');
        expect(cb.checked).toBe(true);
    });

    it('close() hides body and syncs checkbox', () => {
        const { card, cb, body } = makeCard(true);
        const handle = collapse.toggleCard(card, { checkbox: cb, body });
        handle.close();
        expect(body.style.display).toBe('none');
        expect(cb.checked).toBe(false);
    });

    it('isOpen() reflects current state', () => {
        const { card, cb, body } = makeCard(false);
        const handle = collapse.toggleCard(card, { checkbox: cb, body });
        expect(handle.isOpen()).toBe(false);
        handle.open();
        expect(handle.isOpen()).toBe(true);
    });

    it('onChange fires exactly once when checkbox change event is dispatched', () => {
        const onChange = vi.fn();
        const { card, cb, body } = makeCard(false);
        collapse.toggleCard(card, { checkbox: cb, body, onChange });

        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('onChange fires exactly once when header is clicked (not the switch)', () => {
        const onChange = vi.fn();
        const { card, cb, body, header, switchWrap } = makeCard(false);
        collapse.toggleCard(card, { checkbox: cb, body, onChange });

        // Click the header area (not the switch)
        const e = new MouseEvent('click', { bubbles: true });
        Object.defineProperty(e, 'target', { value: header, configurable: true });
        // Simulate: e.target.closest('.wz-switch') returns null (clicked header not switch)
        header.dispatchEvent(new MouseEvent('click', { bubbles: false }));

        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('clicking switch label does not cause double onChange via header handler', () => {
        const onChange = vi.fn();
        const { card, cb, body, switchWrap } = makeCard(false);
        collapse.toggleCard(card, { checkbox: cb, body, onChange });

        // Simulate clicking the switch label — header click guard should bail out
        // and only the checkbox change event fires onChange.
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));

        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('destroy() removes listeners — subsequent checkbox change does not call onChange', () => {
        const onChange = vi.fn();
        const { card, cb, body } = makeCard(false);
        const handle = collapse.toggleCard(card, { checkbox: cb, body, onChange });

        handle.destroy();
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));

        expect(onChange).not.toHaveBeenCalled();
    });

    it('returns nullHandle when body is missing', () => {
        const card = document.createElement('div');
        document.body.appendChild(card);
        const handle = collapse.toggleCard(card, { body: null });
        expect(() => handle.open()).not.toThrow();
        expect(handle.isOpen()).toBe(false);
    });
});