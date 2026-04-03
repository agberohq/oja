/**
 * oja/cssvars.js
 * CSS Variables (Custom Properties) manager.
 * Dynamically get, set, and observe CSS variable changes.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { cssVars } from '../oja/cssvars.js';
 *
 *   // Set a variable
 *   cssVars.set('--primary-color', '#0066cc');
 *
 *   // Set multiple
 *   cssVars.set({
 *       '--primary-color': '#0066cc',
 *       '--spacing': '1rem',
 *       '--radius': '4px',
 *   });
 *
 *   // Get a variable
 *   const color = cssVars.get('--primary-color');
 *
 *   // Get with fallback
 *   const size = cssVars.get('--size', '16px');
 *
 * ─── Scoped to element ────────────────────────────────────────────────────────
 *
 *   // Set on specific element
 *   cssVars.set('--bg-color', '#f0f0f0', '#sidebar');
 *
 *   // Get from specific element
 *   const color = cssVars.get('--text-color', '#sidebar');
 *
 *   // Set multiple on element
 *   cssVars.set({
 *       '--padding': '1rem',
 *       '--margin': '0.5rem',
 *   }, '#card');
 *
 * ─── Theme switching ──────────────────────────────────────────────────────────
 *
 *   // Define themes
 *   const themes = {
 *       light: {
 *           '--bg-primary': '#ffffff',
 *           '--text-primary': '#333333',
 *           '--accent': '#0066cc',
 *       },
 *       dark: {
 *           '--bg-primary': '#1a1a1a',
 *           '--text-primary': '#ffffff',
 *           '--accent': '#66aaff',
 *       },
 *   };
 *
 *   // Apply theme
 *   cssVars.applyTheme(themes.dark);
 *
 *   // Toggle theme
 *   on('#theme-toggle', 'click', () => {
 *       const current = cssVars.get('--bg-primary');
 *       const next = current === '#ffffff' ? themes.dark : themes.light;
 *       cssVars.applyTheme(next);
 *   });
 *
 * ─── Observing changes ────────────────────────────────────────────────────────
 *
 *   // Watch a single variable
 *   const unsub = cssVars.observe('--primary-color', (newValue, oldValue) => {
 *       updateUI(newValue);
 *   });
 *
 *   // Watch multiple
 *   cssVars.observe(['--width', '--height'], (values) => {
 *       resizeChart(values['--width'], values['--height']);
 *   });
 *
 *   // Watch all changes
 *   cssVars.observe((changes) => {
 *       console.log('Variables changed:', changes);
 *   });
 *
 * ─── CSS computation ──────────────────────────────────────────────────────────
 *
 *   // Compute value
 *   const value = cssVars.compute('calc(var(--spacing) * 2)');
 *
 *   // Resolve all variables in a string
 *   const css = cssVars.resolve('background: var(--bg); color: var(--text);');
 *
 * ─── Persistence ──────────────────────────────────────────────────────────────
 *
 *   // Save current variables to localStorage
 *   cssVars.save('theme-preferences');
 *
 *   // Load from localStorage
 *   cssVars.load('theme-preferences');
 *
 *   // Reset to defaults
 *   cssVars.reset();
 */

const _observers = new Map(); // varName -> Set of observers
const _globalObservers = new Set(); // observers that watch all changes
const _defaults = new Map(); // varName -> default value

