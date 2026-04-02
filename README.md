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

// Batch — update every matching element
findAll('.host-row').forEach(el =>
    el.update({ class: { toggle: 'selected' } })
);
```

`find()` works correctly in every context — component scripts, page scripts, `app.js`. Import it explicitly from `@agberohq/oja`. No magic.

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
| `container()` | The DOM element this script is mounted into |
| `props()` | Read-only object of the data passed at mount time |
| `ready()` | Signals setup is complete — resolves the mount promise |

Signals in props are unwrapped automatically — access `props().tasks` and it calls `tasks()` for you.

---

## What's in the box

| Feature | Export | Build |
|---------|--------|-------|
| Reactive state (`state`, `effect`, `derived`, `batch`) | named | core + full |
| Cross-module state (`context`) | named | core + full |
| Reactive component communication (`signal`) | named | core + full |
| DOM builder (`make`, `make.div`, `make.span` …) | named | core + full |
| Enhanced queries (`find`, `query`, `findAll`, `queryAll`) | named | core + full |
| Component context (`container`, `props`, `ready`) | named | core + full |
| Router (hash + history, groups, middleware, named routes) | `Router` | core + full |
| Layout (persistent shell, slots, `allSlotsReady`) | `layout` | core + full |
| Component lifecycle (`onMount`, `onUnmount`, `interval`) | `component` | core + full |
| Template syntax (`{{}}`, `data-if`, `data-each`, filters) | built-in | core + full |
| Auth (levels, session, JWT, middleware) | `auth` | core + full |
| Notifications (toast, banner, progress, promise) | `notify` | core + full |
| Modals (stack, confirm, prompt, beforeClose guard) | `modal` | core + full |
| Forms (lifecycle, validation, dirty tracking) | `form` | core + full |
| Events (delegated, emit/listen, keyboard shortcuts) | `on`, `emit`, `listen` | core + full |
| Store (session/local/memory, encrypt, watch, TTL) | `Store` | core + full |
| Encryption (Web Crypto, seal/open/rotate) | `encrypt` | core + full |
| Engine (list reconcile, morph, `data-oja-bind`) | `engine` | core + full |
| Progress (milestone hooks, reverse, bind, track) | `progress` | core + full |
| Runtime unified event bus (`runtime.on/off/emit`) | `runtime` | core + full |
| Animate (fade, slide, collapse, countUp, typewriter, shake) | `animate` | core + full |
| Collapse + accordion | `collapse`, `accordion` | core + full |
| Wizard (multi-step form, modal-compatible) | `wizard` | full |
| Search + autocomplete (full-text, fuzzy, Trie) | `Search`, `Trie` | core + full |
| Table (sort, pagination, row actions, remote data) | `table` | full |
| Inline charts (sparkline, timeSeries) | `Out.sparkline` | core + full |
| Clipboard | `clipboard` | core + full |
| Drag and drop | `dragdrop` | full |
| VFS (offline-first IndexedDB, encrypt, persist, quota) | `VFS` | core + full |
| Config (`oja.config.json`) | `config` | core + full |
| SSE + WebSocket (auto-reconnect) | `OjaSSE`, `OjaSocket` | full |
| Channel + go (Go-style concurrency) | `Channel`, `go` | full |
| Runner (long-lived background worker) | `Runner` | full |
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
| Component context | `container()`, `props()`, `ready()` | Named imports — IDE-visible, testable, statically analysable |
| DOM creation | `make()` with placement chain | Build, place, and update in one expression |
| URL strategy | Hash default, path opt-in | Hash works everywhere without server config |
| CSS ownership | App owns all styles | Oja only owns lifecycle animation and UI component classes |
| Auth | Declared at route | Never check `isActive()` manually |
| Event bus | Single unified bus | All modules emit on `events.js`. `runtime.on()` is the public subscription point |
| Component communication | `signal()` | Reactive, holds current value — unlike fire-and-forget emit/listen |
| Progress | Direction-aware + hooks | Milestone hooks, reverse animation, runtime binding |
| Offline | VFS optional | Progressive enhancement — start without it, add it when needed |

---

## Known limitations

- **Nested `{{range}}` loops**: inner `Index`/`First`/`Last` are list-absolute in chunked renders — access the outer variable by its `data-as` name.
- **`OjaWasm` worker mode**: JS import callbacks are stubbed in the worker thread. Use non-worker mode for WASM modules that need JS callbacks.
- **`OjaWorker` scope isolation**: worker functions are serialised as strings — they cannot close over variables from the outer scope.
- **`webrtc.js`**: WebRTC signaling is application-specific. Wire your own signaling server using `createPeer()` / `createOffer()` / `setLocalDescription()`.

---

## License

MIT