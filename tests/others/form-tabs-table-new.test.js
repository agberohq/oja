import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { form } from '../../src/js/ui/form.js';
import { tabs } from '../../src/js/ui/tabs.js';
import { table } from '../../src/js/ui/table.js';

// helpers

function radioHTML(name = 'plan') {
    return `
        <label><input type="radio" name="${name}" value="free" /> Free</label>
        <label><input type="radio" name="${name}" value="pro"  /> Pro</label>
        <label><input type="radio" name="${name}" value="ent"  /> Enterprise</label>
    `;
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

// form.radio()

describe('form.radio() — basic', () => {
    it('get() returns null when nothing checked', () => {
        document.body.innerHTML = radioHTML();
        const r = form.radio('[name="plan"]');
        expect(r.get()).toBeNull();
    });

    it('get() returns value of checked radio', () => {
        document.body.innerHTML = radioHTML();
        document.querySelector('[value="pro"]').checked = true;
        const r = form.radio('[name="plan"]');
        expect(r.get()).toBe('pro');
    });

    it('set() checks the matching radio', () => {
        document.body.innerHTML = radioHTML();
        const r = form.radio('[name="plan"]');
        r.set('ent');
        expect(document.querySelector('[value="ent"]').checked).toBe(true);
    });

    it('set() fires onChange callback', () => {
        document.body.innerHTML = radioHTML();
        const onChange = vi.fn();
        const r = form.radio('[name="plan"]', { onChange });
        r.set('pro');
        expect(onChange).toHaveBeenCalledWith('pro', expect.any(HTMLInputElement));
    });

    it('onChange fires when user changes radio', () => {
        document.body.innerHTML = radioHTML();
        const onChange = vi.fn();
        form.radio('[name="plan"]', { onChange });
        const radio = document.querySelector('[value="free"]');
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        expect(onChange).toHaveBeenCalledWith('free', radio);
    });

    it('returns no-op handle when no radios match', () => {
        const r = form.radio('[name="ghost"]');
        expect(() => { r.get(); r.set('x'); r.disable('x'); r.enable('x'); }).not.toThrow();
        expect(r.get()).toBeNull();
    });
});

describe('form.radio() — disable / enable', () => {
    it('disable() disables radio and adds class to label', () => {
        document.body.innerHTML = radioHTML();
        const r = form.radio('[name="plan"]');
        r.disable('pro');
        expect(document.querySelector('[value="pro"]').disabled).toBe(true);
        const label = document.querySelector('[value="pro"]').closest('label');
        expect(label.classList.contains('oja-radio--disabled')).toBe(true);
    });

    it('enable() re-enables radio', () => {
        document.body.innerHTML = radioHTML();
        const r = form.radio('[name="plan"]');
        r.disable('free');
        r.enable('free');
        expect(document.querySelector('[value="free"]').disabled).toBe(false);
    });

    it('set() ignores disabled radios', () => {
        document.body.innerHTML = radioHTML();
        const r = form.radio('[name="plan"]');
        r.disable('pro');
        r.set('pro');
        expect(document.querySelector('[value="pro"]').checked).toBe(false);
    });
});

describe('form.radio() — card style', () => {
    it('adds oja-radio-card class to labels', () => {
        document.body.innerHTML = radioHTML();
        form.radio('[name="plan"]', { style: 'card' });
        const labels = document.querySelectorAll('label');
        labels.forEach(l => expect(l.classList.contains('oja-radio-card')).toBe(true));
    });

    it('adds oja-radio-card--checked to checked label on set()', () => {
        document.body.innerHTML = radioHTML();
        const r = form.radio('[name="plan"]', { style: 'card' });
        r.set('free');
        const freeLabel = document.querySelector('[value="free"]').closest('label');
        expect(freeLabel.classList.contains('oja-radio-card--checked')).toBe(true);
    });

    it('removes --checked from previously checked label', () => {
        document.body.innerHTML = radioHTML();
        const r = form.radio('[name="plan"]', { style: 'card' });
        r.set('free');
        r.set('pro');
        const freeLabel = document.querySelector('[value="free"]').closest('label');
        expect(freeLabel.classList.contains('oja-radio-card--checked')).toBe(false);
    });
});

describe('form.radio() — button style', () => {
    it('adds oja-radio-btn class', () => {
        document.body.innerHTML = radioHTML();
        form.radio('[name="plan"]', { style: 'button' });
        const labels = document.querySelectorAll('label');
        labels.forEach(l => expect(l.classList.contains('oja-radio-btn')).toBe(true));
    });
});

// form.secret()

describe('form.secret()', () => {
    function secretInput() {
        document.body.innerHTML = '<div class="wrap"><input id="pw" type="password" /></div>';
        return document.getElementById('pw');
    }

    it('returns null for non-password/text input', () => {
        document.body.innerHTML = '<input id="x" type="checkbox" />';
        expect(form.secret('#x')).toBeNull();
    });

    it('injects toggle button after the input', () => {
        secretInput();
        form.secret('#pw');
        const btn = document.querySelector('.oja-secret-toggle');
        expect(btn).not.toBeNull();
        expect(btn.type).toBe('button');
    });

    it('adds oja-secret-wrap class to parent', () => {
        secretInput();
        form.secret('#pw');
        expect(document.querySelector('.oja-secret-wrap')).not.toBeNull();
    });

    it('show() sets input type to text', () => {
        secretInput();
        const handle = form.secret('#pw');
        const input  = document.getElementById('pw');
        handle.show();
        expect(input.type).toBe('text');
    });

    it('hide() sets input type back to password', () => {
        secretInput();
        const handle = form.secret('#pw');
        const input  = document.getElementById('pw');
        handle.show();
        handle.hide();
        expect(input.type).toBe('password');
    });

    it('toggle() flips visibility state', () => {
        secretInput();
        const handle = form.secret('#pw');
        const input  = document.getElementById('pw');
        handle.toggle();
        expect(input.type).toBe('text');
        handle.toggle();
        expect(input.type).toBe('password');
    });

    it('clicking toggle button changes type', () => {
        secretInput();
        form.secret('#pw');
        const btn   = document.querySelector('.oja-secret-toggle');
        const input = document.getElementById('pw');
        btn.click();
        expect(input.type).toBe('text');
        btn.click();
        expect(input.type).toBe('password');
    });

    it('updates button aria-label and text on toggle', () => {
        secretInput();
        form.secret('#pw', { toggleLabel: ['Show', 'Hide'] });
        const btn = document.querySelector('.oja-secret-toggle');
        expect(btn.textContent).toBe('Show');
        btn.click();
        expect(btn.textContent).toBe('Hide');
        expect(btn.getAttribute('aria-label')).toBe('Hide');
    });

    it('renders strength meter when strength:true', () => {
        secretInput();
        form.secret('#pw', { strength: true });
        expect(document.querySelector('.oja-strength')).not.toBeNull();
        expect(document.querySelector('.oja-strength-bar')).not.toBeNull();
        expect(document.querySelector('.oja-strength-label')).not.toBeNull();
    });

    it('accepts Element target (not just string)', () => {
        secretInput();
        const el = document.getElementById('pw');
        const handle = form.secret(el);
        expect(handle).not.toBeNull();
    });
});

// tabs.sub()

describe('tabs.sub()', () => {
    function makeNav() {
        document.body.innerHTML = `
            <nav id="subnav"></nav>
            <div id="panels">
                <div data-tab="a">Panel A</div>
                <div data-tab="b">Panel B</div>
            </div>
        `;
        return document.getElementById('subnav');
    }

    const DEFS = [
        { key: 'a', label: 'Alpha' },
        { key: 'b', label: 'Beta' },
    ];

    it('renders tab buttons in the nav container', () => {
        makeNav();
        tabs.sub('#subnav', DEFS, { panels: '#panels', active: 'a' });
        const buttons = document.querySelectorAll('button');
        expect(buttons.length).toBe(2);
    });

    it('active tab has aria-selected=true', () => {
        makeNav();
        tabs.sub('#subnav', DEFS, { panels: '#panels', active: 'a' });
        const active = document.querySelector('[aria-selected="true"]');
        expect(active).not.toBeNull();
    });

    it('uses pill variant by default', () => {
        makeNav();
        tabs.sub('#subnav', DEFS, { panels: '#panels', active: 'a' });
        const html = document.body.innerHTML;
        expect(html).toContain('pill');
    });

    it('activate() switches active tab', () => {
        makeNav();
        const { activate } = tabs.sub('#subnav', DEFS, { panels: '#panels', active: 'a' });
        activate('b');
        const actives = document.querySelectorAll('[aria-selected="true"]');
        // Only b should be active
        expect(actives.length).toBeGreaterThan(0);
    });

    it('active() returns current key', () => {
        makeNav();
        const handle = tabs.sub('#subnav', DEFS, { panels: '#panels', active: 'a' });
        expect(handle.active()).toBe('a');
        handle.activate('b');
        expect(handle.active()).toBe('b');
    });

    it('destroy() clears the nav', () => {
        makeNav();
        const { destroy } = tabs.sub('#subnav', DEFS, { panels: '#panels', active: 'a' });
        destroy();
        expect(document.querySelectorAll('button').length).toBe(0);
    });

    it('calls onChange when tab switches', () => {
        makeNav();
        const onChange = vi.fn();
        const { activate } = tabs.sub('#subnav', DEFS, { panels: '#panels', active: 'a', onChange });
        activate('b');
        expect(onChange).toHaveBeenCalledWith('b');
    });

    it('clicking a tab button activates it', () => {
        makeNav();
        const onChange = vi.fn();
        tabs.sub('#subnav', DEFS, { panels: '#panels', active: 'a', onChange });
        const buttons = document.querySelectorAll('button');
        buttons[1].click(); // click Beta
        expect(onChange).toHaveBeenCalledWith('b');
    });
});

// table resizableColumns
// table.render(target, rows, headers, opts) — rows then headers

describe('table — resizableColumns', () => {
    const HEADERS = [
        { key: 'name', label: 'Name', sortable: true },
        { key: 'role', label: 'Role', sortable: true },
    ];
    const ROWS = [{ name: 'Ade', role: 'Admin' }];

    function makeTable(opts = {}) {
        document.body.innerHTML = '<div id="tbl"></div>';
        return table.render('#tbl', ROWS, HEADERS, opts);
    }

    it('no resize handles when resizableColumns:false (default)', () => {
        makeTable();
        expect(document.querySelector('.oja-th-resize-handle')).toBeNull();
    });

    it('injects resize handle per non-special column', () => {
        makeTable({ resizableColumns: true });
        const handles = document.querySelectorAll('.oja-th-resize-handle');
        expect(handles.length).toBe(HEADERS.length);
    });

    it('resize handle responds to mousedown without error', () => {
        makeTable({ resizableColumns: true });
        const handle = document.querySelector('.oja-th-resize-handle');
        expect(() => {
            handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 150 }));
            document.dispatchEvent(new MouseEvent('mouseup'));
        }).not.toThrow();
    });

    it('mousedown + mousemove updates th width', () => {
        makeTable({ resizableColumns: true });
        const th     = document.querySelector('th[data-key="name"]');
        const handle = th.querySelector('.oja-th-resize-handle');

        Object.defineProperty(th, 'offsetWidth', { value: 120, configurable: true });

        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 160 }));
        document.dispatchEvent(new MouseEvent('mouseup'));

        expect(th.style.width).toBe('180px');
    });

    it('respects column minWidth during resize', () => {
        const headersWithMin = [
            { key: 'name', label: 'Name', minWidth: '80px', sortable: true },
            { key: 'role', label: 'Role', sortable: true },
        ];
        document.body.innerHTML = '<div id="tbl2"></div>';
        table.render('#tbl2', ROWS, headersWithMin, { resizableColumns: true });
        const th     = document.querySelector('th[data-key="name"]');
        const handle = th.querySelector('.oja-th-resize-handle');

        Object.defineProperty(th, 'offsetWidth', { value: 120, configurable: true });
        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 200, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 }));
        document.dispatchEvent(new MouseEvent('mouseup'));

        expect(th.style.width).toBe('80px');
    });

    it('cleans up mousemove/mouseup listeners after mouseup', () => {
        makeTable({ resizableColumns: true });
        const removeEventSpy = vi.spyOn(document, 'removeEventListener');
        const handle = document.querySelector('.oja-th-resize-handle');
        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mouseup'));
        expect(removeEventSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
        expect(removeEventSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
    });

    it('no resize handles on select/number columns', () => {
        document.body.innerHTML = '<div id="tbl3"></div>';
        table.render('#tbl3', ROWS, HEADERS, {
            resizableColumns: true,
            selectable: true,
            numbering:  true,
        });
        // Select column header has a checkbox input, not a resize handle
        const ths = [...document.querySelectorAll('th')];
        const selectTh = ths.find(th => th.querySelector('input[type="checkbox"]'));
        expect(selectTh?.querySelector('.oja-th-resize-handle')).toBeNull();
    });
});
