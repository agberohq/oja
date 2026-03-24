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
 *       accept:['.jpg', '.png', '.pdf'],
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

const _reorderLists = new Map(); // listElement -> { opts, observer }

/**
 * Make a list reorderable via drag and drop.
 * Items can be dragged to any position within the list; onReorder fires
 * after every successful drop with the new ordered array of child elements.
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

    _reorderLists.set(list, { opts, items:[] });

    _initListItems(list, opts);

    // Wire drop handling on the list itself so items dropped anywhere within
    // it are caught, including drops between items and at the end of the list.
    _setupListDrop(list, opts);

    const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) {
                    _makeDraggable(node, opts, list);
                }
            });
        });
    });

    observer.observe(list, { childList: true, subtree: false });
    _reorderLists.get(list).observer = observer;

    return {
        destroy: () => _destroyReorder(list),
    };
}

function _initListItems(list, opts) {
    Array.from(list.children).forEach(child => {
        _makeDraggable(child, opts, list);
    });
}

function _makeDraggable(el, opts, list) {
    if (el.dataset.ojaDraggable) return;
    el.dataset.ojaDraggable = 'true';

    const dragHandle = opts.handle ? el.querySelector(opts.handle) : el;
    if (!dragHandle) return;

    dragHandle.setAttribute('draggable', 'true');
    dragHandle.style.cursor = 'grab';

    el._dragList = list;
    el._dragOptions = opts;

    dragHandle.addEventListener('dragstart', (e) => {
        e.stopPropagation();

        const item = opts.handle ? el : e.currentTarget;

        item.classList.add(opts.dragClass);
        item.classList.add(opts.chosenClass);

        e.dataTransfer.setData('text/plain', item.id || item.dataset.id || '');
        e.dataTransfer.effectAllowed = 'move';

        if (opts.ghostClass) {
            const ghost = item.cloneNode(true);
            ghost.classList.add(opts.ghostClass);
            ghost.style.position = 'absolute';
            ghost.style.top = '-1000px';
            document.body.appendChild(ghost);
            e.dataTransfer.setDragImage(ghost, e.offsetX, e.offsetY);
            setTimeout(() => ghost.remove(), 0);
        }

        _dragState.active = true;
        _dragState.source = el;
        _dragState.data = {
            id: el.id || el.dataset.id,
            html: el.outerHTML,
            index: Array.from(list.children).indexOf(el),
        };

        if (opts.onDragStart) opts.onDragStart(el, e);
    });

    dragHandle.addEventListener('dragend', (e) => {
        el.classList.remove(opts.dragClass);
        el.classList.remove(opts.chosenClass);
        el.style.opacity = '';

        // Remove any placeholder inserted during the drag
        const placeholder = list.querySelector('.oja-drag-placeholder');
        if (placeholder) placeholder.remove();

        _dragState.active = false;
        _dragState.source = null;

        if (opts.onDragEnd) opts.onDragEnd(el, e);
    });

    // dragover on the item itself controls the visual insertion point.
    // We show a placeholder above or below based on cursor position.
    dragHandle.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const dragging = _dragState.source;
        if (!dragging || dragging === el) return;

        const rect = el.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const after = e.clientY > midY;

        _movePlaceholder(list, el, after, dragging);
    });
}

/**
 * Set up the drop handler on the list container.
 * This is what was entirely missing — without a drop listener on the list,
 * releasing the mouse over a list item does nothing; the browser cancels the
 * drag and the DOM is never updated.
 */
function _setupListDrop(list, opts) {
    list.addEventListener('dragover', (e) => {
        // Allow drops on the list background (between all items or after the last).
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    });

    list.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const dragging = _dragState.source;
        if (!dragging) return;

        // Remove the visual placeholder
        const placeholder = list.querySelector('.oja-drag-placeholder');
        if (placeholder) {
            // Insert the real element where the placeholder is sitting
            list.insertBefore(dragging, placeholder);
            placeholder.remove();
        } else {
            // No placeholder (drop landed on the list background) — append
            list.appendChild(dragging);
        }

        dragging.style.opacity = '';

        if (opts.onReorder) {
            opts.onReorder(Array.from(list.children));
        }
    });

    // Clean up placeholder if the drag leaves the list entirely
    list.addEventListener('dragleave', (e) => {
        // Only fire if the pointer has genuinely left the list, not just
        // moved to a child element (relatedTarget is still inside the list).
        if (list.contains(e.relatedTarget)) return;
        const placeholder = list.querySelector('.oja-drag-placeholder');
        if (placeholder) placeholder.remove();
    });
}

