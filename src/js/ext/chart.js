/**
 * oja/chart.js
 * Zero-dependency SVG chart primitives for admin and dashboard UIs.
 * No D3, no canvas — pure inline SVG written directly to a container element.
 *
 * Chart Types:
 *   chart.line     — spark line with area fill, tooltips, and responsive updates
 *   chart.bar      — vertical bar chart with warn thresholds and trend line
 *   chart.hbar     — horizontal bar chart for rankings and comparisons
 *   chart.pie      — pie/donut chart with legend and center text
 *   chart.gauge    — semicircular gauge with threshold markers and pointer
 *   chart.health   — segmented CSS-width bar showing ok/error split (0–100%)
 *   chart.area     — stacked area chart for multiple datasets
 *   chart.scatter  — scatter plot with optional trend line
 *   chart.clear    — clear chart container
 *   chart.exportSVG — export chart as SVG string
 *   chart.exportPNG — export chart as PNG data URL
 *
 * ─── chart.line ───────────────────────────────────────────────────────────────
 *
 *   import { chart } from '../oja/chart.js';
 *
 *   chart.line('#perfChartReqs', values, timestamps, {
 *       unit:   '/s',
 *       color:  'var(--accent)',
 *       warnAt: 1000,
 *       isInt:  true,
 *       minY:   0,
 *       maxY:   2000,
 *   });
 *
 * ─── chart.bar ────────────────────────────────────────────────────────────────
 *
 *   chart.bar('#responseGraph', values, {
 *       unit:    'ms',
 *       color:   'var(--chart-bar-fill)',
 *       warnAt:  500,
 *       label:   'last 60 samples',
 *   });
 *
 * ─── chart.hbar ───────────────────────────────────────────────────────────────
 *
 *   chart.hbar('#rankingsChart', [120, 95, 80], {
 *       labels: ['Service A', 'Service B', 'Service C'],
 *       unit:   'ms',
 *       color:  'var(--accent)',
 *   });
 *
 * ─── chart.pie ────────────────────────────────────────────────────────────────
 *
 *   chart.pie('#statusPie', [70, 20, 10], {
 *       labels:     ['OK', 'Warn', 'Error'],
 *       donut:      60,
 *       centerText: '100',
 *   });
 *
 * ─── chart.gauge ──────────────────────────────────────────────────────────────
 *
 *   chart.gauge('#cpuGauge', 72, {
 *       min:   0,
 *       max:   100,
 *       unit:  '%',
 *       label: 'CPU',
 *       thresholds: [{ value: 80, color: 'var(--danger)' }],
 *   });
 *
 * ─── chart.health ─────────────────────────────────────────────────────────────
 *
 *   chart.health('#globalHealthBar', total, errors);
 *
 * ─── chart.area ───────────────────────────────────────────────────────────────
 *
 *   chart.area('#stackedArea', [
 *       { data: [20, 40, 60, 80], color: 'var(--accent)' },
 *       { data: [60, 50, 30, 10] },
 *   ], timestamps);
 *
 * ─── chart.scatter ────────────────────────────────────────────────────────────
 *
 *   chart.scatter('#latencyScatter', [{ x: 1, y: 20 }, { x: 2, y: 35 }], {
 *       trendLine: true,
 *   });
 *
 * ─── Padding constants ────────────────────────────────────────────────────────
 *
 *   All SVG charts use the same internal padding object:
 *   { top: 14, right: 8, bottom: 20, left: 36 }
 *
 * ─── CSS variables consumed ───────────────────────────────────────────────────
 *
 *   --accent          default line/bar/hbar color
 *   --danger          warn threshold color
 *   --border          grid line color
 *   --text-mute       axis label color
 *   --bg              dot stroke / donut hole color
 *   --text            gauge pointer and value color
 *   --success         health bar ok segment color
 *   --chart-bar-fill  default bar fill color
 */

const PAD = Object.freeze({ top: 14, right: 8, bottom: 20, left: 36 });
const DEFAULT_COLORS = [
    '#4CAF50', '#2196F3', '#FFC107', '#f44336', '#9C27B0',
    '#FF9800', '#00BCD4', '#E91E63', '#8BC34A', '#3F51B5'
];

// Resolve a target to a DOM element — accepts selector string or Element.
function _el(target) {
    if (!target) return null;
    if (target instanceof Element) return target;
    return document.querySelector(target);
}

