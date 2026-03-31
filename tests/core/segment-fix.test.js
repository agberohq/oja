import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { segment } from '../../src/js/core/segment.js';

beforeEach(() => { segment.clearCache(); });
afterEach(() => { document.querySelectorAll('template[data-oja-segment]').forEach(t => t.remove()); });


describe('segment.scan(root) — correct branch', () => {
    it('scan(document) scans the whole document', () => {
        const tmpl = document.createElement('template');
        tmpl.setAttribute('data-oja-segment', 'from-doc');
        tmpl.innerHTML = '<p>from document</p>';
        document.body.appendChild(tmpl);

        segment.scan(document);
        expect(segment.has('from-doc')).toBe(true);
    });

    it('scan(element) scans a specific subtree', () => {
        const container = document.createElement('div');
        const tmpl = document.createElement('template');
        tmpl.setAttribute('data-oja-segment', 'scoped-seg');
        tmpl.innerHTML = '<p>scoped</p>';
        container.appendChild(tmpl);
        document.body.appendChild(container);

        segment.scan(container);
        expect(segment.has('scoped-seg')).toBe(true);
    });

    it('scan(element) does NOT pick up templates outside the element', () => {
        const outside = document.createElement('template');
        outside.setAttribute('data-oja-segment', 'outside-seg');
        outside.innerHTML = '<p>outside</p>';
        document.body.appendChild(outside);

        const container = document.createElement('div');
        document.body.appendChild(container);

        segment.scan(container);
        expect(segment.has('outside-seg')).toBe(false);
    });
});