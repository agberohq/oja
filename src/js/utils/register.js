/**
 * oja/register.js
 * Optional runtime event dictionary — strict-mode validation for emit/listen.
 *
 * Entirely opt-in. Apps that never call events.register() see zero behaviour
 * change — emit and listen work exactly as before.
 *
 * When registered events are declared, any emit or listen call using an
 * unregistered name produces a loud warning (default) or throws (strict mode).
 * This catches typos like emit('metric:updated') vs emit('metrics:updated')
 * at the point of the mistake, not silently downstream.
 *
 * ─── Usage ────────────────────────────────────────────────────────────────────
 *
 *   import { events } from '../oja/src/oja.js';
 *
 *   // Declare valid event names (additive — call multiple times)
 *   events.register([
 *       'metrics:updated',
 *       'hosts:refresh',
 *       'drawer:open-route',
 *       'drawer:open-backend',
 *   ]);
 *
 *   // Enable strict mode (throw instead of warn — call in dev bootstrap only)
 *   events.strictMode(true);
 *
 *   // Introspection
 *   events.isRegistered('metrics:updated');  // → true
 *   events.getRegistered();                  // → Set<string>
 *
 * ─── Integration with emit / listen ──────────────────────────────────────────
 *
 *   register.js does not modify events.js. It installs lightweight interceptors
 *   that wrap emit and listen at the module level when register() is first called.
 *   The original functions are preserved and called through unchanged.
 *
 * ─── Mode ─────────────────────────────────────────────────────────────────────
 *
 *   Default: console.warn — unregistered names log but do not interrupt execution.
 *   Strict:  throws Error — use in development; never enable in production.
 *
 *   Mode is set explicitly via events.strictMode(true) — not inferred from
 *   location.hostname. This works correctly for 127.0.0.1, staging, and
 *   local production builds.
 */

import { emit as _emit, listen as _listen } from '../core/events.js';

// All events emitted internally by Oja modules are pre-registered here.
// Apps that call events.register([...]) + events.strictMode(true) will get
// validation on their own events AND catch typos in Oja's built-in names.
const _OJA_EVENTS = [
    // Router
    'oja:navigate:start',
    'oja:navigate:end',
    'oja:navigate',
    // Component
    'component:mounted',
    'component:added',
    'component:removed',
    'component:updated',
    'component:cache-hit',
    'component:cache-miss',
    'component:cached',
    'component:cache-evict',
    'component:slow-render',
    'component:dead',
    // Layout
    'layout:mounted',
    'layout:updated',
    'layout:slot',
    'layout:slot-ready',
    'layout:unmounted',
    'layout:injected',
    // Out / rendering
    'out:fetch-start',
    'out:fetch-end',
    'out:fetch-error',
    'out:component-rendered',
    'out:cache-hit',
    'out:vfs-hit',
    'out:image-loaded',
    'out:image-error',
    // Api
    'api:error',
    'api:queued',
    'api:unauthorized',
    'api:online',
    'api:offline',
    // Notify
    'notify:toast',
    'notify:banner',
    // Modal
    'modal:open',
    'modal:close',
    // Runtime
    'runtime:error',
    'runtime:destroy',
    // Uploader
    'uploader:started',
    'uploader:progress',
    'uploader:complete',
    'uploader:error',
    'uploader:paused',
    'uploader:resumed',
    'uploader:canceled',
    'uploader:added',
];

const _registered = new Set(_OJA_EVENTS); // pre-seeded with all first-party events
let   _strict     = false;
let   _active     = false;   // true once register() has been called at least once

// Validate an event name against the registered set.
// Only runs when _active — if register() was never called, all names are valid.
function _check(name, caller) {
    if (!_active) return;
    if (_registered.has(name)) return;
    const msg = `[oja/register] unregistered event "${name}" used in ${caller}()`;
    if (_strict) throw new Error(msg);
    console.warn(msg);
}

/**
 * Declare one or more valid event names.
 * Additive — calling register() multiple times extends the set.
 * Once called, any emit/listen using a name not in the set will warn or throw.
 *
 *   events.register(['metrics:updated', 'hosts:refresh']);
 */
export function register(names) {
    if (!Array.isArray(names) || names.length === 0) {
        console.warn('[oja/register] register() expects a non-empty array of event names');
        return;
    }
    for (const n of names) _registered.add(n);
    _active = true;
}

/**
 * Enable or disable strict mode.
 * In strict mode, unregistered event names throw an Error instead of warning.
 * Call with true in development bootstrap only — never in production.
 *
 *   events.strictMode(true);
 */
export function strictMode(enabled = true) {
    _strict = enabled;
}

/**
 * Returns true if the given event name has been registered.
 */
export function isRegistered(name) {
    return _registered.has(name);
}

/**
 * Returns the full set of registered event names.
 */
export function getRegistered() {
    return new Set(_registered);
}

/**
 * Validated emit — checks the name before firing.
 * Drop-in replacement for the bare emit import when strict mode is desired.
 *
 *   import { emit } from '../oja/src/js/core/register.js';
 */
export function emit(name, detail = {}) {
    _check(name, 'emit');
    return _emit(name, detail);
}

/**
 * Validated listen — checks the name before subscribing.
 * Drop-in replacement for the bare listen import when strict mode is desired.
 *
 *   import { listen } from '../oja/src/js/core/register.js';
 */
export function listen(name, fn) {
    _check(name, 'listen');
    return _listen(name, fn);
}

/**
 * Convenience object — matches the shape apps use when importing from oja.js
 * so callers can write events.register() / events.strictMode() naturally.
 */
export const events = { register, strictMode, isRegistered, getRegistered, emit, listen };