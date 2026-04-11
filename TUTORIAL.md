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

### context.set() and context.get() — write and read without destructuring

The destructure pattern `const [, setNotes] = context('notes')` works, but the
empty comma is noisy when you only need the write side. Use `context.set()`:

```js
// ✗ Forced to destructure just to get the setter:
const [, forceUpdate] = context('ui_state');
forceUpdate(Date.now());

// ✓ Clear intent, no empty comma:
context.set('ui_state', Date.now());
```

`context.get()` reads the current value without subscribing — useful when you
need a snapshot inside a callback rather than a reactive dependency:

```js
// Read once — not tracked by any effect:
const currentNotes = context.get('notes');
```

Both methods warn if the key has not been registered.

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
| `scoped()` | `{ find, findAll, el }` — bound to this container, safe in async callbacks |
| `ref(sel)` | `{ el }` — captures one element, safe in async callbacks |
| `container()` | The DOM element this script is mounted into |
| `props()` | Read-only object of the data passed at mount time |
| `ready()` | Call to signal that async setup is complete |

### Async-safe DOM access — scoped() and ref()

`find()` resolves its scope from the active component context, which is only set
during synchronous top-level execution. Inside `setTimeout`, async callbacks, or
`effect()` handlers, the context is cleared and `find()` falls back to `document`.

```js
// ✗ WRONG — find() context is gone inside setTimeout
setTimeout(() => {
    find('#sync-dot').title = 'Saved'; // searches document, not this component
}, 600);

// ✓ RIGHT — capture at top-level, use anywhere
const syncDot = find('#sync-dot');
setTimeout(() => {
    syncDot.title = 'Saved'; // reuses the captured reference
}, 600);
```

For cases where you need to keep querying (not just reuse one element), use
`scoped()`. It captures the container at call time and returns `find`/`findAll`
functions that are permanently bound to it:

```js
import { find, scoped, ref } from '@agberohq/oja';

// scoped() — bound query functions, safe anywhere:
const { find: scopedFind, findAll } = scoped();

component.onMount(() => {
    setTimeout(() => {
        scopedFind('#status').textContent = 'ok';      // correct container, always
        findAll('.item').forEach(el => el.classList.add('ready'));
    }, 1000);
});

// ref() — capture one specific element:
const syncDot = ref('#sync-dot');

effect(() => {
    notesMeta(); // track changes
    setTimeout(async () => {
        const quota = await getVfsQuota();
        if (quota) syncDot.el.title = `Saved · ${quota.usage} used`;
    }, 600);
});
```

`scoped()` and `ref()` are the right tools whenever you need DOM access outside
the synchronous top-level of a component script.

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

Auth is one of the most important parts of any real app. Oja's auth module handles JWTs, opaque tokens, session lifecycle, role checks, and route protection — without any external library.

### Basic setup

```js
import { auth, context } from '@agberohq/oja';

export const [currentUser, setCurrentUser] = context('user', null);

// Define access levels — these are checked on every route navigation
auth.level('public',    () => true);
auth.level('protected', () => auth.session.isActive());
auth.level('admin',     () => auth.session.isActive() && auth.hasRole('admin'));

// OnStart fires after a successful auth.session.start() call
// This is where you set your API token and navigate to the intended page
auth.session.OnStart(async (token) => {
    // Set the token on your API client immediately
    api.setToken(token);

    // Navigate to where the user was trying to go
    const dest = auth.session.intendedPath() || '/';
    auth.session.clearIntendedPath();
    router.navigate(dest);
});

// OnRenew fires when the token is silently refreshed
auth.session.OnRenew((newToken) => {
    api.setToken(newToken);
});

// OnExpiry fires when the JWT exp timestamp is reached
auth.session.OnExpiry(() => {
    setCurrentUser(null);
    router.navigate('/login');
    notify.warn('Session expired. Please sign in again.');
});
```

### Logging in — starting a session

In your login page, call `auth.session.start()` after the server confirms the credentials. Pass the JWT you received from the server:

```js
form.on(loginForm, {
    submit: async (data) => {
        // Call your API to verify username + password
        const user = await api.login(data.username, data.password);

        // Start the Oja session — this stores the token and fires OnStart
        await auth.session.start(user.token);

        // Update the current user in context so the UI reacts
        setCurrentUser(user);
        return user;
    },
    success: () => notify.success('Welcome back!'),
    error:   (err) => notify.error(err.message),
});
```

When `auth.session.start()` is called:
1. The token is stored securely in an encrypted store.
2. The JWT is decoded and the expiry timer is set.
3. `OnStart` hooks fire — this is where you call `api.setToken()` and navigate.

### `tokenSync()` — reading the token synchronously

Most of the time you set the API token inside `OnStart` and never need to think about it again. But sometimes you need the token synchronously — for example on app startup, to restore a session that was active when the user last closed the tab:

```js
// app.js — runs on every page load
import { auth } from '@agberohq/oja';
import { api } from './api.js';

// tokenSync() reads from a fast synchronous store — no await needed
// Returns null if no session is active or the session has expired
const token = auth.session.tokenSync();
if (token) {
    api.setToken(token); // restore the session immediately
}
```

> **Why `tokenSync()` instead of `token()`?**
> `token()` is async because it decrypts from an encrypted store. `tokenSync()` reads from a faster meta-store that holds a raw copy of the token — the tradeoff is that it returns `null` when the session is inactive, so always check the return value.

`tokenSync()` returns `null` in these cases:
- No session has been started
- The session was ended with `auth.session.end()`
- The JWT has expired (`isActive()` would return `false`)

### Protecting routes

The simplest way to protect routes is middleware on a router group:

```js
// All routes inside this group require an active session
const app = router.Group('/');
app.Use(auth.middleware('protected', '/login'));
// ↑ If 'protected' level fails, redirect to /login
// ↑ The attempted path is saved and restored after login

app.Get('/dashboard', Out.c('pages/dashboard.html'));
app.Get('/settings',  Out.c('pages/settings.html'));
app.Get('/profile',   Out.c('pages/profile.html'));

// Public routes — outside the group, no middleware
router.Get('/login', Out.c('pages/login.html'));
```

When the middleware redirects to `/login`, it stores the original path. In `OnStart`, call `auth.session.intendedPath()` to retrieve it and send the user where they were going.

### Logging out

```js
on('#logout-btn', 'click', async () => {
    await auth.session.end(); // clears token, stops expiry timer
    setCurrentUser(null);
    router.navigate('/login');
});
```

