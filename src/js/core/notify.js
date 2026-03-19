/**
 * oja/notify.js
 * Toast notifications and persistent banners.
 * Zero markup required — Oja injects and manages its own container.
 * App styles via .oja-toast-* and .oja-banner-* CSS classes.
 *
 * ─── Toasts ───────────────────────────────────────────────────────────────────
 *
 *   import { notify } from '../oja/notify.js';
 *
 *   notify.success('Host added successfully');
 *   notify.error('Connection failed');
 *   notify.warn('Session expires in 5 minutes');
 *   notify.info('3 hosts updated');
 *
 *   // With options
 *   notify.success('Deployed', { duration: 5000, dismissible: true });
 *
 *   // With action button
 *   notify.error('Deploy failed', {
 *       action: { label: 'View logs', fn: () => router.navigate('/logs') }
 *   });
 *
 *   // With Out (rich content)
 *   notify.show(Out.h('<strong>3 hosts</strong> updated'));
 *
 * ─── Banners (persistent) ────────────────────────────────────────────────────
 *
 *   notify.banner('⚠️ Connection lost. Reconnecting...', { type: 'warn' });
 *   notify.dismissBanner();
 *
 * ─── Conditional and event-driven ────────────────────────────────────────────
 *
 *   notify.if(condition, 'Message shown only when condition is true');
 *   notify.on('api:offline',  () => notify.banner('Connection lost', { type: 'warn' }));
 *   notify.on('api:online',   () => { notify.dismissBanner(); notify.success('Reconnected'); });
 *
 * ─── Session lifecycle integration ───────────────────────────────────────────
 *
 *   notify.on('auth:expiring', ({ ms }) =>
 *       notify.warn(`Session expires in ${Math.round(ms/60000)}m`, {
 *           action: { label: 'Renew', fn: () => auth.session.renew() }
 *       })
 *   );
 *
 * ─── Position ─────────────────────────────────────────────────────────────────
 *
 *   notify.setPosition('top-right');     // default
 *   notify.setPosition('top-left');
 *   notify.setPosition('top-center');
 *   notify.setPosition('bottom-right');
 *   notify.setPosition('bottom-left');
 *   notify.setPosition('bottom-center');
 */

import { listen, emit } from './events.js';
import { Out }          from './out.js';

// ─── State ────────────────────────────────────────────────────────────────────

let _container  = null;
let _banner     = null;
let _position   = 'top-right';
let _idCounter  = 0;
let _announcer  = null;

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPES = {
    success : { cls: 'oja-toast-success', icon: '✓', role: 'status', live: 'polite' },
    error   : { cls: 'oja-toast-error',   icon: '✕', role: 'alert',  live: 'assertive' },
    warn    : { cls: 'oja-toast-warn',    icon: '⚠', role: 'alert',  live: 'assertive' },
    info    : { cls: 'oja-toast-info',    icon: 'ℹ', role: 'status', live: 'polite' },
};

