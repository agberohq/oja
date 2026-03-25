/**
 * oja/wizard.js
 * Multi-step wizard — sequential form flow with validation, progress,
 * and data collection across steps.
 *
 * Works standalone (full page), inside a modal, or in any container.
 * Each step body is an Out — a component, HTML string, or any renderable.
 * Collected step data is merged and passed to onComplete.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { wizard } from '../oja/src/js/ui/wizard.js';
 *
 *   const w = wizard.render('#onboarding', [
 *       {
 *           key:      'account',
 *           label:    'Create account',
 *           body:     Out.c('steps/account.html'),
 *           validate: (data) => data.email?.includes('@') || 'Valid email required',
 *       },
 *       {
 *           key:   'profile',
 *           label: 'Your profile',
 *           body:  Out.c('steps/profile.html'),
 *       },
 *       {
 *           key:   'confirm',
 *           label: 'Confirm',
 *           body:  Out.c('steps/confirm.html'),
 *           final: true,   // marks this as the last step (shows Submit instead of Next)
 *       },
 *   ], {
 *       onComplete: async (allData) => {
 *           await api.post('/register', allData);
 *           router.navigate('/dashboard');
 *       },
 *       onCancel: () => router.navigate('/'),
 *       onStepChange: (fromIdx, toIdx, key) => analytics.track('wizard_step', { key }),
 *   });
 *
 *   // Programmatic control
 *   w.next();              // advance (runs validation first)
 *   w.back();              // go to previous step
 *   w.goTo('profile');     // jump to step by key
 *   w.data();              // → { account: {...}, profile: {...} }
 *   w.currentStep();       // → { key, label, index }
 *   w.destroy();           // tear down
 *
 * ─── Inside a modal ───────────────────────────────────────────────────────────
 *
 *   await modal.open('setupModal', {
 *       body: Out.fn(async (el) => {
 *           wizard.render(el, steps, { onComplete: (d) => { modal.close(); submit(d); } });
 *       }),
 *   });
 *
 * ─── Collecting form data ─────────────────────────────────────────────────────
 *
 *   Each step's body component can write to the wizard's data bag by emitting
 *   a 'wizard:step-data' event, or by using form.collect() on a form element
 *   inside the step — wizard.js auto-collects [data-wizard-field] inputs on Next:
 *
 *   <!-- In a step component: -->
 *   <input data-wizard-field="email" type="email" placeholder="you@example.com">
 *   <input data-wizard-field="name"  type="text"  placeholder="Your name">
 *
 * ─── Validation ───────────────────────────────────────────────────────────────
 *
 *   validate can be:
 *     - A function (data) => true | 'error message string'
 *     - A function (data) => Promise<true | 'error message string'>
 *     - Omitted (no validation for this step)
 *
 * ─── Options ──────────────────────────────────────────────────────────────────
 *
 *   onComplete    : async (allData) => void  — called after final step confirmed
 *   onCancel      : () => void               — called when cancel is clicked
 *   onStepChange  : (from, to, key) => void  — called on every step transition
 *   labels        : object                   — override button labels
 *     { next: 'Next', back: 'Back', submit: 'Submit', cancel: 'Cancel' }
 *   showProgress  : boolean                  — show step indicator bar (default: true)
 *   showStepCount : boolean                  — show "Step 1 of 3" text (default: true)
 *   className     : string                   — extra CSS class on wrapper
 */

import { Out } from '../core/out.js';
import { emit, listen } from '../core/events.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _resolve(target) {
    if (!target) return null;
    if (target instanceof Element) return target;
    return document.querySelector(target);
}