`auth.session.end()` does not fire any hooks — the logout is your code's responsibility to handle (redirect, notify, clean up context).

### Role-based access

If your JWT includes a `roles` array in the payload, Oja can check them directly:

```js
// JWT payload: { sub: 'u1', roles: ['editor', 'viewer'], email_verified: true, exp: ... }

auth.hasRole('editor');  // → true
auth.hasRole('admin');   // → false

// Check arbitrary JWT claims
auth.hasClaim('email_verified');        // → true  (claim exists in payload)
auth.hasClaim('email_verified', true);  // → true  (claim equals the value)

// Use in level definitions
auth.level('editors-only', () => auth.session.isActive() && auth.hasRole('editor'));
auth.level('verified',     () => auth.session.isActive() && auth.hasClaim('email_verified', true));
```

### Non-JWT tokens

Not every API uses JWTs. Oja supports opaque tokens and API keys too:

```js
// API key or Basic auth — no expiry
await auth.session.start('api-key-abc123', null, { expires: null });
auth.session.isActive(); // → true (stays active until end() is called)

// Token with a known TTL — pass the expiry timestamp
await auth.session.start('bearer-xyz', null, {
    expires: Date.now() + 8 * 3600_000 // 8 hours from now
});

// No options — isActive() returns false (preserved for backwards compatibility)
await auth.session.start('legacy-token');
auth.session.isActive(); // → false
```

### Session method reference

| Method | Returns | Notes |
|--------|---------|-------|
| `auth.session.start(token, refresh?, opts?)` | `Promise<void>` | Stores token, fires `OnStart` |
| `auth.session.end()` | `Promise<void>` | Clears everything, no hooks |
| `auth.session.renew(newToken, newRefresh?)` | `Promise<void>` | Replaces token, fires `OnRenew` |
| `auth.session.isActive()` | `boolean` | Synchronous check — safe anywhere |
| `auth.session.token()` | `Promise<string\|null>` | Async decrypted token |
| `auth.session.tokenSync()` | `string\|null` | Synchronous — `null` if inactive |
| `auth.session.user()` | `object\|null` | Decoded JWT payload |
| `auth.session.expiresIn()` | `number` | Milliseconds until expiry |
| `auth.session.intendedPath()` | `string\|null` | Path saved before redirect |
| `auth.session.clearIntendedPath()` | `void` | Call after navigating to it |

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
| `find('#el')` inside `setTimeout` or async callback | Falls back to `document`, finds wrong element or null | Capture at top-level: `const el = find('#el')`, then use `el` in the callback. Or use `scoped()` for ongoing queries |
| `const [, setFoo] = context('foo')` to get write-only | Ugly empty comma, easy to misread | Use `context.set('foo', value)` instead |
| Initialising `dragdrop.reorder()` inside a reactive render function | Listener leak — dozens of drag handlers accumulate, DOM crashes on drop | Use `engine.list` `onMount` callback — it runs once after first render |
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

### engine.list() lifecycle callbacks

When you add an imperative plugin to a list — drag-and-drop reordering, tooltips,
third-party widgets — you need it to initialise exactly once, not on every
reactive re-render. `engine.list()` provides three callbacks for this:

```js
import { engine } from '@agberohq/oja';
import { dragdrop } from '@agberohq/oja';

engine.list('#notes', notes(), {
    key:    n => n.id,
    render: (note, existing) => {
        const el = existing || document.createElement('div');
        el.dataset.id = note.id;
        el.textContent = note.title;
        return el;
    },

    // onMount — runs ONCE after the first render, however many re-renders follow
    onMount: (container) => {
        dragdrop.reorder(container, {
            handle:    '.drag-handle',
            onReorder: els => saveOrder(els.map(el => el.dataset.id)),
        });
    },

    // onItemMount — runs for each NEWLY INSERTED item only
    // Items that were already in the list and got updated do NOT trigger this
    onItemMount: (itemEl, data, index) => {
        initTooltip(itemEl, data.description);
    },

    // onItemRemove — runs before an item is removed from the DOM
    onItemRemove: (itemEl) => {
        destroyTooltip(itemEl);
    },
});
```

Before this existed, the common workaround was a flag on the element:

```js
// ✗ OLD — fragile guard, breaks when the list re-renders
if (!listEl._dragBound) {
    listEl._dragBound = true;
    dragdrop.reorder(listEl, { ... });
}
```

With `onMount` you delete that flag entirely. The callback fires after the DOM
is ready and never fires again — regardless of how many times the reactive
system calls `list()`.

`engine.listAsync()` accepts the same three callbacks.

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
---

## Part 20 — API client

`Api` is Oja's built-in HTTP client. It handles authentication headers, JSON encoding/decoding, error normalisation, and offline detection automatically.

### Setup

```js
import { Api } from '@agberohq/oja';

const api = new Api({
    base:    window.location.origin,  // all paths are relative to this
    timeout: 10_000,                  // ms before request aborts (default: 30s)
});

export { api };
```

Create the client once in `app.js` and export it. Every other module imports from there — never create a new `Api` per page.

### Making requests

```js
// GET — returns parsed JSON
const hosts = await api.get('/hosts');

// POST — body is JSON-encoded automatically
const result = await api.post('/hosts', { hostname: 'api.example.com', port: 443 });

// PUT, PATCH, DELETE
await api.put('/hosts/42',    { port: 8443 });
await api.patch('/hosts/42',  { alive: false });
await api.delete('/hosts/42');
```

### Authentication

```js
// Set after login — applied to every subsequent request
api.setToken(jwt);

// Remove on logout
api.clearToken();
```

### Lifecycle hooks

```js
// Wire in app.js
api.beforeRequest((path, method, opts) => {
    logger.debug('api', `→ ${method} ${path}`);
});

api.afterResponse((path, method, res, ms) => {
    if (ms > 500) logger.warn('api', 'Slow response', { path, ms });
});

api.onOffline(() => notify.banner('Connection lost', { type: 'warn' }));
api.onOnline(()  => notify.dismissBanner());
```

### Error handling

`api.get()` and friends throw on non-2xx responses. Catch them normally:

```js
try {
    const data = await api.get('/sensitive-endpoint');
} catch (err) {
    if (err.status === 401) router.navigate('/login');
    else notify.error(err.message);
}
```

---

## Part 21 — Store

`Store` is Oja's synchronous key-value store. It picks the best available backend automatically — `sessionStorage` → `localStorage` → in-memory — so you never think about `JSON.parse` or storage fallbacks.

### Basic usage

