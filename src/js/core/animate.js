/**
 * oja/animate.js
 * Animation utilities for DOM elements.
 * Provides simple, performant animations without external dependencies.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { animate } from '../oja/animate.js';
 *
 *   // Fade in an element
 *   animate.fadeIn('#modal');
 *
 *   // Fade out
 *   animate.fadeOut('#spinner');
 *
 *   // Slide in
 *   animate.slideIn('#sidebar', { direction: 'left', duration: 300 });
 *
 * ─── Complex animations ───────────────────────────────────────────────────────
 *
 *   // Animate with keyframes
 *   animate.to('#box', {
 *       x: 100,
 *       y: 200,
 *       rotate: '45deg',
 *       scale: 1.5,
 *       duration: 1000,
 *       easing: 'ease-out',
 *   });
 *
 *   // Sequence animations
 *   animate.sequence([
 *       () => animate.fadeIn('#element'),
 *       () => animate.slideIn('#element'),
 *       () => animate.to('#element', { scale: 1.2 }),
 *   ]);
 *
 * ─── Timeline animations ──────────────────────────────────────────────────────
 *
 *   const timeline = animate.timeline()
 *       .add('#box', { x: 100 }, 0)
 *       .add('#box', { y: 200 }, 300)
 *       .add('#box', { rotate: '360deg' }, 600)
 *       .play();
 *
 * ─── Spring physics ───────────────────────────────────────────────────────────
 *
 *   // Natural motion with spring
 *   animate.spring('#ball', {
 *       y: 300,
 *       stiffness: 170,
 *       damping: 26,
 *   });
 *
 * ─── Staggered animations ─────────────────────────────────────────────────────
 *
 *   // Animate list items with stagger
 *   animate.stagger('.list-item', (el, i) => ({
 *       opacity: [0, 1],
 *       y: [20, 0],
 *       delay: i * 100,
 *   }));
 *
 * ─── Scroll-triggered animations ──────────────────────────────────────────────
 *
 *   // Animate when element comes into view
 *   animate.whenInView('.fade-up', {
 *       opacity: [0, 1],
 *       y: [50, 0],
 *       duration: 600,
 *   });
 *
 * ─── Pause, resume, reverse ───────────────────────────────────────────────────
 *
 *   const anim = animate.to('#box', { x: 500, duration: 2000 });
 *
 *   // Control
 *   anim.pause();
 *   anim.resume();
 *   anim.reverse();
 *   anim.seek(500); // Go to 500ms
 *   anim.onComplete(() => console.log('Done!'));
 *
 * ─── CSS transitions ──────────────────────────────────────────────────────────
 *
 *   // Use CSS transitions (better performance)
 *   animate.transition('#card', {
 *       transform: 'scale(1.1)',
 *       boxShadow: '0 10px 20px rgba(0,0,0,0.2)',
 *   }, { duration: 200 });
 *
 * ─── SVG animations ───────────────────────────────────────────────────────────
 *
 *   // Animate SVG attributes
 *   animate.svg('#circle', {
 *       r: [10, 50],
 *       fill: ['blue', 'red'],
 *       strokeWidth: [1, 5],
 *   });
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} AnimationOptions
 * @property {number} duration - Duration in ms (default: 400)
 * @property {string} easing - CSS easing (default: 'ease')
 * @property {number} delay - Delay in ms (default: 0)
 * @property {boolean} fill - Keep final state (default: true)
 */

// ─── State ────────────────────────────────────────────────────────────────────

// Keyed by element so animate.stop(el) can cancel all active animations on it.
const _animations = new Map(); // element -> Set<Animation>

const _defaults = {
    duration: 400,
    easing: 'ease',
    delay: 0,
    fill: true,
};

// ─── Transform properties ─────────────────────────────────────────────────────
//
// These properties are animated via element.style.transform rather than
// individual CSS properties (which don't exist or have very limited support).
// All transform values are composed into a single transform string each frame
// so they don't overwrite each other.

const _TRANSFORM_PROPS = new Set(['x', 'y', 'z', 'rotate', 'rotateX', 'rotateY', 'rotateZ', 'scale', 'scaleX', 'scaleY', 'skewX', 'skewY']);

// Properties that are unitless (no 'px' suffix)
const _UNITLESS_PROPS = new Set(['opacity', 'scale', 'scaleX', 'scaleY', 'zoom', 'fontWeight', 'lineHeight', 'zIndex']);

