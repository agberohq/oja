
/**
 * oja/canvas.js
 * Canvas utilities — drawing, image processing, and visualization helpers.
 * Makes working with canvas elements zero-boilerplate.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { canvas } from '../oja/canvas.js';
 *
 *   // Get canvas context with options
 *   const ctx = canvas.get('#myCanvas', { width: 800, height: 600 });
 *
 *   // Clear and resize
 *   canvas.clear('#myCanvas');
 *   canvas.resize('#myCanvas', 1024, 768);
 *
 * ─── Drawing utilities ────────────────────────────────────────────────────────
 *
 *   // Draw with auto-clear and save/restore
 *   canvas.draw('#chart', (ctx, size) => {
 *       ctx.fillStyle = 'blue';
 *       ctx.fillRect(10, 10, size.width - 20, 100);
 *   });
 *
 *   // Grid and axes
 *   canvas.drawGrid(ctx, width, height, { step: 50, color: '#ddd' });
 *   canvas.drawAxes(ctx, width, height);
 *
 * ─── Responsive canvas ────────────────────────────────────────────────────────
 *
 *   // Auto-resize with container (uses ResizeObserver)
 *   const responsive = canvas.responsive('#chart', (ctx, size) => {
 *       drawChart(ctx, size);
 *   });
 *
 *   // Clean up
 *   responsive.destroy();
 *
 * ─── Image processing ─────────────────────────────────────────────────────────
 *
 *   // Load image into canvas
 *   await canvas.loadImage('#editor', '/uploads/photo.jpg');
 *
 *   // Apply filters
 *   canvas.filter('#editor', 'grayscale(100%)');
 *   canvas.filter('#editor', 'sepia(50%)');
 *
 *   // Get image data
 *   const data = canvas.getImageData('#editor');
 *   const blob = await canvas.toBlob('#editor', 'image/png');
 *
 * ─── Charts and visualizations ────────────────────────────────────────────────
 *
 *   // Draw bar chart
 *   canvas.barChart('#stats', [120, 85, 200, 75, 160], {
 *       colors: ['#4CAF50', '#2196F3'],
 *       labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
 *   });
 *
 *   // Draw line chart
 *   canvas.lineChart('#trend', [
 *       { x: 1, y: 10 },
 *       { x: 2, y: 25 },
 *       { x: 3, y: 15 },
 *   ]);
 *
 *   // Draw pie chart
 *   canvas.pieChart('#pie', [30, 45, 25], {
 *       colors: ['#FF6B6B', '#4ECDC4', '#45B7D1'],
 *       labels: ['Cats', 'Dogs', 'Birds'],
 *   });
 *
 * ─── Animation ────────────────────────────────────────────────────────────────
 *
 *   // Animate with requestAnimationFrame
 *   const anim = canvas.animate('#spinner', (ctx, size, progress) => {
 *       const angle = progress * Math.PI * 2;
 *       drawSpinner(ctx, size, angle);
 *   });
 *
 *   anim.stop(); // Stop animation
 *
 * ─── Screenshot and download ──────────────────────────────────────────────────
 *
 *   // Download canvas as image
 *   canvas.download('#myCanvas', 'my-drawing.png');
 *
 *   // Get data URL
 *   const url = canvas.toDataURL('#myCanvas');
 */

/**
 * @typedef {Object} CanvasSize
 * @property {number} width
 * @property {number} height
 * @property {number} dpr - Device pixel ratio
 */

const _responsiveInstances = new WeakMap(); // canvas -> { observer, drawFn }
const _animationInstances  = new WeakMap(); // canvas -> { rafId, drawFn, startTime }

function _resolveCanvas(target) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el || !(el instanceof HTMLCanvasElement)) {
        console.warn('[oja/canvas] Invalid canvas target:', target);
        return null;
    }
    return el;
}

/**
 * Return the logical size (CSS pixels) of a canvas and its device pixel ratio.
 * This is used internally wherever we need to pass a size object to a draw
 * callback — callers should work in CSS pixels, not raw canvas pixels.
 */
function _sizeOf(el) {
    return {
        width:  el.clientWidth,
        height: el.clientHeight,
        dpr:    el.width / (el.clientWidth || 1),
    };
}

/**
 * Get a canvas 2D context, optionally setting physical dimensions.
 * Scales the context once for the device pixel ratio so all drawing
 * coordinates are in CSS pixels.
 *
 * Call once during setup, not on every frame — calling get() repeatedly
 * on the same canvas would accumulate DPR scale transforms.
 */
