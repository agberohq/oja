# Oja — Learn by Building

This guide builds a small but complete app from scratch — a personal task board
with a counter, a notes list, and a profile page. Every Oja concept is introduced
exactly when it is needed, so you never learn something in the abstract.

By the end you will know how to use every core primitive:
`state`, `effect`, `context`, `derived`, `batch`, routing, components,
layouts, forms, modals, keyboard shortcuts, and auth guards.

No build step. No compiler. Just files.

---

## Before you start

Serve the project from a local HTTP server — browsers block ES module imports
from `file://`. Any of these work:

```bash
agbero serve . --port 3000 
#or
agbero serve . --port 3000 --https # (requires installation)
#or
npx serve .
# or
python3 -m http.server 3000
# or
npx vite --open   # if you prefer Vite's dev server
```


Then open `http://localhost:3000`.

---

## Part 1 — Hello, reactive world

### The simplest possible Oja app

Create two files:

```
my-app/
  index.html
  app.js
```

**index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>My App</title>
    <link rel="stylesheet" href="oja.min.css">
</head>
<body>
<div id="app"></div>
<script type="module" src="app.js"></script>
</body>
</html>
```

**app.js**

```js
import { state, effect } from './build/oja.core.esm.js';

const [count, setCount] = state(0);

document.getElementById('app').innerHTML = `
    <button id="btn">Clicked: 0</button>
`;

const btn = document.getElementById('btn');

effect(() => {
    btn.textContent = `Clicked: ${count()}`;
});

btn.addEventListener('click', () => setCount(n => n + 1));
```

This is Oja at its core — `state` holds a value, `effect` reacts to it.
Nothing else is involved.

---

## Part 2 — state and effect

### `state(initialValue)` → `[read, write]`

`state` returns a tuple. The first item is a **getter** (call it to read),
the second is a **setter**:

```js
const [name, setName] = state('Ada');

name();           // → 'Ada'
setName('Grace'); // update
name();           // → 'Grace'

// Functional update — receives the current value
setName(n => n.toUpperCase()); // → 'GRACE'
```

The getter is marked with `.__isOjaSignal = true` so Oja can detect it when
passed as a prop.

### `effect(fn)` — reactive side effects

An effect runs immediately, then re-runs any time a signal it read changes.
It tracks dependencies automatically — you do not register them manually.

```js
const [x, setX] = state(1);
const [y, setY] = state(2);

effect(() => {
    console.log('sum =', x() + y());
    // This effect depends on both x and y
});

setX(10); // logs: sum = 12
setY(20); // logs: sum = 30
```

`effect` returns a dispose function. Call it to stop the effect permanently:

```js
const stop = effect(() => { ... });
stop(); // unsubscribed — will never run again
```

### `derived(fn)` — computed values

A derived value is a read-only signal whose value is always computed from
other signals. Use it when a value is a pure function of state:

```js
const [price, setPrice]    = state(100);
const [quantity, setQty]   = state(3);
const total = derived(() => price() * quantity());

total(); // → 300
setPrice(200);
total(); // → 600
```

### `batch(fn)` — group updates

By default every setter schedules its own effect flush. `batch` groups
multiple updates so effects run only once:

```js
const [a, setA] = state(0);
const [b, setB] = state(0);

effect(() => console.log(a() + b())); // runs once on creation

nextFrame(() => {
    setA(1);
    setB(2);
}); // effect runs once here, not twice
```

---

## Part 3 — context (shared state)

`context` is `state` that lives at the application level. Any module anywhere
can read or write it and effects update automatically.

```js
// app.js — create once
import { context } from './build/oja.core.esm.js';
export const [currentUser, setCurrentUser] = context('user', null);

// profile.html — read anywhere
import { context } from '../../build/oja.core.esm.js';
const [currentUser] = context('user'); // same pair, no initial value needed
```

Rules:
- The first call with a name creates the value.
- Every subsequent call with the same name returns the same `[read, write]` pair.
- Pass the **signal** as a prop, not the value — so components stay reactive.

```js
// ✓ Pass the signal
router.Get('/', Out.component('pages/home.html', { user: currentUser }));

