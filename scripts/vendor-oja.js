#!/usr/bin/env node
/**
 * scripts/vendor-oja.js
 * Copy the built Oja bundle into a consumer's vendor directory and stamp it
 * with the version/commit that produced it.
 *
 *   node scripts/vendor-oja.js ../muca/web/app/vendor/oja
 *   node scripts/vendor-oja.js ../agbero/internal/operation/admin/lib --all
 *
 * The stamp is `oja.vendor.json`; consumers can log it at boot so a stale
 * snapshot is visible instead of being silently mistaken for current Oja.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_FILES = ['oja.full.esm.js', 'oja.min.css'];
const ALL_FILES = [
    'oja.core.esm.js', 'oja.core.min.js',
    'oja.full.esm.js', 'oja.full.min.js',
    'oja.min.css',
];

function _pkg() {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
}

function _commit() {
    try {
        return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
            cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch { return ''; }
}

/**
 * @param {Object} options
 * @param {string} options.target  consumer vendor directory
 * @param {string} [options.buildDir] source build directory
 * @param {string[]} [options.files] files to copy
 * @param {string} [options.version] defaults to package.json
 * @param {string} [options.commit] defaults to git short SHA
 * @param {string} [options.builtAt] defaults to now
 * @returns {{target:string, version:string, commit:string, files:string[], builtAt:string}}
 */
export function vendorOja(options = {}) {
    const {
        target,
        buildDir = path.join(ROOT, 'build'),
        files = DEFAULT_FILES,
        version = _pkg().version,
        commit = _commit(),
        builtAt = new Date().toISOString(),
    } = options;

    if (!target) throw new Error('[vendor-oja] target directory is required');
    const dest = path.resolve(target);
    fs.mkdirSync(dest, { recursive: true });

    const copied = [];
    for (const file of files) {
        const from = path.join(buildDir, file);
        if (!fs.existsSync(from)) {
            throw new Error(`[vendor-oja] build artifact missing: ${from} (run "make all" first)`);
        }
        fs.copyFileSync(from, path.join(dest, file));
        copied.push(file);
    }

    const manifest = { version, commit, builtAt, files: copied };
    fs.writeFileSync(
        path.join(dest, 'oja.vendor.json'),
        JSON.stringify(manifest, null, 2) + '\n'
    );
    return { target: dest, ...manifest };
}

function main(argv) {
    const args = argv.slice(2);
    const target = args.find(a => !a.startsWith('--'));
    const all = args.includes('--all');
    const fromIdx = args.indexOf('--from');
    const buildDir = fromIdx !== -1 ? args[fromIdx + 1] : undefined;

    if (!target) {
        console.error('Usage: node scripts/vendor-oja.js <target-dir> [--all] [--from <build-dir>]');
        process.exit(1);
    }

    try {
        const result = vendorOja({
            target,
            buildDir,
            files: all ? ALL_FILES : DEFAULT_FILES,
        });
        console.log(`[vendor-oja] ${result.version}${result.commit ? ' (' + result.commit + ')' : ''} → ${result.target}`);
        for (const f of result.files) console.log(`  · ${f}`);
    } catch (e) {
        console.error('[vendor-oja]', e.message);
        process.exit(1);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv);
}
