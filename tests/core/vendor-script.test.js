import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { vendorOja } from '../../scripts/vendor-oja.js';

let dirs = [];
function tempDir() {
    const d = mkdtempSync(join(tmpdir(), 'oja-vendor-'));
    dirs.push(d);
    return d;
}

afterEach(() => {
    for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
    dirs = [];
});

describe('scripts/vendor-oja.js', () => {
    it('copies the default artifacts and writes a version stamp', () => {
        const target = tempDir();
        const result = vendorOja({
            target,
            buildDir: resolve(process.cwd(), 'build'),
            version: '9.9.9',
            commit: 'abc123',
            builtAt: '2026-01-01T00:00:00.000Z',
        });

        expect(result.version).toBe('9.9.9');
        expect(existsSync(join(target, 'oja.full.esm.js'))).toBe(true);
        expect(existsSync(join(target, 'oja.min.css'))).toBe(true);

        const stamp = JSON.parse(readFileSync(join(target, 'oja.vendor.json'), 'utf8'));
        expect(stamp).toMatchObject({
            version: '9.9.9',
            commit: 'abc123',
            builtAt: '2026-01-01T00:00:00.000Z',
            files: ['oja.full.esm.js', 'oja.min.css'],
        });
    });

    it('can copy all build artifacts', () => {
        const target = tempDir();
        const result = vendorOja({
            target,
            buildDir: resolve(process.cwd(), 'build'),
            files: ['oja.core.esm.js', 'oja.core.min.js', 'oja.full.esm.js', 'oja.full.min.js', 'oja.min.css'],
            version: '9.9.9',
            commit: '',
        });
        expect(result.files).toHaveLength(5);
        for (const f of result.files) expect(existsSync(join(target, f))).toBe(true);
    });

    it('fails clearly when a build artifact is missing', () => {
        const target = tempDir();
        const emptyBuild = tempDir();
        mkdirSync(emptyBuild, { recursive: true });
        expect(() => vendorOja({ target, buildDir: emptyBuild, version: '1' }))
            .toThrow(/build artifact missing/);
    });

    it('requires a target directory', () => {
        expect(() => vendorOja({ buildDir: resolve(process.cwd(), 'build') }))
            .toThrow(/target directory is required/);
    });
});
