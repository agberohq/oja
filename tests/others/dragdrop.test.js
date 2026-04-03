import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dragdrop } from '../../src/js/ui/dragdrop.js';

describe('dragdrop.dropZone', () => {
    let zoneEl;

    // Reset the DOM before every test
    beforeEach(() => {
        document.body.innerHTML = '<div id="test-zone"></div>';
        zoneEl = document.getElementById('test-zone');
    });

    /**
     * Helper to mock DragEvents.
     * JSDOM doesn't support DataTransfer, so we attach a fake one manually.
     */
    function dispatchDragEvent(element, type, files = []) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        event.dataTransfer = {
            files,
            dropEffect: 'none',
            types: ['Files']
        };
        element.dispatchEvent(event);
        return event;
    }

    it('should initialize without throwing errors (catches _dropZones bug)', () => {
        // If _dropZones is not defined, this initialization will immediately crash.
        expect(() => {
            dragdrop.dropZone(zoneEl, {
                onDrop: () => {}
            });
        }).not.toThrow();
    });

    it('should add and remove active class on dragover and dragleave', () => {
        dragdrop.dropZone(zoneEl);

        // Simulate dragging a file over the element
        dispatchDragEvent(zoneEl, 'dragover');
        expect(zoneEl.classList.contains('oja-drop-zone-active')).toBe(true);

        // Simulate dragging the file away
        dispatchDragEvent(zoneEl, 'dragleave');
        expect(zoneEl.classList.contains('oja-drop-zone-active')).toBe(false);
    });

    it('should trigger onDrop with valid files and remove active class', () => {
        const onDropMock = vi.fn();
        dragdrop.dropZone(zoneEl, { onDrop: onDropMock });

        const fakeFile = new File(['test content'], 'test.txt', { type: 'text/plain' });

        dispatchDragEvent(zoneEl, 'dragover');
        dispatchDragEvent(zoneEl, 'drop', [fakeFile]);

        // It should clean up the CSS class
        expect(zoneEl.classList.contains('oja-drop-zone-active')).toBe(false);

        // It should fire the callback with the array of files
        expect(onDropMock).toHaveBeenCalledTimes(1);
        expect(onDropMock).toHaveBeenCalledWith([fakeFile], expect.any(Event));
    });

    it('should reject files that do not match the accept option', () => {
        const onDropMock = vi.fn();
        const onErrorMock = vi.fn();

        dragdrop.dropZone(zoneEl, {
            accept: ['.jpg'],
            onDrop: onDropMock,
            onError: onErrorMock
        });

        // Try dropping a PNG instead of a JPG
        const badFile = new File(['fake img'], 'test.png', { type: 'image/png' });

        dispatchDragEvent(zoneEl, 'drop', [badFile]);

        // It should NOT pass the bad file to onDrop
        expect(onDropMock).toHaveBeenCalledWith([], expect.any(Event));

        // It SHOULD trigger the onError callback
        expect(onErrorMock).toHaveBeenCalledWith('Some files were rejected due to file type restrictions');
    });

    it('should properly clean up event listeners when destroyed', () => {
        const instance = dragdrop.dropZone(zoneEl);

        // Destroy it
        instance.destroy();

        // Trigger a dragover
        dispatchDragEvent(zoneEl, 'dragover');

        // If it was destroyed properly, the event listener is gone,
        // so the active class should NOT be added.
        expect(zoneEl.classList.contains('oja-drop-zone-active')).toBe(false);
    });
});