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

## Tutorials 
[TUTORIAL.md](TUTORIAL.md) for detailed step-by-step tutorials.

## Installation

No package manager required. Three ways to use Oja:

---

### Option 1 — CDN (recommended)

Drop in a link and an import map. No install, no build step, no node_modules.

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

The import map goes in `index.html` once. Every script on the page — including
inline scripts inside your component `.html` files — can then use the bare
`@agberohq/oja` specifier directly.

Pin to a specific version in production:

```html
<script type="importmap">
{
    "imports": {
        "@agberohq/oja": "https://cdn.jsdelivr.net/npm/@agberohq/oja@0.0.11/build/oja.full.esm.js"
    }
}
</script>
```

---

### Option 2 — Self-hosted (build from source)

Clone the repo and build once.

**Requirements** (one-time setup):
```bash
npm install --save-dev esbuild clean-css-cli
```

**Build:**
```bash
make          # builds everything → build/oja.full.esm.js + build/oja.min.css
make watch    # rebuild on save during development
make check    # show output sizes
make clean    # remove build/
```

**Include in your app:**
```html
<link rel="stylesheet" href="../oja/build/oja.min.css">

<script type="importmap">
{
    "imports": {
        "@agberohq/oja": "../oja/build/oja.full.esm.js"
    }
}
</script>
```

---

### Option 3 — Direct source imports (zero build, development friendly)

Copy the `src/` folder and import directly. No build step ever.

```
my-project/
    index.html
    app.js
    oja/
        src/          ← copied from this repo
    pages/
    components/
```

```js
// app.js
import { Router, Out, auth, notify, component } from '../oja/src/oja.js';
```

---

### Option 4 — npm

```bash
npm install @agberohq/oja
```

Point the import map at `node_modules`:

```html
<link rel="stylesheet" href="./node_modules/@agberohq/oja/build/oja.min.css">

<script type="importmap">
{
    "imports": {
        "@agberohq/oja": "./node_modules/@agberohq/oja/build/oja.full.esm.js"
    }
}
</script>
```

---

## Build variants

| File | Contains | Use when |
|------|----------|----------|
| `oja.full.esm.js` | Everything | Default — the import map examples above all point here |
| `oja.core.esm.js` | Core only (no WebSocket, Worker, WASM, canvas, drag-and-drop) | Size-sensitive production apps |
| `oja.core.min.js` | Core IIFE — `window.Oja` | Legacy scripts, no ES module support |
| `oja.min.css` | Oja UI components (toasts, modals, tables, wizard, progress) | Always include alongside any build |

---

## Grouped imports

When you want a clean namespace without listing every name:

```js
import { Reactive, Event, DOM } from '@agberohq/oja';

// Reactivity
const [count, setCount] = Reactive.state(0);
Reactive.effect(() => console.log(count()));

// Events
Event.on('.btn', 'click', handler);
Event.emit('app:ready');
Event.debounce(search, 200);

// DOM helpers — all scoped, all chainable
const el = DOM.find('#app');
DOM.createEl('div', { class: 'card' });
```

---

## Core concepts

### 1. `Out` — the universal display primitive

`Out` is how Oja produces every piece of visible output. No raw HTML strings. No ad-hoc `innerHTML`. One primitive, composable everywhere.

```js
import { Out } from '@agberohq/oja';

// Render a component file
Out.component('pages/dashboard.html', { user, metrics })

// Raw HTML — no script execution (safe for user-generated content)
Out.raw('<p>User content</p>')

// HTML with script execution
Out.html('<div class="card">...</div>')

// Text — safely escaped
Out.text('Hello, world')

// Shorthands
Out.c('components/card.html', data)  // Out.component()
Out.h('<p>content</p>')              // Out.html()
Out.t('plain text')                  // Out.text()
```

#### Composition — conditional, list, async

```js
// Conditional — condition evaluated at render time
Out.if(() => user.isAdmin, Out.c('admin.html'), Out.c('denied.html'))

// List — one Out per item
Out.list(users, (user) => Out.c('components/user.html', user))
Out.list(users, (user) => Out.c('components/user.html', user), {
    empty: Out.c('states/no-users.html'),
})

// Async — loading → success → error
Out.promise(fetchUser(id), {
    loading: Out.c('states/loading.html'),
    success: (user) => Out.c('pages/user.html', user),
    error:   Out.c('states/error.html'),
})

// Lazy async — called at render time
Out.fn(async (container, ctx) => {
    const host = await api.get(`/hosts/${ctx.params.id}`);
    return Out.c('pages/host-detail.html', host);
})
```

#### Fluent API — Out.to()

