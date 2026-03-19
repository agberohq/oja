/**
 * example/hello/app.js
 *
 * The simplest Oja app that shows navigation.
 *
 * Demonstrates:
 *   Router    — hash-mode SPA navigation, two routes
 *   Out       — Out.component() as route handler
 *   context() — guestbook entries shared across the app
 *   notify    — toast on milestone
 */

import { Router, Out, context, notify } from '../../build/oja.core.min.js';

// ── Shared state — guestbook entries live here, survive navigation ────────────
// Any page that calls context('entries') gets the same reactive value.
export const [entries, setEntries] = context('entries', []);

// ── Router ────────────────────────────────────────────────────────────────────
const router = new Router({ mode: 'hash', outlet: '#app' });

router.Get('/',          Out.component('pages/counter.html'));
router.Get('/guestbook', Out.component('pages/guestbook.html'));

router.NotFound(Out.html(`
    <div style="text-align:center;padding:64px 0;color:#444">
        <div style="font-size:48px;margin-bottom:16px">404</div>
        <a href="#/" style="color:#666;font-size:13px">← Back home</a>
    </div>
`));

router.start('/');