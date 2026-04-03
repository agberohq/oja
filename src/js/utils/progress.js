/**
 * oja/progress.js
 * Direction-aware progress primitive with milestone hooks, color slices,
 * reverse animation, and optional binding to Api and Uploader instances.
 *
 * Lives in utils/ because it is a coordination primitive — not a UI widget.
 * It manages state and fires hooks; the visual rendering is handled by a
 * slim bar injected into the DOM (top-of-page by default) or attached inline.
 *
 * ─── Named channels ───────────────────────────────────────────────────────────
 *
 *   import { progress } from './utils/progress.js';
 *
 *   progress('upload').set(60);
 *   progress('api').start();
 *   progress().set(40);          // default channel
 *
 * ─── Core API ─────────────────────────────────────────────────────────────────
 *
 *   const p = progress('upload');
 *
 *   p.start()          — indeterminate mode (pulsing bar)
 *   p.set(60)          — jump to 60 % (animates forward or backward)
 *   p.inc(10)          — increment by 10 (clamped to 99 — use done() for 100)
 *   p.reverse(30)      — animate backward to 30 (e.g. re-upload from checkpoint)
 *   p.done()           — fill to 100 then fade out
 *   p.fail()           — go red then fade out
 *   p.reset()          — return to 0 immediately, no animation
 *   p.value            — current numeric value
 *   p.state            — 'idle' | 'running' | 'reversed' | 'done' | 'failed'
 *
 * ─── Color slices ─────────────────────────────────────────────────────────────
 *
 *   p.color([
 *       { at: 0,   color: '#3b82f6' },   // blue   — start
 *       { at: 50,  color: '#f59e0b' },   // amber  — halfway
 *       { at: 100, color: '#10b981' },   // green  — done
 *   ]);
 *
 *   // Interpolate smoothly between slices (default: true)
 *   p.color(slices, { interpolate: true });
 *
 *   // Snap to nearest defined milestone color
 *   p.color(slices, { interpolate: false });
 *
 * ─── Hooks ────────────────────────────────────────────────────────────────────
 *
 *   // Fire at a specific value
 *   p.on(50, () => notify.info('Halfway'));
 *
 *   // Direction-aware
 *   p.on(50, handler, { direction: 'up' });    // only when crossing 50 upward
 *   p.on(50, handler, { direction: 'down' });  // only when crossing 50 downward
 *
 *   // One-shot — auto-removed after first fire
 *   p.on(75, handler, { once: true });
 *
 *   // Conditional — only fires if predicate returns true
 *   p.on(50, handler, { if: () => user.isAdmin });
 *
 *   // Named lifecycle events
 *   p.on('start',  ()        => showSpinner());
 *   p.on('done',   ()        => hideSpinner());
 *   p.on('fail',   ()        => showRetry());
 *   p.on('change', (val, dir) => updateLabel(val));
 *   p.on('reverse',(val)     => notify.warn('Re-uploading…'));
 *
 *   // Remove a specific handler
 *   p.off(50, handler);
 *   p.off('done', handler);
 *
 * ─── Batch actions ────────────────────────────────────────────────────────────
 *
 *   p.action({
 *       30:      () => notify.info('Nearly a third'),
 *       50:      { up: () => showMid(), down: () => notify.warn('Regressing') },
 *       100:     () => redirect('/success'),
 *       fail:    () => showRetry(),
 *       done:    () => cleanup(),
 *       change:  (val, dir) => updateLabel(val),
 *   });
 *
 *   // action() always MERGES with existing hooks — never replaces.
 *
 * ─── Reverse ──────────────────────────────────────────────────────────────────
 *
 *   // Animate backward to 30 (e.g. corrupt file detected, re-uploading)
 *   p.reverse(30, { reason: 'corrupt', speed: 'fast' });
 *
 *   // Hook fires as bar crosses 50 going down
 *   p.on(50, ({ direction, reason }) => {
 *       if (direction === 'down') notify.warn('Re-uploading from checkpoint…');
 *   }, { direction: 'down' });
 *
 * ─── Bind to Api or Uploader ──────────────────────────────────────────────────
 *
 *   p.bind(api);       // auto start/done/fail on every api request
 *   p.bind(uploader);  // auto tracks upload progress via uploader:progress events
 *   p.unbind();        // remove all bindings
 *
 * ─── Attach inline bar to an element ─────────────────────────────────────────
 *
 *   p.attach('#upload-zone');   // renders bar inside that element
 *   p.attach(document.body);   // top-of-page bar (default when no attach)
 *
 * ─── State machine ────────────────────────────────────────────────────────────
 *
 *   idle → running → done
 *                ↓       ↑
 *            reversed → running   ← re-entry after a reverse
 *                ↓
 *              failed
 */