```js
// Out.to() returns a chainable OutTarget — use it for direct DOM rendering
Out.to('#app').html('<h1>Hello</h1>');
Out.to('#app').component('pages/hosts.html', data);
Out.to('#panel').animate('fadeIn').component('modal.html');
Out.to('#app').with({ user }).component('page.html');
Out.to('#panel').when(() => user.isAdmin).component('admin.html');

// Tagged template literal — use Out.tag() for interpolated HTML
Out.tag('#greeting')`<h1>Hello ${name}!</h1>`;

// DOM helpers — all chainable, all return the OutTarget
Out.to('#el').show().addClass('active');
Out.to('#el').hide();
Out.to('#el').toggle();
Out.to('#el').addClass('loading');
Out.to('#el').removeClass('loading');
Out.to('#el').attr('data-state', 'ready');
Out.to('#el').css({ color: 'red' });
```

#### Inline charts — no dependencies

```js
// Sparkline — zero-dependency SVG line chart
Out.sparkline([12, 45, 23, 67, 34, 89], {
    color:  '#00c770',
    height: 40,
    fill:   true,
})

// Time series — multiple series, axis labels
Out.timeSeries([
    { label: 'HTTP', values: [12, 45, 23], color: '#4f8ef7' },
    { label: 'TCP',  values: [5,  12, 8],  color: '#00c770' },
], { height: 120, timestamps: ['00:00', '00:01', '00:02'] })
```

---

### 2. Components are plain HTML files

```html
<!-- components/host-card.html -->
<div class="host-card" data-if-class="alive:host-alive">
    <strong>{{hostname}}</strong>
    <span class="badge {{if .tls}}badge-tls{{else}}badge-plain{{end}}">
        {{if .tls}}🔒 {{tlsMode}}{{else}}No TLS{{end}}
    </span>
    <div class="host-stats">
        <span>{{totalReqs | bytes}} reqs</span>
        <span>{{p99Ms}}ms p99</span>
    </div>
</div>
```

A UI developer can open this file in a browser. No JSX. No template compilation.

### 3. Every component script gets scoped helpers

When Oja mounts a component, the inline script automatically receives `container`, `find`, `findAll`, and `props`. Use them instead of global DOM queries — they are scoped to this component instance.

```html
<!-- components/image.html -->
<img class="avatar">
<div class="spinner"></div>

<script type="module">
    // find() and findAll() are scoped to this component instance.
    // Global document queries are an anti-pattern — if two instances
    // of this component are mounted, they would both target the same node.
    const img     = find('img');
    const spinner = find('.spinner');

    const image = new Image();
    image.onload  = () => { img.src = image.src; spinner.remove(); };
    image.onerror = () => { spinner.textContent = '✗'; };
    image.src     = img.dataset.src;
</script>
```

| Variable    | What it is                                        |
|-------------|---------------------------------------------------|
| `container` | The DOM element this component was mounted into   |
| `find`      | `querySelector` scoped to `container`             |
| `findAll`   | `querySelectorAll` scoped to `container`          |
| `props`     | Read-only proxy of the props passed at mount time |

### 4. Reactive state — fine-grained, no virtual DOM

```js
import { state, effect, derived, batch, context } from '@agberohq/oja';

const [metrics, setMetrics] = state(null);
const [history, setHistory] = state([]);

const errorRate = derived(() => {
    const m = metrics();
    if (!m) return '0%';
    return ((m.errors / m.total) * 100).toFixed(2) + '%';
});

// effect() runs whenever metrics() changes — updates real DOM directly
effect(() => {
    const m = metrics();
    if (!m) return;
    Out.to('#stat-rps').text(m.rps + ' req/s');
    Out.to('#stat-errors').text(errorRate());
});

// Cross-module shared state — same value anywhere in the app
export const [isOnline, setOnline] = context('isOnline', true);
```

#### Reactive channels — component communication

`channel()` is the right primitive when two components need to share state
without a common parent. Late subscribers always receive the current value
immediately on subscribe — unlike `emit/listen` which is fire-and-forget.

```js
import { channel } from '@agberohq/oja';

// In hosts.html — write
const selected = channel('host:selected');
selected.set({ id: 42, name: 'api.example.com' });

// In sidebar.html — read (gets current value immediately even if set before mount)
const selected = channel('host:selected');
const off = selected.subscribe(host => {
    if (host) renderDetail(host);
});

// One-time read without subscribing
const host = selected.get();

// Clean up when the owning component unmounts
component.onUnmount(() => selected.destroy());
```

### 5. Router — Go-style middleware and groups

