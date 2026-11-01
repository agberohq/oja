/**
 * tests/core/version.test.js
 *
 * Promoted from tests/bugs/010-version-drift.test.js after the fix.
 *
 * The version is authored twice — `package.json` and the `VERSION` export in
 * `src/oja.js` — and had drifted (0.4.0 vs 0.3.0), because release tooling only
 * bumped the manifest. `Oja.version` therefore reported a version that was
 * never published.
 *
 * Fix: `scripts/sync-version.js` rewrites the export from `package.json`, and is
 * called by `make release` (before the commit) and by the tag-triggered CI
 * publish. This test is the standing guard; `npm run verify:package` performs
 * the same comparison against the built artifacts.
 */

import { describe, it, expect } from 'vitest';
import fs   from 'node:fs';
import path from 'node:path';
import { VERSION } from '../../src/oja.js';

const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

describe('version', () => {
    it('exposes a semver-looking VERSION string', () => {
        expect(typeof VERSION).toBe('string');
        expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('matches package.json', () => {
        expect(VERSION).toBe(pkg.version);
    });
});