const DEFAULTS = {
    duration    : 4000,
    dismissible : true,
    action      : null,
    pauseOnHover: true,
    announce    : true,
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const notify = {

    success(message, options = {}) {
        return _show('success', message, options);
    },

    error(message, options = {}) {
        return _show('error', message, { duration: 6000, ...options });
    },

    warn(message, options = {}) {
        return _show('warn', message, options);
    },

    info(message, options = {}) {
        return _show('info', message, options);
    },

    /**
     * Show an Out as a toast — for rich content.
     *
     *   notify.show(Out.h('<strong>Deploy</strong> complete — 3 hosts'));
     */
    show(responder, options = {}) {
        if (!Out.is(responder)) {
            return _show('info', String(responder), options);
        }
        return _showResponder(responder, options);
    },

    /**
     * Show only when condition is true.
     *
     *   notify.if(errors > 0, `${errors} errors found`);
     */
    if(condition, message, options = {}) {
        if (condition) _show('info', message, options);
        return this;
    },

    /**
     * Listen to a CustomEvent and run handler when it fires.
     * Thin wrapper over events.js listen() — kept here for discoverability.
     *
     *   notify.on('api:offline', () => notify.banner('Connection lost'));
     */
    on(eventName, handler) {
        return listen(eventName, handler);
    },

    // ─── Banner ───────────────────────────────────────────────────────────────

    /**
     * Show a persistent banner — one at a time, replaces previous.
     * Use for offline state, session warnings, system messages.
     * Inserts at the very top of <body> above all other content.
     *
     *   notify.banner('⚠️ Connection lost', { type: 'warn' });
     */
    banner(message, options = {}) {
        if (_banner) {
            _banner.classList.add('oja-banner-leaving');
            setTimeout(() => {
                _banner?.remove();
                _banner = null;
            }, 200);
        }

        const type = options.type || 'warn';
        const meta = TYPES[type] || TYPES.warn;

        _banner = document.createElement('div');
        _banner.className = `oja-banner oja-banner-${type}`;
        _banner.setAttribute('role', meta.role);
        _banner.setAttribute('aria-live', meta.live);
        _banner.setAttribute('aria-atomic', 'true');

        if (options.id) {
            _banner.id = options.id;
        }

        _banner.innerHTML = `
            <span class="oja-banner-icon" aria-hidden="true">${meta.icon}</span>
            <span class="oja-banner-msg">${_esc(message)}</span>
            ${options.action
            ? `<button class="oja-banner-action">${_esc(options.action.label)}</button>`
            : ''}
            ${options.dismissible !== false
            ? `<button class="oja-banner-dismiss" aria-label="Dismiss">✕</button>`
            : ''}
        `;

        if (options.action) {
            const actionBtn = _banner.querySelector('.oja-banner-action');
            actionBtn?.addEventListener('click', (e) => {
                e.preventDefault();
                options.action.fn();
                if (options.action.autoDismiss !== false) {
                    notify.dismissBanner();
                }
            });
        }

        const dismissBtn = _banner.querySelector('.oja-banner-dismiss');
        if (dismissBtn) {
            dismissBtn.addEventListener('click', () => notify.dismissBanner());
        }

        if (options.timeout) {
            setTimeout(() => notify.dismissBanner(), options.timeout);
        }

        document.body.insertBefore(_banner, document.body.firstChild);

        if (options.announce !== false) {
            _announce(message, meta.live);
        }

        emit('notify:banner', { message, type, id: _banner.id });
        return this;
    },

    /**
     * Remove the current banner with a fade-out animation.
     */
    dismissBanner() {
        if (_banner) {
            _banner.classList.add('oja-banner-leaving');
            setTimeout(() => {
                _banner?.remove();
                _banner = null;
            }, 200);
        }
        return this;
    },

    // ─── Position ─────────────────────────────────────────────────────────────

    /**
     * Set toast position. Takes effect immediately if container exists.
     * 'top-right' | 'top-left' | 'top-center' | 'bottom-right' | 'bottom-left' | 'bottom-center'
     *
     * Default: 'top-right'
     */
    setPosition(position) {
        _position = position;
        if (_container) {
            _container.className = `oja-toast-container oja-toast-${position}`;
        }
        return this;
    },

    // ─── Dismiss ──────────────────────────────────────────────────────────────

    /** Dismiss all visible toasts immediately */
    dismissAll() {
        _container?.querySelectorAll('.oja-toast').forEach(_dismiss);
        return this;
    },

    /**
     * Get the current toast count
     */
    count() {
        return _container?.querySelectorAll('.oja-toast:not(.oja-toast-leaving)').length || 0;
    },

    // ─── Accessibility ────────────────────────────────────────────────────────

    /**
     * Set the announcer element for screen reader announcements.
     * By default, Oja creates its own hidden announcer.
     */
    setAnnouncer(element) {
        _announcer = element;
        return this;
    },

    /**
     * Manually announce a message to screen readers.
     * Use for custom accessibility needs.
     */
    announce(message, assertive = false) {
        _announce(message, assertive ? 'assertive' : 'polite');
        return this;
    }
};

// ─── Core ─────────────────────────────────────────────────────────────────────

function _show(type, message, options = {}) {
    _ensureContainer();
    _ensureAnnouncer();

    const opts = { ...DEFAULTS, ...options };
    const meta = TYPES[type] || TYPES.info;
    const id   = `oja-toast-${++_idCounter}`;

    const toast = document.createElement('div');
    toast.id        = id;
    toast.className = `oja-toast ${meta.cls}`;
    toast.setAttribute('role', meta.role);
    toast.setAttribute('aria-live', meta.live);
    toast.setAttribute('aria-atomic', 'true');
    toast.setAttribute('aria-describedby', `${id}-msg`);

    if (opts.pauseOnHover) {
        toast.addEventListener('mouseenter', () => _pauseToast(toast));
        toast.addEventListener('mouseleave', () => _resumeToast(toast, opts.duration));
    }

    toast.innerHTML = `
        <span class="oja-toast-icon" aria-hidden="true">${meta.icon}</span>
        <span id="${id}-msg" class="oja-toast-msg">${_esc(message)}</span>
        ${opts.action
        ? `<button class="oja-toast-action" aria-label="${_esc(opts.action.label)}">${_esc(opts.action.label)}</button>`
        : ''}
        ${opts.dismissible
        ? `<button class="oja-toast-close" aria-label="Dismiss notification">✕</button>`
        : ''}
    `;

    if (opts.action) {
        const actionBtn = toast.querySelector('.oja-toast-action');
        actionBtn?.addEventListener('click', () => {
            opts.action.fn();
            if (opts.action.autoDismiss !== false) {
                _dismiss(toast);
            }
        });
    }

    if (opts.dismissible) {
        const closeBtn = toast.querySelector('.oja-toast-close');
        closeBtn?.addEventListener('click', () => _dismiss(toast));
    }

    _container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('oja-toast-visible');
    });

    if (opts.announce) {
        _announce(message, meta.live);
    }

    if (opts.duration > 0) {
        toast._duration  = opts.duration;
        toast._startedAt = Date.now();
        toast._timeout   = setTimeout(() => _dismiss(toast), opts.duration);
    }

    emit('notify:toast', { id, type, message, options: opts });
    return id;
}

