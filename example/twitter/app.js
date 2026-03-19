import {
    Router, Out, component, modal, notify,
    on, keys, context, state, effect, form
} from '../../oja/src/oja.js';

// ===== Reactive State =====
const [currentUser, setCurrentUser] = context('user', {
    id: '1',
    name: 'Alex Johnson',
    username: 'alexj',
    avatar: 'A',
    bio: 'Building things with Oja • Previously @startup',
    followers: 1243,
    following: 342
});

const [tweets, setTweets] = context('tweets', [
    {
        id: '1',
        userId: '1',
        content: 'Just built a Twitter clone with Oja in 200 lines of code. No build step. No dependencies. Just HTML and JS. This framework is magic! ✨',
        likes: 342,
        retweets: 89,
        replies: 23,
        timestamp: Date.now() - 3600000,
        liked: false,
        retweeted: false
    },
    {
        id: '2',
        userId: '2',
        userName: 'Sarah Chen',
        userUsername: 'sarahcodes',
        userAvatar: 'S',
        content: 'The web is healing. We\'re moving back to simplicity. Oja feels like what the web should have always been.',
        likes: 567,
        retweets: 123,
        replies: 45,
        timestamp: Date.now() - 7200000,
        liked: true,
        retweeted: false
    },
    {
        id: '3',
        userId: '3',
        userName: 'Marcus Williams',
        userUsername: 'marcusw',
        userAvatar: 'M',
        content: 'Hot take: frameworks should get out of your way. Oja does exactly that. Write HTML. Add data. Done.',
        likes: 234,
        retweets: 56,
        replies: 12,
        timestamp: Date.now() - 10800000,
        liked: false,
        retweeted: true
    }
]);

const [trends] = context('trends', [
    { category: 'Technology', name: 'OjaFramework', tweets: '12.5K' },
    { category: 'Technology', name: 'WebDev', tweets: '45.2K' },
    { category: 'Technology', name: 'JavaScript', tweets: '89.1K' },
    { category: 'News', name: 'Simplicity', tweets: '23.4K' },
    { category: 'Tech', name: 'NoBuild', tweets: '8.7K' }
]);

// ===== Helper Functions =====
function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
    return new Date(timestamp).toLocaleDateString();
}

// ===== Router =====
const router = new Router({ mode: 'hash', outlet: '#app' });

// Global middleware - log navigation
router.Use(async (ctx, next) => {
    console.log(`→ ${ctx.path}`);
    const start = performance.now();
    await next();
    const ms = Math.round(performance.now() - start);
    console.log(`← ${ctx.path} (${ms}ms)`);
});

// Routes
router.Get('/', Out.component('components/layout.html', {
    page: 'feed',
    currentUser,
    tweets,
    trends,
    formatTimeAgo
}));

router.Get('/explore', Out.component('components/layout.html', {
    page: 'explore',
    currentUser,
    trends,
    tweets: tweets().filter(t => t.likes > 300) // Popular tweets
}));

router.Get('/profile', Out.component('components/layout.html', {
    page: 'profile',
    currentUser,
    tweets: tweets().filter(t => t.userId === currentUser().id)
}));

router.Get('/tweet/{id}', Out.component('components/layout.html', {
    page: 'tweet',
    currentUser,
    tweet: ctx => tweets().find(t => t.id === ctx.params.id),
    formatTimeAgo
}));

router.NotFound(Out.component('components/404.html'));

// ===== Keyboard Shortcuts =====
keys({
    'n': () => modal.open('composeModal'),
    'g h': () => router.navigate('/'),
    'g e': () => router.navigate('/explore'),
    'g p': () => router.navigate('/profile'),
    '/': () => document.getElementById('search')?.focus(),
    '?': () => notify.info('n: Compose · g h: Home · g e: Explore · g p: Profile · /: Search · Esc: Close')
});

// ===== Component Lifecycle =====
component.onMount(() => {
    notify.success(`Welcome back, ${currentUser().name}!`);

    // Auto-refresh every minute (simulated)
    component.interval(() => {
        // In real app: fetch new tweets
        console.log('Checking for new tweets...');
    }, 60000);
});

// ===== Global Event Handlers =====
on('[data-action="like"]', 'click', (e, el) => {
    const tweetId = el.closest('[data-tweet-id]')?.dataset.tweetId;
    if (!tweetId) return;

    setTweets(tweets().map(t => {
        if (t.id === tweetId) {
            return {
                ...t,
                likes: t.liked ? t.likes - 1 : t.likes + 1,
                liked: !t.liked
            };
        }
        return t;
    }));

    notify.success(el.classList.contains('liked') ? 'Unliked' : 'Liked!');
});

on('[data-action="retweet"]', 'click', (e, el) => {
    const tweetId = el.closest('[data-tweet-id]')?.dataset.tweetId;
    if (!tweetId) return;

    setTweets(tweets().map(t => {
        if (t.id === tweetId) {
            return {
                ...t,
                retweets: t.retweeted ? t.retweets - 1 : t.retweets + 1,
                retweeted: !t.retweeted
            };
        }
        return t;
    }));

    notify.success(el.classList.contains('retweeted') ? 'Unretweeted' : 'Retweeted!');
});

on('[data-action="reply"]', 'click', (e, el) => {
    const tweetId = el.closest('[data-tweet-id]')?.dataset.tweetId;
    notify.info('Reply feature coming soon!');
});

on('#search', 'input', debounce((e) => {
    const query = e.target.value.toLowerCase();
    if (!query) return;

    const results = tweets().filter(t =>
        t.content.toLowerCase().includes(query) ||
        (t.userName || currentUser().name).toLowerCase().includes(query)
    );

    if (results.length) {
        notify.info(`Found ${results.length} tweets`);
    }
}, 300));

// ===== Start the app =====
router.start('/');