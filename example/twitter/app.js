/**
 * app.js — Twitter-style demo entry point
 *
 * Demonstrates:
 *   - Router with hash mode and middleware
 *   - context() for cross-component reactive state
 *   - layout.js for persistent sidebar shell
 *   - modal, notify, keys for global interactions
 *   - All imports from the barrel — no deep paths
 */

import {
    Router, Out, layout,
    modal, notify, keys,
    on, debounce,
    context,
} from '../../src/oja.js';

// ── Global reactive state — shared across all page components ─────────────────
export const [currentUser, setCurrentUser] = context('user', {
    id       : '1',
    name     : 'Alex Johnson',
    username : 'alexj',
    avatar   : 'A',
    bio      : 'Building things with Oja • Previously @startup',
    followers: 1243,
    following: 342,
});

export const [tweets, setTweets] = context('tweets', [
    {
        id           : '1',
        userId       : '1',
        content      : 'Just built a Twitter clone with Oja in 200 lines of code. No build step. No dependencies. Just HTML and JS. This framework is magic! ✨',
        likes        : 342,
        retweets     : 89,
        replies      : 23,
        timestamp    : Date.now() - 3600000,
        liked        : false,
        retweeted    : false,
    },
    {
        id           : '2',
        userId       : '2',
        userName     : 'Sarah Chen',
        userUsername : 'sarahcodes',
        userAvatar   : 'S',
        content      : 'The web is healing. We\'re moving back to simplicity. Oja feels like what the web should have always been.',
        likes        : 567,
        retweets     : 123,
        replies      : 45,
        timestamp    : Date.now() - 7200000,
        liked        : true,
        retweeted    : false,
    },
    {
        id           : '3',
        userId       : '3',
        userName     : 'Marcus Williams',
        userUsername : 'marcusw',
        userAvatar   : 'M',
        content      : 'Hot take: frameworks should get out of your way. Oja does exactly that. Write HTML. Add data. Done.',
        likes        : 234,
        retweets     : 56,
        replies      : 12,
        timestamp    : Date.now() - 10800000,
        liked        : false,
        retweeted    : true,
    },
]);

export const [trends] = context('trends', [
    { category: 'Technology', name: 'OjaFramework', tweets: '12.5K' },
    { category: 'Technology', name: 'WebDev',       tweets: '45.2K' },
    { category: 'Technology', name: 'JavaScript',   tweets: '89.1K' },
    { category: 'News',       name: 'Simplicity',   tweets: '23.4K' },
    { category: 'Tech',       name: 'NoBuild',      tweets: '8.7K'  },
]);

// ── Router ────────────────────────────────────────────────────────────────────
const router = new Router({ mode: 'hash', outlet: '#main-outlet' });

// Log navigation timing
router.Use(async (ctx, next) => {
    const start = performance.now();
    await next();
    console.log(`→ ${ctx.path} (${Math.round(performance.now() - start)}ms)`);
});

// ── Persistent layout shell ───────────────────────────────────────────────────
// sidebar.html renders once into #app. #main-outlet inside it becomes the
// router outlet — only the main column re-renders on navigation.
const shell = layout('components/sidebar.html', {
    outlet : '#main-outlet',
    data   : () => ({
        currentUser : currentUser(),
        trends      : trends(),
    }),
});
router.Use(shell.middleware());

// ── Routes — each points directly to its page component ──────────────────────
router.Get('/', Out.fn(() =>
    Out.component('pages/feed.html', { currentUser, tweets })
));

router.Get('/explore', Out.fn(() =>
    Out.component('pages/explore.html', {
        currentUser,
        trends,
        tweets: () => tweets().filter(t => t.likes > 300),
    })
));

router.Get('/profile', Out.fn(() =>
    Out.component('pages/profile.html', {
        currentUser,
        tweets: () => tweets().filter(t => t.userId === currentUser().id),
    })
));

router.Get('/tweet/{id}', Out.fn((container, ctx) => {
    const tweet = tweets().find(t => t.id === ctx.params.id);
    if (!tweet) return Out.html('<div class="not-found" style="padding:40px;text-align:center">Tweet not found</div>');
    return Out.component('pages/tweet-detail.html', { currentUser, tweet });
}));

router.NotFound(Out.component('components/404.html'));

// ── Global event handlers ─────────────────────────────────────────────────────
on('[data-action="like"]', 'click', (e, el) => {
    const tweetId = el.closest('[data-tweet-id]')?.dataset.tweetId;
    if (!tweetId) return;
    setTweets(tweets().map(t => {
        if (t.id !== tweetId) return t;
        return { ...t, likes: t.liked ? t.likes - 1 : t.likes + 1, liked: !t.liked };
    }));
});

on('[data-action="retweet"]', 'click', (e, el) => {
    const tweetId = el.closest('[data-tweet-id]')?.dataset.tweetId;
    if (!tweetId) return;
    setTweets(tweets().map(t => {
        if (t.id !== tweetId) return t;
        return { ...t, retweets: t.retweeted ? t.retweets - 1 : t.retweets + 1, retweeted: !t.retweeted };
    }));
});

on('[data-action="reply"]', 'click', () => notify.info('Reply feature coming soon!'));

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
keys({
    'n'   : () => modal.open('composeModal'),
    'g h' : () => router.navigate('/'),
    'g e' : () => router.navigate('/explore'),
    'g p' : () => router.navigate('/profile'),
    '/'   : () => document.getElementById('search')?.focus(),
    '?'   : () => notify.info('n: Compose · g h: Home · g e: Explore · g p: Profile · /: Search · Esc: Close'),
});

// ── Search ────────────────────────────────────────────────────────────────────
on('#search', 'input', debounce((e) => {
    const query = e.target.value.toLowerCase().trim();
    if (!query) return;
    const count = tweets().filter(t =>
        t.content.toLowerCase().includes(query) ||
        (t.userName || currentUser().name).toLowerCase().includes(query)
    ).length;
    if (count) notify.info(`Found ${count} tweet${count === 1 ? '' : 's'}`);
}, 300));

// ── Start ─────────────────────────────────────────────────────────────────────
router.start('/');