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

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} CanvasSize
 * @property {number} width
 * @property {number} height
 * @property {number} dpr - Device pixel ratio
 */

// ─── Core utilities ───────────────────────────────────────────────────────────

const _responsiveInstances = new WeakMap(); // canvas -> { observer, drawFn }
const _animationInstances = new WeakMap(); // canvas -> { rafId, drawFn, startTime }

/**
 * Get canvas element and context with proper sizing
 */
export function get(target, options = {}) {
    const canvas = typeof target === 'string'
        ? document.querySelector(target)
        : target;

    if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
        console.warn(`[oja/canvas] Invalid canvas target: ${target}`);
        return null;
    }

    const { width, height, dpr = window.devicePixelRatio || 1 } = options;

    if (width) canvas.width = width * dpr;
    if (height) canvas.height = height * dpr;

    if (width) canvas.style.width = width + 'px';
    if (height) canvas.style.height = height + 'px';

    const ctx = canvas.getContext('2d');
    if (dpr !== 1) ctx.scale(dpr, dpr);

    return ctx;
}

/**
 * Clear canvas
 */
export function clear(target) {
    const canvas = typeof target === 'string'
        ? document.querySelector(target)
        : target;

    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * Resize canvas
 */
export function resize(target, width, height) {
    const canvas = typeof target === 'string'
        ? document.querySelector(target)
        : target;

    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');

    // Save context state
    ctx.save();

    // Resize
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    // Restore scale
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // Restore other state
    ctx.restore();
}

/**
 * Get canvas size info
 */
export function getSize(target) {
    const canvas = typeof target === 'string'
        ? document.querySelector(target)
        : target;

    if (!canvas) return null;

    return {
        width: canvas.width,
        height: canvas.height,
        styleWidth: canvas.clientWidth,
        styleHeight: canvas.clientHeight,
        dpr: canvas.width / canvas.clientWidth || 1,
    };
}

/**
 * Draw with automatic context save/restore
 */
export function draw(target, drawFn) {
    const canvas = typeof target === 'string'
        ? document.querySelector(target)
        : target;

    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.save();

    drawFn(ctx, {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        dpr: canvas.width / canvas.clientWidth || 1,
    });

    ctx.restore();
}

// ─── Responsive canvas ────────────────────────────────────────────────────────

/**
 * Make canvas responsive - redraws on resize
 */
export function responsive(target, drawFn) {
    const canvas = typeof target === 'string'
        ? document.querySelector(target)
        : target;

    if (!canvas || typeof ResizeObserver === 'undefined') {
        console.warn('[oja/canvas] ResizeObserver not supported');
        return { destroy: () => {} };
    }

    // Clean up existing instance
    if (_responsiveInstances.has(canvas)) {
        _responsiveInstances.get(canvas).observer.disconnect();
    }

    const resizeFn = () => {
        draw(canvas, drawFn);
    };

    const observer = new ResizeObserver(resizeFn);
    observer.observe(canvas.parentElement || canvas);

    _responsiveInstances.set(canvas, { observer, drawFn });

    // Initial draw
    resizeFn();

    return {
        destroy: () => {
            observer.disconnect();
            _responsiveInstances.delete(canvas);
        },
        redraw: resizeFn,
    };
}

// ─── Image loading ────────────────────────────────────────────────────────────

/**
 * Load image into canvas
 */
export async function loadImage(target, src, options = {}) {
    const canvas = typeof target === 'string'
        ? document.querySelector(target)
        : target;

    if (!canvas) return;

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = options.crossOrigin || 'anonymous';

        img.onload = () => {
            const ctx = canvas.getContext('2d');

            if (options.resize) {
                canvas.width = options.width || img.width;
                canvas.height = options.height || img.height;
            } else {
                canvas.width = img.width;
                canvas.height = img.height;
            }

            canvas.style.width = canvas.width + 'px';
            canvas.style.height = canvas.height + 'px';

            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(img);
        };

        img.onerror = reject;
        img.src = src;
    });
}

