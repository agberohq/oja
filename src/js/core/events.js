/**
 * oja/events.js
 * Delegated event system, timing utilities, and keyboard shortcuts.
 *
 * ─── Delegated DOM events ─────────────────────────────────────────────────────
 *
 *   import { on, once, off, emit, listen, debounce, throttle, keys } from '../oja/events.js';
 *
 *   // Listen for clicks on any element matching selector (even future ones)
 *   on('[data-action="open-route"]', 'click', (e, el) => app.openRoute(el.dataset));
 *   on('.nav-link',  'click', (e, el) => router.navigate(el.dataset.page));
 *   on('.chip',      'click', (e, el) => app.setFilter(el.dataset.level));
 *
 *   // Fire once then remove itself
 *   once('#confirmOk', 'click', (e, el) => app.confirm());
 *
 *   // Remove a specific listener
 *   off('[data-action="open-route"]', 'click', handler);
 *
 * ─── Cross-component messaging ────────────────────────────────────────────────
 *
 *   emit('host:selected', { hostname: 'api.example.com' });
 *   const unsub = listen('host:selected', ({ hostname }) => highlight(hostname));
 *   unsub();
 *
 * ─── Keyboard shortcuts ───────────────────────────────────────────────────────
 *
 *   Declarative shortcut map — no scattered keydown listeners.
 *   Shortcuts are ignored when focus is inside an input, textarea, or select.
 *
 *   keys({
 *       'ctrl+1':     () => router.navigate('/dashboard'),
 *       'ctrl+2':     () => router.navigate('/hosts'),
 *       'ctrl+3':     () => router.navigate('/firewall'),
 *       'escape':     () => modal.closeAll(),
 *       '/':          () => document.getElementById('search')?.focus(),
 *       'r':          () => router.refresh(),
 *       '?':          () => notify.info('Ctrl+1-6: Pages  ·  r: Refresh  ·  /: Search  ·  Esc: Close'),
 *   });
 *
 *   Modifier syntax:
 *     'ctrl+k'    → Ctrl/Cmd + k
 *     'shift+/'   → Shift + /  (i.e. ?)
 *     'escape'    → Escape key
 *     'f5'        → F5 (prevent default)
 *
 *   Returns an unsub function — call to remove all shortcuts registered in that map:
 *     const unsub = keys({ ... });
 *     unsub(); // remove all
 *
 * ─── Scroll and Intersection Observers ────────────────────────────────────────
 *
 *   // Scroll position tracking
 *   onScroll('#sidebar', (pos) => {
 *       if (pos > 100) showBackToTop();
 *   });
 *
 *   // Element visibility with IntersectionObserver
 *   onVisible('.lazy-image', (el) => {
 *       el.src = el.dataset.src;
 *   }, { threshold: 0.1, rootMargin: '50px' });
 *
 *   // One-time visibility
 *   onceVisible('#analytics-section', () => {
 *       trackPageView('analytics-section');
 *   });
 *
 *   // Scroll direction detection
 *   onScrollDirection((direction, delta) => {
 *       if (direction === 'down') hideHeader();
 *       else showHeader();
 *   });
 *
 *   // Element in viewport check
 *   if (isInViewport('#cta-button')) {
 *       startAnimation();
 *   }
 *
 * ─── Debounce and throttle ────────────────────────────────────────────────────
 *
 *   on('#host-search', 'input', debounce(renderHosts, 200));
 *   on('#scrollable',  'scroll', throttle(updateNav, 100));
 */

// ─── Delegated DOM events ─────────────────────────────────────────────────────

const _registry = new Map(); // event → [{ selector, fn, original, options }]
const _passiveEvents = new Set(['scroll', 'touchstart', 'touchmove', 'wheel']);

// _componentScopeHook — set by component.js to avoid a circular import.
// When set, on() calls this with the unsub function so the active component
// scope can track and auto-clean it on unmount.
// If no component is active (called from layout scripts or global code),
// the hook is a no-op and the caller is responsible for cleanup.
let _componentScopeHook = null;

export function _setComponentScopeHook(fn) {
    _componentScopeHook = fn;
}