```js
import { Router, Out, auth } from '@agberohq/oja';

const router = new Router({
    mode    : 'hash',
    outlet  : '#app',
    loading : Out.html('<div class="spinner"></div>'),
});

// Global middleware
router.Use(async (ctx, next) => {
    const t = Date.now();
    await next();
    console.log(`${ctx.path} — ${Date.now() - t}ms`);
});

// Public route
router.Get('/login', Out.component('pages/login.html'));

// Protected group — middleware only applies inside
const app = router.Group('/app');
app.Use(auth.middleware('protected', '/login'));
app.Get('/dashboard', Out.component('pages/dashboard.html'));
app.Get('/hosts',     Out.component('pages/hosts.html'));

// Nested group — middleware stacks correctly
const hosts = app.Group('/hosts');
hosts.Use(async (ctx, next) => {
    ctx.host = await api.get(`/hosts/${ctx.params.id}`);
    if (!ctx.host) return ctx.redirect('/app/hosts');
    await next();
});
hosts.Get('/{id}',        Out.component('pages/host-detail.html'));
hosts.Get('/{id}/routes', Out.component('pages/host-routes.html'));

// Named routes — generate URLs without string construction
router.name('host.detail', '/app/hosts/{id}');
router.navigateTo('host.detail', { id: 42 });
router.path('host.detail', { id: 42 }); // → '/app/hosts/42'

router.NotFound(Out.html(`
    <div class="error-page">
        <div class="error-code">404</div>
        <a href="#/app/dashboard">Dashboard</a>
    </div>
`));

router.start('/login');
```

### 6. Auth — declared once, never checked manually

```js
// Define levels once
auth.level('protected', () => auth.session.isActive());
auth.level('admin',     () => auth.session.isActive() && auth.hasRole('admin'));

// Hook into session lifecycle
auth.session.OnStart(async (token) => {
    api.setToken(token);
    const dest = auth.session.intendedPath() || '/dashboard';
    auth.session.clearIntendedPath();
    router.navigate(dest);
});

auth.session.OnExpiry(() => {
    notify.warn('Session expired');
    router.navigate('/login');
});

// Login — one line
await auth.session.start(responseToken);
```

### 7. Layout — persistent shell with slot injection

```js
import { layout } from '@agberohq/oja';

// Mount once — survives navigation
await layout.apply('#app', 'layouts/main.html', { user: currentUser });

// Update data in the shell without remounting
layout.update({ user: updatedUser });

// Named slots — fill async content into specific areas
await layout.slot('sidebar', Out.component('components/sidebar.html', { items }));

// Wait for all slots to finish their async setup before loading content
await layout.allSlotsReady(['nav', 'sidebar']);
await loadInitialContent();

// Router middleware — switch layouts per route group
const publicGroup = router.Group('/');
publicGroup.Use(layout.middleware('layouts/auth.html', '#app'));
publicGroup.Get('/login', Out.component('pages/login.html'));
```

### 8. Component lifecycle — automatic cleanup

```js
// In any page script — Oja cleans up automatically on navigate
component.interval(refresh, 3000);   // cleared on navigate away
component.timeout(showTip, 5000);    // cleared if user navigates first

component.onMount(() => {
    find('#search')?.focus();
});

component.onUnmount(() => {
    sse.close();
    notify.dismissBanner();
});
```

### 9. Runtime — unified event bus

`runtime` is the single coordination point for all Oja internal events.
Every module — router, component, layout, out, api — emits on the same bus.

```js
import { runtime } from '@agberohq/oja';

// Subscribe to any internal event
const off = runtime.on('component:mounted', ({ url, ms }) => {
    console.log(`${url} loaded in ${ms}ms`);
});

runtime.on('oja:navigate:start', ({ path }) => progress('page').start());
runtime.on('oja:navigate:end',   ({ path }) => progress('page').done());

// Emit custom app events through the same bus
runtime.emit('app:ready', { user });
runtime.emit('hosts:refresh');

// Remove a specific handler
runtime.off('component:mounted', handler);
off(); // or call the returned unsubscribe function

// Full event catalogue:
// Router:    oja:navigate:start  oja:navigate:end  oja:navigate
// Component: component:mounted  component:added  component:removed
//            component:updated  component:cache-hit  component:slow-render
// Layout:    layout:mounted  layout:updated  layout:slot-ready  layout:unmounted
// Out:       out:fetch-start  out:fetch-end  out:fetch-error  out:component-rendered
// Api:       api:error  api:queued  api:unauthorized  api:online  api:offline
// Notify:    notify:toast  notify:banner
// Modal:     modal:open  modal:close
```

### 10. Progress — direction-aware, milestone-driven