/**
 * Apply CSS filter to canvas
 */
export function filter(target, filterStr) {
    const canvas = typeof target === 'string'
        ? document.querySelector(target)
        : target;

    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.filter = filterStr;

    // Redraw image if exists
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    ctx.putImageData(imageData, 0, 0);
}

/**
 * Get image data
 */
export function getImageData(target, x = 0, y = 0, width, height) {
    const canvas = typeof target === 'string'
        ? document.querySelector(target)
        : target;

    if (!canvas) return null;

    const ctx = canvas.getContext('2d');
    return ctx.getImageData(
        x, y,
        width || canvas.width,
        height || canvas.height
    );
}

/**
 * Convert canvas to data URL
 */
export function toDataURL(target, type = 'image/png', quality = 1) {
    const canvas = typeof target === 'string'
        ? document.querySelector(target)
        : target;

    return canvas?.toDataURL(type, quality);
}

/**
 * Convert canvas to blob
 */
export function toBlob(target, type = 'image/png', quality = 1) {
    const canvas = typeof target === 'string'
        ? document.querySelector(target)
        : target;

    return new Promise((resolve) => {
        canvas?.toBlob(resolve, type, quality);
    });
}

/**
 * Download canvas as image
 */
export function download(target, filename = 'canvas.png', type = 'image/png', quality = 1) {
    const canvas = typeof target === 'string'
        ? document.querySelector(target)
        : target;

    if (!canvas) return;

    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL(type, quality);
    link.click();
}

// ─── Drawing helpers ──────────────────────────────────────────────────────────

/**
 * Draw grid
 */
export function drawGrid(ctx, width, height, options = {}) {
    const {
        step = 50,
        color = '#ddd',
        lineWidth = 1,
        showAxes = false,
    } = options;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;

    // Vertical lines
    ctx.beginPath();
    for (let x = 0; x <= width; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
    }

    // Horizontal lines
    for (let y = 0; y <= height; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
    }

    ctx.stroke();

    if (showAxes) {
        drawAxes(ctx, width, height);
    }

    ctx.restore();
}

/**
 * Draw axes
 */