```js
import { Store } from '@agberohq/oja';

const store = new Store('my-app');

store.set('theme', 'dark');
store.get('theme');          // → 'dark'
store.has('theme');          // → true
store.clear('theme');        // remove one key
store.reset();               // remove all keys for this store
```

### Storage preference

```js
// Prefer localStorage — persists across tabs and browser restarts
const prefs = new Store('prefs', { prefer: 'local' });

// Prefer sessionStorage — clears when the tab closes (default)
const session = new Store('session', { prefer: 'session' });

// In-memory only — never touches Web Storage
const temp = new Store('temp', { prefer: 'memory' });
```

### Watch for changes

```js
const unsub = store.watch('theme', (newVal, oldVal) => {
    applyTheme(newVal);
});

// Stop watching
unsub();
```

### TTL — auto-expiring values

```js
// Value expires in 1 hour
store.set('cache:hosts', hosts, { ttl: 3600_000 });

store.get('cache:hosts'); // → null after TTL expires, value immediately on read
```

### Encryption

```js
// Encrypt sensitive values at rest
const secure = new Store('secure', { encrypt: true, key: 'app-secret' });
secure.set('api_key', 'sk-...');  // stored encrypted
secure.get('api_key');            // → 'sk-...' (decrypted automatically)
```

---

## Part 22 — Animate

`animate` provides zero-dependency CSS animations for common transitions. Every method returns a `Promise` that resolves when the animation ends — chain them or `await` them.

```js
import { animate } from '@agberohq/oja';

// Fade
await animate.fadeIn('#modal');
await animate.fadeOut('#spinner');

// Slide
animate.slideIn('#sidebar', { direction: 'left',  duration: 300 });
animate.slideOut('#drawer', { direction: 'right', duration: 200 });

// Collapse / expand height (great for accordions)
await animate.collapse('#panel');
await animate.expand('#panel');

// countUp — animates a number from 0 to the target
animate.countUp('#metric', 1248, { duration: 1200, suffix: ' hosts' });

// typewriter — types text character by character
animate.typewriter('#heading', 'Welcome back, Ade', { speed: 40 });

// shake — draw attention to a field with an error
animate.shake('#form-field');
```

All methods accept an element selector string, an `Element`, or a result from `find()`.

---

## Part 23 — encrypt

`encrypt` wraps the browser's Web Crypto API so you get strong encryption without managing keys manually.

```js
import { encrypt } from '@agberohq/oja';

// Seal (encrypt) a value
const ciphertext = await encrypt.seal('my secret value', 'passphrase', 'salt');

// Open (decrypt)
const plaintext = await encrypt.open(ciphertext, 'passphrase', 'salt');
// → 'my secret value'

// Rotate — re-encrypt with a new passphrase (for key rotation)
const newCiphertext = await encrypt.rotate(ciphertext, 'oldPass', 'salt', 'newPass');

// Sign and verify (HMAC-SHA256) — for tokens and webhooks
const sig = await encrypt.sign('payload', 'secret');
const ok  = await encrypt.verify('payload', sig, 'secret');
// → true
```

