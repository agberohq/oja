# Oja — Learn by Building

This guide builds a small but complete app from scratch — a personal task board
with a counter, a notes list, and a profile page. Every Oja concept is introduced
exactly when it is needed, so you never learn something in the abstract.

By the end you will know how to use every core primitive:
`state`, `effect`, `context`, `derived`, `batch`, routing, components,
layouts, forms, modals, keyboard shortcuts, auth guards, the engine,
search, tables, VFS, config, progress tracking, component communication
with `signal()`, and building DOM with `make()`.

No build step. No compiler. Just files.

---

## Before you start

### Get Oja

No install needed. Add a stylesheet link and an import map to `index.html` —
that is all. The import map goes in `index.html` once. Every script on the
page, including the inline scripts inside your component `.html` files, can
then use the bare `@agberohq/oja` specifier. You do not repeat it anywhere else.

```html
<head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@agberohq/oja@latest/build/oja.min.css">

  <script type="importmap">
    {
        "imports": {
            "@agberohq/oja": "https://cdn.jsdelivr.net/npm/@agberohq/oja@latest/build/oja.full.esm.js"
        }
    }
  </script>
</head>
```

If you already use npm in your project and prefer to manage Oja as a local
dependency, `npm install @agberohq/oja` and point the import map at
`./node_modules/@agberohq/oja/build/oja.full.esm.js` instead. Everything else
is identical.

All examples in this tutorial use `from '@agberohq/oja'`.

### Serve the project

Browsers block ES module imports from `file://`. Serve the project from a
local HTTP server — any of these work:

```bash
npx serve .
# or
python3 -m http.server 3000
# or
npx vite --open
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
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@agberohq/oja@latest/build/oja.min.css">
    <script type="importmap">
    { "imports": { "@agberohq/oja": "https://cdn.jsdelivr.net/npm/@agberohq/oja@latest/build/oja.full.esm.js" } }
    </script>
</head>
<body>
<div id="app"></div>
<script type="module" src="app.js"></script>
</body>
</html>
```

**app.js**

```js
import { state, effect, make, on } from '@agberohq/oja';

const [count, setCount] = state(0);

// make() builds DOM — no HTML strings, no innerHTML
const btn = make.button({ id: 'btn', class: 'btn' }, 'Clicked: 0')
    .appendTo('#app');

effect(() => {
    btn.update({ text: `Clicked: ${count()}` });
});

on('#btn', 'click', () => setCount(n => n + 1));
```

This is Oja at its core — `state` holds a value, `effect` reacts to it,
`make` builds the DOM, `on` handles events. Nothing else is involved.

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

