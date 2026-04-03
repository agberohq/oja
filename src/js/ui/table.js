/**
 * oja/table.js
 * Full-featured data table — sorting, pagination, load-more, groupBy,
 * mobile card view, remote data, rich cell rendering, loading/empty states.
 *
 * Follows the same pattern as chart.js:
 *   const t = table.render('#el', rows, headers, opts);
 *   t.update(newRows);
 *   t.setLoading(true);
 *   t.destroy();
 *
 * ─── Header definition ────────────────────────────────────────────────────────
 *
 *   { key, label, sortable?, truncate?, width?, mobile? }
 *
 *   truncate: 'ellipsis' | 'fade' | 'wrap' | false  (default: 'ellipsis')
 *   width:    CSS string e.g. '120px', '20%'
 *   mobile:   false  → hide column in card view
 *
 * ─── Cell value shapes ────────────────────────────────────────────────────────
 *
 *   Primitive:  row.name = 'api.example.com'
 *   Cell object:
 *     { value }         — plain text
 *     { value, href }   — link
 *     { value, badge }  — <span class="oja-badge oja-badge-{badge}">
 *     { value, html }   — raw HTML (bypasses escaping)
 *     { value, copy }   — show copy button on hover
 *     { value, onClick }— clickable cell
 *     { value, attrs }  — extra attributes on <td>
 *     { render: fn(row) → htmlString }  — full custom render
 *
 * ─── Options ──────────────────────────────────────────────────────────────────
 *
 *   pageSize      : number   — rows per page (default: 25, 0 = no pagination)
 *   paginationMode: 'pages' | 'loadMore'  (default: 'pages')
 *   loadMoreText  : string   — label on load-more button
 *   emptyText     : string   — message when rows is empty
 *   loadingText   : string   — message in loading state
 *   selectable    : boolean  — add selection checkboxes (default: false)
 *   exportable    : boolean  — add CSV export button to footer (default: false)
 *   onSelectionChange: fn(selectedIds) — fires when selection changes
 *   onRowClick    : fn(row)  — row click handler
 *   columnCallbacks: { key: fn(cellValue, row) → htmlString }
 *   actions       :[{ label, icon, onClick, style? }]
 *   groupBy       : string   — key to group rows under collapsible headers
 *   numbering     : boolean  — prepend row number column
 *   compact       : boolean  — tighter padding
 *   truncateMode  : 'ellipsis' | 'fade' | 'wrap'  — global default
 *   mobile        : { summaryColumns: 2 }
 *   fetchData     : async fn(page, size, sortKey, dir) → { data, total }
 *                   — enables remote mode; called on mount, sort, page change
 */

function _resolve(target) {
    if (!target) return null;
    if (target instanceof Element) return target;
    return document.querySelector(target);
}

function _esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Extract display value and metadata from a row cell.
function _cell(row, key) {
    const v = row[key];
    if (v === null || v === undefined) return { value: '' };
    if (typeof v === 'object' && !Array.isArray(v)) return v;
    return { value: v };
}

// Sort rows array by key in direction, returning a new array.
function _sortRows(rows, key, dir) {
    return [...rows].sort((a, b) => {
        const av = _cell(a, key).value ?? a[key] ?? '';
        const bv = _cell(b, key).value ?? b[key] ?? '';
        if (typeof av === 'number' && typeof bv === 'number')
            return dir === 'asc' ? av - bv : bv - av;
        return dir === 'asc'
            ? String(av).localeCompare(String(bv))
            : String(bv).localeCompare(String(av));
    });
}

