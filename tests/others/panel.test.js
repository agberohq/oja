import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { panel } from '../../src/js/ui/panel.js';

beforeEach(() => {
    document.body.innerHTML = '';
    // Mock window dimensions for position calculations
    Object.defineProperty(window, 'innerWidth',  { value: 1280, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800,  configurable: true });
});

afterEach(() => {
    panel.closeAll();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('panel.open()', () => {
    it('throws if id is missing', () => {
        expect(() => panel.open({ title: 'Test' })).toThrow('[oja/panel] options.id is required');
    });

    it('creates a panel element in the DOM', () => {
        panel.open({ id: 'p1', title: 'My Panel' });
        expect(document.querySelector('.oja-panel')).not.toBeNull();
    });

    it('sets title text', () => {
        panel.open({ id: 'p1', title: 'Hello' });
        expect(document.querySelector('.oja-panel-title-text').textContent).toBe('Hello');
    });

    it('applies width and height styles', () => {
        panel.open({ id: 'p1', width: 400, height: 300 });
        const el = document.querySelector('.oja-panel');
        expect(el.style.width).toBe('400px');
        expect(el.style.height).toBe('300px');
    });

    it('renders plain html content', async () => {
        panel.open({ id: 'p1', html: '<p id="test-para">hello</p>' });
        await Promise.resolve(); // async content injection
        expect(document.querySelector('#test-para')).not.toBeNull();
    });

    it('returns existing panel if id already open', () => {
        const h1 = panel.open({ id: 'p1', title: 'First' });
        const h2 = panel.open({ id: 'p1', title: 'Second' });
        expect(h1).toBe(h2);
        expect(document.querySelectorAll('.oja-panel').length).toBe(1);
    });

    it('applies extra class', () => {
        panel.open({ id: 'p1', class: 'my-panel' });
        expect(document.querySelector('.oja-panel.my-panel')).not.toBeNull();
    });
});

describe('panel.open() — positioning', () => {
    it('positions at center by default', () => {
        panel.open({ id: 'p1', width: 360, height: 420 });
        const el = document.querySelector('.oja-panel');
        expect(el.style.left).toBe(`${Math.round((1280 - 360) / 2)}px`);
        expect(el.style.top).toBe(`${Math.round((800  - 420) / 2)}px`);
    });

    it('positions at top-left', () => {
        panel.open({ id: 'p1', position: 'top-left', width: 360, height: 420 });
        const el = document.querySelector('.oja-panel');
        expect(el.style.left).toBe('24px');
        expect(el.style.top).toBe('24px');
    });

    it('accepts exact { x, y } position', () => {
        panel.open({ id: 'p1', position: { x: 50, y: 75 } });
        const el = document.querySelector('.oja-panel');
        expect(el.style.left).toBe('50px');
        expect(el.style.top).toBe('75px');
    });
});

describe('panel — minimize / restore', () => {
    it('minimize() hides body', () => {
        const h = panel.open({ id: 'p1', minimizable: true });
        h.minimize();
        const body = document.querySelector('.oja-panel-body');
        expect(body.style.display).toBe('none');
    });

    it('restore() shows body again', () => {
        const h = panel.open({ id: 'p1', minimizable: true });
        h.minimize();
        h.restore();
        const body = document.querySelector('.oja-panel-body');
        expect(body.style.display).toBe('');
    });

    it('calls onMinimize callback', () => {
        const onMinimize = vi.fn();
        const h = panel.open({ id: 'p1', minimizable: true, onMinimize });
        h.minimize();
        expect(onMinimize).toHaveBeenCalledWith(true);
        h.restore();
        expect(onMinimize).toHaveBeenCalledWith(false);
    });

    it('no minimize button when minimizable:false', () => {
        panel.open({ id: 'p1', minimizable: false });
        // Only close button should be in actions if closable:true
        const btns = document.querySelectorAll('.oja-panel-btn');
        // With minimizable:false and closable:true — only close btn
        expect([...btns].some(b => b.title === 'Minimize')).toBe(false);
    });
});

describe('panel — close', () => {
    it('panel.close(id) removes panel from DOM', () => {
        panel.open({ id: 'p1' });
        panel.close('p1');
        expect(document.querySelector('.oja-panel')).toBeNull();
        expect(panel.isOpen('p1')).toBe(false);
    });

    it('calls onClose callback', () => {
        const onClose = vi.fn();
        panel.open({ id: 'p1', onClose });
        panel.close('p1');
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('handle.close() works as well', () => {
        const h = panel.open({ id: 'p1' });
        h.close();
        expect(panel.isOpen('p1')).toBe(false);
    });

    it('panel.closeAll() removes all panels', () => {
        panel.open({ id: 'p1' });
        panel.open({ id: 'p2' });
        panel.closeAll();
        expect(document.querySelectorAll('.oja-panel').length).toBe(0);
        expect(panel.openIds()).toEqual([]);
    });
});

describe('panel — setTitle / setContent', () => {
    it('setTitle updates the title bar', () => {
        const h = panel.open({ id: 'p1', title: 'Original' });
        h.setTitle('Updated');
        expect(document.querySelector('.oja-panel-title-text').textContent).toBe('Updated');
    });

    it('setContent with HTML string replaces body', async () => {
        const h = panel.open({ id: 'p1' });
        await h.setContent('<span id="new-content">hi</span>');
        expect(document.getElementById('new-content')).not.toBeNull();
    });
});

describe('panel — resizable', () => {
    it('injects resize handle when resizable:true (default)', () => {
        panel.open({ id: 'p1' });
        expect(document.querySelector('.oja-panel-resize')).not.toBeNull();
    });

    it('no resize handle when resizable:false', () => {
        panel.open({ id: 'p1', resizable: false });
        expect(document.querySelector('.oja-panel-resize')).toBeNull();
    });
});

describe('panel — static methods', () => {
    it('get() returns handle for open panel', () => {
        const h = panel.open({ id: 'p1' });
        expect(panel.get('p1')).toBe(h);
    });

    it('get() returns null for non-existent id', () => {
        expect(panel.get('nonexistent')).toBeNull();
    });

    it('isOpen() reflects open state', () => {
        expect(panel.isOpen('p1')).toBe(false);
        panel.open({ id: 'p1' });
        expect(panel.isOpen('p1')).toBe(true);
    });

    it('openIds() lists all open panel ids', () => {
        panel.open({ id: 'x' });
        panel.open({ id: 'y' });
        expect(panel.openIds()).toEqual(expect.arrayContaining(['x', 'y']));
    });

    it('bringToFront() increases z-index', () => {
        panel.open({ id: 'p1' });
        const before = parseInt(document.querySelector('.oja-panel').style.zIndex);
        panel.bringToFront('p1');
        const after = parseInt(document.querySelector('.oja-panel').style.zIndex);
        expect(after).toBeGreaterThan(before);
    });
});
