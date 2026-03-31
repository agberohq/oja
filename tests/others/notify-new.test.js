import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { notify } from '../../src/js/ui/notify.js';

beforeEach(() => {
    document.body.innerHTML = '';
    vi.useFakeTimers();
    notify.dismissAll();
    notify.config({ max: 0 }); // reset max
    notify.setPosition('top-right');
});

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
});


describe('notify.show("msg", "type") backwards compat', () => {
    it('renders as success when second arg is "success"', () => {
        const id = notify.show('Copied', 'success');
        expect(typeof id).toBe('string');
        const toast = document.getElementById(id);
        expect(toast?.classList.contains('oja-toast-success')).toBe(true);
    });

    it('renders as error when second arg is "error"', () => {
        const id = notify.show('Failed', 'error');
        const toast = document.getElementById(id);
        expect(toast?.classList.contains('oja-toast-error')).toBe(true);
    });

    it('falls back to info for unknown type string', () => {
        const id = notify.show('Hello', 'unknown-type');
        const toast = document.getElementById(id);
        expect(toast?.classList.contains('oja-toast-info')).toBe(true);
    });

    it('still works with an options object as second arg', () => {
        const id = notify.show('Rich', { duration: 0 });
        expect(typeof id).toBe('string');
    });
});


describe('notify.update(id, message)', () => {
    it('updates message text of an existing toast', () => {
        const id = notify.info('Uploading…', { duration: 0 });
        notify.update(id, 'Upload complete');
        const msgEl = document.getElementById(id)?.querySelector('.oja-toast-msg');
        expect(msgEl?.textContent).toBe('Upload complete');
    });

    it('changes type class when type option provided', () => {
        const id = notify.info('Pending…', { duration: 0 });
        notify.update(id, 'Done!', { type: 'success' });
        const toast = document.getElementById(id);
        expect(toast?.classList.contains('oja-toast-success')).toBe(true);
        expect(toast?.classList.contains('oja-toast-info')).toBe(false);
    });

    it('is safe to call with stale id', () => {
        expect(() => notify.update('stale-id', 'x')).not.toThrow();
    });

    it('returns notify for chaining', () => {
        const id = notify.info('x', { duration: 0 });
        expect(notify.update(id, 'y')).toBe(notify);
    });
});


describe('notify.promise(promise, messages)', () => {
    it('shows pending toast while promise is pending', async () => {
        let resolve;
        const p = new Promise(r => { resolve = r; });
        notify.promise(p, { pending: 'Working…', success: 'Done' });
        const toasts = document.querySelectorAll('.oja-toast');
        expect(toasts.length).toBeGreaterThan(0);
        resolve();
        await p;
    });

    it('returns the original promise', () => {
        const p = Promise.resolve('result');
        const returned = notify.promise(p, { success: 'ok' });
        expect(returned).toBe(p);
    });

    it('calls success message function with resolved value', async () => {
        let capturedMsg;
        const originalUpdate = notify.update.bind(notify);
        notify.update = (id, msg, opts) => {
            if (opts?.type === 'success') capturedMsg = msg;
            return originalUpdate(id, msg, opts);
        };

        const p = Promise.resolve('Alice');
        await notify.promise(p, { success: (name) => `Welcome, ${name}!` });

        expect(capturedMsg).toBe('Welcome, Alice!');
        notify.update = originalUpdate;
    });
});


describe('notify.progress(message)', () => {
    it('returns a handle with update/done/fail/dismiss', () => {
        const p = notify.progress('Uploading…');
        expect(typeof p.update).toBe('function');
        expect(typeof p.done).toBe('function');
        expect(typeof p.fail).toBe('function');
        expect(typeof p.dismiss).toBe('function');
    });

    it('update() appends percentage to message', () => {
        const p = notify.progress('Loading…');
        p.update(60);
        const toast = document.getElementById(p.id);
        expect(toast?.querySelector('.oja-toast-msg')?.textContent).toContain('60%');
    });

    it('done() changes toast to success', () => {
        const p = notify.progress('Working');
        p.done('All done!');
        const toast = document.getElementById(p.id);
        expect(toast?.classList.contains('oja-toast-success')).toBe(true);
    });
});


describe('notify.config({ max })', () => {
    it('limits visible toasts to max', () => {
        notify.config({ max: 2 });
        notify.info('A', { duration: 0 });
        notify.info('B', { duration: 0 });
        notify.info('C', { duration: 0 }); // should evict A
        const visible = document.querySelectorAll('.oja-toast:not(.oja-toast-leaving)');
        expect(visible.length).toBeLessThanOrEqual(2);
    });

    it('max: 0 means unlimited', () => {
        notify.config({ max: 0 });
        for (let i = 0; i < 5; i++) notify.info(`Toast ${i}`, { duration: 0 });
        const visible = document.querySelectorAll('.oja-toast:not(.oja-toast-leaving)');
        expect(visible.length).toBe(5);
    });
});