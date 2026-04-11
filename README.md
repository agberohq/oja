> WARNING: This project is under active development.

<p align="center">
  <img src="assets/oja_icon.png" width="300" alt="Oja Logo">
</p>

<p align="left">
  <img src="assets/oja_name.png" width="70" alt="Oja">
</p>

> *Oja* (Yoruba: *marketplace*) — a minimal, zero-build JavaScript framework for building multi-page SPAs.

No compiler. No virtual DOM. No node_modules. Drop files in, open a browser, it works.

---

## Why Oja exists

Most frameworks make you choose between **simplicity** and **capability**.

Alpine.js is simple but can't build a real SPA. React can build anything but requires a build step, a compiler, and forces HTML into JavaScript. Oja is the middle path — plain HTML files, plain JS files, one small framework layer.

The insight that shaped Oja: the real separation needed in a codebase is not just files — it is **people and roles**.

```
UI developer  →  opens .html and .css only, never touches .js
JS developer  →  opens .js only, never writes HTML strings
```

A component is a plain `.html` file a UI developer can open in a browser, edit, and see results. The JS only supplies data.

---

## What Oja does not do

- No build step — ever
- No virtual DOM
- No TypeScript (plain JS only)
- No CSS-in-JS
- No two-way data binding
- No bundling
- No server-side rendering

---

## Get started

**[→ Learn Oja by building a real app — TUTORIAL.md](TUTORIAL.md)**

The tutorial builds a complete task board from scratch. Every concept is introduced exactly when it is needed — state, routing, components, layouts, forms, modals, keyboard shortcuts, auth guards, the engine, search, tables, offline support, and more. No abstractions in advance.

---

## Installation

No package manager required.

### CDN (recommended)

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@agberohq/oja@latest/build/oja.min.css">

<script type="importmap">
{
    "imports": {
        "@agberohq/oja": "https://cdn.jsdelivr.net/npm/@agberohq/oja@latest/build/oja.full.esm.js"
    }
}
</script>
```

The import map goes in `index.html` once. Every script on the page — including inline scripts inside your component `.html` files — uses the bare `@agberohq/oja` specifier. You never repeat it.

Pin to a specific version in production:
```html
"@agberohq/oja": "https://cdn.jsdelivr.net/npm/@agberohq/oja@0.0.11/build/oja.full.esm.js"
```

### npm

```bash
npm install @agberohq/oja
```

Point the import map at `./node_modules/@agberohq/oja/build/oja.full.esm.js`. Everything else is identical.

### Self-hosted

```bash
npm install --save-dev esbuild clean-css-cli
make        # → build/oja.full.esm.js + build/oja.min.css
make watch  # rebuild on save
```

### Direct source imports

Copy `src/` and import directly — no build step ever. This is how the example apps work.

```js
import { Router, Out, notify } from '../oja/src/oja.js';
```

---

## Build variants

| File | Contains | Use when |
|------|----------|----------|
| `oja.full.esm.js` | Everything | Default |
| `oja.core.esm.js` | Core only | Size-sensitive apps |
| `oja.core.min.js` | Core IIFE — `window.Oja` | No ES module support |
| `oja.min.css` | All UI component styles | Always include |

---

## Four ideas, one framework

### 1. Reactivity — state that drives the UI automatically

```js
import { state, effect, derived, context, signal } from '@agberohq/oja';

const [count, setCount] = state(0);
const doubled = derived(() => count() * 2);

effect(() => {
    find('#counter').update({ text: `${count()} × 2 = ${doubled()}` });
});

setCount(5); // counter updates automatically
```

`state` holds a value. `effect` reacts to it. `derived` computes from it. `context` shares it across the whole app. `signal` connects two components that have no common parent — a late subscriber always gets the current value immediately.

#### Writing context values

`context` returns a `[read, write]` pair. When you only need to write — without subscribing — use `context.set()`:

```js
// Full pair — for components that both subscribe and write:
const [notes, setNotes] = context('notes');

// Write-only — no empty comma, clear intent:
context.set('notes', updatedList);

// Read current value once, no subscription:
const current = context.get('notes');
```

---

### 2. `Out` — one primitive for all visible output

No raw `innerHTML`. No ad-hoc DOM writes. Every piece of visible output is an `Out` — composable, lazy, typed. It describes *what* to show without rendering it immediately.

```js
import { Out } from '@agberohq/oja';