function _registerWithActiveComponent(unsub) {
    if (_componentScopeHook) _componentScopeHook(unsub);
}

/**
 * Attach an event listener. Accepts either a CSS selector (delegated, via document.body)
 * or a direct Element reference (direct addEventListener on that element).
 * fn receives (event, matchedElement).
 *
 *   on('.btn-delete', 'click', (e, el) => deleteItem(el.dataset.id));
 *   on(myButtonEl,    'click', (e, el) => doSomething());
 */
export function on(selector, eventName, fn, options = {}) {
    const { passive = _passiveEvents.has(eventName), capture = false } = options;

    if (selector instanceof EventTarget) {
        selector.addEventListener(eventName, fn, { passive, capture });
        // Return a callable unsub — mirrors the delegated-selector path.
        const unsub = () => selector.removeEventListener(eventName, fn);
        _registerWithActiveComponent(unsub);
        return unsub;
    }

    if (!_registry.has(eventName)) {
        _registry.set(eventName, []);

        document.body.addEventListener(eventName, (e) => {
            // e.target may be a text node, SVG element without .closest(), or the
            // Document node itself — none of which are Elements. Skip delegation.
            if (!e.target || typeof e.target.closest !== 'function') return;
            const handlers = _registry.get(eventName) || [];
            for (const { selector: sel, fn: handler } of handlers) {
                const target = e.target.closest(sel);
                if (target) handler(e, target);
            }
        }, { passive, capture });
    }

    // Guard against duplicate registration — calling on('.btn', 'click', handler)
    // twice would otherwise register two entries and fire the handler twice.
    const existing = _registry.get(eventName);
    const isDuplicate = existing.some(h => h.selector === selector && h.original === fn);
    if (!isDuplicate) {
        existing.push({ selector, fn, original: fn, options });
    }

    // Return a callable unsub that removes this specific entry from the registry.
    // Also registers with the active component scope so it is called automatically
    // on unmount — no manual cleanup needed inside component scripts.
    const unsub = () => off(selector, eventName, fn);
    _registerWithActiveComponent(unsub);
    return unsub;
}

/**
 * Like on() but removes itself after the first match.
 * Works with both CSS selectors and direct Element references.
 */
export function once(selector, eventName, fn, options = {}) {
    if (selector instanceof EventTarget) {
        const wrapper = (e) => {
            selector.removeEventListener(eventName, wrapper);
            fn(e, selector);
        };
        return on(selector, eventName, wrapper, options);
    }
    const wrapper = (e, el) => {
        off(selector, eventName, wrapper);
        fn(e, el);
    };
    return on(selector, eventName, wrapper, options);
}

/**
 * Remove a specific listener. Mirrors the on() dual-mode signature.
 * For direct elements, selector is the Element and fn is the original handler.
 */
export function off(selector, eventName, fn) {
    if (selector instanceof EventTarget) {
        selector.removeEventListener(eventName, fn);
        return;
    }
    if (!_registry.has(eventName)) return;
    const handlers = _registry.get(eventName);
    const idx = handlers.findIndex(
        h => h.selector === selector && (h.fn === fn || h.original === fn)
    );
    if (idx !== -1) handlers.splice(idx, 1);
}

// ─── Custom events (cross-component messaging) ────────────────────────────────

const _wildcardListeners = new Set(); // for '*' wildcard

/**
 * Fire a named custom event on document.
 * Any listener registered with listen() will receive detail.
 *
 *   emit('host:updated', { id: 'api-example-com', alive: false });
 */
export function emit(name, detail = {}) {
    const event = new CustomEvent(name, { detail, bubbles: false, cancelable: true });
    document.dispatchEvent(event);

    // Wildcard listeners receive all events
    for (const fn of _wildcardListeners) {
        fn(name, detail);
    }
}

/**
 * Listen for a named custom event fired by emit().
 * Returns an unsubscribe function.
 *
 *   const unsub = listen('session:expired', () => app.logout());
 *   unsub();
 */