```js
import { progress } from '@agberohq/oja';

const p = progress('upload');  // named channels — isolate concerns

// Core
p.start();         // indeterminate pulsing bar
p.set(60);         // jump to 60%
p.inc(10);         // increment by 10 (capped at 99 — use done() for 100)
p.done();          // fill to 100 then fade
p.fail('reason');  // go red then fade
p.reset();         // immediate reset, no animation

// Reverse — animate backward to a checkpoint (e.g. corrupt file, re-upload)
p.reverse(30, { reason: 'corrupt' });

// Color slices — interpolated or snapped
p.color([
    { at: 0,   color: '#3b82f6' },
    { at: 50,  color: '#f59e0b' },
    { at: 100, color: '#10b981' },
], { interpolate: true }); // default

// Hooks — fire at milestones, with direction and condition support
p.on(50, () => notify.info('Halfway'));
p.on(50, handler, { direction: 'up' });    // only going up
p.on(50, handler, { direction: 'down' });  // only going down
p.on(50, handler, { once: true });         // auto-remove after first fire
p.on(50, handler, { if: () => user.isPro }); // conditional

// Lifecycle events
p.on('start',   ()          => showSpinner());
p.on('done',    ()          => hideSpinner());
p.on('fail',    ({ reason })=> showRetry(reason));
p.on('change',  (val, dir)  => updateLabel(val));
p.on('reverse', ({ from, reason }) => notify.warn('Re-uploading…'));

// Batch — register all hooks at once, always merges
p.action({
    30:     () => notify.info('Nearly a third done'),
    50:     { up: () => showMid(), down: () => notify.warn('Regressing') },
    done:   () => cleanup(),
    fail:   () => showRetry(),
    change: (val) => updateLabel(val),
});

// Auto-wire to runtime lifecycle events
p.track(runtime, {
    start: 'oja:navigate:start',
    tick:  'component:mounted',
    total: 10,
    done:  'oja:navigate:end',
});

// Attach inline to an element (default: top-of-page slim bar)
p.attach('#upload-zone');

// Bind to api or uploader — automatic start/done/fail
p.bind(api);
p.bind(uploader);
```

---

## Template syntax

Oja supports two styles — mix freely:

### Data attributes (UI developer friendly)

```html
<div data-if="user.admin">Admin panel</div>
<div data-if-not="user.active">Account suspended</div>
<div data-if-class="alive:dot-green,error:dot-red"></div>
<a data-bind="href:profile.url,title:profile.name">Profile</a>

<template data-each="hosts" data-as="h">
    <div>{{h.hostname}} — {{h.p99Ms}}ms</div>
</template>
<div data-empty="hosts">No hosts found</div>
```

### Go-style inline syntax

```html
{{.user.name | upper}}

{{if .user.admin}}
<span class="badge badge-admin">Admin</span>
{{else}}
<span class="badge">User</span>
{{end}}

{{range .hosts}}
<div class="host {{if .alive}}online{{else}}offline{{end}}">
    {{.hostname}} — {{.totalReqs | bytes}} requests
</div>
{{else}}
<p>No hosts configured</p>
{{end}}
```

### Built-in filters

| Filter | Example | Output |
|--------|---------|--------|
| `upper` | `{{name \| upper}}` | `ALICE` |
| `lower` | `{{name \| lower}}` | `alice` |
| `title` | `{{name \| title}}` | `Alice Smith` |
| `bytes` | `{{size \| bytes}}` | `1.4 MB` |
| `date`  | `{{ts \| date}}` | `18/03/2026` |
| `time`  | `{{ts \| time}}` | `14:32:01` |
| `ago`   | `{{ts \| ago}}` | `5m ago` |
| `default` | `{{val \| default "n/a"}}` | `n/a` |
| `trunc` | `{{text \| trunc 50}}` | `Long text…` |
| `json`  | `{{obj \| json}}` | `{"key":"val"}` |

---

## API reference

### Store — persistent state with cascade

```js
import { Store } from '@agberohq/oja';

const store  = new Store('myapp');
const secure = new Store('myapp', { encrypt: true });
const local  = new Store('myapp', { prefer: 'local' });

store.set('page', 'hosts');
store.get('page', 'dashboard');    // with fallback
store.has('page');
store.clear('page');
store.all();
store.merge('settings', { theme: 'dark' });
store.push('log', entry);
store.increment('count', 1);
store.ttl('session', 30 * 60000); // auto-expire after 30 min

store.onChange('theme', (newVal, oldVal) => applyTheme(newVal));
store.onChange('*', (key, newVal) => sync(key, newVal)); // wildcard
```

Storage cascade: `sessionStorage → localStorage → memory`. Same code works on web, mobile webview, and private browsing.

---

### encrypt — standalone Web Crypto

