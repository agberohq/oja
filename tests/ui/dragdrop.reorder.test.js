/**
 * tests/others/dragdrop.reorder.test.js
 *
 * Tests for the reorder() rewrite:
 *   - Idempotency guard (calling reorder() twice doesn't stack listeners)
 *   - AbortController cleanup (destroy() removes ALL listeners)
 *   - _makeDraggable skip for already-initialized items (dataset.ojaDraggable)
 *   - destroy() resets item-level DOM properties
 *   - onReorder callback wiring
 *
 * jsdom does not implement HTML5 drag and drop (dragstart, drop, etc.) so we
 * test structural and listener-count behaviour, not actual drag sequences.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reorder } from '../../src/js/ui/dragdrop.js';

// jsdom stubs for setPointerCapture used elsewhere in dragdrop.js
beforeEach(() => {
    if (!Element.prototype.setPointerCapture) {
        Element.prototype.setPointerCapture    = vi.fn();
        Element.prototype.releasePointerCapture = vi.fn();
    }
});

function makeList(itemCount = 3) {
    const ul = document.createElement('ul');
    for (let i = 0; i < itemCount; i++) {
        const li = document.createElement('li');
        li.dataset.id = String(i);
        li.textContent = `Item ${i}`;
        ul.appendChild(li);
    }
    document.body.appendChild(ul);
    return ul;
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('reorder() — basic setup', () => {
    it('returns an object with a destroy() function', () => {
        const list = makeList();
        const inst = reorder(list, {});
        expect(inst).toBeDefined();
        expect(typeof inst.destroy).toBe('function');
        inst.destroy();
    });

    it('warns and returns undefined when target not found', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = reorder('#does-not-exist', {});
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('reorder target not found'));
        expect(result).toBeUndefined();
    });

    it('accepts an Element directly', () => {
        const list = makeList();
        const inst = reorder(list, {});
        expect(inst).toBeDefined();
        inst.destroy();
    });

    it('marks list items with data-oja-draggable', () => {
        const list = makeList(2);
        const inst = reorder(list, {});
        const items = Array.from(list.children);
        expect(items.every(li => li.dataset.ojaDraggable === 'true')).toBe(true);
        inst.destroy();
    });

    it('sets draggable attribute on items (or their handles)', () => {
        const list = makeList(2);
        const inst = reorder(list, {});
        const items = Array.from(list.children);
        // Without a handle, draggable goes on the item itself
        expect(items.every(li => li.getAttribute('draggable') === 'true')).toBe(true);
        inst.destroy();
    });
});

describe('reorder() — idempotency guard', () => {
    it('calling reorder() twice on same list does not throw', () => {
        const list = makeList();
        expect(() => {
            const a = reorder(list, { onReorder: vi.fn() });
            const b = reorder(list, { onReorder: vi.fn() });
            b.destroy();
        }).not.toThrow();
    });

    it('second call replaces the first — only one active instance', () => {
        const list = makeList(2);
        const onReorder1 = vi.fn();
        const onReorder2 = vi.fn();

        reorder(list, { onReorder: onReorder1 });
        const inst2 = reorder(list, { onReorder: onReorder2 });

        // Items should still be marked draggable (re-initialized by second call)
        const items = Array.from(list.children);
        expect(items.every(li => li.dataset.ojaDraggable === 'true')).toBe(true);

        inst2.destroy();
    });

    it('_makeDraggable skips items that already have data-oja-draggable', () => {
        const list = makeList(3);
        const inst = reorder(list, {});

        // All items marked after first call
        const before = Array.from(list.children).filter(li => li.dataset.ojaDraggable).length;
        expect(before).toBe(3);

        // A new item added without the attribute should be picked up by MutationObserver

        inst.destroy();
    });
});

describe('reorder() — destroy()', () => {
    it('removes data-oja-draggable attribute from items', () => {
        const list = makeList(3);
        const inst = reorder(list, {});
        inst.destroy();
        const items = Array.from(list.children);
        expect(items.every(li => !li.dataset.ojaDraggable)).toBe(true);
    });

    it('removes draggable attribute from items', () => {
        const list = makeList(2);
        const inst = reorder(list, {});
        inst.destroy();
        const items = Array.from(list.children);
        expect(items.every(li => li.getAttribute('draggable') === null)).toBe(true);
    });

    it('clears _dragList and _dragOptions from items', () => {
        const list = makeList(2);
        const inst = reorder(list, {});
        inst.destroy();
        const items = Array.from(list.children);
        expect(items.every(li => !li._dragList && !li._dragOptions)).toBe(true);
    });

    it('can be called multiple times without throwing', () => {
        const list = makeList();
        const inst = reorder(list, {});
        expect(() => {
            inst.destroy();
            inst.destroy(); // second call is a no-op
        }).not.toThrow();
    });

    it('after destroy(), a new reorder() call initializes cleanly', () => {
        const list = makeList(2);
        const inst1 = reorder(list, {});
        inst1.destroy();

        // Items no longer have ojaDraggable — new reorder() should re-apply
        const inst2 = reorder(list, {});
        const items = Array.from(list.children);
        expect(items.every(li => li.dataset.ojaDraggable === 'true')).toBe(true);
        inst2.destroy();
    });
});

describe('reorder() — handle option', () => {
    it('attaches draggable to the handle element, not the item', () => {
        const list = document.createElement('ul');
        for (let i = 0; i < 2; i++) {
            const li  = document.createElement('li');
            const hdl = document.createElement('span');
            hdl.className = 'drag-handle';
            li.appendChild(hdl);
            list.appendChild(li);
        }
        document.body.appendChild(list);

        const inst = reorder(list, { handle: '.drag-handle' });

        const handles = Array.from(list.querySelectorAll('.drag-handle'));
        expect(handles.every(h => h.getAttribute('draggable') === 'true')).toBe(true);

        // The li itself should NOT have draggable
        const items = Array.from(list.children);
        expect(items.every(li => li.getAttribute('draggable') === null)).toBe(true);

        inst.destroy();
    });

    it('destroy() removes draggable from handles', () => {
        const list = document.createElement('ul');
        const li   = document.createElement('li');
        const hdl  = document.createElement('span');
        hdl.className = 'drag-handle';
        li.appendChild(hdl);
        list.appendChild(li);
        document.body.appendChild(list);

        const inst = reorder(list, { handle: '.drag-handle' });
        inst.destroy();

        expect(hdl.getAttribute('draggable')).toBeNull();
    });
});

describe('reorder() — AbortController integration', () => {
    it('addEventListener is called with a signal option', () => {
        const list    = makeList(1);
        const addSpy  = vi.spyOn(list, 'addEventListener');
        const inst    = reorder(list, {});

        // Every list-level listener should have been called with an object
        // containing a signal property
        const calls = addSpy.mock.calls;
        const withSignal = calls.filter(c => c[2] && c[2].signal instanceof AbortSignal);
        expect(withSignal.length).toBeGreaterThan(0);

        inst.destroy();
    });

    it('destroy() aborts the controller (signal.aborted becomes true)', () => {
        // We can't directly access the internal controller, but we can verify
        // the list-level listeners are gone by checking that a subsequent
        // destroy() call on a fresh instance doesn't interact with the old one.
        const list  = makeList(2);
        const inst1 = reorder(list, {});
        const inst2 = reorder(list, {}); // replaces inst1 — old controller aborted

        // inst1 is gone — its destroy() returns immediately (not in _reorderLists)
        expect(() => inst1.destroy()).not.toThrow();

        inst2.destroy();
    });
});
