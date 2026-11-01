# tests/bugs — reproduction suite

Every entry in this directory is a **reproduction of a real defect**, not a
feature test. A bug is only accepted here once the test fails for the stated
mechanism on the current `HEAD` — "it feels wrong" is not a bug.

Each file below was validated by temporarily dropping `.fails` and reading the
assertion message; that message is recorded in the index. No test here fails
because of a typo, a missing fixture, or an incidental environment difference.

## Convention

- One file per bug: `NNN-short-slug.test.js`
- Open bugs use `it.fails(...)`, so the suite stays green while the defect exists.
  When the bug is fixed the test **flips red** with "expected test to fail".
  That red is the signal to remove `.fails`, move the test into the normal
  suite (`tests/core/` or `tests/others/`), and record the fix below.
- Each file also contains at least one plain `it(...)` guard proving the code
  path under test is actually exercised — otherwise an "expected failure" could
  come from the fixture rather than the defect.
- Where the bug is a contract violation, the test derives both sides of the
  contract (Makefile outputs vs `package.json` targets; documented imports vs
  barrel exports) instead of hard-coding expected values.
- No `test.only`, no reliance on execution order between files.

Run just this suite:

```
npx vitest run tests/bugs
```

## Index

| # | Slug | Mechanism | Fails with | Severity | Status |
|---|------|-----------|------------|----------|--------|
| 001 | `package-entrypoints` | `package.json` `main`/`module`/`exports` named files the Makefile never emits (drift introduced in `98f7872`) | `expected [ 'build/oja.min.js', …(1) ] to deeply equal []` | high (packaging) | **fixed** → `tests/core/packaging.test.js` |
| 002 | `router-navigation-race` | Superseded navigation's component fetch was never aborted and overwrote the newer page (`router.js:604-623`, `out.js:512-515`) | `expected 'SLOW PAGE' to be 'FAST PAGE'` | high | **fixed** → `tests/core/router-navigation-race.test.js` |
| 003 | `out-scripts-not-awaited` | `_ComponentOut.render()` did not await `execScripts()` (`out.js:530`), so `_runMount` fired before page scripts registered hooks | `expected true to be false` (`settled`) | high | **fixed** → `tests/core/out-scripts.test.js` |
| 004 | `reactive-effect-isolation` | `_flush()` leaked `_flushDepth` (no `finally`) and a throwing effect starved later effects in the same flush | `expected 1 to be 2`, `expected 1 to be +0` | high | **fixed** → `tests/core/reactive-effect-isolation.test.js` |
| 005 | `reactive-inspect-stale` | `write()` never updated `_states`, so `inspect()` / `__OJA_REACTIVE__` / DevTools reported creation-time values | `expected +0 to be 42` | medium | **fixed** → `tests/core/reactive-inspect.test.js` |
| 006 | `router-param-collision` | One `paramChild` per node (`router.js:124,830`) silently dropped a second param name at the same position | `expected '' to match /slug\|conflict\|already/i` | medium | **fixed** → `tests/core/router-param-collision.test.js` |
| 007 | `router-aria-current-null` | `setAttribute('aria-current', null)` wrote the string `"null"` on inactive links (`router.js:819,824`) | `expected true to be false` (`hasAttribute`) | low (a11y) | **fixed** → `tests/core/router-aria-current.test.js` |
| 008 | `barrel-docs-contract` | `Presence` was documented in README/TUTORIAL but not re-exported by `src/oja.full.js` | `expected [ 'Presence' ] to deeply equal []` | medium (docs) | **fixed** → `tests/core/barrel-docs-contract.test.js` |
| 009 | `auth-token-plaintext` | `auth.session.start()` stored the raw JWT under `oja:auth:meta:raw_token` (`auth.js:233`); the "encrypted" store key derived from the namespace (`store.js:105`) | `expected [ 'oja:auth:meta:raw_token' ] to deeply equal []` | high (security) | **fixed** → `tests/others/auth-token-storage.test.js` |
| 010 | `version-drift` | `VERSION` in `src/oja.js` (0.4.0) disagreed with `package.json` (0.3.0); release tooling only bumped the manifest | `expected '0.4.0' to be '0.3.0'` | medium | **fixed** → `tests/core/version.test.js` |

## Fixed

### 001 — package entry points (2026-10-30)

- `main` / `module` / `exports["."]` now point at `./build/oja.full.esm.js`
  (full is the documented default), with `./core` and `./full` subpaths so the
  two build variants are addressable, `./css` for the stylesheet, and
  `./build/*` so explicit asset paths keep working through bundlers.
