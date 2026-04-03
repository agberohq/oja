/**
 * js/pagination.js
 *
 * Pagination primitive for Oja apps.
 *
 * Design rules:
 *   - Pure logic + one render function. No DOM side-effects outside render().
 *   - Uses Oja's on() delegation — event listeners are registered ONCE on the
 *     wrapper element, never inside a loop, never re-registered on re-render.
 *   - render() returns an HTML string. The caller decides where it goes.
 *   - mount(container) wires everything: renders, delegates, re-renders on change.
 *   - Works for both local arrays (paginate(data)) and remote data (updateTotal).
 *
 * Usage — local array:
 *
 *   import { pagination } from '../js/pagination.js';
 *
 *   const pg = pagination({ pageSize: 20, onPageChange: (page, size) => syncList() });
 *   pg.updateTotal(allHosts.length);
 *   const stop = pg.mount(document.getElementById('hostsPager'));
 *
 *   function syncList() {
 *       const slice = pg.slice(allHosts);   // returns the current page slice
 *       renderHosts(slice);
 *       // pg.mount() re-renders the controls automatically
 *   }
 *
 *   // On unmount:
 *   stop();
 *
 * Usage — remote data:
 *
 *   const pg = pagination({
 *       pageSize: 25,
 *       onPageChange: async (page, size) => {
 *           const data = await fetchPage(page, size);
 *           pg.updateTotal(data.total);
 *           renderRows(data.items);
 *       }
 *   });
 *   pg.mount(document.getElementById('pager'));
 */

import { state, effect } from '../core/reactive.js';

/**
 * Create a pagination controller.
 *
 * @param {object}   opts
 * @param {number}   [opts.pageSize=25]          - Items per page
 * @param {number}   [opts.page=1]               - Initial page (1-indexed)
 * @param {number}   [opts.total=0]              - Total item count
 * @param {number}   [opts.maxButtons=7]         - Max page buttons before ellipsis
 * @param {number[]} [opts.pageSizes=[25,50,100]] - Available page size options
 * @param {boolean}  [opts.showSizeSelector=true]
 * @param {Function} [opts.onPageChange]         - (page, pageSize) => void
 */
