import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Api } from '../../src/js/core/api.js';


describe('L-02: Api.destroy()', () => {
    it('exposes a destroy() method', () => {
        const api = new Api({ base: 'http://localhost' });
        expect(typeof api.destroy).toBe('function');
    });

    it('removes online/offline window listeners on destroy', () => {
        const addSpy    = vi.spyOn(window, 'addEventListener');
        const removeSpy = vi.spyOn(window, 'removeEventListener');

        const api = new Api({ base: 'http://localhost' });

        const onlineCalls  = addSpy.mock.calls.filter(c => c[0] === 'online').length;
        const offlineCalls = addSpy.mock.calls.filter(c => c[0] === 'offline').length;

        api.destroy();

        const onlineRemoves  = removeSpy.mock.calls.filter(c => c[0] === 'online').length;
        const offlineRemoves = removeSpy.mock.calls.filter(c => c[0] === 'offline').length;

        expect(onlineRemoves).toBeGreaterThanOrEqual(onlineCalls);
        expect(offlineRemoves).toBeGreaterThanOrEqual(offlineCalls);

        addSpy.mockRestore();
        removeSpy.mockRestore();
    });

    it('can be called multiple times without throwing', () => {
        const api = new Api({ base: 'http://localhost' });
        expect(() => { api.destroy(); api.destroy(); }).not.toThrow();
    });

    it('multiple Api instances each have independent listeners', () => {
        const addSpy = vi.spyOn(window, 'addEventListener');
        const a1 = new Api({ base: 'http://localhost:3001' });
        const a2 = new Api({ base: 'http://localhost:3002' });

        const onlineBefore = addSpy.mock.calls.filter(c => c[0] === 'online').length;

        // Both should have registered independently
        expect(onlineBefore).toBeGreaterThanOrEqual(2);

        a1.destroy();
        a2.destroy();
        addSpy.mockRestore();
    });
});