export function listen(name, fn) {
    if (name === '*') {
        _wildcardListeners.add(fn);
        return () => _wildcardListeners.delete(fn);
    }

    const handler = (e) => fn(e.detail, e);
    document.addEventListener(name, handler);
    return () => document.removeEventListener(name, handler);
}

/**
 * Listen once for a named custom event, then automatically unsubscribe.
 */
export function listenOnce(name, fn) {
    const unsub = listen(name, (detail, event) => {
        unsub();
        fn(detail, event);
    });
    return unsub;
}

/**
 * Wait for an event to fire, returns a promise.
 * Useful in async flows.
 *
 *   const data = await waitFor('host:updated', 5000);
 */
export function waitFor(name, timeout = 0) {
    return new Promise((resolve, reject) => {
        const unsub = listenOnce(name, resolve);
        if (timeout > 0) {
            setTimeout(() => {
                unsub();
                reject(new Error(`Timeout waiting for ${name}`));
            }, timeout);
        }
    });
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

const _shortcutGroups = new Set(); // groups of shortcuts
const _activeShortcuts = new Map(); // key → Set of handlers

const MODIFIERS = ['ctrl', 'cmd', 'shift', 'alt', 'meta'];
const KEY_ALIASES = {
    'esc': 'escape',
    'return': 'enter',
    'del': 'delete',
    'ins': 'insert',
    'pgup': 'pageup',
    'pgdn': 'pagedown',
    'space': ' ',
    'plus': '+',
    'up': 'arrowup',
    'down': 'arrowdown',
    'left': 'arrowleft',
    'right': 'arrowright',
};

/**
 * Register a declarative keyboard shortcut map.
 * All shortcuts in the map share one keydown listener — no global clutter.
 * Shortcuts are ignored when focus is inside an input, textarea, or select.
 *
 * Modifier syntax (case-insensitive):
 *   'ctrl+k'   → Ctrl (or Cmd on Mac) + k
 *   'shift+r'  → Shift + r
 *   'escape'   → Escape key (no modifier)
 *   'f5'       → F5 function key
 *
 *   keys({
 *       'ctrl+1':  () => router.navigate('/dashboard'),
 *       'ctrl+2':  () => router.navigate('/hosts'),
 *       'escape':  () => modal.closeAll(),
 *       '/':       () => document.getElementById('search')?.focus(),
 *       'r':       () => router.refresh(),
 *       '?':       () => notify.info('Ctrl+1-6  ·  r: Refresh  ·  /: Search'),
 *   });
 *
 * @param {Object} map   — shortcut → handler function
 * @param {Object} options
 *   preventDefault : boolean  — prevent default browser action (default: true)
 *   ignoreInputs   : boolean  — ignore when in inputs (default: true)
 *   scope          : Element  — restrict to element (default: document)
 * @returns {Function}   — call to unregister all shortcuts in this map
 */
export function keys(map, options = {}) {
    const { preventDefault = true, ignoreInputs = true, scope = document } = options;

    const parsed = Object.entries(map).map(([combo, fn]) => {
        const parts = combo.toLowerCase().split('+').map(p => KEY_ALIASES[p] || p);
        const ctrl = parts.some(p => p === 'ctrl' || p === 'cmd' || p === 'meta');
        const shift = parts.includes('shift');
        const alt = parts.includes('alt');
        const key = parts.find(p => !MODIFIERS.includes(p)) || '';

        return { combo: combo.toLowerCase(), ctrl, shift, alt, key, fn };
    });

    // Register each shortcut individually
    for (const shortcut of parsed) {
        const key = shortcut.key;
        if (!_activeShortcuts.has(key)) {
            _activeShortcuts.set(key, new Set());
        }
        _activeShortcuts.get(key).add(shortcut);
    }

    const group = { parsed, options };
    _shortcutGroups.add(group);

    const handler = (e) => {
        if (ignoreInputs && e.target.matches('input, textarea, select, [contenteditable]')) {
            return;
        }

        const key = e.key.toLowerCase();
        const shortcuts = _activeShortcuts.get(key);
        if (!shortcuts) return;

        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;
        const alt = e.altKey;

        for (const shortcut of shortcuts) {
            if (shortcut.ctrl === ctrl &&
                shortcut.shift === shift &&
                shortcut.alt === alt) {

                if (preventDefault) {
                    e.preventDefault();
                }

                shortcut.fn(e);
                break; // first match wins
            }
        }
    };

    scope.addEventListener('keydown', handler);

    // Return unsub function for this group
    return () => {
        scope.removeEventListener('keydown', handler);
        _shortcutGroups.delete(group);

        // Clean up if this was the last handler for any key
        for (const shortcut of parsed) {
            const handlers = _activeShortcuts.get(shortcut.key);
            if (handlers) {
                handlers.delete(shortcut);
                if (handlers.size === 0) {
                    _activeShortcuts.delete(shortcut.key);
                }
            }
        }
    };
}

/**
 * Check if a key combo is currently registered.
 *
 *   if (keys.isRegistered('ctrl+s')) { ... }
 */
keys.isRegistered = (combo) => {
    const parts = combo.toLowerCase().split('+');
    const key = parts.find(p => !MODIFIERS.includes(p)) || '';
    const handlers = _activeShortcuts.get(key);
    if (!handlers) return false;

    const ctrl = parts.some(p => p === 'ctrl' || p === 'cmd' || p === 'meta');
    const shift = parts.includes('shift');
    const alt = parts.includes('alt');

    for (const handler of handlers) {
        if (handler.ctrl === ctrl && handler.shift === shift && handler.alt === alt) {
            return true;
        }
    }
    return false;
};

/**
 * Get all registered shortcuts (for debugging).
 */
keys.getAll = () => {
    const result = [];
    for (const [key, handlers] of _activeShortcuts) {
        for (const handler of handlers) {
            result.push({
                combo: handler.combo,
                key: handler.key,
                ctrl: handler.ctrl,
                shift: handler.shift,
                alt: handler.alt
            });
        }
    }
    return result;
};

// ─── Scroll and Intersection Observers ────────────────────────────────────────

const _scrollListeners = new Map(); // element → Set of handlers
const _scrollRaf = new Map(); // element → raf id
const _scrollPositions = new Map(); // element → { x, y }

/**
 * Listen to scroll events with requestAnimationFrame throttling.
 * Returns position { x, y, direction }.
 *
 *   onScroll('#container', (pos) => {
 *       if (pos.y > 100) showBackToTop();
 *   });
 */
export function onScroll(target, fn, options = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) {
        console.warn(`[oja/events] onScroll target not found: ${target}`);
        return () => {};
    }

    if (!_scrollListeners.has(el)) {
        _scrollListeners.set(el, new Set());

        const handler = () => {
            if (_scrollRaf.has(el)) return;

            const raf = requestAnimationFrame(() => {
                const x = el === window ? window.scrollX : el.scrollLeft;
                const y = el === window ? window.scrollY : el.scrollTop;

                const lastPos = _scrollPositions.get(el) || { x: 0, y: 0 };
                const direction = {
                    x: x > lastPos.x ? 'right' : x < lastPos.x ? 'left' : 'none',
                    y: y > lastPos.y ? 'down' : y < lastPos.y ? 'up' : 'none'
                };

                const pos = { x, y, direction };
                _scrollPositions.set(el, { x, y });

                const handlers = _scrollListeners.get(el);
                if (handlers) {
                    for (const handlerFn of handlers) {
                        handlerFn(pos);
                    }
                }

                _scrollRaf.delete(el);
            });

            _scrollRaf.set(el, raf);
        };

        el.addEventListener('scroll', handler, { passive: true });
        el._scrollHandler = handler;
    }

    const handlers = _scrollListeners.get(el);
    handlers.add(fn);

    return () => {
        const handlers = _scrollListeners.get(el);
        if (handlers) {
            handlers.delete(fn);
            if (handlers.size === 0) {
                if (el._scrollHandler) {
                    el.removeEventListener('scroll', el._scrollHandler);
                }
                _scrollListeners.delete(el);
                _scrollRaf.delete(el);
                _scrollPositions.delete(el);
            }
        }
    };
}

