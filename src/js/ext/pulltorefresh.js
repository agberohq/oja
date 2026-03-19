/**
 * oja/pulltorefresh.js
 * Pull to refresh for mobile and desktop — like native mobile apps.
 * Works with any scrollable container or the whole page.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { pullToRefresh } from '../oja/pulltorefresh.js';
 *   import { Responder } from '../oja/responder.js';
 *
 *   // Pull to refresh on entire page
 *   pullToRefresh.init({
 *       onRefresh: async () => {
 *           await refreshData();
 *           notify.success('Data refreshed');
 *       }
 *   });
 *
 *   // On specific container
 *   pullToRefresh.init('#chat-list', {
 *       onRefresh: () => loadMoreMessages(),
 *       maxPull: 150,
 *       refreshThreshold: 80,
 *       spinner: Responder.svg('<svg class="custom-spinner">...</svg>'),
 *       pullMessage: 'Pull down',
 *       releaseMessage: 'Release to refresh',
 *       loadingMessage: 'Refreshing...',
 *   });
 *
 *   // With different spinners for each state
 *   pullToRefresh.init('#feed', {
 *       onRefresh: refreshFeed,
 *       spinner: {
 *           pulling: Responder.svg(pullingSpinner),
 *           releasing: Responder.svg(releasingSpinner),
 *           loading: Responder.svg(loadingSpinner),
 *       }
 *   });
 */

import { Out } from '../core/out.js';

// ─── State ────────────────────────────────────────────────────────────────────

const _instances = new WeakMap(); // container -> instance data

const DEFAULTS = {
    maxPull: 150,
    refreshThreshold: 80,
    spinner: true, // true = default spinner, false = none, or Responder instance
    instructions: 'Pull to refresh',
    pullMessage: 'Pull down to refresh',
    releaseMessage: 'Release to refresh',
    loadingMessage: 'Refreshing...',
    onRefresh: null,
    onPull: null,
    onRelease: null,
    disabled: false,
};

// Default spinner Responder
const DEFAULT_SPINNER = Out.svg(`
    <svg class="oja-ptr-spinner-svg" viewBox="0 0 24 24" width="24" height="24">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" 
                stroke-width="2" stroke-dasharray="32" stroke-dashoffset="32">
            <animate attributeName="stroke-dashoffset" dur="1s" values="32;0" 
                     repeatCount="indefinite"/>
        </circle>
    </svg>
`);

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Initialize pull-to-refresh on a container or the whole page
 */
export function init(target, options = {}) {
    const container = !target || target === 'window'
        ? window
        : (typeof target === 'string' ? document.querySelector(target) : target);

    if (!container) {
        console.warn(`[oja/pulltorefresh] target not found: ${target}`);
        return;
    }

    const opts = { ...DEFAULTS, ...options };

    // Normalize spinner config
    if (opts.spinner === true) {
        opts.spinner = DEFAULT_SPINNER;
    } else if (typeof opts.spinner === 'string') {
        opts.spinner = Out.svg(opts.spinner);
    } else if (opts.spinner && typeof opts.spinner === 'object' && !Out.is(opts.spinner)) {
        // Handle state-specific spinners
        const spinners = opts.spinner;
        opts.spinner = {
            pulling: spinners.pulling ? (Out.is(spinners.pulling) ? spinners.pulling : Out.svg(spinners.pulling)) : DEFAULT_SPINNER,
            releasing: spinners.releasing ? (Out.is(spinners.releasing) ? spinners.releasing : Out.svg(spinners.releasing)) : DEFAULT_SPINNER,
            loading: spinners.loading ? (Out.is(spinners.loading) ? spinners.loading : Out.svg(spinners.loading)) : DEFAULT_SPINNER,
        };
    }

    const state = {
        opts,
        pulling: false,
        refreshing: false,
        startY: 0,
        currentY: 0,
        pullDistance: 0,
        spinnerContainer: null,
        messageEl: null,
        touchStartHandler: null,
        touchMoveHandler: null,
        touchEndHandler: null,
        scrollHandler: null,
    };

    // Create UI elements
    if (container === window) {
        _setupWindowPull(state, opts);
    } else {
        _setupContainerPull(container, state, opts);
    }

    _instances.set(container, state);

    return {
        disable: () => _disable(container),
        enable: () => _enable(container),
        refresh: () => _triggerRefresh(container),
        destroy: () => _destroy(container),
    };
}

