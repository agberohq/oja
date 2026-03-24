/**
 * oja/mask.js
 * Input masking — format phone numbers, dates, and currencies as you type.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { mask } from '../oja/mask.js';
 *
 *   // 0 = number, a = letter, * = alphanumeric
 *   mask.attach('#phone', '(000) 000-0000');
 *   mask.attach('#date', '00/00/0000');
 *   mask.attach('#serial', 'aaa-***-000');
 *
 * ─── Raw Value Integration ────────────────────────────────────────────────────
 *
 *   // Masking preserves the unformatted raw value in element.dataset.ojaRawValue
 *   // form.collect() automatically detects this and extracts the raw value.
 *
 *   const input = document.querySelector('#phone'); // typed: (555) 123-4567
 *   console.log(input.dataset.ojaRawValue); // -> "5551234567"
 */

function _applyMask(value, pattern) {
    let result = '';
    let unmasked = '';
    let vIdx = 0;

    // Strip everything except alphanumeric characters for parsing
    const cleanVal = String(value).replace(/[^a-zA-Z0-9]/g, '');

    for (let i = 0; i < pattern.length && vIdx < cleanVal.length; i++) {
        const p = pattern[i];
        const c = cleanVal[vIdx];

        if (p === '0' && /[0-9]/.test(c)) {
            result += c; unmasked += c; vIdx++;
        } else if (p === 'a' && /[a-zA-Z]/.test(c)) {
            result += c; unmasked += c; vIdx++;
        } else if (p === '*' && /[a-zA-Z0-9]/.test(c)) {
            result += c; unmasked += c; vIdx++;
        } else if (p !== '0' && p !== 'a' && p !== '*') {
            result += p;
            if (c === p) vIdx++; // User typed the literal mask char
        } else {
            break; // Invalid character for this mask position
        }
    }
    return { masked: result, unmasked };
}

export const mask = {
    attach(target, pattern) {
        const els = typeof target === 'string' ? document.querySelectorAll(target) :
            (target instanceof NodeList ? target : [target]);

        els.forEach(el => {
            if (el.tagName !== 'INPUT') return;

            el.setAttribute('data-oja-mask', pattern);

            const handler = (e) => {
                if (e.type !== 'input') {
                    // blur / init — just format, no cursor adjustment needed
                    const { masked, unmasked } = _applyMask(el.value, pattern);
                    el.value = masked;
                    el.dataset.ojaRawValue = unmasked;
                    return;
                }

                // Count how many unmasked (real) characters sit before the cursor.
                // This is the stable anchor — mask literals don't count.
                const cursorBefore = el.selectionStart;
                const rawBefore = el.value.slice(0, cursorBefore).replace(/[^a-zA-Z0-9]/g, '').length;

                const { masked, unmasked } = _applyMask(el.value, pattern);
                el.value = masked;
                el.dataset.ojaRawValue = unmasked; // Used by form.collect()

                // Reposition: walk through the new masked value and count rawBefore
                // unmasked characters, then place the cursor right after that point.
                let raw = 0;
                let newCursor = masked.length; // fallback: end of string
                for (let i = 0; i < masked.length; i++) {
                    if (/[a-zA-Z0-9]/.test(masked[i])) raw++;
                    if (raw === rawBefore) {
                        newCursor = i + 1;
                        break;
                    }
                }
                // If rawBefore === 0 (cursor was at start), place at 0
                if (rawBefore === 0) newCursor = 0;
                el.setSelectionRange(newCursor, newCursor);
            };

            el.addEventListener('input', handler);
            el.addEventListener('blur', handler);

            // Format initial value
            if (el.value) handler({ type: 'init' });

            el._ojaMaskUnsub = () => {
                el.removeEventListener('input', handler);
                el.removeEventListener('blur', handler);
                delete el.dataset.ojaMask;
                delete el.dataset.ojaRawValue;
            };
        });

        return {
            destroy: () => els.forEach(el => el._ojaMaskUnsub?.())
        };
    },

    // Auto-wire [data-mask] elements globally
    wire() {
        if (typeof document === 'undefined') return;
        document.querySelectorAll('input[data-mask]').forEach(el => {
            if (!el._ojaMaskUnsub) this.attach(el, el.getAttribute('data-mask'));
        });
    }
};

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => mask.wire());
}