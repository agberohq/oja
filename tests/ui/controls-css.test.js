import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/css/oja.css'), 'utf8');

describe('controls CSS contract', () => {
    it('ships prefixed control classes', () => {
        for (const cls of [
            '.oja-control-row', '.oja-field', '.oja-input', '.oja-select-input',
            '.oja-textarea', '.oja-btn', '.oja-btn-sm', '.oja-icon-btn',
        ]) {
            expect(css).toContain(cls);
        }
    });

    it('normalizes form controls to border-box and a height token', () => {
        expect(css).toMatch(/\.oja-input,[\s\S]*?\.oja-select-input,[\s\S]*?\.oja-textarea,[\s\S]*?\.oja-btn,[\s\S]*?\.oja-icon-btn\s*\{[\s\S]*?box-sizing:\s*border-box/);
        expect(css).toMatch(/\.oja-input,[\s\S]*?\.oja-select-input,[\s\S]*?\.oja-btn\s*\{[\s\S]*?height:\s*var\(--oja-control-h\)/);
    });

    it('does not use bare input/select/button element selectors', () => {
        expect(css).not.toMatch(/^\s*(input|select|button|textarea)\s*[,{]/m);
    });

    it('uses the native select class, not the custom .oja-select wrapper', () => {
        expect(css).toContain('.oja-select-input');
        expect(css).not.toMatch(/\.oja-select\s*\{[^}]*appearance:\s*none/);
    });

    it('owns the select chevron with a mask', () => {
        expect(css).toMatch(/\.oja-select-arrow\s*\{[\s\S]*?mask:\s*var\(--oja-control-chevron\)/);
    });

    it('fixes the Oja select trigger box model', () => {
        expect(css).toMatch(/\.oja-select-trigger\s*\{[\s\S]*?box-sizing:\s*border-box/);
    });

    it('ships the confirm dialog structure', () => {
        expect(css).toContain('.oja-confirm-overlay');
        expect(css).toContain('.oja-confirm-actions');
    });

    it('ships knob styles and selector states', () => {
        expect(css).toContain('.oja-knob');
        expect(css).toContain('.oja-knob-track');
        expect(css).toContain('.oja-knob-item');
        expect(css).toContain('[data-open="true"] .oja-knob-item');
    });
});