function _setupWindowPull(state, opts) {
    const wrapper = document.createElement('div');
    wrapper.className = 'oja-ptr-wrapper';
    wrapper.style.position = 'fixed';
    wrapper.style.top = '0';
    wrapper.style.left = '0';
    wrapper.style.right = '0';
    wrapper.style.height = '0';
    wrapper.style.overflow = 'visible';
    wrapper.style.zIndex = '9999';
    wrapper.style.pointerEvents = 'none';

    const content = document.createElement('div');
    content.className = 'oja-ptr-content';
    content.style.position = 'absolute';
    content.style.top = '0';
    content.style.left = '0';
    content.style.right = '0';
    content.style.display = 'flex';
    content.style.justifyContent = 'center';
    content.style.alignItems = 'center';
    content.style.transform = 'translateY(-100%)';

    // Spinner container
    const spinnerContainer = document.createElement('div');
    spinnerContainer.className = 'oja-ptr-spinner-container';
    spinnerContainer.style.marginRight = '8px';
    spinnerContainer.style.display = 'flex';
    spinnerContainer.style.alignItems = 'center';
    content.appendChild(spinnerContainer);

    const message = document.createElement('div');
    message.className = 'oja-ptr-message';
    message.textContent = opts.instructions;
    content.appendChild(message);

    wrapper.appendChild(content);
    document.body.appendChild(wrapper);

    state.spinnerContainer = spinnerContainer;
    state.messageEl = message;
    state.wrapperEl = wrapper;
    state.contentEl = content;

    // Render initial spinner
    _renderSpinner(state, 'pulling');

    state.touchStartHandler = (e) => _onTouchStart(e, state, opts, container);
    state.touchMoveHandler = (e) => _onTouchMove(e, state, opts, container);
    state.touchEndHandler = (e) => _onTouchEnd(e, state, opts, container);
    state.scrollHandler = () => _onScroll(state, opts, container);

    document.addEventListener('touchstart', state.touchStartHandler, { passive: false });
    document.addEventListener('touchmove', state.touchMoveHandler, { passive: false });
    document.addEventListener('touchend', state.touchEndHandler);
    window.addEventListener('scroll', state.scrollHandler);
}

function _setupContainerPull(container, state, opts) {
    if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
    }

    const content = document.createElement('div');
    content.className = 'oja-ptr-container-content';
    content.style.position = 'absolute';
    content.style.top = '0';
    content.style.left = '0';
    content.style.right = '0';
    content.style.display = 'flex';
    content.style.justifyContent = 'center';
    content.style.alignItems = 'center';
    content.style.transform = 'translateY(-100%)';
    content.style.pointerEvents = 'none';
    content.style.zIndex = '1';

    const spinnerContainer = document.createElement('div');
    spinnerContainer.className = 'oja-ptr-spinner-container';
    spinnerContainer.style.marginRight = '8px';
    spinnerContainer.style.display = 'flex';
    spinnerContainer.style.alignItems = 'center';
    content.appendChild(spinnerContainer);

    const message = document.createElement('div');
    message.className = 'oja-ptr-message';
    message.textContent = opts.instructions;
    content.appendChild(message);

    container.insertBefore(content, container.firstChild);

    state.spinnerContainer = spinnerContainer;
    state.messageEl = message;
    state.contentEl = content;

    _renderSpinner(state, 'pulling');

    state.touchStartHandler = (e) => _onTouchStart(e, state, opts, container);
    state.touchMoveHandler = (e) => _onTouchMove(e, state, opts, container);
    state.touchEndHandler = (e) => _onTouchEnd(e, state, opts, container);
    state.scrollHandler = () => _onScroll(state, opts, container);

    container.addEventListener('touchstart', state.touchStartHandler, { passive: false });
    container.addEventListener('touchmove', state.touchMoveHandler, { passive: false });
    container.addEventListener('touchend', state.touchEndHandler);
    container.addEventListener('scroll', state.scrollHandler);
}

