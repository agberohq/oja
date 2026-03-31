/**
 * Tests for Out.output() — imperative HTML string extraction.
 * Covers plan.md addition: async output() method on all Out types.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Out } from '../../src/js/core/out.js';

afterEach(() => { Out.clearCache(); vi.restoreAllMocks(); });


describe('Out.html().output()', () => {
    it('returns the HTML string', async () => {
        const html = await Out.html('<p id="x">Hello</p>').output();
        expect(html).toContain('<p id="x">Hello</p>');
    });

    it('returns a string (not a DOM node)', async () => {
        const result = await Out.html('<span>test</span>').output();
        expect(typeof result).toBe('string');
    });

    it('works with nested HTML', async () => {
        const html = await Out.html('<div><ul><li>a</li><li>b</li></ul></div>').output();
        expect(html).toContain('<li>a</li>');
        expect(html).toContain('<li>b</li>');
    });

    it('empty string produces empty output', async () => {
        const html = await Out.html('').output();
        expect(html).toBe('');
    });
});


describe('Out.raw().output()', () => {
    it('returns raw HTML without script execution', async () => {
        const html = await Out.raw('<p class="raw">raw content</p>').output();
        expect(html).toContain('class="raw"');
        expect(html).toContain('raw content');
    });
});


describe('Out.text().output()', () => {
    it('returns the text safely as a text node', async () => {
        const html = await Out.text('hello world').output();
        expect(html).toBe('hello world');
    });

    it('does not interpret HTML tags in text', async () => {
        const html = await Out.text('<script>alert(1)</script>').output();
        // Text is escaped — no actual script tag rendered
        expect(html).not.toContain('<script>');
    });
});


describe('Out.component().output()', () => {
    it('fetches and returns the component HTML as a string', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok:   true,
            status: 200,
            text: () => Promise.resolve('<section><h1>Component</h1></section>'),
        }));

        const html = await Out.component('components/test.html').output();
        expect(typeof html).toBe('string');
        expect(html).toContain('<h1>Component</h1>');
    });
});


describe('Out.is() still works after output() addition', () => {
    it('Out.is() returns true for all Out types', () => {
        expect(Out.is(Out.html('<p/>'))).toBe(true);
        expect(Out.is(Out.raw('<p/>'))).toBe(true);
        expect(Out.is(Out.text('x'))).toBe(true);
        expect(Out.is(Out.empty())).toBe(true);
    });

    it('Out.is() returns false for non-Out values', () => {
        expect(Out.is('<p>string</p>')).toBe(false);
        expect(Out.is(null)).toBe(false);
        expect(Out.is(42)).toBe(false);
        expect(Out.is({})).toBe(false);
    });
});


describe('Out.output() is non-destructive', () => {
    it('calling output() twice returns the same HTML', async () => {
        const out  = Out.html('<p>consistent</p>');
        const html1 = await out.output();
        const html2 = await out.output();
        expect(html1).toBe(html2);
    });

    it('calling output() does not prevent subsequent render()', async () => {
        const out = Out.html('<p id="after">after</p>');
        await out.output();

        const container = document.createElement('div');
        document.body.appendChild(container);
        await out.render(container);
        expect(container.querySelector('#after')).not.toBeNull();
        container.remove();
    });
});