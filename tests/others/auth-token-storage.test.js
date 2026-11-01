/**
 * tests/others/auth-token-storage.test.js
 *
 * Promoted from tests/bugs/009-auth-token-plaintext.test.js after the fix.
 *
 * The defect: auth.session.start() persisted the raw JWT to the *plain*
 * `_metaStore` (`oja:auth:meta:raw_token`) just so tokenSync() could read it,
 * and the "encrypted" `_tokenStore` derived its key from the public namespace
 * `oja:auth` — obfuscation, not confidentiality. Anyone able to read storage
 * held a usable bearer token.
 *
 * Contract now enforced:
 *   1. the raw token is never written to storage
 *   2. tokenSync() keeps working within a session (in-memory cache)
 *   3. after a reload the cache is cold until `await token()` primes it
 *   4. end() clears the cache
 *   5. an encrypted Store without an explicit `secret` warns once per namespace
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const TOKEN = 'opaque-token-6d1f8a2c';

let auth;
let nsCounter = 0;

// The storage mocks installed by tests/setup.js expose length/key/getItem.
function storageEntries(storage) {
    const out = [];
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        out.push([key, storage.getItem(key)]);
    }
    return out;
}

function allEntries() {
    return [...storageEntries(localStorage), ...storageEntries(sessionStorage)];
}

beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    vi.resetModules();
    ({ auth } = await import('../../src/js/ext/auth.js'));
});

afterEach(async () => {
    await auth.session.end();
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
});

describe('auth — token storage', () => {
    it('a session starts and tokenSync works within the session', async () => {
        await auth.session.start(TOKEN, null, { expires: null });

        expect(auth.session.isActive()).toBe(true);
        expect(auth.session.tokenSync()).toBe(TOKEN);
        await expect(auth.session.token()).resolves.toBe(TOKEN);
    });

    it('never writes the raw token to storage', async () => {
        await auth.session.start(TOKEN, null, { expires: null });

        const leaks = allEntries()
            .filter(([, value]) => typeof value === 'string' && value.includes(TOKEN))
            .map(([key]) => key);

        expect(leaks).toEqual([]);
    });

    it('keeps the session active across a reload without the token in storage', async () => {
        await auth.session.start(TOKEN, null, { expires: null });

        // Simulate a reload: fresh module state, same storage.
        vi.resetModules();
        const { auth: reloaded } = await import('../../src/js/ext/auth.js');

        expect(reloaded.session.isActive()).toBe(true);
        expect(reloaded.session.tokenSync()).toBeNull();   // cold cache

        await expect(reloaded.session.token()).resolves.toBe(TOKEN);
        expect(reloaded.session.tokenSync()).toBe(TOKEN);  // primed

        auth = reloaded;   // let afterEach end the live instance
    });

    it('end() clears the in-memory token cache', async () => {
        await auth.session.start(TOKEN, null, { expires: null });
        expect(auth.session.tokenSync()).toBe(TOKEN);

        await auth.session.end();

        expect(auth.session.tokenSync()).toBeNull();
        await expect(auth.session.token()).resolves.toBeNull();
    });

    it('warns once per namespace when encrypt is requested without a secret', async () => {
        const { Store } = await import('../../src/js/core/store.js');
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const ns = `auth-token-storage:${++nsCounter}`;
        new Store(ns, { encrypt: true });
        new Store(ns, { encrypt: true });   // same namespace → no second warning

        const secretWarnings = warn.mock.calls
            .map(args => args.join(' '))
            .filter(message => /explicit `secret`/.test(message));

        expect(secretWarnings).toHaveLength(1);
    });
});