export function pagination(opts = {}) {
    const {
        pageSize:   initSize  = 25,
        page:       initPage  = 1,
        total:      initTotal = 0,
        maxButtons            = 7,
        pageSizes             = [25, 50, 100],
        showSizeSelector      = true,
        onPageChange          = null,
    } = opts;

    // Reactive state (three primitives only)
    // totalPages, startIdx, endIdx are pure computed functions — no derived(),
    // no async scheduling, always immediately consistent with state.

    const [total,    setTotal]    = state(initTotal);
    const [pageSize, setPageSize] = state(initSize);
    const [page,     setPage]     = state(initPage);

    // Pure computed — read current state, return result synchronously
    const totalPages = () => Math.max(1, Math.ceil(total() / pageSize()));
    const startIdx   = () => (page() - 1) * pageSize();
    const endIdx     = () => Math.min(startIdx() + pageSize(), total());

    // Repaint registry — mounts can register for immediate sync repaints
    const _painters = new Set();

    // Safe page setter — clamps to [1, totalPages], triggers immediate repaint
    function goTo(p) {
        const clamped = Math.max(1, Math.min(p, totalPages()));
        if (clamped === page()) return;
        setPage(clamped);
        _painters.forEach(paint => paint());
        onPageChange?.(clamped, pageSize());
    }

    // Page size change — keep the first visible item roughly in view
    function changeSize(newSize) {
        const ns = parseInt(newSize, 10);
        if (ns === pageSize() || isNaN(ns)) return;
        const firstItem = startIdx();
        setPageSize(ns);
        const newPage = Math.max(1, Math.floor(firstItem / ns) + 1);
        setPage(Math.min(newPage, totalPages()));
        _painters.forEach(paint => paint());
        onPageChange?.(page(), ns);
    }

    // Page number list with ellipsis

    function pageList() {
        const tp      = totalPages();
        const cur     = page();
        const max     = maxButtons;

        if (tp <= max) return Array.from({ length: tp }, (_, i) => i + 1);

        const half  = Math.floor(max / 2);
        let   start = Math.max(1, cur - half);
        let   end   = Math.min(tp, start + max - 1);
        if (end - start + 1 < max) start = Math.max(1, end - max + 1);

        const nums = [];
        if (start > 1) { nums.push(1); if (start > 2) nums.push('…'); }
        for (let i = start; i <= end; i++) nums.push(i);
        if (end < tp)  { if (end < tp - 1) nums.push('…'); nums.push(tp); }
        return nums;
    }

    // Render — returns HTML string, no side-effects

    function render() {
        const cur = page();
        const tp  = totalPages();
        const tot = total();

        if (tot === 0) return '';

        const start = tot === 0 ? 0 : startIdx() + 1;
        const end   = endIdx();

        // Info
        const info = `<span class="pg-info">${start}–${end} of ${tot}</span>`;

        // Prev / Next
        const prevDis = cur <= 1    ? ' disabled' : '';
        const nextDis = cur >= tp   ? ' disabled' : '';

        // Page buttons
        const pageButtons = pageList().map(n => {
            if (n === '…') return `<span class="pg-ellipsis">…</span>`;
            const active = n === cur ? ' pg-active' : '';
            const dis    = n === cur ? ' disabled'  : '';
            return `<button class="pg-btn${active}" data-pg="page" data-val="${n}"${dis}>${n}</button>`;
        }).join('');

        // Size selector
        const sizeSelector = showSizeSelector ? `
            <select class="pg-size" data-pg="size">
                ${pageSizes.map(s =>
            `<option value="${s}"${s === pageSize() ? ' selected' : ''}>${s} / page</option>`
        ).join('')}
            </select>` : '';

        return `
            <div class="pg-controls">
                ${info}
                <div class="pg-buttons">
                    <button class="pg-btn pg-nav" data-pg="first"${prevDis}>«</button>
                    <button class="pg-btn pg-nav" data-pg="prev"${prevDis}>‹</button>
                    ${pageButtons}
                    <button class="pg-btn pg-nav" data-pg="next"${nextDis}>›</button>
                    <button class="pg-btn pg-nav" data-pg="last"${nextDis}>»</button>
                </div>
                ${sizeSelector}
            </div>`;
    }

    // mount — attach to DOM, delegate events once, re-render reactively

    /**
     * Mount pagination controls into a container element.
     * Registers a SINGLE delegated click handler on the container (not document).
     * Re-renders automatically when state changes.
     * Returns a stop() function for cleanup on unmount.
     *
     * @param {Element} container
     * @returns {Function} stop
     */
    function mount(container) {
        if (!container) return () => {};

        // Render into container
        const paint = () => { container.innerHTML = render(); };

        // Register for immediate repaints from goTo/changeSize
        _painters.add(paint);

        // Delegate click and change — ONE listener each on the container
        const handleClick = (e) => {
            if (!e.target || typeof e.target.closest !== 'function') return;
            const btn = e.target.closest('[data-pg]');
            if (!btn) return;
            const action = btn.dataset.pg;
            const val    = btn.dataset.val;
            if (action === 'first') goTo(1);
            else if (action === 'prev')  goTo(page() - 1);
            else if (action === 'next')  goTo(page() + 1);
            else if (action === 'last')  goTo(totalPages());
            else if (action === 'page')  goTo(parseInt(val, 10));
        };

        const handleChange = (e) => {
            if (e.target.dataset.pg === 'size') changeSize(e.target.value);
        };

        container.addEventListener('click',  handleClick);
        container.addEventListener('change', handleChange);

        // Also subscribe via effect for external state changes (updateTotal etc.)
        const stopEffect = effect(() => {
            page(); pageSize(); total();
            paint();
        });

        return function stop() {
            stopEffect();
            _painters.delete(paint);
            container.removeEventListener('click',  handleClick);
            container.removeEventListener('change', handleChange);
            container.innerHTML = '';
        };
    }

    // Public API

    return {
        // State reads
        page,
        pageSize,
        total,
        totalPages,
        startIdx,
        endIdx,

        // State writes
        goTo,
        changeSize,
        updateTotal(n) {
            setTotal(n);
            const tp = totalPages();
            if (page() > tp) setPage(tp);
            _painters.forEach(paint => paint());
        },
        reset() { setPage(1); },

        // Slice a local array to the current page window
        slice(arr) {
            return Array.isArray(arr)
                ? arr.slice(startIdx(), endIdx())
                : [];
        },

        // Render HTML string (for custom mounting)
        render,

        // Mount into a DOM element with full reactivity + cleanup
        mount,
    };
}