// Build a <td> element from a cell descriptor, header, row, and options.
function _buildTd(cell, header, row, opts) {
    const td = document.createElement('td');

    if (cell.attrs) {
        for (const [k, v] of Object.entries(cell.attrs)) td.setAttribute(k, v);
    }

    const truncMode = header.truncate === false ? ''
        : (header.truncate || opts.truncateMode || 'ellipsis');
    if (truncMode) td.classList.add(`oja-trunc-${truncMode}`);

    // Custom render function takes full control of inner HTML
    if (typeof cell.render === 'function') {
        td.innerHTML = cell.render(row);
        return td;
    }

    // columnCallback override
    if (opts.columnCallbacks?.[header.key]) {
        td.innerHTML = opts.columnCallbacks[header.key](cell.value, row);
        return td;
    }

    // Raw HTML
    if (cell.html) {
        td.innerHTML = cell.html;
        return td;
    }

    const displayText = _esc(String(cell.value ?? ''));

    let inner;
    if (cell.badge) {
        inner = `<span class="oja-badge oja-badge-${_esc(cell.badge)}">${displayText}</span>`;
    } else if (cell.href) {
        inner = `<a href="${_esc(cell.href)}">${displayText}</a>`;
    } else {
        inner = `<span>${displayText}</span>`;
    }

    if (cell.copy) {
        td.classList.add('oja-copy-cell');
        td.innerHTML = `<span class="oja-cell-content">${inner}</span>
            <button class="oja-copy-btn" title="Copy" aria-label="Copy ${displayText}">⎘</button>`;
        td.querySelector('.oja-copy-btn').addEventListener('click', e => {
            e.stopPropagation();
            navigator.clipboard?.writeText(String(cell.value ?? '')).then(() => {
                const btn = e.currentTarget;
                const old = btn.textContent; btn.textContent = '✓';
                setTimeout(() => btn.textContent = old, 1500);
            });
        });
    } else {
        td.innerHTML = `<span class="oja-cell-content">${inner}</span>`;
    }

    if (cell.onClick) {
        td.classList.add('oja-cell-clickable');
        td.addEventListener('click', e => { e.stopPropagation(); cell.onClick(row); });
    }

    return td;
}