/**
 * Listen to scroll direction changes.
 *
 *   onScrollDirection((direction, delta) => {
 *       if (direction === 'down') hideHeader();
 *   });
 */
export function onScrollDirection(fn, threshold = 5) {
    let lastY = window.scrollY;
    let lastDirection = 'none';

    return onScroll(window, (pos) => {
        const delta = pos.y - lastY;
        if (Math.abs(delta) > threshold) {
            const direction = delta > 0 ? 'down' : 'up';
            if (direction !== lastDirection) {
                fn(direction, delta);
                lastDirection = direction;
            }
        }
        lastY = pos.y;
    });
}

/**
 * Check if element is in viewport.
 *
 *   if (isInViewport('#cta-button')) animate();
 */
export function isInViewport(target, offset = 0) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return false;

    const rect = el.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;

    return (
        rect.top + offset < windowHeight &&
        rect.bottom - offset > 0 &&
        rect.left + offset < windowWidth &&
        rect.right - offset > 0
    );
}

/**
 * Get element's position relative to viewport.
 *
 *   const { top, bottom, percentY } = getViewportPosition(el);
 */
export function getViewportPosition(el) {
    if (!el) return null;

    const rect = el.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;

    const visibleHeight = Math.min(rect.bottom, windowHeight) - Math.max(rect.top, 0);
    const percentY = Math.max(0, Math.min(1, visibleHeight / rect.height));

    return {
        top: rect.top,
        bottom: rect.bottom - windowHeight,
        left: rect.left,
        right: rect.right - window.innerWidth,
        percentY,
        isVisible: percentY > 0
    };
}