export function get(target, options = {}) {
    const el = _resolveCanvas(target);
    if (!el) return null;

    const { width, height, dpr = window.devicePixelRatio || 1 } = options;

    if (width)  { el.width  = width  * dpr; el.style.width  = width  + 'px'; }
    if (height) { el.height = height * dpr; el.style.height = height + 'px'; }

    const ctx = el.getContext('2d');

    // Scale once so draw code works in CSS pixels regardless of screen density.
    // This must only run when dimensions are being set, not on a bare get().
    if (dpr !== 1 && (width || height)) ctx.scale(dpr, dpr);

    return ctx;
}

/**
 * Clear a canvas.
 */
export function clear(target) {
    const el = _resolveCanvas(target);
    if (!el) return;
    el.getContext('2d').clearRect(0, 0, el.width, el.height);
}

/**
 * Resize a canvas to new CSS pixel dimensions, accounting for device pixel ratio.
 * Resets the transform cleanly so the DPR scale is correct after resize.
 */
export function resize(target, width, height) {
    const el = _resolveCanvas(target);
    if (!el) return;

    const dpr = window.devicePixelRatio || 1;
    const ctx = el.getContext('2d');

    el.width  = width  * dpr;
    el.height = height * dpr;
    el.style.width  = width  + 'px';
    el.style.height = height + 'px';

    // Reset the transform to identity then apply DPR scale. ctx.save/restore
    // is intentionally not used here — restore would undo the new scale,
    // leaving the canvas incorrectly sized for subsequent draw calls.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (dpr !== 1) ctx.scale(dpr, dpr);
}

/**
 * Return the logical and physical dimensions of a canvas.
 */
export function getSize(target) {
    const el = _resolveCanvas(target);
    if (!el) return null;
    return {
        width:       el.width,
        height:      el.height,
        styleWidth:  el.clientWidth,
        styleHeight: el.clientHeight,
        dpr:         el.width / (el.clientWidth || 1),
    };
}

/**
 * Draw with automatic context save/restore.
 * The draw callback receives (ctx, size) where size is in CSS pixels.
 */
export function draw(target, drawFn) {
    const el = _resolveCanvas(target);
    if (!el) return;

    const ctx = el.getContext('2d');
    ctx.save();
    drawFn(ctx, _sizeOf(el));
    ctx.restore();
}

/**
 * Make a canvas responsive — redraws automatically whenever its size changes.
 *
 * The observer watches the canvas element itself so that both container-driven
 * and direct resizes are detected. Observing only the parent misses cases where
 * the canvas is sized independently via CSS container queries or JS.
 */
export function responsive(target, drawFn) {
    const el = _resolveCanvas(target);
    if (!el) {
        console.warn('[oja/canvas] responsive() target not found');
        return { destroy: () => {}, redraw: () => {} };
    }

    if (typeof ResizeObserver === 'undefined') {
        console.warn('[oja/canvas] ResizeObserver not supported');
        return { destroy: () => {}, redraw: () => {} };
    }

    // Disconnect any existing instance on this canvas before creating a new one.
    if (_responsiveInstances.has(el)) {
        _responsiveInstances.get(el).observer.disconnect();
    }

    const redraw = () => draw(el, drawFn);

    const observer = new ResizeObserver(redraw);

    // Watch the canvas element directly so resizes triggered by CSS container
    // queries, explicit style changes, or JS width/height assignments are all
    // caught — not just resizes of the parent container.
    observer.observe(el);

    _responsiveInstances.set(el, { observer, drawFn });

    redraw();

    return {
        destroy: () => {
            observer.disconnect();
            _responsiveInstances.delete(el);
        },
        redraw,
    };
}

/**
 * Load an image into a canvas, resizing the canvas to match.
 */
export async function loadImage(target, src, options = {}) {
    const el = _resolveCanvas(target);
    if (!el) return;

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = options.crossOrigin || 'anonymous';

        img.onload = () => {
            const ctx = el.getContext('2d');
            el.width  = options.width  || img.width;
            el.height = options.height || img.height;
            el.style.width  = el.width  + 'px';
            el.style.height = el.height + 'px';
            ctx.drawImage(img, 0, 0, el.width, el.height);
            resolve(img);
        };

        img.onerror = reject;
        img.src = src;
    });
}