async function _showResponder(responder, options = {}) {
    _ensureContainer();
    _ensureAnnouncer();

    const opts  = { ...DEFAULTS, ...options };
    const id    = `oja-toast-${++_idCounter}`;

    const toast = document.createElement('div');
    toast.id        = id;
    toast.className = `oja-toast oja-toast-custom`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-atomic', 'true');

    const body = document.createElement('span');
    body.className = 'oja-toast-msg';
    body.id = `${id}-msg`;
    toast.appendChild(body);

    if (opts.dismissible) {
        const btn = document.createElement('button');
        btn.className = 'oja-toast-close';
        btn.setAttribute('aria-label', 'Dismiss notification');
        btn.textContent = '✕';
        btn.addEventListener('click', () => _dismiss(toast));
        toast.appendChild(btn);
    }

    if (opts.pauseOnHover) {
        toast.addEventListener('mouseenter', () => _pauseToast(toast));
        toast.addEventListener('mouseleave', () => _resumeToast(toast, opts.duration));
    }

    _container.appendChild(toast);

    await responder.render(body);

    requestAnimationFrame(() => {
        toast.classList.add('oja-toast-visible');
    });

    if (opts.announce && responder.getText) {
        const text = responder.getText();
        if (text) _announce(text);
    }

    if (opts.duration > 0) {
        toast._duration  = opts.duration;
        toast._startedAt = Date.now();
        toast._timeout   = setTimeout(() => _dismiss(toast), opts.duration);
    }

    return id;
}

function _dismiss(toast) {
    if (!toast || toast.classList.contains('oja-toast-leaving')) return;

    if (toast._timeout) {
        clearTimeout(toast._timeout);
        toast._timeout = null;
    }

    toast.classList.add('oja-toast-leaving');
    toast.classList.remove('oja-toast-visible');

    setTimeout(() => {
        if (toast.parentNode) {
            toast.remove();
        }
        emit('notify:dismissed', { id: toast.id });
    }, 300);
}

function _pauseToast(toast) {
    if (toast._timeout) {
        // _idleTimeout is a non-standard V8 internal — it returns undefined in
        // Firefox and Safari, producing NaN delays on resume. Instead we compute
        // remaining time from the wall-clock elapsed since the timer started.
        const elapsed    = Date.now() - (toast._startedAt || 0);
        toast._remaining = Math.max(0, (toast._duration || 0) - elapsed);
        clearTimeout(toast._timeout);
        toast._timeout = null;
    }
}

function _resumeToast(toast, defaultDuration) {
    if (toast._remaining) {
        // Reset _startedAt so a subsequent pause computes correctly from now
        toast._duration  = toast._remaining;
        toast._startedAt = Date.now();
        toast._timeout   = setTimeout(() => _dismiss(toast), toast._remaining);
        toast._remaining = null;
    } else if (!toast._timeout && defaultDuration > 0) {
        toast._duration  = defaultDuration;
        toast._startedAt = Date.now();
        toast._timeout   = setTimeout(() => _dismiss(toast), defaultDuration);
    }
}

function _ensureContainer() {
    if (_container && document.body.contains(_container)) return;

    _container = document.createElement('div');
    _container.className = `oja-toast-container oja-toast-${_position}`;
    _container.setAttribute('aria-live', 'polite');
    _container.setAttribute('aria-atomic', 'false');
    _container.setAttribute('role', 'region');
    _container.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(_container);
}

function _ensureAnnouncer() {
    if (_announcer && document.body.contains(_announcer)) return;

    _announcer = document.getElementById('oja-announcer') || (() => {
        const el = document.createElement('div');
        el.id = 'oja-announcer';
        el.setAttribute('aria-live', 'polite');
        el.setAttribute('aria-atomic', 'true');
        el.setAttribute('role', 'status');
        el.style.position = 'absolute';
        el.style.width = '1px';
        el.style.height = '1px';
        el.style.padding = '0';
        el.style.margin = '-1px';
        el.style.overflow = 'hidden';
        el.style.clip = 'rect(0, 0, 0, 0)';
        el.style.whiteSpace = 'nowrap';
        el.style.border = '0';
        document.body.appendChild(el);
        return el;
    })();
}

function _announce(message, priority = 'polite') {
    if (!_announcer) return;

    _announcer.setAttribute('aria-live', priority);
    _announcer.textContent = '';

    setTimeout(() => {
        _announcer.textContent = message;
    }, 50);

    setTimeout(() => {
        if (_announcer.textContent === message) {
            _announcer.textContent = '';
        }
    }, 3000);
}

function _esc(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ─── Auto-initialize announcer on DOM ready ──────────────────────────────────

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            _ensureAnnouncer();
        });
    } else {
        _ensureAnnouncer();
    }
}