function _renderSpinner(state, phase = 'pulling') {
    if (!state.spinnerContainer) return;

    const { opts } = state;

    // Clear container
    state.spinnerContainer.innerHTML = '';

    // Determine which spinner to show
    let spinner = null;

    if (opts.spinner === false) {
        return; // No spinner
    } else if (Out.is(opts.spinner)) {
        spinner = opts.spinner;
    } else if (opts.spinner && typeof opts.spinner === 'object') {
        // Phase-specific spinner
        spinner = opts.spinner[phase] || opts.spinner.pulling || DEFAULT_SPINNER;
    } else {
        spinner = DEFAULT_SPINNER;
    }

    if (spinner) {
        // Create container for responder
        const container = document.createElement('div');
        container.className = `oja-ptr-spinner oja-ptr-spinner-${phase}`;
        state.spinnerContainer.appendChild(container);

        // Render spinner responder
        spinner.render(container, { phase });
    }
}

function _onTouchStart(e, state, opts, container) {
    if (state.refreshing || opts.disabled) return;

    const scrollTop = container === window
        ? window.scrollY
        : container.scrollTop;

    if (scrollTop > 0) return;

    state.pulling = true;
    state.startY = e.touches[0].clientY;
    state.contentEl.style.transition = 'none';
}

function _onTouchMove(e, state, opts, container) {
    if (!state.pulling || state.refreshing || opts.disabled) return;

    const currentY = e.touches[0].clientY;
    const diff = currentY - state.startY;

    if (diff < 0) {
        state.pulling = false;
        return;
    }

    e.preventDefault();

    state.currentY = currentY;
    state.pullDistance = Math.min(diff * 0.5, opts.maxPull);

    const translateY = -state.contentEl.offsetHeight + state.pullDistance;
    state.contentEl.style.transform = `translateY(${translateY}px)`;

    // Update spinner and message based on pull distance
    if (state.pullDistance >= opts.refreshThreshold) {
        state.messageEl.textContent = opts.releaseMessage;
        _renderSpinner(state, 'releasing');
    } else {
        state.messageEl.textContent = opts.pullMessage;
        _renderSpinner(state, 'pulling');
    }

    if (opts.onPull) opts.onPull(state.pullDistance);
}

function _onTouchEnd(e, state, opts, container) {
    if (!state.pulling || state.refreshing || opts.disabled) return;

    state.pulling = false;

    if (state.pullDistance >= opts.refreshThreshold) {
        _triggerRefresh(container);
    } else {
        _reset(state);
    }
}

function _onScroll(state, opts, container) {
    if (state.refreshing || opts.disabled) return;

    const scrollTop = container === window
        ? window.scrollY
        : container.scrollTop;

    if (scrollTop > 0) {
        _reset(state);
    }
}

async function _triggerRefresh(container) {
    const state = _instances.get(container);
    if (!state || state.refreshing) return;

    state.refreshing = true;
    state.messageEl.textContent = state.opts.loadingMessage;
    _renderSpinner(state, 'loading');

    state.contentEl.style.transition = 'transform 0.3s ease';
    state.contentEl.style.transform = `translateY(0px)`;

    if (state.opts.onRelease) state.opts.onRelease();

    try {
        if (state.opts.onRefresh) {
            await state.opts.onRefresh();
        }
    } finally {
        setTimeout(() => {
            _reset(state);
            state.refreshing = false;
        }, 500);
    }
}

function _reset(state) {
    if (!state.contentEl) return;

    state.contentEl.style.transition = 'transform 0.3s ease';
    state.contentEl.style.transform = `translateY(-${state.contentEl.offsetHeight}px)`;
    state.messageEl.textContent = state.opts.instructions;
    _renderSpinner(state, 'pulling');

    state.pullDistance = 0;
}

function _disable(container) {
    const state = _instances.get(container);
    if (state) state.opts.disabled = true;
}

function _enable(container) {
    const state = _instances.get(container);
    if (state) state.opts.disabled = false;
}

function _destroy(container) {
    const state = _instances.get(container);
    if (!state) return;

    if (container === window) {
        document.removeEventListener('touchstart', state.touchStartHandler);
        document.removeEventListener('touchmove', state.touchMoveHandler);
        document.removeEventListener('touchend', state.touchEndHandler);
        window.removeEventListener('scroll', state.scrollHandler);
        state.wrapperEl?.remove();
    } else {
        container.removeEventListener('touchstart', state.touchStartHandler);
        container.removeEventListener('touchmove', state.touchMoveHandler);
        container.removeEventListener('touchend', state.touchEndHandler);
        container.removeEventListener('scroll', state.scrollHandler);
        state.contentEl?.remove();
    }

    _instances.delete(container);
}

export const pullToRefresh = { init };