// ✗ Pass a snapshot — component gets a frozen value, never updates
router.Get('/', Out.component('pages/home.html', { user: currentUser() }));
```

---

## Part 4 — Project structure

Once an app grows past one page, organise it like this:

```
my-app/
  index.html          ← shell HTML, loads app.js
  app.js              ← context + router + global events
  layouts/
    main.html         ← persistent shell (nav, sidebar, outlet)
  pages/
    home.html         ← one file per route
    tasks.html
    profile.html
    404.html
  components/
    task-item.html    ← reusable pieces mounted inside pages
    avatar.html
  css/
    style.css         ← your styles — Oja never touches these
```

Oja does not enforce this structure. It is simply the pattern that scales well.

---

## Part 5 — Routing

### Basic setup

```js
import { Router, Out } from './build/oja.core.esm.js';

const router = new Router({ mode: 'hash', outlet: '#main-outlet' });

router.Get('/',        Out.component('pages/home.html'));
router.Get('/tasks',   Out.component('pages/tasks.html'));
router.Get('/profile', Out.component('pages/profile.html'));

router.NotFound(Out.html('<p>Page not found</p>'));

router.start('/');
```

`mode: 'hash'` uses `#/` URLs — no server config needed.
`mode: 'history'` uses clean URLs — requires your server to return `index.html`
for all routes.

### Route parameters

```js
router.Get('/task/:id', Out.component('pages/task-detail.html'));

// Inside task-detail.html script:
const taskId = props.params.id;
```

### Passing props to a route

```js
router.Get('/tasks', Out.component('pages/tasks.html', {
    tasks,       // reactive signal — page stays live
    currentUser, // reactive signal
}));
```

### Middleware

```js
// Log every navigation
router.Use(async (ctx, next) => {
    console.log('→', ctx.path);
    await next();
});

// Protect a group of routes
const protected = router.Group('/');
protected.Use(async (ctx, next) => {
    if (!currentUser()) {
        ctx.redirect('/login');
        return;
    }
    await next();
});

protected.Get('/',        Out.component('pages/home.html'));
protected.Get('/profile', Out.component('pages/profile.html'));
```

---

## Part 6 — Layout

A layout is a persistent shell — nav, sidebar, header — that stays mounted
while routes change inside it.

**index.html** — declare the mount point:

```html
<body>
<div id="app"></div>
<script type="module" src="app.js"></script>
</body>
```

**app.js** — apply the layout before starting the router:

```js
import { layout, Router, Out } from './build/oja.core.esm.js';

// await is required — the router outlet lives inside the layout
await layout.apply('#app', 'layouts/main.html', {
    currentUser,
    unreadCount: 3,
});

const router = new Router({ mode: 'hash', outlet: '#main-outlet' });
// ... routes
router.start('/');
```

**layouts/main.html** — the outlet goes here:

```html
<div class="shell">
    <nav>
        <a href="#/" data-page="/">Home</a>
        <a href="#/tasks" data-page="/tasks">Tasks</a>
        <a href="#/profile" data-page="/profile">Profile</a>
    </nav>
    <main id="main-outlet"></main>
</div>
```

`data-page` attributes are used by Oja to apply an `oja-active` class to the
current route's link automatically.

> **Always `await layout.apply()` before `router.start()`.**
> The router writes into `#main-outlet`, which only exists after the layout
> renders. If you start the router first, nothing renders.

---

## Part 7 — Components

A component is any `.html` file. Mount it with `component.mount()` or
`Out.component()`.

### Injected variables

Every component script automatically receives:

| Variable    | What it is                                      |
|-------------|-------------------------------------------------|
| `container` | The DOM element the component mounted into      |
| `find`      | `querySelector` scoped to `container`           |
| `findAll`   | `querySelectorAll` scoped to `container`        |
| `props`     | Read-only proxy of the props passed at mount    |

You do not declare these — Oja injects them. Declaring your own variable with
the same name as an injected one causes a `SyntaxError`.

```js
// ✗ Crashes — 'find' is already declared
const find = document.querySelector.bind(document);

// ✓ find is already available — just use it
const btn = find('#submit');
```