/**
 * Show a thin placeholder element at the insertion point so the user can
 * see exactly where the dragged item will land before releasing.
 */
function _movePlaceholder(list, referenceEl, insertAfter, dragging) {
    let placeholder = list.querySelector('.oja-drag-placeholder');
    if (!placeholder) {
        placeholder = document.createElement('div');
        placeholder.className = 'oja-drag-placeholder';
        placeholder.style.cssText = 'height:2px;background:var(--oja-accent,#4f8ef7);margin:2px 0;border-radius:1px;pointer-events:none;';
    }

    if (insertAfter) {
        referenceEl.after(placeholder);
    } else {
        referenceEl.before(placeholder);
    }

    // Dim the source item so the list doesn't look like it has a duplicate
    dragging.style.opacity = '0.4';
}

function _destroyReorder(list) {
    const data = _reorderLists.get(list);
    if (data?.observer) data.observer.disconnect();
    _reorderLists.delete(list);

    Array.from(list.children).forEach(child => {
        if (child._dragOptions) {
            const handle = child._dragOptions.handle
                ? child.querySelector(child._dragOptions.handle)
                : child;
            if (handle) {
                handle.removeAttribute('draggable');
                handle.style.cursor = '';
            }
            delete child._dragList;
            delete child._dragOptions;
            delete child.dataset.ojaDraggable;
        }
    });
}

// ─── File drop zones ──────────────────────────────────────────────────────────

const _dropZones = new Map(); // zoneElement -> options

/**
 * Create a file drop zone.
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
        accept:[],
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

        if (opts.maxSize < Infinity) {
            const before = validFiles.length;
            validFiles = validFiles.filter(file => file.size <= opts.maxSize);
            if (validFiles.length !== before && opts.onError) {
                opts.onError('Some files exceed the maximum size limit');
            }
        }

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
        },
    };
}

// ─── Custom drag sources ──────────────────────────────────────────────────────

const _dragSources = new WeakMap(); // element -> options

/**
 * Make any element draggable with custom data.
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
        },
    };
}

// ─── Custom drop targets ──────────────────────────────────────────────────────

const _dropTargets = new WeakMap(); // element -> options

/**
 * Make an element accept drops.
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
        },
    };
}

// ─── Sortable between lists ───────────────────────────────────────────────────

/**
 * Create sortable lists that can exchange items.
 * Items dropped into another list are inserted at the cursor position,
 * not blindly appended to the end.
 *
 *   const sortable = dragdrop.sortable(['#list1', '#list2'], {
 *       onEnd: (evt) => saveChanges(evt),
 *       group: 'shared',
 *   });
 */
export function sortable(lists, options = {}) {
    const elements = lists
        .map(list => typeof list === 'string' ? document.querySelector(list) : list)
        .filter(Boolean);

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
                    originalEvent: e,
                });
                delete item._sourceList;
                delete item._targetList;
            },
        });

        const targetInstance = dropTarget(list, {
            accept: () => true,
            onDrop: (listEl, data, e) => {
                const item = _dragState.source;
                if (!item || item._sourceList === listEl) return;

                // Insert at the position nearest the drop point rather than
                // appending at the end, which would always feel wrong when
                // dropping into the middle of a populated list.
                const children = Array.from(listEl.children);
                let insertBefore = null;

                for (const child of children) {
                    const rect = child.getBoundingClientRect();
                    if (e.clientY < rect.top + rect.height / 2) {
                        insertBefore = child;
                        break;
                    }
                }

                item._targetList = listEl;
                if (insertBefore) {
                    listEl.insertBefore(item, insertBefore);
                } else {
                    listEl.appendChild(item);
                }

                if (opts.onAdd)    opts.onAdd({ item, from: item._sourceList, to: listEl });
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
                inst.reorderInstance?.destroy();
                inst.targetInstance?.destroy();
            });
        },
    };
}