/**
 * Apply a CSS filter to a canvas by redrawing its current pixels through
 * an offscreen canvas with the filter applied.
 *
 * ctx.filter only affects draw operations such as drawImage — it has no
 * effect on putImageData, which bypasses the filter pipeline entirely.
 * To apply a filter to existing canvas content we must re-draw via drawImage.
 */
export function filter(target, filterStr) {
    const el = _resolveCanvas(target);
    if (!el) return;

    // Snapshot the current canvas content into an offscreen canvas.
    const offscreen = document.createElement('canvas');
    offscreen.width  = el.width;
    offscreen.height = el.height;
    offscreen.getContext('2d').drawImage(el, 0, 0);

    // Redraw back onto the original canvas through the filter.
    const ctx = el.getContext('2d');
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.filter = filterStr;
    ctx.drawImage(offscreen, 0, 0);
    ctx.filter = 'none';
}

/**
 * Get raw pixel data from a canvas region.
 */
export function getImageData(target, x = 0, y = 0, width, height) {
    const el = _resolveCanvas(target);
    if (!el) return null;
    const ctx = el.getContext('2d');
    return ctx.getImageData(x, y, width || el.width, height || el.height);
}

/**
 * Convert canvas contents to a data URL.
 */
export function toDataURL(target, type = 'image/png', quality = 1) {
    const el = _resolveCanvas(target);
    return el?.toDataURL(type, quality) ?? null;
}

/**
 * Convert canvas contents to a Blob.
 */
export function toBlob(target, type = 'image/png', quality = 1) {
    const el = _resolveCanvas(target);
    if (!el) return Promise.resolve(null);
    return new Promise(resolve => el.toBlob(resolve, type, quality));
}

/**
 * Download canvas contents as an image file.
 */
export function download(target, filename = 'canvas.png', type = 'image/png', quality = 1) {
    const el = _resolveCanvas(target);
    if (!el) return;
    const link = document.createElement('a');
    link.download = filename;
    link.href = el.toDataURL(type, quality);
    link.click();
}

/**
 * Draw a grid of evenly-spaced lines across the canvas.
 */
export function drawGrid(ctx, width, height, options = {}) {
    const { step = 50, color = '#ddd', lineWidth = 1, showAxes = false } = options;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = lineWidth;

    ctx.beginPath();
    for (let x = 0; x <= width; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
    }
    ctx.stroke();

    if (showAxes) drawAxes(ctx, width, height);

    ctx.restore();
}

/**
 * Draw x and y axes.
 */
export function drawAxes(ctx, width, height, options = {}) {
    const { color = '#000', lineWidth = 2 } = options;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = lineWidth;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(width, 0);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, height);
    ctx.stroke();

    ctx.restore();
}

/**
 * Draw a bar chart.
 */
export function barChart(target, data, options = {}) {
    return draw(target, (ctx, size) => {
        const {
            colors     = ['#4CAF50'],
            labels     = [],
            padding    = 40,
            barSpacing = 10,
        } = options;

        const width    = size.width  - padding * 2;
        const height   = size.height - padding * 2;
        const barWidth = (width - (data.length - 1) * barSpacing) / data.length;
        const maxValue = Math.max(...data);
        const scale    = height / maxValue;

        ctx.save();
        ctx.translate(padding, padding);

        data.forEach((value, i) => {
            const x       = i * (barWidth + barSpacing);
            const barH    = value * scale;
            const y       = height - barH;

            ctx.fillStyle = colors[i % colors.length];
            ctx.fillRect(x, y, barWidth, barH);

            ctx.fillStyle  = '#000';
            ctx.font       = '12px sans-serif';
            ctx.textAlign  = 'center';
            ctx.fillText(value, x + barWidth / 2, y - 5);

            if (labels[i]) ctx.fillText(labels[i], x + barWidth / 2, height + 20);
        });

        ctx.restore();
    });
}

/**
 * Draw a line chart from an array of { x, y } points.
 */