// ─── Intersection Observer ────────────────────────────────────────────────────

const _intersectionObservers = new Map(); // Map of observer → Set of targets
const _intersectionHandlers = new WeakMap(); // target → Map of handler → options

/**
 * Observe when element becomes visible in viewport.
 * Uses IntersectionObserver with automatic cleanup.
 *
 *   onVisible('.lazy-image', (el) => {
 *       el.src = el.dataset.src;
 *   }, { threshold: 0.1, rootMargin: '50px' });
 */
export function onVisible(selector, fn, options = {}) {
    const { threshold = 0, rootMargin = '0px', root = null, once = false } = options;

    const elements = typeof selector === 'string'
        ? Array.from(document.querySelectorAll(selector))
        : [selector];

    const unsubs = elements.map(el => {
        if (!el) return () => {};

        if (!_intersectionHandlers.has(el)) {
            _intersectionHandlers.set(el, new Map());
        }

        const handlers = _intersectionHandlers.get(el);

        // Create or get observer for these options
        const observerKey = `${threshold}-${rootMargin}-${root}`;
        if (!_intersectionObservers.has(observerKey)) {
            const observer = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    const target = entry.target;
                    const targetHandlers = _intersectionHandlers.get(target);
                    if (!targetHandlers) continue;

                    for (const [handlerFn, handlerOptions] of targetHandlers) {
                        if (entry.isIntersecting) {
                            handlerFn(target, entry);
                            if (handlerOptions.once) {
                                unobserve(target, handlerFn);
                            }
                        }
                    }
                }
            }, { threshold, rootMargin, root });

            _intersectionObservers.set(observerKey, observer);
        }

        const observer = _intersectionObservers.get(observerKey);
        observer.observe(el);

        handlers.set(fn, { once, observerKey });

        return () => unobserve(el, fn);
    });

    return () => unsubs.forEach(unsub => unsub());
}

/**
 * Observe element once when it becomes visible.
 *
 *   onceVisible('#analytics-section', () => {
 *       trackPageView('analytics-section');
 *   });
 */
export function onceVisible(selector, fn, options = {}) {
    return onVisible(selector, fn, { ...options, once: true });
}

/**
 * Stop observing an element.
 */
