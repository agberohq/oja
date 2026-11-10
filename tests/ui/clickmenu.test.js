import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clickmenu } from '../../src/js/ui/clickmenu.js';

beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
});

afterEach(() => {
    clickmenu.close();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('clickmenu — show()', () => {
    it('appends a menu to the body', () => {
        clickmenu.show(100, 200, [{ label: 'Rename', action: vi.fn() }]);
        const menu = document.querySelector('.oja-ctx-menu');
        expect(menu).not.toBeNull();
        expect(menu.getAttribute('role')).toBe('menu');
    });

    it('renders item labels', () => {
        clickmenu.show(0, 0, [
            { label: 'Open',   action: vi.fn() },
            { label: 'Delete', action: vi.fn() },
        ]);
        const labels = [...document.querySelectorAll('.oja-ctx-label')].map(el => el.textContent);
        expect(labels).toEqual(['Open', 'Delete']);
    });

    it('renders a separator', () => {
        clickmenu.show(0, 0, [
            { label: 'A', action: vi.fn() },
            { separator: true },
            { label: 'B', action: vi.fn() },
        ]);
        expect(document.querySelector('.oja-ctx-sep')).not.toBeNull();
    });

    it('applies danger class to danger items', () => {
        clickmenu.show(0, 0, [{ label: 'Delete', action: vi.fn(), danger: true }]);
        const btn = document.querySelector('.oja-ctx-item');
        expect(btn.classList.contains('danger')).toBe(true);
    });

    it('applies disabled class to disabled items', () => {
        clickmenu.show(0, 0, [{ label: 'Archive', action: vi.fn(), disabled: true }]);
        const btn = document.querySelector('.oja-ctx-item');
        expect(btn.classList.contains('disabled')).toBe(true);
    });

    it('renders icon and shortcut when provided', () => {
        clickmenu.show(0, 0, [{ label: 'Save', action: vi.fn(), icon: '💾', shortcut: '⌘S' }]);
        expect(document.querySelector('.oja-ctx-icon')).not.toBeNull();
        expect(document.querySelector('.oja-ctx-shortcut').textContent).toBe('⌘S');
    });

    it('reports isOpen true while menu is visible', () => {
        expect(clickmenu.isOpen).toBe(false);
        clickmenu.show(0, 0, [{ label: 'A', action: vi.fn() }]);
        expect(clickmenu.isOpen).toBe(true);
    });
});

describe('clickmenu — close()', () => {
    it('removes the menu from the DOM', () => {
        clickmenu.show(0, 0, [{ label: 'A', action: vi.fn() }]);
        clickmenu.close();
        expect(document.querySelector('.oja-ctx-menu')).toBeNull();
        expect(clickmenu.isOpen).toBe(false);
    });

    it('calls onClose callback', () => {
        const onClose = vi.fn();
        clickmenu.show(0, 0, [{ label: 'A', action: vi.fn() }], { onClose });
        clickmenu.close();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('closing twice is safe', () => {
        clickmenu.show(0, 0, [{ label: 'A', action: vi.fn() }]);
        expect(() => { clickmenu.close(); clickmenu.close(); }).not.toThrow();
    });
});

describe('clickmenu — item click', () => {
    it('calls action and closes menu on item click', async () => {
        const action = vi.fn();
        clickmenu.show(0, 0, [{ label: 'Go', action }]);
        const btn = document.querySelector('.oja-ctx-item');
        btn.click();
        expect(action).toHaveBeenCalledOnce();
        expect(clickmenu.isOpen).toBe(false);
    });

    it('disabled items do not call action on click', () => {
        const action = vi.fn();
        clickmenu.show(0, 0, [{ label: 'X', action, disabled: true }]);
        document.querySelector('.oja-ctx-item').click();
        expect(action).not.toHaveBeenCalled();
    });

    it('second show() closes the first menu', () => {
        const onClose = vi.fn();
        clickmenu.show(0, 0, [{ label: 'A', action: vi.fn() }], { onClose });
        clickmenu.show(0, 0, [{ label: 'B', action: vi.fn() }]);
        expect(onClose).toHaveBeenCalledOnce();
        const menus = document.querySelectorAll('.oja-ctx-menu');
        expect(menus.length).toBe(1);
    });
});

describe('clickmenu — keyboard navigation', () => {
    it('Escape key closes the menu', () => {
        clickmenu.show(0, 0, [{ label: 'A', action: vi.fn() }]);
        vi.advanceTimersByTime(10);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(clickmenu.isOpen).toBe(false);
    });

    it('ArrowDown moves focus to next item', () => {
        clickmenu.show(0, 0, [
            { label: 'A', action: vi.fn() },
            { label: 'B', action: vi.fn() },
        ]);
        vi.advanceTimersByTime(10);
        const items = [...document.querySelectorAll('.oja-ctx-item')];
        items[0].focus();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(document.activeElement).toBe(items[1]);
    });
});

describe('clickmenu — bind()', () => {
    it('shows menu on contextmenu event matching selector', () => {
        document.body.innerHTML = '<ul><li data-item="1">Row</li></ul>';
        const factory = vi.fn(() => [{ label: 'Edit', action: vi.fn() }]);
        const unbind  = clickmenu.bind('[data-item]', factory);

        const row = document.querySelector('[data-item]');
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 80 }));

        expect(factory).toHaveBeenCalledOnce();
        expect(clickmenu.isOpen).toBe(true);

        unbind();
    });

    it('does not show menu when factory returns empty array', () => {
        document.body.innerHTML = '<div data-item="1">X</div>';
        const unbind = clickmenu.bind('[data-item]', () => []);
        document.querySelector('[data-item]').dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true })
        );
        expect(clickmenu.isOpen).toBe(false);
        unbind();
    });

    it('returned function removes the binding', () => {
        document.body.innerHTML = '<div data-item="1">X</div>';
        const factory = vi.fn(() => [{ label: 'X', action: vi.fn() }]);
        const unbind  = clickmenu.bind('[data-item]', factory);
        unbind();
        document.querySelector('[data-item]').dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true })
        );
        expect(factory).not.toHaveBeenCalled();
    });
});

describe('clickmenu — anchor()', () => {
    it('shows menu attached to an element', () => {
        document.body.innerHTML = '<button id="btn">⋮</button>';
        const btn = document.getElementById('btn');
        vi.spyOn(btn, 'getBoundingClientRect').mockReturnValue(
            { top: 40, bottom: 60, left: 100, right: 140, width: 40, height: 20 }
        );
        clickmenu.anchor(btn, [{ label: 'Edit', action: vi.fn() }]);
        expect(clickmenu.isOpen).toBe(true);
    });
});