// ─── Touch support ────────────────────────────────────────────────────────────

/**
 * Enable touch drag and drop for all draggable elements.
 * Called automatically on touch devices; call manually only if you have
 * cleaned up a previous instance via the returned dispose function.
 *
 * Returns a dispose function that removes the listeners and resets state,
 * allowing touch support to be re-enabled cleanly if needed.
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

        if (_animationFrame) cancelAnimationFrame(_animationFrame);

        _animationFrame = requestAnimationFrame(() => {
            if (_dragState.ghost) {
                _dragState.ghost.style.left = (_dragState.currentX - 20) + 'px';
                _dragState.ghost.style.top  = (_dragState.currentY - 20) + 'px';
            }

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

        const elementsAtPoint = document.elementsFromPoint(_dragState.currentX, _dragState.currentY);
        for (const el of elementsAtPoint) {
            if (_dropTargets.has(el)) {
                const data = _dragSources.get(_dragState.source)?.opts?.data?.(_dragState.source) || {};
                const handler = _dropTargets.get(el)?.opts?.onDrop;
                if (handler) handler(el, data, e);
                break;
            }
        }

        _dragState.ghost.remove();
        _dragState.source?.classList.remove('oja-touch-drag-original');

        _dragState.ghost  = null;
        _dragState.source = null;

        if (_animationFrame) {
            cancelAnimationFrame(_animationFrame);
            _animationFrame = null;
        }
    };

    document.addEventListener('touchstart',  handleTouchStart, { passive: false });
    document.addEventListener('touchmove',   handleTouchMove,  { passive: false });
    document.addEventListener('touchend',    handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchEnd);

    _touchListenersAdded = true;

    return () => {
        document.removeEventListener('touchstart',  handleTouchStart);
        document.removeEventListener('touchmove',   handleTouchMove);
        document.removeEventListener('touchend',    handleTouchEnd);
        document.removeEventListener('touchcancel', handleTouchEnd);
        _touchListenersAdded = false;
    };
}

// Pointer-based resize handle for panels, sidebars, and console drawers.
// Unlike draggable(), this tracks continuous pixel deltas — not HTML5 drag events.
// Returns a destroy() function to remove all listeners.
//
//   dragdrop.resizable('#split-handle', {
//       axis: 'horizontal',
//       onResize: (delta, pointerEvent) => applyWidth(currentW + delta.x),
//       onStart: () => document.body.style.userSelect = 'none',
//       onEnd:   () => document.body.style.userSelect = '',
//       cursor:  'col-resize',
//   });
export function resizable(target, options = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) {
        console.warn(`[oja/dragdrop] resizable target not found: ${target}`);
        return { destroy: () => {} };
    }

    const {
        axis     = 'horizontal',
        onResize = null,
        onStart  = null,
        onEnd    = null,
        cursor   = axis === 'horizontal' ? 'col-resize' : 'ns-resize',
        minDelta = 0,
    } = options;

    let active   = false;
    let originX  = 0;
    let originY  = 0;
    let lastX    = 0;
    let lastY    = 0;

    const onPointerDown = (e) => {
        active  = true;
        originX = e.clientX;
        originY = e.clientY;
        lastX   = e.clientX;
        lastY   = e.clientY;

        el.setPointerCapture(e.pointerId);
        el.classList.add('oja-resizing');

        if (cursor) {
            document.body.style.cursor    = cursor;
            document.body.style.userSelect = 'none';
        }

        if (onStart) onStart(e);
    };

    const onPointerMove = (e) => {
        if (!active) return;

        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;

        lastX = e.clientX;
        lastY = e.clientY;

        const totalX = e.clientX - originX;
        const totalY = e.clientY - originY;

        if (onResize) {
            const delta = {
                x:      dx,
                y:      dy,
                totalX,
                totalY,
            };

            if (axis === 'horizontal' && Math.abs(dx) >= minDelta) onResize(delta, e);
            else if (axis === 'vertical' && Math.abs(dy) >= minDelta) onResize(delta, e);
            else if (axis === 'both') onResize(delta, e);
        }
    };

    const onPointerUp = (e) => {
        if (!active) return;
        active = false;

        el.classList.remove('oja-resizing');

        if (cursor) {
            document.body.style.cursor     = '';
            document.body.style.userSelect = '';
        }

        if (onEnd) onEnd(e);
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup',   onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);

    return {
        destroy() {
            el.removeEventListener('pointerdown',   onPointerDown);
            el.removeEventListener('pointermove',   onPointerMove);
            el.removeEventListener('pointerup',     onPointerUp);
            el.removeEventListener('pointercancel', onPointerUp);
        },
    };
}

// ─── Canvas helpers ────────────────────────────────────────────────────────

export function canvas(target, options = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) {
        console.warn('[oja/dragdrop] canvas target not found');
        return { destroy: () => {} };
    }

    const { onPanStart, onPanEnd, onPan, onZoom, zoomSpeed = 0.001 } = options;

    let active = false;
    let lastX = 0, lastY = 0;

    const onPointerDown = (e) => {
        if (e.button !== 0) return;
        active = true;
        lastX = e.clientX;
        lastY = e.clientY;
        if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
        if (onPanStart) onPanStart(e);
    };

    const onPointerMove = (e) => {
        if (!active) return;
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        if (onPan) onPan(dx, dy, e);
    };

    const onPointerUp = (e) => {
        if (!active) return;
        active = false;
        if (el.releasePointerCapture) el.releasePointerCapture(e.pointerId);
        if (onPanEnd) onPanEnd(e);
    };

    const onWheel = (e) => {
        if (onZoom) {
            e.preventDefault();
            const scale = e.deltaY < 0 ? 1 + Math.abs(e.deltaY) * zoomSpeed : 1 / (1 + Math.abs(e.deltaY) * zoomSpeed);
            onZoom(scale, e.clientX, e.clientY, e);
        }
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    if (onZoom) el.addEventListener('wheel', onWheel, { passive: false });

    return {
        destroy: () => {
            el.removeEventListener('pointerdown', onPointerDown);
            el.removeEventListener('pointermove', onPointerMove);
            el.removeEventListener('pointerup', onPointerUp);
            el.removeEventListener('pointercancel', onPointerUp);
            if (onZoom) el.removeEventListener('wheel', onWheel);
        }
    };
}

export function transformable(target, options = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) {
        console.warn('[oja/dragdrop] transformable target not found');
        return { destroy: () => {}, setVisible: () => {} };
    }

    const style = getComputedStyle(el);
    if (style.position === 'static' || !style.position) {
        el.style.position = 'relative';
    }

    const handles = options.handles ||['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'rotate'];
    const elements =[];

    handles.forEach(h => {
        const handle = document.createElement('div');
        handle.className = `oja-transform-handle oja-handle-${h}`;
        if (h === 'rotate') handle.style.borderRadius = '50%';
        el.appendChild(handle);
        elements.push(handle);
    });

    return {
        setVisible: (visible) => {
            elements.forEach(h => h.style.display = visible ? '' : 'none');
        },
        destroy: () => {
            elements.forEach(h => h.remove());
        }
    };
}

export function selectionBox(target, options = {}) {
    const container = typeof target === 'string' ? document.querySelector(target) : target;
    if (!container) {
        console.warn('[oja/dragdrop] selectionBox target not found');
        return { destroy: () => {} };
    }

    const { className = 'oja-selection-rect', onStart } = options;
    let rect = null;

    const onPointerDown = (e) => {
        if (e.button === 2) return; // ignore right click
        rect = document.createElement('div');
        rect.className = className;
        container.appendChild(rect);
        if (onStart) onStart(e);
    };

    const onPointerUp = () => {
        if (rect) {
            rect.remove();
            rect = null;
        }
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);

    return {
        destroy: () => {
            container.removeEventListener('pointerdown', onPointerDown);
            container.removeEventListener('pointerup', onPointerUp);
            container.removeEventListener('pointercancel', onPointerUp);
            if (rect) {
                rect.remove();
                rect = null;
            }
        }
    };
}

// Export

export const dragdrop = {
    reorder,
    dropZone,
    draggable,
    dropTarget,
    sortable,
    resizable,
    enableTouchSupport,
    canvas,
    transformable,
    selectionBox,
};

// Auto-enable touch support on touch-capable devices
if (typeof window !== 'undefined' && 'ontouchstart' in window) {
    enableTouchSupport();
}