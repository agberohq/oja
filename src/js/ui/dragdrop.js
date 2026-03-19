/**
 * oja/dragdrop.js
 * Drag and drop utilities — reorder lists, file drop zones, and draggable elements.
 * Uses native HTML5 drag and drop with progressive enhancement.
 *
 * ─── Reorderable lists ───────────────────────────────────────────────────────
 *
 *   import { dragdrop } from '../oja/dragdrop.js';
 *
 *   // Make a list reorderable
 *   dragdrop.reorder('#host-list', {
 *       onReorder: (items) => {
 *           console.log('New order:', items.map(el => el.dataset.id));
 *           api.post('/hosts/reorder', { order: items.map(el => el.dataset.id) });
 *       },
 *       handle: '.drag-handle',        // Only drag by handle
 *       animation: 150,                // Smooth reorder animation (ms)
 *       ghostClass: 'dragging-ghost',  // Class for dragged element
 *       dragClass: 'dragging',         // Class applied while dragging
 *   });
 *
 * ─── File drop zones ─────────────────────────────────────────────────────────
 *
 *   // Create a file drop zone
 *   dragdrop.dropZone('#upload-area', {
 *       onDrop: (files) => {
 *           Array.from(files).forEach(file => uploadFile(file));
 *       },
 *       accept: ['.jpg', '.png', '.pdf'],
 *       maxSize: 10 * 1024 * 1024,  // 10MB
 *       multiple: true,
 *       onDragOver: () => highlightZone(),
 *       onDragLeave: () => unhighlightZone(),
 *       onError: (error) => notify.error(error),
 *   });
 *
 * ─── Custom drag sources ─────────────────────────────────────────────────────
 *
 *   // Make any element draggable
 *   dragdrop.draggable('.host-card', {
 *       data: (el) => ({ id: el.dataset.id, name: el.dataset.name }),
 *       dragImage: (el) => el.cloneNode(true),  // Custom drag image
 *       onDragStart: (el, event) => console.log('Started dragging', el),
 *       onDragEnd: (el, event) => console.log('Stopped dragging'),
 *   });
 *
 * ─── Custom drop targets ─────────────────────────────────────────────────────
 *
 *   // Make an element accept drops
 *   dragdrop.dropTarget('.folder', {
 *       accept: (el, data) => data.type === 'host',  // Validate dropped data
 *       onDrop: (el, data, event) => {
 *           console.log('Dropped', data, 'on', el);
 *           moveHostToFolder(data.id, el.dataset.folderId);
 *       },
 *       onDragOver: (el) => el.classList.add('can-drop'),
 *       onDragLeave: (el) => el.classList.remove('can-drop'),
 *   });
 *
 * ─── Sortable between lists ──────────────────────────────────────────────────
 *
 *   // Connect multiple lists for cross-list dragging
 *   const sortable = dragdrop.sortable(['#list1', '#list2', '#list3'], {
 *       onEnd: (evt) => {
 *           console.log('Moved item', evt.item, 'from', evt.from, 'to', evt.to);
 *           saveNewOrder(evt);
 *       },
 *       group: 'shared',  // Same group = can drag between lists
 *   });
 *
 * ─── Touch support ───────────────────────────────────────────────────────────
 *
 *   // All features work on touch devices (falls back to pointer events)
 *   dragdrop.reorder('#list', {
 *       touch: true,  // Enable touch support (default: true)
 *       delay: 150,   // Delay before drag starts on touch (prevents scroll interference)
 *   });
 */

// ─── State ────────────────────────────────────────────────────────────────────

const _dragState = {
    active: false,
    source: null,
    data: null,
    ghost: null,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    dropTargets: new Set(),
};

let _animationFrame = null;
let _touchListenersAdded = false;

// ─── Reorderable lists ────────────────────────────────────────────────────────

const _reorderLists = new Map(); // listElement -> { options, observer }

/**
 * Make a list reorderable via drag and drop
 *
 *   dragdrop.reorder('#host-list', {
 *       onReorder: (items) => saveOrder(items),
 *       handle: '.drag-handle',
 *       animation: 150,
 *   });
 */
