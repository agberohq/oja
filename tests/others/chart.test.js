import { describe, it, expect, afterEach } from 'vitest';
import { chart } from '../../src/js/ext/chart.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeContainer(w = 400, h = 120) {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth',  { get: () => w, configurable: true });
    Object.defineProperty(el, 'clientHeight', { get: () => h, configurable: true });
    document.body.appendChild(el);
    return el;
}

function cleanup(el) {
    if (el?.parentNode) el.remove();
}

const VALUES     = [10, 20, 15, 30, 25];
const TIMESTAMPS = [1700000000, 1700000060, 1700000120, 1700000180, 1700000240];

// ─── chart.line ───────────────────────────────────────────────────────────────

describe('chart.line()', () => {
    let el;
    afterEach(() => cleanup(el));

    it('renders an SVG element into the container', () => {
        el = makeContainer();
        chart.line(el, VALUES, TIMESTAMPS);
        expect(el.querySelector('svg')).not.toBeNull();
    });

    it('SVG dimensions match container clientWidth and clientHeight', () => {
        el = makeContainer(600, 150);
        chart.line(el, VALUES, TIMESTAMPS);
        const svg = el.querySelector('svg');
        expect(svg.getAttribute('width')).toBe('600');
        expect(svg.getAttribute('height')).toBe('150');
    });

    it('renders a polyline for the line stroke', () => {
        el = makeContainer();
        chart.line(el, VALUES, TIMESTAMPS);
        expect(el.querySelector('polyline')).not.toBeNull();
    });

    it('renders a path for the gradient area fill', () => {
        el = makeContainer();
        chart.line(el, VALUES, TIMESTAMPS);
        expect(el.querySelectorAll('path').length).toBeGreaterThan(0);
    });

    it('renders a linearGradient in defs', () => {
        el = makeContainer();
        chart.line(el, VALUES, TIMESTAMPS);
        expect(el.querySelector('linearGradient')).not.toBeNull();
    });

    it('renders a tail dot circle at the last value', () => {
        el = makeContainer();
        chart.line(el, VALUES, TIMESTAMPS);
        expect(el.querySelector('circle')).not.toBeNull();
    });

    it('renders three y-axis tick labels', () => {
        el = makeContainer();
        chart.line(el, VALUES, TIMESTAMPS);
        expect(el.querySelectorAll('text[data-axis="y"]').length).toBe(3);
    });

    it('renders three x-axis timestamp labels', () => {
        el = makeContainer();
        chart.line(el, VALUES, TIMESTAMPS);
        const xAxisTexts = Array.from(el.querySelectorAll('text')).filter(t =>
            ['start', 'middle', 'end'].includes(t.getAttribute('text-anchor'))
        );
        expect(xAxisTexts.length).toBeGreaterThanOrEqual(3);
    });

    it('shows "No data" when values is empty', () => {
        el = makeContainer();
        chart.line(el, [], TIMESTAMPS);
        expect(el.textContent).toContain('No data');
        expect(el.querySelector('svg')).toBeNull();
    });

    it('shows "No data" when values is null', () => {
        el = makeContainer();
        chart.line(el, null, TIMESTAMPS);
        expect(el.textContent).toContain('No data');
    });

    it('uses var(--danger) as line color when rawMax >= warnAt', () => {
        el = makeContainer();
        chart.line(el, [100, 200, 300], TIMESTAMPS.slice(0, 3), { warnAt: 100 });
        expect(el.querySelector('polyline').getAttribute('stroke')).toBe('var(--danger)');
    });

    it('uses the provided color when rawMax is below warnAt', () => {
        el = makeContainer();
        chart.line(el, [10, 20, 5], TIMESTAMPS.slice(0, 3), { color: 'var(--accent)', warnAt: 500 });
        expect(el.querySelector('polyline').getAttribute('stroke')).toBe('var(--accent)');
    });

    it('uses default color var(--accent) when no color option given', () => {
        el = makeContainer();
        chart.line(el, VALUES, TIMESTAMPS);
        expect(el.querySelector('polyline').getAttribute('stroke')).toBe('var(--accent)');
    });

    it('does nothing when target element is not found', () => {
        expect(() => chart.line('#does-not-exist', VALUES, TIMESTAMPS)).not.toThrow();
    });

    it('accepts a DOM Element directly as target', () => {
        el = makeContainer();
        chart.line(el, VALUES, TIMESTAMPS);
        expect(el.querySelector('svg')).not.toBeNull();
    });

    it('returns an object with update and destroy methods', () => {
        el = makeContainer();
        const instance = chart.line(el, VALUES, TIMESTAMPS);
        expect(typeof instance.update).toBe('function');
        expect(typeof instance.destroy).toBe('function');
    });

    it('update() re-renders with new values', () => {
        el = makeContainer();
        const instance = chart.line(el, VALUES, TIMESTAMPS);
        instance.update([1, 2, 3], TIMESTAMPS.slice(0, 3));
        expect(el.querySelector('svg')).not.toBeNull();
    });
});