```js
import { encrypt } from '@agberohq/oja';

const ct = await encrypt.seal('my secret', 'passphrase', 'salt');
const pt = await encrypt.open(ct, 'passphrase', 'salt');

const sig = await encrypt.sign('message', 'secret');
const ok  = await encrypt.verify('message', sig, 'secret');

const newCt = await encrypt.rotate(oldCt, 'old-pass', 'new-pass', 'salt');

if (encrypt.available()) { ... }
```

---

### VFS — offline-first virtual filesystem

```js
import { VFS, Out, Router } from '@agberohq/oja';

const vfs = new VFS('my-app');
await vfs.ready();

await vfs.mount('https://cdn.example.com/my-app/');

const router = new Router({ outlet: '#app', vfs });
router.Get('/', Out.c('pages/home.html'));
router.start('/');
```

**Read / write:**
```js
vfs.write('pages/home.html', html);  // fire and forget
await vfs.flush();                    // guarantee durability
const html = await vfs.readText('pages/home.html');
const bin  = await vfs.read('logo.png');
await vfs.rm('old.html');
const files = await vfs.ls('/');
const tree  = await vfs.tree('/');
```

**Encrypt at rest:**
```js
const vfs = new VFS('secure-app', {
    encrypt: {
        seal:     async (text) => myEncrypt(text),    // called on write
        open:     async (text) => myDecrypt(text),    // called on read
        isSealed: (text) => text.startsWith('ENC:'),  // detect encrypted content
    },
});
```

**Storage quota:**
```js
await vfs.persist();  // request durable storage from browser
const q = await vfs.quota();
console.log(`${q.usedMB} MB used of ${q.quotaMB} MB (${q.percent}%)`);
```

**Change watchers:**
```js
const off = vfs.onChange('pages/', (path, content) => reloadPreview(path));
vfs.on('conflict', ({ path }) => showConflictBadge(path));
vfs.on('mounted',  ({ base, fetched }) => console.log('ready:', fetched.length, 'files'));
off();
```

---

### Events — delegated, cross-component

```js
import { on, once, off, emit, listen, debounce, throttle, keys } from '@agberohq/oja';

on('.btn-delete', 'click', (e, el) => deleteItem(el.dataset.id));
once('#confirm-ok', 'click', handleConfirm);

emit('host:updated', { id: 'api-example-com' });
const unsub = listen('host:updated', ({ id }) => refresh(id));
unsub();

on('#search', 'input', debounce(search, 200));
on('#scroll', 'scroll', throttle(updateNav, 100));

keys({
    'ctrl+s': () => save(),
    'escape': () => modal.closeAll(),
    '/':      () => find('#search')?.focus(),
});

onVisible('#lazy-section', () => loadContent());
onResize('#chart', ({ width, height }) => redraw(width, height));
```

---

### Notifications

```js
import { notify } from '@agberohq/oja';

notify.success('Host added');
notify.error('Connection failed', { duration: 8000 });
notify.warn('Session expires in 5 minutes', {
    action: { label: 'Renew', fn: () => auth.session.renew() }
});

// Progress toast — stays until done/fail/dismiss
const p = notify.progress('Uploading…');
p.update(60);          // shows "Uploading… 60%"
p.done('Upload done'); // switches to success
p.fail('Upload failed');

// Update an existing toast's message and/or type
const id = notify.info('Processing…', { duration: 0 });
notify.update(id, 'Done!', { type: 'success' });

// Promise binding — automatic pending → success/error
notify.promise(uploadFile(), {
    pending: 'Uploading…',
    success: (res) => `Uploaded ${res.name}`,
    error:   'Upload failed',
});

// Banners — persistent, full-width
notify.banner('⚠️ Connection lost. Reconnecting…', { type: 'warn' });
notify.banner(Out.html('Maintenance in 5 min. <a href="#/status">Details</a>'));
notify.dismissBanner();

notify.setPosition('top-right'); // top-right | top-left | top-center | bottom-*
```

---

### Modals

```js
import { modal, Out } from '@agberohq/oja';

// Open returns Promise<Element> — await it when you need the modal element
const el = await modal.open('confirmModal');

// Pass body and footer as Out or plain HTML string
modal.open('infoModal', {
    body:   Out.component('components/user-detail.html', user),
    footer: '<button data-action="modal-close">Done</button>',
    size:   'lg',  // sm | md | lg | xl | full
});

// Programmatic prompt — auto-injects if #promptModal doesn't exist
const name = await modal.prompt('Enter a name', { default: 'Alice' });

// Close guard — prevent close when there are unsaved changes
const off = modal.beforeClose('editModal', async () => {
    if (form.isDirty('#editForm')) {
        return await modal.confirm('Discard changes?');
    }
    return true;
});
off(); // remove the guard

// Stack API
modal.push('routeDrawer', { host: 'api.example.com' });
modal.pop();
modal.closeAll();
modal.isOpen('editModal'); // → boolean
modal.current();           // → id of top modal or null

// Promise-based confirm
const confirmed = await modal.confirm('Delete this rule?');
if (confirmed) await api.delete(`/firewall?ip=${ip}`);
```

