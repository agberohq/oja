import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { segment, _segmentRender } from '../../src/js/core/segment.js';


function addTemplate(name, html, keep = false) {
    const tmpl = document.createElement('template');
    tmpl.setAttribute('data-oja-segment', name);
    tmpl.innerHTML = html;
    if (keep) tmpl.setAttribute('data-oja-segment-keep', '');
    document.body.appendChild(tmpl);
    return tmpl;
}

function makeContainer(html = '') {
    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div);
    return div;
}

// Reset segment registry and auto-scan flag between tests.
// We reach into the module internals via the clearCache() API.
beforeEach(() => {
    segment.clearCache();
});

afterEach(() => {
    // Remove any leftover templates or containers
    document.querySelectorAll('template[data-oja-segment]').forEach(t => t.remove());
    document.querySelectorAll('[data-test-container]').forEach(t => t.remove());
});


describe('segment.scan()', () => {
    it('picks up templates from the document', () => {
        addTemplate('home', '<h1>Home</h1>');
        segment.scan();
        expect(segment.has('home')).toBe(true);
    });

    it('removes templates from the DOM after scanning (default)', () => {
        const tmpl = addTemplate('removeme', '<p>hi</p>');
        segment.scan();
        expect(document.body.contains(tmpl)).toBe(false);
    });

    it('keeps templates marked data-oja-segment-keep', () => {
        const tmpl = addTemplate('keepme', '<p>hi</p>', true);
        segment.scan();
        expect(document.body.contains(tmpl)).toBe(true);
        tmpl.remove();
    });

    it('is idempotent — calling twice does not duplicate', () => {
        addTemplate('dup', '<p>dup</p>');
        segment.scan();
        segment.scan();
        expect(segment.list().filter(n => n === 'dup')).toHaveLength(1);
    });

    it('warns on duplicate name during scan and overwrites', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        addTemplate('clash', '<p>first</p>');
        segment.scan();
        // Simulate a second template with the same name appearing in a re-scan
        const tmpl2 = document.createElement('template');
        tmpl2.setAttribute('data-oja-segment', 'clash');
        tmpl2.innerHTML = '<p>second</p>';
        document.body.appendChild(tmpl2);
        segment.scan(); // explicit re-scan picks up the duplicate
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('clash'));
        expect(segment.get('clash')).toBe('<p>second</p>');
        warn.mockRestore();
    });

    it('accepts an arbitrary root element', () => {
        const div = document.createElement('div');
        const tmpl = document.createElement('template');
        tmpl.setAttribute('data-oja-segment', 'scoped');
        tmpl.innerHTML = '<p>scoped</p>';
        div.appendChild(tmpl);
        segment.scan(div);
        expect(segment.has('scoped')).toBe(true);
    });
});


describe('auto-scan on first use', () => {
    it('has() triggers auto-scan', () => {
        addTemplate('lazy', '<p>lazy</p>');
        expect(segment.has('lazy')).toBe(true);
    });

    it('get() triggers auto-scan', () => {
        addTemplate('lazy2', '<p>lazy2</p>');
        expect(segment.get('lazy2')).toBe('<p>lazy2</p>');
    });

    it('list() triggers auto-scan', () => {
        addTemplate('lazy3', '<p>lazy3</p>');
        expect(segment.list()).toContain('lazy3');
    });

    it('clearCache() resets so next use re-scans', () => {
        addTemplate('reset-test', '<p>reset</p>');
        segment.scan();
        segment.clearCache();
        addTemplate('after-reset', '<p>after</p>');
        expect(segment.has('after-reset')).toBe(true);
    });
});


