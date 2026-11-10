import { describe, it, expect, beforeEach, vi } from 'vitest';

// Re-import fresh module state for each test group via dynamic import
// to avoid bleed between tests that mutate module-level _registered / _strict.

describe('register.js — event dictionary', () => {

    it('isRegistered returns false before any register() call', async () => {
        const { isRegistered } = await import('../../src/js/utils/register.js');
        expect(isRegistered('never:registered')).toBe(false);
    });

    it('register() adds names and isRegistered returns true', async () => {
        const { register, isRegistered } = await import('../../src/js/utils/register.js');
        register(['test:event-a']);
        expect(isRegistered('test:event-a')).toBe(true);
    });

    it('register() is additive across multiple calls', async () => {
        const { register, isRegistered } = await import('../../src/js/utils/register.js');
        register(['test:event-b']);
        register(['test:event-c']);
        expect(isRegistered('test:event-b')).toBe(true);
        expect(isRegistered('test:event-c')).toBe(true);
    });

    it('getRegistered() returns a Set of all registered names', async () => {
        const { register, getRegistered } = await import('../../src/js/utils/register.js');
        register(['test:event-d', 'test:event-e']);
        const all = getRegistered();
        expect(all.has('test:event-d')).toBe(true);
        expect(all.has('test:event-e')).toBe(true);
    });

    it('getRegistered() returns a copy — mutating it does not affect the registry', async () => {
        const { register, getRegistered, isRegistered } = await import('../../src/js/utils/register.js');
        register(['test:immutable']);
        const copy = getRegistered();
        copy.delete('test:immutable');
        expect(isRegistered('test:immutable')).toBe(true);
    });

    it('emit() with registered name does not warn', async () => {
        const { register, emit } = await import('../../src/js/utils/register.js');
        register(['test:valid-emit']);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        emit('test:valid-emit', {});
        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('emit() with unregistered name warns in default mode', async () => {
        const { register, emit } = await import('../../src/js/utils/register.js');
        register(['test:something-else']);  // activate the registry
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        emit('test:not:registered', {});
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('test:not:registered'));
        warnSpy.mockRestore();
    });

    it('listen() with unregistered name warns in default mode', async () => {
        const { register, listen } = await import('../../src/js/utils/register.js');
        register(['test:something']);  // activate
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const unsub = listen('test:unregistered:listen', () => {});
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('test:unregistered:listen'));
        unsub?.();
        warnSpy.mockRestore();
    });

    it('strictMode(true) makes emit throw on unregistered names', async () => {
        const { register, strictMode, emit } = await import('../../src/js/utils/register.js');
        register(['test:strict-only']);  // activate
        strictMode(true);
        expect(() => emit('test:strict-typo', {})).toThrow('test:strict-typo');
        strictMode(false);  // reset
    });

    it('strictMode(false) reverts to warn-only', async () => {
        const { register, strictMode, emit } = await import('../../src/js/utils/register.js');
        register(['test:warn-mode']);
        strictMode(true);
        strictMode(false);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(() => emit('test:warn-unregistered', {})).not.toThrow();
        warnSpy.mockRestore();
    });

    it('register() warns and returns early for empty array', async () => {
        const { register } = await import('../../src/js/utils/register.js');
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        register([]);
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('events convenience object exposes all methods', async () => {
        const { events } = await import('../../src/js/utils/register.js');
        expect(typeof events.register).toBe('function');
        expect(typeof events.strictMode).toBe('function');
        expect(typeof events.isRegistered).toBe('function');
        expect(typeof events.getRegistered).toBe('function');
        expect(typeof events.emit).toBe('function');
        expect(typeof events.listen).toBe('function');
    });
});