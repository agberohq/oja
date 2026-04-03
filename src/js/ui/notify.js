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
 *   // Dismiss a specific toast by id
 *   const id = notify.info('Loading...', { duration: 0 });
 *   await doWork();
 *   notify.dismiss(id);
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

import { listen, emit } from '../core/events.js';
import { Out }          from '../core/out.js';

let _container = null;
let _banner    = null;
let _position  = 'top-right';
let _idCounter = 0;
let _announcer = null;

const TYPES = {
    success : { cls: 'oja-toast-success', icon: '✓', role: 'status',  live: 'polite'   },
    error   : { cls: 'oja-toast-error',   icon: '✕', role: 'alert',   live: 'assertive' },
    warn    : { cls: 'oja-toast-warn',    icon: '⚠', role: 'alert',   live: 'assertive' },
    info    : { cls: 'oja-toast-info',    icon: 'ℹ', role: 'status',  live: 'polite'   },
};

// Runtime config (max stack, default duration override, etc.)
let _config = { max: 0 }; // max: 0 = unlimited

const DEFAULTS = {
    duration    : 4000,
    dismissible : true,
    action      : null,
    pauseOnHover: true,
    announce    : true,
};

export const notify = {

    success(message, options = {}) { return _show('success', message, options); },
    error(message, options = {})   { return _show('error',   message, { duration: 6000, ...options }); },
    warn(message, options = {})    { return _show('warn',    message, options); },
    info(message, options = {})    { return _show('info',    message, options); },

    /**
     * Show an Out as a toast — for rich content.
     *
     *   notify.show(Out.h('<strong>Deploy</strong> complete — 3 hosts'));
     */
    /**
     * Show an Out as a toast — for rich content.
     * Also accepts notify.show(message, type) legacy two-arg form (A-06 compat).
     *
     *   notify.show(Out.h('<strong>Deploy</strong> complete'));
     *   notify.show('Copied', 'success');   // legacy — still works
     */
    show(responder, optionsOrType = {}) {
        // A-06 backwards compat: notify.show('msg', 'success') old two-arg API
        if (typeof responder === 'string' && typeof optionsOrType === 'string') {
            const type = ['success','error','warn','info'].includes(optionsOrType)
                ? optionsOrType : 'info';
            return _show(type, responder, {});
        }
        const options = typeof optionsOrType === 'object' ? optionsOrType : {};
        if (!Out.is(responder)) return _show('info', String(responder), options);
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
     *
     *   notify.on('api:offline', () => notify.banner('Connection lost'));
     */
    on(eventName, handler) {
        return listen(eventName, handler);
    },

    // Banner

    /**
     * Show a persistent banner — one at a time, replaces previous.
     * The previous banner is fully removed before the new one is inserted
     * so there is never a window where two banners are visible simultaneously.
     *
     *   notify.banner('⚠️ Connection lost', { type: 'warn' });
     */
    banner(message, options = {}) {
        // Remove any existing banner synchronously before creating the new one.
        // The previous implementation started a 200ms fade-out and then created
        // the new banner immediately, leaving both visible during that window.
        if (_banner) {
            _banner.remove();
            _banner = null;
        }

        const type = options.type || 'warn';
        const meta = TYPES[type] || TYPES.warn;

        _banner = document.createElement('div');
        _banner.className = `oja-banner oja-banner-${type}`;
        _banner.setAttribute('role', meta.role);
        _banner.setAttribute('aria-live', meta.live);
        _banner.setAttribute('aria-atomic', 'true');

        if (options.id) _banner.id = options.id;

        const isOut = Out.is(message);

        _banner.innerHTML = `
            <span class="oja-banner-icon" aria-hidden="true">${meta.icon}</span>
            <span class="oja-banner-msg">${isOut ? '' : _esc(message)}</span>
            ${options.action
            ? `<button class="oja-banner-action">${_esc(options.action.label)}</button>`
            : ''}
            ${options.dismissible !== false
            ? `<button class="oja-banner-dismiss" aria-label="Dismiss">✕</button>`
            : ''}
        `;

        if (isOut) {
            const msgEl = _banner.querySelector('.oja-banner-msg');
            message.render(msgEl);
        }

        if (options.action) {
            _banner.querySelector('.oja-banner-action')?.addEventListener('click', (e) => {
                e.preventDefault();
                options.action.fn();
                if (options.action.autoDismiss !== false) notify.dismissBanner();
            });
        }

        _banner.querySelector('.oja-banner-dismiss')?.addEventListener('click', () => {
            notify.dismissBanner();
        });

        if (options.timeout) setTimeout(() => notify.dismissBanner(), options.timeout);

        document.body.insertBefore(_banner, document.body.firstChild);

        const announceText = isOut && message.getText ? (message.getText() || '') : String(message);
        if (options.announce !== false) _announce(announceText, meta.live);

        emit('notify:banner', { message: announceText, type, id: _banner.id });
        return this;
    },

    /**
     * Remove the current banner with a fade-out animation.
     */
    dismissBanner() {
        if (!_banner) return this;

        // Capture the reference before the timeout so a subsequent banner()
        // call that sets _banner = null doesn't prevent the element from being
        // removed if the timeout fires after the new banner has been created.
        const bannerEl = _banner;
        _banner = null;

        bannerEl.classList.add('oja-banner-leaving');
        setTimeout(() => bannerEl.remove(), 200);

        return this;
    },

    // Position

    /**
     * Set toast position. Takes effect immediately if container exists.
     * 'top-right' | 'top-left' | 'top-center' | 'bottom-right' | 'bottom-left' | 'bottom-center'
     */
    setPosition(position) {
        _position = position;
        if (_container) _container.className = `oja-toast-container oja-toast-${position}`;
        return this;
    },

    /**
     * Configure global notify behaviour.
     *
     *   notify.config({ max: 4 });          // show at most 4 toasts at once
     *   notify.config({ max: 0 });          // unlimited (default)
     */
    config(options = {}) {
        _config = { ..._config, ...options };
        return this;
    },

    // Dismiss

    /** Dismiss all visible toasts immediately. */
    dismissAll() {
        _container?.querySelectorAll('.oja-toast').forEach(_dismiss);
        return this;
    },

    /**
     * Update the content of an existing toast by its id.
     * Eliminates the dismiss+re-show flicker pattern.
     *
     *   const id = notify.info('Uploading…', { duration: 0 });
     *   // later:
     *   notify.update(id, 'Upload complete ✓', { type: 'success' });
     */
    update(id, message, options = {}) {
        if (!id || !_container) return this;
        const toast = _container.querySelector(`#${id}`);
        if (!toast) return this;

        const type = options.type || toast.dataset.toastType || 'info';
        const meta = TYPES[type] || TYPES.info;

        // Update text content
        const msgEl = toast.querySelector('.oja-toast-msg');
        if (msgEl) msgEl.textContent = message;

        // Update type class if changed
        const prevType = toast.dataset.toastType;
        if (prevType !== type) {
            if (prevType) toast.classList.remove(TYPES[prevType]?.cls || '');
            toast.classList.add(meta.cls);
            toast.dataset.toastType = type;
            toast.setAttribute('role', meta.role);
        }

        // Reset or extend duration if provided
        if (options.duration !== undefined && options.duration > 0) {
            if (toast._toastTimer) clearTimeout(toast._toastTimer);
            toast._toastTimer = setTimeout(() => _dismiss(toast), options.duration);
        }

        return this;
    },

    // Dismiss a specific toast by the id returned from success/error/warn/info.
    // Safe to call with a stale id — does nothing if the toast is already gone.
    dismiss(id) {
        if (!id || !_container) return this;
        const toast = _container.querySelector(`#${id}`);
        if (toast) _dismiss(toast);
        return this;
    },

    /**
     * Auto-manage a toast through pending → success → error states.
     * Returns the original promise so callers can still await/chain it.
     *
     *   await notify.promise(api.post('/deploy'), {
     *       pending: 'Deploying…',
     *       success: 'Deployed ✓',
     *       error:   'Deploy failed',
     *   });
     *
     *   // Dynamic messages:
     *   notify.promise(fetchUser(id), {
     *       pending: 'Loading…',
     *       success: (user) => `Welcome, ${user.name}`,
     *       error:   (err)  => `Failed: ${err.message}`,
     *   });
     */
    promise(promise, messages = {}) {
        const pendingMsg = messages.pending || 'Loading…';
        const id = _show('info', pendingMsg, { duration: 0 });

        promise.then(
            (result) => {
                const msg = typeof messages.success === 'function'
                    ? messages.success(result) : (messages.success || '✓');
                this.update(id, msg, { type: 'success', duration: 4000 });
            },
            (err) => {
                const msg = typeof messages.error === 'function'
                    ? messages.error(err) : (messages.error || '✗ Failed');
                this.update(id, msg, { type: 'error', duration: 6000 });
            }
        );

        return promise;
    },

    /**
     * Show a progress toast with an updatable percentage.
     * Returns a handle with .update(pct) and .done(message).
     *
     *   const p = notify.progress('Uploading…');
     *   p.update(60);     // "Uploading… 60%"
     *   p.done('Done ✓'); // replaces toast content, auto-dismisses
     */
    progress(message, options = {}) {
        const id = _show('info', message, { duration: 0 });
        let _pct = 0;

        return {
            id,
            update(pct) {
                _pct = Math.max(0, Math.min(100, Math.round(pct)));
                notify.update(id, `${message} ${_pct}%`);
                return this;
            },
            done(doneMessage = '✓') {
                notify.update(id, doneMessage, { type: 'success', duration: 4000 });
                return this;
            },
            fail(failMessage = '✗ Failed') {
                notify.update(id, failMessage, { type: 'error', duration: 6000 });
                return this;
            },
            dismiss() {
                notify.dismiss(id);
                return this;
            },
        };
    },

    /** Get the current toast count. */
    count() {
        return _container?.querySelectorAll('.oja-toast:not(.oja-toast-leaving)').length || 0;
    },

    // Accessibility

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
     */
    announce(message, assertive = false) {
        _announce(message, assertive ? 'assertive' : 'polite');
        return this;
    },
};

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
    toast.dataset.toastType = type;

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
        toast.querySelector('.oja-toast-action')?.addEventListener('click', () => {
            opts.action.fn();
            if (opts.action.autoDismiss !== false) _dismiss(toast);
        });
    }

    if (opts.dismissible) {
        toast.querySelector('.oja-toast-close')?.addEventListener('click', () => _dismiss(toast));
    }

    // Enforce max stack limit — dismiss oldest if over cap
    if (_config.max > 0) {
        const current = _container.querySelectorAll('.oja-toast:not(.oja-toast-leaving)');
        if (current.length >= _config.max) _dismiss(current[0]);
    }
    _container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('oja-toast-visible'));

    if (opts.announce) _announce(message, meta.live);

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

    const opts = { ...DEFAULTS, ...options };
    const id   = `oja-toast-${++_idCounter}`;

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

    requestAnimationFrame(() => toast.classList.add('oja-toast-visible'));

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

    const container = toast.parentNode;
    toast.classList.add('oja-toast-leaving');
    toast.classList.remove('oja-toast-visible');

    setTimeout(() => {
        if (container && container.contains(toast)) toast.remove();
        else if (toast.parentNode) toast.remove();
        emit('notify:dismissed', { id: toast.id });
    }, 300);
}

function _pauseToast(toast) {
    if (toast._timeout) {
        const elapsed    = Date.now() - (toast._startedAt || 0);
        toast._remaining = Math.max(0, (toast._duration || 0) - elapsed);
        clearTimeout(toast._timeout);
        toast._timeout = null;
    }
}

function _resumeToast(toast, defaultDuration) {
    if (toast._remaining) {
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
        Object.assign(el.style, {
            position: 'absolute', width: '1px', height: '1px',
            padding: '0', margin: '-1px', overflow: 'hidden',
            clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: '0',
        });
        document.body.appendChild(el);
        return el;
    })();
}

function _announce(message, priority = 'polite') {
    if (!_announcer) return;
    _announcer.setAttribute('aria-live', priority);
    _announcer.textContent = '';
    setTimeout(() => { _announcer.textContent = message; }, 50);
    setTimeout(() => {
        if (_announcer.textContent === message) _announcer.textContent = '';
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

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _ensureAnnouncer);
    } else {
        _ensureAnnouncer();
    }
}
