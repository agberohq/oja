/**
 * tests/core/packaging.test.js
 *
 * Promoted from tests/bugs/001-package-entrypoints.test.js after the fix.
 *
 * `package.json` used to point at `build/oja.min.js` and `build/oja.esm.js` —
 * filenames that stopped being produced in 98f7872, when the single bundle was
 * split into core (minimal) and full (everything). The manifest was never
 * revisited, so `import '@agberohq/oja'` failed for every consumer that honours
 * "exports", even though the CDN and explicit-path flows kept working.
 *
 * This test is the standing guard: every build target the manifest declares
 * must be a target the Makefile actually produces. It derives both sides of the
 * contract, so it keeps working if the bundles are renamed again.
 *
 * On-disk verification after a real build lives in scripts/verify-package.js
 * (`npm run verify:package`), which CI runs against the built artifacts.
 */

import { describe, it, expect } from 'vitest';
import fs   from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkg  = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const mk   = fs.readFileSync(path.join(root, 'Makefile'), 'utf8');

const trim = (p) => String(p).replace(/^\.\//, '');

// Every literal path the Makefile can emit, e.g.
//   CORE_ESM = $(BUILD_DIR)/oja.core.esm.js   → build/oja.core.esm.js
const buildOutputs = new Set(
    [...mk.matchAll(/^[A-Z_]+\s*=\s*\$\(BUILD_DIR\)\/(\S+)\s*$/gm)]
        .map(m => `build/${m[1]}`)
);

// Collect concrete "./build/..." targets from the exports map (skip wildcards).
function collectBuildTargets(node, out = []) {
    if (typeof node === 'string') {
        if (node.startsWith('./build/') && !node.includes('*')) out.push(trim(node));
    } else if (node && typeof node === 'object') {
        for (const value of Object.values(node)) collectBuildTargets(value, out);
    }
    return out;
}

const declared = [...new Set([
    pkg.main,
    pkg.module,
    ...collectBuildTargets(pkg.exports),
].filter(Boolean).map(trim))].filter(p => p.startsWith('build/'));

describe('packaging — package.json entry points', () => {
    it('parses the Makefile output variables', () => {
        expect(buildOutputs.size).toBeGreaterThanOrEqual(4);
        expect(buildOutputs.has('build/oja.core.min.js')).toBe(true);
        expect(buildOutputs.has('build/oja.core.esm.js')).toBe(true);
        expect(buildOutputs.has('build/oja.full.min.js')).toBe(true);
        expect(buildOutputs.has('build/oja.full.esm.js')).toBe(true);
        expect(buildOutputs.has('build/oja.min.css')).toBe(true);
    });

    it('declares both build variants and a stylesheet', () => {
        expect(declared).toContain('build/oja.full.esm.js');
        expect(declared).toContain('build/oja.core.esm.js');
        expect(declared).toContain('build/oja.min.css');
    });

    it('the bare specifier resolves to the full build (documented default)', () => {
        expect(pkg.exports['.'].import).toContain('oja.full');
        expect(pkg.exports['.'].default).toContain('oja.full');
    });

    it('every declared entry point is produced by `make`', () => {
        const missing = declared.filter(target => !buildOutputs.has(target));
        expect(missing).toEqual([]);
    });

    it('the core barrel stays kernel-only (no ui/ or ext/ imports)', () => {
        // README's "Build" column promises that ui/ext features are full-only.
        // If src/oja.js ever imports from js/ui or js/ext, the core bundle grows
        // silently and every one of those rows becomes a lie.
        // Strip comments first — the file header documents deep-import examples.
        const core = fs.readFileSync(path.join(root, 'src', 'oja.js'), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');

        const imports = [...core.matchAll(/from\s+'(\.[^']+)'/g)].map(m => m[1]);

        expect(imports.length).toBeGreaterThan(10);
        expect(imports.filter(spec => /\/ui\/|\/ext\//.test(spec))).toEqual([]);
    });
});