export const table = {

    /**
     * Render a data table.
     * @param {string|Element} target
     * @param {Object[]}       rows
     * @param {Object[]}       headers   — [{ key, label, sortable?, truncate?, width?, mobile? }]
     * @param {Object}         opts
     * @returns {{ update, setLoading, loadMore, page, destroy }}
     */
    render(target, rows, headers, opts = {}) {
        const container = _resolve(target);
        if (!container) return null;

        const {
            pageSize       = 25,
            paginationMode = 'pages',
            loadMoreText   = 'Load more',
            emptyText      = 'No records found',
            loadingText    = 'Loading…',
            selectable     = false,
            exportable     = false,
            onSelectionChange = null,
            onRowClick     = null,
            columnCallbacks = {},
            actions        =[],
            groupBy        = '',
            numbering      = false,
            compact        = false,
            truncateMode   = 'ellipsis',
            mobile         = { summaryColumns: 2 },
            fetchData      = null,
        } = opts;

        // State
        let localRows      = rows ||[];
        let remoteRows     =[];
        let totalRemote    = 0;
        let sortKey        = null;
        let sortDir        = 'asc';
        let hiddenColumns  = new Set();
        let currentPage    = 1;
        let loading        = false;
        let allLoaded      = false;
        let expandedGroups = new Set();
        let selectedIds    = new Set();
        const _listeners   =[];

        const isRemote = typeof fetchData === 'function';

        // Shell

        container.innerHTML = '';
        container.className = `oja-table-wrap${compact ? ' oja-table-compact' : ''}`;

        const scrollDiv = document.createElement('div');
        scrollDiv.className = 'oja-table-scroll';

        const tbl    = document.createElement('table');
        tbl.className = 'oja-table';
        const thead  = document.createElement('thead');
        const tbody  = document.createElement('tbody');
        tbl.append(thead, tbody);
        scrollDiv.appendChild(tbl);
        container.appendChild(scrollDiv);

        const footerDiv = document.createElement('div');
        footerDiv.className = 'oja-table-footer';
        container.appendChild(footerDiv);

        // All columns including optional extras

        function _allCols() {
            const cols =[];
            if (selectable) cols.push({ key: '__select', label: '<input type="checkbox" class="oja-table-select-all">', sortable: false, _select: true, width: '40px' });
            if (numbering) cols.push({ key: '__num', label: '#', sortable: false, _num: true });
            cols.push(...headers.filter(h => !hiddenColumns.has(h.key)));
            if (actions.length > 0) cols.push({ key: '__actions', label: '', sortable: false, _actions: true });
            return cols;
        }

        // Header

        function _buildHeader() {
            thead.innerHTML = '';
            const tr = document.createElement('tr');
            for (const col of _allCols()) {
                const th = document.createElement('th');
                th.innerHTML = col.label;
                if (col.width) th.style.width = col.width;

                if (col._select) {
                    th.className = 'oja-th-select';
                    const cb = th.querySelector('.oja-table-select-all');
                    if (cb) {
                        const h = (e) => {
                            const isChecked = e.target.checked;
                            const currentVisible = _getPage(_getSorted());
                            currentVisible.forEach((r, i) => {
                                const id = r.id ?? ((paginationMode === 'pages' ? (currentPage - 1) * pageSize : 0) + i);
                                if (isChecked) selectedIds.add(String(id));
                                else selectedIds.delete(String(id));
                            });
                            _renderBody();
                            if (onSelectionChange) onSelectionChange(Array.from(selectedIds));
                        };
                        cb.addEventListener('change', h);
                        _listeners.push({ el: cb, type: 'change', handler: h });
                    }
                } else if (col.sortable) {
                    th.classList.add('oja-th-sortable');
                    th.setAttribute('data-key', col.key);
                    th.setAttribute('aria-sort', 'none');
                    const handler = () => _handleSort(col.key);
                    th.addEventListener('click', handler);
                    _listeners.push({ el: th, type: 'click', handler });
                }
                tr.appendChild(th);
            }
            thead.appendChild(tr);
        }

        function _updateSortIndicators() {
            for (const th of thead.querySelectorAll('[data-key]')) {
                th.classList.remove('oja-th-asc', 'oja-th-desc');
                th.setAttribute('aria-sort', 'none');
                if (th.getAttribute('data-key') === sortKey) {
                    th.classList.add(sortDir === 'asc' ? 'oja-th-asc' : 'oja-th-desc');
                    th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
                }
            }
        }

        // Body

        function _getRows() {
            return isRemote ? remoteRows : localRows;
        }

        function _getSorted() {
            const r = _getRows();
            return (sortKey && !isRemote) ? _sortRows(r, sortKey, sortDir) : r;
        }

        function _getPage(sorted) {
            if (pageSize === 0 || paginationMode === 'loadMore') return sorted;
            const s = (currentPage - 1) * pageSize;
            return sorted.slice(s, s + pageSize);
        }

        function _updateSelectAll() {
            const cb = thead.querySelector('.oja-table-select-all');
            if (!cb) return;
            const currentVisible = _getPage(_getSorted());
            if (currentVisible.length === 0) {
                cb.checked = false;
                cb.indeterminate = false;
                return;
            }
            let selectedCount = 0;
            currentVisible.forEach((r, i) => {
                const id = r.id ?? ((paginationMode === 'pages' ? (currentPage - 1) * pageSize : 0) + i);
                if (selectedIds.has(String(id))) selectedCount++;
            });
            cb.checked = selectedCount === currentVisible.length;
            cb.indeterminate = selectedCount > 0 && selectedCount < currentVisible.length;

            // highlight rows
            tbody.querySelectorAll('tr').forEach(tr => {
                const rowCb = tr.querySelector('.oja-table-select-row');
                if (rowCb) {
                    tr.classList.toggle('oja-row-selected', rowCb.checked);
                }
            });
        }

        function _buildRow(row, index, globalIndex) {
            const tr = document.createElement('tr');
            if (onRowClick) {
                tr.classList.add('oja-row-clickable');
                const h = () => onRowClick(row);
                tr.addEventListener('click', h);
                _listeners.push({ el: tr, type: 'click', handler: h });
            }

            for (const col of _allCols()) {
                if (col._select) {
                    const td = document.createElement('td');
                    td.className = 'oja-td-select';
                    const id = String(row.id ?? globalIndex);
                    const checked = selectedIds.has(id) ? 'checked' : '';
                    td.innerHTML = `<input type="checkbox" class="oja-table-select-row" data-id="${_esc(id)}" ${checked}>`;

                    const cb = td.querySelector('input');
                    const h = (e) => {
                        e.stopPropagation();
                        if (e.target.checked) selectedIds.add(id);
                        else selectedIds.delete(id);
                        _updateSelectAll();
                        if (onSelectionChange) onSelectionChange(Array.from(selectedIds));
                    };
                    cb.addEventListener('change', h);
                    _listeners.push({ el: cb, type: 'change', handler: h });
                    tr.appendChild(td);

                    if (checked) tr.classList.add('oja-row-selected');
                    continue;
                }
                if (col._num) {
                    const td = document.createElement('td');
                    td.className = 'oja-td-num';
                    td.textContent = String(globalIndex + 1);
                    tr.appendChild(td);
                    continue;
                }
                if (col._actions) {
                    const td = document.createElement('td');
                    td.className = 'oja-td-actions';
                    for (const action of actions) {
                        const btn = document.createElement('button');
                        btn.className = `oja-action-btn${action.style ? ' ' + action.style : ''}`;
                        btn.title = action.label;
                        btn.setAttribute('aria-label', action.label);
                        btn.innerHTML = action.icon || _esc(action.label);
                        btn.addEventListener('click', e => { e.stopPropagation(); action.onClick(row); });
                        td.appendChild(btn);
                    }
                    tr.appendChild(td);
                    continue;
                }
                tr.appendChild(_buildTd(_cell(row, col.key), col, row, { columnCallbacks, truncateMode }));
            }
            return tr;
        }

        function _buildMobileCard(row, globalIndex) {
            const card = document.createElement('div');
            card.className = 'oja-card';

            const visibleHeaders = headers.filter(h => h.mobile !== false);
            const summaryCount   = mobile.summaryColumns ?? 2;

            // Primary — first header
            if (visibleHeaders[0]) {
                const primary = document.createElement('div');
                primary.className = 'oja-card-primary';

                if (selectable) {
                    const id = String(row.id ?? globalIndex);
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.className = 'oja-table-select-row';
                    cb.style.marginRight = '8px';
                    cb.checked = selectedIds.has(id);
                    const h = (e) => {
                        e.stopPropagation();
                        if (e.target.checked) selectedIds.add(id);
                        else selectedIds.delete(id);
                        if (onSelectionChange) onSelectionChange(Array.from(selectedIds));
                        _renderBody(); // Re-sync table
                    };
                    cb.addEventListener('change', h);
                    _listeners.push({ el: cb, type: 'change', handler: h });
                    primary.appendChild(cb);
                }

                if (numbering) {
                    const num = document.createElement('span');
                    num.className = 'oja-card-num';
                    num.textContent = String(globalIndex + 1);
                    primary.appendChild(num);
                }
                const cell = _cell(row, visibleHeaders[0].key);
                const span = document.createElement('span');
                span.className = 'oja-card-primary-val';
                span.textContent = String(cell.value ?? '');
                primary.appendChild(span);
                card.appendChild(primary);
            }

            // Summary — headers 1..summaryCount
            const summaryHeaders = visibleHeaders.slice(1, summaryCount);
            if (summaryHeaders.length) {
                const summary = document.createElement('div');
                summary.className = 'oja-card-summary';
                for (const h of summaryHeaders) {
                    const field = document.createElement('div');
                    field.className = 'oja-card-field';
                    field.innerHTML = `<span class="oja-card-label">${_esc(h.label)}</span>
                        <span class="oja-card-val">${_esc(String(_cell(row, h.key).value ?? ''))}</span>`;
                    summary.appendChild(field);
                }
                card.appendChild(summary);
            }

            // Expandable details — headers summaryCount+
            const detailHeaders = visibleHeaders.slice(summaryCount);
            if (detailHeaders.length || actions.length > 0) {
                const toggle = document.createElement('button');
                toggle.className = 'oja-card-toggle';
                toggle.setAttribute('aria-expanded', 'false');
                toggle.textContent = '▼';
                card.appendChild(toggle);

                const details = document.createElement('div');
                details.className = 'oja-card-details';
                details.hidden = true;

                for (const h of detailHeaders) {
                    const field = document.createElement('div');
                    field.className = 'oja-card-field';
                    field.innerHTML = `<span class="oja-card-label">${_esc(h.label)}</span>
                        <span class="oja-card-val">${_esc(String(_cell(row, h.key).value ?? ''))}</span>`;
                    details.appendChild(field);
                }

                if (actions.length > 0) {
                    const actWrap = document.createElement('div');
                    actWrap.className = 'oja-card-actions';
                    for (const action of actions) {
                        const btn = document.createElement('button');
                        btn.className = `oja-action-btn${action.style ? ' ' + action.style : ''}`;
                        btn.innerHTML = (action.icon || '') + ' ' + _esc(action.label);
                        btn.addEventListener('click', () => action.onClick(row));
                        actWrap.appendChild(btn);
                    }
                    details.appendChild(actWrap);
                }

                card.appendChild(details);

                const h = () => {
                    const open = details.hidden;
                    details.hidden = !open;
                    toggle.textContent = open ? '▲' : '▼';
                    toggle.setAttribute('aria-expanded', String(open));
                };
                toggle.addEventListener('click', h);
                _listeners.push({ el: toggle, type: 'click', handler: h });
            }

            if (onRowClick) {
                card.classList.add('oja-row-clickable');
                const h = () => onRowClick(row);
                card.addEventListener('click', h);
                _listeners.push({ el: card, type: 'click', handler: h });
            }

            return card;
        }

        function _renderBody() {
            tbody.innerHTML = '';

            // Loading state
            if (loading) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = _allCols().length;
                td.className = 'oja-state-cell';
                td.innerHTML = `<div class="oja-loading-state">
                    <span class="oja-spinner" aria-hidden="true"></span>
                    <span>${_esc(loadingText)}</span>
                </div>`;
                tr.appendChild(td);
                tbody.appendChild(tr);
                _renderMobileCards([]);
                return;
            }

            const sorted  = _getSorted();
            const visible = _getPage(sorted);

            // Empty state
            if (!visible.length) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = _allCols().length;
                td.className = 'oja-state-cell';
                td.innerHTML = `<div class="oja-empty-state">
                    <svg width="48" height="32" viewBox="0 0 64 41" aria-hidden="true">
                        <g transform="translate(0 1)" fill="none" fill-rule="evenodd">
                            <ellipse fill="var(--oja-table-empty-shadow,#f0f0f0)" cx="32" cy="33" rx="32" ry="7"/>
                            <g stroke="var(--oja-table-border,var(--border,#e0e0e0))" fill-rule="nonzero">
                                <path d="M55 12.76L44.854 1.258C44.367.474 43.656 0 42.907 0H21.093c-.749 0-1.46.474-1.947 1.257L9 12.761V22h46v-9.24z"/>
                                <path d="M41.613 15.931c0-1.605.994-2.93 2.227-2.931H55v18.137C55 33.26 53.68 35 52.05 35h-40.1C10.32 35 9 33.259 9 31.137V13h11.16c1.233 0 2.227 1.323 2.227 2.928v.022c0 1.605 1.005 2.901 2.237 2.901h14.752c1.232 0 2.237-1.308 2.237-2.913v-.007z"
                                    fill="var(--oja-table-empty-bg,var(--bg,#fafafa))"/>
                            </g>
                        </g>
                    </svg>
                    <span>${_esc(emptyText)}</span>
                </div>`;
                tr.appendChild(td);
                tbody.appendChild(tr);
                _renderMobileCards([]);
                _updateSelectAll();
                return;
            }

            if (groupBy) {
                _renderGrouped(sorted);
            } else {
                visible.forEach((row, i) => {
                    const globalIdx = (paginationMode === 'pages' ? (currentPage - 1) * pageSize : 0) + i;
                    tbody.appendChild(_buildRow(row, i, globalIdx));
                });
            }

            _updateSelectAll();
            _renderMobileCards(visible);
        }

        function _renderGrouped(sorted) {
            const groups = new Map();
            for (const row of sorted) {
                const k = String(_cell(row, groupBy).value ?? row[groupBy] ?? '—');
                if (!groups.has(k)) groups.set(k,[]);
                groups.get(k).push(row);
            }
            let globalIdx = 0;
            for (const [key, groupRows] of groups) {
                // Group header
                const groupTr = document.createElement('tr');
                groupTr.className = 'oja-group-header';
                const groupTd = document.createElement('td');
                groupTd.colSpan = _allCols().length;
                const isOpen = expandedGroups.has(key);
                groupTd.innerHTML = `<span class="oja-group-label">${_esc(key)}</span>
                    <span class="oja-group-count">${groupRows.length}</span>
                    <span class="oja-group-toggle" aria-hidden="true">${isOpen ? '▲' : '▼'}</span>`;
                groupTr.appendChild(groupTd);
                const h = () => {
                    if (expandedGroups.has(key)) expandedGroups.delete(key);
                    else expandedGroups.add(key);
                    _renderBody();
                    _renderFooter();
                };
                groupTr.addEventListener('click', h);
                _listeners.push({ el: groupTr, type: 'click', handler: h });
                tbody.appendChild(groupTr);

                if (isOpen) {
                    groupRows.forEach((row, i) => {
                        tbody.appendChild(_buildRow(row, i, globalIdx++));
                    });
                } else {
                    globalIdx += groupRows.length;
                }
            }
        }

        // Mobile cards sit below the table — CSS hides one or the other via media query
        let mobileWrap = container.querySelector('.oja-mobile-cards');
        if (!mobileWrap) {
            mobileWrap = document.createElement('div');
            mobileWrap.className = 'oja-mobile-cards';
            container.insertBefore(mobileWrap, footerDiv);
        }

        function _renderMobileCards(visible) {
            mobileWrap.innerHTML = '';
            if (loading) {
                mobileWrap.innerHTML = `<div class="oja-loading-state">
                    <span class="oja-spinner"></span><span>${_esc(loadingText)}</span></div>`;
                return;
            }
            if (!visible.length) {
                mobileWrap.innerHTML = `<div class="oja-empty-state"><span>${_esc(emptyText)}</span></div>`;
                return;
            }
            visible.forEach((row, i) => {
                const globalIdx = (paginationMode === 'pages' ? (currentPage - 1) * pageSize : 0) + i;
                mobileWrap.appendChild(_buildMobileCard(row, globalIdx));
            });
        }

        // Footer (pagination / load-more / export)

        function _renderFooter() {
            footerDiv.innerHTML = '';

            const leftWrap = document.createElement('div');
            leftWrap.className = 'oja-table-footer-left';
            leftWrap.style.display = 'flex';
            leftWrap.style.gap = '12px';
            leftWrap.style.alignItems = 'center';
            footerDiv.appendChild(leftWrap);

            if (exportable) {
                const btn = document.createElement('button');
                btn.className = 'oja-page-btn oja-export-btn';
                btn.innerHTML = 'Export';
                btn.addEventListener('click', async () => {
                    const { exporter } = await import('../ext/export.js');
                    exporter.csv(isRemote ? remoteRows : localRows, 'export.csv');
                });
                leftWrap.appendChild(btn);
            }

            const sorted     = _getSorted();
            const totalRows  = isRemote ? totalRemote : sorted.length;
            const totalPages = pageSize > 0 ? Math.ceil(totalRows / pageSize) : 1;

            // Load-more mode
            if (paginationMode === 'loadMore') {
                if (!allLoaded && totalRows > 0) {
                    const btn = document.createElement('button');
                    btn.className = 'oja-load-more-btn';
                    btn.textContent = loadMoreText;
                    btn.addEventListener('click', () => _loadMore());
                    footerDiv.appendChild(btn);
                }
                return;
            }

            // Pagination mode
            if (totalPages <= 1) return;

            const start = Math.min((currentPage - 1) * pageSize + 1, totalRows);
            const end   = Math.min(currentPage * pageSize, totalRows);

            const info = document.createElement('span');
            info.className = 'oja-page-info';
            info.textContent = `${start}–${end} of ${totalRows}`;
            leftWrap.appendChild(info);

            const nav = document.createElement('nav');
            nav.className = 'oja-page-nav';
            nav.setAttribute('aria-label', 'Table pagination');

            const mkBtn = (label, targetPage, disabled, ariaCurrent) => {
                const btn = document.createElement('button');
                btn.className = 'oja-page-btn';
                btn.innerHTML = label;
                btn.disabled  = disabled;
                if (ariaCurrent) btn.classList.add('active');
                if (ariaCurrent) btn.setAttribute('aria-current', 'page');
                if (!disabled) {
                    btn.addEventListener('click', () => {
                        currentPage = targetPage;
                        _fetchOrRender();
                    });
                }
                return btn;
            };

            nav.appendChild(mkBtn('«', 1, currentPage === 1, false));
            nav.appendChild(mkBtn('‹', currentPage - 1, currentPage === 1, false));

            const maxVisible = 5;
            let sp = Math.max(1, currentPage - Math.floor(maxVisible / 2));
            let ep = Math.min(totalPages, sp + maxVisible - 1);
            if (ep - sp + 1 < maxVisible) sp = Math.max(1, ep - maxVisible + 1);

            for (let p = sp; p <= ep; p++) {
                nav.appendChild(mkBtn(String(p), p, false, p === currentPage));
            }

            nav.appendChild(mkBtn('›', currentPage + 1, currentPage === totalPages, false));
            nav.appendChild(mkBtn('»', totalPages, currentPage === totalPages, false));

            footerDiv.appendChild(nav);
        }

        // Remote / async

        async function _fetchOrRender() {
            if (isRemote) {
                loading = true;
                _renderBody();
                try {
                    const result = await fetchData(currentPage, pageSize, sortKey, sortDir);
                    remoteRows   = result.data ||[];
                    totalRemote  = result.total ?? remoteRows.length;
                } catch (e) {
                    console.error('[oja/table] fetchData error:', e);
                    remoteRows  =[];
                    totalRemote = 0;
                } finally {
                    loading = false;
                }
            }
            _renderBody();
            _renderFooter();
        }

        async function _loadMore() {
            if (!isRemote || allLoaded) return;
            loading = true;
            _renderBody();
            try {
                const result = await fetchData(currentPage + 1, pageSize, sortKey, sortDir);
                const newRows = result.data ||[];
                remoteRows    = [...remoteRows, ...newRows];
                totalRemote   = result.total ?? remoteRows.length;
                currentPage++;
                allLoaded = newRows.length < pageSize || remoteRows.length >= totalRemote;
            } catch (e) {
                console.error('[oja/table] loadMore error:', e);
            } finally {
                loading = false;
            }
            _renderBody();
            _renderFooter();
        }

        async function _handleSort(key) {
            if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            else { sortKey = key; sortDir = 'asc'; }
            currentPage = 1;
            _updateSortIndicators();
            await _fetchOrRender();
        }

        // Initial render

        _buildHeader();
        _fetchOrRender();

        // Public handle

        return {
            // Replace local data and re-render, preserving sort state.
            update(newRows) {
                localRows   = newRows ||[];
                currentPage = 1;
                _renderBody();
                _renderFooter();
            },

            // Set loading state without replacing data.
            setLoading(state) {
                loading = !!state;
                _renderBody();
            },

            // Trigger load-more programmatically (load-more mode only).
            loadMore() {
                return _loadMore();
            },

            // Navigate to a specific page.
            page(n) {
                currentPage = n;
                _fetchOrRender();
            },

            // Remove DOM and detach all listeners.
            destroy() {
                for (const { el, type, handler } of _listeners) {
                    el.removeEventListener(type, handler);
                }
                container.innerHTML = '';
            },

            // Column visibility controls
            hideColumn(key) {
                hiddenColumns.add(key);
                _buildHeader();
                _renderBody();
                return this;
            },

            showColumn(key) {
                hiddenColumns.delete(key);
                _buildHeader();
                _renderBody();
                return this;
            },

            toggleColumn(key) {
                if (hiddenColumns.has(key)) this.showColumn(key);
                else this.hideColumn(key);
                return this;
            },

            getVisibleColumns() {
                return headers.filter(h => !hiddenColumns.has(h.key)).map(h => h.key);
            },

            getHiddenColumns() {
                return [...hiddenColumns];
            },

            // Row expansion
            // Call with a factory fn to enable inline row expansion.
            // Factory receives the row data and returns an HTML string or Out.
            //
            //   t.enableRowExpansion((row) => `<div class="detail">${row.notes}</div>`);
            enableRowExpansion(factory) {
                if (typeof factory !== 'function') return this;

                // Add click handler to toggle row expansion
                _listeners.push({
                    el: container,
                    type: 'click',
                    handler: async (e) => {
                        const row = e.target.closest('tr[data-row-idx]');
                        if (!row || e.target.closest('[data-action]')) return;

                        const idx     = parseInt(row.dataset.rowIdx);
                        const isOpen  = row.dataset.expanded === 'true';
                        const tbody   = container.querySelector('tbody');
                        if (!tbody) return;

                        // Close any open expansion rows
                        tbody.querySelectorAll('tr.oja-row-expanded').forEach(r => r.remove());
                        tbody.querySelectorAll('tr[data-expanded="true"]').forEach(r => {
                            r.dataset.expanded = 'false';
                            r.querySelector('.oja-row-expand-icon')?.textContent !== undefined &&
                                (r.querySelector('.oja-row-expand-icon').textContent = '▶');
                        });

                        if (isOpen) return; // was open, now closed

                        row.dataset.expanded = 'true';
                        const icon = row.querySelector('.oja-row-expand-icon');
                        if (icon) icon.textContent = '▼';

                        const colspan = _allCols().length;
                        const expandRow = document.createElement('tr');
                        expandRow.className = 'oja-row-expanded';
                        const td = document.createElement('td');
                        td.colSpan = colspan;
                        td.style.padding = '0';

                        const sourceRow = (localRows[idx] || {});
                        const result = factory(sourceRow, idx);

                        if (typeof result === 'string') {
                            td.innerHTML = result;
                        } else if (result && typeof result.render === 'function') {
                            await result.render(td);
                        }

                        expandRow.appendChild(td);
                        row.insertAdjacentElement('afterend', expandRow);
                    },
                });

                container.addEventListener('click', _listeners[_listeners.length - 1].handler);

                // Add expand icon to first data column in header
                const firstTh = container.querySelector('thead th:not([data-select]):not([data-num])');
                if (firstTh) firstTh.style.paddingLeft = '28px';

                return this;
            },
        };
    },
};