### Mounting a component from a page

```js
// pages/tasks.html script:
import { component } from '../../build/oja.core.esm.js';

const listEl = find('#task-list');

tasks().forEach(task => {
    const wrapper = document.createElement('div');
    listEl.appendChild(wrapper);
    component.mount(wrapper, 'components/task-item.html', task);
});
```

### Passing props

Props are passed as the third argument. Signals are automatically unwrapped
by the `props` proxy — access `props.tasks` and it calls `tasks()` for you:

```js
// Mounting:
component.mount(el, 'components/task-item.html', {
    task,       // plain object
    tasks,      // reactive signal — proxy unwraps it
    onComplete, // callback function
});

// Inside task-item.html:
const task  = props.task;      // plain value
const all   = props.tasks;     // signal unwrapped automatically
```

### Template interpolation

Inside the HTML markup (not the script), use `{{variable}}` syntax:

```html
<div class="task" data-task-id="{{id}}">
    <span class="task-text">{{text}}</span>
    <span class="task-status">{{done ? 'Done' : 'Pending'}}</span>
</div>
```

---

## Part 8 — Forms

`form.on()` handles the full lifecycle in one call:

```js
import { form, notify } from '../../build/oja.core.esm.js';

const formEl = find('#task-form');

form.on(formEl, {
    submit: async (data) => {
        const ok = await form.validate(formEl, {
            title: (v) => v.trim().length >= 2 || 'Title must be at least 2 characters',
        });
        if (!ok) throw new Error('validation');
        return data;
    },
    success: (data) => {
        notify.success('Task added!');
        form.reset(formEl);
    },
    error: (err) => {
        if (err.message !== 'validation') notify.error(err.message);
    },
});
```

The `submit` handler receives the form's field values as a plain object.
Throw to trigger `error`. Return a value to trigger `success`.
The string `'validation'` is a sentinel — use it to prevent double-notifying
when `form.validate()` has already shown inline field errors.

### Image preview

```js
form.image(find('#photo-input'), find('#preview-img'), {
    onError: (msg) => notify.error(msg),
});
```

One line replaces the manual `FileReader` dance.

---

## Part 9 — Notifications

```js
import { notify } from '../../build/oja.core.esm.js';

notify.success('Task saved!');
notify.error('Something went wrong');
notify.warn('Unsaved changes');
notify.info('Tip: press N to add a task');

// Custom duration
notify.success('Done!', { duration: 5000 });
```

Position is set once in `app.js`:

```js
notify.setPosition('bottom-right'); // default: top-right
```

---

## Part 10 — Keyboard shortcuts

```js
import { keys } from './build/oja.core.esm.js';

keys({
    'n':   () => openNewTaskModal(),
    'g h': () => router.navigate('/'),
    'g t': () => router.navigate('/tasks'),
    'g p': () => router.navigate('/profile'),
    '?':   () => notify.info('n: New task · g h: Home · g t: Tasks'),
});
```

Multi-key sequences like `g h` work out of the box with a configurable timeout.

---

## Part 11 — Modals

Declare the modal shell in `index.html`:

```html
<div class="modal-overlay" id="task-modal">
    <div class="modal">
        <div class="modal-header">
            <button data-action="modal-close">✕</button>
            <h2>New Task</h2>
        </div>
        <div data-modal-body></div>
    </div>
</div>
```

Open and close from anywhere:

```js
import { modal, Out } from './build/oja.core.esm.js';

// Open — body is any Out responder
modal.open('task-modal', {
    body: Out.component('components/new-task-form.html', { currentUser }),
});

// Close — from app.js global handler or inside the component
modal.close();
```

Wire the close button globally in `app.js`:

```js
on('[data-action="modal-close"]', 'click', () => modal.close());
```

---

## Part 12 — Channels (async pipelines)

Channels are Go-style pipes for coordinating async work without callbacks.
They shine when you have a producer and a consumer that should run independently.

