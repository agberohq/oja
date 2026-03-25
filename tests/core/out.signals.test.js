import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Out } from '../../src/js/core/out.js';
import { signal } from '../../src/js/core/reactive.js';

beforeEach(() => {
    document.body.innerHTML = '';
    signal.destroyAll();
});

// ─── Out.to() — plain OutTarget, no Proxy ─────────────────────────────────────

describe('Out.to() — plain OutTarget', () => {
    it('returns an OutTarget instance directly', () => {
        const div = document.createElement('div');
        document.body.appendChild(div);
        const target = Out.to(div);
        // Should be a real OutTarget, not a Proxy wrapping a function
        expect(typeof target).toBe('object');
        expect(typeof target).not.toBe('function');
    });

    it('toHaveProperty works without Proxy interference', () => {
        const div = document.createElement('div');
        document.body.appendChild(div);
        const target = Out.to(div);
        expect(target).toHaveProperty('html');
        expect(target).toHaveProperty('component');
        expect(target).toHaveProperty('show');
        expect(target).toHaveProperty('hide');
    });

    it('chaining returns the same OutTarget instance', () => {
        const div = document.createElement('div');
        document.body.appendChild(div);
        const target = Out.to(div);
        expect(target.show()).toBe(target);
        expect(target.hide()).toBe(target);
        expect(target.addClass('x')).toBe(target);
        expect(target.removeClass('x')).toBe(target);
    });

    it('is not callable as a tagged template', () => {
        const div = document.createElement('div');
        document.body.appendChild(div);
        const target = Out.to(div);
        expect(typeof target).not.toBe('function');
    });
});

// ─── Out.tag() — tagged template entry point ─────────────────────────────────

describe('Out.tag() — tagged template literal', () => {
    it('is a function (callable as tagged template)', () => {
        const div = document.createElement('div');
        document.body.appendChild(div);
        expect(typeof Out.tag(div)).toBe('function');
    });

    it('renders interpolated HTML into the target', async () => {
        const div = document.createElement('div');
        document.body.appendChild(div);
        const name = 'World';
        await Out.tag(div)`<h1>Hello ${name}!</h1>`;
        expect(div.querySelector('h1')?.textContent).toBe('Hello World!');
    });

    it('escapes interpolated values to prevent XSS', async () => {
        const div = document.createElement('div');
        document.body.appendChild(div);
        const evil = '<script>alert(1)</script>';
        await Out.tag(div)`<p>${evil}</p>`;
        expect(div.innerHTML).not.toContain('<script>');
    });
});

// ─── Out.skeleton() still works ───────────────────────────────────────────────

describe('Out.skeleton() — still works after Proxy removal', () => {
    it('returns an object with html and component properties', () => {
        const div = document.createElement('div');
        document.body.appendChild(div);
        const target = Out.skeleton(div, 'table');
        expect(target).toHaveProperty('html');
        expect(target).toHaveProperty('component');
    });
});

// ─── channel() ───────────────────────────────────────────────────────────────

describe('channel() — reactive same-page pub/sub', () => {
    it('returns the same instance for the same name', () => {
        const a = signal('test:a');
        const b = signal('test:a');
        expect(a).toBe(b);
    });

    it('returns different instances for different names', () => {
        expect(signal('ch:1')).not.toBe(signal('ch:2'));
    });

    it('set() notifies subscribers', () => {
        const fn = vi.fn();
        const ch = signal('ch:notify');
        ch.subscribe(fn);
        ch.set({ id: 1 });
        expect(fn).toHaveBeenCalledWith({ id: 1 });
    });

    it('subscribe() gives late subscriber the current value immediately', () => {
        const ch = signal('ch:late');
        ch.set('hello');

        const fn = vi.fn();
        ch.subscribe(fn);
        expect(fn).toHaveBeenCalledWith('hello');
    });

    it('subscribe() does not call fn if no value has been set', () => {
        const fn = vi.fn();
        signal('ch:empty').subscribe(fn);
        expect(fn).not.toHaveBeenCalled();
    });

    it('get() returns the current value without subscribing', () => {
        const ch = signal('ch:get');
        expect(ch.get()).toBeUndefined();
        ch.set(42);
        expect(ch.get()).toBe(42);
    });

    it('unsubscribe function removes the subscriber', () => {
        const fn = vi.fn();
        const ch = signal('ch:unsub');
        const off = ch.subscribe(fn);
        fn.mockClear();
        off();
        ch.set('after');
        expect(fn).not.toHaveBeenCalled();
    });

    it('reset() restores initial value and notifies', () => {
        const fn = vi.fn();
        const ch = signal('ch:reset', 'initial');
        ch.set('changed');
        ch.subscribe(fn);
        fn.mockClear();
        ch.reset();
        expect(fn).toHaveBeenCalledWith('initial');
        expect(ch.get()).toBe('initial');
    });

    it('destroy() removes channel from registry', () => {
        const ch = signal('ch:destroy');
        ch.destroy();
        expect(signal('ch:destroy')).not.toBe(ch);
    });

    it('hasSubscribers() reflects subscription state', () => {
        const ch = signal('ch:has');
        expect(ch.hasSubscribers()).toBe(false);
        const off = ch.subscribe(() => {});
        expect(ch.hasSubscribers()).toBe(true);
        off();
        expect(ch.hasSubscribers()).toBe(false);
    });

    it('size reflects number of active subscribers', () => {
        const ch = signal('ch:size');
        const off1 = ch.subscribe(() => {});
        const off2 = ch.subscribe(() => {});
        expect(ch.size).toBe(2);
        off1();
        expect(ch.size).toBe(1);
    });

    it('channel.destroyAll() clears all channels', () => {
        const a = signal('ch:all:a');
        const b = signal('ch:all:b');
        signal.destroyAll();
        expect(signal('ch:all:a')).not.toBe(a);
        expect(signal('ch:all:b')).not.toBe(b);
    });

    it('multiple subscribers all receive updates', () => {
        const f1 = vi.fn();
        const f2 = vi.fn();
        const ch = signal('ch:multi');
        ch.subscribe(f1);
        ch.subscribe(f2);
        ch.set('broadcast');
        expect(f1).toHaveBeenCalledWith('broadcast');
        expect(f2).toHaveBeenCalledWith('broadcast');
    });

    it('supports initial value via second argument', () => {
        const ch = signal('ch:init', { id: 0 });
        const fn = vi.fn();
        ch.subscribe(fn);
        expect(fn).toHaveBeenCalledWith({ id: 0 });
    });
});