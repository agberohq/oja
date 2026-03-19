/**
 * oja/export.js
 * Data export utilities — CSV, JSON, Excel, and printing.
 * Export data from tables, lists, or any data source.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { export } from '../oja/export.js';
 *
 *   // Export data as CSV
 *   export.csv(data, 'hosts.csv');
 *
 *   // Export as JSON
 *   export.json(data, 'backup.json');
 *
 *   // Print element
 *   export.print('#host-table');
 *
 * ─── From DOM elements ────────────────────────────────────────────────────────
 *
 *   // Export table
 *   export.fromTable('#host-table', 'hosts.csv');
 *
 *   // Export list
 *   export.fromList('#host-list', 'hosts.txt');
 *
 *   // Export with custom formatter
 *   export.from('#data-container', (el) => {
 *       return Array.from(el.children).map(child => child.textContent);
 *   }, 'data.json');
 *
 * ─── With column configuration ────────────────────────────────────────────────
 *
 *   export.csv(data, 'hosts.csv', {
 *       columns: ['name', 'ip', 'status'],
 *       headers: ['Host Name', 'IP Address', 'Status'],
 *       delimiter: ';',
 *   });
 *
 * ─── Excel export ─────────────────────────────────────────────────────────────
 *
 *   // Export to Excel (XLSX) - requires SheetJS library
 *   await export.excel(data, 'report.xlsx', {
 *       sheetName: 'Hosts',
 *       columns: ['name', 'ip'],
 *   });
 *
 * ─── Print formatting ─────────────────────────────────────────────────────────
 *
 *   export.print('#invoice', {
 *       title: 'Invoice',
 *       styles: `
 *           table { border-collapse: collapse; }
 *           td { border: 1px solid #ccc; padding: 8px; }
 *       `,
 *       onBeforePrint: () => prepareData(),
 *       onAfterPrint: () => cleanup(),
 *   });
 *
 * ─── PDF export ───────────────────────────────────────────────────────────────
 *
 *   // Export to PDF (requires jsPDF)
 *   await export.pdf('#content', 'document.pdf', {
 *       format: 'a4',
 *       orientation: 'portrait',
 *   });
 *
 * ─── Copy to clipboard ────────────────────────────────────────────────────────
 *
 *   // Copy data as CSV
 *   export.copy.csv(data);
 *
 *   // Copy as JSON
 *   export.copy.json(data);
 *
 *   // Copy formatted text
 *   export.copy.text('Formatted content');
 *
 * ─── Transformers ─────────────────────────────────────────────────────────────
 *
 *   // Transform data before export
 *   export.csv(data, 'hosts.csv', {
 *       transform: {
 *           status: (val) => val === 'active' ? '✓' : '✗',
 *           lastSeen: (val) => new Date(val).toLocaleDateString(),
 *       }
 *   });
 *
 * ─── Chunked export (large datasets) ──────────────────────────────────────────
 *
 *   // Export large data in chunks
 *   await export.chunked(data, 'large.csv', {
 *       chunkSize: 1000,
 *       onProgress: (pct) => updateProgress(pct),
 *   });
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ExportOptions
 * @property {string[]} [columns] - Columns to include
 * @property {string[]} [headers] - Column headers
 * @property {string} [delimiter=','] - CSV delimiter
 * @property {Object} [transform] - Value transformers
 */

// ─── Core ─────────────────────────────────────────────────────────────────────