```js
import { Channel, go } from './build/oja.core.esm.js';

const uploads = new Channel(5); // buffered, holds up to 5 items

// Producer — fires when the user picks files
on(find('#file-input'), 'change', async (e) => {
    for (const file of e.target.files) {
        await uploads.send(file);
    }
    uploads.close();
});

// Consumer — processes files one at a time, decoupled from the UI
go(async () => {
    for await (const file of uploads) {
        await uploadFile(file);
        notify.success(`${file.name} uploaded`);
    }
});
```

`go()` is fire-and-forget — it does not return a promise.
Use channels when you want to decouple the thing that produces work from the
thing that processes it.

---

## Part 13 — Auth

```js
import { auth, context } from './build/oja.core.esm.js';

export const [currentUser, setCurrentUser] = context('user', null);

// Define access levels
auth.level('public',    () => true);
auth.level('protected', () => currentUser() !== null);

// React to session start (e.g. after login)
auth.session.OnStart(async () => {
    const dest = auth.session.intendedPath() || '/';
    auth.session.clearIntendedPath();
    router.navigate(dest);
});

// React to session expiry
auth.session.OnExpiry(() => {
    setCurrentUser(null);
    router.navigate('/login');
    notify.warn('Session expired. Please sign in again.');
});
```

In your login page, call `auth.session.start()` after verifying credentials:

```js
form.on(formEl, {
    submit: async (data) => {
        const user = await api.login(data.username, data.password);
        await auth.session.start(user.token);
        setCurrentUser(user);
        return user;
    },
    success: () => notify.success('Welcome back!'),
    error:   (err) => notify.error(err.message),
});
```

---

## Part 14 — Putting it all together

Here is the complete `app.js` for the task board described at the start of
this guide. Every concept from the sections above appears exactly once,
in the order Oja expects it.

```js
import {
    Router, Out, layout, modal,
    context, auth, notify, on, keys,
} from './build/oja.core.esm.js';

// ── 1. Global context ─────────────────────────────────────────────────────
export const [currentUser, setCurrentUser] = context('user', null);
export const [tasks, setTasks]             = context('tasks', []);

// ── 2. Auth ───────────────────────────────────────────────────────────────
auth.level('public',    () => true);
auth.level('protected', () => currentUser() !== null);

auth.session.OnStart(async () => {
    const dest = auth.session.intendedPath() || '/';
    auth.session.clearIntendedPath();
    router.navigate(dest);
});

auth.session.OnExpiry(() => {
    setCurrentUser(null);
    router.navigate('/login');
    notify.warn('Session expired');
});

// ── 3. Layout ─────────────────────────────────────────────────────────────
await layout.apply('#app', 'layouts/main.html', { currentUser });

// ── 4. Router ─────────────────────────────────────────────────────────────
const router = new Router({ mode: 'hash', outlet: '#main-outlet' });

router.Get('/login', Out.component('pages/login.html'));

const app = router.Group('/');
app.Use(async (ctx, next) => {
    if (!currentUser() && ctx.path !== '/login') {
        auth.session.setIntendedPath(ctx.path);
        ctx.redirect('/login');
        return;
    }
    await next();
});

app.Get('/',        Out.component('pages/home.html',    { currentUser, tasks }));
app.Get('/tasks',   Out.component('pages/tasks.html',   { currentUser, tasks }));
app.Get('/profile', Out.component('pages/profile.html', { currentUser, tasks }));

router.NotFound(Out.component('pages/404.html'));

// ── 5. Global event handlers ──────────────────────────────────────────────
on('[data-action="new-task"]', 'click', () => {
    modal.open('task-modal', {
        body: Out.component('components/task-form.html', { currentUser }),
    });
});

on('[data-action="modal-close"]', 'click', () => modal.close());

keys({
    'n':   () => modal.open('task-modal', {
        body: Out.component('components/task-form.html', { currentUser }),
    }),
    'g h': () => router.navigate('/'),
    'g t': () => router.navigate('/tasks'),
    'g p': () => router.navigate('/profile'),
    '?':   () => notify.info('n: New task · g h: Home · g t: Tasks · g p: Profile'),
});

// ── 6. Start ──────────────────────────────────────────────────────────────
router.start('/');
```