export function reorder(target, options = {}) {
    const list = typeof target === 'string' ? document.querySelector(target) : target;
    if (!list) {
        console.warn(`[oja/dragdrop] reorder target not found: ${target}`);
        return;
    }

    const defaults = {
        handle: null,
        animation: 150,
        ghostClass: 'oja-drag-ghost',
        dragClass: 'oja-dragging',
        chosenClass: 'oja-drag-chosen',
        onReorder: null,
        onDragStart: null,
        onDragEnd: null,
        onMove: null,
        touch: true,
        delay: 0,
    };

    const opts = { ...defaults, ...options };

    // Store for cleanup
    _reorderLists.set(list, { opts, items: [] });

    // Make all current items draggable
    _initListItems(list, opts);

    // Watch for new items added to the list
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) { // Element node
                    _makeDraggable(node, opts, list);
                }
            });
        });
    });

    observer.observe(list, { childList: true, subtree: true });
    _reorderLists.get(list).observer = observer;

    return {
        destroy: () => _destroyReorder(list)
    };
}

function _initListItems(list, opts) {
    Array.from(list.children).forEach(child => {
        _makeDraggable(child, opts, list);
    });
}

function _makeDraggable(el, opts, list) {
    if (el.draggable) return; // Already initialized

    const dragHandle = opts.handle ? el.querySelector(opts.handle) : el;
    if (!dragHandle) return;

    dragHandle.setAttribute('draggable', 'true');
    dragHandle.style.cursor = 'grab';

    // Store reference to the parent list
    el._dragList = list;
    el._dragOptions = opts;

    // Drag start handler
    dragHandle.addEventListener('dragstart', (e) => {
        e.stopPropagation();

        const item = e.target.closest(opts.handle ? '[draggable="true"]' : null)?.closest('*') || el;

        // Apply classes
        item.classList.add(opts.dragClass);
        item.classList.add(opts.chosenClass);

        // Set drag data
        e.dataTransfer.setData('text/plain', item.id || item.dataset.id || '');
        e.dataTransfer.effectAllowed = 'move';

        // Create custom drag image if specified
        if (opts.ghostClass) {
            const ghost = item.cloneNode(true);
            ghost.classList.add(opts.ghostClass);
            ghost.style.position = 'absolute';
            ghost.style.top = '-1000px';
            document.body.appendChild(ghost);
            e.dataTransfer.setDragImage(ghost, e.offsetX, e.offsetY);
            setTimeout(() => ghost.remove(), 0);
        }

        // Store drag state
        _dragState.active = true;
        _dragState.source = item;
        _dragState.data = {
            id: item.id || item.dataset.id,
            html: item.outerHTML,
            index: Array.from(list.children).indexOf(item)
        };

        if (opts.onDragStart) opts.onDragStart(item, e);
    });

    // Drag end handler
    dragHandle.addEventListener('dragend', (e) => {
        const item = e.target.closest('[draggable="true"]')?.closest('*') || el;

        item.classList.remove(opts.dragClass);
        item.classList.remove(opts.chosenClass);

        _dragState.active = false;
        _dragState.source = null;

        if (opts.onDragEnd) opts.onDragEnd(item, e);
    });

    // Prevent default to allow drop
    dragHandle.addEventListener('dragover', (e) => e.preventDefault());
}

function _destroyReorder(list) {
    const data = _reorderLists.get(list);
    if (data && data.observer) {
        data.observer.disconnect();
    }
    _reorderLists.delete(list);

    // Remove draggable attributes
    Array.from(list.children).forEach(child => {
        if (child._dragOptions) {
            const handle = child._dragOptions.handle ?
                child.querySelector(child._dragOptions.handle) : child;
            if (handle) {
                handle.removeAttribute('draggable');
                handle.style.cursor = '';
            }
        }
    });
}

// ─── File drop zones ──────────────────────────────────────────────────────────

const _dropZones = new Map(); // zoneElement -> options

/**
 * Create a file drop zone
 *
 *   dragdrop.dropZone('#upload-area', {
 *       onDrop: (files) => uploadFiles(files),
 *       accept: ['.jpg', '.png'],
 *       maxSize: 10 * 1024 * 1024,
 *   });
 */