// Easing functions
const EASINGS = {
    linear: t => t,
    ease: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    'ease-in': t => t * t,
    'ease-out': t => t * (2 - t),
    'ease-in-out': t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    'ease-in-back': t => {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return c3 * t * t * t - c1 * t * t;
    },
    'ease-out-back': t => {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    bounce: t => {
        if (t < 1 / 2.75) return 7.5625 * t * t;
        if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
        if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
        return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
    },
    elastic: t => {
        if (t === 0 || t === 1) return t;
        const p = 0.3;
        const s = p / 4;
        return Math.pow(2, -10 * t) * Math.sin((t - s) * (2 * Math.PI) / p) + 1;
    },
};

// ─── Transform helpers ────────────────────────────────────────────────────────

/**
 * Read current transform-related values from a computed style.
 * Parses the `transform` matrix back into individual axis values.
 * Returns 0 for any axis that isn't currently set.
 *
 * @param {CSSStyleDeclaration} style
 * @param {string} prop - one of: x, y, z, rotate, scale, ...
 * @returns {number}
 */
function _getTransformValue(style, prop) {
    const transform = style.transform;

    // No transform set yet — everything starts at identity
    if (!transform || transform === 'none') {
        // For scale, identity is 1, not 0
        if (prop === 'scale' || prop === 'scaleX' || prop === 'scaleY') return 1;
        return 0;
    }

    // For a matrix/matrix3d we decompose the relevant components.
    // For simple shorthand transforms we parse them directly.
    const matrixMatch = transform.match(/^matrix(?:3d)?\((.+)\)$/);
    if (matrixMatch) {
        const values = matrixMatch[1].split(',').map(Number);
        if (values.length === 6) {
            // 2D matrix(a, b, c, d, tx, ty)
            switch (prop) {
                case 'x':      return values[4];
                case 'y':      return values[5];
                case 'scale':
                case 'scaleX': return values[0];
                case 'scaleY': return values[3];
                case 'rotate': return Math.round(Math.atan2(values[1], values[0]) * (180 / Math.PI));
                default:       return 0;
            }
        }
        if (values.length === 16) {
            // 3D matrix — extract translation
            switch (prop) {
                case 'x': return values[12];
                case 'y': return values[13];
                case 'z': return values[14];
                default:  return 0;
            }
        }
    }

    return 0;
}

/**
 * Build a CSS transform string from a map of transform property values.
 * Called each animation frame to compose all active transform props at once
 * so they don't overwrite each other.
 *
 * @param {Object} transformValues  - { x: 0, y: 0, rotate: 0, scale: 1, ... }
 * @returns {string}
 */
function _buildTransformString(transformValues) {
    const parts = [];

    const x = transformValues.x ?? 0;
    const y = transformValues.y ?? 0;
    const z = transformValues.z ?? 0;

    if (x !== 0 || y !== 0 || z !== 0) {
        parts.push(z !== 0 ? `translate3d(${x}px, ${y}px, ${z}px)` : `translate(${x}px, ${y}px)`);
    }

    if (transformValues.rotate  != null) parts.push(`rotate(${transformValues.rotate}deg)`);
    if (transformValues.rotateX != null) parts.push(`rotateX(${transformValues.rotateX}deg)`);
    if (transformValues.rotateY != null) parts.push(`rotateY(${transformValues.rotateY}deg)`);
    if (transformValues.rotateZ != null) parts.push(`rotateZ(${transformValues.rotateZ}deg)`);

    const sx = transformValues.scaleX ?? transformValues.scale;
    const sy = transformValues.scaleY ?? transformValues.scale;
    if (sx != null || sy != null) {
        const svx = sx ?? 1;
        const svy = sy ?? 1;
        parts.push(svx === svy ? `scale(${svx})` : `scale(${svx}, ${svy})`);
    }

    if (transformValues.skewX != null) parts.push(`skewX(${transformValues.skewX}deg)`);
    if (transformValues.skewY != null) parts.push(`skewY(${transformValues.skewY}deg)`);

    return parts.join(' ') || 'none';
}

// ─── Core Animation Class ─────────────────────────────────────────────────────

class Animation {
    constructor(element, properties, options = {}) {
        this.element = typeof element === 'string'
            ? document.querySelector(element)
            : element;

        this.properties = properties;
        this.options = { ..._defaults, ...options };
        this.startTime = null;
        this.paused = false;
        this.pausedTime = 0;
        this.raf = null;
        this.completed = false;

        this._reversed = false;

        this.onCompleteCallbacks = [];
        this.onUpdateCallbacks = [];

        // Parse initial values
        this.startValues = this._getCurrentValues();
        this.endValues = this._parseEndValues();
    }

    play() {
        if (this.completed) return this;
        const delay = this.options.delay || 0;
        this.paused = false;
        if (delay > 0 && this.pausedTime === 0) {
            // First play with a delay — schedule the actual start
            setTimeout(() => {
                if (!this.paused && !this.completed) {
                    this.startTime = performance.now();
                    this._tick();
                }
            }, delay);
        } else {
            this.startTime = performance.now() - this.pausedTime;
            this._tick();
        }
        return this;
    }

    pause() {
        if (!this.paused) {
            this.paused = true;
            this.pausedTime = performance.now() - this.startTime;
            cancelAnimationFrame(this.raf);
        }
        return this;
    }

    resume() {
        if (this.paused) {
            this.play();
        }
        return this;
    }

    stop() {
        cancelAnimationFrame(this.raf);
        this.completed = true;
        // Remove from global map
        if (this.element) {
            const set = _animations.get(this.element);
            if (set) set.delete(this);
        }
        return this;
    }

    /**
     * Reverse the animation direction.
     * Swaps start and end values and continues from current position.
     */
    reverse() {
        this._reversed = !this._reversed;
        [this.startValues, this.endValues] = [this.endValues, this.startValues];

        if (!this.paused) {
            this.startTime = performance.now() - this.pausedTime;
        }

        return this;
    }

    seek(time) {
        this.pausedTime = time;
        if (!this.paused) {
            this.startTime = performance.now() - time;
        }
        this._update(time / this.options.duration);
        return this;
    }

    onComplete(fn) {
        this.onCompleteCallbacks.push(fn);
        return this;
    }

    onUpdate(fn) {
        this.onUpdateCallbacks.push(fn);
        return this;
    }

    _tick() {
        if (this.paused || this.completed) return;

        this.raf = requestAnimationFrame(() => {
            const now = performance.now();
            const elapsed = now - this.startTime;
            const progress = Math.min(elapsed / this.options.duration, 1);

            this._update(this._reversed ? 1 - progress : progress);

            if (progress < 1) {
                this._tick();
            } else {
                this.completed = true;
                // Remove from global map on natural completion
                if (this.element) {
                    const set = _animations.get(this.element);
                    if (set) set.delete(this);
                }
                this.onCompleteCallbacks.forEach(fn => fn());
            }
        });
    }

    _update(progress) {
        if (!this.element) return;

        const easing = EASINGS[this.options.easing] || EASINGS.ease;
        const t = easing(Math.max(0, Math.min(1, progress)));

        // Collect all transform property values for this frame so we can
        // compose them into a single transform string at the end.
        // This prevents each prop from overwriting the previous one.
        const transformFrame = {};
        let hasTransform = false;

        for (const [prop, end] of Object.entries(this.endValues)) {
            const start = this.startValues[prop] ?? (
                (prop === 'scale' || prop === 'scaleX' || prop === 'scaleY') ? 1 : 0
            );

            // ── CSS custom properties ──────────────────────────────────────
            if (prop.startsWith('--')) {
                if (typeof end === 'number') {
                    const value = start + (end - start) * t;
                    this.element.style.setProperty(prop, value);
                }
                continue;
            }

            // ── Opacity ────────────────────────────────────────────────────
            if (prop === 'opacity') {
                this.element.style.opacity = start + (end - start) * t;
                continue;
            }

            if (_TRANSFORM_PROPS.has(prop)) {
                if (typeof start === 'number' && typeof end === 'number') {
                    transformFrame[prop] = start + (end - start) * t;
                } else {
                    // String end value (e.g. rotate was passed as '45deg')
                    // Parse the numeric part and interpolate
                    const endNum = parseFloat(end);
                    const startNum = typeof start === 'number' ? start : parseFloat(start) || 0;
                    transformFrame[prop] = startNum + (endNum - startNum) * t;
                }
                hasTransform = true;
                continue;
            }

            // ── Numeric CSS properties ─────────────────────────────────────
            if (typeof start === 'number' && typeof end === 'number') {
                const value = start + (end - start) * t;
                const unit = _UNITLESS_PROPS.has(prop) ? '' : 'px';
                this.element.style[prop] = value + unit;
                continue;
            }

            // ── Non-interpolatable — snap to end value ─────────────────────
            this.element.style[prop] = end;
        }

        // Compose and apply all transform properties in one write
        if (hasTransform) {
            this.element.style.transform = _buildTransformString(transformFrame);
        }

        this.onUpdateCallbacks.forEach(fn => fn(progress));
    }

    _getCurrentValues() {
        if (!this.element) return {};

        const values = {};
        const style = getComputedStyle(this.element);

        for (const prop of Object.keys(this.properties)) {
            if (_TRANSFORM_PROPS.has(prop)) {
                values[prop] = _getTransformValue(style, prop);
            } else if (prop.startsWith('--')) {
                values[prop] = parseFloat(style.getPropertyValue(prop)) || 0;
            } else if (prop === 'opacity') {
                values[prop] = parseFloat(style[prop] ?? '1') || 1;
            } else if (typeof this.properties[prop] === 'number') {
                values[prop] = parseFloat(style[prop]) || 0;
            } else {
                values[prop] = style[prop];
            }
        }

        return values;
    }

    _parseEndValues() {
        const values = {};

        for (const [prop, val] of Object.entries(this.properties)) {
            // Skip non-animatable options that live in the properties object
            if (prop === 'duration' || prop === 'easing' || prop === 'delay' || prop === 'fill') continue;

            if (Array.isArray(val)) {
                // [from, to] syntax — override the computed start value
                values[prop] = val[1];
                this.startValues[prop] = typeof val[0] === 'string' ? parseFloat(val[0]) || 0 : val[0];
            } else if (typeof val === 'string' && _TRANSFORM_PROPS.has(prop)) {
                // e.g. rotate: '45deg' — strip the unit, store as number
                values[prop] = parseFloat(val) || 0;
            } else {
                values[prop] = val;
            }
        }

        return values;
    }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Register an animation in the global map and start it.
 *
 * @param {Element} element
 * @param {Object}  properties
 * @param {Object}  options
 * @returns {Animation}
 */
function _createAndPlay(element, properties, options) {
    const el = typeof element === 'string' ? document.querySelector(element) : element;
    const anim = new Animation(el, properties, options);

    // Register in global map so animate.stop(el) can find and cancel it
    if (el) {
        if (!_animations.has(el)) _animations.set(el, new Set());
        _animations.get(el).add(anim);
    }

    anim.play();
    return anim;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const animate = {
    /**
     * Animate element to target values.
     * Supports: opacity, x, y, z, rotate, scale, scaleX, scaleY,
     *           skewX, skewY, rotateX, rotateY, rotateZ,
     *           any numeric CSS property, CSS custom properties (--var).
     *
     *   animate.to('#box', { x: 100, opacity: 0.5, duration: 600 });
     *   animate.to('#box', { x: [0, 100], rotate: [0, 45] }); // [from, to]
     */
    to(element, properties, options = {}) {
        return _createAndPlay(element, properties, options);
    },

    /**
     * Fade in element
     */
    fadeIn(element, options = {}) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return null;

        el.style.opacity = '0';
        el.style.display = '';

        return _createAndPlay(el, { opacity: 1 }, { duration: 400, ...options });
    },

    /**
     * Fade out element
     */
    fadeOut(element, options = {}) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return null;

        const anim = _createAndPlay(el, { opacity: 0 }, { duration: 400, ...options });
        anim.onComplete(() => {
            el.style.display = 'none';
        });
        return anim;
    },

    /**
     * Slide in element from a direction
     */
    slideIn(element, options = {}) {
        const { direction = 'left', distance = 100, ...rest } = options;
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return null;

        const props = {};

        switch (direction) {
            case 'left':  props.x = [distance, 0];   break;
            case 'right': props.x = [-distance, 0];  break;
            case 'up':    props.y = [distance, 0];   break;
            case 'down':  props.y = [-distance, 0];  break;
        }

        el.style.display = '';
        return _createAndPlay(el, props, { duration: 400, ...rest });
    },

    /**
     * Slide out element to a direction
     */
    slideOut(element, options = {}) {
        const { direction = 'left', distance = 100, ...rest } = options;
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return null;

        const props = {};

        switch (direction) {
            case 'left':  props.x = [0, -distance]; break;
            case 'right': props.x = [0, distance];  break;
            case 'up':    props.y = [0, -distance]; break;
            case 'down':  props.y = [0, distance];  break;
        }

        const anim = _createAndPlay(el, props, { duration: 400, ...rest });
        anim.onComplete(() => {
            el.style.display = 'none';
        });
        return anim;
    },

    /**
     * Scale element to a target value
     */
    scale(element, to, options = {}) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return null;
        return _createAndPlay(el, { scale: to }, { duration: 300, ...options });
    },

    /**
     * Rotate element to a target angle in degrees
     */
    rotate(element, to, options = {}) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return null;
        // Accept both numeric degrees and '45deg' strings
        const degrees = typeof to === 'string' ? parseFloat(to) : to;
        return _createAndPlay(el, { rotate: degrees }, { duration: 300, ...options });
    },

    /**
     * Run animations in sequence — each starts when the previous completes
     */
    sequence(animations) {
        let promise = Promise.resolve();

        animations.forEach(anim => {
            promise = promise.then(() => new Promise(resolve => {
                const result = typeof anim === 'function' ? anim() : anim;
                if (result && result.onComplete) {
                    result.onComplete(resolve);
                } else {
                    resolve();
                }
            }));
        });

        return promise;
    },

    /**
     * Run animations in parallel
     */
    parallel(animations) {
        return Promise.all(animations.map(anim => {
            const result = typeof anim === 'function' ? anim() : anim;
            return new Promise(resolve => {
                if (result && result.onComplete) {
                    result.onComplete(resolve);
                } else {
                    resolve();
                }
            });
        }));
    },

    /**
     * Stagger animations across a set of elements.
     * The factory receives (element, index) and returns a properties object.
     *
     *   animate.stagger('.list-item', (el, i) => ({
     *       opacity: [0, 1],
     *       y: [20, 0],
     *   }), { stagger: 80 });
     */
    stagger(elements, factory, options = {}) {
        const { stagger = 50, ...rest } = options;
        const items = typeof elements === 'string'
            ? Array.from(document.querySelectorAll(elements))
            : elements;

        return items.map((el, i) => {
            const props = factory(el, i);
            return _createAndPlay(el, props, {
                ...rest,
                delay: (rest.delay || 0) + i * stagger,
            });
        });
    },

    /**
     * Spring animation (physics-based feel via easing).
     * For true spring physics, stiffness and damping control the easing curve.
     */
    spring(element, properties, options = {}) {
        const { stiffness = 170, damping = 26, mass = 1, ...rest } = options;
        // Simplified spring — uses ease-out as a reasonable approximation.
        // A full physics solver would integrate the spring equation per-frame.
        return _createAndPlay(element, properties, {
            easing: 'ease-out',
            duration: 1000,
            ...rest,
        });
    },

    /**
     * Timeline for complex time-based sequences.
     * Each .add() schedules an animation at an absolute time offset.
     *
     *   animate.timeline()
     *       .add('#box', { x: 100 }, 0)
     *       .add('#box', { opacity: 0 }, 500)
     *       .play();
     */
    timeline() {
        const animations = [];

        const timeline = {
            add(element, properties, time, options = {}) {
                animations.push({ element, properties, time, options });
                return timeline;
            },
            play() {
                animations.forEach(({ element, properties, time, options }) => {
                    setTimeout(() => {
                        animate.to(element, properties, options);
                    }, time);
                });
                return timeline;
            },
        };

        return timeline;
    },

    /**
     * CSS transition wrapper — delegates to the browser's transition engine.
     * Better for GPU-composited properties (transform, opacity).
     */
    transition(element, properties, options = {}) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return null;

        const { duration = 200, easing = 'ease', delay = 0 } = options;

        const original = el.style.transition;

        el.style.transition = `all ${duration}ms ${easing} ${delay}ms`;

        for (const [prop, value] of Object.entries(properties)) {
            el.style[prop] = value;
        }

        setTimeout(() => {
            el.style.transition = original;
        }, duration + delay);

        return {
            onComplete: (fn) => setTimeout(fn, duration + delay),
        };
    },

    /**
     * Animate SVG element attributes.
     * Accepts numeric attributes (r, cx, cy, width, height, strokeWidth, etc.)
     * and interpolates them each frame.
     *
     *   animate.svg('#circle', { r: [10, 50], cx: [100, 200] });
     */
    svg(element, attributes, options = {}) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el || !(el instanceof SVGElement)) {
            console.warn('[oja/animate] svg() target is not an SVGElement:', element);
            return null;
        }

        // Read start values from current attributes
        const startValues = {};
        const endValues   = {};

        for (const [attr, val] of Object.entries(attributes)) {
            if (Array.isArray(val)) {
                startValues[attr] = parseFloat(val[0]) || 0;
                endValues[attr]   = parseFloat(val[1]) || 0;
            } else {
                startValues[attr] = parseFloat(el.getAttribute(attr)) || 0;
                endValues[attr]   = parseFloat(val) || 0;
            }
        }

        // Use a custom animation that writes to SVG attributes instead of style
        const opts = { ..._defaults, ...options };
        let startTime = null;
        let raf;
        let completed = false;
        const completeCallbacks = [];

        const tick = () => {
            raf = requestAnimationFrame(() => {
                if (!startTime) startTime = performance.now();
                const elapsed  = performance.now() - startTime;
                const progress = Math.min(elapsed / opts.duration, 1);
                const easingFn = EASINGS[opts.easing] || EASINGS.ease;
                const t        = easingFn(progress);

                for (const [attr, end] of Object.entries(endValues)) {
                    const start = startValues[attr] ?? 0;
                    el.setAttribute(attr, start + (end - start) * t);
                }

                if (progress < 1) {
                    tick();
                } else {
                    completed = true;
                    completeCallbacks.forEach(fn => fn());
                }
            });
        };

        const delay = opts.delay || 0;
        if (delay > 0) {
            setTimeout(tick, delay);
        } else {
            tick();
        }

        return {
            stop()       { cancelAnimationFrame(raf); completed = true; },
            onComplete(fn) { completeCallbacks.push(fn); return this; },
            get completed() { return completed; },
        };
    },

    /**
     * Animate when element comes into view (IntersectionObserver-based).
     *
     *   animate.whenInView('.fade-up', { opacity: [0, 1], y: [50, 0], duration: 600 });
     */
    whenInView(element, properties, options = {}) {
        const { threshold = 0.1, once = true, ...rest } = options;
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return null;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    animate.to(el, properties, rest);
                    if (once) observer.disconnect();
                }
            });
        }, { threshold });

        observer.observe(el);

        return {
            stop: () => observer.disconnect(),
        };
    },

    /**
     * Easing functions — can be passed as strings to options.easing,
     * or called directly for custom interpolation.
     */
    easing: EASINGS,


    // ─── collapse / expand ──────────────────────────────────────────────

    /**
     * F-38: Animate an element's height to 0 (collapse).
     * CSS cannot transition height:auto — this measures first then animates.
     * Sets display:none after completing so the element is fully hidden.
     *
     *   await animate.collapse('#panel');
     *   await animate.collapse('#panel', { duration: 200, easing: 'ease' });
     */
    async collapse(element, options = {}) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el || el.style.display === 'none') return;

        const { duration = 250, easing = 'ease' } = options;
        const currentHeight = el.scrollHeight;

        el.style.overflow = 'hidden';
        el.style.height   = currentHeight + 'px';

        await new Promise(resolve => {
            requestAnimationFrame(() => {
                el.style.transition = `height ${duration}ms ${easing}`;
                el.style.height     = '0px';

                const done = () => {
                    el.style.display    = 'none';
                    el.style.height     = '';
                    el.style.overflow   = '';
                    el.style.transition = '';
                    resolve();
                };

                el.addEventListener('transitionend', done, { once: true });
                setTimeout(done, duration + 50); // fallback
            });
        });
    },

    /**
     * Animate an element's height from 0 to its natural height (expand).
     * Counterpart to animate.collapse().
     *
     *   await animate.expand('#panel');
     */
    async expand(element, options = {}) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return;

        const { duration = 250, easing = 'ease' } = options;

        el.style.display  = '';
        el.style.overflow = 'hidden';
        el.style.height   = '0px';

        const targetHeight = el.scrollHeight;

        await new Promise(resolve => {
            requestAnimationFrame(() => {
                el.style.transition = `height ${duration}ms ${easing}`;
                el.style.height     = targetHeight + 'px';

                const done = () => {
                    el.style.height     = '';
                    el.style.overflow   = '';
                    el.style.transition = '';
                    resolve();
                };

                el.addEventListener('transitionend', done, { once: true });
                setTimeout(done, duration + 50); // fallback
            });
        });
    },

    // ─── F-39: countUp ────────────────────────────────────────────────────────

    /**
     * Animate a number from `from` to `to` inside an element.
     *
     *   animate.countUp('#stat', 0, 1247, { duration: 1200, decimals: 0 });
     *   animate.countUp('#stat', 0, 9.99, { decimals: 2, prefix: '$' });
     */
    countUp(element, from, to, options = {}) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return null;

        const {
            duration = 1000,
            decimals = 0,
            prefix   = '',
            suffix   = '',
            easing   = 'ease-out',
        } = options;

        const easeFn = typeof easing === 'function'
            ? easing
            : (EASINGS[easing] || EASINGS['ease-out']);

        const startTime = performance.now();
        let rafId;

        // Set initial value synchronously so callers see it immediately
        el.textContent = prefix + from.toFixed(decimals) + suffix;

        const tick = (now) => {
            const elapsed  = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const value    = from + (to - from) * easeFn(progress);

            el.textContent = prefix + value.toFixed(decimals) + suffix;

            if (progress < 1) { rafId = requestAnimationFrame(tick); }
        };

        rafId = requestAnimationFrame(tick);

        return { stop: () => cancelAnimationFrame(rafId) };
    },

    // ─── typewriter ─────────────────────────────────────────────────────

    /**
     * Type text into an element character by character.
     *
     *   animate.typewriter('#headline', 'Welcome to Oja.', { speed: 40 });
     *   Returns { stop, promise } — stop() halts mid-type, promise resolves on finish.
     */
    typewriter(element, text, options = {}) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return { stop: () => {}, promise: Promise.resolve() };

        const { speed = 50, cursor = true, cursorChar = '|' } = options;

        let i = 0;
        let stopped = false;
        let timerId;

        const promise = new Promise(resolve => {
            if (cursor) el.textContent = cursorChar;

            const tick = () => {
                if (stopped) { resolve(); return; }
                el.textContent = text.slice(0, i) + (cursor && i < text.length ? cursorChar : '');
                i++;
                if (i > text.length) {
                    if (cursor) setTimeout(() => { el.textContent = text; }, speed * 3);
                    resolve();
                } else {
                    timerId = setTimeout(tick, speed);
                }
            };

            timerId = setTimeout(tick, speed);
        });

        return {
            stop: () => { stopped = true; clearTimeout(timerId); el.textContent = text; },
            promise,
        };
    },

    // ─── F-41: shake ──────────────────────────────────────────────────────────

    /**
     * Quick horizontal shake for error feedback.
     *
     *   animate.shake('#save-btn');
     *   animate.shake('#field', { intensity: 8, duration: 400 });
     */
    shake(element, options = {}) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return Promise.resolve();

        const { intensity = 6, duration = 300, count = 3 } = options;

        return new Promise(resolve => {
            const keyframes = [
                { transform: 'translateX(0)' },
                ...Array.from({ length: count * 2 }, (_, i) => ({
                    transform: `translateX(${i % 2 === 0 ? intensity : -intensity}px)`
                })),
                { transform: 'translateX(0)' },
            ];

            if (el.animate) {
                const anim = el.animate(keyframes, { duration, easing: 'ease-in-out' });
                anim.onfinish = resolve;
                anim.oncancel = resolve;
            } else {
                // Fallback: CSS class-based shake
                el.style.animation = `oja-shake ${duration}ms ease-in-out`;
                setTimeout(() => { el.style.animation = ''; resolve(); }, duration);
            }
        });
    },

    /**
     * Stop all active animations on an element.
     *
     *   animate.stop('#box');
     */
    stop(element) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return;

        const set = _animations.get(el);
        if (!set) return;

        for (const anim of set) {
            cancelAnimationFrame(anim.raf);
            anim.completed = true;
        }
        _animations.delete(el);
    },
};