// Render a component file
Out.component('pages/dashboard.html', { user, metrics })

// Conditional rendering — condition evaluated at render time
Out.if(() => user.isAdmin, Out.c('admin.html'), Out.c('denied.html'))

// List — one Out per item, keyed reconciliation
Out.list(hosts, h => Out.c('components/host-row.html', h))

// Async — three states in one call
Out.promise(fetchUser(id), {
    loading: Out.c('states/loading.html'),
    success: (user) => Out.c('pages/user.html', user),
    error:   Out.c('states/error.html'),
})

// Inline charts — zero dependencies
Out.sparkline([12, 45, 23, 67], { color: '#00c770', fill: true })
```

`Out` is accepted everywhere Oja produces visible output — router, modal, notify, component, layout.

---

### 3. `find()` — DOM queries scoped to the current component

`find()` returns an enhanced element. Inside a component script, it automatically searches within that component's container — multiple instances on the same page never interfere. Outside a component script, it falls back to `document`.

```js
import { find, findAll } from '@agberohq/oja';

// Inside a component script — scoped to this instance automatically
const btn = find('#save-btn');

// Declarative patch — describe what the element should look like
find('#badge').update({
    text:  'Online',
    class: { add: 'badge-success', remove: 'badge-loading' },
    attr:  { 'data-status': 'alive' },
});

// Reactive — re-runs automatically when signals change
find('#count').update({ text: () => `${tasks().length} tasks` });

// Render any Out directly into an element
find('#detail-panel').update({ out: Out.c('components/detail.html', { host }) });

// Keyed list reconciliation — only changed nodes are patched
find('#host-list').list(() => hosts(), {
    key:    h => h.id,
    render: h => Out.c('components/host-row.html', h),
    empty:  Out.h('<p>No hosts yet</p>'),
});
```

#### Async-safe DOM access

`find()` resolves its scope from the active component context, which is only set during synchronous top-level execution. Inside `setTimeout`, async callbacks, or `effect()` handlers, the context is gone and `find()` falls back to `document`.

Two patterns to handle this:

```js
import { find, scoped, ref } from '@agberohq/oja';

// scoped() — capture bound query functions at top-level:
const { find: scopedFind, findAll: scopedFindAll } = scoped();

component.onMount(() => {
    setTimeout(() => {
        scopedFind('#status').textContent = 'ok';   // always correct
        scopedFindAll('.item').forEach(el => el.classList.add('ready'));
    }, 1000);
});

// ref() — capture a single element at top-level:
const syncDot = ref('#sync-dot');

setTimeout(async () => {
    const quota = await getVfsQuota();
    syncDot.el.title = `Saved · ${quota}`;   // always safe
}, 600);
```

`scoped()` gives you bound `find`/`findAll` functions for anything inside the container. `ref()` captures one specific element. Both are permanently bound to the container at the moment they are called — they work correctly from any callback, async function, or effect.

---

### 4. `make()` — build DOM without HTML strings

```js
import { make } from '@agberohq/oja';

// Build, place, and update in one chain
make.div({ class: 'host-card', data: { id: host.id } },
    make.h2({ class: 'hostname' }, host.name),
    make.span({ class: 'badge', style: { color: 'green' } }, 'Online'),
    make.button({
        class: 'btn-danger',
        on:    { click: () => deleteHost(host.id) },
    }, 'Delete'),
)
.appendTo('#host-list')
.update({ class: { add: 'loaded' } });

// Placement methods — all return `this` so the chain never breaks
make.div({ class: 'toast' }, message).appendTo('#notifications');
make.div({ id: 'new' }).replace('#old');
make.li({ data: { id: '42' } }, 'New item').prependTo('#list');
```

All placement methods: `.appendTo()` `.prependTo()` `.after()` `.before()` `.replace()`

---

## Component scripts — explicit imports, no magic

Every import in a component script is visible, IDE-friendly, and statically analysable. Nothing is injected automatically.

```html
<!-- components/status-badge.html -->
<span class="badge">Loading…</span>

<script type="module">
import { find, container, props, ready } from '@agberohq/oja';

// find() is automatically scoped to this component instance
const badge = find('.badge');
badge.textContent = props().status;

// container() gives you the raw DOM element this script is mounted into
console.log(container().tagName); // → 'DIV'