export const cssVars = {
    /**
     * Set CSS variable(s)
     */
    set(name, value, target = ':root') {
        const element = typeof target === 'string'
            ? document.querySelector(target)
            : target || document.documentElement;

        if (!element) return this;

        const changes = [];

        if (typeof name === 'object') {
            // Multiple variables
            for (const [key, val] of Object.entries(name)) {
                const old = this.get(key, null, element);
                element.style.setProperty(key, val);
                changes.push({ key, old, new: val, element });
            }
        } else {
            // Single variable
            const old = this.get(name, null, element);
            element.style.setProperty(name, value);
            changes.push({ key: name, old, new: value, element });
        }

        // Notify observers
        this._notify(changes);

        return this;
    },

    /**
     * Get CSS variable value
     */
    get(name, fallback = null, target = ':root') {
        const element = typeof target === 'string'
            ? document.querySelector(target)
            : target || document.documentElement;

        if (!element) return fallback;

        const value = getComputedStyle(element).getPropertyValue(name).trim();
        return value || fallback;
    },

    /**
     * Remove CSS variable
     */
    remove(name, target = ':root') {
        const element = typeof target === 'string'
            ? document.querySelector(target)
            : target || document.documentElement;

        if (!element) return this;

        const old = this.get(name, null, element);
        element.style.removeProperty(name);

        this._notify([{ key: name, old, new: null, element }]);

        return this;
    },

    /**
     * Apply a theme (multiple variables at once)
     */
    applyTheme(theme, target = ':root') {
        return this.set(theme, target);
    },

    /**
     * Save current variables to storage
     */
    save(namespace = 'css-vars', target = ':root') {
        const element = typeof target === 'string'
            ? document.querySelector(target)
            : target || document.documentElement;

        if (!element) return this;

        // Get all custom properties
        const styles = getComputedStyle(element);
        const vars = {};

        for (let i = 0; i < styles.length; i++) {
            const prop = styles[i];
            if (prop.startsWith('--')) {
                vars[prop] = styles.getPropertyValue(prop).trim();
            }
        }

        try {
            localStorage.setItem(namespace, JSON.stringify(vars));
        } catch (e) {
            console.warn('[oja/cssvars] Failed to save:', e);
        }

        return this;
    },

    /**
     * Load variables from storage
     */
    load(namespace = 'css-vars', target = ':root') {
        try {
            const saved = localStorage.getItem(namespace);
            if (saved) {
                const vars = JSON.parse(saved);
                this.set(vars, target);
            }
        } catch (e) {
            console.warn('[oja/cssvars] Failed to load:', e);
        }

        return this;
    },

    /**
     * Reset variables to defaults
     */
    reset(target = ':root') {
        const element = typeof target === 'string'
            ? document.querySelector(target)
            : target || document.documentElement;

        if (!element) return this;

        const changes = [];

        for (const [key, defaultValue] of _defaults) {
            const old = this.get(key, null, element);
            if (defaultValue === undefined) {
                element.style.removeProperty(key);
                changes.push({ key, old, new: null, element });
            } else {
                element.style.setProperty(key, defaultValue);
                changes.push({ key, old, new: defaultValue, element });
            }
        }

        this._notify(changes);

        return this;
    },

    /**
     * Set default value for a variable
     */
    default(name, value) {
        _defaults.set(name, value);
        return this;
    },

    /**
     * Compute a CSS value with variables
     */
    compute(expression, target = ':root') {
        const element = typeof target === 'string'
            ? document.querySelector(target)
            : target || document.documentElement;

        if (!element) return expression;

        // Create a temporary element to compute the value
        const temp = document.createElement('div');
        temp.style.position = 'absolute';
        temp.style.visibility = 'hidden';
        temp.style.setProperty('--temp-expression', expression);
        element.appendChild(temp);

        const computed = getComputedStyle(temp).getPropertyValue('--temp-expression').trim();
        temp.remove();

        return computed || expression;
    },

    /**
     * Resolve all variables in a CSS string
     */
    resolve(cssString, target = ':root') {
        const element = typeof target === 'string'
            ? document.querySelector(target)
            : target || document.documentElement;

        if (!element) return cssString;

        // Match all var() expressions
        return cssString.replace(/var\(--[^,)]+(?:,[^)]+)?\)/g, (match) => {
            const varName = match.match(/--[^,)]+/)[0];
            const fallback = match.match(/,([^)]+)/)?.[1]?.trim();
            return this.get(varName, fallback, element);
        });
    },

    /**
     * Observe variable changes
     */
    observe(name, handler) {
        if (typeof name === 'function') {
            // Global observer
            _globalObservers.add(name);
            return () => _globalObservers.delete(name);
        }

        const names = Array.isArray(name) ? name : [name];
        let unsubs = [];

        for (const n of names) {
            if (!_observers.has(n)) {
                _observers.set(n, new Set());
            }
            _observers.get(n).add(handler);

            unsubs.push(() => {
                _observers.get(n)?.delete(handler);
                if (_observers.get(n)?.size === 0) {
                    _observers.delete(n);
                }
            });
        }

        return () => unsubs.forEach(fn => fn());
    },

    /**
     * Get all variables on an element
     */
    all(target = ':root') {
        const element = typeof target === 'string'
            ? document.querySelector(target)
            : target || document.documentElement;

        if (!element) return {};

        const styles = getComputedStyle(element);
        const vars = {};

        for (let i = 0; i < styles.length; i++) {
            const prop = styles[i];
            if (prop.startsWith('--')) {
                vars[prop] = styles.getPropertyValue(prop).trim();
            }
        }

        return vars;
    },

    /**
     * Check if variable exists
     */
    has(name, target = ':root') {
        const value = this.get(name, null, target);
        return value !== null;
    },

    // Internal

    _notify(changes) {
        // Notify per-variable observers
        for (const change of changes) {
            const observers = _observers.get(change.key);
            if (observers) {
                for (const fn of observers) {
                    try {
                        fn(change.new, change.old, change.element);
                    } catch (e) {
                        console.warn('[oja/cssvars] Observer error:', e);
                    }
                }
            }
        }

        // Notify global observers
        for (const fn of _globalObservers) {
            try {
                fn(changes);
            } catch (e) {
                console.warn('[oja/cssvars] Global observer error:', e);
            }
        }
    },
};