- Standing guard: `tests/core/packaging.test.js` (source-level contract) and
  `scripts/verify-package.js` → `npm run verify:package` (filesystem +
  self-reference resolution, run in CI between build and publish).

### 003 — Out must await component scripts (2026-10-30)

- `_ComponentOut.render()`, `_HtmlOut.render()` and the string branch of
  `_FnOut.render()` now `await execScripts(...)`. `_activeElement` stays set for
  the duration of script execution, matching `component.mount()`.
- Effect: page scripts register their `onMount` / `onReady` / `onUnmount` hooks
  before the router drains the scope, so lifecycle hooks run on first render.
- Standing guard: `tests/core/out-scripts.test.js` — asserts the contract with a
  deferred `execScripts` mock (jsdom's blob-script shim hides the ordering).

### 002 — superseded navigation race (2026-10-30)

- `_fetchHTML()` throws a real `AbortError` and stays silent on abort.
- `_ComponentOut.render()` forwards `context.signal` to the fetch, re-checks it
  before the DOM write, and rethrows an aborted render without painting error UI.
- `router._render()` captures `_navId` + signal at entry, bails after the
  transition wait and after the responder resolves; `navigate()` no longer routes
  an `AbortError` into the error responder.
- Standing guard: `tests/core/router-navigation-race.test.js` — superseded render
  cannot overwrite the outlet, and a navigation superseded during its 150 ms
  transition never even starts its fetch.

### 004 — reactive effect isolation (2026-10-30)

- `_flush()` now wraps the effect loop in `try/finally` (depth always released)
  and catches per effect, so one failure cannot starve the rest of the queue.
- New `ReactiveSystem._reportError()` routes failures through
  `runtime.reportError(err, source)`; `runtime.reportError()` now returns the
  number of hooks notified, and reactive falls back to `console.error` when the
  app registered none (`source` is `reactive:effect` / `reactive:max-depth`).
- The MAX_FLUSH_DEPTH guard no longer clears the queue without a word — it
  reports `reactive:max-depth` after resetting the depth.
- Behaviour change: `batch()` no longer rethrows an effect failure (the
  scheduler isolates it). `effect()` still throws on its *initial* run, so a
  misconfigured effect fails at the registration site.
- Standing guard: `tests/core/reactive-effect-isolation.test.js`.

### 005–008 — small correctness batch (2026-10-30)

- **005** `_states` entry is updated on every write (mutating the existing object,
  no per-write allocation) and `_setValue()` writes through to the closure via a
  stored `applyValue`, so `inspect()` and DevTools time travel agree with `read()`.
- **006** `_findOrCreate()` warns when a second param name appears at the same
  path position, naming both params and explaining that the first one wins.
- **007** `_updateNav()` now uses `removeAttribute('aria-current')` instead of
  writing the string `"null"`.
- **008** `Presence` is exported from `src/oja.full.js`.
- Standing guards: `tests/core/reactive-inspect.test.js`,
  `tests/core/router-param-collision.test.js`,
  `tests/core/router-aria-current.test.js`,
  `tests/core/barrel-docs-contract.test.js`.

### 010 — version drift (2026-10-30)

- `scripts/sync-version.js` rewrites `export const VERSION` in `src/oja.js` from
  `package.json`; `--check` reports drift without writing.
- Called by `make release` (before the release commit, which now also stages
  `src/oja.js`) and by the tag-triggered CI publish after `npm version`.
- `npm run verify:package` additionally compares the two, so a release cannot
  ship mismatched metadata.
- Standing guard: `tests/core/version.test.js`.

### 009 — auth token at rest (2026-10-30)

Agreed contract: **option A — memory-only sync cache**.

- `start()` / `renew()` keep the token in a module-level `_rawToken` instead of
  writing `oja:auth:meta:raw_token`; `end()` clears it (and still clears the
  legacy key so upgraded installs are cleaned up).
- `token()` primes that cache, so the post-reload path is
  `api.setToken(await auth.session.token())` once, then `tokenSync()` works again.
- `tokenSync()` reads only the cache: `null` when inactive **or cold**.
- `Store` warns once per namespace when `encrypt: true` is used without an
  explicit `secret`, because a namespace-derived key is public.
- Docs updated: README session API + design table + `tokenSync()` section,
  TUTORIAL Part 13 (start sequence, `tokenSync()` section, method table).
- Standing guard: `tests/others/auth-token-storage.test.js`.

## Withdrawn

- **"`build/` is missing"** — `build/` is generated by `make` (`Makefile:37-47`)
  and is committed. The defect is the *filename* mismatch in `package.json`,
  which is what 001 asserts.
