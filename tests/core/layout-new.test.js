import { describe, it, expect, vi } from 'vitest';
import { layout, allSlotsReady } from '../../src/js/core/layout.js';
import { emit } from '../../src/js/core/events.js';


describe('F-30: allSlotsReady() standalone export', () => {
    it('is exported as a named function', () => {
        expect(typeof allSlotsReady).toBe('function');
    });

    it('resolves immediately for empty names array', async () => {
        await expect(allSlotsReady([])).resolves.toBeUndefined();
    });

    it('resolves when all named slots fire layout:slot-ready', async () => {
        const promise = allSlotsReady(['nav', 'sidebar'], 2000);

        // Simulate slot scripts calling layout.slotReady()
        layout.slotReady('nav');
        layout.slotReady('sidebar');

        await expect(promise).resolves.toBeUndefined();
    });

    it('rejects on timeout when a slot never fires', async () => {
        const promise = allSlotsReady(['nav', 'missing-slot'], 100);

        layout.slotReady('nav'); // only one of two fires

        await expect(promise).rejects.toThrow('missing-slot');
    });

    it('also accessible via layout.allSlotsReady()', () => {
        expect(typeof layout.allSlotsReady).toBe('function');
    });
});