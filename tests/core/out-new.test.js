import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Out } from '../../src/js/core/out.js';

beforeEach(() => { document.body.innerHTML = ''; });

function el(html = '') {
    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div);
    return div;
}


describe('OutTarget DOM helpers', () => {
    it('show() removes display:none', () => {
        const div = el();
        div.style.display = 'none';
        Out.to(div).show();
        expect(div.style.display).toBe('');
    });

    it('hide() sets display:none', () => {
        const div = el();
        Out.to(div).hide();
        expect(div.style.display).toBe('none');
    });

    it('toggle() flips visibility', () => {
        const div = el();
        Out.to(div).toggle();
        expect(div.style.display).toBe('none');
        Out.to(div).toggle();
        expect(div.style.display).toBe('');
    });

    it('toggle(force) sets explicit state', () => {
        const div = el();
        Out.to(div).toggle(false);
        expect(div.style.display).toBe('none');
        Out.to(div).toggle(true);
        expect(div.style.display).toBe('');
    });

    it('addClass() adds a class', () => {
        const div = el();
        Out.to(div).addClass('active');
        expect(div.classList.contains('active')).toBe(true);
    });

    it('removeClass() removes a class', () => {
        const div = el('<div class="active"></div>');
        const inner = div.firstChild;
        Out.to(inner).removeClass('active');
        expect(inner.classList.contains('active')).toBe(false);
    });

    it('toggleClass() flips a class', () => {
        const div = el();
        Out.to(div).toggleClass('open');
        expect(div.classList.contains('open')).toBe(true);
        Out.to(div).toggleClass('open');
        expect(div.classList.contains('open')).toBe(false);
    });

    it('attr() sets attribute', () => {
        const div = el();
        Out.to(div).attr('data-state', 'loaded');
        expect(div.getAttribute('data-state')).toBe('loaded');
    });

    it('attr(name, null) removes attribute', () => {
        const div = el();
        div.setAttribute('data-old', 'yes');
        Out.to(div).attr('data-old', null);
        expect(div.hasAttribute('data-old')).toBe(false);
    });

    it('css() applies inline styles', () => {
        const div = el();
        Out.to(div).css({ color: 'red', fontSize: '14px' });
        expect(div.style.color).toBe('red');
        expect(div.style.fontSize).toBe('14px');
    });

    it('DOM helpers return this for chaining', () => {
        const div = el();
        const target = Out.to(div);
        expect(target.show()).toBe(target);
        expect(target.hide()).toBe(target);
        expect(target.addClass('x')).toBe(target);
    });
});


describe('OutTarget.mode() — append/prepend', () => {
    it('mode("append") adds content without clearing existing', async () => {
        const div = el('<p id="existing">Keep me</p>');
        await Out.to(div).mode('append').html('<p id="added">Added</p>').render();
        expect(div.querySelector('#existing')).not.toBeNull();
        expect(div.querySelector('#added')).not.toBeNull();
    });

    it('mode("replace") clears existing content (default)', async () => {
        const div = el('<p id="old">Old</p>');
        await Out.to(div).html('<p id="new">New</p>').render();
        expect(div.querySelector('#old')).toBeNull();
        expect(div.querySelector('#new')).not.toBeNull();
    });
});


describe('Out.sparkline()', () => {
    it('renders an SVG into the container', async () => {
        const div = el();
        const out = Out.sparkline([10, 20, 15, 30, 25]);
        await out.render(div);
        expect(div.querySelector('svg')).not.toBeNull();
    });

    it('renders nothing for fewer than 2 values', async () => {
        const div = el('<p>existing</p>');
        const out = Out.sparkline([42]);
        await out.render(div);
        expect(div.innerHTML).toBe('');
    });
});


describe('Out.timeSeries()', () => {
    it('renders an SVG into the container', async () => {
        const div = el();
        const out = Out.timeSeries([
            { label: 'HTTP', values: [10, 20, 15], color: '#4f8ef7' },
        ]);
        await out.render(div);
        expect(div.querySelector('svg')).not.toBeNull();
    });

    it('renders nothing for empty series', async () => {
        const div = el('<p>x</p>');
        await Out.timeSeries([]).render(div);
        expect(div.innerHTML).toBe('');
    });
});