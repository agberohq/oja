/**
 * oja/infinitescroll.js
 * Infinite scroll / endless pagination — load more as user scrolls.
 * Uses IntersectionObserver for efficient detection.
 *
 * ─── Basic usage ─────────────────────────────────────────────────────────────
 *
 *   import { infiniteScroll } from '../oja/infinitescroll.js';
 *   import { Responder } from '../oja/responder.js';
 *
 *   // Load more when approaching bottom
 *   infiniteScroll.init('#feed', {
 *       onLoadMore: async () => {
 *           const items = await loadNextPage();
 *           return items.length > 0; // Return false when no more
 *       },
 *       threshold: 200, // Load when 200px from bottom
 *   });
 *
 * ─── With Responder indicators ────────────────────────────────────────────────
 *
 *   infiniteScroll.init('#comments', {
 *       onLoadMore: loadMoreComments,
 *       loading: Responder.component('components/spinner.html'),
 *       noMore: Responder.html('<p class="end">No more comments</p>'),
 *       error: Responder.html('<p class="error">Failed to load</p>'),
 *   });
 *
 * ─── Manual control ───────────────────────────────────────────────────────────
 *
 *   const scroller = infiniteScroll.init('#list', {
 *       onLoadMore: loadPage,
 *   });
 *
 *   scroller.loadMore(); // Manually trigger load
 *   scroller.disable();  // Stop listening
 *   scroller.enable();   // Re-enable
 *   scroller.destroy();  // Clean up
 */

import { Out } from '../core/out.js';


const _scrollInstances = new WeakMap(); // container -> instance data

const DEFAULTS = {
    threshold: 200,
    loading: null,      // Responder instance
    noMore: null,       // Responder instance
    error: null,        // Responder instance
    onLoadMore: null,
    onError: null,
    disabled: false,
    immediate: false,   // Load immediately if content is short
    rootMargin: '0px',
    scrollContainer: null, // Custom scroll container (default: window)
};

// Default loading responder
const DEFAULT_LOADING = Out.html(`
    <div class="oja-infinite-loading">
        <svg class="oja-spinner" viewBox="0 0 24 24" width="24" height="24">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" 
                    stroke-width="2" stroke-dasharray="32" stroke-dashoffset="32">
                <animate attributeName="stroke-dashoffset" dur="1s" values="32;0" 
                         repeatCount="indefinite"/>
            </circle>
        </svg>
        <span>Loading more...</span>
    </div>
`);


/**
 * Initialize infinite scroll on a container
 */
export function init(target, options = {}) {
    const contentContainer = typeof target === 'string'
        ? document.querySelector(target)
        : target;

    if (!contentContainer) {
        console.warn(`[oja/infinitescroll] target not found: ${target}`);
        return;
    }

    const opts = { ...DEFAULTS, ...options };

    // Normalize responders
    if (opts.loading === true) opts.loading = DEFAULT_LOADING;
    if (opts.loading && typeof opts.loading === 'string') {
        opts.loading = Out.html(opts.loading);
    }
    if (opts.noMore && typeof opts.noMore === 'string') {
        opts.noMore = Out.html(opts.noMore);
    }
    if (opts.error && typeof opts.error === 'string') {
        opts.error = Out.html(opts.error);
    }

    const scrollContainer = opts.scrollContainer
        ? (typeof opts.scrollContainer === 'string'
            ? document.querySelector(opts.scrollContainer)
            : opts.scrollContainer)
        : window;

    // Create sentinel element
    const sentinel = document.createElement('div');
    sentinel.className = 'oja-infinite-sentinel';
    sentinel.style.width = '1px';
    sentinel.style.height = '1px';
    sentinel.style.opacity = '0';
    sentinel.style.pointerEvents = 'none';
    contentContainer.appendChild(sentinel);

    // Create status container for indicators
    const statusEl = document.createElement('div');
    statusEl.className = 'oja-infinite-status';
    contentContainer.appendChild(statusEl);

    const state = {
        opts,
        sentinel,
        statusEl,
        contentContainer,
        scrollContainer,
        loading: false,
        hasMore: true,
        error: null,
        observer: null,
        sentinelVisible: false,
    };

    // Setup intersection observer
    const observer = new IntersectionObserver(
        (entries) => _onIntersect(entries, state),
        {
            root: scrollContainer === window ? null : scrollContainer,
            rootMargin: opts.rootMargin,
            threshold: 0,
        }
    );

    observer.observe(sentinel);
    state.observer = observer;

    // Add scroll listener as fallback
    const scrollHandler = () => _onScroll(state);
    if (scrollContainer === window) {
        window.addEventListener('scroll', scrollHandler, { passive: true });
    } else {
        scrollContainer.addEventListener('scroll', scrollHandler, { passive: true });
    }
    state.scrollHandler = scrollHandler;

    // Check immediate
    if (opts.immediate) {
        setTimeout(() => _checkAndLoad(state), 100);
    }

    _scrollInstances.set(contentContainer, state);

    return {
        loadMore: () => _loadMore(state),
        disable: () => _disable(contentContainer),
        enable: () => _enable(contentContainer),
        reset: () => _reset(contentContainer),
        destroy: () => _destroy(contentContainer),
    };
}