batch(() => {
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
import { context } from '@agberohq/oja';
export const [currentUser, setCurrentUser] = context('user', null);

// profile.html — read anywhere
import { context } from '@agberohq/oja';
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

## Part 3b — make() — building DOM without strings

The `make()` function builds DOM elements programmatically. Instead of writing
HTML strings and injecting them with `innerHTML`, you describe the element
you want and Oja builds it.

```js
import { make } from '@agberohq/oja';

// make(tag, options?, ...children)
const card = make('div', { class: 'host-card', data: { id: host.id } },
    make('h2', { class: 'hostname' }, host.name),
    make('span', { class: 'status' }, 'Online'),
);
```

But you will mostly use the shorthand factories — one for every HTML tag:

```js
make.div()      make.span()     make.p()        make.a()
make.button()   make.input()    make.ul()        make.li()
make.h1()  ...  make.h6()       make.table()     make.tr()  make.td()
make.form()     make.label()    make.section()   make.nav()
```

Every shorthand accepts the same `(options?, ...children)` signature:

```js
make.button({ class: 'btn-primary', on: { click: save } }, 'Save changes')
make.input({ attrs: { type: 'email', placeholder: 'you@example.com' } })
make.a({ attrs: { href: '#/hosts' }, class: 'nav-link' }, 'Hosts')
```

### Options

| Key | Type | What it does |
|-----|------|--------------| 
| `class` | `string \| string[]` | Sets className — string or array of names |
| `id` | `string` | Sets the element's id |
| `style` | `object` | Inline styles — `{ color: 'red', fontSize: '14px' }` |
| `attrs` | `object` | HTML attributes — `{ type: 'email', disabled: '' }` |
| `data` | `object` | data-* attributes — `{ id: '42' }` → `data-id="42"` |
| `on` | `object` | Event listeners — `{ click: fn, input: fn }` |
| `text` | `string` | Sets textContent |
| `html` | `string` | Sets innerHTML |

### Placement — where the chain shines

The real power is the placement methods. Every element returned by `make()` has
five of them — all return `this` so you can keep chaining:

```js
// Build a card and append it to the host list
make.div({ class: 'host-card', data: { id: host.id } },
    make.h2({ class: 'hostname' }, host.name),
    make.p({ class: 'status' }, host.alive ? 'Online' : 'Offline'),
    make.button({ class: 'btn-sm', on: { click: () => edit(host.id) } }, 'Edit'),
)
.appendTo('#host-list');   // append as last child

// Other placement methods — same API
.prependTo('#list')        // prepend as first child
.after('#some-element')    // insert as next sibling
.before('#some-element')   // insert as previous sibling
.replace('#old-element')   // replace an element entirely
```

After placement, you can keep going with `.update()`:

```js
make.div({ class: 'badge' }, 'Loading…')
    .appendTo('#notifications')
    .update({ class: { add: 'badge-info' } });
```

### Children can be strings, numbers, elements, or arrays

```js
make.ul({ class: 'tag-list' },
    tags.map(t => make.li({ class: 'tag' }, t)),  // array of elements
)

make.p({}, 'You have ', count, ' messages')       // string + number + string

make.div({}, existingElement)                      // existing DOM element
```

### Enhance an existing element

If you already have an element — from `find()`, from the DOM, from anywhere —
you can enhance it by passing it directly to `make()`:

```js
const el = document.getElementById('legacy-panel');
make(el).appendTo('#new-container').update({ class: { add: 'migrated' } });
```

---

## Part 4 — Project structure

Once an app grows past one page, organise it like this:

```
my-app/
  index.html          ← shell HTML, loads app.js — import map lives here
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
import { Router, Out } from '@agberohq/oja';

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
router.Get('/task/{id}', Out.component('pages/task-detail.html'));

// Inside task-detail.html script:
import { props } from '@agberohq/oja';
const taskId = props().params.id;
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
const app = router.Group('/');
app.Use(async (ctx, next) => {
    if (!currentUser()) {
        ctx.redirect('/login');
        return;
    }
    await next();
});

app.Get('/',        Out.component('pages/home.html'));
app.Get('/profile', Out.component('pages/profile.html'));
```


### Groups and nested routes

`router.Group(prefix)` creates a sub-router scoped to a URL prefix. Routes
registered on the group are resolved relative to that prefix, and middleware
added with `group.Use()` only applies to routes inside the group — it never
leaks to the parent.

This is the Go/chi pattern, brought to the browser. Middleware stacks correctly:
a nested group inherits everything the parent group applied, then can add its own
on top.

```js
// Protected section — all routes under /app require a logged-in user
const app = router.Group('/app');
app.Use(async (ctx, next) => {
    if (!currentUser()) {
        ctx.redirect('/login');
        return;
    }
    await next();
});

app.Get('/dashboard', Out.component('pages/dashboard.html'));
app.Get('/hosts',     Out.component('pages/hosts.html'));

// Nested group — adds a second middleware layer for host detail pages
// Both the auth check AND the host loader run before any host route renders
const hosts = app.Group('/hosts');
hosts.Use(async (ctx, next) => {
    ctx.host = await api.get(`/hosts/${ctx.params.id}`);
    if (!ctx.host) { ctx.redirect('/app/hosts'); return; }
    await next();
});
hosts.Get('/{id}',        Out.component('pages/host-detail.html'));
hosts.Get('/{id}/routes', Out.component('pages/host-routes.html'));
```

Named routes let you generate URLs from a name and params instead of
constructing strings manually. Register a name on the group — it lands on the
parent router automatically, so navigation works from anywhere:

```js
app.name('host.detail', '/hosts/{id}');

// Later — anywhere in the app
router.navigateTo('host.detail', { id: 42 });
router.path('host.detail', { id: 42 }); // → '/app/hosts/42'
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
import { layout, Router, Out } from '@agberohq/oja';

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

### What your component script imports

When Oja mounts a component, it runs the inline `<script type="module">`.
Your script imports what it needs — explicitly, like any other ES module.
There are no magic globals, no injected variables. Your IDE can see every
dependency, autocomplete it, and type-check it.

The four imports every component script uses:

```js
import { find, container, props, ready } from '@agberohq/oja';
```

**`find(selector)`** searches within this component's container automatically.
Multiple instances of the same component on the same page never interfere with
each other because `find` knows which instance it belongs to.

**`container()`** returns the actual DOM element this script was mounted into —
the `<div>` or `<section>` your router or `component.mount()` call pointed at.

**`props()`** returns the data passed at mount time as a read-only object.
Signals in props are unwrapped automatically — access `props().tasks` and it
calls `tasks()` for you.

**`ready()`** signals that async setup is complete. Calling it is optional — if
you don't, Oja resolves the mount automatically when the script finishes
executing. Call it explicitly when you have async setup work that must complete
before the parent considers this slot ready.

Here is why `find` scoping matters. Suppose you have the same component mounted
twice on the same page:

```html
<!-- components/status-badge.html -->
<span class="badge">Loading…</span>

<script type="module">
import { find, props } from '@agberohq/oja';

// ✗ WRONG — grabs the first .badge on the entire page
//   If two instances are mounted, they'll both update the same node
const badge = document.querySelector('.badge');
badge.textContent = props().status;

// ✓ RIGHT — scoped to THIS instance automatically
const badge = find('.badge');
badge.textContent = props().status;
</script>
```

| Import | What it returns |
|--------|----------------|
| `find(sel)` | Enhanced element scoped to this component |
| `findAll(sel)` | NodeList scoped to this component |
| `container()` | The DOM element this script is mounted into |
| `props()` | Read-only object of the data passed at mount time |
| `ready()` | Call to signal that async setup is complete |

### Mounting a component from a page

```js
// pages/tasks.html script:
import { find, component } from '@agberohq/oja';

const listEl = find('#task-list');

tasks().forEach(task => {
    const wrapper = document.createElement('div');
    listEl.appendChild(wrapper);
    component.mount(wrapper, 'components/task-item.html', task);
});
```

### Passing props

Props are passed as the third argument. Signals are automatically unwrapped
by the `props()` return value — access `props().tasks` and it calls `tasks()` for you:

```js
// Mounting:
component.mount(el, 'components/task-item.html', {
    task,       // plain object
    tasks,      // reactive signal — unwrapped automatically
    onComplete, // callback function
});

// Inside task-item.html:
import { props } from '@agberohq/oja';
const task  = props().task;      // plain value
const all   = props().tasks;     // signal unwrapped automatically
```

### Template interpolation

Inside the HTML markup (not the script), use `{{variable}}` syntax:

```html
<div class="task" data-task-id="{{id}}">
    <span class="task-text">{{text}}</span>
    <span class="task-status">{{done ? 'Done' : 'Pending'}}</span>
</div>
```

### Rendering and updating elements

Every element you get back from `find()`, `query()`, `findAll()`, or `make()`
is enhanced with `.update()`, `.list()`, and `.render()`. These three methods
cover everything you need to change an element after it is mounted.

**`.render(out)`** — replace the element's contents with any `Out`:

```js
import { find, Out } from '@agberohq/oja';

const panelEl = find('#details-panel');

panelEl.render(Out.component('components/detail.html', { item }));
panelEl.render(Out.html(`<p>Updated at ${new Date().toLocaleTimeString()}</p>`));
```

**`.update(descriptor)`** — declarative patch — describe what the element should
look like and Oja applies the minimum change:

```js
find('#badge').update({
    text:  'Online',
    class: { add: 'badge-success', remove: 'badge-loading' },
    attr:  { 'data-status': 'alive' },
    style: { fontWeight: 'bold' },
});

// out key — render any Out
find('#panel').update({ out: Out.c('components/detail.html', { host }) });

// fn key — full control, return an Out or mutate directly
find('#chart').update({
    fn: async (el) => {
        const data = await api.get('/metrics');
        return Out.timeSeries(data.series, { height: 80 });
    },
});
```

Any value that is a function is treated as **reactive** — it is wrapped in
`effect()` automatically and re-runs whenever a signal it reads changes:

```js
// This updates automatically whenever host() changes
find('#status').update({
    text:  () => host().alive ? 'Online' : 'Offline',
    class: () => ({ add: host().alive ? 'badge-success' : 'badge-error',
                    remove: host().alive ? 'badge-error' : 'badge-success' }),
});
```

**`.list(items, options)`** — keyed list reconciliation directly on an element.
Only changed nodes are patched — no full rebuild:

```js
find('#host-list').list(() => hosts(), {
    key:    h => h.id,
    render: h => Out.c('components/host-row.html', h),
    empty:  Out.h('<p>No hosts configured</p>'),
});
```

Pass a function as `items` to make it reactive — the list re-reconciles
automatically whenever the signal changes.

---

## Part 8 — Forms

`form.on()` handles the full lifecycle in one call:

```js
import { find, component } from '@agberohq/oja';
import { form, notify } from '@agberohq/oja';

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

### Dirty tracking — detecting unsaved changes

For the task board's edit form, you want to warn the user if they navigate
away with unsaved changes. `form.dirty()` watches the form and fires a callback
whenever any field's dirty state changes:

```js
const stop = form.dirty(formEl, (field, isDirty) => {
    find('#save-btn').disabled = !isDirty;
});

// Stop watching when the component unmounts
component.onUnmount(() => stop());
```

The callback receives the field name and whether it is now dirty relative to
its value when `form.dirty()` was first called. You can reset the baseline at
any time — for example after a successful save — by calling
`form.resetDirty(formEl)`.

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
import { notify } from '@agberohq/oja';

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

### Banners — persistent full-width messages

Toasts disappear on their own. Banners stay until you dismiss them. Use them
for things the user must not miss — a lost connection, a background job still
running, or a warning that is not tied to any single action:

```js
// Show a banner when the app loses its server connection
notify.banner('⚠️ Connection lost — retrying…', { type: 'warn' });

// Dismiss it once the connection is restored
notify.dismissBanner();

// The message accepts an Out responder — useful when you need a link inside the banner
notify.banner(Out.html('⚠️ Maintenance in 5 minutes. <a href="#/status">Details</a>'), {
    type: 'warn',
});
```

---

## Part 10 — Keyboard shortcuts

```js
import { keys } from '@agberohq/oja';

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
import { modal, Out } from '@agberohq/oja';

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

### Programmatic prompt

Sometimes you need a quick text input from the user but you don't want to build
a whole modal for it. `modal.prompt()` handles this — it auto-injects a minimal
modal if you don't have one in the HTML, shows it, waits for the user to type
and click OK or Cancel, then resolves with the value or `null`.

```js
// No HTML needed — Oja injects the modal automatically
const name = await modal.prompt('What should we call this host?', {
    default: 'api.example.com',
});

if (name) {
    await api.post('/hosts', { hostname: name });
    notify.success(`${name} added`);
}
```

### Close guards — preventing accidental data loss

If a form inside a modal can have unsaved changes, you want to warn the user
before the modal closes. `modal.beforeClose()` registers a guard function that
runs every time a close is attempted. If the guard returns `false`, the close
is cancelled.

```js
// Register the guard when the component mounts
const off = modal.beforeClose('editModal', async () => {
    // If the form is clean, allow close immediately
    if (!form.isDirty('#editForm')) return true;

    // Otherwise ask — modal.confirm() is itself a modal, so they stack
    const discard = await modal.confirm('Discard unsaved changes?');
    return discard; // true = close, false = stay
});

// Remove the guard when the component unmounts
component.onUnmount(() => off());
```

### modal.open() returns a Promise

`modal.open()` returns `Promise<Element>` — the modal element once it is ready.
For most cases you don't need this. But when the modal body is an async
component and you need to interact with it immediately after opening, awaiting
gives you a clean moment:

```js
const el = await modal.open('editModal', {
    body: Out.component('components/edit-form.html', { item }),
    size: 'lg',
});
// The component has finished rendering by here
el.querySelector('#first-input')?.focus();
```

---

## Part 12 — Channels (async pipelines)

Channels are Go-style pipes for coordinating async work without callbacks.
They shine when you have a producer and a consumer that should run independently.

```js
import { find, component } from '@agberohq/oja';
import { Channel, go } from '@agberohq/oja';

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

## Part 12b — signal() — reactive component communication

`Channel` (Part 12) is for coordinating async work — a producer and a consumer
running independently. `signal()` solves a different problem: how do two
components that are already mounted share state and stay in sync?

The classic example is a host list and a detail sidebar. When the user clicks a
host in the list, the sidebar should update. The two components don't have a
common parent — they're mounted into different parts of the layout. You could
use `emit` and `listen`, but that's fire-and-forget: if the sidebar mounts
*after* the user has already clicked something, it misses the event and shows
nothing.

`signal()` solves this because it **holds its current value**. A component that
subscribes after the value is set still receives it immediately. Think of it as
a reactive variable that any component can read or write, with the last value
always available.

```js
import { find, signal, on } from '@agberohq/oja';

// In hosts.html — the list page
const selected = signal('host:selected');

// When the user clicks a row, write to the signal
on(find('#host-list'), 'click', '[data-host-id]', (e, el) => {
    selected.set({
        id:   el.dataset.hostId,
        name: el.dataset.hostName,
    });
});
```

```js
import { find, signal, component, Out } from '@agberohq/oja';

// In sidebar.html — the detail panel
const selected = signal('host:selected');

// subscribe() calls the handler immediately with the current value
// if one already exists — so the sidebar is always in sync,
// even if it mounted after the selection was made
const off = selected.subscribe(host => {
    if (host) {
        Out.to(find('#detail-panel'))
            .component('components/host-detail.html', host);
    }
});

// Always unsubscribe when the component unmounts
component.onUnmount(() => off());
```

The rules are simple:

- `signal('name')` anywhere returns the same signal — same name, same value.
- `signal.set(value)` notifies all current subscribers and stores the value.
- `signal.get()` reads the current value without subscribing.
- `signal.subscribe(fn)` calls `fn` immediately with the current value (if any),
  then again on every future `set()`. Returns an unsubscribe function.
- The component that **creates** the signal is responsible for destroying it
  when it unmounts — not the subscribers.

```js
// In the page that owns this signal — clean up on unmount
component.onUnmount(() => selected.destroy());
```

**When to use `signal()` vs `emit/listen`:**

Use `signal()` when the state matters at mount time — a selected item, a filter
value, a current user. Use `emit/listen` for events that only matter right now —
"this upload just finished", "the user just deleted that record".

---

## Part 13 — Auth

```js
import { auth, context } from '@agberohq/oja';

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
    signal, progress, runtime,
} from '@agberohq/oja';

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

// ── 3. Page load progress ────────────────────────────────────────────────────
progress('page').track(runtime, {
    start: 'oja:navigate:start',
    tick:  'component:mounted',
    total: 3,
    done:  'oja:navigate:end',
});

// ── 4. Layout ─────────────────────────────────────────────────────────────
await layout.apply('#app', 'layouts/main.html', { currentUser });

// ── 5. Router ─────────────────────────────────────────────────────────────
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

// ── 6. Global event handlers ──────────────────────────────────────────────
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

// ── 7. Start ──────────────────────────────────────────────────────────────
router.start('/');
```

---

## Common mistakes

| Mistake | What breaks | Fix |
|---|---|---|
| `router.start()` before `await layout.apply()` | Router can't find `#main-outlet`, nothing renders | Always `await layout.apply()` first |
| Passing `tasks()` as a prop instead of `tasks` | Component gets a frozen snapshot, never updates | Pass the signal: `{ tasks }` not `{ tasks: tasks() }` |
| `document.getElementById` inside a component | May grab an element from another component instance | Use `find('#id')` — it is scoped to the current component |
| Declaring `router` after `auth.session.OnStart` | `ReferenceError: Cannot access 'router' before initialization` | Declare `router` before any auth session callbacks |
| `go()` return value | `go()` returns `undefined` — it is fire-and-forget | Use a flag or a Channel to observe completion |
| Missing `<script type="importmap">` in `index.html` | `Failed to resolve module specifier "@agberohq/oja"` in the browser console | Add the import map to `index.html` — it only needs to be there once and covers every script on the page |
| `Out.to(el)\`template\`` | `TypeError: Out.to(...) is not a function` | Use `Out.tag(el)\`template\`` for tagged template literals — `Out.to()` is for method chaining only |
| Calling `signal.destroy()` from a subscriber | Destroys the signal for every other subscriber too | Only the page that owns the signal calls `destroy()` — subscribers just call the `off()` function they received from `subscribe()` |
| `make.input(...).list(...)` | `TypeError: Cannot set property list` | `<input>` has a native read-only `list` property — `.list()` is skipped silently on void elements. Use a wrapper `make.div()` for list rendering |
| `make.div({ class: ['card', 'elevated'] })` vs `make.div({ class: 'card elevated' })` | Both work — different intent | String sets `className` directly. Array calls `classList.add()`. Use string when the class expression is a single compound value, array when building it programmatically |
| Calling `props()` in `app.js` or layout scripts | `props()` returns `null` outside a component script | `props()` is only meaningful inside a component — use `context()` for app-level state |

---

## Part 14b — Progress tracking

The task board uploads files, fetches data, and loads pages — all operations
the user is waiting on. The `progress()` utility gives every waiting moment
a visual shape without tying it to a specific UI component.

### The top-of-page bar

By default, `progress()` renders a slim 3px bar at the top of the page — the
same pattern used by GitHub and YouTube. You do not build any HTML for it. You
just call it.

```js
import { progress } from '@agberohq/oja';

const p = progress('upload');

p.start();    // starts the indeterminate pulsing bar
p.set(60);    // snaps to 60% — animates from wherever it was
p.done();     // fills to 100% then fades out
p.fail();     // turns red then fades out
```

### Wiring to an upload

```js
const p = progress('upload');

// Bind to an uploader instance — start/done/fail are wired automatically
p.bind(uploader);

// Or drive it manually from upload events
uploader.onProgress((pct) => p.set(pct));
uploader.onComplete(() => p.done());
uploader.onError(() => p.fail());
```

### Milestone hooks

The real power is the hook system. You can fire any function when the bar
crosses a specific value, in either direction:

```js
p.action({
    25:     () => notify.info('Quarter done'),
    50:     () => notify.info('Halfway there'),
    done:   () => notify.success('Upload complete!'),
    fail:   () => notify.error('Upload failed — retrying'),
    change: (val) => find('#pct-label').textContent = val + '%',
});
```

Direction-aware hooks let you respond differently when progress is going
forward versus backward:

```js
// This only fires when the bar crosses 50 going upward
p.on(50, () => showHalfwayMessage(), { direction: 'up' });

// This only fires when crossing 50 going downward
p.on(50, () => notify.warn('Progress reversed'), { direction: 'down' });
```

### Reverse — honesty about what is happening

Most progress bars only go forward. When something goes wrong — a corrupt
chunk, a network retry — they reset to zero, which is jarring and dishonest.
`p.reverse()` animates the bar backward to a checkpoint instead.

```js
p.set(80);  // upload was at 80%

// Corrupt data detected — animate back to the last good checkpoint
p.reverse(30, { reason: 'corrupt' });

// A direction-aware hook can explain what happened
p.on(50, ({ direction, reason }) => {
    if (direction === 'down') {
        notify.warn('Re-uploading from checkpoint…');
    }
}, { direction: 'down' });
```

### Tracking page loads

You can wire the progress bar to the router so it tracks how many components
have loaded on each navigation. This is one of those things that takes dozens
of lines in most frameworks — in Oja it is four:

```js
import { progress, runtime } from '@agberohq/oja';

// In app.js, before router.start()
progress('page').track(runtime, {
    start: 'oja:navigate:start',   // reset and start when navigation begins
    tick:  'component:mounted',    // increment each time a component finishes loading
    total: 3,                      // how many components to expect per page
    done:  'oja:navigate:end',     // complete when the router finishes
});
```

`runtime` is Oja's unified event bus — all modules emit on it, so `progress`
can observe the entire framework lifecycle from one place.

### Progress toasts — when the bar is not enough

Sometimes you want the progress alongside a message the user can read. Use
`notify.progress()` for a toast that stays open until you explicitly close it:

```js
const p = notify.progress('Uploading config…');

uploader.onProgress((pct) => p.update(pct));  // shows "Uploading config… 60%"
uploader.onComplete(() => p.done('Config saved'));
uploader.onError(() => p.fail('Upload failed'));
```

Or let Oja wire a promise automatically:

```js
notify.promise(api.post('/config', data), {
    pending: 'Saving config…',
    success: 'Config saved',
    error:   'Save failed',
});
```

---

## Part 15 — VFS and offline-first apps

VFS (Virtual File System) stores your app's HTML, JS, and CSS in IndexedDB inside the browser. Components load from IndexedDB first, then fall back to the network. After the first visit, the app works offline.

VFS is entirely optional. Everything in Parts 1–14 works without it.

### Basic setup

```js
import { VFS, Router, Out } from '@agberohq/oja';

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

### Storage quota

VFS exposes how much IndexedDB space it is using:

```js
const { usage, quota, percent } = await vfs.quota();
// usage: bytes used, quota: total available, percent: 0–100
console.log(`Using ${(usage / 1024).toFixed(0)} KB (${percent}%)`);
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
import { config } from '@agberohq/oja';

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
import { config, VFS, Router, auth } from '@agberohq/oja';

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
import { engine, Store } from '@agberohq/oja';

const store = new Store('taskboard');
engine.useStore(store);
```

Now `engine.set()` writes into the same store that the rest of your app reads
from, and `data-oja-bind` attributes in HTML update automatically when state
changes.

### Replacing innerHTML with find().list()

Here is the notes list before:

```js
// pages/tasks.html — before
import { find } from '@agberohq/oja';
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
the same thing with `find().list()`:

```js
// pages/tasks.html — after
import { find, Out } from '@agberohq/oja';

find('#task-list').list(() => tasks(), {
    key:    t => t.id,
    render: t => Out.c('components/task-item.html', t),
    empty:  Out.h('<p class="empty-hint">No tasks yet — press N to add one</p>'),
});
```

That's it. No `effect()` wrapper needed — passing a function as `items` makes
it reactive automatically. No `document.createElement`. No manual DOM. The list
re-reconciles whenever `tasks()` changes: only new nodes are inserted, only
removed nodes are deleted, unchanged nodes are left alone.

If you need fine-grained control over how existing nodes are updated, you can
return a raw element from `render` instead of an Out. The existing element is
passed as the second argument:

```js
find('#task-list').list(() => tasks(), {
    key:    t => t.id,
    render: (task, existing) => {
        const el = existing || make.div({ class: 'task-item', data: { id: task.id } },
            make.span({}, task.text),
        );
        if (existing) find('span', el).update({ text: task.text });
        return el;
    },
});
```

### Morphing the profile panel

The profile page rebuilds a panel from server data on an interval. Before,
it wiped and rebuilt the entire panel, losing any open tooltips or focused
inputs. With `engine.morph()`:

```js
// pages/profile.html
import { find, component } from '@agberohq/oja';
import { engine } from '@agberohq/oja';

async function refreshStats() {
    const stats = await api.get('/me/stats');
    const html  = buildStatsHtml(stats);
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
import { engine } from '@agberohq/oja';

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
import { Search } from '@agberohq/oja';

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
import { find, on, Out } from '@agberohq/oja';
import { taskSearch } from '../../app.js';

const searchEl = find('#task-search');

function showTasks(items) {
    find('#task-list').list(items, {
        key:    t => t.id,
        render: t => Out.c('components/task-item.html', t),
        empty:  Out.h(`<p>${searchEl.value ? 'No matches' : 'No tasks yet'}</p>`),
    });
}

// Initial render — show everything
showTasks(tasks());

// Filter on input
on(searchEl, 'input', (e) => {
    const q = e.target.value.trim();
    if (!q) { showTasks(tasks()); return; }
    showTasks(taskSearch.search(q).map(r => r.doc));
});
```

The search box filters the same `find().list()` reconciler — only changed
nodes are patched, so the list never flickers.

### Tag autocomplete on the form

The task form has a tag input. Build a `Trie` from the tags already in use
and attach autocomplete to it:

```js
// components/task-form.html
import { find, component } from '@agberohq/oja';
import { Trie, form, autocomplete } from '@agberohq/oja';
import { tasks } from '../../app.js';

// Build a trie of every tag already in use
const tagTrie = new Trie();
for (const t of tasks()) {
  if (t.tag) tagTrie.insert(t.tag);
}

const tagInput = find('#task-tag');

const handle = autocomplete.attach(tagInput, {
  source:   tagTrie,
  limit:    6,
  onSelect: (tag) => { tagInput.value = tag; },
});

// Clean up when the component unmounts
component.onUnmount(() => handle.destroy());
```

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
import { find } from '@agberohq/oja';
import { table } from '@agberohq/oja';

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