export function unobserve(target, fn) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return;

    const handlers = _intersectionHandlers.get(el);
    if (!handlers) return;

    if (fn) {
        const handlerData = handlers.get(fn);
        if (handlerData) {
            const observer = _intersectionObservers.get(handlerData.observerKey);
            if (observer) {
                observer.unobserve(el);
            }
            handlers.delete(fn);
        }
    } else {
        // Remove all handlers for this element
        for (const [handlerFn, handlerData] of handlers) {
            const observer = _intersectionObservers.get(handlerData.observerKey);
            if (observer) {
                observer.unobserve(el);
            }
        }
        _intersectionHandlers.delete(el);
    }
}

/**
 * Create a permanent intersection observer that reports visibility changes.
 *
 *   const observer = createVisibilityObserver((entries) => {
 *       entries.forEach(e => console.log(e.target, e.isIntersecting));
 *   }, { threshold: 0.5 });
 */
export function createVisibilityObserver(fn, options = {}) {
    const observer = new IntersectionObserver(fn, options);

    return {
        observe: (el) => observer.observe(el),
        unobserve: (el) => observer.unobserve(el),
        disconnect: () => observer.disconnect()
    };
}

// ─── Resize Observer ──────────────────────────────────────────────────────────

const _resizeObservers = new Map(); // element → Set of handlers
const _resizeRaf = new Map(); // element → raf id
const _resizeSizes = new Map(); // element → { width, height }

/**
 * Observe element size changes with ResizeObserver.
 *
 *   onResize('#sidebar', (size) => {
 *       if (size.width < 300) collapseSidebar();
 *   });
 */
export function onResize(target, fn, options = {}) {
    if (typeof ResizeObserver === 'undefined') {
        console.warn('[oja/events] ResizeObserver not supported');
        return () => {};
    }

    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) {
        console.warn(`[oja/events] onResize target not found: ${target}`);
        return () => {};
    }

    if (!_resizeObservers.has(el)) {
        _resizeObservers.set(el, new Set());

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                _resizeSizes.set(el, { width, height });

                const handlers = _resizeObservers.get(el);
                if (handlers) {
                    for (const handler of handlers) {
                        handler({ width, height, entry });
                    }
                }
            }
        });

        resizeObserver.observe(el);
        el._resizeObserver = resizeObserver;
    }

    const handlers = _resizeObservers.get(el);
    handlers.add(fn);

    // Call immediately with current size if available
    if (el.offsetWidth || el.offsetHeight) {
        fn({ width: el.offsetWidth, height: el.offsetHeight });
    }

    return () => {
        const handlers = _resizeObservers.get(el);
        if (handlers) {
            handlers.delete(fn);
            if (handlers.size === 0) {
                if (el._resizeObserver) {
                    el._resizeObserver.disconnect();
                }
                _resizeObservers.delete(el);
                _resizeSizes.delete(el);
            }
        }
    };
}

// ─── Mutation Observer ────────────────────────────────────────────────────────

const _mutationObservers = new Map(); // element → observer

/**
 * Observe DOM mutations on an element.
 *
 *   onMutation('#list', (mutations) => {
 *       mutations.forEach(m => console.log('Added:', m.addedNodes));
 *   }, { childList: true, subtree: true });
 */
export function onMutation(target, fn, options = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) {
        console.warn(`[oja/events] onMutation target not found: ${target}`);
        return () => {};
    }

    if (!_mutationObservers.has(el)) {
        const observer = new MutationObserver((mutations) => {
            fn(mutations, observer);
        });
        _mutationObservers.set(el, observer);
    }

    const observer = _mutationObservers.get(el);
    observer.observe(el, {
        childList: false,
        attributes: false,
        characterData: false,
        subtree: false,
        ...options
    });

    return () => {
        observer.disconnect();
        _mutationObservers.delete(el);
    };
}

// ─── Timing utilities ─────────────────────────────────────────────────────────

/**
 * Debounce — delays execution until `ms` milliseconds after the last call.
 * Use for: search inputs, save-on-type, resize, autocomplete.
 *
 *   on('#host-search', 'input', debounce(renderHosts, 200));
 *
 * @param {Function} fn  — function to debounce
 * @param {number}   ms  — quiet period in ms (default: 200)
 * @param {Object}   options
 *   leading : boolean  — call on leading edge (default: false)
 *   maxWait : number   — maximum time to wait (default: 0 = no max)
 * @returns {Function}   — debounced wrapper; call .cancel() to abort pending
 */