`encrypt` uses AES-GCM with PBKDF2 key derivation. The salt is separate from the passphrase — use a per-record salt (e.g. the record's `id`) for maximum security.

---

## Part 24 — Worker

`Worker` runs a function in a Web Worker thread without a separate file. No build step, no blob: URL juggling.

```js
import { Worker } from '@agberohq/oja';

// Define the worker function — it runs in a separate thread
// It CANNOT access variables from the outer scope (serialised as a string)
const worker = new Worker((self) => {
    self.handle('compress', async (data) => {
        // CPU-heavy work here — doesn't block the UI
        return heavyCompression(data);
    });

    self.handle('ping', () => 'pong');
});

// Call a handler — returns a Promise
const result = await worker.call('compress', rawData);

// Fire and forget — no response needed
worker.send('logEvent', { type: 'pageview' });

// Always clean up when the component unmounts
component.onUnmount(() => worker.close());
```

### Worker modes

```js
// Auto (default) — picks the best available mode
const w = new Worker(fn);

// Inline-module — bypasses blob: CSP (required for Tauri, Electron strict CSP)
const w = new Worker(fn, { type: 'inline-module' });

// Real file — full ES module imports inside the worker
const w = new Worker(null, {
    type: 'module',
    url:  new URL('./workers/processor.js', import.meta.url).href,
});

// Detect what's available
const { classic, module: mod, inlineModule } = Worker.detect();
```

---

## Part 25 — Uploader

`uploader` handles chunked file uploads with progress tracking, parallel limits, pause/resume, and drag-and-drop — all without a server library.

```js
import { uploader } from '@agberohq/oja';

const up = uploader.create({
    url:        '/api/upload',
    chunkSize:  2 * 1024 * 1024,  // 2 MB chunks
    parallel:   2,                 // max 2 simultaneous uploads
    maxSize:    50 * 1024 * 1024, // reject files over 50 MB
    dropZone:   '#upload-area',   // auto-wires drag & drop

    onProgress: (file, pct, speed) => {
        find(`[data-file="${file.name}"] .progress`).style.width = pct + '%';
    },
    onComplete: (file, res) => notify.success(`${file.name} uploaded`),
    onError:    (file, err) => notify.error(`${file.name} failed: ${err}`),
});

// Add files manually (e.g. from a file input)
on('#file-input', 'change', (e) => up.add(e.target.files));

// Programmatic control
const [id] = up.add(file);
up.pause(id);
up.resume(id);
up.cancel(id);

// Inspect the queue
up.getQueue(); // → [{ id, name, status, progress }]

// Clean up
component.onUnmount(() => up.destroy());
```

---

## Part 26 — Tabs

`tabs.render()` builds a tab bar that shows and hides content panels. Use `tabs.sub()` for nested tab bars (pill style).

```js
import { tabs } from '@agberohq/oja';

// Render a tab bar inside a container
const t = tabs.render('#host-tabs', [
    { key: 'overview',  label: 'Overview'  },
    { key: 'routes',    label: 'Routes'    },
    { key: 'firewall',  label: 'Firewall'  },
    { key: 'logs',      label: 'Logs',     disabled: true },
], {
    panels:   '#tab-panels',   // container with [data-tab="key"] children
    active:   'overview',      // initial active tab
    variant:  'underline',     // 'underline' (default) | 'pill' | 'boxed'
    onChange: (key) => loadTabContent(key),
});

// Switch tab programmatically
t.activate('routes');

// Read current tab
t.active(); // → 'routes'

// Clean up
t.destroy();
```

For nested tabs (e.g. inside a detail page), use `tabs.sub()` — it defaults to `variant: 'pill'` and the API is identical:

```js
const sub = tabs.sub('#route-subtabs', [
    { key: 'engine',  label: 'Engine'  },
    { key: 'headers', label: 'Headers' },
], { panels: '#route-panels', active: 'engine' });
```

HTML for panels (Oja shows/hides these based on the active key):

```html
<div id="tab-panels">
    <div data-tab="overview">Overview content here</div>
    <div data-tab="routes">Routes content here</div>
    <div data-tab="firewall">Firewall content here</div>
</div>
```

---

## Part 27 — Collapse and accordion

`collapse` toggles a panel open and closed with a smooth height animation.

```js
import { collapse, accordion } from '@agberohq/oja';

// Attach to a trigger button and a content panel
const panel = collapse.attach('#toggle-btn', '#content-panel', {
    duration: 250,         // ms
    onOpen:  () => btn.textContent = 'Hide',
    onClose: () => btn.textContent = 'Show',
});

panel.open();    // animate expand
panel.close();   // animate collapse
panel.toggle();  // flip state
panel.isOpen();  // → true | false
```

`accordion` manages a group of collapse panels so only one is open at a time:

```js
const acc = accordion.attach('#faq', {
    // optional: start with the first item open
    activeIndex: 0,
});

// Each child with data-accordion-item becomes a panel
// Clicking the [data-accordion-trigger] inside it toggles it
```

HTML structure:

```html
<div id="faq">
    <div data-accordion-item>
        <button data-accordion-trigger>What is Oja?</button>
        <div data-accordion-panel>A zero-build JS framework.</div>
    </div>
    <div data-accordion-item>
        <button data-accordion-trigger>No build step?</button>
        <div data-accordion-panel>Correct — drop files in, open browser.</div>
    </div>
</div>
```

---

## Part 28 — Wizard

`wizard` is a multi-step form. Each step can have a validation function that must pass before the user can advance. Steps render using `Out` so they can be full components.

```js
import { wizard, Out } from '@agberohq/oja';

const w = wizard.render('#onboarding', [
    {
        key:      'account',
        label:    'Account',
        body:     Out.c('steps/account.html'),
        validate: (data) => data.email?.includes('@') || 'Valid email required',
    },
    {
        key:   'profile',
        label: 'Profile',
        body:  Out.c('steps/profile.html'),
    },
    {
        key:   'confirm',
        label: 'Confirm',
        body:  Out.c('steps/confirm.html'),
    },
], {
    onComplete: (allData) => submitOnboarding(allData),
    onCancel:   ()        => router.navigate('/'),
});

// Programmatic navigation
w.next();       // advance (runs validation first)
w.prev();       // go back
w.goTo(1);      // jump to step index
w.current();    // → { key, label, index }
```

Wizard works inside a modal too — pass `modal: 'onboarding-modal'` to auto-wire the open/close:

```js
wizard.render('#onboarding', steps, { modal: 'onboarding-modal' });
modal.open('onboarding-modal');
```

---

## Part 29 — Select, datepicker, and mask

These three form enhancements replace native elements with keyboard-navigable, accessible alternatives.

### `select` — searchable dropdown

```js
import { select } from '@agberohq/oja';

const s = select.attach('#role-field', [
    { value: 'admin',  label: 'Administrator' },
    { value: 'editor', label: 'Editor'        },
    { value: 'viewer', label: 'Viewer'        },
], {
    placeholder: 'Choose a role…',
    onSelect:    (item) => console.log(item.value),
});

s.getValue();       // → 'admin'
s.setValue('editor');
s.setOptions([...]); // replace the option list
s.disable();
s.destroy();        // remove and restore original element
```

Multi-select mode:

```js
const tags = select.attach('#tags', options, {
    multi:    true,
    onSelect: (items) => console.log(items.map(i => i.value)),
});

tags.getValues();        // → ['tag1', 'tag2']
tags.setValues(['tag1']);
```

Async source — load options from the server on open:

```js
select.attach('#host-field', [], {
    source:    async (query) => api.get(`/hosts?q=${query}`),
    minChars:  2,   // wait until 2 chars typed
    placeholder: 'Search hosts…',
});
```

### `datepicker` — date (and time) picker

```js
import { datepicker } from '@agberohq/oja';

const dp = datepicker.attach('#expiry-date', {
    format:   'YYYY-MM-DD',
    onChange: (date, formatted) => console.log(formatted),
});

dp.getValue();            // → Date object
dp.getFormatted();        // → '2026-12-31'
dp.setValue(new Date());
dp.clear();
dp.destroy();
```

Date + time picker:

```js
datepicker.attach('#scheduled-at', {
    format:   'YYYY-MM-DD HH:mm',
    showTime: true,
    min:      new Date(),        // can't select past dates
    onChange: (date) => schedule(date),
});
```

### `mask` — input formatting

`mask` formats inputs as you type. Use `0` for a digit, `a` for a letter, `*` for either:

```js
import { mask } from '@agberohq/oja';

mask.attach('#phone',  '(000) 000-0000');  // → (555) 123-4567
mask.attach('#dob',    '00/00/0000');      // → 01/15/1990
mask.attach('#serial', 'aaa-***-000');     // → ABC-1x2-789
```

The raw unformatted value is stored in `element.dataset.ojaRawValue` — `form.collect()` reads this automatically, so you get `5551234567` not `(555) 123-4567` in your form data.

---

## Part 30 — Hotkeys (command palette)

`hotkeys` provides a Ctrl+K-style command palette — a searchable launcher for all keyboard-accessible actions in your app.

```js
import { hotkeys } from '@agberohq/oja';

// Register actions once in app.js
hotkeys.register([
    { label: 'Dashboard',    action: () => router.navigate('/'),        keys: 'Ctrl+1', icon: '🏠' },
    { label: 'Settings',     action: () => router.navigate('/settings'),keys: 'Ctrl+,', icon: '⚙️' },
    { label: 'New Host',     action: () => openNewHostModal(),          keys: 'Ctrl+N', icon: '➕' },
    { label: 'Search Hosts', action: () => focusSearch(),                              icon: '🔍' },
    { label: 'Dark Theme',   action: () => cssVars.applyTheme(darkTheme), group: 'Theme' },
    { label: 'Light Theme',  action: () => cssVars.applyTheme(lightTheme), group: 'Theme' },
]);
// → Ctrl+K now opens the palette
```

Add or remove actions dynamically (e.g. from plugins or page-specific handlers):

```js
hotkeys.add({ label: 'Export CSV', action: exportData, icon: '📄' });
hotkeys.remove('Export CSV');
```

Open and close programmatically:

```js
hotkeys.open();    // show palette
hotkeys.close();   // hide
hotkeys.toggle();  // flip
hotkeys.isOpen();  // → boolean
```

---

## Part 31 — Context menu (clickmenu)

`clickmenu` shows a right-click / kebab menu at the cursor or anchored to an element.

```js
import { clickmenu } from '@agberohq/oja';

// Show at cursor position (right-click handler)
element.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    clickmenu.show(e.clientX, e.clientY, [
        { label: '✏️ Rename',  action: () => rename(item) },
        { label: '📁 Move…',   action: () => move(item)   },
        { separator: true },
        { label: '🗑 Delete',  action: () => del(item), danger: true },
        { label: 'Archive',    action: () => archive(item), disabled: isArchived },
    ]);
});

// Anchored to a button (kebab/⋮ menu)
on('#options-btn', 'click', (e) => {
    e.stopPropagation();
    clickmenu.anchor(find('#options-btn'), items, { align: 'bottom-right' });
});

// Delegated — one listener covers a whole list
const unbind = clickmenu.bind('#host-list [data-host-id]', (e, el) => {
    const id = el.dataset.hostId;
    return [
        { label: 'Open',   action: () => openHost(id)   },
        { label: 'Delete', action: () => deleteHost(id), danger: true },
    ];
});

// Close programmatically
clickmenu.close();

component.onUnmount(() => unbind());
```

---

## Part 32 — Panel (floating windows)

`panel` creates floating, draggable, resizable windows that stay on top of the page while the rest of the UI remains interactive. Multiple panels can be open at once.

```js
import { panel, Out } from '@agberohq/oja';

// Open a panel
const p = panel.open({
    id:       'ai-assistant',        // required, unique identifier
    title:    'AI Assistant',
    content:  Out.c('components/ai-chat.html'),  // or use html: '<p>content</p>'
    width:    360,
    height:   480,
    position: 'bottom-right',       // 'center' | 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | { x, y }
    resizable: true,                 // drag-to-resize handle (default: true)
    closable:  true,
    onClose:  () => console.log('closed'),
});

// Control
p.minimize();               // collapse to title bar
p.restore();                // expand back
p.setTitle('Updated title');
await p.setContent(Out.c('components/other.html'));
p.focus();                  // bring to front
p.close();

// Static methods
panel.get('ai-assistant');  // → handle or null
panel.isOpen('ai-assistant'); // → boolean
panel.closeAll();
panel.openIds();            // → ['ai-assistant', ...]
```

---

## Part 33 — Popover and tooltip

`popover` shows a rich content overlay relative to a trigger element. For simple text hints, use the declarative `data-tooltip` attribute.

### Declarative tooltips

No JS needed — just add the attribute:

```html
<button data-tooltip="Save changes" data-position="top">Save</button>
<button data-tooltip="Delete this host" data-position="bottom">🗑</button>
```

Oja auto-wires `data-tooltip` elements on mount.

### Programmatic popovers

```js
import { popover, Out } from '@agberohq/oja';

on('#menu-btn', 'click', async (e, el) => {
    await popover.show(el, Out.c('components/dropdown-menu.html'), {
        position:           'bottom-start',   // top | bottom | left | right (+ -start | -end)
        clickOutsideToClose: true,
    });
});

// Or inline HTML
await popover.show(el, '<div class="menu">...</div>');

// Close programmatically
popover.hide();
```

---

## Part 34 — Clipboard

```js
import { clipboard } from '@agberohq/oja';

// Write text
const ok = await clipboard.write('Text to copy');
if (ok) notify.success('Copied!');

// Read text
const text = await clipboard.read();

// Copy from an element's content
on('#copy-btn', 'click', async (e, el) => {
    const target = el.dataset.copyTarget;
    await clipboard.writeFrom(target); // reads textContent of the selector
    notify.success('Copied to clipboard');
});
```

---

## Part 35 — Countdown

`countdown` attaches a live countdown timer to any element.

```js
import { countdown } from '@agberohq/oja';

// Attach to an element with an expiry timestamp
const cd = countdown.attach('#cert-expiry', expiresAtMs, {
    format:   (ms) => {
        const mins = Math.floor(ms / 60000);
        const secs = Math.floor((ms % 60000) / 1000);
        return `${mins}m ${secs}s`;
    },
    onExpire: () => {
        find('#cert-expiry').classList.add('expired');
        notify.warn('Certificate has expired — renew immediately');
    },
    onWarn:     () => notify.warn('Certificate expiring soon'),
    warnBefore: 5 * 60 * 1000,   // fire onWarn 5 minutes before expiry
});

cd.destroy(); // stop timer and clean up
component.onUnmount(() => cd.destroy());
```

---

## Part 36 — Infinite scroll and pull-to-refresh

### Infinite scroll

`infiniteScroll` loads more content when the user approaches the bottom of a container.

```js
import { infiniteScroll } from '@agberohq/oja';

let page = 1;

const scroller = infiniteScroll.init('#feed', {
    onLoadMore: async () => {
        const items = await api.get(`/feed?page=${++page}`);
        items.forEach(item => {
            make.div({ class: 'feed-item' }, item.title)
                .appendTo('#feed-list');
        });
        return items.length > 0; // return false when there is no more data
    },
    threshold: 200,   // px from bottom to trigger
});

scroller.loadMore();  // trigger manually
scroller.disable();   // pause
scroller.enable();    // resume
scroller.destroy();   // clean up
```

### Pull-to-refresh

`pullToRefresh` adds a native-style pull gesture on mobile (and drag on desktop).

```js
import { pullToRefresh } from '@agberohq/oja';

const ptr = pullToRefresh.init('#page-content', {
    onRefresh: async () => {
        const fresh = await api.get('/hosts');
        context.set('hosts', fresh);
        notify.success('Refreshed');
    },
    pullMessage:    'Pull down to refresh',
    releaseMessage: 'Release to refresh',
    loadingMessage: 'Refreshing…',
    maxPull:        150,  // px
});

ptr.destroy();
component.onUnmount(() => ptr.destroy());
```

---

## Part 37 — SSE and WebSocket

### SSE — server pushes to client

Use `SSE` when the server needs to push updates (metrics, notifications, live logs). The client cannot send messages back.

```js
import { SSE } from '@agberohq/oja';

const sse = new SSE('/api/events', { withCredentials: true });

// Named event handlers
sse.on('metrics',   (data) => updateMetrics(data));
sse.on('log',       (data) => appendLog(data));
sse.on('alert',     (data) => notify.warn(data.message));

// Connection lifecycle
sse.onConnect(()    => notify.dismissBanner());
sse.onDisconnect(() => notify.banner('Connection lost — reconnecting…', { type: 'warn' }));

// Close when the component unmounts
component.onUnmount(() => sse.close());
```

SSE reconnects automatically with exponential backoff. Configure with `reconnect`, `reconnectDelay`, `maxDelay`, and `maxAttempts` options.

### WebSocket — two-way real-time

Use `Socket` when the client also needs to send messages — chat, collaborative editing, live commands.

```js
import { Socket } from '@agberohq/oja';

const ws = new Socket('wss://api.example.com/live');

ws.on('connect',    ()     => ws.send({ type: 'subscribe', channel: 'hosts' }));
ws.on('message',    (data) => handleMessage(data));
ws.on('disconnect', ()     => notify.warn('Disconnected'));
ws.on('error',      (e)    => console.error('WS error', e));

// Send — queued automatically if not yet connected
await ws.send({ type: 'command', action: 'restart', hostId: 42 });

// Close
component.onUnmount(() => ws.close());
```

Both `SSE` and `Socket` support the `MsgPackCodec` for binary frames:

```js
import { MsgPackCodec } from '@agberohq/oja';

const ws = new Socket('wss://api.example.com/live', {
    codec: new MsgPackCodec(),
});
```

---

## Part 38 — Runner (background worker)

`Runner` is a long-lived Web Worker that handles a stream of tasks. Unlike `Worker` (Part 24) which is for one-off computations, `Runner` is for ongoing background processing.

```js
import { Runner } from '@agberohq/oja';

const worker = new Runner((self) => {
    let count = 0;

    self.on('increment', (data) => {
        count += data.by || 1;
        return count;
    });

    self.on('reset', () => {
        count = 0;
    });
});

// Three calling styles:
worker.send('reset');                    // fire-and-forget
await worker.post('increment', { by: 5 }); // resolves when received
const result = await worker.request('increment', { by: 1 }); // waits for return value

component.onUnmount(() => worker.terminate());
```

Use `Runner` for indexing, compression, or any work that runs continuously and reacts to a stream of inputs.

---

## Part 39 — RAG, Vector, and Similarity

These three primitives power in-browser AI features — semantic search, document retrieval, and embedding-based ranking.

### `RAG` — retrieval-augmented generation helper

`RAG` stores documents and retrieves the most relevant ones for a query using BM25 + Jaccard similarity.

```js
import { RAG } from '@agberohq/oja';

const rag = new RAG();

// Add documents
rag.add('The cat sat on the mat.');
rag.add('Dogs are loyal companions.');
rag.add('Cats are independent animals.');

// Retrieve the top 2 most relevant documents
const results = rag.retrieve('feline behavior', { topK: 2 });
// → [{ text: 'Cats are independent…', score: 0.82 }, { text: 'The cat sat…', score: 0.61 }]

// Feed results to an LLM or display them directly
const context = results.map(r => r.text).join('\n');
```

### `Vector` — embedding store

`Vector` stores float embeddings and finds nearest neighbours by cosine similarity.

```js
import { Vector } from '@agberohq/oja';

const db = new Vector();

// Insert embeddings (from any source — your own model, OpenAI, etc.)
db.insert([0.1, 0.9, 0.3], { label: 'cat',  id: 1 });
db.insert([0.8, 0.2, 0.1], { label: 'dog',  id: 2 });
db.insert([0.1, 0.8, 0.4], { label: 'lion', id: 3 });

// Find nearest neighbours
const results = db.search([0.1, 0.85, 0.35], { topK: 2 });
// → [{ meta: { label: 'cat', id: 1 }, score: 0.99 }, { meta: { label: 'lion', id: 3 }, score: 0.97 }]
```

### Similarity functions

For direct vector math:

```js
import { cosine, euclidean, manhattan, dot, normalize } from '@agberohq/oja';

cosine([1, 0, 0], [1, 0, 0]);      // → 1.0  (identical)
cosine([1, 0, 0], [0, 1, 0]);      // → 0.0  (orthogonal)
euclidean([0, 0], [3, 4]);         // → 5
manhattan([0, 0], [3, 4]);         // → 7
dot([1, 2, 3], [4, 5, 6]);         // → 32
```

---

## Part 40 — Service worker

`sw` provides a thin wrapper around the Service Worker API for messaging and cache management.

```js
import { sw } from '@agberohq/oja';

// Register your service worker
await sw.register('./sw.js');

// Send a message and wait for acknowledgement
await sw.send({ type: 'SYNC_VFS', files }, { ack: 'VFS_SYNCED' });

// Fire and forget
sw.post({ type: 'PREFETCH', url: '/assets/app.js' });

// Listen for messages from the service worker
const off = sw.on('PUSH_UPDATE', (data) => {
    notify.info(`Update available: ${data.version}`);
});

component.onUnmount(() => off());
```

---

## Part 41 — Export (CSV, JSON, print)

`exporter` (exported as `exp` for brevity) downloads data as CSV or JSON, exports a table, or opens the print dialog.

```js
import { exporter } from '@agberohq/oja';

// CSV from an array of objects
exporter.csv(hosts, 'hosts.csv');

// CSV with column selection and custom headers
exporter.csv(hosts, 'hosts.csv', {
    columns:   ['hostname', 'ip', 'status'],
    headers:   ['Host Name', 'IP Address', 'Status'],
    delimiter: ',',
});

// JSON
exporter.json(hosts, 'hosts-backup.json');

// Export directly from an HTML table in the DOM
exporter.fromTable('#host-table', 'hosts.csv');

// Print an element
exporter.print('#invoice', {
    title:  'Invoice #1042',
    styles: 'table { border-collapse: collapse; } td { border: 1px solid #ccc; }',
});
```

---

## Part 42 — Pagination

`pagination` renders a page-number bar and calls your handler when the user changes pages.

```js
import { pagination } from '@agberohq/oja';

const pager = pagination.render('#pager', {
    total:    250,       // total number of items
    pageSize: 25,        // items per page
    current:  1,         // initial page
    onChange: async (page) => {
        const data = await api.get(`/hosts?page=${page}&size=25`);
        find('#host-table').innerHTML = buildTable(data);
    },
});

// Jump programmatically
pager.goTo(3);

// Update total when data changes
pager.setTotal(300);
```

---

## Part 43 — Diff

`diff` compares two strings or arrays and returns a structured edit script — useful for showing what changed in a config, a document, or a code snippet.

```js
import { diff, diffLines, diffWords, diffJson, renderDiff, unifiedDiff } from '@agberohq/oja';

// Line-level diff (most useful for documents and configs)
const hunks = diffLines(oldText, newText);
// → [{ type: 'keep'|'add'|'remove', value: string }]

// Render as HTML with highlighted changes
const html = renderDiff(hunks, { context: 3 }); // 3 unchanged lines of context
find('#diff-view').innerHTML = html;

// Unified diff (like `git diff` output)
const patch = unifiedDiff(oldText, newText, { context: 2 });

// Word-level diff
const wordHunks = diffWords('hello world', 'hello earth');

// Object diff — returns an array of change descriptors
const changes = diffJson({ port: 80 }, { port: 443, ssl: true });
// → [{ path: 'port', type: 'change', from: 80, to: 443 },
//    { path: 'ssl',  type: 'add',    value: true }]
```

---

## Part 44 — CSS variables

`cssVars` manages CSS custom properties (CSS variables) at runtime — great for theming, user preferences, and dynamic design tokens.

```js
import { cssVars } from '@agberohq/oja';

// Set a single variable on :root
cssVars.set('--accent', '#0a84ff');

// Set multiple at once
cssVars.set({
    '--accent':  '#0a84ff',
    '--bg':      '#1c2128',
    '--radius':  '6px',
});

// Read a variable
cssVars.get('--accent'); // → '#0a84ff'

// Apply a theme (object of variable → value pairs)
const darkTheme = {
    '--bg-primary': '#1c2128',
    '--text':       '#e0e0e0',
    '--accent':     '#0a84ff',
};
cssVars.applyTheme(darkTheme);

// Scope to a specific element (not :root)
cssVars.set('--card-bg', '#ffffff', '#sidebar');
```

---

## Part 45 — Offline request queue

`Queue` saves API calls when the user is offline and replays them automatically when the connection is restored.

```js
import { Queue, Store } from '@agberohq/oja';
import { api } from './api.js';

// Set up once in app.js
const queue = new Queue({
    api,
    store:   new Store('req-queue', { prefer: 'local' }), // persists across refreshes
    maxSize: 100,
    retries: 2,
});

queue.start(); // begins listening to api:offline / api:online

// Use queue.request() for writes that must not be lost
await queue.request('POST',  '/firewall', { ip: '1.2.3.4', reason: 'Abuse' });
await queue.request('DELETE', '/route/42');

// Convenience methods
await queue.post('/hosts',    { hostname: 'new.example.com' });
await queue.patch('/hosts/1', { alive: false });

// Inspect
queue.size;     // → number of pending requests
queue.pending;  // → [{ id, method, path, body, queuedAt }]

// Manual control
queue.flush();  // replay all queued requests now
queue.clear();  // discard queue without replaying
queue.remove(id); // remove one request by id

// Events
queue.on('queued',   ({ request })          => notify.info('Saved offline'));
queue.on('replayed', ({ request, response }) => notify.success('Synced'));
queue.on('failed',   ({ request, error })   => notify.error('Sync failed'));
queue.on('flushed',  ({ succeeded, failed }) => console.log(succeeded, failed));
```

---

## Part 46 — Presence (multi-user cursors)

`Presence` shows who is online, what they are viewing, and where their cursor is — built on a WebSocket connection.

```js
import { Presence } from '@agberohq/oja';

const presence = new Presence('wss://api.example.com/presence', {
    room: 'doc-42',
    user: { id: auth.session.user().sub, name: 'Ade', color: '#0a84ff' },
});

presence.join(); // connect and announce

// peers() is a reactive signal — use inside effect()
effect(() => {
    const online = presence.peers();
    renderAvatarStack(online);     // re-renders whenever anyone joins/leaves/updates
});

// Broadcast your state
presence.setView('/notes/42');
presence.setCursor({ x: e.clientX, y: e.clientY });
presence.setState({ selection: { line: 10, col: 3 } });

// Subscribe to events
presence.on('join',   (peer) => notify.info(`${peer.name} joined`));
presence.on('leave',  (peer) => notify.info(`${peer.name} left`));
presence.on('cursor', (peer) => moveCursorEl(peer));

// Render cursors automatically inside a container
presence.renderCursors('#editor', {
    template: (peer) => `<div class="cursor-label" style="background:${peer.color}">${peer.name}</div>`,
});

// Clean up
component.onUnmount(() => presence.leave());
```

---

## Part 47 — Logger and debug

### `logger` — structured app logging

`logger` is for application-level events that may need to be sent to a server or reviewed in production.

```js
import { logger } from '@agberohq/oja';

logger.info('auth',      'User logged in',   { userId: 42 });
logger.warn('api',       'Slow response',    { ms: 1240, path: '/config' });
logger.error('component','Load failed',      { url: 'hosts.html' });
logger.debug('router',   'Navigate',         { path: '/hosts' });

// Set minimum level — messages below this are silent
logger.setLevel('ERROR'); // DEBUG < INFO < WARN < ERROR < NONE

// Forward to your server or Sentry
logger.onLog((entry) => {
    if (entry.level === 'ERROR') api.post('/logs', entry);
});

// Read recent history (in-memory ring buffer)
const recent = logger.history(); // → [{ level, component, message, data, timestamp }]
```

### `debug` — framework tracing

`debug` is for development-only tracing of Oja internals. Zero overhead when disabled — all calls are no-ops in production.

```js
import { debug } from '@agberohq/oja';

// Enable in app.js during development only
debug.enable('*');              // all modules
debug.enable('router,api');     // selective modules
debug.enable('component');      // one module

// Manual tracing
debug.log('hosts', 'rendered', { count: 50 });
debug.warn('hosts', 'slow render', { ms: 340 });

// Print the full timeline to the console
debug.dump();

// Export for sharing / bug reports
const log = debug.export();
// → { exported, entries: [{ ts, ns, action, data, warn }], userAgent, url }

// Clear
debug.clear();
debug.disable();
```

---

## Part 48 — Adapter (third-party library bridge)

`adapter` is a registry for third-party libraries. Register once in `app.js`, use anywhere — no circular imports, no `window` globals.

```js
import { adapter } from '@agberohq/oja';
import * as d3   from 'd3';
import * as gsap from 'gsap';

// Register in app.js
adapter.register('d3',   d3,   { version: '7.8.5' });
adapter.register('gsap', gsap, { version: '3.12.0' });

// Lazy — loads only when first used
adapter.lazy('chart', () => import('https://cdn.jsdelivr.net/npm/chart.js'));
```

In any component or page:

```js
import { adapter } from '@agberohq/oja';

// Synchronous retrieval
const gsap = adapter.use('gsap');
gsap.from('#panel', { opacity: 0, y: 20, duration: 0.3 });

// Lazy retrieval — always returns a Promise
const Chart = await adapter.useAsync('chart');

// Check registration
adapter.has('gsap'); // → true

// List all registered libraries
adapter.list(); // → [{ name, version, lazy, loaded }]
```

---

## Part 49 — WebRTC

`webrtc` provides a thin, consistent API over the browser's peer connection API. Wire your own signalling server using `createPeer()`.

```js
import { webrtc } from '@agberohq/oja';

// Check support
webrtc.supported; // → boolean

// Get camera/microphone
const stream = await webrtc.getUserMedia({ video: true, audio: true });
videoElement.srcObject = stream;

// Screen sharing
const screenStream = await webrtc.getDisplayMedia({ video: true });

// Create a peer connection
const peer = webrtc.createPeer({
    onIceCandidate:   (candidate) => sendToSignalServer({ type: 'ice', candidate }),
    onTrack:          (e)         => remoteVideo.srcObject = e.streams[0],
    onConnectionState:(state)     => console.log('peer state:', state),
});

// Caller side
const offer = await webrtc.createOffer(peer);
await webrtc.setLocalDescription(peer, offer);
sendToSignalServer({ type: 'offer', sdp: offer });

// On receiving an answer
const answer = await fromSignalServer();
await webrtc.setRemoteDescription(peer, answer);

// Stop all tracks when done
webrtc.stopStream(stream);
```

---

## Part 50 — WebAssembly

`Wasm` loads and calls exported WASM functions from plain JavaScript — no Emscripten toolchain required.

```js
import { Wasm } from '@agberohq/oja';

// Load a WASM module
const wasm = new Wasm('/modules/image-processor.wasm', {
    imports: {
        env: { memory: new WebAssembly.Memory({ initial: 16 }) }
    },
});

await wasm.ready(); // fetches and instantiates

// Call exported functions — spread args
const result = await wasm.call('processImage', buffer, width, height);
const id     = await wasm.call('generateId', seedData);

// Check readiness
wasm._ready; // → true after ready() resolves
```

Run in a Worker thread to keep the UI unblocked during heavy WASM operations:

```js
const wasm = new Wasm('/modules/crypto.wasm', { worker: true });
await wasm.ready();
const hash = await wasm.call('sha256', data);
```

> **Note:** In worker mode, JS import callbacks in the `imports` option are replaced with no-ops — the structured clone algorithm cannot transfer functions across threads. Use non-worker mode when your WASM module needs to call back into JS.

---

## Part 51 — Formatters and template filters

`formatter` functions are registered automatically as template pipe filters and as `engine.formatters.*` keys.

### In templates

```html
<!-- Pipe syntax: {{value | filterName}} -->
<span>{{name | upper}}</span>         <!-- → ADE ADEWALE -->
<span>{{price | currency}}</span>     <!-- → $1,234.56 -->
<span>{{bytes | bytes}}</span>        <!-- → 1.2 MB -->
<span>{{createdAt | ago}}</span>      <!-- → 3 hours ago -->
<span>{{createdAt | date}}</span>     <!-- → Jan 15, 2026 -->
<span>{{ratio | percent}}</span>      <!-- → 84% -->
```

### In engine bindings

```js
import { engine } from '@agberohq/oja';

// data-oja-transform attribute picks a named formatter
// <span data-oja-bind="cpu_usage" data-oja-transform="formatPercent"></span>
engine.set('cpu_usage', 0.84);  // → element shows "84%"

// Or pass the function directly
engine.bindText('#memory', 'mem_bytes', engine.formatters.formatBytes);
```

### Register custom filters

```js
import { template } from '@agberohq/oja';

template.filter('slug', (s) => s.toLowerCase().replace(/\s+/g, '-'));
template.filter('truncate', (s, len = 50) => s.length > len ? s.slice(0, len) + '…' : s);
```

---

## Part 52 — Canvas utilities

`canvas` provides convenience wrappers around the 2D canvas API — responsive sizing, draw state management, and built-in charts.

```js
import * as canvas from '@agberohq/oja';

// Get context with optional dimensions (accounts for device pixel ratio)
const ctx = canvas.get('#my-canvas', { width: 800, height: 600 });

// Draw with automatic save/restore
canvas.draw('#chart', (ctx, size) => {
    ctx.fillStyle = '#0a84ff';
    ctx.fillRect(0, 0, size.width, 40);
});

// Clear
canvas.clear('#my-canvas');

// Resize with correct DPR scaling
canvas.resize('#my-canvas', 1024, 768);

// Responsive — redraws automatically when container size changes
const responsive = canvas.responsive('#chart', (ctx, size) => {
    drawBarChart(ctx, size, data);
});
responsive.destroy(); // stop observing

// Built-in bar chart
canvas.barChart('#stats', [120, 85, 200, 75, 160], {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
    colors: ['#0a84ff'],
});

// Export
const dataUrl = canvas.toDataURL('#my-canvas', 'image/png');
canvas.download('#my-canvas', 'chart.png');
```

---

## Part 53 — `createResource` — async data fetching

`createResource` wraps an async fetch function in reactive signals — `data`, `loading`, and `error` update automatically so you never manage fetch state manually.

```js
import { createResource, state, Out } from '@agberohq/oja';

// Basic — fetches immediately
const [hosts, { loading, error, refetch, mutate }] = createResource(
    () => api.get('/hosts')
);

effect(() => {
    if (loading()) {
        find('#content').render(Out.c('states/loading.html'));
        return;
    }
    if (error()) {
        find('#content').render(Out.h(`<p>Error: ${error().message}</p>`));
        return;
    }
    find('#content').render(Out.c('pages/hosts.html', { hosts: hosts() }));
});

// Reactive source — refetches automatically when a signal it reads changes
const [pageId, setPageId] = state(1);

const [page] = createResource(() => api.get(`/hosts?page=${pageId()}`));
// → refetches whenever pageId() changes

// Deferred — only fetches when refetch() is called
const [result, { refetch }] = createResource(
    () => api.post('/run', payload),
    { defer: true }
);

on('#run-btn', 'click', () => refetch());

// Optimistic update — change data locally without waiting for server
mutate(prev => [...prev, newHost]);
await api.post('/hosts', newHost);
```

