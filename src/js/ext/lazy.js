/**
 * oja/lazy.js
 * Lazy loading and code splitting utilities.
 * Dynamically load components, scripts, and styles when needed.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { lazy } from '../oja/lazy.js';
 *
 *   // Lazy load a component
 *   const HeavyTable = lazy.component('/components/heavy-table.html');
 *
 *   // Use when needed
 *   on('#show-table', 'click', async () => {
 *       const table = await HeavyTable.load();
 *       table.mount('#container', data);
 *   });
 *
 * ─── Lazy scripts ─────────────────────────────────────────────────────────────
 *
 *   // Load script on demand
 *   const chartLib = lazy.script('/js/chart.js');
 *
 *   on('#render-chart', 'click', async () => {
 *       await chartLib.load();
 *       // Chart library now available
 *       renderChart();
 *   });
 *
 * ─── Lazy styles ──────────────────────────────────────────────────────────────
 *
 *   // Load CSS when needed
 *   lazy.style('/css/editor.css');
 *
 *   // Load with conditions
 *   if (window.innerWidth < 768) {
 *       lazy.style('/css/mobile.css');
 *   }
 *
 * ─── Preload and prefetch ─────────────────────────────────────────────────────
 *
 *   // Preload critical resources
 *   lazy.preload('/js/dashboard.js');
 *
 *   // Prefetch likely resources
 *   lazy.prefetch('/js/settings.js');
 *
 * ─── Dynamic imports ──────────────────────────────────────────────────────────
 *
 *   // Lazy load ES modules
 *   const utils = lazy.import('/js/utils.js');
 *
 *   const { formatBytes } = await utils;
 *   console.log(formatBytes(1048576));
 *
 * ─── Conditional loading ──────────────────────────────────────────────────────
 *
 *   // Load based on feature detection
 *   if (lazy.supports('webgl')) {
 *       await lazy.script('/js/3d-viewer.js');
 *   }
 *
 *   // Load based on viewport
 *   lazy.whenInViewport('#chart-container', () => {
 *       return lazy.script('/js/chart.js');
 *   });
 *
 * ─── Batch loading ────────────────────────────────────────────────────────────
 *
 *   // Load multiple resources in parallel
 *   await lazy.all([
 *       lazy.script('/js/vendor.js'),
 *       lazy.style('/css/theme.css'),
 *       lazy.component('/components/dashboard.html'),
 *   ]);
 *
 * ─── Cache management ─────────────────────────────────────────────────────────
 *
 *   // Clear cache
 *   lazy.clearCache();
 *
 *   // Preload multiple
 *   lazy.preloadAll(['/js/one.js', '/js/two.js']);
 */

// ─── State ────────────────────────────────────────────────────────────────────

const _cache = new Map(); // url -> promise
const _loaded = new Map(); // url -> true/false
const _observers = new Map(); // element -> observer

// ─── Core API ─────────────────────────────────────────────────────────────────

