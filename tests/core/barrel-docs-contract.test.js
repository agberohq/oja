/**
 * tests/core/barrel-docs-contract.test.js
 *
 * Promoted from tests/bugs/008-barrel-docs-contract.test.js after the fix.
 *
 * `Presence` was documented in README ("What's in the box") and in TUTORIAL
 * Part 46 as `import { Presence } from '@agberohq/oja'`, but
 * `src/js/ext/presence.js` was never re-exported by `src/oja.full.js` — so the
 * documented example was a link error in the browser.
 *
 * Rather than hard-code `Presence`, this test extracts every named import from
 * both docs and checks it against the real barrel, so the next missing export
 * fails here instead of in a user's console.
 */

import { describe, it, expect } from 'vitest';
import fs   from 'node:fs';
import path from 'node:path';

const full     = await import('../../src/oja.full.js');
const exported = new Set(Object.keys(full));

const docs = ['README.md', 'TUTORIAL.md']
    .map(file => fs.readFileSync(path.join(process.cwd(), file), 'utf8'))
    .join('\n');

const documented = new Set();
for (const match of docs.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]@agberohq\/oja['"]/g)) {
    for (const raw of match[1].split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (name) documented.add(name);
    }
}

describe('barrel — documented imports exist', () => {
    it('exposes the documented extension classes', () => {
        expect(exported.has('Presence')).toBe(true);
        expect(exported.has('Runner')).toBe(true);
        expect(exported.has('VFS')).toBe(true);
        expect(exported.has('Channel')).toBe(true);
    });

    it('finds a meaningful number of exports and documented names', () => {
        expect(exported.size).toBeGreaterThan(100);
        expect(documented.size).toBeGreaterThan(50);
    });

    it('every name imported in README/TUTORIAL is exported by oja.full.js', () => {
        const missing = [...documented].filter(name => !exported.has(name));
        expect(missing).toEqual([]);
    });
});
