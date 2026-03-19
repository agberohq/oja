/**
 * example/hello/app.js
 *
 * The simplest Oja app that shows navigation.
 *
 * Demonstrates:
 *   Router    — hash-mode SPA navigation, three routes
 *   Out       — Out.component() as route handler
 *   context() — guestbook entries and game progress shared across the app
 */

import { Router, Out, context } from '../../build/oja.core.esm.js';

// Shared guestbook entries — any page calling context('entries') gets this pair
export const[entries, setEntries] = context('entries',[]);

// Shared game progress — game.html reads this to restore level on navigation
export const [gameLevel, setGameLevel] = context('gameLevel', 0);

const router = new Router({ mode: 'hash', outlet: '#app' });

router.Get('/',          Out.component('pages/counter.html'));
router.Get('/guestbook', Out.component('pages/guestbook.html'));
router.Get('/game',      Out.component('pages/game.html'));
router.Get('/todo',      Out.component('pages/todo.html'));

router.NotFound(Out.html(`
    <div style="text-align:center;padding:64px 0;color:#444">
        <div style="font-size:48px;margin-bottom:16px">404</div>
        <a href="#/" style="color:#666;font-size:13px">← Back home</a>
    </div>
`));

router.start('/');