export function debounce(fn, ms = 200, options = {}) {
    const { leading = false, maxWait = 0 } = options;
    let timer = null;
    let lastCall = 0;
    let maxTimer = null;

    const debounced = function (...args) {
        const now = Date.now();
        const context = this;

        if (leading && !timer) {
            fn.apply(context, args);
            lastCall = now;
        }

        clearTimeout(timer);

        if (maxWait > 0 && !maxTimer && now - lastCall > maxWait) {
            maxTimer = setTimeout(() => {
                maxTimer = null;
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                    fn.apply(context, args);
                }
            }, maxWait);
        }

        timer = setTimeout(() => {
            timer = null;
            if (maxTimer) {
                clearTimeout(maxTimer);
                maxTimer = null;
            }
            if (!leading || now - lastCall > ms) {
                fn.apply(context, args);
            }
        }, ms);
    };

    debounced.cancel = () => {
        clearTimeout(timer);
        clearTimeout(maxTimer);
        timer = null;
        maxTimer = null;
    };

    debounced.flush = function (...args) {
        debounced.cancel();
        fn.apply(this, args);
    };

    return debounced;
}

/**
 * Throttle — fires at most once per `ms` milliseconds.
 * Use for: scroll handlers, mousemove, window resize, live chart updates.
 *
 *   on('#scrollable', 'scroll', throttle(updateScrollbar, 100));
 *
 * @param {Function} fn  — function to throttle
 * @param {number}   ms  — minimum interval in ms (default: 100)
 * @param {Object}   options
 *   leading : boolean  — call on leading edge (default: true)
 *   trailing: boolean  — call on trailing edge (default: true)
 * @returns {Function}   — throttled wrapper; call .cancel() to reset
 */
export function throttle(fn, ms = 100, options = {}) {
    const { leading = true, trailing = true } = options;
    let lastCall = 0;
    let timer = null;
    let lastArgs = null;
    let lastContext = null;

    const throttled = function (...args) {
        const now = Date.now();
        const context = this;

        if (!lastCall && !leading) {
            lastCall = now;
        }

        const remaining = ms - (now - lastCall);

        if (remaining <= 0) {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            lastCall = now;
            fn.apply(context, args);
        } else if (trailing && !timer) {
            lastArgs = args;
            lastContext = context;
            timer = setTimeout(() => {
                timer = null;
                lastCall = leading ? Date.now() : 0;
                fn.apply(lastContext, lastArgs);
                lastArgs = null;
                lastContext = null;
            }, remaining);
        }
    };

    throttled.cancel = () => {
        clearTimeout(timer);
        timer = null;
        lastCall = 0;
        lastArgs = null;
        lastContext = null;
    };

    throttled.flush = function (...args) {
        throttled.cancel();
        fn.apply(this, args);
    };

    return throttled;
}

/**
 * Animation frame throttling — use for smooth visual updates.
 * Ensures function runs at most once per frame.
 *
 *   on(window, 'scroll', rafThrottle(updateParallax));
 */
export function rafThrottle(fn) {
    let rafId = null;
    let lastArgs = null;
    let lastContext = null;

    function throttled(...args) {
        lastArgs = args;
        lastContext = this;

        if (rafId) return;

        rafId = requestAnimationFrame(() => {
            rafId = null;
            fn.apply(lastContext, lastArgs);
            lastArgs = null;
            lastContext = null;
        });
    }

    throttled.cancel = () => {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        lastArgs = null;
        lastContext = null;
    };

    return throttled;
}

/**
 * Once — ensures a function is called only once.
 * Renamed from once to runOnce to avoid naming conflict with DOM event once()
 *
 *   const init = onlyOnce(() => { ... });
 *   init(); // runs
 *   init(); // does nothing
 */
export function onlyOnce(fn) {
    let called = false;
    let result;

    return function (...args) {
        if (called) return result;
        called = true;
        result = fn.apply(this, args);
        return result;
    };
}