export function lineChart(target, points, options = {}) {
    return draw(target, (ctx, size) => {
        const {
            color      = '#2196F3',
            fillColor  = 'rgba(33, 150, 243, 0.1)',
            pointColor = '#fff',
            pointSize  = 4,
            padding    = 40,
        } = options;

        const width  = size.width  - padding * 2;
        const height = size.height - padding * 2;

        const xValues = points.map(p => p.x);
        const yValues = points.map(p => p.y);
        const minX    = Math.min(...xValues);
        const maxX    = Math.max(...xValues);
        const minY    = Math.min(...yValues);
        const maxY    = Math.max(...yValues);

        const scaleX = (x) => padding + ((x - minX) / (maxX - minX || 1)) * width;
        const scaleY = (y) => padding + height - ((y - minY) / (maxY - minY || 1)) * height;

        ctx.save();

        if (fillColor) {
            ctx.beginPath();
            ctx.moveTo(scaleX(points[0].x), scaleY(points[0].y));
            points.forEach(p => ctx.lineTo(scaleX(p.x), scaleY(p.y)));
            ctx.lineTo(scaleX(points[points.length - 1].x), height + padding);
            ctx.lineTo(scaleX(points[0].x), height + padding);
            ctx.closePath();
            ctx.fillStyle = fillColor;
            ctx.fill();
        }

        ctx.beginPath();
        ctx.moveTo(scaleX(points[0].x), scaleY(points[0].y));
        points.forEach(p => ctx.lineTo(scaleX(p.x), scaleY(p.y)));
        ctx.strokeStyle = color;
        ctx.lineWidth   = 2;
        ctx.stroke();

        points.forEach(p => {
            ctx.beginPath();
            ctx.arc(scaleX(p.x), scaleY(p.y), pointSize, 0, Math.PI * 2);
            ctx.fillStyle   = pointColor;
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth   = 2;
            ctx.stroke();
        });

        ctx.restore();
    });
}

/**
 * Draw a pie chart.
 */
export function pieChart(target, data, options = {}) {
    return draw(target, (ctx, size) => {
        const {
            colors  = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFE194'],
            labels  = [],
            radius  = Math.min(size.width, size.height) * 0.35,
            centerX = size.width  / 2,
            centerY = size.height / 2,
        } = options;

        const total = data.reduce((sum, val) => sum + val, 0);
        let startAngle = 0;

        ctx.save();

        data.forEach((value, i) => {
            const sliceAngle = (value / total) * (Math.PI * 2);

            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
            ctx.closePath();
            ctx.fillStyle = colors[i % colors.length];
            ctx.fill();

            if (labels[i]) {
                const midAngle = startAngle + sliceAngle / 2;
                const labelX   = centerX + Math.cos(midAngle) * radius * 1.5;
                const labelY   = centerY + Math.sin(midAngle) * radius * 1.5;

                ctx.fillStyle    = '#000';
                ctx.font         = '12px sans-serif';
                ctx.textAlign    = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`${labels[i]} (${value})`, labelX, labelY);
            }

            startAngle += sliceAngle;
        });

        ctx.restore();
    });
}

/**
 * Animate canvas drawing using requestAnimationFrame.
 * The draw callback receives (ctx, size, progress, elapsed).
 * When duration is Infinity, progress is always 0 — use elapsed instead.
 *
 * Returns { stop, restart }.
 */
export function animate(target, drawFn, duration = Infinity) {
    const el = _resolveCanvas(target);
    if (!el) return { stop: () => {}, restart: () => {} };

    if (_animationInstances.has(el)) {
        cancelAnimationFrame(_animationInstances.get(el).rafId);
    }

    const startTime = performance.now();
    let rafId;

    const tick = () => {
        const now      = performance.now();
        const elapsed  = now - startTime;
        const progress = duration === Infinity ? 0 : Math.min(elapsed / duration, 1);

        draw(el, (ctx, size) => drawFn(ctx, size, progress, elapsed));

        if (progress < 1 || duration === Infinity) {
            rafId = requestAnimationFrame(tick);
        } else {
            _animationInstances.delete(el);
        }
    };

    rafId = requestAnimationFrame(tick);
    _animationInstances.set(el, { rafId, drawFn, startTime });

    return {
        stop: () => {
            cancelAnimationFrame(rafId);
            _animationInstances.delete(el);
        },
        restart: () => {
            cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(tick);
            _animationInstances.set(el, { rafId, drawFn, startTime: performance.now() });
        },
    };
}

export const canvas = {
    get,
    clear,
    resize,
    getSize,
    draw,
    responsive,
    loadImage,
    filter,
    getImageData,
    toDataURL,
    toBlob,
    download,
    drawGrid,
    drawAxes,
    barChart,
    lineChart,
    pieChart,
    animate,
};