function _esc(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Collect [data-wizard-field] inputs from a container into a plain object.
function _collectFields(container) {
    const data = {};
    container.querySelectorAll('[data-wizard-field]').forEach(el => {
        const key = el.dataset.wizardField;
        if (!key) return;
        if (el.type === 'checkbox') data[key] = el.checked;
        else if (el.type === 'radio') { if (el.checked) data[key] = el.value; }
        else data[key] = el.value;
    });
    return data;
}

// ─── wizard ───────────────────────────────────────────────────────────────────

export const wizard = {

    /**
     * Render a wizard into a container element.
     * Returns a handle with next/back/goTo/data/currentStep/destroy.
     *
     * @param {string|Element}  target  — CSS selector or Element to render into
     * @param {Object[]}        steps   — step definitions (see header)
     * @param {Object}          options — see header
     * @returns {Object}        handle
     */
    render(target, steps = [], options = {}) {
        const container = _resolve(target);
        if (!container) {
            console.warn('[oja/wizard] container not found:', target);
            return _nullHandle();
        }

        if (!steps.length) {
            console.warn('[oja/wizard] no steps provided');
            return _nullHandle();
        }

        const {
            onComplete   = null,
            onCancel     = null,
            onStepChange = null,
            showProgress  = true,
            showStepCount = true,
            className    = '',
            labels       = {},
        } = options;

        const BTN = {
            next:   labels.next   || 'Next →',
            back:   labels.back   || '← Back',
            submit: labels.submit || 'Submit',
            cancel: labels.cancel || 'Cancel',
        };

        // ── State ────────────────────────────────────────────────────────────
        let _currentIdx  = 0;
        let _isSubmitting = false;
        const _stepData   = {};  // key → collected data object
        const _unsubs     = [];  // event unsub functions

        // ── DOM skeleton ─────────────────────────────────────────────────────
        container.innerHTML = '';
        container.className = `oja-wizard${className ? ' ' + className : ''}`;
        container.setAttribute('role', 'region');
        container.setAttribute('aria-label', 'Multi-step wizard');

        const progressEl = document.createElement('div');
        progressEl.className = 'oja-wizard-progress';
        if (!showProgress) progressEl.style.display = 'none';

        const headerEl = document.createElement('div');
        headerEl.className = 'oja-wizard-header';

        const countEl = document.createElement('div');
        countEl.className = 'oja-wizard-count';
        if (!showStepCount) countEl.style.display = 'none';

        const titleEl = document.createElement('h2');
        titleEl.className = 'oja-wizard-title';

        const bodyEl = document.createElement('div');
        bodyEl.className = 'oja-wizard-body';
        bodyEl.setAttribute('role', 'group');

        const errorEl = document.createElement('div');
        errorEl.className = 'oja-wizard-error';
        errorEl.setAttribute('role', 'alert');
        errorEl.setAttribute('aria-live', 'polite');
        errorEl.style.display = 'none';

        const footerEl = document.createElement('div');
        footerEl.className = 'oja-wizard-footer';

        headerEl.appendChild(countEl);
        headerEl.appendChild(titleEl);
        container.appendChild(progressEl);
        container.appendChild(headerEl);
        container.appendChild(bodyEl);
        container.appendChild(errorEl);
        container.appendChild(footerEl);

        // ── Render helpers ───────────────────────────────────────────────────

        function _renderProgress() {
            progressEl.innerHTML = steps.map((s, i) => {
                const cls = i < _currentIdx  ? 'done'
                          : i === _currentIdx ? 'active' : '';
                return `<div class="oja-wizard-step-dot ${cls}" title="${_esc(s.label)}"
                    aria-label="Step ${i + 1}: ${_esc(s.label)}${i < _currentIdx ? ' (complete)' : i === _currentIdx ? ' (current)' : ''}">
                    ${i < _currentIdx ? '✓' : i + 1}
                </div>`;
            }).join('<div class="oja-wizard-step-line"></div>');
        }

        async function _renderStep(idx) {
            const step = steps[idx];
            if (!step) return;

            const isFinal = step.final || idx === steps.length - 1;

            _renderProgress();
            titleEl.textContent = step.label || `Step ${idx + 1}`;
            countEl.textContent = `Step ${idx + 1} of ${steps.length}`;
            _clearError();

            bodyEl.innerHTML = '';
            bodyEl.setAttribute('aria-label', step.label || `Step ${idx + 1}`);

            if (Out.is(step.body)) {
                await step.body.render(bodyEl);
            } else if (typeof step.body === 'string') {
                Out.html(step.body).render(bodyEl);
            } else if (typeof step.body === 'function') {
                step.body(bodyEl);
            }

            // Restore any previously entered data for this step
            const saved = _stepData[step.key];
            if (saved) {
                Object.entries(saved).forEach(([k, v]) => {
                    const el = bodyEl.querySelector(`[data-wizard-field="${k}"]`);
                    if (el) {
                        if (el.type === 'checkbox') el.checked = !!v;
                        else if (el.type === 'radio') { bodyEl.querySelectorAll(`[name="${el.name}"]`).forEach(r => { r.checked = r.value === v; }); }
                        else el.value = v;
                    }
                });
            }

            // Footer buttons
            footerEl.innerHTML = '';

            if (onCancel || idx === 0) {
                const cancelBtn = document.createElement('button');
                cancelBtn.type = 'button';
                cancelBtn.className = 'oja-wizard-btn oja-wizard-cancel';
                cancelBtn.textContent = BTN.cancel;
                cancelBtn.addEventListener('click', () => handle.cancel());
                footerEl.appendChild(cancelBtn);
            }

            const spacer = document.createElement('div');
            spacer.style.flex = '1';
            footerEl.appendChild(spacer);

            if (idx > 0) {
                const backBtn = document.createElement('button');
                backBtn.type = 'button';
                backBtn.className = 'oja-wizard-btn oja-wizard-back';
                backBtn.textContent = BTN.back;
                backBtn.addEventListener('click', () => handle.back());
                footerEl.appendChild(backBtn);
            }

            const nextBtn = document.createElement('button');
            nextBtn.type = 'button';
            nextBtn.className = `oja-wizard-btn oja-wizard-next${isFinal ? ' oja-wizard-submit' : ''}`;
            nextBtn.textContent = isFinal ? BTN.submit : BTN.next;
            nextBtn.addEventListener('click', () => handle.next());
            footerEl.appendChild(nextBtn);

            emit('wizard:step-rendered', { index: idx, key: step.key, total: steps.length });
        }

        function _clearError() {
            errorEl.textContent = '';
            errorEl.style.display = 'none';
        }

        function _showError(msg) {
            errorEl.textContent = msg;
            errorEl.style.display = '';
            errorEl.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        }

        async function _validateStep(idx) {
            const step = steps[idx];
            if (!step?.validate) return true;

            // Collect current field data before validation
            const current = { ..._stepData[step.key], ..._collectFields(bodyEl) };

            const result = await step.validate(current);
            if (result === true || result === undefined || result === null) return true;
            _showError(String(result));
            return false;
        }

        // ── Public handle ─────────────────────────────────────────────────────
        const handle = {

            /** Advance to next step (runs validation first). */
            async next() {
                if (_isSubmitting) return this;

                // Collect fields from current step body
                const step = steps[_currentIdx];
                const collected = _collectFields(bodyEl);
                _stepData[step.key] = { ..._stepData[step.key], ...collected };

                // Also pick up any data emitted via wizard:step-data event
                _clearError();

                const valid = await _validateStep(_currentIdx);
                if (!valid) return this;

                const isFinal = step.final || _currentIdx === steps.length - 1;

                if (isFinal) {
                    // Submit
                    _isSubmitting = true;
                    const nextBtn = footerEl.querySelector('.oja-wizard-next');
                    if (nextBtn) { nextBtn.disabled = true; nextBtn.textContent = 'Submitting…'; }

                    try {
                        const allData = Object.assign({}, ..._stepData ? Object.values(_stepData) : []);
                        if (typeof onComplete === 'function') await onComplete(allData, _stepData);
                        emit('wizard:complete', { data: allData, stepData: _stepData });
                    } catch (err) {
                        _showError(err.message || 'Submission failed. Please try again.');
                        if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = BTN.submit; }
                    } finally {
                        _isSubmitting = false;
                    }
                    return this;
                }

                const from = _currentIdx;
                _currentIdx++;
                onStepChange?.(from, _currentIdx, steps[_currentIdx].key);
                await _renderStep(_currentIdx);
                return this;
            },

            /** Go back to previous step. */
            async back() {
                if (_currentIdx === 0) return this;
                const from = _currentIdx;
                _currentIdx--;
                onStepChange?.(from, _currentIdx, steps[_currentIdx].key);
                await _renderStep(_currentIdx);
                return this;
            },

            /** Jump to a step by its key. */
            async goTo(keyOrIndex) {
                const idx = typeof keyOrIndex === 'number'
                    ? keyOrIndex
                    : steps.findIndex(s => s.key === keyOrIndex);
                if (idx < 0 || idx >= steps.length) return this;
                const from = _currentIdx;
                _currentIdx = idx;
                onStepChange?.(from, idx, steps[idx].key);
                await _renderStep(idx);
                return this;
            },

            /** Set or merge data for a specific step key. */
            setData(key, data) {
                _stepData[key] = { ..._stepData[key], ...data };
                return this;
            },

            /** Get all collected data (merged across steps), or per-step map. */
            data(merged = true) {
                if (!merged) return { ..._stepData };
                return Object.assign({}, ...Object.values(_stepData));
            },

            /** Current step info. */
            currentStep() {
                const s = steps[_currentIdx];
                return { key: s.key, label: s.label, index: _currentIdx, total: steps.length };
            },

            /** Cancel the wizard. */
            cancel() {
                onCancel?.();
                emit('wizard:cancel', { index: _currentIdx, key: steps[_currentIdx].key });
            },

            /** Remove DOM and clean up. */
            destroy() {
                _unsubs.forEach(off => off());
                container.innerHTML = '';
            },
        };

        // Listen for step-data events from step body components
        const unsubStepData = listen('wizard:step-data', ({ key, data }) => {
            if (key) _stepData[key] = { ..._stepData[key], ...data };
        });
        _unsubs.push(unsubStepData);

        // Kick off first render
        _renderStep(0);

        return handle;
    },
};

// ─── Null handle (returned on error) ─────────────────────────────────────────

function _nullHandle() {
    const noop = () => Promise.resolve(_nullHandle());
    return { next: noop, back: noop, goTo: noop, data: () => ({}), currentStep: () => null, setData: () => _nullHandle(), cancel: () => {}, destroy: () => {} };
}
