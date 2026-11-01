#!/usr/bin/env node
/**
 * scripts/sync-version.js
 *
 * Keeps the single runtime copy of the version in step with package.json.
 *
 *   src/oja.js:  export const VERSION = '0.3.0';
 *   package.json: "version": "0.3.0"
 *
 * The two drifted apart (0.4.0 vs 0.3.0) because `make release` and the
 * tag-triggered CI publish only bump package.json. This script rewrites the
 * export from package.json, and is called by both paths.
 *
 * Usage:
 *   node scripts/sync-version.js          → write src/oja.js if needed
 *   node scripts/sync-version.js --check  → exit 1 if out of sync (no writes)
 */

import fs   from 'node:fs';
import path from 'node:path';

const root        = process.cwd();
const pkgPath     = path.join(root, 'package.json');
const entryPath   = path.join(root, 'src', 'oja.js');
const checkOnly   = process.argv.includes('--check');

const pkg     = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
const source  = fs.readFileSync(entryPath, 'utf8');

const pattern = /(export const VERSION = ')([^']+)(';)/;
const match   = source.match(pattern);

if (!match) {
    console.error('[sync-version] could not find "export const VERSION" in src/oja.js');
    process.exit(1);
}

const current = match[2];

if (current === version) {
    console.log(`[sync-version] OK — src/oja.js VERSION is ${version}`);
    process.exit(0);
}

if (checkOnly) {
    console.error(
        `[sync-version] FAILED — src/oja.js says ${current}, package.json says ${version}. ` +
        `Run: node scripts/sync-version.js`
    );
    process.exit(1);
}

fs.writeFileSync(entryPath, source.replace(pattern, `$1${version}$3`), 'utf8');
console.log(`[sync-version] src/oja.js VERSION ${current} → ${version}`);