function _onIntersect(entries, state) {
    const entry = entries[0];
    state.sentinelVisible = entry.isIntersecting;

    if (entry.isIntersecting && !state.loading && state.hasMore && !state.disabled) {
        _loadMore(state);
    }
}

function _onScroll(state) {
    if (!state.sentinelVisible && !state.loading && state.hasMore && !state.disabled) {
        // Check if we're close to bottom as fallback
        const container = state.scrollContainer;
        const scrollPos = container === window
            ? window.scrollY + window.innerHeight
            : container.scrollTop + container.clientHeight;

        const totalHeight = container === window
            ? document.documentElement.scrollHeight
            : container.scrollHeight;

        if (totalHeight - scrollPos < state.opts.threshold) {
            _loadMore(state);
        }
    }
}

async function _loadMore(state) {
    if (state.loading || !state.hasMore || state.disabled) return;

    state.loading = true;
    state.error = null;

    // Show loading indicator
    if (state.opts.loading) {
        state.statusEl.innerHTML = '';
        const loadingContainer = document.createElement('div');
        loadingContainer.className = 'oja-infinite-loading-container';
        state.statusEl.appendChild(loadingContainer);
        await state.opts.loading.render(loadingContainer);
    }

    try {
        const hasMore = await state.opts.onLoadMore();

        if (hasMore === false) {
            state.hasMore = false;

            // Show no more indicator
            if (state.opts.noMore) {
                state.statusEl.innerHTML = '';
                const noMoreContainer = document.createElement('div');
                noMoreContainer.className = 'oja-infinite-nomore-container';
                state.statusEl.appendChild(noMoreContainer);
                await state.opts.noMore.render(noMoreContainer);
            } else {
                state.statusEl.innerHTML = '';
            }
        } else {
            // Clear status on successful load if more items exist
            if (!state.opts.loading) {
                state.statusEl.innerHTML = '';
            }
        }
    } catch (err) {
        state.error = err;

        // Show error indicator
        if (state.opts.error) {
            state.statusEl.innerHTML = '';
            const errorContainer = document.createElement('div');
            errorContainer.className = 'oja-infinite-error-container';
            state.statusEl.appendChild(errorContainer);
            await state.opts.error.render(errorContainer, { error: err.message });
        }

        if (state.opts.onError) {
            state.opts.onError(err);
        }

        // Retry after delay
        setTimeout(() => {
            state.loading = false;
            _loadMore(state);
        }, 3000);
    } finally {
        if (!state.error) {
            state.loading = false;
        }
    }
}

function _checkAndLoad(state) {
    if (state.sentinelVisible && !state.loading && state.hasMore && !state.disabled) {
        _loadMore(state);
    }
}

function _disable(container) {
    const state = _scrollInstances.get(container);
    if (state) state.disabled = true;
}

function _enable(container) {
    const state = _scrollInstances.get(container);
    if (state) {
        state.disabled = false;
        _checkAndLoad(state);
    }
}

function _reset(container) {
    const state = _scrollInstances.get(container);
    if (state) {
        state.hasMore = true;
        state.loading = false;
        state.error = null;
        state.statusEl.innerHTML = '';
    }
}

function _destroy(container) {
    const state = _scrollInstances.get(container);
    if (!state) return;

    if (state.observer) {
        state.observer.disconnect();
    }

    if (state.scrollHandler) {
        if (state.scrollContainer === window) {
            window.removeEventListener('scroll', state.scrollHandler);
        } else {
            state.scrollContainer.removeEventListener('scroll', state.scrollHandler);
        }
    }

    state.sentinel?.remove();
    state.statusEl?.remove();
    _scrollInstances.delete(container);
}

export const infiniteScroll = { init };