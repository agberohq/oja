import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wizard } from '../../src/js/ui/wizard.js';
import { Out } from '../../src/js/core/out.js';

beforeEach(() => { document.body.innerHTML = ''; });

function makeContainer() {
    const div = document.createElement('div');
    div.id = 'wizard-' + Math.random().toString(36).slice(2);
    document.body.appendChild(div);
    return div;
}

const STEPS = [
    { key: 'step1', label: 'Step One',   body: Out.html('<input data-wizard-field="name" value="">') },
    { key: 'step2', label: 'Step Two',   body: Out.html('<input data-wizard-field="email" value="">') },
    { key: 'step3', label: 'Confirm',    body: Out.html('<p>Confirm your details</p>'), final: true },
];

// ─── render() ────────────────────────────────────────────────────────────────

describe('wizard.render()', () => {
    it('returns a handle with required methods', () => {
        const container = makeContainer();
        const w = wizard.render(container, STEPS);
        expect(typeof w.next).toBe('function');
        expect(typeof w.back).toBe('function');
        expect(typeof w.goTo).toBe('function');
        expect(typeof w.data).toBe('function');
        expect(typeof w.currentStep).toBe('function');
        expect(typeof w.destroy).toBe('function');
        w.destroy();
    });

    it('renders the first step on init', async () => {
        const container = makeContainer();
        wizard.render(container, STEPS);
        await new Promise(r => setTimeout(r, 20));
        const title = container.querySelector('.oja-wizard-title');
        expect(title?.textContent).toBe('Step One');
    });

    it('renders a progress indicator', async () => {
        const container = makeContainer();
        wizard.render(container, STEPS, { showProgress: true });
        await new Promise(r => setTimeout(r, 20));
        const dots = container.querySelectorAll('.oja-wizard-step-dot');
        expect(dots.length).toBe(STEPS.length);
    });

    it('shows step count when showStepCount: true', async () => {
        const container = makeContainer();
        wizard.render(container, STEPS, { showStepCount: true });
        await new Promise(r => setTimeout(r, 20));
        const count = container.querySelector('.oja-wizard-count');
        expect(count?.textContent).toContain('1 of 3');
    });

    it('returns nullHandle when container not found', () => {
        const w = wizard.render('#nonexistent-container', STEPS);
        expect(typeof w.next).toBe('function');
        expect(typeof w.destroy).toBe('function');
    });

    it('returns nullHandle when no steps', () => {
        const container = makeContainer();
        const w = wizard.render(container, []);
        expect(typeof w.next).toBe('function');
    });
});

// ─── next() and back() ───────────────────────────────────────────────────────

describe('wizard.next() and wizard.back()', () => {
    it('next() advances to the next step', async () => {
        const container = makeContainer();
        const w = wizard.render(container, STEPS);
        await new Promise(r => setTimeout(r, 20));

        await w.next();
        await new Promise(r => setTimeout(r, 20));

        const title = container.querySelector('.oja-wizard-title');
        expect(title?.textContent).toBe('Step Two');
        w.destroy();
    });

    it('back() returns to the previous step', async () => {
        const container = makeContainer();
        const w = wizard.render(container, STEPS);
        await new Promise(r => setTimeout(r, 20));
        await w.next();
        await new Promise(r => setTimeout(r, 20));
        await w.back();
        await new Promise(r => setTimeout(r, 20));

        const title = container.querySelector('.oja-wizard-title');
        expect(title?.textContent).toBe('Step One');
        w.destroy();
    });

    it('back() is a no-op on the first step', async () => {
        const container = makeContainer();
        const w = wizard.render(container, STEPS);
        await new Promise(r => setTimeout(r, 20));
        await w.back(); // should not throw or navigate backwards
        await new Promise(r => setTimeout(r, 20));

        const title = container.querySelector('.oja-wizard-title');
        expect(title?.textContent).toBe('Step One');
        w.destroy();
    });
});

// ─── goTo() ──────────────────────────────────────────────────────────────────

describe('wizard.goTo()', () => {
    it('jumps to step by key', async () => {
        const container = makeContainer();
        const w = wizard.render(container, STEPS);
        await new Promise(r => setTimeout(r, 20));

        await w.goTo('step3');
        await new Promise(r => setTimeout(r, 20));

        const title = container.querySelector('.oja-wizard-title');
        expect(title?.textContent).toBe('Confirm');
        w.destroy();
    });

    it('jumps to step by index', async () => {
        const container = makeContainer();
        const w = wizard.render(container, STEPS);
        await new Promise(r => setTimeout(r, 20));

        await w.goTo(1);
        await new Promise(r => setTimeout(r, 20));

        const title = container.querySelector('.oja-wizard-title');
        expect(title?.textContent).toBe('Step Two');
        w.destroy();
    });

    it('is a no-op for invalid key', async () => {
        const container = makeContainer();
        const w = wizard.render(container, STEPS);
        await new Promise(r => setTimeout(r, 20));
        await w.goTo('does-not-exist');
        await new Promise(r => setTimeout(r, 20));

        const title = container.querySelector('.oja-wizard-title');
        expect(title?.textContent).toBe('Step One');
        w.destroy();
    });
});

