import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { progress } from '../../src/js/utils/progress.js';

beforeEach(() => {
    document.body.innerHTML = '';
    progress.destroyAll();
});

afterEach(() => {
    progress.destroyAll();
    document.body.innerHTML = '';
});


describe('progress() — named channels', () => {
    it('returns the same instance for the same name', () => {
        const a = progress('upload');
        const b = progress('upload');
        expect(a).toBe(b);
    });

    it('returns different instances for different names', () => {
        expect(progress('a')).not.toBe(progress('b'));
    });

    it('default channel has name "__default__"', () => {
        expect(progress().name).toBe('__default__');
    });

    it('destroy() removes the channel', () => {
        const p = progress('x');
        progress.destroy('x');
        expect(progress('x')).not.toBe(p);
    });
});


describe('state machine', () => {
    it('starts idle', () => {
        expect(progress('sm1').state).toBe('idle');
        expect(progress('sm1').value).toBe(0);
    });

    it('start() sets state to running', () => {
        const p = progress('sm2');
        p.start();
        expect(p.state).toBe('running');
    });

    it('set() transitions idle → running', () => {
        const p = progress('sm3');
        p.set(50);
        expect(p.state).toBe('running');
        expect(p.value).toBe(50);
    });

    it('done() sets state to done then back to idle', async () => {
        vi.useFakeTimers();
        const p = progress('sm4');
        p.set(80);
        p.done();
        expect(p.state).toBe('done');
        vi.advanceTimersByTime(800);
        expect(p.state).toBe('idle');
        expect(p.value).toBe(0);
        vi.useRealTimers();
    });

    it('fail() sets state to failed then back to idle', () => {
        vi.useFakeTimers();
        const p = progress('sm5');
        p.set(40);
        p.fail();
        expect(p.state).toBe('failed');
        vi.advanceTimersByTime(1100);
        expect(p.state).toBe('idle');
        vi.useRealTimers();
    });

    it('reset() returns to idle immediately', () => {
        const p = progress('sm6');
        p.set(60);
        p.reset();
        expect(p.state).toBe('idle');
        expect(p.value).toBe(0);
    });

    it('reverse() sets state to reversed', () => {
        const p = progress('sm7');
        p.set(80);
        p.reverse(30);
        expect(p.state).toBe('reversed');
        expect(p.value).toBe(30);
    });

    it('set() after reverse() re-enters running', () => {
        vi.useFakeTimers();
        const p = progress('sm8');
        p.set(80);
        p.reverse(30);
        vi.advanceTimersByTime(450);
        p.set(50);
        expect(p.state).toBe('running');
        vi.useRealTimers();
    });
});


describe('set() and inc()', () => {
    it('clamps value between 0 and 100', () => {
        const p = progress('si1');
        p.set(-10);
        expect(p.value).toBe(0);
        p.set(150);
        expect(p.value).toBe(100);
    });

    it('inc() adds to current value', () => {
        const p = progress('si2');
        p.set(50);
        p.inc(20);
        expect(p.value).toBe(70);
    });

    it('inc() clamps to 99 — not 100', () => {
        const p = progress('si3');
        p.set(95);
        p.inc(10);
        expect(p.value).toBe(99);
    });
});


