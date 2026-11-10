/**
 * oja/viewport.js
 * iOS focus-zoom guard for compact form controls.
 *
 * Mobile Safari zooms the page when a form field under 16px receives focus.
 * Oja's controls default to 13px, so an app can keep that size and ask Safari
 * not to focus-zoom by adding `maximum-scale=1` to the viewport meta. Pinch
 * zoom still works, and non-iOS browsers are untouched.
 *
 *   import { preventFocusZoom } from '@agberohq/oja';
 *   preventFocusZoom(); // once at boot (client only)
 *
 * Returns true when the viewport was changed, false when there was nothing
 * to do. `{ force: true }` is available for tests/embedded webviews.
 */

function _isIOS() {
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
        try {
            if (CSS.supports('-webkit-touch-callout', 'none')) return true;
        } catch { /* fall through to UA checks */ }
    }
    if (typeof navigator === 'undefined') return false;
    return (
        /iP(hone|ad|od)/.test(navigator.userAgent || '') ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );
}

export function preventFocusZoom(options = {}) {
    const { force = false } = options;
    if (typeof document === 'undefined') return false;
    if (!force && !_isIOS()) return false;

    let viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) {
        viewport = document.createElement('meta');
        viewport.name = 'viewport';
        viewport.content = 'width=device-width, initial-scale=1';
        document.head.appendChild(viewport);
    }

    const parts = String(viewport.content || '')
        .split(',')
        .map(part => part.trim())
        .filter(part => part && !part.startsWith('maximum-scale'));

    viewport.content = [...parts, 'maximum-scale=1'].join(', ');
    return true;
}
