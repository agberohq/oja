/**
 * oja/adapter.js
 * Third-party library bridge.
 * Register once, use anywhere. Oja never imports D3, GSAP, or jQuery directly.
 *
 * ─── Usage ────────────────────────────────────────────────────────────────────
 *
 *   import { adapter } from '../oja/adapter.js';
 *
 *   // Register in app.js — once
 *   adapter.register('d3',   d3);
 *   adapter.register('gsap', gsap);
 *   adapter.register('$',    jQuery);  // jQuery-based paid template? no problem
 *
 *   // Use anywhere without importing again
 *   const d3   = adapter.use('d3');
 *   const gsap = adapter.use('gsap');
 *   const $    = adapter.use('$');
 *
 *   // Wire into Oja component lifecycle
 *   import { component } from '../oja/component.js';
 *   component.hooks({
 *       entering: (el) => adapter.use('gsap').from(el, { opacity: 0, y: 10, duration: 0.25 }),
 *       leaving:  (el) => adapter.use('gsap').to(el,   { opacity: 0, duration: 0.2 }),
 *   });
 *
 * ─── Lazy registration ────────────────────────────────────────────────────────
 *
 *   // Register a factory — library only loaded when first used
 *   adapter.lazy('chart', () => import('https://cdn.jsdelivr.net/npm/chart.js'));
 *
 *   const Chart = await adapter.useAsync('chart');
 *
 * ─── Versioning ───────────────────────────────────────────────────────────────
 *
 *   adapter.register('d3', d3, { version: '7.8.5' });
 *   adapter.version('d3');   // → '7.8.5'
 *   adapter.list();          // → [{ name: 'd3', version: '7.8.5', lazy: false }, ...]
 */

// ─── Registry ─────────────────────────────────────────────────────────────────

const _registry = new Map(); // name → { instance, version, lazy, factory }

// ─── Public API ───────────────────────────────────────────────────────────────

export const adapter = {

    /**
     * Register a library instance.
     *
     *   adapter.register('d3', d3);
     *   adapter.register('gsap', gsap, { version: '3.12' });
     */
    register(name, instance, options = {}) {
        _registry.set(name, {
            instance,
            version : options.version || _detectVersion(instance),
            lazy    : false,
        });
        return this;
    },

    /**
     * Register a lazy factory — library loaded only when first used.
     *
     *   adapter.lazy('chart', () => import('https://cdn.jsdelivr.net/npm/chart.js'));
     *   const Chart = await adapter.useAsync('chart');
     */
    lazy(name, factory, options = {}) {
        _registry.set(name, {
            instance : null,
            version  : options.version || null,
            lazy     : true,
            factory,
        });
        return this;
    },

    /**
     * Retrieve a registered library synchronously.
     * Throws if not registered or registered as lazy (use useAsync for lazy).
     *
     *   const gsap = adapter.use('gsap');
     */
    use(name) {
        const entry = _registry.get(name);
        if (!entry) {
            throw new Error(
                `[oja/adapter] "${name}" is not registered. ` +
                `Call adapter.register("${name}", lib) in app.js first.`
            );
        }
        if (entry.lazy && !entry.instance) {
            throw new Error(
                `[oja/adapter] "${name}" is a lazy adapter. Use adapter.useAsync("${name}") instead.`
            );
        }
        return entry.instance;
    },

    /**
     * Retrieve a library — loading it if lazy.
     * Always returns a Promise.
     *
     *   const Chart = await adapter.useAsync('chart');
     */
    async useAsync(name) {
        const entry = _registry.get(name);
        if (!entry) {
            throw new Error(`[oja/adapter] "${name}" is not registered.`);
        }
        if (entry.lazy && !entry.instance) {
            const mod = await entry.factory();
            // Handle both default export and namespace export
            entry.instance = mod?.default ?? mod;
        }
        return entry.instance;
    },

    /**
     * Check if a library is registered.
     *
     *   if (adapter.has('gsap')) { ... }
     */
    has(name) {
        return _registry.has(name);
    },

    /**
     * Get the version string for a registered library.
     */
    version(name) {
        return _registry.get(name)?.version || null;
    },

    /**
     * List all registered adapters.
     *
     *   adapter.list();
     *   // → [{ name: 'd3', version: '7.8.5', lazy: false }, ...]
     */
    list() {
        return [..._registry.entries()].map(([name, entry]) => ({
            name,
            version  : entry.version,
            lazy     : entry.lazy,
            loaded   : entry.lazy ? entry.instance !== null : true,
        }));
    },

    /**
     * Remove a registered library.
     */
    unregister(name) {
        _registry.delete(name);
        return this;
    }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _detectVersion(instance) {
    if (!instance) return null;
    // Common version properties across libraries
    return instance.version
        || instance.VERSION
        || instance.__version__
        || null;
}