// ─── chart.bar ────────────────────────────────────────────────────────────────

describe('chart.bar()', () => {
    let el;
    afterEach(() => cleanup(el));

    it('renders an SVG element into the container', () => {
        el = makeContainer();
        chart.bar(el, VALUES);
        expect(el.querySelector('svg')).not.toBeNull();
    });

    it('SVG dimensions match container size', () => {
        el = makeContainer(800, 200);
        chart.bar(el, VALUES);
        const svg = el.querySelector('svg');
        expect(svg.getAttribute('width')).toBe('800');
        expect(svg.getAttribute('height')).toBe('200');
    });

    it('renders one rect per data value', () => {
        el = makeContainer();
        chart.bar(el, VALUES);
        expect(el.querySelectorAll('rect').length).toBe(VALUES.length);
    });

    it('renders a trend polyline over bar tops', () => {
        el = makeContainer();
        chart.bar(el, VALUES);
        expect(el.querySelector('polyline')).not.toBeNull();
    });

    it('renders three y-axis tick labels', () => {
        el = makeContainer();
        chart.bar(el, VALUES);
        const endTexts = Array.from(el.querySelectorAll('text')).filter(t => t.getAttribute('text-anchor') === 'end');
        expect(endTexts.length).toBeGreaterThanOrEqual(3);
    });

    it('renders the label text in the x-axis footer', () => {
        el = makeContainer();
        chart.bar(el, VALUES, { label: 'last 60 samples' });
        expect(el.textContent).toContain('last 60 samples');
    });

    it('uses default label when none is provided', () => {
        el = makeContainer();
        chart.bar(el, VALUES);
        expect(el.textContent).toContain(`last ${VALUES.length} samples`);
    });

    it('colours bars at or above warnAt with var(--danger)', () => {
        el = makeContainer();
        chart.bar(el, [10, 500, 20], { warnAt: 500 });
        const rects = Array.from(el.querySelectorAll('rect'));
        expect(rects[1].getAttribute('fill')).toBe('var(--danger)');
        expect(rects[0].getAttribute('fill')).not.toBe('var(--danger)');
    });

    it('shows "No data" when values is empty', () => {
        el = makeContainer();
        chart.bar(el, []);
        expect(el.textContent).toContain('No data');
        expect(el.querySelector('svg')).toBeNull();
    });

    it('shows "No data" when values is null', () => {
        el = makeContainer();
        chart.bar(el, null);
        expect(el.textContent).toContain('No data');
    });

    it('uses default color var(--chart-bar-fill) when no color given', () => {
        el = makeContainer();
        chart.bar(el, VALUES);
        expect(el.querySelector('rect').getAttribute('fill')).toBe('var(--chart-bar-fill)');
    });

    it('does nothing when target element is not found', () => {
        expect(() => chart.bar('#does-not-exist', VALUES)).not.toThrow();
    });

    it('each bar has a non-zero height', () => {
        el = makeContainer();
        chart.bar(el, VALUES);
        for (const rect of el.querySelectorAll('rect')) {
            expect(parseFloat(rect.getAttribute('height'))).toBeGreaterThan(0);
        }
    });

    it('returns an object with update method', () => {
        el = makeContainer();
        const instance = chart.bar(el, VALUES);
        expect(typeof instance.update).toBe('function');
    });

    it('update() re-renders with new values', () => {
        el = makeContainer();
        const instance = chart.bar(el, VALUES);
        instance.update([5, 10, 15]);
        expect(el.querySelectorAll('rect').length).toBe(3);
    });
});

// ─── chart.hbar ───────────────────────────────────────────────────────────────

