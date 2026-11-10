import { describe, it, expect, vi, beforeEach } from 'vitest';
import { make, icon } from '../../src/js/core/ui.js';
import { component, _setActiveForTest } from '../../src/js/core/component.js';

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('make() — top-level props', () => {
    it('applies href without requiring attrs', () => {
        const a = make('a', { href: '#/songs/1', text: 'Open' });
        expect(a.getAttribute('href')).toBe('#/songs/1');
        expect(a.textContent).toBe('Open');
    });

    it('lets attrs override a top-level prop (escape hatch)', () => {
        const a = make('a', { href: '#/one', attrs: { href: '#/two' } });
        expect(a.getAttribute('href')).toBe('#/two');
    });

    it('sets input type, value and placeholder in the native order', () => {
        const input = make('input', {
            type: 'number', value: '42', placeholder: 'Count', name: 'count',
        });
        expect(input.type).toBe('number');
        expect(input.value).toBe('42');
        expect(input.placeholder).toBe('Count');
        expect(input.name).toBe('count');
    });

    it('sets boolean form props as properties and attributes', () => {
        const btn = make('button', { type: 'button', disabled: true, text: 'Save' });
        expect(btn.disabled).toBe(true);
        expect(btn.hasAttribute('disabled')).toBe(true);

        const cb = make('input', { type: 'checkbox', checked: true });
        expect(cb.checked).toBe(true);
        expect(cb.hasAttribute('checked')).toBe(true);
    });

    it('maps data keys to kebab-case data attributes', () => {
        const el = make('div', { data: { userId: 'u1', foo: 2 } });
        expect(el.getAttribute('data-user-id')).toBe('u1');
        expect(el.getAttribute('data-foo')).toBe('2');
    });

    it('supports class arrays on HTML and SVG elements', () => {
        expect(make('div', { class: ['a', 'b'] }).getAttribute('class')).toBe('a b');
        expect(make('svg', { class: ['icon', 'big'] }).getAttribute('class')).toBe('icon big');
    });

    it('wires options.on through the cleanup-aware on() helper', () => {
        const fn = vi.fn();
        const btn = make('button', { on: { click: fn } });
        document.body.appendChild(btn);
        btn.click();
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('cleans up options.on listeners when the component unmounts', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        _setActiveForTest(container);
        const fn = vi.fn();
        const btn = make('button', { on: { click: fn } });
        container.appendChild(btn);
        _setActiveForTest(null);

        btn.click();
        expect(fn).toHaveBeenCalledTimes(1);

        await component._runUnmount(container);
        btn.click();
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe('make() — SVG namespace', () => {
    it('creates svg and path nodes in the SVG namespace', () => {
        const svg = make('svg');
        const path = make('path', { attrs: { d: 'M0 0L1 1' } });
        expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
        expect(path.namespaceURI).toBe('http://www.w3.org/2000/svg');
        svg.appendChild(path);
        expect(svg.querySelector('path')).toBe(path);
        expect(path.getAttribute('d')).toBe('M0 0L1 1');
    });

    it('make.svg({ paths }) builds a paint-ready icon', () => {
        const svg = make.svg({
            size: 14,
            viewBox: '0 0 24 24',
            paths: ['M12 5v14', 'M5 12h14'],
            attrs: { 'aria-label': 'plus' },
        });
        expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
        expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
        expect(svg.getAttribute('width')).toBe('14');
        expect(svg.getAttribute('height')).toBe('14');
        expect(svg.getAttribute('aria-label')).toBe('plus');
        const paths = svg.querySelectorAll('path');
        expect(paths).toHaveLength(2);
        expect(paths[0].namespaceURI).toBe('http://www.w3.org/2000/svg');
        expect(paths[1].getAttribute('d')).toBe('M5 12h14');
    });

    it('icon() is a shorthand for make.svg({ paths })', () => {
        const svg = icon(['M12 5v14', 'M5 12h14'], { size: 16 });
        expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
        expect(svg.querySelectorAll('path')).toHaveLength(2);
        expect(svg.getAttribute('width')).toBe('16');
    });

    it('normal make.svg(options, child) still works', () => {
        const child = make('circle', { attrs: { cx: 5, cy: 5, r: 4 } });
        const svg = make.svg({ attrs: { viewBox: '0 0 10 10' } }, child);
        expect(svg.firstElementChild).toBe(child);
        expect(child.namespaceURI).toBe('http://www.w3.org/2000/svg');
    });
});