export function dropZone(target, options = {}) {
    const zone = typeof target === 'string' ? document.querySelector(target) : target;
    if (!zone) {
        console.warn(`[oja/dragdrop] dropZone target not found: ${target}`);
        return;
    }

    const defaults = {
        accept: [],
        maxSize: Infinity,
        multiple: true,
        onDrop: null,
        onDragOver: null,
        onDragLeave: null,
        onError: null,
    };

    const opts = { ...defaults, ...options };

    const dragOverHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add('oja-drop-zone-active');
        if (opts.onDragOver) opts.onDragOver(e);
    };

    const dragLeaveHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('oja-drop-zone-active');
        if (opts.onDragLeave) opts.onDragLeave(e);
    };

    const dropHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('oja-drop-zone-active');

        const files = Array.from(e.dataTransfer.files);

        // Filter by accept types
        let validFiles = files;
        if (opts.accept.length > 0) {
            validFiles = files.filter(file => {
                const ext = '.' + file.name.split('.').pop().toLowerCase();
                return opts.accept.some(accept =>
                    accept === ext ||
                    accept === file.type ||
                    (accept.startsWith('.') && accept === ext)
                );
            });

            if (validFiles.length !== files.length && opts.onError) {
                opts.onError('Some files were rejected due to file type restrictions');
            }
        }

        // Filter by size
        if (opts.maxSize < Infinity) {
            validFiles = validFiles.filter(file => file.size <= opts.maxSize);
            if (validFiles.length !== files.length && opts.onError) {
                opts.onError('Some files exceed the maximum size limit');
            }
        }

        // Handle multiple flag
        if (!opts.multiple && validFiles.length > 1) {
            validFiles = [validFiles[0]];
            if (opts.onError) opts.onError('Multiple files not allowed');
        }

        if (opts.onDrop) opts.onDrop(validFiles, e);
    };

    zone.addEventListener('dragover', dragOverHandler);
    zone.addEventListener('dragleave', dragLeaveHandler);
    zone.addEventListener('drop', dropHandler);

    _dropZones.set(zone, { opts, handlers: { dragOverHandler, dragLeaveHandler, dropHandler } });

    return {
        destroy: () => {
            zone.removeEventListener('dragover', dragOverHandler);
            zone.removeEventListener('dragleave', dragLeaveHandler);
            zone.removeEventListener('drop', dropHandler);
            _dropZones.delete(zone);
        }
    };
}

// ─── Custom drag sources ──────────────────────────────────────────────────────

const _dragSources = new WeakMap(); // element -> options

/**
 * Make any element draggable with custom data
 *
 *   dragdrop.draggable('.host-card', {
 *       data: (el) => ({ id: el.dataset.id }),
 *       onDragStart: (el) => console.log('Dragging', el),
 *   });
 */
export function draggable(target, options = {}) {
    const elements = typeof target === 'string'
        ? Array.from(document.querySelectorAll(target))
        : [target];

    const defaults = {
        data: (el) => ({ id: el.id || el.dataset.id }),
        dragImage: null,
        onDragStart: null,
        onDragEnd: null,
        handle: null,
    };

    const opts = { ...defaults, ...options };

    elements.forEach(el => {
        const dragHandle = opts.handle ? el.querySelector(opts.handle) : el;
        if (!dragHandle) return;

        dragHandle.setAttribute('draggable', 'true');
        dragHandle.style.cursor = 'grab';

        const dragStartHandler = (e) => {
            e.stopPropagation();

            const data = opts.data(el);
            e.dataTransfer.setData('text/plain', JSON.stringify(data));
            e.dataTransfer.effectAllowed = 'move';

            if (opts.dragImage) {
                const img = opts.dragImage(el);
                if (img instanceof Element) {
                    document.body.appendChild(img);
                    e.dataTransfer.setDragImage(img, e.offsetX, e.offsetY);
                    setTimeout(() => img.remove(), 0);
                }
            }

            el.classList.add('oja-dragging-source');
            _dragState.active = true;
            _dragState.source = el;
            _dragState.data = data;

            if (opts.onDragStart) opts.onDragStart(el, e, data);
        };

        const dragEndHandler = (e) => {
            el.classList.remove('oja-dragging-source');
            _dragState.active = false;
            if (opts.onDragEnd) opts.onDragEnd(el, e);
        };

        dragHandle.addEventListener('dragstart', dragStartHandler);
        dragHandle.addEventListener('dragend', dragEndHandler);

        _dragSources.set(el, { opts, handlers: { dragStartHandler, dragEndHandler } });
    });

    return {
        destroy: () => {
            elements.forEach(el => {
                const data = _dragSources.get(el);
                if (data) {
                    const handle = data.opts.handle ? el.querySelector(data.opts.handle) : el;
                    if (handle) {
                        handle.removeEventListener('dragstart', data.handlers.dragStartHandler);
                        handle.removeEventListener('dragend', data.handlers.dragEndHandler);
                        handle.removeAttribute('draggable');
                        handle.style.cursor = '';
                    }
                    _dragSources.delete(el);
                }
            });
        }
    };
}