---

## Common mistakes

| Mistake | What breaks | Fix |
|---|---|---|
| `const find = ...` in a component | `SyntaxError: Identifier 'find' has already been declared` | `find` is injected — never redeclare it. Same for `container`, `findAll`, `props` |
| `router.start()` before `await layout.apply()` | Router can't find `#main-outlet`, nothing renders | Always `await layout.apply()` first |
| Passing `tasks()` as a prop instead of `tasks` | Component gets a frozen snapshot, never updates | Pass the signal: `{ tasks }` not `{ tasks: tasks() }` |
| `document.getElementById` inside a component | May grab an element from another component instance | Use `find('#id')` — it is scoped to the current component |
| Declaring `router` after `auth.session.OnStart` | `ReferenceError: Cannot access 'router' before initialization` | Declare `router` before any auth session callbacks |
| `go()` return value | `go()` returns `undefined` — it is fire-and-forget | Use a flag or a Channel to observe completion |

---

## Part 15 — VFS and offline-first apps

VFS (Virtual File System) stores your app's HTML, JS, and CSS in IndexedDB inside the browser. Components load from IndexedDB first, then fall back to the network. After the first visit, the app works offline.

VFS is entirely optional. Everything in Parts 1–14 works without it.

### Basic setup

```js
import { VFS, Router, Out } from './build/oja.core.esm.js';

const vfs = new VFS('my-app');
await vfs.ready();

// Mount remote files into IndexedDB on first load
// On subsequent loads they are already there — mount() skips existing files
await vfs.mount('https://cdn.example.com/my-app/');

// Wire to router — every Out.component() call checks VFS before the network
const router = new Router({ outlet: '#app', vfs });
router.Get('/', Out.c('pages/home.html'));
router.start('/');
```

### The manifest file

Place a `vfs.json` at your remote root listing every file to cache:

```json
{
  "files": [
    "pages/home.html",
    "pages/about.html",
    "components/nav.html",
    "app.js",
    "style.css"
  ]
}
```

### Reading and writing files

```js
vfs.write('notes.html', html);     // fire and forget
await vfs.flush();                  // guarantee it landed in IndexedDB

const html  = await vfs.readText('notes.html');
const bytes = await vfs.read('logo.png');  // ArrayBuffer for binary

await vfs.rm('old.html');
const files = await vfs.ls('/');           // [{ path, size, dirty, updatedAt }]
```

### Per-route VFS

When you have multiple VFS instances or want explicit control without touching the global registration:

```js
// vfs.component() pins the VFS to this specific Out instance
router.Get('/', vfs.component('pages/home.html', { user }));
router.Get('/admin', adminVfs.component('pages/admin.html'));

// Shorthand — identical to vfs.component()
router.Get('/', vfs.c('pages/home.html'));
```

### Reacting to changes

```js
// Watch files under a prefix — fires on write, delete, or remote sync
const off = vfs.onChange('pages/', (path, content) => {
    console.log('page changed:', path);
    reloadPreview();
});

// Lifecycle events
vfs.on('mounted',  ({ base, fetched }) => console.log(fetched.length, 'files cached'));
vfs.on('synced',   ({ updated }) => console.log(updated.length, 'files updated'));
vfs.on('conflict', ({ path }) => showBadge(path));

off(); // stop watching
```

### Conflict policy

When a remote sync finds a file that has been modified locally, VFS follows the policy you set:

```js
// Default — never overwrite local changes
const vfs = new VFS('my-app', { onConflict: 'keep-local' });

// Always accept the remote version
const vfs = new VFS('my-app', { onConflict: 'take-remote' });

// Decide per file — return 'local' or 'remote'
const vfs = new VFS('my-app', {
    onConflict: (path, local, remote) => {
        return path.startsWith('data/') ? 'remote' : 'local';
    },
});
```

---

## Part 16 — oja.config.json

`oja.config.json` is the optional project-level configuration file. It is the single source of truth for your Oja app — like `package.json` is to Node. Nothing requires it. When it exists, it configures VFS, routes, and auth in one place.