export function drawAxes(ctx, width, height, options = {}) {
    const {
        color = '#000',
        lineWidth = 2,
    } = options;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;

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

// ─── Chart helpers ────────────────────────────────────────────────────────────

/**
 * Draw bar chart
 */
export function barChart(target, data, options = {}) {
    return draw(target, (ctx, size) => {
        const {
            colors = ['#4CAF50'],
            labels = [],
            padding = 40,
            barSpacing = 10,
        } = options;

        const width = size.width - padding * 2;
        const height = size.height - padding * 2;
        const barWidth = (width - (data.length - 1) * barSpacing) / data.length;

        const maxValue = Math.max(...data);
        const scale = height / maxValue;

        ctx.save();
        ctx.translate(padding, padding);

        // Draw bars
        data.forEach((value, i) => {
            const x = i * (barWidth + barSpacing);
            const barHeight = value * scale;
            const y = height - barHeight;

            ctx.fillStyle = colors[i % colors.length];
            ctx.fillRect(x, y, barWidth, barHeight);

            // Draw value on top
            ctx.fillStyle = '#000';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(value, x + barWidth / 2, y - 5);

            // Draw label
            if (labels[i]) {
                ctx.fillText(labels[i], x + barWidth / 2, height + 20);
            }
        });

        ctx.restore();
    });
}

/**
 * Draw line chart
 */
export function lineChart(target, points, options = {}) {
    return draw(target, (ctx, size) => {
        const {
            color = '#2196F3',
            fillColor = 'rgba(33, 150, 243, 0.1)',
            pointColor = '#fff',
            pointSize = 4,
            padding = 40,
            smooth = false,
        } = options;

        const width = size.width - padding * 2;
        const height = size.height - padding * 2;

        // Find min/max
        const xValues = points.map(p => p.x);
        const yValues = points.map(p => p.y);
        const minX = Math.min(...xValues);
        const maxX = Math.max(...xValues);
        const minY = Math.min(...yValues);
        const maxY = Math.max(...yValues);

        // Scale functions
        const scaleX = (x) => padding + ((x - minX) / (maxX - minX || 1)) * width;
        const scaleY = (y) => padding + height - ((y - minY) / (maxY - minY || 1)) * height;

        ctx.save();

        // Draw fill
        if (fillColor) {
            ctx.beginPath();
            ctx.moveTo(scaleX(points[0].x), scaleY(points[0].y));

            points.forEach(p => {
                ctx.lineTo(scaleX(p.x), scaleY(p.y));
            });

            ctx.lineTo(scaleX(points[points.length - 1].x), height + padding);
            ctx.lineTo(scaleX(points[0].x), height + padding);
            ctx.closePath();

            ctx.fillStyle = fillColor;
            ctx.fill();
        }

        // Draw line
        ctx.beginPath();
        ctx.moveTo(scaleX(points[0].x), scaleY(points[0].y));

        points.forEach(p => {
            ctx.lineTo(scaleX(p.x), scaleY(p.y));
        });

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Draw points
        points.forEach(p => {
            ctx.beginPath();
            ctx.arc(scaleX(p.x), scaleY(p.y), pointSize, 0, Math.PI * 2);
            ctx.fillStyle = pointColor;
            ctx.fill();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();
        });

        ctx.restore();
    });
}

/**
 * Draw pie chart
 */
export function pieChart(target, data, options = {}) {
    return draw(target, (ctx, size) => {
        const {
            colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFE194'],
            labels = [],
            radius = Math.min(size.width, size.height) * 0.35,
            centerX = size.width / 2,
            centerY = size.height / 2,
        } = options;

        const total = data.reduce((sum, val) => sum + val, 0);
        let startAngle = 0;

        ctx.save();

        data.forEach((value, i) => {
            const sliceAngle = (value / total) * (Math.PI * 2);

            // Draw slice
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
            ctx.closePath();

            ctx.fillStyle = colors[i % colors.length];
            ctx.fill();

            // Draw label
            if (labels[i]) {
                const midAngle = startAngle + sliceAngle / 2;
                const labelX = centerX + Math.cos(midAngle) * radius * 1.5;
                const labelY = centerY + Math.sin(midAngle) * radius * 1.5;

                ctx.fillStyle = '#000';
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`${labels[i]} (${value})`, labelX, labelY);
            }

            startAngle += sliceAngle;
        });

        ctx.restore();
    });
}

// ─── Animation ────────────────────────────────────────────────────────────────

/**
 * Animate canvas drawing
 */
export function animate(target, drawFn, duration = Infinity) {
    const canvas = typeof target === 'string'
        ? document.querySelector(target)
        : target;

    if (!canvas) return { stop: () => {} };

    // Stop existing animation
    if (_animationInstances.has(canvas)) {
        const existing = _animationInstances.get(canvas);
        cancelAnimationFrame(existing.rafId);
    }

    const startTime = performance.now();
    let rafId;

    const animateFrame = () => {
        const now = performance.now();
        const elapsed = now - startTime;
        const progress = duration === Infinity ? 0 : Math.min(elapsed / duration, 1);

        draw(canvas, (ctx, size) => {
            drawFn(ctx, size, progress, elapsed);
        });

        if (progress < 1 || duration === Infinity) {
            rafId = requestAnimationFrame(animateFrame);
        }
    };

    rafId = requestAnimationFrame(animateFrame);
    _animationInstances.set(canvas, { rafId, drawFn, startTime });

    return {
        stop: () => {
            cancelAnimationFrame(rafId);
            _animationInstances.delete(canvas);
        },
        restart: () => {
            cancelAnimationFrame(rafId);
            const newStart = performance.now();
            const anim = _animationInstances.get(canvas);
            if (anim) anim.startTime = newStart;
            rafId = requestAnimationFrame(animateFrame);
        },
    };
}

// ─── Export all ───────────────────────────────────────────────────────────────

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