// ─── Custom drop targets ──────────────────────────────────────────────────────

const _dropTargets = new WeakMap(); // element -> options

/**
 * Make an element accept drops
 *
 *   dragdrop.dropTarget('.folder', {
 *       accept: (el, data) => data.type === 'host',
 *       onDrop: (el, data) => moveToFolder(data.id, el.dataset.folderId),
 *   });
 */
export function dropTarget(target, options = {}) {
    const elements = typeof target === 'string'
        ? Array.from(document.querySelectorAll(target))
        : [target];

    const defaults = {
        accept: () => true,
        onDrop: null,
        onDragOver: null,
        onDragLeave: null,
        activeClass: 'oja-drop-target-active',
    };

    const opts = { ...defaults, ...options };

    elements.forEach(el => {
        const dragOverHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();

            try {
                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                if (opts.accept(el, data)) {
                    e.dataTransfer.dropEffect = 'move';
                    el.classList.add(opts.activeClass);
                    if (opts.onDragOver) opts.onDragOver(el, e, data);
                } else {
                    e.dataTransfer.dropEffect = 'none';
                }
            } catch {
                // Not JSON data, check if it's files
                if (e.dataTransfer.files.length > 0) {
                    if (opts.accept(el, { files: e.dataTransfer.files })) {
                        e.dataTransfer.dropEffect = 'move';
                        el.classList.add(opts.activeClass);
                    }
                }
            }
        };

        const dragLeaveHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            el.classList.remove(opts.activeClass);
            if (opts.onDragLeave) opts.onDragLeave(el, e);
        };

        const dropHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            el.classList.remove(opts.activeClass);

            try {
                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                if (opts.accept(el, data)) {
                    if (opts.onDrop) opts.onDrop(el, data, e);
                }
            } catch {
                // Handle file drop
                if (e.dataTransfer.files.length > 0 && opts.accept(el, { files: e.dataTransfer.files })) {
                    if (opts.onDrop) opts.onDrop(el, { files: e.dataTransfer.files }, e);
                }
            }
        };

        el.addEventListener('dragover', dragOverHandler);
        el.addEventListener('dragleave', dragLeaveHandler);
        el.addEventListener('drop', dropHandler);

        _dropTargets.set(el, { opts, handlers: { dragOverHandler, dragLeaveHandler, dropHandler } });
    });

    return {
        destroy: () => {
            elements.forEach(el => {
                const data = _dropTargets.get(el);
                if (data) {
                    el.removeEventListener('dragover', data.handlers.dragOverHandler);
                    el.removeEventListener('dragleave', data.handlers.dragLeaveHandler);
                    el.removeEventListener('drop', data.handlers.dropHandler);
                    _dropTargets.delete(el);
                }
            });
        }
    };
}

// ─── Sortable between lists ───────────────────────────────────────────────────

/**
 * Create sortable lists that can exchange items
 *
 *   const sortable = dragdrop.sortable(['#list1', '#list2'], {
 *       onEnd: (evt) => saveChanges(evt),
 *       group: 'shared',
 *   });
 */
export function sortable(lists, options = {}) {
    const elements = lists.map(list =>
        typeof list === 'string' ? document.querySelector(list) : list
    ).filter(Boolean);

    const defaults = {
        group: 'default',
        animation: 150,
        onStart: null,
        onEnd: null,
        onAdd: null,
        onRemove: null,
        onUpdate: null,
        handle: null,
        draggable: '.sortable-item',
    };

    const opts = { ...defaults, ...options };

    // Make each list a reorderable list and drop target
    const instances = elements.map(list => {
        const reorderInstance = reorder(list, {
            handle: opts.handle,
            animation: opts.animation,
            onDragStart: (item, e) => {
                item._sourceList = list;
                if (opts.onStart) opts.onStart({ item, from: list, originalEvent: e });
            },
            onDragEnd: (item, e) => {
                if (opts.onEnd) opts.onEnd({
                    item,
                    from: item._sourceList,
                    to: item._targetList || item._sourceList,
                    originalEvent: e
                });
                delete item._sourceList;
                delete item._targetList;
            },
        });

        const targetInstance = dropTarget(list, {
            accept: (el, data) => true, // Accept anything from same group
            onDrop: (listEl, data, e) => {
                const item = _dragState.source;
                if (!item || item._sourceList === listEl) return;

                // Move the element
                item._targetList = listEl;
                listEl.appendChild(item);

                if (opts.onAdd) opts.onAdd({ item, from: item._sourceList, to: listEl });
                if (opts.onUpdate) opts.onUpdate({ item, from: item._sourceList, to: listEl });
            },
            onDragOver: (listEl) => listEl.classList.add('sortable-active'),
            onDragLeave: (listEl) => listEl.classList.remove('sortable-active'),
        });

        return { list, reorderInstance, targetInstance };
    });

    return {
        destroy: () => {
            instances.forEach(inst => {
                if (inst.reorderInstance) inst.reorderInstance.destroy();
                if (inst.targetInstance) inst.targetInstance.destroy();
            });
        }
    };
}