export const exporter = {
    // ─── CSV export ──────────────────────────────────────────────────────────

    /**
     * Export data as CSV
     */
    csv(data, filename = 'export.csv', options = {}) {
        const {
            columns = null,
            headers = null,
            delimiter = ',',
            transform = {},
        } = options;

        // Normalize data to array
        const items = Array.isArray(data) ? data : [data];
        if (items.length === 0) return false;

        // Determine columns
        let cols = columns;
        if (!cols) {
            cols = Object.keys(items[0]);
        }

        // Generate header row
        let csv = '';
        if (headers) {
            csv += headers.map(h => this._escapeCsv(h)).join(delimiter) + '\n';
        } else {
            csv += cols.map(c => this._escapeCsv(c)).join(delimiter) + '\n';
        }

        // Generate data rows
        items.forEach(item => {
            const row = cols.map(col => {
                let val = item[col] !== undefined ? item[col] : '';

                // Apply transform
                if (transform[col]) {
                    val = transform[col](val, item);
                }

                // Format value
                if (val === null || val === undefined) {
                    return '';
                }
                if (typeof val === 'object') {
                    val = JSON.stringify(val);
                }

                return this._escapeCsv(String(val));
            });

            csv += row.join(delimiter) + '\n';
        });

        // Download
        this._download(csv, filename, 'text/csv;charset=utf-8;');
        return true;
    },

    /**
     * Export from HTML table
     */
    fromTable(selector, filename = 'export.csv', options = {}) {
        const table = typeof selector === 'string'
            ? document.querySelector(selector)
            : selector;

        if (!table) return false;

        const {
            includeHeaders = true,
            includeFooters = false,
            ...csvOptions
        } = options;

        const data = [];
        const headers = [];

        // Get headers
        if (includeHeaders) {
            const headerRows = table.querySelectorAll('thead tr');
            if (headerRows.length > 0) {
                headerRows[0].querySelectorAll('th, td').forEach(th => {
                    headers.push(th.textContent.trim());
                });
            } else {
                // Use first row as headers
                table.querySelectorAll('tr')[0]?.querySelectorAll('td').forEach(td => {
                    headers.push(td.textContent.trim());
                });
            }
        }

        // Get data rows
        const rows = table.querySelectorAll('tbody tr');
        rows.forEach(row => {
            const rowData = {};
            row.querySelectorAll('td').forEach((td, i) => {
                const key = headers[i] || `col${i}`;
                rowData[key] = td.textContent.trim();
            });
            data.push(rowData);
        });

        return this.csv(data, filename, { ...csvOptions, headers });
    },

    /**
     * Export from list
     */
    fromList(selector, filename = 'export.txt', options = {}) {
        const list = typeof selector === 'string'
            ? document.querySelector(selector)
            : selector;

        if (!list) return false;

        const {
            itemSelector = 'li',
            format = 'text',
        } = options;

        const items = Array.from(list.querySelectorAll(itemSelector)).map(el => {
            if (format === 'html') {
                return el.innerHTML;
            }
            return el.textContent.trim();
        });

        if (filename.endsWith('.csv')) {
            return this.csv(items.map(text => ({ text })), filename, options);
        }

        const content = items.join('\n');
        this._download(content, filename, 'text/plain;charset=utf-8;');
        return true;
    },

    /**
     * Export from custom selector
     */
    from(selector, formatter, filename = 'export.json', options = {}) {
        const element = typeof selector === 'string'
            ? document.querySelector(selector)
            : selector;

        if (!element) return false;

        const data = formatter(element);

        if (filename.endsWith('.json')) {
            return this.json(data, filename, options);
        } else if (filename.endsWith('.csv')) {
            return this.csv(data, filename, options);
        } else {
            const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
            this._download(content, filename, 'text/plain;charset=utf-8;');
            return true;
        }
    },

    // ─── JSON export ─────────────────────────────────────────────────────────

    /**
     * Export as JSON
     */
    json(data, filename = 'export.json', options = {}) {
        const {
            pretty = true,
            replacer = null,
            space = 2,
        } = options;

        const json = pretty
            ? JSON.stringify(data, replacer, space)
            : JSON.stringify(data);

        this._download(json, filename, 'application/json;charset=utf-8;');
        return true;
    },

    // ─── Excel export ────────────────────────────────────────────────────────

    /**
     * Export as Excel (requires SheetJS)
     */
    async excel(data, filename = 'export.xlsx', options = {}) {
        const {
            sheetName = 'Sheet1',
            columns = null,
            headers = null,
        } = options;

        // Check if SheetJS is available
        if (typeof XLSX === 'undefined') {
            console.warn('[oja/export] SheetJS (XLSX) not available');
            return false;
        }

        const items = Array.isArray(data) ? data : [data];
        const cols = columns || (items[0] ? Object.keys(items[0]) : []);

        // Prepare worksheet data
        const wsData = [];

        // Add headers
        if (headers) {
            wsData.push(headers);
        } else {
            wsData.push(cols);
        }

        // Add data rows
        items.forEach(item => {
            const row = cols.map(col => item[col] !== undefined ? item[col] : '');
            wsData.push(row);
        });

        // Create workbook
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        XLSX.writeFile(wb, filename);

        return true;
    },

    // ─── Print ───────────────────────────────────────────────────────────────

    /**
     * Print element
     */
    print(selector, options = {}) {
        const element = typeof selector === 'string'
            ? document.querySelector(selector)
            : selector;

        if (!element) return false;

        const {
            title = document.title,
            styles = '',
            onBeforePrint = null,
            onAfterPrint = null,
        } = options;

        // Clone element to avoid modifying original
        const clone = element.cloneNode(true);

        // Create print window
        const printWindow = window.open('', '_blank');
        if (!printWindow) return false;

        // Build HTML
        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>${title}</title>
                <style>
                    body { font-family: sans-serif; padding: 20px; }
                    ${styles}
                </style>
            </head>
            <body>
                ${clone.outerHTML}
                <script>
                    window.onload = function() {
                        window.print();
                        window.onafterprint = window.close;
                    };
                </script>
            </body>
            </html>
        `;

        printWindow.document.write(html);
        printWindow.document.close();

        if (onBeforePrint) onBeforePrint();

        // Note: Can't detect when print dialog closes reliably
        if (onAfterPrint) {
            setTimeout(onAfterPrint, 1000);
        }

        return true;
    },

    // ─── PDF export ──────────────────────────────────────────────────────────

    /**
     * Export as PDF (requires jsPDF)
     */
    async pdf(selector, filename = 'export.pdf', options = {}) {
        const {
            format = 'a4',
            orientation = 'portrait',
            unit = 'mm',
        } = options;

        // Check if jsPDF is available
        if (typeof jspdf === 'undefined' && typeof window.jspdf === 'undefined') {
            console.warn('[oja/export] jsPDF not available');
            return false;
        }

        const element = typeof selector === 'string'
            ? document.querySelector(selector)
            : selector;

        if (!element) return false;

        const { jsPDF } = window.jspdf || { jsPDF: window.jsPDF };
        const doc = new jsPDF({ orientation, unit, format });

        // This is a basic implementation - for real PDF generation,
        // you'd want to use html2canvas or similar
        doc.text('PDF Export', 10, 10);
        doc.text(element.textContent || '', 10, 20);

        doc.save(filename);
        return true;
    },

    // ─── Copy to clipboard ───────────────────────────────────────────────────

    copy: {
        /**
         * Copy data as CSV
         */
        csv(data, options = {}) {
            const csv = exporter.csv(data, null, { ...options, download: false });
            return exporter._copyToClipboard(csv, 'text/csv');
        },

        /**
         * Copy as JSON
         */
        json(data, options = {}) {
            const { pretty = true, space = 2 } = options;
            const json = pretty ? JSON.stringify(data, null, space) : JSON.stringify(data);
            return exporter._copyToClipboard(json, 'application/json');
        },

        /**
         * Copy as plain text
         */
        text(text) {
            return exporter._copyToClipboard(String(text), 'text/plain');
        },

        /**
         * Copy HTML
         */
        html(html) {
            return exporter._copyToClipboard(html, 'text/html');
        },
    },

    // ─── Chunked export ──────────────────────────────────────────────────────

    /**
     * Export large data in chunks
     */
    async chunked(data, filename = 'export.csv', options = {}) {
        const {
            chunkSize = 1000,
            onProgress = null,
            ...exportOptions
        } = options;

        const items = Array.isArray(data) ? data : [data];
        const total = items.length;
        const chunks = Math.ceil(total / chunkSize);

        let allResults = [];

        for (let i = 0; i < chunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, total);
            const chunk = items.slice(start, end);

            // Process chunk (customize based on export type)
            const result = await this._processChunk(chunk, exportOptions);
            allResults = allResults.concat(result);

            if (onProgress) {
                onProgress((i + 1) / chunks * 100);
            }

            // Yield to event loop
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        // Save final file
        if (filename.endsWith('.csv')) {
            return this.csv(allResults, filename, exportOptions);
        } else if (filename.endsWith('.json')) {
            return this.json(allResults, filename, exportOptions);
        }

        return allResults;
    },

    // ─── Helpers ─────────────────────────────────────────────────────────────

    _escapeCsv(str) {
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    },

    _download(content, filename, mimeType) {
        if (!filename) return content;

        const blob = new Blob([content], { type: mimeType });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    },

    async _copyToClipboard(content, mimeType) {
        try {
            if (mimeType === 'text/plain') {
                await navigator.clipboard.writeText(content);
                return true;
            } else {
                const blob = new Blob([content], { type: mimeType });
                await navigator.clipboard.write([
                    new ClipboardItem({
                        [mimeType]: blob,
                    }),
                ]);
                return true;
            }
        } catch (err) {
            console.warn('[oja/export] Copy failed:', err);
            return false;
        }
    },

    async _processChunk(chunk, options) {
        // Default chunk processing - just return chunk
        // Override for custom processing
        return chunk;
    },
};

// Alias for convenience
export const exp = exporter;