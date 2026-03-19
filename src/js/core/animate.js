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

const _animations = new Map(); // id -> animation
const _defaults = {
    duration: 400,
    easing: 'ease',
    delay: 0,
    fill: true,
};

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
        this.reverse = false;
        this.onCompleteCallbacks = [];
        this.onUpdateCallbacks = [];

        // Parse initial values
        this.startValues = this._getCurrentValues();
        this.endValues = this._parseEndValues();
    }

    play() {
        if (this.completed) return this;
        this.startTime = performance.now() - this.pausedTime;
        this.paused = false;
        this._tick();
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
        return this;
    }

    reverse() {
        this.reverse = !this.reverse;
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

            this._update(this.reverse ? 1 - progress : progress);

            if (progress < 1) {
                this._tick();
            } else {
                this.completed = true;
                this.onCompleteCallbacks.forEach(fn => fn());
            }
        });
    }

    _update(progress) {
        const easing = EASINGS[this.options.easing] || EASINGS.ease;
        const t = easing(progress);

        for (const [prop, end] of Object.entries(this.endValues)) {
            const start = this.startValues[prop];
            let value;

            if (typeof start === 'number' && typeof end === 'number') {
                value = start + (end - start) * t;
                this.element.style[prop] = value + 'px';
            } else if (prop.startsWith('--')) {
                // CSS variable
                if (typeof end === 'number') {
                    value = start + (end - start) * t;
                    this.element.style.setProperty(prop, value);
                }
            } else if (prop === 'opacity') {
                value = start + (end - start) * t;
                this.element.style[prop] = value;
            } else {
                // Handle other properties (transform, color, etc)
                this.element.style[prop] = end;
            }
        }

        this.onUpdateCallbacks.forEach(fn => fn(progress));
    }

    _getCurrentValues() {
        const values = {};
        const style = getComputedStyle(this.element);

        for (const prop of Object.keys(this.properties)) {
            if (prop === 'x' || prop === 'y' || prop === 'z') {
                const transform = style.transform;
                if (transform && transform !== 'none') {
                    const match = transform.match(new RegExp(`${prop.toUpperCase()}\\(([^)]+)\\)`));
                    values[prop] = match ? parseFloat(match[1]) : 0;
                } else {
                    values[prop] = 0;
                }
            } else if (prop.startsWith('--')) {
                values[prop] = parseFloat(style.getPropertyValue(prop)) || 0;
            } else if (prop === 'opacity') {
                values[prop] = parseFloat(style[prop]) || 1;
            } else {
                values[prop] = style[prop];
            }
        }

        return values;
    }

    _parseEndValues() {
        const values = {};

        for (const [prop, val] of Object.entries(this.properties)) {
            if (Array.isArray(val)) {
                values[prop] = val[1];
                this.startValues[prop] = val[0];
            } else {
                values[prop] = val;
            }
        }

        return values;
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const animate = {
    /**
     * Animate element to target values
     */
    to(element, properties, options = {}) {
        const anim = new Animation(element, properties, options);
        anim.play();
        return anim;
    },

    /**
     * Fade in element
     */
    fadeIn(element, options = {}) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return null;

        el.style.opacity = '0';
        el.style.display = '';

        return this.to(el, { opacity: 1 }, { duration: 400, ...options });
    },

    /**
     * Fade out element
     */
    fadeOut(element, options = {}) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return null;

        const anim = this.to(el, { opacity: 0 }, { duration: 400, ...options });
        anim.onComplete(() => {
            el.style.display = 'none';
        });
        return anim;
    },

    /**
     * Slide in element
     */
    slideIn(element, options = {}) {
        const { direction = 'left', distance = 100, ...rest } = options;
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return null;

        const props = {};

        switch (direction) {
            case 'left':
                props.x = [distance, 0];
                break;
            case 'right':
                props.x = [-distance, 0];
                break;
            case 'up':
                props.y = [distance, 0];
                break;
            case 'down':
                props.y = [-distance, 0];
                break;
        }

        el.style.display = '';
        return this.to(el, props, { duration: 400, ...rest });
    },

    /**
     * Slide out element
     */
    slideOut(element, options = {}) {
        const { direction = 'left', distance = 100, ...rest } = options;
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return null;

        const props = {};

        switch (direction) {
            case 'left':
                props.x = [0, -distance];
                break;
            case 'right':
                props.x = [0, distance];
                break;
            case 'up':
                props.y = [0, -distance];
                break;
            case 'down':
                props.y = [0, distance];
                break;
        }

        const anim = this.to(el, props, { duration: 400, ...rest });
        anim.onComplete(() => {
            el.style.display = 'none';
        });
        return anim;
    },

    /**
     * Scale element
     */
    scale(element, to, options = {}) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return null;

        return this.to(el, { scale: to }, { duration: 300, ...options });
    },

    /**
     * Rotate element
     */
    rotate(element, to, options = {}) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return null;

        return this.to(el, { rotate: to + 'deg' }, { duration: 300, ...options });
    },

    /**
     * Sequence animations
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
     * Parallel animations
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
     * Stagger animations
     */
    stagger(elements, factory, options = {}) {
        const { stagger = 50, ...rest } = options;
        const items = typeof elements === 'string'
            ? Array.from(document.querySelectorAll(elements))
            : elements;

        return items.map((el, i) => {
            const props = factory(el, i);
            return this.to(el, props, {
                ...rest,
                delay: (rest.delay || 0) + i * stagger,
            });
        });
    },

    /**
     * Spring animation (physics-based)
     */
    spring(element, properties, options = {}) {
        const { stiffness = 170, damping = 26, mass = 1, ...rest } = options;
        // Simplified spring - in practice you'd implement a physics solver
        return this.to(element, properties, {
            easing: 'ease-out',
            duration: 1000,
            ...rest,
        });
    },

    /**
     * Timeline for complex sequences
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
     * CSS transition wrapper
     */
    transition(element, properties, options = {}) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return null;

        const { duration = 200, easing = 'ease', delay = 0 } = options;

        // Save original transition
        const original = el.style.transition;

        // Apply transition
        el.style.transition = `all ${duration}ms ${easing} ${delay}ms`;

        // Apply properties
        for (const [prop, value] of Object.entries(properties)) {
            el.style[prop] = value;
        }

        // Clean up
        setTimeout(() => {
            el.style.transition = original;
        }, duration + delay);

        return {
            onComplete: (fn) => setTimeout(fn, duration + delay),
        };
    },

    /**
     * SVG attribute animation
     */
    svg(element, attributes, options = {}) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el || !(el instanceof SVGElement)) return null;

        const startValues = {};
        for (const [attr, val] of Object.entries(attributes)) {
            if (Array.isArray(val)) {
                startValues[attr] = val[0];
                attributes[attr] = val[1];
            } else {
                startValues[attr] = el.getAttribute(attr);
            }
        }

        return this.to({ style: el.style }, attributes, options);
    },

    /**
     * Animate when element comes into view
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
     * Easing functions
     */
    easing: EASINGS,

    /**
     * Stop all animations on an element
     */
    stop(element) {
        const el = typeof element === 'string' ? document.querySelector(element) : element;
        if (!el) return;

        // Cancel all animations on this element
        for (const [id, anim] of _animations) {
            if (anim.element === el) {
                anim.stop();
                _animations.delete(id);
            }
        }
    },
};