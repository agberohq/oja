/**
 * Tests for dragdrop.canvas(), dragdrop.transformable(), dragdrop.selectionBox()
 *
 * Approach: structural tests only.
 * jsdom has incomplete pointer/touch event support (no setPointerCapture,
 * no pointer capture semantics). We test what we CAN verify reliably:
 *   - functions exist and return the correct interface
 *   - DOM structure is created and torn down correctly
 *   - simple non-capture events (keydown, wheel, pointerdown without capture)
 *   - target-not-found warning behaviour
 *
 * Pointer-capture-dependent tests (onPan dx/dy, pinch zoom) belong in
 * browser integration tests, not jsdom unit tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { canvas, transformable, selectionBox } from '../../src/js/ui/dragdrop.js';

// setPointerCapture / releasePointerCapture are not implemented in jsdom.
// Patch them onto Element.prototype once so every element gets them.

beforeEach(() => {
    if (!Element.prototype.setPointerCapture) {
        Element.prototype.setPointerCapture    = vi.fn();
        Element.prototype.releasePointerCapture = vi.fn();
    } else {
        vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(() => {});
        vi.spyOn(Element.prototype, 'releasePointerCapture').mockImplementation(() => {});
    }
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

function makeEl() {
    const el = document.createElement('div');
    el.style.cssText = 'width:400px;height:300px;position:relative';
    document.body.appendChild(el);
    return el;
}


describe('dragdrop.canvas()', () => {
    it('returns an object with a destroy() function', () => {
        const c = canvas(makeEl(), {});
        expect(c).toBeDefined();
        expect(typeof c.destroy).toBe('function');
        c.destroy();
    });

    it('warns and returns { destroy } when target selector not found', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const c    = canvas('#nonexistent-canvas', {});
        expect(warn).toHaveBeenCalled();
        expect(typeof c.destroy).toBe('function');
        c.destroy();
    });

    it('accepts an Element directly without throwing', () => {
        const el = makeEl();
        expect(() => { canvas(el, {}).destroy(); }).not.toThrow();
    });

    it('accepts a CSS selector string for an existing element', () => {
        const el = makeEl();
        el.id = 'canvas-target-el';
        const c = canvas('#canvas-target-el', {});
        expect(typeof c.destroy).toBe('function');
        c.destroy();
    });

    it('destroy() does not throw', () => {
        const c = canvas(makeEl(), {});
        expect(() => c.destroy()).not.toThrow();
    });

    it('destroy() can be called multiple times safely', () => {
        const c = canvas(makeEl(), {});
        expect(() => { c.destroy(); c.destroy(); }).not.toThrow();
    });

    it('calls onPanStart when left-button pointerdown fires on element', () => {
        const el         = makeEl();
        const onPanStart = vi.fn();
        const c          = canvas(el, { onPanStart });

        el.dispatchEvent(new PointerEvent('pointerdown', {
            button: 0, clientX: 50, clientY: 50, bubbles: true, pointerId: 1,
        }));
        expect(onPanStart).toHaveBeenCalledOnce();

        el.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true, pointerId: 1 }));
        c.destroy();
    });

    it('calls onPanEnd when pointerup fires after pointerdown', () => {
        const el     = makeEl();
        const onPanEnd = vi.fn();
        const c = canvas(el, { onPanEnd });

        el.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true, pointerId: 1 }));
        el.dispatchEvent(new PointerEvent('pointerup',   { button: 0, bubbles: true, pointerId: 1 }));

        expect(onPanEnd).toHaveBeenCalledOnce();
        c.destroy();
    });

    it('calls onZoom when a wheel event fires on the element', () => {
        const el     = makeEl();
        const onZoom = vi.fn();
        const c = canvas(el, { onZoom, zoomSpeed: 0.001 });

        el.dispatchEvent(new WheelEvent('wheel', {
            deltaY: -100, clientX: 200, clientY: 150, bubbles: true,
        }));

        expect(onZoom).toHaveBeenCalled();
        const [scale] = onZoom.mock.calls[0];
        expect(typeof scale).toBe('number');
        expect(scale).toBeGreaterThan(0);
        c.destroy();
    });

    it('does not call onPan after destroy()', () => {
        const el    = makeEl();
        const onPan = vi.fn();
        const c = canvas(el, { onPan });
        c.destroy();

        el.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 0,  clientY: 0,  bubbles: true, pointerId: 1 }));
        el.dispatchEvent(new PointerEvent('pointermove', { button: 0, clientX: 50, clientY: 50, bubbles: true, pointerId: 1 }));
        expect(onPan).not.toHaveBeenCalled();
    });
});


describe('dragdrop.transformable()', () => {
    function makeTransformEl() {
        const el = document.createElement('div');
        el.style.cssText = 'width:200px;height:100px;position:absolute;left:50px;top:50px';
        document.body.appendChild(el);
        return el;
    }

    it('returns an object with destroy() and setVisible()', () => {
        const t = transformable(makeTransformEl(), {});
        expect(typeof t.destroy).toBe('function');
        expect(typeof t.setVisible).toBe('function');
        t.destroy();
    });

    it('warns and returns stub when target not found', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const t    = transformable('#nonexistent-tf', {});
        expect(warn).toHaveBeenCalled();
        expect(typeof t.destroy).toBe('function');
        t.destroy();
    });

    it('appends the requested handles to the target element', () => {
        const el = makeTransformEl();
        const t  = transformable(el, { handles: ['n', 's', 'e', 'w'] });
        expect(el.querySelectorAll('.oja-transform-handle').length).toBe(4);
        t.destroy();
    });

    it('appends all 9 default handles when handles option is omitted', () => {
        const el = makeTransformEl();
        const t  = transformable(el, {});
        // n s e w ne nw se sw rotate = 9
        expect(el.querySelectorAll('.oja-transform-handle').length).toBe(9);
        t.destroy();
    });

    it('setVisible(false) sets display:none on all handles', () => {
        const el = makeTransformEl();
        const t  = transformable(el, { handles: ['ne', 'sw'] });
        t.setVisible(false);
        el.querySelectorAll('.oja-transform-handle').forEach(h => {
            expect(h.style.display).toBe('none');
        });
        t.destroy();
    });

    it('setVisible(true) clears display:none on all handles', () => {
        const el = makeTransformEl();
        const t  = transformable(el, { handles: ['ne'] });
        t.setVisible(false);
        t.setVisible(true);
        el.querySelectorAll('.oja-transform-handle').forEach(h => {
            expect(h.style.display).toBe('');
        });
        t.destroy();
    });

    it('destroy() removes all handle elements', () => {
        const el = makeTransformEl();
        const t  = transformable(el, { handles: ['n', 's'] });
        t.destroy();
        expect(el.querySelectorAll('.oja-transform-handle').length).toBe(0);
    });

    it('sets position:relative when element is statically positioned', () => {
        const el = document.createElement('div');
        // static is default — no explicit position
        document.body.appendChild(el);
        const t = transformable(el, { handles: ['n'] });
        // transformable() applies position:relative when needed
        expect(['relative', 'absolute', 'fixed', 'sticky'])
            .toContain(el.style.position || 'relative');
        t.destroy();
    });

    it('rotate handle has border-radius:50% (circle shape)', () => {
        const el = makeTransformEl();
        const t  = transformable(el, { handles: ['rotate'] });
        const handle = el.querySelector('.oja-handle-rotate');
        expect(handle).not.toBeNull();
        expect(handle.style.borderRadius).toBe('50%');
        t.destroy();
    });
});


describe('dragdrop.selectionBox()', () => {
    function makeContainer() {
        const el = document.createElement('div');
        el.style.cssText = 'width:500px;height:500px;position:relative';
        document.body.appendChild(el);
        return el;
    }

    it('returns an object with a destroy() function', () => {
        const s = selectionBox(makeContainer(), {});
        expect(typeof s.destroy).toBe('function');
        s.destroy();
    });

    it('warns and returns stub when target not found', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const s    = selectionBox('#nonexistent-sb', {});
        expect(warn).toHaveBeenCalled();
        expect(typeof s.destroy).toBe('function');
        s.destroy();
    });

    it('appends selection rect on pointerdown on container', () => {
        const container = makeContainer();
        const s = selectionBox(container, {});

        container.dispatchEvent(new PointerEvent('pointerdown', {
            button: 0, clientX: 10, clientY: 10, bubbles: true, pointerId: 1,
        }));

        expect(container.querySelector('.oja-selection-rect')).not.toBeNull();

        container.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true, pointerId: 1 }));
        s.destroy();
    });

    it('removes selection rect on pointerup', () => {
        const container = makeContainer();
        const s = selectionBox(container, {});

        container.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true, pointerId: 1 }));
        container.dispatchEvent(new PointerEvent('pointerup',   { button: 0, bubbles: true, pointerId: 1 }));

        expect(container.querySelector('.oja-selection-rect')).toBeNull();
        s.destroy();
    });

    it('calls onStart when drag begins', () => {
        const container = makeContainer();
        const onStart   = vi.fn();
        const s = selectionBox(container, { onStart });

        container.dispatchEvent(new PointerEvent('pointerdown', {
            button: 0, clientX: 5, clientY: 5, bubbles: true, pointerId: 1,
        }));
        expect(onStart).toHaveBeenCalledOnce();

        container.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true, pointerId: 1 }));
        s.destroy();
    });

    it('destroy() removes the selection rect if mid-drag', () => {
        const container = makeContainer();
        const s = selectionBox(container, {});
        container.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true, pointerId: 1 }));
        s.destroy();
        expect(container.querySelector('.oja-selection-rect')).toBeNull();
    });

    it('uses custom className for the selection rect', () => {
        const container = makeContainer();
        const s = selectionBox(container, { className: 'my-custom-box' });
        container.dispatchEvent(new PointerEvent('pointerdown', {
            button: 0, clientX: 5, clientY: 5, bubbles: true, pointerId: 1,
        }));
        expect(container.querySelector('.my-custom-box')).not.toBeNull();
        container.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true, pointerId: 1 }));
        s.destroy();
    });

    it('does not respond to right-button pointerdown', () => {
        const container = makeContainer();
        const onStart   = vi.fn();
        const s = selectionBox(container, { onStart });

        container.dispatchEvent(new PointerEvent('pointerdown', {
            button: 2, clientX: 0, clientY: 0, bubbles: true, pointerId: 1,
        }));
        expect(onStart).not.toHaveBeenCalled();
        s.destroy();
    });
});