```json
{
  "version": "1.0.0",
  "name": "my-app",

  "vfs": {
    "manifest": "vfs.json",
    "conflict": "keep-local",
    "sync": { "auto": true, "interval": 60000 }
  },

  "routes": {
    "protected": ["/admin", "/settings"]
  },

  "auth": {
    "loginPath": "/login"
  }
}
```

Place this file at the root of your app (same directory as `index.html`).

### Loading config

```js
import { config } from './build/oja.core.esm.js';

// Load from the same directory as app.js
await config.load();

// Or from a remote base URL
await config.load('https://cdn.example.com/my-app/');

// Check if it was found
if (config.loaded) {
    console.log('app:', config.get('name'));
}
```

`config.load()` returns `true` if found, `false` if absent (404). It never throws on a missing file — only on parse errors or unexpected server errors.

### Applying config

```js
import { config, VFS, Router, auth } from './build/oja.core.esm.js';

await config.load();

const vfs    = new VFS('my-app');
const router = new Router({ outlet: '#app', vfs });

await vfs.ready();

// Reads config.vfs — mounts remote files, wires sync interval, sets conflict policy
await config.applyVFS(vfs, './');

// Reads config.routes.protected — registers auth middleware for each protected path
config.applyRouter(router, { auth });

router.Get('/login', Out.c('pages/login.html'));
router.start('/');
```

### Reading arbitrary sections

```js
const vfsCfg    = config.get('vfs');     // → object or null
const appName   = config.get('name');    // → string or null
const routesCfg = config.get('routes'); // → object or null
const full      = config.all();          // → full object or {}
```

### No config — still works

```js
// Without oja.config.json — everything works exactly as before
const router = new Router({ outlet: '#app' });
router.Get('/', Out.c('pages/home.html'));
router.start('/');
```

Config is progressive enhancement. Start without it. Add it when your app needs centralised configuration.
---

## Part 17 — Engine: smart DOM updates

The task board's notes list has been re-rendering on every update with a blunt
`effect(() => { el.innerHTML = buildHtml(tasks()) })`. That works, but it
destroys and rebuilds every DOM node every time a single task changes — focus
is lost, scroll position jumps, and CSS transitions can't run on elements that
no longer exist.

The engine fixes all three problems without changing your data model.

### Sharing the store

The engine has its own isolated store by default. To connect it to your app's
reactive state, call `engine.useStore(store)` once in `app.js`, before any
routes are registered:

```js
import { engine, Store } from './build/oja.core.esm.js';

const store = new Store('taskboard');
engine.useStore(store);
```

Now `engine.set()` writes into the same store that the rest of your app reads
from, and `data-oja-bind` attributes in HTML update automatically when state
changes.

### Replacing innerHTML with engine.list()

Here is the notes list before:

```js
// pages/tasks.html — before
const listEl = find('#task-list');

effect(() => {
    listEl.innerHTML = tasks().map(t => `
        <div class="task-item" data-id="${t.id}">
            <span>${t.text}</span>
        </div>
    `).join('');
});
```

Every time `tasks()` changes, every node is destroyed and rebuilt. Here is
the same thing with `engine.list()`:

```js
// pages/tasks.html — after
import { engine, component } from '../../build/oja.core.esm.js';

const listEl = find('#task-list');

function renderTask(task, existing) {
    const el = existing || document.createElement('div');
    el.className = 'task-item';
    el.dataset.id = task.id;
    el.querySelector('span').textContent = task.text;
    return el;
}

effect(() => {
    engine.list(listEl, tasks(), {
        key:    t => t.id,
        render: renderTask,
        empty:  () => {
            const el = document.createElement('p');
            el.className = 'empty-hint';
            el.textContent = 'No tasks yet — press N to add one';
            return el;
        },
    });
});
```

`engine.list()` reconciles by key. When a task is added, only the new node is
inserted. When one is removed, only that node is removed. Existing nodes are
passed back to `render` as the second argument so you can update them in place.

### Morphing the profile panel

The profile page rebuilds a panel from server data on an interval. Before,
it wiped and rebuilt the entire panel, losing any open tooltips or focused
inputs. With `engine.morph()`:

```js
// pages/profile.html
import { engine, component } from '../../build/oja.core.esm.js';

async function refreshStats() {
    const stats = await api.get('/me/stats');
    const html  = buildStatsHtml(stats); // expensive string builder
    await engine.morph(find('#stats-panel'), html);
}

component.interval(refreshStats, 5000);
component.onMount(() => refreshStats());
```

`morph()` tree-diffs the existing panel against the new HTML, patching only
nodes that changed. Focus and scroll position are preserved.

If building the HTML string itself is expensive, use `shouldMorph()` to skip
the build when the content hasn't changed:

```js
async function refreshStats() {
    const stats = await api.get('/me/stats');
    const html  = buildStatsHtml(stats);
    if (!engine.shouldMorph(find('#stats-panel'), html)) return;
    await engine.morph(find('#stats-panel'), html);
}
```

`shouldMorph()` is for skipping an expensive build step — not for guarding
`morph()` itself. `morph()` already short-circuits internally when HTML is
identical to its last call.

### Declarative bindings in HTML

The task counter in the nav bar was previously wired by an effect:

```js
effect(() => {
    find('#task-count').textContent = tasks().length;
});
```

With the engine wired to the store, you can express this in HTML instead:

```html
<!-- layouts/main.html -->
<span id="task-count" data-oja-bind="task.count"></span>
```

```js
// app.js — write the store key whenever tasks change
import { engine } from './build/oja.core.esm.js';

effect(() => {
    engine.set('task.count', tasks().length);
});
```

For bindings inside a component, call `engine.scan(el)` inside `onMount` so
it picks up `data-oja-bind` attributes without a global MutationObserver:

```js
component.onMount(el => {
    engine.scan(el);
});
```

For shell-level bindings that should be active across all routes, call
`engine.enableAutoBind()` once in `app.js`. This starts a `MutationObserver`
that scans new nodes automatically — use it sparingly.

---

## Part 18 — Search and autocomplete

The task board has grown. There are enough tasks that finding one by scrolling
is slow. This part adds a live search box that filters tasks as you type, then
adds tag autocomplete on the task form.

### Indexing the tasks

```js
// app.js — build the index once, update it when tasks change
import { Search } from './build/oja.core.esm.js';

export const taskSearch = new Search([], {
    fields:  ['text', 'tag'],
    weights: { text: 2, tag: 1 },
});

effect(() => {
    taskSearch.clear();
    for (const t of tasks()) taskSearch.add(t.id, t);
});
```

The `Search` instance lives in `app.js` so any page can import it. The
`effect` rebuilds the index whenever `tasks()` changes — adding, updating,
and removing tasks all flow through the same path.

### Wiring the search box

```js
// pages/tasks.html
import { on, engine }     from '../../build/oja.core.esm.js';
import { taskSearch }     from '../../app.js';

const searchEl = find('#task-search');
const listEl   = find('#task-list');

function showTasks(items) {
    engine.list(listEl, items, {
        key:    t => t.id,
        render: renderTask,
        empty:  () => {
            const el = document.createElement('p');
            el.textContent = searchEl.value ? 'No matches' : 'No tasks yet';
            return el;
        },
    });
}

// Initial render — show everything
showTasks(tasks());

// Filter on input
on(searchEl, 'input', (e) => {
    const q = e.target.value.trim();
    if (!q) { showTasks(tasks()); return; }
    const results = taskSearch.search(q);
    showTasks(results.map(r => r.doc));
});
```

The search box now filters the existing `engine.list()` reconciler — only
changed nodes are patched, so the list never flickers.

### Tag autocomplete on the form

The task form has a tag input. Build a `Trie` from the tags already in use
and attach autocomplete to it:

```js
// components/task-form.html
import { Trie, form } from '../../build/oja.core.esm.js';
import { tasks }      from '../../app.js';

// Build a trie of every tag already in use
const tagTrie = new Trie();
for (const t of tasks()) {
    if (t.tag) tagTrie.insert(t.tag);
}

const tagInput = find('#task-tag');

// Path A — standalone
import { autocomplete } from '../../build/oja.core.esm.js';
const handle = autocomplete.attach(tagInput, {
    source:   tagTrie,
    limit:    6,
    onSelect: (tag) => { tagInput.value = tag; },
});

// Path B — via form API (identical result)
const handle = form.input(tagInput, {
    source:   tagTrie,
    limit:    6,
    onSelect: (tag) => { tagInput.value = tag; },
});

// Clean up when the component unmounts
import { component } from '../../build/oja.core.esm.js';
component.onUnmount(() => handle.destroy());
```

Both paths attach the same suggestion list. Use `autocomplete.attach()` when
the input is not part of a form handled by `form.on()`. Use `form.input()`
when it is — it reads the resolved element the same way all other `form.*`
methods do.

### Fuzzy search

If your users misspell tags, enable fuzzy matching on the `Search` instance:

```js
export const taskSearch = new Search([], {
    fields:      ['text', 'tag'],
    weights:     { text: 2, tag: 1 },
    fuzzy:       true,
    maxDistance: 1,
});
```

`fuzzy: true` is per-instance. You can also override it per call:

```js
const results = taskSearch.search(q, { fuzzy: true, maxDistance: 2 });
```

---

## Part 19 — Table

The tasks page currently renders a plain list. Once a project has dozens of
tasks, you want sortable columns, pagination, and row actions. `table.render()`
adds all of this in one call without replacing the data flow you already have.

### Basic table

```js
// pages/tasks.html
import { table } from '../../build/oja.full.esm.js';

const headers = [
    { key: 'text',   label: 'Task',   sortable: true  },
    { key: 'tag',    label: 'Tag',    sortable: true  },
    { key: 'done',   label: 'Status', sortable: false },
];

const t = table.render(find('#task-table'), tasks(), headers, {
    pageSize:   10,
    onRowClick: (row) => openTaskDetail(row),
});
```

That replaces the entire list. No template string, no `effect`, no manual
`innerHTML`. The table handles sorting and pagination internally.

### Updating when tasks change

`table.render()` returns a handle. Call `t.update()` to push new data without
rebuilding the table from scratch:

```js
effect(() => {
    t.update(tasks());
});
```

The sort state and current page are preserved across updates. Only the rows
change.

### Cell shapes

Plain string and number values render as text. Pass a descriptor object when
you need richer output:

```js
const rows = tasks().map(t => ({
    text:   { value: t.text, onClick: () => openDetail(t) },
    tag:    t.tag || '',
    done:   { value: t.done ? 'Done' : 'Pending', badge: t.done ? 'success' : 'neutral' },
}));
```

The `badge` shape applies a coloured chip. The `onClick` shape turns the cell
into a clickable link without wrapping the whole row.

### Row actions

Add per-row action buttons via the `actions` option:

```js
const t = table.render(find('#task-table'), tasks(), headers, {
    pageSize: 10,
    actions: [
        {
            label:   'Complete',
            onClick: (row) => markDone(row.id),
        },
        {
            label:   'Delete',
            onClick: (row) => deleteTask(row.id),
            style:   'danger',
        },
    ],
});
```

Actions appear as a column on the right. `style: 'danger'` applies the danger
colour token from `oja.css`.

### Remote data

When tasks live on a server and are too large to load all at once, pass
`fetchData` instead of rows. The table calls it on mount, on sort change, and
on page change:

```js
const t = table.render(find('#task-table'), [], headers, {
    pageSize: 25,
    fetchData: async (page, size, sortKey, dir) => {
        const res = await api.get(
            `/tasks?page=${page}&size=${size}&sort=${sortKey}&dir=${dir}`
        );
        return { data: res.rows, total: res.total };
    },
});
```

`total` tells the table how many pages to show. `data` is the current page's
rows. The local rows array passed as the second argument is ignored when
`fetchData` is present.

### Loading state

```js
t.setLoading(true);
const fresh = await api.get('/tasks');
t.update(fresh);
t.setLoading(false);
```

`setLoading(true)` replaces the table body with the loading indicator defined
by `loadingText` (default: `'Loading…'`).