describe('segment.define()', () => {
    it('registers a segment from an HTML string', () => {
        segment.define('prog', '<p>programmatic</p>');
        expect(segment.get('prog')).toBe('<p>programmatic</p>');
    });

    it('overwrites existing registration silently', () => {
        segment.define('over', '<p>v1</p>');
        segment.define('over', '<p>v2</p>');
        expect(segment.get('over')).toBe('<p>v2</p>');
    });

    it('warns and returns this for invalid args', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ret = segment.define('', '<p>x</p>');
        expect(warn).toHaveBeenCalled();
        expect(ret).toBe(segment);
        warn.mockRestore();
    });

    it('is chainable', () => {
        expect(segment.define('a', '<a>')).toBe(segment);
    });
});

describe('segment.defineAll()', () => {
    it('registers multiple segments at once', () => {
        segment.defineAll({ x: '<x/>', y: '<y/>' });
        expect(segment.has('x')).toBe(true);
        expect(segment.has('y')).toBe(true);
    });

    it('is chainable', () => {
        expect(segment.defineAll({})).toBe(segment);
    });
});


describe('segment.has()', () => {
    it('returns true for registered name',    () => { segment.define('q', '<q>'); expect(segment.has('q')).toBe(true); });
    it('returns false for unregistered name', () => { expect(segment.has('__nope__')).toBe(false); });
});

describe('segment.get()', () => {
    it('returns HTML string for registered name', () => { segment.define('g', '<g>'); expect(segment.get('g')).toBe('<g>'); });
    it('returns null for missing name',            () => { expect(segment.get('__missing__')).toBeNull(); });
});

describe('segment.list()', () => {
    it('returns all registered names', () => {
        segment.define('l1', '<l1>');
        segment.define('l2', '<l2>');
        const list = segment.list();
        expect(list).toContain('l1');
        expect(list).toContain('l2');
    });

    it('returns empty array when nothing registered', () => {
        expect(segment.list()).toEqual([]);
    });
});


describe('segment.undefine()', () => {
    it('removes a single segment', () => {
        segment.define('rm', '<rm>');
        segment.undefine('rm');
        expect(segment.has('rm')).toBe(false);
    });

    it('is a no-op for unknown name', () => {
        expect(() => segment.undefine('__ghost__')).not.toThrow();
    });

    it('is chainable', () => {
        expect(segment.undefine('x')).toBe(segment);
    });
});

describe('segment.clearCache()', () => {
    it('removes all segments', () => {
        segment.define('c1', '<c1>');
        segment.define('c2', '<c2>');
        segment.clearCache();
        expect(segment.list()).toHaveLength(0);
    });

    it('is chainable', () => {
        expect(segment.clearCache()).toBe(segment);
    });
});


describe('_segmentRender()', () => {
    let container;

    beforeEach(() => {
        container = document.createElement('div');
        container.setAttribute('data-test-container', '');
        document.body.appendChild(container);
    });

    afterEach(() => container.remove());

    it('renders registered HTML into the container', async () => {
        segment.define('render-test', '<p>hello</p>');
        await _segmentRender(container, 'render-test', {});
        expect(container.innerHTML).toContain('<p>hello</p>');
    });

    it('interpolates data into template syntax', async () => {
        segment.define('interp', '<p>{{name}}</p>');
        await _segmentRender(container, 'interp', { name: 'Oja' });
        expect(container.textContent).toContain('Oja');
    });

    it('merges context and data — data wins on collision', async () => {
        segment.define('merge', '<p>{{val}}</p>');
        await _segmentRender(container, 'merge', { val: 'data' }, { val: 'ctx' });
        expect(container.textContent).toContain('data');
    });

    it('throws for unknown segment name', async () => {
        await expect(_segmentRender(container, '__unknown__', {}))
            .rejects.toThrow('unknown segment');
    });

    it('replaces container contents on re-render', async () => {
        segment.define('replace', '<p>v1</p>');
        await _segmentRender(container, 'replace', {});
        segment.define('replace', '<p>v2</p>');
        await _segmentRender(container, 'replace', {});
        expect(container.innerHTML).toBe('<p>v2</p>');
    });
});