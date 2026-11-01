#!/usr/bin/env node
/**
 * scripts/verify-package.js
 *
 * Guards the published surface against manifest drift.
 *
 * Run after `make all` (CI runs `npm run verify:package` between the build and
 * `npm publish`). It checks, using the real filesystem:
 *
 *   1. every "./build/..." target in package.json exists on disk
 *   2. `files` ships both build/ and src/
 *   3. the bare specifier and the "./full" / "./core" subpaths resolve
 *   4. Node can resolve the package by its own name (self-reference)
 *
 * Why this exists: in 98f7872 the bundles were split into core/full and the
 * Makefile outputs were renamed, but package.json kept pointing at
 * build/oja.min.js + build/oja.esm.js. Nothing noticed because the CDN and
 * import-map documentation used explicit full.esm.js paths. See
 * tests/core/packaging.test.js for the source-level contract test.
 */

import fs   from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkg  = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const problems = [];

function collectBuildTargets(node, out = []) {
    if (typeof node === 'string') {
        if (node.startsWith('./build/') && !node.includes('*')) out.push(node);
    } else if (node && typeof node === 'object') {
        for (const value of Object.values(node)) collectBuildTargets(value, out);
    }
    return out;
}

const targets = [...new Set([
    pkg.main,
    pkg.module,
    ...collectBuildTargets(pkg.exports),
].filter(Boolean))];

if (targets.length === 0) {
    problems.push('package.json declares no build targets (main/module/exports).');
}

for (const target of targets) {
    if (!fs.existsSync(path.join(root, target))) {
        problems.push(`missing entry point: ${target} — run "make all"`);
    }
}

for (const required of ['build/', 'src/']) {
    if (!Array.isArray(pkg.files) || !pkg.files.includes(required)) {
        problems.push(`"files" must include "${required}" for the published tarball`);
    }
}

for (const subpath of ['.', './full', './core']) {
    if (!pkg.exports?.[subpath]) problems.push(`exports["${subpath}"] is not declared`);
}

// Node must be able to resolve the package by its own name (exports/specifier check).
try {
    const resolved = import.meta.resolve(pkg.name);
    if (!resolved.includes('/build/')) {
        problems.push(`self-reference resolved outside build/: ${resolved}`);
    }
} catch (e) {
    problems.push(`cannot resolve "${pkg.name}" by its own name: ${e.message}`);
}

// The runtime version export must match the manifest (see scripts/sync-version.js).
try {
    const entry = fs.readFileSync(path.join(root, 'src', 'oja.js'), 'utf8');
    const match = entry.match(/export const VERSION = '([^']+)'/);
    if (!match) {
        problems.push('src/oja.js does not export VERSION');
    } else if (match[1] !== pkg.version) {
        problems.push(
            `src/oja.js VERSION (${match[1]}) does not match package.json (${pkg.version}) — ` +
            `run "node scripts/sync-version.js"`
        );
    }
} catch (e) {
    problems.push(`cannot read src/oja.js: ${e.message}`);
}

if (problems.length > 0) {
    console.error('[verify-package] FAILED');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
}

console.log(`[verify-package] OK — ${targets.length} entry points verified for ${pkg.name}@${pkg.version}`);