describe('chart.hbar()', () => {
    let el;
    afterEach(() => cleanup(el));

    it('renders an SVG element into the container', () => {
        el = makeContainer(400, 200);
        chart.hbar(el, [100, 80, 60]);
        expect(el.querySelector('svg')).not.toBeNull();
    });

    it('SVG dimensions match container size', () => {
        el = makeContainer(500, 250);
        chart.hbar(el, [100, 80, 60]);
        const svg = el.querySelector('svg');
        expect(svg.getAttribute('width')).toBe('500');
        expect(svg.getAttribute('height')).toBe('250');
    });

    it('renders one rect per data value', () => {
        el = makeContainer(400, 200);
        chart.hbar(el, [100, 80, 60]);
        expect(el.querySelectorAll('rect').length).toBe(3);
    });

    it('renders provided labels as text elements', () => {
        el = makeContainer(400, 200);
        chart.hbar(el, [100, 80], { labels: ['Alpha', 'Beta'] });
        expect(el.textContent).toContain('Alpha');
        expect(el.textContent).toContain('Beta');
    });

    it('falls back to "Item N" labels when none provided', () => {
        el = makeContainer(400, 200);
        chart.hbar(el, [100, 80]);
        expect(el.textContent).toContain('Item 1');
        expect(el.textContent).toContain('Item 2');
    });

    it('uses default color var(--accent) when no color given', () => {
        el = makeContainer(400, 200);
        chart.hbar(el, [100]);
        expect(el.querySelector('rect').getAttribute('fill')).toBe('var(--accent)');
    });

    it('does nothing when target element is not found', () => {
        expect(() => chart.hbar('#does-not-exist', [100, 80])).not.toThrow();
    });

    it('returns an object with update method', () => {
        el = makeContainer(400, 200);
        const instance = chart.hbar(el, [100, 80]);
        expect(typeof instance.update).toBe('function');
    });

    it('update() re-renders with new values', () => {
        el = makeContainer(400, 200);
        const instance = chart.hbar(el, [100, 80, 60]);
        instance.update([50, 30]);
        expect(el.querySelectorAll('rect').length).toBe(2);
    });
});

// ─── chart.pie ────────────────────────────────────────────────────────────────

describe('chart.pie()', () => {
    let el;
    afterEach(() => cleanup(el));

    it('renders an SVG element into the container', () => {
        el = makeContainer(300, 300);
        chart.pie(el, [60, 30, 10]);
        expect(el.querySelector('svg')).not.toBeNull();
    });

    it('renders one path per slice', () => {
        el = makeContainer(300, 300);
        chart.pie(el, [60, 30, 10]);
        expect(el.querySelectorAll('path').length).toBe(3);
    });

    it('shows "No data" when total is zero', () => {
        el = makeContainer(300, 300);
        chart.pie(el, [0, 0, 0]);
        expect(el.textContent).toContain('No data');
        expect(el.querySelector('svg')).toBeNull();
    });

    it('renders a donut hole circle when donut > 0', () => {
        el = makeContainer(300, 300);
        chart.pie(el, [60, 40], { donut: 60 });
        const circles = el.querySelectorAll('circle');
        expect(circles.length).toBeGreaterThan(0);
    });

    it('renders center text inside the donut hole', () => {
        el = makeContainer(300, 300);
        chart.pie(el, [60, 40], { donut: 60, centerText: '100%' });
        expect(el.textContent).toContain('100%');
    });

    it('renders legend by default', () => {
        el = makeContainer(300, 300);
        chart.pie(el, [60, 40], { labels: ['OK', 'Error'] });
        expect(el.textContent).toContain('OK');
        expect(el.textContent).toContain('Error');
    });

    it('omits legend when opts.legend is false', () => {
        el = makeContainer(300, 300);
        chart.pie(el, [60, 40], { labels: ['OK', 'Error'], legend: false });
        expect(el.textContent).not.toContain('OK');
    });

    it('does nothing when target element is not found', () => {
        expect(() => chart.pie('#does-not-exist', [60, 40])).not.toThrow();
    });

    it('returns an object with update method', () => {
        el = makeContainer(300, 300);
        const instance = chart.pie(el, [60, 40]);
        expect(typeof instance.update).toBe('function');
    });

    it('update() re-renders with new data', () => {
        el = makeContainer(300, 300);
        const instance = chart.pie(el, [60, 40]);
        instance.update([50, 30, 20]);
        expect(el.querySelectorAll('path').length).toBe(3);
    });
});

// ─── chart.gauge ──────────────────────────────────────────────────────────────