---

### Animate

```js
import { animate } from '@agberohq/oja';

// Standard
await animate.fadeIn(find('#panel'), { duration: 300 });
await animate.fadeOut(find('#panel'));
await animate.slideIn(find('#drawer'));
await animate.slideOut(find('#drawer'));

// Collapse / expand — height animation
await animate.collapse('#panel', { duration: 200 });
await animate.expand('#panel');

// Count-up — animate a number from → to
animate.countUp('#revenue', 0, 48750, { duration: 1200, prefix: '$' });
animate.countUp('#requests', 0, 9.99, { decimals: 2 });

// Typewriter — character-by-character reveal
await animate.typewriter('#headline', 'Welcome to Oja.', { speed: 40 });

// Shake — error feedback
animate.shake('#save-btn');
```

---

### Collapse & Accordion

```js
import { collapse, accordion } from '@agberohq/oja';

// Attach a trigger to a panel
const panel = collapse.attach('#toggle-btn', '#content-panel', {
    openFirst: true,
    onChange:  (isOpen) => updateIcon(isOpen),
});
panel.open();
panel.close();
panel.toggle();
panel.destroy();

// Imperative — no trigger button
collapse.show('#panel');
collapse.hide('#panel');
collapse.toggle('#panel');

// Accordion — renders from data
accordion.render('#faq', [
    { label: 'What is Oja?',     body: Out.html('<p>A framework…</p>') },
    { label: 'Does it need npm?', body: Out.html('<p>No.</p>') },
], { openFirst: true });

// Accordion — wire existing HTML
accordion.wire('#faq', { openFirst: true });
```

---

### Wizard

```js
import { wizard } from '@agberohq/oja';

const w = wizard.render('#onboarding', [
    {
        key:      'type',
        title:    'What kind of host?',
        body:     Out.component('steps/host-type.html'),
        validate: (data) => data.type ? true : 'Please choose a type',
    },
    {
        key:   'config',
        title: 'Configure',
        body:  Out.component('steps/host-config.html'),
    },
    {
        key:   'review',
        title: 'Review & Add',
        body:  Out.component('steps/host-review.html'),
    },
], {
    onComplete: (data) => api.post('/hosts', data),
    onCancel:   () => modal.close(),
});

// Works inside a modal body
modal.open('addHostModal', {
    body: Out.fn(async (container) => {
        wizard.render(container, steps, { onComplete });
    }),
});
```

---

### Table

```js
import { table } from '@agberohq/oja';

const headers = [
    { key: 'hostname', label: 'Host',   sortable: true  },
    { key: 'rps',      label: 'Req/s',  sortable: true  },
    { key: 'status',   label: 'Status', sortable: false },
];

const t = table.render(find('#host-table'), rows, headers, {
    pageSize:   20,
    onRowClick: (row) => openHostDetail(row),
    actions: [
        { label: 'Edit',   onClick: (row) => editHost(row.id) },
        { label: 'Delete', onClick: (row) => deleteHost(row.id), style: 'danger' },
    ],
});

// Push new data — sort state and page are preserved
effect(() => { t.update(hosts()); });

// Cell shapes
const rows = hosts().map(h => ({
    hostname: { value: h.hostname, onClick: () => openDetail(h) },
    rps:      h.rps,
    status:   { value: h.alive ? 'Healthy' : 'Down', badge: h.alive ? 'success' : 'error' },
}));

// Server-side pagination
const t = table.render(find('#host-table'), [], headers, {
    pageSize: 25,
    fetchData: async (page, size, sortKey, dir) => {
        const res = await api.get(`/hosts?page=${page}&size=${size}&sort=${sortKey}&dir=${dir}`);
        return { data: res.rows, total: res.total };
    },
});

// Column visibility
t.hideColumn('rps');
t.showColumn('rps');
t.toggleColumn('rps');
```

---

### Search and autocomplete