describe('on() — milestone hooks', () => {
    it('fires when value crosses a milestone going up', () => {
        const fn = vi.fn();
        const p = progress('h1');
        p.on(50, fn);
        p.set(60);
        expect(fn).toHaveBeenCalledOnce();
    });

    it('does not fire when milestone not crossed', () => {
        const fn = vi.fn();
        const p = progress('h2');
        p.on(80, fn);
        p.set(50);
        expect(fn).not.toHaveBeenCalled();
    });

    it('fires on the way down too (no direction filter)', () => {
        const fn = vi.fn();
        const p = progress('h3');
        p.set(80);
        p.on(50, fn);
        p.set(30);
        expect(fn).toHaveBeenCalledOnce();
    });

    it('direction: up — only fires going up', () => {
        const fn = vi.fn();
        const p = progress('h4');
        p.set(80);
        p.on(50, fn, { direction: 'up' });
        p.set(30); // going down — should not fire
        expect(fn).not.toHaveBeenCalled();
        p.set(60); // going up — should fire
        expect(fn).toHaveBeenCalledOnce();
    });

    it('direction: down — only fires going down', () => {
        const fn = vi.fn();
        const p = progress('h5');
        p.set(20);
        p.on(50, fn, { direction: 'down' });
        p.set(80); // going up — should not fire
        expect(fn).not.toHaveBeenCalled();
        p.set(30); // going down — should fire
        expect(fn).toHaveBeenCalledOnce();
    });

    it('once: true — fires once then removes itself', () => {
        const fn = vi.fn();
        const p = progress('h6');
        p.on(50, fn, { once: true });
        p.set(60);
        p.set(30);
        p.set(60); // crosses 50 again going up
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('if: condition — only fires when condition returns true', () => {
        const fn  = vi.fn();
        let allow = false;
        const p = progress('h7');
        p.on(50, fn, { direction: 'up', if: () => allow });
        p.set(60); // crosses 50 going up — condition false, should not fire
        expect(fn).not.toHaveBeenCalled();
        allow = true;
        p.set(40); // drop below 50 — going down, direction filter skips
        p.set(60); // crosses 50 going up — condition true, fires once
        expect(fn).toHaveBeenCalledOnce();
    });

    it('off() removes a specific handler', () => {
        const fn = vi.fn();
        const p = progress('h8');
        p.on(50, fn);
        p.off(50, fn);
        p.set(60);
        expect(fn).not.toHaveBeenCalled();
    });

    it('off() with no fn removes all handlers at that key', () => {
        const f1 = vi.fn();
        const f2 = vi.fn();
        const p = progress('h9');
        p.on(50, f1);
        p.on(50, f2);
        p.off(50);
        p.set(60);
        expect(f1).not.toHaveBeenCalled();
        expect(f2).not.toHaveBeenCalled();
    });
});


describe('on() — lifecycle events', () => {
    it('fires "start" hook on start()', () => {
        const fn = vi.fn();
        const p = progress('lc1');
        p.on('start', fn);
        p.start();
        expect(fn).toHaveBeenCalledOnce();
    });

    it('fires "done" hook on done()', () => {
        const fn = vi.fn();
        const p = progress('lc2');
        p.on('done', fn);
        p.set(80);
        p.done();
        expect(fn).toHaveBeenCalledOnce();
    });

    it('fires "fail" hook on fail()', () => {
        const fn = vi.fn();
        const p = progress('lc3');
        p.on('fail', fn);
        p.fail('bad upload');
        expect(fn).toHaveBeenCalledWith({ reason: 'bad upload', channel: expect.any(String) });
    });

    it('fires "change" hook on every set()', () => {
        const fn = vi.fn();
        const p = progress('lc4');
        p.on('change', fn);
        p.set(30);
        p.set(60);
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('fires "reverse" hook on reverse()', () => {
        const fn = vi.fn();
        const p = progress('lc5');
        p.on('reverse', fn);
        p.set(80);
        p.reverse(30, { reason: 'corrupt' });
        expect(fn).toHaveBeenCalledWith(expect.objectContaining({
            value:  30,
            from:   80,
            reason: 'corrupt',
        }));
    });
});


describe('action()', () => {
    it('registers multiple hooks from one object', () => {
        const f50  = vi.fn();
        const fdone = vi.fn();
        const p = progress('ac1');
        p.action({ 50: f50, done: fdone });
        p.set(60);
        expect(f50).toHaveBeenCalledOnce();
        p.done();
        expect(fdone).toHaveBeenCalledOnce();
    });

    it('supports direction-split shorthand { up, down }', () => {
        const up   = vi.fn();
        const down = vi.fn();
        const p = progress('ac2');
        p.action({ 50: { up, down } });
        p.set(60);   // crosses 50 going up
        expect(up).toHaveBeenCalledOnce();
        expect(down).not.toHaveBeenCalled();
        p.set(30);   // crosses 50 going down
        expect(down).toHaveBeenCalledOnce();
        expect(up).toHaveBeenCalledTimes(1); // not fired again
    });

    it('merges with existing hooks — does not replace', () => {
        const f1 = vi.fn();
        const f2 = vi.fn();
        const p = progress('ac3');
        p.on(50, f1);
        p.action({ 50: f2 });
        p.set(60);
        expect(f1).toHaveBeenCalledOnce();
        expect(f2).toHaveBeenCalledOnce();
    });
});


describe('color()', () => {
    it('is chainable', () => {
        const p = progress('col1');
        expect(p.color([{ at: 0, color: '#fff' }])).toBe(p);
    });

    it('interpolate: false snaps to nearest defined color', () => {
        const p = progress('col2');
        p.color([
            { at: 0,   color: '#0000ff' },
            { at: 100, color: '#00ff00' },
        ], { interpolate: false });
        p.set(40); // closer to 0
        // browser normalises hex to rgb
        const bar = document.querySelector('.oja-progress-bar');
        expect(bar?.style.background).toBe('rgb(0, 0, 255)');
    });

    it('interpolate: true produces a blended color', () => {
        const p = progress('col3');
        p.color([
            { at: 0,   color: '#000000' },
            { at: 100, color: '#ffffff' },
        ], { interpolate: true });
        p.set(50);
        const bar = document.querySelector('.oja-progress-bar');
        // At 50% between black and white — browser formats with spaces
        expect(bar?.style.background).toBe('rgb(128, 128, 128)');
    });
});


describe('reverse()', () => {
    it('sets value to the target', () => {
        const p = progress('rev1');
        p.set(80);
        p.reverse(30);
        expect(p.value).toBe(30);
    });

    it('fires milestone hooks for crossed values going down', () => {
        const fn = vi.fn();
        const p = progress('rev2');
        p.set(80);
        p.on(50, fn, { direction: 'down' });
        p.reverse(20);
        expect(fn).toHaveBeenCalledOnce();
    });

    it('reverse cannot exceed 99', () => {
        const p = progress('rev3');
        p.set(50);
        p.reverse(200);
        expect(p.value).toBe(99);
    });
});


describe('DOM bar rendering', () => {
    it('injects a bar into the DOM on first set()', () => {
        progress('dom1').set(50);
        expect(document.querySelector('.oja-progress-wrap')).not.toBeNull();
        expect(document.querySelector('.oja-progress-bar')).not.toBeNull();
    });

    it('bar width reflects the value', () => {
        progress('dom2').set(75);
        const bar = document.querySelector('.oja-progress-bar');
        expect(bar?.style.width).toBe('75%');
    });

    it('reset() hides the bar', () => {
        const p = progress('dom3');
        p.set(50);
        p.reset();
        const wrap = document.querySelector('.oja-progress-wrap');
        expect(wrap?.style.display).toBe('none');
    });

    it('attach() renders bar inside the target element', () => {
        const div = document.createElement('div');
        div.id = 'target';
        document.body.appendChild(div);
        progress('dom4').attach('#target').set(60);
        expect(div.querySelector('.oja-progress-wrap')).not.toBeNull();
    });
});