// ready() signals that async setup is complete (optional — fallback is automatic)
ready();
</script>
```

| Import | What it returns |
|--------|----------------|
| `find(sel)` | Enhanced element scoped to this component, or `document` if called outside |
| `findAll(sel)` | NodeList scoped to this component |
| `scoped()` | `{ find, findAll, el }` — permanently bound to this container, safe in async callbacks |
| `ref(sel)` | `{ el }` — captures one element at call time, safe in async callbacks |
| `container()` | The DOM element this script is mounted into |
| `props()` | Read-only object of the data passed at mount time |
| `ready()` | Signals setup is complete — resolves the mount promise |

Signals in props are unwrapped automatically — access `props().tasks` and it calls `tasks()` for you.

---

## Auth — session management

Oja's auth module handles JWTs, opaque tokens, role checks, and route protection without any external library.

### Quick setup

```js
import { auth, context } from '@agberohq/oja';

export const [currentUser, setCurrentUser] = context('user', null);

// Define access levels — called on every route check
auth.level('public',    () => true);
auth.level('protected', () => auth.session.isActive());
auth.level('admin',     () => auth.session.isActive() && auth.hasRole('admin'));

// Hooks — fire at session lifecycle points
auth.session.OnStart(async (token) => {
    api.setToken(token);                          // set synchronously via tokenSync()
    const dest = auth.session.intendedPath() || '/';
    auth.session.clearIntendedPath();
    router.navigate(dest);
});

auth.session.OnRenew((newToken) => api.setToken(newToken));

auth.session.OnExpiry(() => {
    setCurrentUser(null);
    router.navigate('/login');
    notify.warn('Session expired. Please sign in again.');
});
```

### Starting a session after login

```js
form.on(loginForm, {
    submit: async (data) => {
        const user = await api.login(data.username, data.password);
        await auth.session.start(user.token);  // stores token, fires OnStart
        setCurrentUser(user);
        return user;
    },
    success: () => notify.success('Welcome back!'),
    error:   (err) => notify.error(err.message),
});
```

### Session API

| Method | Returns | Notes |
|--------|---------|-------|
| `auth.session.start(token, refreshToken?, options?)` | `Promise<void>` | Stores token, fires `OnStart` hooks |
| `auth.session.end()` | `Promise<void>` | Clears token, fires no hooks — call before logout redirect |
| `auth.session.renew(newToken, newRefreshToken?)` | `Promise<void>` | Replaces token, fires `OnRenew` hooks |
| `auth.session.isActive()` | `boolean` | Synchronous — safe in middleware and effects |
| `auth.session.token()` | `Promise<string\|null>` | Async — decrypted token string |
| `auth.session.tokenSync()` | `string\|null` | **Synchronous** — returns `null` if inactive. Use in `OnStart` to set API headers immediately |
| `auth.session.user()` | `object\|null` | Decoded JWT payload — `sub`, `roles`, custom claims |
| `auth.session.expiresIn()` | `number` | Milliseconds until expiry, `Infinity` if no expiry set |
| `auth.session.intendedPath()` | `string\|null` | Path the user was heading to before being redirected |
| `auth.session.setIntendedPath(path)` | `void` | Set manually if needed |
| `auth.session.clearIntendedPath()` | `void` | Call after navigating to the intended path |

### `tokenSync()` — synchronous token access

`tokenSync()` is the method added for cases where you need the token before any async operation resolves — for example, setting an API authorization header the moment a session starts:

```js
// In OnStart — synchronous, no await needed
auth.session.OnStart((token) => {
    // tokenSync() returns the same token immediately
    const t = auth.session.tokenSync();
    if (t) api.setToken(t);
});

// Also useful on app startup to restore a previous session
const savedToken = auth.session.tokenSync();
if (savedToken) api.setToken(savedToken);
```

`tokenSync()` returns `null` when no session is active — it never throws.

### Non-JWT tokens

Not every API uses JWTs. Oja supports opaque tokens and Basic auth too:

```js
// Opaque token — pass { expires: null } for no-expiry session
await auth.session.start('Bearer sk-abc123', null, { expires: null });
auth.session.isActive(); // → true

// Fixed expiry — useful for session cookies or API keys with known TTL
await auth.session.start('api-key-xyz', null, { expires: Date.now() + 8 * 3600_000 });

// No options — isActive() returns false (original behaviour, preserved for compatibility)
await auth.session.start('legacy-token');
auth.session.isActive(); // → false
```

### Protecting routes

```js
// Middleware style — on individual routes
router.Get('/admin', auth.middleware('admin'), Out.c('pages/admin.html'));