const _channels = new Map();

/**
 * Get or create a named progress channel.
 * Call with no argument (or undefined) for the default channel.
 *
 *   progress('upload').set(60);
 *   progress().start();
 */
export function progress(name = '__default__') {
    if (!_channels.has(name)) {
        _channels.set(name, _createChannel(name));
    }
    return _channels.get(name);
}

/**
 * Destroy a channel and remove its DOM bar.
 */
progress.destroy = function(name = '__default__') {
    const ch = _channels.get(name);
    if (ch) { ch._destroy(); _channels.delete(name); }
};

/**
 * Destroy all channels.
 */
progress.destroyAll = function() {
    for (const ch of _channels.values()) ch._destroy();
    _channels.clear();
};

function _createChannel(name) {

    // State

    let _value       = 0;
    let _state       = 'idle';      // idle | running | reversed | done | failed
    let _indeterminate = false;
    let _colorSlices = [];
    let _interpolate = true;
    let _barEl       = null;        // the rendered <div class="oja-progress-bar">
    let _wrapEl      = null;        // wrapper injected into the attach target
    let _attachTarget = null;
    let _unbindFns   = [];          // cleanup fns registered by bind()
    let _animFrame   = null;

    // Hook registry: Map<key, Array<{ fn, direction, once, if }>>
    // key is a number (milestone) or string (lifecycle event name)
    const _hooks = new Map();

    // Helpers

    function _resolveColor(val) {
        if (!_colorSlices.length) return null;

        const sorted = [..._colorSlices].sort((a, b) => a.at - b.at);

        if (!_interpolate) {
            // Snap — find the last slice whose `at` is <= val
            let snap = sorted[0].color;
            for (const s of sorted) {
                if (s.at <= val) snap = s.color;
            }
            return snap;
        }

        // Interpolate — find surrounding pair and lerp
        if (val <= sorted[0].at) return sorted[0].color;
        if (val >= sorted[sorted.length - 1].at) return sorted[sorted.length - 1].color;

        for (let i = 0; i < sorted.length - 1; i++) {
            const lo = sorted[i];
            const hi = sorted[i + 1];
            if (val >= lo.at && val <= hi.at) {
                const t = (val - lo.at) / (hi.at - lo.at);
                return _lerpColor(lo.color, hi.color, t);
            }
        }
        return null;
    }

    function _lerpColor(a, b, t) {
        const parse = hex => {
            const h = hex.replace('#', '');
            const full = h.length === 3
                ? h.split('').map(c => c + c).join('')
                : h;
            return [
                parseInt(full.slice(0, 2), 16),
                parseInt(full.slice(2, 4), 16),
                parseInt(full.slice(4, 6), 16),
            ];
        };
        const [r1, g1, b1] = parse(a);
        const [r2, g2, b2] = parse(b);
        const r = Math.round(r1 + (r2 - r1) * t);
        const g = Math.round(g1 + (g2 - g1) * t);
        const bl = Math.round(b1 + (b2 - b1) * t);
        return `rgb(${r},${g},${bl})`;
    }

    function _updateBar(val, forceColor) {
        if (!_barEl) _ensureBar();
        if (!_barEl) return;

        _barEl.style.width = `${val}%`;

        if (_indeterminate) {
            _barEl.classList.add('oja-progress-indeterminate');
        } else {
            _barEl.classList.remove('oja-progress-indeterminate');
        }

        const color = forceColor || _resolveColor(val);
        if (color) _barEl.style.background = color;
    }

    function _ensureBar() {
        const target = _attachTarget || document.body;
        if (!target) return;

        if (!_wrapEl) {
            _wrapEl = document.createElement('div');
            _wrapEl.className = 'oja-progress-wrap';
            _wrapEl.setAttribute('role', 'progressbar');
            _wrapEl.setAttribute('aria-valuemin', '0');
            _wrapEl.setAttribute('aria-valuemax', '100');

            _barEl = document.createElement('div');
            _barEl.className = 'oja-progress-bar';

            _wrapEl.appendChild(_barEl);

            if (_attachTarget) {
                // inline — prepend inside the target
                target.prepend(_wrapEl);
            } else {
                // top-of-page — fixed position
                _wrapEl.classList.add('oja-progress-top');
                document.body.prepend(_wrapEl);
            }
        }

        _wrapEl.setAttribute('aria-valuenow', String(_value));
        _wrapEl.style.display = '';
    }

    function _fireHooks(key, payload) {
        const entries = _hooks.get(key);
        if (!entries || entries.length === 0) return;

        const toRemove = [];

        for (const entry of entries) {
            const { fn, direction, once, if: condition } = entry;

            // Direction filter — only applies to numeric milestones
            if (direction && payload && payload.direction && direction !== payload.direction) continue;

            // Condition guard
            if (condition && !condition()) continue;

            try { fn(payload); } catch (e) {
                console.warn(`[oja/progress] hook error at "${key}":`, e);
            }

            if (once) toRemove.push(entry);
        }

        if (toRemove.length) {
            const remaining = entries.filter(e => !toRemove.includes(e));
            if (remaining.length) _hooks.set(key, remaining);
            else _hooks.delete(key);
        }
    }

    function _crossMilestones(from, to, direction) {
        // Fire hooks for every milestone crossed between from and to.
        // Works for both forward and backward movement.
        const [lo, hi] = direction === 'up' ? [from, to] : [to, from];

        for (const [key, _] of _hooks) {
            if (typeof key !== 'number') continue;
            const crossed = direction === 'up'
                ? key > from && key <= to
                : key >= to && key < from;
            if (crossed) {
                _fireHooks(key, { value: key, direction, channel: name });
            }
        }
    }

    // Public API

    const channel = {

        get value() { return _value; },
        get state() { return _state; },
        get name()  { return name;   },

        /**
         * Start indeterminate mode — bar pulses until set()/done()/fail().
         */
        start() {
            _state = 'running';
            _indeterminate = true;
            _value = 0;
            _ensureBar();
            _updateBar(100);
            _fireHooks('start', { channel: name });
            return this;
        },

        /**
         * Set the progress to an exact value (0–100).
         * Animates forward or backward as needed.
         */
        set(val, options = {}) {
            const clamped  = Math.min(100, Math.max(0, val));
            const prev     = _value;
            const direction = clamped >= prev ? 'up' : 'down';

            if (_state === 'idle') _state = 'running';
            if (_state === 'reversed' && direction === 'up') _state = 'running';

            _indeterminate = false;
            _value = clamped;

            _ensureBar();
            _updateBar(clamped, options.color || null);

            _crossMilestones(prev, clamped, direction);
            _fireHooks('change', { value: clamped, direction, prev, channel: name });

            return this;
        },

        /**
         * Increment the current value by `amount`.
         * Clamped to 99 — use done() to reach 100.
         */
        inc(amount = 10) {
            return this.set(Math.min(99, _value + amount));
        },

        /**
         * Animate backward to `val`.
         * Sets state to 'reversed' and fires 'reverse' hook.
         *
         *   p.reverse(30, { reason: 'corrupt', speed: 'fast' });
         */
        reverse(val, options = {}) {
            const clamped = Math.min(99, Math.max(0, val));
            const prev    = _value;

            _state = 'reversed';
            _indeterminate = false;

            if (_barEl) _barEl.classList.add('oja-progress-reversing');

            // Animate backward
            this.set(clamped);

            _fireHooks('reverse', {
                value:     clamped,
                from:      prev,
                direction: 'down',
                reason:    options.reason || null,
                channel:   name,
            });

            // Remove reversing class after transition settles
            if (_barEl) {
                const speed = options.speed === 'fast' ? 150 : 400;
                setTimeout(() => {
                    if (_barEl) _barEl.classList.remove('oja-progress-reversing');
                    // Re-enter running state so subsequent set() works normally
                    if (_state === 'reversed') _state = 'running';
                }, speed);
            }

            return this;
        },

        /**
         * Complete — fill to 100 then fade the bar out.
         */
        done() {
            _state = 'done';
            _indeterminate = false;
            const prev = _value;
            _value = 100;

            _ensureBar();
            _updateBar(100);
            _crossMilestones(prev, 100, 'up');

            if (_wrapEl) {
                _wrapEl.setAttribute('aria-valuenow', '100');
                setTimeout(() => {
                    if (_wrapEl) _wrapEl.style.opacity = '0';
                    setTimeout(() => {
                        if (_wrapEl) _wrapEl.style.display = 'none';
                        if (_wrapEl) _wrapEl.style.opacity = '';
                        _value = 0;
                        _state = 'idle';
                    }, 400);
                }, 300);
            }

            _fireHooks('done', { channel: name });
            return this;
        },

        /**
         * Fail — turn bar red then fade out.
         */
        fail(reason) {
            _state = 'failed';
            _indeterminate = false;

            _ensureBar();
            if (_barEl) {
                _barEl.style.background =
                    getComputedStyle(document.documentElement)
                        .getPropertyValue('--danger').trim() || '#ef4444';
            }

            if (_wrapEl) {
                setTimeout(() => {
                    if (_wrapEl) _wrapEl.style.opacity = '0';
                    setTimeout(() => {
                        if (_wrapEl) _wrapEl.style.display = 'none';
                        if (_wrapEl) _wrapEl.style.opacity = '';
                        _value = 0;
                        _state = 'idle';
                    }, 400);
                }, 600);
            }

            _fireHooks('fail', { reason, channel: name });
            return this;
        },

        /**
         * Reset to 0 immediately — no animation, no hooks.
         */
        reset() {
            _value = 0;
            _state = 'idle';
            _indeterminate = false;
            if (_barEl) { _barEl.style.width = '0%'; _barEl.style.background = ''; }
            if (_wrapEl) { _wrapEl.style.display = 'none'; _wrapEl.style.opacity = ''; }
            return this;
        },

        // Color

        /**
         * Define color slices for the bar.
         *
         *   p.color([
         *       { at: 0,   color: '#3b82f6' },
         *       { at: 100, color: '#10b981' },
         *   ], { interpolate: true });  // default: interpolate
         *
         *   p.color(slices, { interpolate: false }); // snap to nearest
         */
        color(slices, options = {}) {
            _colorSlices = Array.isArray(slices) ? slices : [];
            _interpolate = options.interpolate !== false; // default true
            // Re-apply color at current value if bar is visible
            if (_barEl && _value > 0) _updateBar(_value);
            return this;
        },

        // Hooks

        /**
         * Register a hook.
         *
         *   p.on(50, handler)
         *   p.on(50, handler, { direction: 'up', once: true, if: () => bool })
         *   p.on('done', handler)
         *   p.on('change', (val, dir) => ...)
         */
        on(key, fn, options = {}) {
            if (typeof fn !== 'function') return this;

            const entry = {
                fn,
                direction:  options.direction  || null,
                once:       options.once        || false,
                if:         options.if          || null,
            };

            if (!_hooks.has(key)) _hooks.set(key, []);
            _hooks.get(key).push(entry);
            return this;
        },

        /**
         * Remove a specific handler from a key, or all handlers if fn omitted.
         */
        off(key, fn) {
            if (!fn) { _hooks.delete(key); return this; }
            const entries = _hooks.get(key);
            if (!entries) return this;
            const remaining = entries.filter(e => e.fn !== fn);
            if (remaining.length) _hooks.set(key, remaining);
            else _hooks.delete(key);
            return this;
        },

        /**
         * Batch-register hooks from a plain object. Always merges.
         *
         *   p.action({
         *       50:     () => notify.info('Halfway'),
         *       80:     { up: () => showAlmost(), down: () => warn() },
         *       done:   () => cleanup(),
         *       fail:   () => retry(),
         *       change: (val, dir) => updateLabel(val),
         *   });
         */
        action(map) {
            for (const [rawKey, value] of Object.entries(map)) {
                const key = isNaN(rawKey) ? rawKey : Number(rawKey);

                if (typeof value === 'function') {
                    this.on(key, value);
                } else if (value && typeof value === 'object') {
                    // Direction-split shorthand: { up: fn, down: fn }
                    if (typeof value.up   === 'function') this.on(key, value.up,   { direction: 'up' });
                    if (typeof value.down === 'function') this.on(key, value.down, { direction: 'down' });
                }
            }
            return this;
        },

        // Track

        /**
         * Wire progress automatically to runtime lifecycle events.
         *
         *   // Track a router navigation across N components
         *   progress('page').track(runtime, {
         *       start: 'oja:navigate:start',   // event that resets and starts
         *       tick:  'component:mounted',     // event that increments
         *       total: 10,                      // expected ticks for 100%
         *       done:  'oja:navigate:end',       // event that completes
         *       fail:  'runtime:error',          // event that fails (optional)
         *   });
         *
         *   // Track all api requests
         *   progress('api').track(runtime, {
         *       start: 'out:fetch-start',
         *       done:  'out:fetch-end',
         *       fail:  'out:fetch-error',
         *   });
         *
         * Returns an untrack function.
         */
        track(rt, config = {}) {
            if (!rt || typeof rt.on !== 'function') {
                console.warn('[oja/progress] track() requires a runtime instance with .on()');
                return () => {};
            }

            const { start, tick, total, done, fail } = config;
            const unsubs = [];
            let _ticks = 0;
            let _total = total || 0;

            if (start) {
                unsubs.push(rt.on(start, () => {
                    _ticks = 0;
                    this.start();
                }));
            }

            if (tick) {
                unsubs.push(rt.on(tick, () => {
                    _ticks++;
                    if (_total > 0) {
                        this.set(Math.min(99, Math.round((_ticks / _total) * 100)));
                    } else {
                        // No total — use indeterminate inc
                        this.inc(10);
                    }
                }));
            }

            if (done) {
                unsubs.push(rt.on(done, () => this.done()));
            }

            if (fail) {
                unsubs.push(rt.on(fail, (detail) => this.fail(detail?.error || detail?.message)));
            }

            // Store unsubs so unbind() also cleans up track() listeners
            _unbindFns.push(...unsubs);

            return () => unsubs.forEach(u => u());
        },

        // Attach

        /**
         * Attach the progress bar to a specific element.
         * Defaults to top-of-page if not called.
         */
        attach(target) {
            _attachTarget = typeof target === 'string'
                ? document.querySelector(target)
                : target;
            // Remove any existing bar so it gets re-created at new target
            if (_wrapEl) { _wrapEl.remove(); _wrapEl = null; _barEl = null; }
            return this;
        },

        // Bind

        /**
         * Bind to an Api instance or an Uploader instance.
         * Automatically wires progress lifecycle to their events.
         *
         *   p.bind(api);
         *   p.bind(uploader);
         */
        bind(target) {
            if (!target) return this;

            // Api binding
            if (typeof target.beforeRequest === 'function' &&
                typeof target._executeRequest === 'function') {

                let _active = 0;

                const onBefore = () => {
                    _active++;
                    if (_active === 1) this.start();
                };

                const onAfter = () => {
                    _active = Math.max(0, _active - 1);
                    if (_active === 0) this.done();
                };

                const onError = () => {
                    _active = Math.max(0, _active - 1);
                    if (_active === 0) this.fail();
                };

                target.beforeRequest(onBefore);

                // Wire afterResponse if available
                if (typeof target.afterResponse === 'function') {
                    target.afterResponse(onAfter);
                } else if (Array.isArray(target._afterHooks)) {
                    target._afterHooks.push(onAfter);
                }

                // Listen for api:error events
                const { listen } = _getEvents();
                if (listen) {
                    const unsub = listen('api:error', onError);
                    _unbindFns.push(unsub);
                }

                _unbindFns.push(() => {
                    // Remove from _beforeHooks and _afterHooks if accessible
                    if (Array.isArray(target._beforeHooks)) {
                        const i = target._beforeHooks.indexOf(onBefore);
                        if (i !== -1) target._beforeHooks.splice(i, 1);
                    }
                    if (Array.isArray(target._afterHooks)) {
                        const j = target._afterHooks.indexOf(onAfter);
                        if (j !== -1) target._afterHooks.splice(j, 1);
                    }
                });

                return this;
            }

            // Uploader binding
            if (typeof target.add === 'function' &&
                typeof target.pause === 'function') {

                const { listen } = _getEvents();
                if (!listen) return this;

                const onProgress = ({ progress: pct }) => {
                    if (_state === 'idle') _state = 'running';
                    this.set(Math.round(pct));
                };
                const onComplete = () => this.done();
                const onError    = () => this.fail();
                const onStart    = () => this.start();

                const u1 = listen('uploader:progress', onProgress);
                const u2 = listen('uploader:complete', onComplete);
                const u3 = listen('uploader:error',    onError);
                const u4 = listen('uploader:started',  onStart);

                _unbindFns.push(u1, u2, u3, u4);
                return this;
            }

            console.warn('[oja/progress] bind() target not recognised — pass an Api or Uploader instance');
            return this;
        },

        /**
         * Remove all bindings established by bind().
         */
        unbind() {
            for (const fn of _unbindFns) {
                try { fn(); } catch (_) {}
            }
            _unbindFns = [];
            return this;
        },

        // Internal

        _destroy() {
            this.unbind();
            this.reset();
            if (_wrapEl) { _wrapEl.remove(); _wrapEl = null; _barEl = null; }
            _hooks.clear();
        },
    };

    return channel;
}

// Avoids a hard circular dependency — progress.js is in utils/, not core/.
// We import events lazily only when bind() actually needs it.

let _eventsCache = null;

function _getEvents() {
    if (_eventsCache) return _eventsCache;
    try {
        // Dynamic import is async — fall back to a no-op if not yet resolved.
        // In practice bind() is always called after the module graph is loaded.
        // eslint-disable-next-line no-undef
        _eventsCache = { listen: null };
        import('../core/events.js').then(m => { _eventsCache = m; });
    } catch (_) {}
    return _eventsCache || {};
}