```js
import { Search, Trie, autocomplete } from '@agberohq/oja';

const index = new Search([], {
    fields:      ['text', 'tag', 'description'],
    weights:     { text: 2, tag: 1 },
    fuzzy:       true,
    maxDistance: 1,
});

index.add('id-1', { text: 'Fix login bug', tag: 'auth' });
index.addAll(tasks().map(t => ({ id: t.id, ...t })));

const results = index.search('logn');
results.forEach(r => console.log(r.doc, r.score));

// Trie — fast prefix autocomplete
const trie = new Trie();
trie.insertAll(['api.prod', 'api.staging', 'web.prod']);
trie.autocomplete('api.');           // → ['api.prod', 'api.staging']
trie.startsWith('api.');            // → ['api.prod', 'api.staging']

autocomplete.attach(find('#search-input'), {
    source:   trie,
    limit:    8,
    onSelect: (value) => { find('#search-input').value = value; },
});
```

---

### Drag and drop

```js
import { dragdrop } from '@agberohq/oja';

dragdrop.reorder('#host-list', {
    onReorder: (items) => api.post('/hosts/reorder', { order: items.map(el => el.dataset.id) }),
    handle:    '.drag-handle',
    animation: 150,
});

dragdrop.dropZone('#upload-area', {
    onDrop:  (files) => files.forEach(uploadFile),
    accept:  ['.jpg', '.png', '.pdf'],
    maxSize: 10 * 1024 * 1024,
    onError: (msg) => notify.error(msg),
});
```

---

### Forms

```js
import { form, notify } from '@agberohq/oja';

form.on('#loginForm', {
    submit:  async (data) => api.post('/login', data),
    success: (res) => auth.session.start(res.token),
    error:   (err) => form.showError('#loginForm', 'password', err.message),
});

const ok = await form.validate('#firewallForm', {
    ip:     (v) => /^[\d.:/a-fA-F]+$/.test(v) || 'Enter a valid IP or CIDR',
    reason: async (v) => await api.get(`/check?ip=${v}`) || 'Already blocked',
});
if (!ok) return;

const stop = form.dirty('#editForm', (field, isDirty) => {
    find('#save-btn').disabled = !isDirty;
});
component.onUnmount(() => stop());

const data = form.collect('#myForm');
```

---

### Real-time — SSE and WebSocket

```js
import { OjaSSE, OjaSocket } from '@agberohq/oja';

const sse = new OjaSSE('/api/events');
sse.on('metrics', (data) => setMetrics(data));
sse.onDisconnect(() => notify.banner('Connection lost', { type: 'warn' }));
sse.onConnect(()    => notify.dismissBanner());
component.onUnmount(() => sse.close());

const ws = new OjaSocket('wss://api.example.com/live');
ws.on('connect',    () => ws.send({ type: 'subscribe', channel: 'hosts' }));
ws.on('message',    (data) => handleMessage(data));
ws.on('disconnect', () => notify.warn('Disconnected'));
component.onUnmount(() => ws.close());
```

Both reconnect automatically with exponential backoff.

---

### Engine — smart DOM updates

```js
import { engine, Store } from '@agberohq/oja';

const store = new Store('myapp');
engine.useStore(store);

// Keyed list reconciliation — only changed nodes are patched
engine.list(listEl, items, {
    key:    item => item.id,
    render: (item, existing) => {
        const el = existing || document.createElement('div');
        el.dataset.id = item.id;
        find('span', el).textContent = item.text;
        return el;
    },
});

// Morph — tree-diff against new HTML, preserves focus and scroll
await engine.morph(find('#stats-panel'), buildHtml(stats));

if (engine.shouldMorph(find('#panel'), html)) {
    await engine.morph(find('#panel'), html);
}
```

---

## Concurrency

### Channel — Go-style coordination

```js
import { Channel, go, pipeline, fanOut, fanIn } from '@agberohq/oja';

const ch = new Channel({ buffer: 10, workers: true, name: 'images' });

await ch.send(imageBuffer);

go(async () => {
    for await (const buffer of ch) {
        const result = await worker.call('process', buffer);
        setResult(result);
    }
});

component.onUnmount(() => ch.close());
```

### Runner — long-lived background worker

```js
import { Runner } from '@agberohq/oja';

const worker = new Runner((self) => {
    let count = 0;
    self.on('increment', (data) => { count += data.by ?? 1; });
    self.on('get',       ()     => { return { count }; });
});

worker.send('increment', { by: 5 });
const { count } = await worker.request('get');
worker.close();
```

---

## Logging and debugging

```js
import { logger, debug } from '@agberohq/oja';

logger.info('auth', 'User logged in', { userId: 42 });
logger.warn('api', 'Slow response', { ms: 1240 });
logger.error('component', 'Load failed', { url: 'hosts.html' });
logger.setLevel('WARN');

logger.onLog((entry) => {
    if (entry.level === 'ERROR') api.post('/logs', entry);
});

// Listen to all framework events for debugging
const off = runtime.on('*', (name, detail) => console.debug(`[oja] ${name}`, detail));

debug.enable('router,auth,api');
debug.dump();
```