describe('chart.gauge()', () => {
    let el;
    afterEach(() => cleanup(el));

    it('renders an SVG element into the container', () => {
        el = makeContainer(200, 200);
        chart.gauge(el, 50);
        expect(el.querySelector('svg')).not.toBeNull();
    });

    it('SVG dimensions match container size', () => {
        el = makeContainer(300, 300);
        chart.gauge(el, 50);
        const svg = el.querySelector('svg');
        expect(svg.getAttribute('width')).toBe('300');
        expect(svg.getAttribute('height')).toBe('300');
    });

    it('renders a background arc path', () => {
        el = makeContainer(200, 200);
        chart.gauge(el, 50);
        expect(el.querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
    });

    it('renders the value as text', () => {
        el = makeContainer(200, 200);
        chart.gauge(el, 72, { unit: '%' });
        expect(el.textContent).toContain('72%');
    });

    it('renders the label when provided', () => {
        el = makeContainer(200, 200);
        chart.gauge(el, 50, { label: 'CPU' });
        expect(el.textContent).toContain('CPU');
    });

    it('renders threshold marker circles', () => {
        el = makeContainer(200, 200);
        chart.gauge(el, 50, { thresholds: [{ value: 80, color: 'red' }, { value: 90, color: 'orange' }] });
        const circles = el.querySelectorAll('circle');
        expect(circles.length).toBeGreaterThanOrEqual(2);
    });

    it('does nothing when target element is not found', () => {
        expect(() => chart.gauge('#does-not-exist', 50)).not.toThrow();
    });

    it('returns an object with update method', () => {
        el = makeContainer(200, 200);
        const instance = chart.gauge(el, 50);
        expect(typeof instance.update).toBe('function');
    });

    it('update() re-renders with new value', () => {
        el = makeContainer(200, 200);
        const instance = chart.gauge(el, 50, { unit: '%' });
        instance.update(90);
        expect(el.textContent).toContain('90%');
    });
});

// ─── chart.health ─────────────────────────────────────────────────────────────

describe('chart.health()', () => {
    let el;
    afterEach(() => cleanup(el));

    it('renders two child divs — hb-ok and hb-err', () => {
        el = makeContainer();
        chart.health(el, 100, 20);
        expect(el.querySelector('.hb-ok')).not.toBeNull();
        expect(el.querySelector('.hb-err')).not.toBeNull();
    });

    it('ok segment width = (1 - errPct)%', () => {
        el = makeContainer();
        chart.health(el, 100, 25);
        expect(parseFloat(el.querySelector('.hb-ok').style.width)).toBeCloseTo(75, 5);
    });

    it('error segment width = errPct%', () => {
        el = makeContainer();
        chart.health(el, 100, 25);
        expect(parseFloat(el.querySelector('.hb-err').style.width)).toBeCloseTo(25, 5);
    });

    it('ok + err widths always sum to 100%', () => {
        el = makeContainer();
        chart.health(el, 200, 37);
        const ok  = parseFloat(el.querySelector('.hb-ok').style.width);
        const err = parseFloat(el.querySelector('.hb-err').style.width);
        expect(ok + err).toBeCloseTo(100, 5);
    });

    it('is a no-op when total is 0 — leaves existing HTML untouched', () => {
        el = makeContainer();
        el.innerHTML = '<div class="placeholder"></div>';
        chart.health(el, 0, 0);
        expect(el.querySelector('.placeholder')).not.toBeNull();
    });

    it('caps error percentage at 100% when errors > total', () => {
        el = makeContainer();
        chart.health(el, 10, 999);
        expect(parseFloat(el.querySelector('.hb-err').style.width)).toBeLessThanOrEqual(100);
    });

    it('renders 0% error when all requests succeed', () => {
        el = makeContainer();
        chart.health(el, 500, 0);
        expect(parseFloat(el.querySelector('.hb-err').style.width)).toBeCloseTo(0, 5);
        expect(parseFloat(el.querySelector('.hb-ok').style.width)).toBeCloseTo(100, 5);
    });

    it('does nothing when target element is not found', () => {
        expect(() => chart.health('#does-not-exist', 100, 10)).not.toThrow();
    });

    it('accepts a CSS selector string as target', () => {
        el = makeContainer();
        el.id = 'testHealthBar';
        chart.health('#testHealthBar', 100, 50);
        expect(el.querySelector('.hb-ok')).not.toBeNull();
    });
});

// ─── chart.area ───────────────────────────────────────────────────────────────

describe('chart.area()', () => {
    let el;
    afterEach(() => cleanup(el));

    const DATASETS = [
        { data: [10, 30, 50, 70], color: '#4CAF50' },
        { data: [80, 60, 40, 20] },
    ];

    it('renders an SVG element into the container', () => {
        el = makeContainer(400, 200);
        chart.area(el, DATASETS, TIMESTAMPS.slice(0, 4));
        expect(el.querySelector('svg')).not.toBeNull();
    });

    it('renders one path per dataset', () => {
        el = makeContainer(400, 200);
        chart.area(el, DATASETS, TIMESTAMPS.slice(0, 4));
        expect(el.querySelectorAll('path').length).toBe(DATASETS.length);
    });

    it('shows "No data" when datasets is empty', () => {
        el = makeContainer(400, 200);
        chart.area(el, [], TIMESTAMPS);
        expect(el.textContent).toContain('No data');
    });

    it('applies dataset color to the path fill', () => {
        el = makeContainer(400, 200);
        chart.area(el, [{ data: [10, 20, 30], color: '#FF0000' }], TIMESTAMPS.slice(0, 3));
        expect(el.querySelector('path').getAttribute('fill')).toBe('#FF0000');
    });

    it('does nothing when target element is not found', () => {
        expect(() => chart.area('#does-not-exist', DATASETS, TIMESTAMPS)).not.toThrow();
    });

    it('returns an object with update method', () => {
        el = makeContainer(400, 200);
        const instance = chart.area(el, DATASETS, TIMESTAMPS.slice(0, 4));
        expect(typeof instance.update).toBe('function');
    });

    it('update() re-renders with new datasets', () => {
        el = makeContainer(400, 200);
        const instance = chart.area(el, DATASETS, TIMESTAMPS.slice(0, 4));
        instance.update([{ data: [5, 10, 15, 20] }]);
        expect(el.querySelectorAll('path').length).toBe(1);
    });
});

// ─── chart.scatter ────────────────────────────────────────────────────────────

describe('chart.scatter()', () => {
    let el;
    afterEach(() => cleanup(el));

    const POINTS = [{ x: 1, y: 10 }, { x: 2, y: 20 }, { x: 3, y: 15 }, { x: 4, y: 30 }];

    it('renders an SVG element into the container', () => {
        el = makeContainer(400, 300);
        chart.scatter(el, POINTS);
        expect(el.querySelector('svg')).not.toBeNull();
    });

    it('renders one circle per point', () => {
        el = makeContainer(400, 300);
        chart.scatter(el, POINTS);
        expect(el.querySelectorAll('circle').length).toBe(POINTS.length);
    });

    it('renders grid lines', () => {
        el = makeContainer(400, 300);
        chart.scatter(el, POINTS);
        expect(el.querySelectorAll('line').length).toBeGreaterThan(0);
    });

    it('renders a trend line when trendLine is true', () => {
        el = makeContainer(400, 300);
        chart.scatter(el, POINTS, { trendLine: true });
        const lines = Array.from(el.querySelectorAll('line'));
        const trendLine = lines.find(l => l.getAttribute('stroke-dasharray') === '5 5');
        expect(trendLine).not.toBeUndefined();
    });

    it('does not render a trend line when trendLine is false', () => {
        el = makeContainer(400, 300);
        chart.scatter(el, POINTS, { trendLine: false });
        const lines = Array.from(el.querySelectorAll('line'));
        const trendLine = lines.find(l => l.getAttribute('stroke-dasharray') === '5 5');
        expect(trendLine).toBeUndefined();
    });

    it('shows "No data" when points is empty', () => {
        el = makeContainer(400, 300);
        chart.scatter(el, []);
        expect(el.textContent).toContain('No data');
    });

    it('does nothing when target element is not found', () => {
        expect(() => chart.scatter('#does-not-exist', POINTS)).not.toThrow();
    });

    it('returns an object with update method', () => {
        el = makeContainer(400, 300);
        const instance = chart.scatter(el, POINTS);
        expect(typeof instance.update).toBe('function');
    });

    it('update() re-renders with new points', () => {
        el = makeContainer(400, 300);
        const instance = chart.scatter(el, POINTS);
        instance.update([{ x: 1, y: 5 }, { x: 2, y: 10 }]);
        expect(el.querySelectorAll('circle').length).toBe(2);
    });
});

// ─── chart.clear ──────────────────────────────────────────────────────────────

describe('chart.clear()', () => {
    let el;
    afterEach(() => cleanup(el));

    it('empties the container innerHTML', () => {
        el = makeContainer();
        chart.line(el, VALUES, TIMESTAMPS);
        chart.clear(el);
        expect(el.innerHTML).toBe('');
    });

    it('does nothing when target element is not found', () => {
        expect(() => chart.clear('#does-not-exist')).not.toThrow();
    });
});

// ─── chart.exportSVG ──────────────────────────────────────────────────────────

describe('chart.exportSVG()', () => {
    let el;
    afterEach(() => cleanup(el));

    it('returns the SVG outerHTML string', () => {
        el = makeContainer();
        chart.line(el, VALUES, TIMESTAMPS);
        const result = chart.exportSVG(el);
        expect(typeof result).toBe('string');
        expect(result).toContain('<svg');
    });

    it('returns null when container has no SVG', () => {
        el = makeContainer();
        expect(chart.exportSVG(el)).toBeNull();
    });

    it('returns null when target is not found', () => {
        expect(chart.exportSVG('#does-not-exist')).toBeNull();
    });
});