// ─── validation ──────────────────────────────────────────────────────────────

describe('wizard validation', () => {
    it('blocks next() when validate returns an error string', async () => {
        const container = makeContainer();
        const steps = [
            { key: 's1', label: 'S1', body: Out.html('<p>Step 1</p>'), validate: () => 'Name is required' },
            { key: 's2', label: 'S2', body: Out.html('<p>Step 2</p>') },
        ];
        const w = wizard.render(container, steps);
        await new Promise(r => setTimeout(r, 20));

        await w.next(); // should be blocked by validation
        await new Promise(r => setTimeout(r, 20));

        const title = container.querySelector('.oja-wizard-title');
        expect(title?.textContent).toBe('S1'); // still on first step

        const error = container.querySelector('.oja-wizard-error');
        expect(error?.textContent).toBe('Name is required');
        w.destroy();
    });

    it('allows next() when validate returns true', async () => {
        const container = makeContainer();
        const steps = [
            { key: 's1', label: 'S1', body: Out.html('<p>ok</p>'), validate: () => true },
            { key: 's2', label: 'S2', body: Out.html('<p>Step 2</p>') },
        ];
        const w = wizard.render(container, steps);
        await new Promise(r => setTimeout(r, 20));

        await w.next();
        await new Promise(r => setTimeout(r, 20));

        const title = container.querySelector('.oja-wizard-title');
        expect(title?.textContent).toBe('S2');
        w.destroy();
    });
});

// ─── data collection ─────────────────────────────────────────────────────────

describe('wizard.data()', () => {
    it('returns empty object before any step completes', () => {
        const container = makeContainer();
        const w = wizard.render(container, STEPS);
        expect(typeof w.data()).toBe('object');
        w.destroy();
    });

    it('setData() stores data for a step key', () => {
        const container = makeContainer();
        const w = wizard.render(container, STEPS);
        w.setData('step1', { name: 'Alice' });
        const d = w.data();
        expect(d.name).toBe('Alice');
        w.destroy();
    });

    it('data(false) returns per-step map', () => {
        const container = makeContainer();
        const w = wizard.render(container, STEPS);
        w.setData('step1', { name: 'Bob' });
        w.setData('step2', { email: 'bob@example.com' });
        const d = w.data(false);
        expect(d.step1?.name).toBe('Bob');
        expect(d.step2?.email).toBe('bob@example.com');
        w.destroy();
    });
});

// ─── onComplete ──────────────────────────────────────────────────────────────

describe('wizard onComplete', () => {
    it('calls onComplete with merged data after final step next()', async () => {
        const onComplete = vi.fn();
        const container = makeContainer();
        const steps = [
            { key: 'a', label: 'A', body: Out.html('<p>a</p>') },
            { key: 'b', label: 'B', body: Out.html('<p>b</p>'), final: true },
        ];
        const w = wizard.render(container, steps, { onComplete });
        w.setData('a', { name: 'Alice' });

        await new Promise(r => setTimeout(r, 20));
        await w.next(); // step a → b
        await new Promise(r => setTimeout(r, 20));
        await w.next(); // final step — submit
        await new Promise(r => setTimeout(r, 30));

        expect(onComplete).toHaveBeenCalledTimes(1);
        const [allData] = onComplete.mock.calls[0];
        expect(allData.name).toBe('Alice');
        w.destroy();
    });
});

// ─── currentStep() ───────────────────────────────────────────────────────────

describe('wizard.currentStep()', () => {
    it('returns current step info', async () => {
        const container = makeContainer();
        const w = wizard.render(container, STEPS);
        await new Promise(r => setTimeout(r, 20));
        const info = w.currentStep();
        expect(info.index).toBe(0);
        expect(info.key).toBe('step1');
        expect(info.total).toBe(3);
        w.destroy();
    });
});

// ─── destroy() ───────────────────────────────────────────────────────────────

describe('wizard.destroy()', () => {
    it('clears the container', async () => {
        const container = makeContainer();
        const w = wizard.render(container, STEPS);
        await new Promise(r => setTimeout(r, 20));
        w.destroy();
        expect(container.innerHTML).toBe('');
    });
});