// Format a y-axis value — compact k-suffix above 1000.
// isInt suppresses the decimal for sub-10 values.
function _fmt(v, unit, isInt) {
    let s;
    if (v >= 1000)             s = (v / 1000).toFixed(1) + 'k';
    else if (!isInt && v < 10) s = v.toFixed(1);
    else                       s = Math.round(v).toString();
    return s + (unit || '');
}

// Render a "No data" placeholder centered in the container.
function _noData(el, message = 'No data') {
    if (el) el.innerHTML = `<div style="height:100%;display:flex;align-items:center;
        justify-content:center;color:var(--text-mute);font-size:11px;">${message}</div>`;
}

// Append a fixed tooltip div to document.body, auto-hides after 2s.
function _tooltip(el, x, y, content) {
    let tip = el.querySelector('.chart-tooltip');
    if (!tip) {
        tip = document.createElement('div');
        tip.className = 'chart-tooltip';
        tip.style.cssText = 'position:fixed;background:rgba(0,0,0,0.9);color:#fff;padding:6px 12px;border-radius:6px;font-size:12px;pointer-events:none;z-index:10000;white-space:nowrap;';
        document.body.appendChild(tip);
    }
    tip.innerHTML = content;
    tip.style.display = 'block';
    tip.style.left = (x + 10) + 'px';
    tip.style.top  = (y - 30) + 'px';
    setTimeout(() => tip.style.display = 'none', 2000);
}

