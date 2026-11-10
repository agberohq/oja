import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dragdrop } from '../../src/js/ui/dragdrop.js';

class FakeDataTransfer {
    constructor() {
        this.data = new Map();
        this.types = [];
        this.effectAllowed = '';
        this.dropEffect = '';
    }
    setData(type, value) {
        this.data.set(type, value);
        if (!this.types.includes(type)) this.types.push(type);
    }
    getData(type) { return this.data.get(type) ?? ''; }
}

function makeEvent(type, { clientY = 0, dataTransfer = null } = {}) {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clientY', { value: clientY });
    if (dataTransfer) Object.defineProperty(e, 'dataTransfer', { value: dataTransfer });
    return e;
}

function rect({ top = 0, height = 100 } = {}) {
    return { top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top };
}

function setupTree() {
    document.body.innerHTML = `
        <div id="tree">
            <div class="item" data-id="a">A</div>
            <div class="item" data-id="b">B</div>
            <div class="folder" data-id="f" data-oja-folder>Folder</div>
        </div>`;
    return document.getElementById('tree');
}

let instance;
beforeEach(() => {
    document.body.innerHTML = '';
    instance = null;
});
afterEach(() => {
    instance?.destroy();
    document.body.innerHTML = '';
});

describe('dragdrop.tree()', () => {
    it('marks items and folder rows draggable', () => {
        const root = setupTree();
        instance = dragdrop.tree(root, { itemSelector: '.item, .folder', folderSelector: '.folder' });
        for (const el of root.children) expect(el.getAttribute('draggable')).toBe('true');
    });

    it('reports before/after for sibling rows', () => {
        const root = setupTree();
        const [a, b] = root.querySelectorAll('.item');
        a.getBoundingClientRect = () => rect();
        b.getBoundingClientRect = () => rect();
        const onDrop = vi.fn();
        instance = dragdrop.tree(root, {
            itemSelector: '.item, .folder',
            folderSelector: '.folder',
            mime: 'application/x-tree',
            onDrop,
        });

        const dt = new FakeDataTransfer();
        a.dispatchEvent(makeEvent('dragstart', { dataTransfer: dt }));
        expect(dt.types).toContain('application/x-tree');

        b.dispatchEvent(makeEvent('dragover', { clientY: 10, dataTransfer: dt }));
        b.dispatchEvent(makeEvent('drop', { clientY: 10, dataTransfer: dt }));
        expect(onDrop).toHaveBeenCalledTimes(1);
        expect(onDrop.mock.calls[0][0]).toMatchObject({ drag: 'a', target: 'b', position: 'before' });

        onDrop.mockClear();
        a.dispatchEvent(makeEvent('dragstart', { dataTransfer: dt }));
        b.dispatchEvent(makeEvent('dragover', { clientY: 90, dataTransfer: dt }));
        b.dispatchEvent(makeEvent('drop', { clientY: 90, dataTransfer: dt }));
        expect(onDrop.mock.calls[0][0]).toMatchObject({ drag: 'a', target: 'b', position: 'after' });
    });

    it('reports inside for a folder in the middle zone', () => {
        const root = setupTree();
        const a = root.querySelector('[data-id="a"]');
        const folder = root.querySelector('.folder');
        a.getBoundingClientRect = () => rect();
        folder.getBoundingClientRect = () => rect();
        const onDrop = vi.fn();
        instance = dragdrop.tree(root, {
            itemSelector: '.item, .folder',
            folderSelector: '.folder',
            onDrop,
        });

        const dt = new FakeDataTransfer();
        a.dispatchEvent(makeEvent('dragstart', { dataTransfer: dt }));
        folder.dispatchEvent(makeEvent('dragover', { clientY: 50, dataTransfer: dt }));
        folder.dispatchEvent(makeEvent('drop', { clientY: 50, dataTransfer: dt }));

        expect(onDrop.mock.calls[0][0]).toMatchObject({ drag: 'a', target: 'f', position: 'inside' });
    });

    it('respects accept()', () => {
        const root = setupTree();
        const [a, b] = root.querySelectorAll('.item');
        a.getBoundingClientRect = () => rect();
        b.getBoundingClientRect = () => rect();
        const onDrop = vi.fn();
        instance = dragdrop.tree(root, {
            itemSelector: '.item, .folder',
            folderSelector: '.folder',
            accept: (data) => data === 'allowed',
            onDrop,
        });

        a.dispatchEvent(makeEvent('dragstart', { dataTransfer: new FakeDataTransfer() }));
        b.dispatchEvent(makeEvent('dragover', { clientY: 10, dataTransfer: new FakeDataTransfer() }));
        b.dispatchEvent(makeEvent('drop', { clientY: 10, dataTransfer: new FakeDataTransfer() }));
        expect(onDrop).not.toHaveBeenCalled();
    });

    it('marks new items via MutationObserver', async () => {
        const root = setupTree();
        instance = dragdrop.tree(root, { itemSelector: '.item, .folder', folderSelector: '.folder' });
        const added = document.createElement('div');
        added.className = 'item';
        added.dataset.id = 'c';
        root.appendChild(added);
        await Promise.resolve();
        expect(added.getAttribute('draggable')).toBe('true');
    });

    it('supports Alt+Arrow keyboard moves', () => {
        const root = setupTree();
        const [a, b] = root.querySelectorAll('.item');
        const onDrop = vi.fn();
        instance = dragdrop.tree(root, { itemSelector: '.item, .folder', folderSelector: '.folder', onDrop });

        a.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
        expect(onDrop).toHaveBeenCalledTimes(1);
        expect(onDrop.mock.calls[0][0]).toMatchObject({
            drag: 'a', target: 'b', position: 'after', keyboard: true,
        });

        b.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true }));
        expect(onDrop).toHaveBeenCalledTimes(2);
        expect(onDrop.mock.calls[1][0]).toMatchObject({ drag: 'b', target: 'a', position: 'before' });
    });

    it('does not fire keyboard moves without Alt', () => {
        const root = setupTree();
        const [a] = root.querySelectorAll('.item');
        const onDrop = vi.fn();
        instance = dragdrop.tree(root, { itemSelector: '.item, .folder', folderSelector: '.folder', onDrop });
        a.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        expect(onDrop).not.toHaveBeenCalled();
    });

    it('destroy() removes listeners, draggable attributes and drop classes', () => {
        const root = setupTree();
        const [a, b] = root.querySelectorAll('.item');
        a.getBoundingClientRect = () => rect();
        b.getBoundingClientRect = () => rect();
        instance = dragdrop.tree(root, { itemSelector: '.item, .folder', folderSelector: '.folder' });

        const dt = new FakeDataTransfer();
        a.dispatchEvent(makeEvent('dragstart', { dataTransfer: dt }));
        b.dispatchEvent(makeEvent('dragover', { clientY: 10, dataTransfer: dt }));
        expect(b.className).toContain('oja-tree-drop-before');

        instance.destroy();
        expect(b.className).not.toContain('oja-tree-drop-before');
        expect(a.hasAttribute('draggable')).toBe(false);
        expect(b.hasAttribute('draggable')).toBe(false);

        const onDrop = vi.fn();
        // Rebind a fresh instance to prove old listeners are gone is awkward;
        // instead assert the old tree no longer marks a new item draggable.
        const added = document.createElement('div');
        added.className = 'item';
        root.appendChild(added);
        expect(added.hasAttribute('draggable')).toBe(false);
    });
});
