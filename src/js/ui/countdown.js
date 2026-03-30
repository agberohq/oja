/**
 * oja/countdown.js
 * Countdown timers — DOM-attached ticking displays and pure logical timers.
 * Handles expiry, warn thresholds, and safe null/missing-date values.
 *
 * ─── DOM-attached countdown ───────────────────────────────────────────────────
 *
 *   import { countdown } from '../oja/src/js/ui/countdown.js';
 *
 *   // Attach to an element — updates textContent every second
 *   const cd = countdown.attach('#fwExpiry', expiresAtMs, {
 *       format:   (ms) => `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`,
 *       onExpire: () => el.classList.add('expired'),
 *       warn:     120_000,
 *       onWarn:   () => notify.warn('Expiring soon'),
 *   });
 *   cd.destroy();
 *
 * ─── Logical countdown (no DOM) ───────────────────────────────────────────────
 *
 *   const cd = countdown.start(expiresAtMs, {
 *       onTick:   (msLeft) => updateBar(msLeft / totalMs),
 *       onExpire: () => lockKeeper(),
 *       warn:     120_000,
 *       onWarn:   () => notify.warn('Locks in 2 minutes'),
 *   });
 *   cd.stop();
 *   cd.reset(newExpiresAtMs);
 *
 * ─── Day-level helpers (cert expiry, dashboard widgets) ───────────────────────
 *
 *   countdown.daysLeft('2028-03-27T11:31:36Z')  // → 730   (positive = future)
 *   countdown.daysLeft(null)                     // → null
 *   countdown.daysLabel('2028-03-27T11:31:36Z') // → '730d'
 *   countdown.daysLabel(null)                    // → '—'
 *   countdown.daysLabel(0)                       // → 'Today'   (daysLeft === 0)
 *   countdown.daysLabel(-3)                      // → 'Expired' (daysLeft < 0)
 *   countdown.daysColor('2028-03-27T11:31:36Z') // → 'var(--success)'
 *
 * ─── Default format ───────────────────────────────────────────────────────────
 *
 *   ms ≥ 1 hour  → '2h 14m 5s'
 *   ms ≥ 1 min   → '14m 5s'
 *   ms > 0       → '5s'
 *   ms ≤ 0       → 'Expired'
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _resolve(target) {
    if (!target) return null;
    if (target instanceof Element) return target;
    return document.querySelector(target);
}

function _defaultFormat(ms) {
    if (ms <= 0) return 'Expired';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

// ─── countdown ────────────────────────────────────────────────────────────────

export const countdown = {

    /**
     * Attach a ticking countdown display to a DOM element.
     * Updates element.textContent every second using the format function.
     * Fires onWarn once when msLeft crosses below the warn threshold.
     * Fires onExpire once when msLeft reaches zero or below.
     *
     * @param {string|Element} target      — selector or element to update
     * @param {number}         expiresAt   — Unix timestamp in ms
     * @param {Object}         options
     *   format(msLeft) : string           — custom label fn (optional)
     *   onExpire()     : void             — called once on expiry
     *   warn           : number           — ms before expiry to trigger onWarn
     *   onWarn()       : void             — called once at warn threshold
     * @returns {{ destroy() }}
     */
    attach(target, expiresAt, options = {}) {
        const el = _resolve(target);
        if (!el) {
            console.warn('[oja/countdown] attach: target not found:', target);
            return { destroy() {} };
        }

        const {
            format   = _defaultFormat,
            onExpire = null,
            warn     = 0,
            onWarn   = null,
        } = options;

        let _warnFired   = false;
        let _expireFired = false;
        let _timerId     = null;

        function _tick() {
            const msLeft = expiresAt - Date.now();

            el.textContent = format(msLeft);

            if (warn > 0 && onWarn && !_warnFired && msLeft > 0 && msLeft <= warn) {
                _warnFired = true;
                try { onWarn(); } catch (e) { console.warn('[oja/countdown] onWarn error:', e); }
            }

            if (msLeft <= 0 && !_expireFired) {
                _expireFired = true;
                clearInterval(_timerId);
                _timerId = null;
                if (onExpire) {
                    try { onExpire(); } catch (e) { console.warn('[oja/countdown] onExpire error:', e); }
                }
            }
        }

        _tick();
        _timerId = setInterval(_tick, 1000);

        return {
            destroy() {
                if (_timerId !== null) {
                    clearInterval(_timerId);
                    _timerId = null;
                }
            },
        };
    },

    /**
     * Start a logical countdown with no DOM attachment.
     * Calls onTick every second with msLeft remaining.
     * Calls onWarn once when msLeft crosses below warn threshold.
     * Calls onExpire once when msLeft reaches zero.
     * reset() restarts with a new expiresAt value.
     *
     * @param {number} expiresAt — Unix timestamp in ms
     * @param {Object} options
     *   onTick(msLeft)  : void  — called every second
     *   onExpire()      : void  — called once on expiry
     *   warn            : number
     *   onWarn()        : void
     * @returns {{ stop(), reset(newExpiresAt) }}
     */
    start(expiresAt, options = {}) {
        const {
            onTick   = null,
            onExpire = null,
            warn     = 0,
            onWarn   = null,
        } = options;

        let _expiresAt   = expiresAt;
        let _warnFired   = false;
        let _expireFired = false;
        let _timerId     = null;

        function _tick() {
            const msLeft = _expiresAt - Date.now();

            if (onTick) {
                try { onTick(Math.max(0, msLeft)); } catch (e) { console.warn('[oja/countdown] onTick error:', e); }
            }

            if (warn > 0 && onWarn && !_warnFired && msLeft > 0 && msLeft <= warn) {
                _warnFired = true;
                try { onWarn(); } catch (e) { console.warn('[oja/countdown] onWarn error:', e); }
            }

            if (msLeft <= 0 && !_expireFired) {
                _expireFired = true;
                clearInterval(_timerId);
                _timerId = null;
                if (onExpire) {
                    try { onExpire(); } catch (e) { console.warn('[oja/countdown] onExpire error:', e); }
                }
            }
        }

        _tick();
        _timerId = setInterval(_tick, 1000);

        return {
            stop() {
                if (_timerId !== null) {
                    clearInterval(_timerId);
                    _timerId = null;
                }
            },

            reset(newExpiresAt) {
                if (_timerId !== null) {
                    clearInterval(_timerId);
                    _timerId = null;
                }
                _expiresAt   = newExpiresAt;
                _warnFired   = false;
                _expireFired = false;
                _tick();
                _timerId = setInterval(_tick, 1000);
            },
        };
    },

    // ─── Day-level helpers ────────────────────────────────────────────────────

    /**
     * Return the number of whole days until an ISO date or ms timestamp expires.
     * Returns null for null/undefined/invalid input — never produces "nulld".
     *
     * Positive = future, 0 = today, negative = expired.
     *
     *   countdown.daysLeft('2028-03-27T11:31:36Z') // → 730
     *   countdown.daysLeft(null)                   // → null
     */
    daysLeft(value) {
        if (value == null) return null;
        const ts = typeof value === 'number' ? value : Date.parse(value);
        if (isNaN(ts)) return null;
        return Math.floor((ts - Date.now()) / 86_400_000);
    },

    /**
     * Return a human-readable label for a days-left value or date.
     * Accepts a pre-computed daysLeft number, an ISO string, or null.
     *
     *   countdown.daysLabel(null)   // → '—'
     *   countdown.daysLabel(-3)     // → 'Expired'
     *   countdown.daysLabel(0)      // → 'Today'
     *   countdown.daysLabel(12)     // → '12d'
     *   countdown.daysLabel('2028-03-27T11:31:36Z') // → '730d'
     */
    daysLabel(value) {
        const days = typeof value === 'number' ? value : this.daysLeft(value);
        if (days === null) return '—';
        if (days < 0)  return 'Expired';
        if (days === 0) return 'Today';
        return `${days}d`;
    },

    /**
     * Return a CSS variable color string appropriate for the days remaining.
     * Accepts a pre-computed daysLeft number, an ISO string, or null.
     *
     *   null or expired  → 'var(--danger)'
     *   < 7 days         → 'var(--warning)'
     *   < 30 days        → 'var(--info)'
     *   ≥ 30 days        → 'var(--success)'
     */
    daysColor(value) {
        const days = typeof value === 'number' ? value : this.daysLeft(value);
        if (days === null || days < 0)  return 'var(--danger)';
        if (days < 7)   return 'var(--warning)';
        if (days < 30)  return 'var(--info)';
        return 'var(--success)';
    },
};