---

## Feature overview

| Feature | Export | Build |
|---------|--------|-------|
| Reactive state (`state`, `effect`, `derived`, `batch`) | named | core + full |
| Cross-module state (`context`) | named | core + full |
| Reactive channels (`channel`) | named | core + full |
| Router (hash + history, groups, middleware, named routes) | `Router`, `Out` | core + full |
| Layout (persistent shell, slots, `allSlotsReady`) | `layout` | core + full |
| Component mount + lifecycle | `component` | core + full |
| Template syntax (`{{}}`, `data-if`, `data-each`) | built-in | core + full |
| Auth (levels, session, JWT) | `auth` | core + full |
| Notifications (toast, banner, progress, promise) | `notify` | core + full |
| Modals (stack, confirm, prompt, beforeClose guard) | `modal` | core + full |
| Forms (lifecycle, validation, dirty tracking) | `form` | core + full |
| Events (delegated, emit/listen, keyboard shortcuts) | `on`, `emit`, `listen`, `keys` | core + full |
| Store (session/local/memory, encrypt, watch, TTL) | `Store` | core + full |
| Encryption (Web Crypto, seal/open/rotate) | `encrypt` | core + full |
| Engine (list reconcile, morph, `data-oja-bind`) | `engine` | core + full |
| Search + autocomplete (full-text, fuzzy, trie) | `Search`, `Trie`, `autocomplete` | core + full |
| Progress (milestone hooks, reverse, bind, track) | `progress` | core + full |
| Runtime unified event bus (`runtime.on/off/emit`) | `runtime` | core + full |
| Animate (fade, slide, collapse, countUp, typewriter, shake) | `animate` | core + full |
| Collapse + accordion | `collapse`, `accordion` | core + full |
| Wizard (multi-step form, modal-compatible) | `wizard` | full |
| Table (sort, pagination, row actions, column visibility) | `table` | full |
| Inline charts (sparkline, timeSeries) | `Out.sparkline`, `Out.timeSeries` | core + full |
| Clipboard (read/write/cut, multi-format) | `clipboard` | core + full |
| Drag and drop (reorder, drop zone, custom) | `dragdrop` | full |
| SSE (auto-reconnect) | `OjaSSE` | full |
| WebSocket (auto-reconnect) | `OjaSocket` | full |
| VFS (offline-first IndexedDB, encrypt, persist, quota) | `VFS` | core + full |
| Config (`oja.config.json`) | `config` | core + full |
| Channel + go (Go-style concurrency) | `Channel`, `go` | full |
| Runner (long-lived background worker) | `Runner` | full |
| Logging + debug | `logger`, `debug` | core + full |
| Adapter bridge (D3, Chart.js, GSAP, etc.) | `adapter` | core + full |

---

## Design decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Build step | None | Drop-in simplicity, no node_modules |
| Virtual DOM | No | Direct DOM + targeted `effect()` |
| Display primitive | `Out` everywhere | One type for all visible output — composable, typed, no raw strings |
| DOM queries | `find()` / `findAll()` | Scoped to component instance — multiple instances never conflict |
| URL strategy | Hash default, path opt-in | Hash works everywhere without server config |
| CSS ownership | App owns all styles | Oja only owns lifecycle animation and UI component classes |
| Auth | Declared at route | Never check `isActive()` manually |
| Token security | Encrypted cascade | Web Crypto API, no plaintext tokens |
| Event bus | Single unified bus | All modules — router, component, layout, out, api — emit on `events.js`. `runtime.on()` is the public subscription point. |
| Component communication | `channel()` | Reactive, holds current value, late subscribers get it immediately — unlike fire-and-forget emit/listen |
| Progress | Direction-aware + hooks | Milestone hooks, reverse animation, runtime binding — first-class coordination primitive |
| Offline | VFS optional | Progressive enhancement — start without VFS, add it when needed |
| Worker pattern | `Runner` + `Channel` separate | `Runner` stays alive; `Channel` moves data — single responsibility |

---

## Known limitations

- **Nested `{{range}}` loops**: inner `Index`/`First`/`Last` are list-absolute in chunked renders — access the outer loop variable by its `data-as` name.
- **`OjaWasm` worker mode**: JS import callbacks are stubbed in the worker thread. For WASM modules that need JS callbacks, use non-worker mode.
- **`OjaWorker` scope isolation**: worker functions are serialised as strings and run in a separate thread — they cannot close over variables from the outer scope.
- **`webrtc.js` `connect()`**: WebRTC signaling is application-specific. Wire your own signaling server using `createPeer()`, `createOffer()`, `setLocalDescription()`.

---

## License

MIT