export const lazy = {
    /**
     * Lazy load a component
     */
    component(url) {
        let promise = null;
        let instance = null;

        const load = async () => {
            if (instance) return instance;

            if (!promise) {
                promise = (async () => {
                    const { component } = await import('../core/component.js');
                    return { component, url };
                })();
            }

            return promise;
        };

        return {
            load,
            async mount(container, data, lists) {
                const { component, url } = await load();
                await component.mount(container, url, data, lists);
            },
            async add(container, data) {
                const { component, url } = await load();
                return component.add(container, url, data);
            },
        };
    },

    /**
     * Lazy load a script
     */
    script(url, options = {}) {
        const { async = true, defer = false, module = false } = options;

        if (_loaded.get(url)) {
            return Promise.resolve();
        }

        if (_cache.has(url)) {
            return _cache.get(url);
        }

        const promise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.async = async;
            script.defer = defer;

            if (module) {
                script.type = 'module';
            }

            script.onload = () => {
                _loaded.set(url, true);
                _cache.delete(url);
                resolve(script);
            };

            script.onerror = () => {
                _cache.delete(url);
                reject(new Error(`Failed to load script: ${url}`));
            };

            document.head.appendChild(script);
        });

        _cache.set(url, promise);
        return promise;
    },

    /**
     * Lazy load a stylesheet
     */
    style(url, options = {}) {
        const { media = 'all', id = null } = options;

        if (_loaded.get(url)) {
            return Promise.resolve();
        }

        if (_cache.has(url)) {
            return _cache.get(url);
        }

        const promise = new Promise((resolve, reject) => {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = url;
            link.media = media;

            if (id) {
                link.id = id;
            }

            link.onload = () => {
                _loaded.set(url, true);
                _cache.delete(url);
                resolve(link);
            };

            link.onerror = () => {
                _cache.delete(url);
                reject(new Error(`Failed to load stylesheet: ${url}`));
            };

            document.head.appendChild(link);
        });

        _cache.set(url, promise);
        return promise;
    },

    /**
     * Lazy import an ES module
     */
    import(url) {
        if (_cache.has(url)) {
            return _cache.get(url);
        }

        const promise = import(url);
        _cache.set(url, promise);
        return promise;
    },

    /**
     * Preload a resource
     */
    preload(url, options = {}) {
        const { as = 'script', type = '' } = options;

        const link = document.createElement('link');
        link.rel = 'preload';
        link.href = url;
        link.as = as;

        if (type) {
            link.type = type;
        }

        document.head.appendChild(link);

        return () => link.remove();
    },

    /**
     * Prefetch a resource (lower priority)
     */
    prefetch(url, options = {}) {
        const { as = 'script', type = '' } = options;

        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.href = url;
        link.as = as;

        if (type) {
            link.type = type;
        }

        document.head.appendChild(link);

        return () => link.remove();
    },

    /**
     * Preload multiple resources
     */
    preloadAll(urls, options = {}) {
        return urls.map(url => this.preload(url, options));
    },

    /**
     * Prefetch multiple resources
     */
    prefetchAll(urls, options = {}) {
        return urls.map(url => this.prefetch(url, options));
    },

    /**
     * Load multiple resources in parallel
     */
    all(resources) {
        return Promise.all(resources);
    },

    /**
     * Load resources in sequence
     */
    sequence(resources) {
        return resources.reduce(
            (promise, resource) => promise.then(() => resource),
            Promise.resolve()
        );
    },

    /**
     * Load when element is in viewport
     */
    whenInViewport(selector, factory, options = {}) {
        const { threshold = 0.1, rootMargin = '50px' } = options;
        const element = typeof selector === 'string'
            ? document.querySelector(selector)
            : selector;

        if (!element) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    observer.disconnect();
                    factory();
                }
            });
        }, { threshold, rootMargin });

        observer.observe(element);
        _observers.set(element, observer);

        return () => {
            observer.disconnect();
            _observers.delete(element);
        };
    },

    /**
     * Load when idle (requestIdleCallback)
     */
    whenIdle(factory, options = { timeout: 2000 }) {
        if ('requestIdleCallback' in window) {
            return new Promise(resolve => {
                requestIdleCallback(() => {
                    resolve(factory());
                }, options);
            });
        } else {
            // Fallback to setTimeout
            return new Promise(resolve => {
                setTimeout(() => resolve(factory()), 1);
            });
        }
    },

    /**
     * Check if resource is loaded
     */
    isLoaded(url) {
        return _loaded.has(url);
    },

    /**
     * Check feature support
     */
    supports(feature) {
        const features = {
            webgl: () => {
                try {
                    const canvas = document.createElement('canvas');
                    return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
                } catch {
                    return false;
                }
            },
            webgl2: () => {
                try {
                    const canvas = document.createElement('canvas');
                    return !!canvas.getContext('webgl2');
                } catch {
                    return false;
                }
            },
            wasm: () => 'WebAssembly' in window,
            workers: () => 'Worker' in window,
            serviceWorker: () => 'serviceWorker' in navigator,
            webp: () => {
                const canvas = document.createElement('canvas');
                return canvas.toDataURL('image/webp').startsWith('data:image/webp');
            },
            avif: () => {
                const canvas = document.createElement('canvas');
                return canvas.toDataURL('image/avif').startsWith('data:image/avif');
            },
            webSocket: () => 'WebSocket' in window,
            indexedDB: () => 'indexedDB' in window,
            localStorage: () => {
                try {
                    localStorage.setItem('test', 'test');
                    localStorage.removeItem('test');
                    return true;
                } catch {
                    return false;
                }
            },
            touch: () => 'ontouchstart' in window,
            intersectionObserver: () => 'IntersectionObserver' in window,
            resizeObserver: () => 'ResizeObserver' in window,
            mutationObserver: () => 'MutationObserver' in window,
        };

        const check = features[feature];
        return check ? check() : false;
    },

    /**
     * Clear cache
     */
    clearCache() {
        _cache.clear();
        // Don't clear _loaded as those resources are actually loaded
    },

    /**
     * Get cache stats
     */
    stats() {
        return {
            cached: _cache.size,
            loaded: _loaded.size,
        };
    },
};