// Return color from a custom palette or fall back to DEFAULT_COLORS by index.
function _getColor(index, customColors) {
    if (customColors && customColors[index]) return customColors[index];
    return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

export const chart = {

    /**
     * Spark line with gradient area fill, y-axis tick labels, and x-axis timestamps.
     * Matches the perf-chart.js pattern used in the performance modal.
     *
     * values:      number[]   — data points in chronological order
     * timestamps:  number[]   — Unix seconds, one per value (used for x-axis labels)
     * opts.unit:   string     — appended to y-axis labels (e.g. '/s', 'ms', '%')
     * opts.color:  string     — line and area fill color (CSS color or variable)
     * opts.warnAt: number     — when rawMax >= warnAt, switches to var(--danger)
     * opts.isInt:  boolean    — suppress decimals on y-axis labels
     * opts.minY:   number     — y-axis minimum (default 0)
     * opts.maxY:   number     — y-axis maximum (default rawMax * 1.15)
     */
    line(target, values, timestamps, opts = {}) {
        const el = _el(target);
        if (!el) return null;

        let currentValues     = values;
        let currentTimestamps = timestamps;
        let resizeObserver    = null;

        const render = () => {
            if (!el.isConnected) return;

            const W  = el.clientWidth  || 360;
            const H  = el.clientHeight || 110;
            const iW = W - PAD.left - PAD.right;
            const iH = H - PAD.top  - PAD.bottom;

            if (!currentValues?.length) { _noData(el); return; }

            const unit   = opts.unit   ?? '';
            const color  = opts.color  ?? 'var(--accent)';
            const isInt  = opts.isInt  ?? false;
            const warnAt = opts.warnAt ?? null;
            const rawMax = Math.max(...currentValues);
            const yMin   = opts.minY ?? 0;
            let   yMax   = opts.maxY ?? (rawMax === 0 ? 1 : rawMax * 1.15);
            if (yMax <= yMin) yMax = yMin + 1;

            const n    = currentValues.length;
            const xS   = i => PAD.left + (i / Math.max(n - 1, 1)) * iW;
            const yS   = v => PAD.top  + iH - ((Math.min(v, yMax) - yMin) / (yMax - yMin)) * iH;
            const pts  = currentValues.map((v, i) => `${xS(i).toFixed(1)},${yS(v).toFixed(1)}`).join(' ');
            const fX   = xS(0).toFixed(1);
            const lX   = xS(n - 1).toFixed(1);
            const bY   = (PAD.top + iH).toFixed(1);
            const area = `M${fX},${bY} ` + currentValues.map((v, i) => `L${xS(i).toFixed(1)},${yS(v).toFixed(1)}`).join(' ') + ` L${lX},${bY} Z`;
            const lc   = (warnAt !== null && rawMax >= warnAt) ? 'var(--danger)' : color;
            const gid  = `og_${Math.random().toString(36).slice(2, 8)}`;

            const ytks = [yMin, (yMin + yMax) / 2, yMax].map(v => ({
                y: yS(v),
                l: _fmt(v, unit, isInt),
            }));

            const tL   = ts => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const mid  = Math.floor((n - 1) / 2);
            const xlbs = [
                { x: xS(0),     l: tL(currentTimestamps[0]),     a: 'start'  },
                { x: xS(mid),   l: tL(currentTimestamps[mid]),   a: 'middle' },
                { x: xS(n - 1), l: tL(currentTimestamps[n - 1]), a: 'end'    },
            ];

            el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">
                <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stop-color="${lc}" stop-opacity="0.18"/>
                    <stop offset="100%" stop-color="${lc}" stop-opacity="0.01"/>
                </linearGradient></defs>
                ${ytks.map(t => `<line x1="${PAD.left}" y1="${t.y.toFixed(1)}" x2="${PAD.left + iW}" y2="${t.y.toFixed(1)}"
                    stroke="var(--border)" stroke-width="1" stroke-dasharray="3 3"/>`).join('')}
                <path d="${area}" fill="url(#${gid})"/>
                <polyline points="${pts}" fill="none" stroke="${lc}" stroke-width="1.5"
                    stroke-linejoin="round" stroke-linecap="round"/>
                <circle cx="${xS(n - 1).toFixed(1)}" cy="${yS(currentValues[n - 1]).toFixed(1)}"
                    r="3" fill="${lc}" stroke="var(--bg)" stroke-width="1.5"/>
                ${ytks.map(t => `<text x="${PAD.left - 4}" y="${(t.y + 3.5).toFixed(1)}"
                    data-axis="y" font-size="9" font-family="monospace" fill="var(--text-mute)" text-anchor="end">${t.l}</text>`).join('')}
                ${xlbs.map(xl => `<text x="${xl.x.toFixed(1)}" y="${H - 3}"
                    font-size="9" font-family="monospace" fill="var(--text-mute)" text-anchor="${xl.a}">${xl.l}</text>`).join('')}
            </svg>`;

            if (opts.tooltip) {
                const svg = el.querySelector('svg');
                svg.querySelectorAll('polyline, circle').forEach((point, idx) => {
                    point.style.cursor = 'pointer';
                    point.addEventListener('click', (e) => {
                        _tooltip(el, e.clientX, e.clientY, opts.tooltip(currentValues[idx], currentTimestamps[idx]));
                    });
                });
            }
        };

        render();

        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(() => render());
            resizeObserver.observe(el);
        }

        return {
            update(newValues, newTimestamps) {
                currentValues = newValues;
                if (newTimestamps) currentTimestamps = newTimestamps;
                render();
            },
            destroy() {
                if (resizeObserver) resizeObserver.disconnect();
            },
            exportSVG: () => el.querySelector('svg')?.outerHTML,
        };
    },

    /**
     * Vertical bar chart with optional per-bar warn colouring and trend line.
     * Matches the D3 responseGraph pattern used in dashboard.html.
     *
     * values:      number[]   — data points in chronological order
     * opts.unit:   string     — appended to y-axis labels
     * opts.color:  string     — default bar fill color
     * opts.warnAt: number     — bars where value >= warnAt use var(--danger)
     * opts.label:  string     — right-aligned x-axis label (e.g. 'last 60 samples')
     * opts.minY:   number     — y-axis minimum (default 0)
     * opts.maxY:   number     — y-axis maximum (default rawMax * 1.1)
     */
    bar(target, values, opts = {}) {
        const el = _el(target);
        if (!el) return null;

        let currentValues  = values;
        let resizeObserver = null;

        const render = () => {
            if (!el.isConnected) return;

            const W  = el.clientWidth  || 600;
            const H  = el.clientHeight || 160;
            const iW = W - PAD.left - PAD.right;
            const iH = H - PAD.top  - PAD.bottom;

            if (!currentValues?.length) { _noData(el); return; }

            const unit   = opts.unit   ?? '';
            const color  = opts.color  ?? 'var(--chart-bar-fill)';
            const warnAt = opts.warnAt ?? null;
            const label  = opts.label  ?? `last ${currentValues.length} samples`;
            const rawMax = Math.max(...currentValues, 1);
            const yMin   = opts.minY ?? 0;
            let   yMax   = opts.maxY ?? rawMax * 1.1;
            if (yMax <= yMin) yMax = yMin + 1;

            const n    = currentValues.length;
            const barW = Math.max(1, (iW / n) - 1);
            const xS   = i => PAD.left + (i / n) * iW;
            const yS   = v => PAD.top  + iH - ((Math.min(v, yMax) - yMin) / (yMax - yMin)) * iH;
            const bY   = PAD.top + iH;

            const ytks = [yMin, (yMin + yMax) / 2, yMax].map(v => ({
                y: yS(v),
                l: _fmt(v, unit, false),
            }));

            // Trend line over bar tops — matches the D3 line() pattern
            const linePts = currentValues.map((v, i) => `${(xS(i) + barW / 2).toFixed(1)},${yS(v).toFixed(1)}`).join(' ');

            // When provided, opts.colors[i] overrides opts.color for that bar.
            // warnAt still overrides both when the value exceeds the threshold.
            const colors = Array.isArray(opts.colors) ? opts.colors : null;

            const bars = currentValues.map((v, i) => {
                const baseColor = colors?.[i] ?? color;
                const barColor  = (warnAt !== null && v >= warnAt) ? 'var(--danger)' : baseColor;
                const y         = yS(v).toFixed(1);
                const barH      = Math.max(1, bY - parseFloat(y)).toFixed(1);
                return `<rect x="${xS(i).toFixed(1)}" y="${y}" width="${barW.toFixed(1)}" height="${barH}"
                    fill="${barColor}" fill-opacity="0.85" rx="1"/>`;
            }).join('');

            el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">
                ${ytks.map(t => `<line x1="${PAD.left}" y1="${t.y.toFixed(1)}" x2="${PAD.left + iW}" y2="${t.y.toFixed(1)}"
                    stroke="var(--border)" stroke-width="1" stroke-dasharray="3 3"/>`).join('')}
                ${bars}
                <polyline points="${linePts}" fill="none" stroke="${color}" stroke-width="1.5"
                    stroke-opacity="0.6" stroke-linejoin="round" stroke-linecap="round"/>
                ${ytks.map(t => `<text x="${PAD.left - 4}" y="${(t.y + 3.5).toFixed(1)}"
                    font-size="10" font-family="monospace" fill="var(--text-mute)" text-anchor="end">${t.l}</text>`).join('')}
                <text x="${PAD.left + iW}" y="${H - 3}"
                    font-size="9" font-family="monospace" fill="var(--text-mute)" text-anchor="end">${label}</text>
            </svg>`;
        };

        render();

        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(() => render());
            resizeObserver.observe(el);
        }

        return {
            // update(newValues, newOpts?) — newOpts merges into opts so per-call
            // overrides like a fresh colors array take effect immediately.
            update(newValues, newOpts) {
                currentValues = newValues;
                if (newOpts) Object.assign(opts, newOpts);
                render();
            },
            destroy() { resizeObserver?.disconnect(); },
        };
    },

    /**
     * Horizontal bar chart — rankings and comparisons.
     * opts.labels: string[]  — one label per bar (defaults to 'Item N')
     * opts.unit:   string    — value suffix appended to inline value labels
     * opts.color:  string    — bar fill color
     */
    hbar(target, values, opts = {}) {
        const el = _el(target);
        if (!el) return null;

        let currentValues = values;

        const render = () => {
            if (!el.isConnected) return;

            const W      = el.clientWidth  || 400;
            const H      = el.clientHeight || 300;
            const labels = opts.labels || currentValues.map((_, i) => `Item ${i + 1}`);
            const unit   = opts.unit  ?? '';
            const color  = opts.color ?? 'var(--accent)';
            const maxVal = Math.max(...currentValues, 1);
            const barH   = Math.max(20, (H - 40) / currentValues.length - 4);

            let html = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">`;
            currentValues.forEach((v, i) => {
                const barW = (v / maxVal) * (W - 100);
                const y    = 20 + i * (barH + 4);
                html += `<rect x="80" y="${y}" width="${barW}" height="${barH}" fill="${color}" rx="3"/>
                    <text x="75" y="${y + barH / 2 + 4}" text-anchor="end" font-size="11" fill="var(--text-mute)">${labels[i]}</text>
                    <text x="${80 + barW + 5}" y="${y + barH / 2 + 4}" font-size="10" fill="var(--text-mute)">${_fmt(v, unit, false)}</text>`;
            });
            html += `<line x1="80" y1="10" x2="80" y2="${H - 10}" stroke="var(--border)" stroke-width="1"/>
                <text x="${W - 10}" y="15" text-anchor="end" font-size="9" fill="var(--text-mute)">${unit}</text></svg>`;
            el.innerHTML = html;
        };

        render();
        return { update(newValues) { currentValues = newValues; render(); } };
    },

    /**
     * Pie/Donut chart with optional legend and center text.
     * data: number[]  — one value per slice
     * opts.labels:     string[]  — one label per slice
     * opts.colors:     string[]  — one color per slice
     * opts.donut:      number    — inner hole as % of radius (0 = solid pie)
     * opts.centerText: string    — text rendered inside the donut hole
     * opts.legend:     boolean   — show legend (default true)
     */
    pie(target, data, opts = {}) {
        const el = _el(target);
        if (!el) return null;

        let currentData = data;

        const render = () => {
            if (!el.isConnected) return;

            const W          = el.clientWidth  || 300;
            const H          = el.clientHeight || 300;
            const total      = currentData.reduce((a, b) => a + b, 0);
            const labels     = opts.labels || currentData.map((_, i) => `Segment ${i + 1}`);
            const colors     = opts.colors || DEFAULT_COLORS;
            const donut      = opts.donut      || 0;
            const centerText = opts.centerText || null;
            const radius     = Math.min(W, H) * 0.35;
            const centerX    = W / 2;
            const centerY    = H / 2;

            if (total === 0) { _noData(el, 'No data'); return; }

            let startAngle = 0;
            let html = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">`;

            currentData.forEach((value, i) => {
                const sliceAngle = (value / total) * (Math.PI * 2);
                const endAngle   = startAngle + sliceAngle;
                const x1         = centerX + radius * Math.cos(startAngle);
                const y1         = centerY + radius * Math.sin(startAngle);
                const x2         = centerX + radius * Math.cos(endAngle);
                const y2         = centerY + radius * Math.sin(endAngle);
                const largeArc   = sliceAngle > Math.PI ? 1 : 0;
                const path       = `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
                html += `<path d="${path}" fill="${_getColor(i, colors)}" stroke="var(--bg)" stroke-width="1"/>`;
                startAngle = endAngle;
            });

            if (donut > 0) {
                const holeRadius = radius * (donut / 100);
                html += `<circle cx="${centerX}" cy="${centerY}" r="${holeRadius}" fill="var(--bg)"/>`;
                if (centerText) {
                    html += `<text x="${centerX}" y="${centerY + 4}" text-anchor="middle" font-size="14" fill="var(--text)">${centerText}</text>`;
                }
            }

            if (opts.legend !== false) {
                let legendY   = 20;
                const legendX = W - 80;
                labels.forEach((label, i) => {
                    html += `<rect x="${legendX}" y="${legendY}" width="12" height="12" fill="${_getColor(i, colors)}" rx="2"/>
                        <text x="${legendX + 18}" y="${legendY + 10}" font-size="10" fill="var(--text-mute)">${label}</text>`;
                    legendY += 18;
                });
            }

            html += `</svg>`;
            el.innerHTML = html;
        };

        render();
        return { update(newData) { currentData = newData; render(); } };
    },

    /**
     * Semicircular gauge — background arc left-to-right, value arc overlaid, pointer from center.
     * opts.min:        number                    — minimum value (default 0)
     * opts.max:        number                    — maximum value (default 100)
     * opts.unit:       string                    — suffix appended to center value label
     * opts.label:      string                    — caption rendered below the value
     * opts.thresholds: Array<{ value, color }>   — dot markers placed on the arc rim
     */
    gauge(target, value, opts = {}) {
        const el = _el(target);
        if (!el) return null;

        let currentValue = value;

        const render = () => {
            if (!el.isConnected) return;

            const W       = el.clientWidth  || 200;
            const H       = el.clientHeight || 200;
            const min     = opts.min  ?? 0;
            const max     = opts.max  ?? 100;
            const unit    = opts.unit ?? '%';
            const size    = opts.size || Math.min(W, H);
            const centerX = W / 2;
            const centerY = H * 0.6;
            const radius  = size * 0.4;

            // Map value onto 0..π, then rotate -π so 0 = left, π = right (left-to-right sweep)
            const ratio  = Math.max(0, Math.min(1, (currentValue - min) / (max - min)));
            const angle  = Math.PI + ratio * Math.PI;
            const endX   = centerX + radius * Math.cos(angle);
            const endY   = centerY + radius * Math.sin(angle);
            const arcX1  = centerX - radius;
            const arcX2  = centerX + radius;

            let html = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">
                <path d="M ${arcX1} ${centerY} A ${radius} ${radius} 0 0 1 ${arcX2} ${centerY}"
                    fill="none" stroke="var(--border)" stroke-width="12"/>
                <path d="M ${arcX1} ${centerY} A ${radius} ${radius} 0 0 1 ${endX.toFixed(2)} ${endY.toFixed(2)}"
                    fill="none" stroke="var(--accent)" stroke-width="12" stroke-linecap="round"/>`;

            if (opts.thresholds) {
                opts.thresholds.forEach(t => {
                    const tRatio = Math.max(0, Math.min(1, (t.value - min) / (max - min)));
                    const tAngle = Math.PI + tRatio * Math.PI;
                    const tx     = centerX + (radius + 8) * Math.cos(tAngle);
                    const ty     = centerY + (radius + 8) * Math.sin(tAngle);
                    html += `<circle cx="${tx.toFixed(2)}" cy="${ty.toFixed(2)}" r="4" fill="${t.color}"/>`;
                });
            }

            html += `<circle cx="${centerX}" cy="${centerY}" r="8" fill="var(--text)" stroke="var(--bg)" stroke-width="2"/>
                <line x1="${centerX}" y1="${centerY}" x2="${endX.toFixed(2)}" y2="${endY.toFixed(2)}"
                    stroke="var(--text)" stroke-width="2"/>
                <text x="${centerX}" y="${centerY - radius * 0.3}" text-anchor="middle" font-size="24" fill="var(--text)">${_fmt(currentValue, unit, false)}</text>
                <text x="${centerX}" y="${centerY - radius * 0.3 + 18}" text-anchor="middle" font-size="10" fill="var(--text-mute)">${opts.label || ''}</text>
            </svg>`;
            el.innerHTML = html;
        };

        render();
        return { update(newValue) { currentValue = newValue; render(); } };
    },

    /**
     * Segmented CSS-width health bar — two divs rendered inside the container.
     * total == 0 is a no-op so the container keeps its placeholder content.
     *
     * total:  number — total request count
     * errors: number — error request count
     */
    health(target, total, errors) {
        const el = _el(target);
        if (!el || total === 0) return;

        const errPct = Math.min(100, (errors / total) * 100);
        const okPct  = 100 - errPct;

        el.innerHTML = `
            <div class="hb-seg hb-ok"  style="width:${okPct.toFixed(2)}%;background:var(--success);height:100%;transition:width 0.3s"></div>
            <div class="hb-seg hb-err" style="width:${errPct.toFixed(2)}%;background:var(--danger);height:100%;transition:width 0.3s"></div>`;
    },

    /**
     * Stacked area chart for multiple datasets, each 0–100 scaled.
     * datasets: Array<{ data: number[], color?: string }>
     * opts.colors:  string[]  — fallback palette when dataset has no color
     * opts.opacity: number    — fill opacity (default 0.6)
     */
    area(target, datasets, timestamps, opts = {}) {
        const el = _el(target);
        if (!el) return null;

        let currentDatasets = datasets;

        const render = () => {
            if (!el.isConnected) return;

            const W  = el.clientWidth  || 400;
            const H  = el.clientHeight || 200;
            const iW = W - PAD.left - PAD.right;
            const iH = H - PAD.top  - PAD.bottom;

            if (!currentDatasets?.length) { _noData(el); return; }

            const n  = currentDatasets[0].data.length;
            const xS = i => PAD.left + (i / Math.max(n - 1, 1)) * iW;
            const yS = v => PAD.top  + iH - (v / 100) * iH;

            let html = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">`;

            for (let i = currentDatasets.length - 1; i >= 0; i--) {
                const ds    = currentDatasets[i];
                const color = ds.color || _getColor(i, opts.colors);
                let path    = `M ${xS(0).toFixed(1)},${yS(ds.data[0]).toFixed(1)}`;
                for (let j = 1; j < n; j++) {
                    path += ` L ${xS(j).toFixed(1)},${yS(ds.data[j]).toFixed(1)}`;
                }
                path += ` L ${xS(n - 1).toFixed(1)},${yS(0).toFixed(1)} L ${xS(0).toFixed(1)},${yS(0).toFixed(1)} Z`;
                html += `<path d="${path}" fill="${color}" fill-opacity="${opts.opacity || 0.6}" stroke="none"/>`;
            }

            html += `</svg>`;
            el.innerHTML = html;
        };

        render();
        return { update(newDatasets) { currentDatasets = newDatasets; render(); } };
    },

    /**
     * Scatter plot with grid lines and optional least-squares trend line.
     * points: Array<{ x: number, y: number }>
     * opts.trendLine:  boolean  — draw regression line
     * opts.trendColor: string   — trend line stroke color
     * opts.pointSize:  number   — dot radius (default 4)
     * opts.color:      string   — dot fill color
     */
    scatter(target, points, opts = {}) {
        const el = _el(target);
        if (!el) return null;

        let currentPoints = points;

        const render = () => {
            if (!el.isConnected) return;

            const W  = el.clientWidth  || 400;
            const H  = el.clientHeight || 300;
            const iW = W - PAD.left - PAD.right;
            const iH = H - PAD.top  - PAD.bottom;

            if (!currentPoints?.length) { _noData(el); return; }

            const xValues = currentPoints.map(p => p.x);
            const yValues = currentPoints.map(p => p.y);
            const xMin    = Math.min(...xValues, opts.xMin ?? 0);
            const xMax    = Math.max(...xValues, opts.xMax ?? 1);
            const yMin    = Math.min(...yValues, opts.yMin ?? 0);
            const yMax    = Math.max(...yValues, opts.yMax ?? 1);

            const xS = x => PAD.left + ((x - xMin) / (xMax - xMin)) * iW;
            const yS = y => PAD.top  + iH - ((y - yMin) / (yMax - yMin)) * iH;

            let html = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">`;

            for (let i = 0; i <= 4; i++) {
                const x = PAD.left + (i / 4) * iW;
                const y = PAD.top  + (i / 4) * iH;
                html += `<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${PAD.top + iH}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 3"/>
                    <line x1="${PAD.left}" y1="${y}" x2="${PAD.left + iW}" y2="${y}" stroke="var(--border)" stroke-width="1" stroke-dasharray="3 3"/>`;
            }

            currentPoints.forEach(p => {
                html += `<circle cx="${xS(p.x)}" cy="${yS(p.y)}" r="${opts.pointSize || 4}" fill="${opts.color || '#4CAF50'}" stroke="var(--bg)" stroke-width="1"/>`;
            });

            if (opts.trendLine && currentPoints.length >= 2) {
                const n         = currentPoints.length;
                const sumX      = xValues.reduce((acc, x) => acc + x, 0);
                const sumY      = yValues.reduce((acc, y) => acc + y, 0);
                const sumXY     = currentPoints.reduce((acc, p) => acc + p.x * p.y, 0);
                const sumX2     = xValues.reduce((acc, x) => acc + x * x, 0);
                const denom     = n * sumX2 - sumX * sumX;
                if (denom !== 0) {
                    const slope     = (n * sumXY - sumX * sumY) / denom;
                    const intercept = (sumY - slope * sumX) / n;
                    html += `<line x1="${xS(xMin)}" y1="${yS(slope * xMin + intercept)}" x2="${xS(xMax)}" y2="${yS(slope * xMax + intercept)}"
                        stroke="${opts.trendColor || '#FFC107'}" stroke-width="2" stroke-dasharray="5 5"/>`;
                }
            }

            html += `</svg>`;
            el.innerHTML = html;
        };

        render();
        return { update(newPoints) { currentPoints = newPoints; render(); } };
    },

    /**
     * Clear a chart container back to empty.
     * Useful when data is loading or the time window has been reset.
     */
    clear(target) {
        const el = _el(target);
        if (el) el.innerHTML = '';
    },

    /**
     * Export the chart SVG as a raw string.
     * Returns null if the target has no SVG child.
     */
    exportSVG(target) {
        const el  = _el(target);
        const svg = el?.querySelector('svg');
        return svg?.outerHTML || null;
    },

    /**
     * Export the chart as a PNG data URL via canvas.
     * Returns a Promise resolving to a data URL, or null if no SVG is found.
     */
    async exportPNG(target) {
        const svg = this.exportSVG(target);
        if (!svg) return null;

        return new Promise((resolve) => {
            const img    = new Image();
            const canvas = document.createElement('canvas');
            const ctx    = canvas.getContext('2d');
            img.onload = () => {
                canvas.width  = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            };
            img.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
        });
    },
};