// ─── Touch support ────────────────────────────────────────────────────────────

/**
 * Enable touch drag and drop for all draggable elements
 * This is automatically enabled by default, but can be disabled
 */
export function enableTouchSupport() {
    if (_touchListenersAdded) return;

    const handleTouchStart = (e) => {
        const target = e.target.closest('[draggable="true"]');
        if (!target) return;

        const dragItem = target.closest('*');
        if (!dragItem) return;

        e.preventDefault();

        const touch = e.touches[0];
        _dragState.startX = touch.clientX;
        _dragState.startY = touch.clientY;
        _dragState.source = dragItem;

        // Clone as ghost
        _dragState.ghost = dragItem.cloneNode(true);
        _dragState.ghost.style.position = 'fixed';
        _dragState.ghost.style.zIndex = '9999';
        _dragState.ghost.style.opacity = '0.8';
        _dragState.ghost.style.pointerEvents = 'none';
        _dragState.ghost.style.width = dragItem.offsetWidth + 'px';
        _dragState.ghost.style.left = touch.clientX + 'px';
        _dragState.ghost.style.top = touch.clientY + 'px';
        _dragState.ghost.classList.add('oja-touch-drag-ghost');

        document.body.appendChild(_dragState.ghost);
        dragItem.classList.add('oja-touch-drag-original');
    };

    const handleTouchMove = (e) => {
        if (!_dragState.ghost || !_dragState.source) return;

        e.preventDefault();

        const touch = e.touches[0];
        _dragState.currentX = touch.clientX;
        _dragState.currentY = touch.clientY;

        if (_animationFrame) {
            cancelAnimationFrame(_animationFrame);
        }

        _animationFrame = requestAnimationFrame(() => {
            if (_dragState.ghost) {
                _dragState.ghost.style.left = (_dragState.currentX - 20) + 'px';
                _dragState.ghost.style.top = (_dragState.currentY - 20) + 'px';
            }

            // Find drop targets under touch point
            const elementsAtPoint = document.elementsFromPoint(_dragState.currentX, _dragState.currentY);
            for (const el of elementsAtPoint) {
                if (_dropTargets.has(el)) {
                    el.classList.add('oja-touch-target-active');
                }
            }
        });
    };

    const handleTouchEnd = (e) => {
        if (!_dragState.ghost || !_dragState.source) return;

        e.preventDefault();

        // Find drop target
        const elementsAtPoint = document.elementsFromPoint(_dragState.currentX, _dragState.currentY);
        for (const el of elementsAtPoint) {
            if (_dropTargets.has(el)) {
                const data = _dragSources.get(_dragState.source)?.opts?.data?.(_dragState.source) || {};
                const dropHandler = _dropTargets.get(el)?.opts?.onDrop;
                if (dropHandler) {
                    dropHandler(el, data, e);
                }
                break;
            }
        }

        // Clean up
        if (_dragState.ghost) {
            _dragState.ghost.remove();
        }
        _dragState.source?.classList.remove('oja-touch-drag-original');

        _dragState.ghost = null;
        _dragState.source = null;

        if (_animationFrame) {
            cancelAnimationFrame(_animationFrame);
            _animationFrame = null;
        }
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: false });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchEnd);

    _touchListenersAdded = true;

    return () => {
        document.removeEventListener('touchstart', handleTouchStart);
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
        document.removeEventListener('touchcancel', handleTouchEnd);
        _touchListenersAdded = false;
    };
}

// ─── Export all ───────────────────────────────────────────────────────────────

export const dragdrop = {
    reorder,
    dropZone,
    draggable,
    dropTarget,
    sortable,
    enableTouchSupport,
};

// Auto-enable touch support by default
if (typeof window !== 'undefined' && 'ontouchstart' in window) {
    enableTouchSupport();
}