// Group style — covers all routes in the group
const app = router.Group('/');
app.Use(auth.middleware('protected', '/login'));

app.Get('/dashboard', Out.c('pages/dashboard.html'));
app.Get('/settings',  Out.c('pages/settings.html'));
```

`auth.middleware()` stores the attempted path before redirecting — call `auth.session.intendedPath()` in `OnStart` to send the user where they were going.

### Role checks

```js
// In a JWT payload: { sub: 'u1', roles: ['editor', 'viewer'], email_verified: true }

auth.hasRole('editor');         // → true
auth.hasRole('admin');          // → false

// Check arbitrary claims
auth.hasClaim('email_verified');        // → true  (claim exists)
auth.hasClaim('email_verified', true);  // → true  (claim equals value)
auth.hasClaim('department', 'eng');     // → false

// Use in level definitions
auth.level('editor',   () => auth.session.isActive() && auth.hasRole('editor'));
auth.level('verified', () => auth.session.isActive() && auth.hasClaim('email_verified', true));
```

---

## Engine: lifecycle callbacks for lists

`engine.list()` and `engine.listAsync()` accept lifecycle callbacks so imperative plugins can be initialized exactly once, without flags:

```js
engine.list('#notes', notes(), {
    key:    n => n.id,
    render: (note, existing) => { /* ... */ return el; },

    // Runs once after the first render — use for plugin setup
    onMount: (container) => {
        dragdrop.reorder(container, {
            handle:    '.drag-handle',
            onReorder: els => saveOrder(els.map(el => el.dataset.id)),
        });
    },

    // Runs for each newly inserted item — NOT for updated existing items
    onItemMount: (itemEl, data, index) => {
        initTooltip(itemEl);
    },

    // Runs before an item is removed from the DOM
    onItemRemove: (itemEl) => {
        destroyTooltip(itemEl);
    },
});
```

`onMount` fires exactly once regardless of how many times the reactive system calls `list()`. `onItemMount` only fires for genuinely new items — items that were reused from the previous render do not trigger it. This replaces the `if (!el._dragBound)` guard pattern entirely.

---

## Reactivity — which primitive to use

```
┌─────────────────────────────────────────────────────────────┐
│                    REACTIVE SYSTEM                          │
│  state() → derived() → effect()             batch()        │
│      └──────────────────┘                                   │
│              ↓                                              │
│          context()   (global named reactive state)          │
│              ↓                                              │
│           watch()    (effect for a single value,            │
│                       gives old + new value)                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                 IMPERATIVE EVENT BUS                         │
│  emit() / on()     signal() — named bus with value cache   │
└─────────────────────────────────────────────────────────────┘
```

| I want to… | Use |
|---|---|
| Reactive state shared across components | `context()` |
| Local reactive state inside one component | `state()` |
| A computed/derived value | `derived()` |
| Run code when any signal I read changes | `effect()` |
| Run code when one specific signal changes | `watch()` |
| Fire a one-shot event | `emit()` / `on()` |
| A named bus that remembers its last value | `signal()` |

`signal()` is an imperative pub/sub bus — it is not tracked by `effect()`. Use `context()` for reactive state and `signal()` for "current value + subscribe" communication between distant components.

---

## What's in the box

| Feature | Export | Build |
|---------|--------|-------|
| Reactive state (`state`, `effect`, `derived`, `batch`) | named | core + full |
| Cross-module state (`context`) | named | core + full |
| Reactive component communication (`signal`) | named | core + full |
| DOM builder (`make`, `make.div`, `make.span` …) | named | core + full |
| Enhanced queries (`find`, `query`, `findAll`, `queryAll`) | named | core + full |
| Async-safe DOM capture (`scoped`, `ref`) | named | core + full |
| Component context (`container`, `props`, `ready`) | named | core + full |
| Router (hash + history, groups, middleware, named routes) | `Router` | core + full |
| Layout (persistent shell, slots, `allSlotsReady`) | `layout` | core + full |
| Component lifecycle (`onMount`, `onUnmount`, `interval`) | `component` | core + full |
| Template syntax (`{{}}`, `data-if`, `data-each`, filters) | built-in | core + full |
| Auth (levels, session, JWT, tokenSync, middleware, roles) | `auth` | core + full |
| Notifications (toast, banner, progress, promise) | `notify` | core + full |
| Modals (stack, confirm, prompt, beforeClose guard) | `modal` | core + full |
| Forms (lifecycle, validation, dirty tracking, secret, radio) | `form` | core + full |
| Events (delegated, emit/listen, keyboard shortcuts) | `on`, `emit`, `listen` | core + full |
| Store (session/local/memory, encrypt, watch, TTL) | `Store` | core + full |
| Encryption (Web Crypto, seal/open/rotate) | `encrypt` | core + full |
| Engine (list reconcile, morph, `data-oja-bind`, lifecycle callbacks) | `engine` | core + full |
| Progress (milestone hooks, reverse, bind, track) | `progress` | core + full |
| Runtime unified event bus (`runtime.on/off/emit`) | `runtime` | core + full |
| Animate (fade, slide, collapse, countUp, typewriter, shake) | `animate` | core + full |
| Collapse + accordion | `collapse`, `accordion` | core + full |
| Wizard (multi-step form, modal-compatible) | `wizard` | full |
| Search + autocomplete (full-text, fuzzy, Trie) | `Search`, `Trie` | core + full |
| Table (sort, pagination, row actions, remote data, resizable columns) | `table` | full |
| Inline charts (sparkline, timeSeries) | `Out.sparkline` | core + full |
| Clipboard | `clipboard` | core + full |
| Drag and drop | `dragdrop` | full |
| VFS (offline-first IndexedDB, encrypt, persist, quota) | `VFS` | core + full |
| Config (`oja.config.json`) | `config` | core + full |
| SSE + WebSocket (auto-reconnect) | `SSE`, `Socket` | full |
| Channel + go (Go-style concurrency) | `Channel`, `go` | full |
| Runner (long-lived background worker) | `Runner` | full |
| Command palette / hotkeys | `hotkeys` | full |
| Floating panels | `panel` | full |
| Datepicker | `datepicker` | full |
| Searchable select | `select` | full |
| Context menu | `clickmenu` | full |
| Offline request queue | `Queue` | full |
| Multi-user presence + cursors | `Presence` | full |
| Logging + debug | `logger`, `debug` | core + full |
| Adapter bridge (D3, Chart.js, GSAP) | `adapter` | core + full |

---

## Design decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Build step | None | Drop-in simplicity, no node_modules |
| Virtual DOM | No | Direct DOM + targeted `effect()` |
| Display primitive | `Out` everywhere | One type for all visible output — composable, typed, no raw strings |
| DOM queries | `find()` reads execution context | Scoped automatically in component scripts, falls back to document outside — explicit import, no magic injection |
| Async DOM access | `scoped()` and `ref()` | Permanently bound at capture time — safe in any callback, async function, or effect |
| Component context | `container()`, `props()`, `ready()` | Named imports — IDE-visible, testable, statically analysable |
| DOM creation | `make()` with placement chain | Build, place, and update in one expression |
| List lifecycle | `onMount`, `onItemMount`, `onItemRemove` | One-time plugin setup without guard flags; new-items-only callbacks |
| URL strategy | Hash default, path opt-in | Hash works everywhere without server config |
| CSS ownership | App owns all styles, framework CSS in `oja.css` | No JS-injected styles — all component CSS lives in one file |
| Auth | Declared at route level | Never check `isActive()` manually in page logic |
| `tokenSync()` | Synchronous token read | Set API headers immediately in `OnStart` without awaiting |
| Event bus | Single unified bus | All modules emit on `events.js`. `runtime.on()` is the public subscription point |
| Component communication | `signal()` | Reactive, holds current value — unlike fire-and-forget emit/listen |
| Context write shorthand | `context.set(name, value)` | Write without destructuring when you don't need the read signal |
| Progress | Direction-aware + hooks | Milestone hooks, reverse animation, runtime binding |
| Offline | VFS optional | Progressive enhancement — start without it, add it when needed |

---

## Known limitations

- **Nested `{{range}}` loops**: inner `Index`/`First`/`Last` are list-absolute in chunked renders — access the outer variable by its `data-as` name.
- **`Wasm` worker mode**: JS import callbacks are stubbed in the worker thread. Use non-worker mode for WASM modules that need JS callbacks.
- **`Worker` scope isolation**: worker functions are serialised as strings — they cannot close over variables from the outer scope.
- **`webrtc.js`**: WebRTC signaling is application-specific. Wire your own signaling server using `createPeer()` / `createOffer()` / `setLocalDescription()`.

---

## License

MIT
