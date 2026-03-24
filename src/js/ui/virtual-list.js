/**
 * oja/virtual-list.js
 * High-performance virtual scroller for rendering 10k+ items.
 * Only renders items currently visible in the viewport + a small overscan buffer.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { virtualList } from '../oja/virtual-list.js';
 *
 *   const list = virtualList.render('#container', dataArray, {
 *       itemHeight: 40,
 *       overscan: 5, // Render 5 items outside view to prevent flashing
 *       renderItem: (item, index) => `<div class="row">${item.name}</div>`
 *   });
 *
 *   // When data updates
 *   list.update(newDataArray);
 */

import { Out } from '../core/out.js';

function _resolve(target) {
    if (!target) return null;
    if (target instanceof Element) return target;
    return document.querySelector(target);
}

export const virtualList = {
    render(target, items =[], options = {}) {
        const el = _resolve(target);
        if (!el) return null;

        const {
            itemHeight = 40,
            overscan = 5,
            renderItem = null,
        } = options;

        if (!renderItem) throw new Error('[oja/virtual-list] renderItem function is required');

        let currentItems = items;
        let lastStartIndex = -1;
        let lastEndIndex = -1;

        // Container setup
        el.style.overflowY = 'auto';
        el.style.position = 'relative';

        // Fake height to force native scrollbar
        let spacer = el.querySelector('.oja-vl-spacer');
        let content = el.querySelector('.oja-vl-content');

        if (!spacer) {
            spacer = document.createElement('div');
            spacer.className = 'oja-vl-spacer';
            spacer.style.width = '1px';
            spacer.style.position = 'absolute';
            spacer.style.top = '0';
            spacer.style.left = '0';

            content = document.createElement('div');
            content.className = 'oja-vl-content';
            content.style.position = 'absolute';
            content.style.top = '0';
            content.style.left = '0';
            content.style.right = '0';

            el.innerHTML = '';
            el.appendChild(spacer);
            el.appendChild(content);
        }

        const draw = () => {
            spacer.style.height = `${currentItems.length * itemHeight}px`;

            const scrollTop = el.scrollTop;
            const viewportHeight = el.clientHeight;

            let startIndex = Math.floor(scrollTop / itemHeight) - overscan;
            let endIndex = Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan;

            startIndex = Math.max(0, startIndex);
            endIndex = Math.min(currentItems.length, endIndex);

            // Skip redraw only when both start AND end are unchanged.
            // If the container was resized to show more items, endIndex grows
            // even though startIndex hasn't moved — we still need to redraw.
            if (startIndex === lastStartIndex && endIndex === lastEndIndex) return;
            lastStartIndex = startIndex;
            lastEndIndex = endIndex;

            content.style.transform = `translateY(${startIndex * itemHeight}px)`;
            content.innerHTML = '';

            for (let i = startIndex; i < endIndex; i++) {
                const item = currentItems[i];
                const res = renderItem(item, i);

                if (Out.is(res)) {
                    const wrap = document.createElement('div');
                    wrap.style.height = `${itemHeight}px`;
                    res.render(wrap);
                    content.appendChild(wrap);
                } else if (typeof res === 'string') {
                    content.insertAdjacentHTML('beforeend', res);
                } else if (res instanceof Element) {
                    content.appendChild(res);
                }
            }
        };

        const onScroll = () => requestAnimationFrame(draw);
        el.addEventListener('scroll', onScroll, { passive: true });

        // Re-draw when the container is resized (panel drag, sidebar collapse, window resize).
        // Without this, clientHeight is stale and items near the bottom are not rendered.
        let ro = null;
        if (typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(() => {
                lastStartIndex = -1;
                lastEndIndex = -1;
                draw();
            });
            ro.observe(el);
        }

        // Initial paint
        requestAnimationFrame(draw);

        return {
            update(newItems) {
                currentItems = newItems;
                lastStartIndex = -1; // Force redraw
                lastEndIndex = -1;
                draw();
            },
            destroy() {
                el.removeEventListener('scroll', onScroll);
                if (ro) ro.disconnect();
                el.innerHTML = '';
            }
        };
    }
};