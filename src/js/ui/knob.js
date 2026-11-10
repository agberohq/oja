/**
 * oja/knob.js
 * Rotary parameter control — three shapes from one factory.
 *
 *   1. dial      — ring + pointer, label and value below
 *   2. readout   — ring + pointer, numeric value in the centre
 *   3. selector  — ring + pointer, selected icon in the centre; opens a
 *                  radial radio menu of icons (mode control, not a slider)
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { knob } from '@agberohq/oja';
 *
 *   const gain = knob.create({
 *       label: 'Gain', min: -24, max: 12, step: 0.5, value: -6,
 *       defaultValue: 0, format: v => `${v.toFixed(1)} dB`,
 *       onChange: (v) => setGain(v),
 *   });
 *   host.appendChild(gain.el);
 *
 *   // centre readout
 *   const bpm = knob.create({ label: 'BPM', min: 40, max: 240, readout: 'center' });
 *
 *   // icon selector
 *   const snap = knob.create({
 *       label: 'Snap',
 *       items: [
 *           { value: 'off',  label: 'Off',  icon: '∅' },
 *           { value: 'beat', label: 'Beat', icon: '♩' },
 *           { value: 'bar',  label: 'Bar',  icon: '▥' },
 *       ],
 *       value: 'off',
 *   });
 *
 * ─── Interaction ──────────────────────────────────────────────────────────────
 *
 *   drag up/down  — change value (Shift = fine)
 *   wheel         — change only while focused (wheel: 'focus' by default)
 *   double-click  — reset to defaultValue
 *   arrows        — step; PageUp/PageDown — 10% of range; Home/End — min/max
 *   selector      — click/Enter/Space opens; arrows move radios; Escape closes
 *
 * ─── Accessibility ────────────────────────────────────────────────────────────
 *
 *   Continuous: role="slider", aria-valuemin/max/now/valuetext.
 *   Selector:   button[aria-expanded] + role="radiogroup" + native radios.
 */

import { make } from '../core/ui.js';
import { on }   from '../core/events.js';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

function _decimals(step) {
    if (!Number.isFinite(step) || step <= 0) return 2;
    const s = String(step);
    if (s.includes('e-')) return Math.min(10, parseInt(s.split('e-')[1], 10));
    const dot = s.indexOf('.');
    return dot === -1 ? 0 : Math.min(10, s.length - dot - 1);
}

function _round(v, decimals) {
    return Number(Number(v).toFixed(decimals));
}

function _iconNode(item, renderIcon) {
    if (typeof renderIcon === 'function') {
        const out = renderIcon(item);
        if (out instanceof Node) {
            const wrap = make.span({ class: 'oja-knob-icon' });
            wrap.appendChild(out);
            return wrap;
        }
        return make.span({ class: 'oja-knob-icon', text: out == null ? '' : String(out) });
    }
    const icon = item?.icon;
    if (icon instanceof Node) return icon;
    return make.span({ class: 'oja-knob-icon', text: icon == null ? '' : String(icon) });
}

export function createKnob(options = {}) {
    const {
        label = '',
        min = 0,
        max = 100,
        step = (max - min) / 100,
        value = min,
        defaultValue = min,
        scale = 'linear',
        format = (v) => String(v),
        hint = '',
        size = 'md',
        readout = 'below',
        disabled = false,
        items = null,
        closeOnSelect = true,
        renderIcon = null,
        ariaLabel = '',
        wheel = 'focus',
        dragMode = 'vertical',       // 'vertical' | 'angle' (angle = direct manipulation)
        onChange = () => {},
    } = options;

    const isSelector = Array.isArray(items);
    const variant = isSelector ? 'selector' : (readout === 'center' ? 'readout' : 'dial');
    const name = `oja-knob-${Math.random().toString(36).slice(2, 9)}`;
    const cleanups = [];
    let current;
    let isDisabled = !!disabled;
    let selectorItems = isSelector ? items.slice() : null;
    let open = false;
    let outsideHandler = null;
    let dragging = false;

    const log = scale === 'log';
    if (log && !(min > 0)) {
        console.warn('[oja/knob] scale:"log" requires min > 0; falling back to linear.');
    }
    const useLog = log && min > 0 && max > min;

    const isAnyStep = step === 'any';
    const stepValue = isAnyStep
        ? (max - min) / 100
        : (Number(step) > 0 ? Number(step) : ((max - min) / 100 || 1));
    const decimals = _decimals(stepValue);

    const fmt = (v) => {
        try {
            const out = format(v);
            return out == null ? String(v) : String(out);
        } catch (e) {
            console.warn('[oja/knob] format() threw:', e);
            return String(v);
        }
    };

    const snap = (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return min;
        if (isAnyStep) return clamp(n, min, max);
        const stepped = min + Math.round((n - min) / stepValue) * stepValue;
        return clamp(_round(stepped, decimals), min, max);
    };

    const pctOf = (v) => {
        if (max === min) return 0;
        if (useLog) return Math.log(v / min) / Math.log(max / min);
        return (v - min) / (max - min);
    };

    const valueOf = (p) => {
        const t = clamp(p, 0, 1);
        if (useLog) return min * Math.pow(max / min, t);
        return min + t * (max - min);
    };

    // selector helpers

    const itemIndex = (v) => {
        if (!selectorItems) return -1;
        let i = selectorItems.findIndex(it => Object.is(it.value, v));
        if (i === -1) i = selectorItems.findIndex(it => String(it.value) === String(v));
        return i;
    };

    const initials = () => {
        if (!selectorItems || selectorItems.length === 0) return min;
        const i = itemIndex(value);
        return selectorItems[i >= 0 ? i : 0]?.value;
    };

    current = isSelector ? initials() : snap(value);

    // DOM

    const root = make.div({
        class: 'oja-knob',
        data: { variant, size },
        attrs: {
            'data-variant': variant,
            'data-size': size,
        },
    });
    root.dataset.variant = variant;
    root.dataset.size = size;

    const stage = make.div({ class: 'oja-knob-stage' });
    const body = isSelector
        ? make.button({ class: 'oja-knob-body oja-knob-cap', attrs: { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false' } })
        : make.div({ class: 'oja-knob-body' });

    const svg = make('svg', { attrs: { viewBox: '0 0 64 64', 'aria-hidden': 'true' } });
    const track = make('circle', {
        class: 'oja-knob-track',
        attrs: { cx: 32, cy: 32, r: 25, pathLength: 100 },
    });
    const arc = make('circle', {
        class: 'oja-knob-arc',
        attrs: { cx: 32, cy: 32, r: 25, pathLength: 100 },
    });
    const pointer = make('line', {
        class: 'oja-knob-pointer',
        attrs: { x1: 32, y1: 32, x2: 32, y2: 13 },
    });
    // Centre readout / icon need the middle of the dial free; keep the pointer
    // as an outer tick instead of a needle through the text.
    if (variant !== 'dial') pointer.setAttribute('y1', '21');
    svg.append(track, arc, pointer);

    const center = make.span({ class: 'oja-knob-center' });
    if (!isSelector && readout !== 'center') center.hidden = true;

    body.appendChild(svg);
    body.appendChild(center);
    stage.appendChild(body);

    const labelEl = make.span({ class: 'oja-knob-label', text: label });
    const valueEl = make.span({ class: 'oja-knob-value', text: '' });
    const itemsWrap = isSelector
        ? make.div({ class: 'oja-knob-items', attrs: { role: 'radiogroup', 'aria-label': label || ariaLabel || 'Options' } })
        : null;

    if (isSelector) {
        stage.appendChild(itemsWrap);
        root.setAttribute('aria-label', label || ariaLabel || 'Mode selector');
        if (hint) root.setAttribute('data-tooltip', hint);
    } else {
        root.setAttribute('role', 'slider');
        root.setAttribute('tabindex', '0');
        root.setAttribute('aria-label', label || ariaLabel || 'Value');
        root.setAttribute('aria-valuemin', String(min));
        root.setAttribute('aria-valuemax', String(max));
        root.setAttribute('aria-valuenow', String(current));
        root.setAttribute('aria-valuetext', fmt(current));
        if (hint) root.setAttribute('data-tooltip', hint);
    }

    root.appendChild(stage);
    root.appendChild(labelEl);
    root.appendChild(valueEl);

    // selector items

    function buildItems() {
        if (!isSelector) return;
        itemsWrap.innerHTML = '';
        const n = selectorItems.length;
        const sweep = 270;
        const angleOf = (i) => n <= 1 ? 0 : -sweep / 2 + i * (sweep / (n - 1));

        selectorItems.forEach((item, i) => {
            const angle = angleOf(i);
            const input = make('input', {
                class: 'oja-knob-radio',
                type: 'radio',
                name,
                value: item.value,
                checked: Object.is(item.value, current) || String(item.value) === String(current),
                disabled: isDisabled || !!item.disabled,
            });
            // Closed items are visibility:hidden but a radio would still be in
            // the tab order. Keep them out until the menu opens.
            input.tabIndex = open ? 0 : -1;
            const row = make.label({
                class: 'oja-knob-item',
                data: { index: i },
                style: { '--oja-knob-angle': `${angle}deg` },
            });
            row.dataset.index = String(i);
            row.style.setProperty('--oja-knob-angle', `${angle}deg`);
            row.appendChild(input);
            row.appendChild(_iconNode(item, renderIcon));
            row.appendChild(make.span({ class: 'oja-knob-item-label', text: item.label ?? String(item.value) }));

            on(input, 'change', () => {
                if (isDisabled) return;
                setValue(item.value, { emit: true, source: 'select' });
                if (closeOnSelect) closeMenu();
            });
            itemsWrap.appendChild(row);
        });
    }

    function selectedItem() {
        if (!isSelector) return null;
        const i = itemIndex(current);
        return i >= 0 ? selectorItems[i] : selectorItems[0] || null;
    }

    function syncSelector() {
        if (!isSelector) return;
        const item = selectedItem();
        const i = itemIndex(current);
        const n = selectorItems.length;
        const sweep = 270;
        const angle = n <= 1 ? 0 : -sweep / 2 + Math.max(0, i) * (sweep / (n - 1));

        // Cap pointer + selected icon
        pointer.setAttribute('transform', `rotate(${angle} 32 32)`);
        center.innerHTML = '';
        const icon = _iconNode(item || {}, renderIcon);
        center.appendChild(icon);
        body.setAttribute('aria-label', `${label || 'Mode'}: ${item?.label ?? item?.value ?? ''}`.trim());
        valueEl.textContent = '';
        valueEl.hidden = true;

        for (const input of itemsWrap.querySelectorAll('.oja-knob-radio')) {
            input.checked = String(input.value) === String(current);
        }
        itemsWrap.style.setProperty('--oja-knob-selected', String(Math.max(0, i)));
    }

    // rendering

    function render() {
        if (isSelector) {
            syncSelector();
            return;
        }
        const pct = clamp(pctOf(current), 0, 1);
        arc.style.strokeDasharray = `${(pct * 75).toFixed(3)} 100`;
        pointer.setAttribute('transform', `rotate(${-135 + pct * 270} 32 32)`);

        const text = fmt(current);
        if (readout === 'center') {
            center.hidden = false;
            center.textContent = text;
            valueEl.hidden = true;
            valueEl.textContent = '';
        } else {
            center.hidden = true;
            valueEl.hidden = false;
            valueEl.textContent = text;
        }
        root.setAttribute('aria-valuenow', String(current));
        root.setAttribute('aria-valuetext', text);
        root.setAttribute('aria-valuemin', String(min));
        root.setAttribute('aria-valuemax', String(max));
    }

    // value

    function setValue(next, { emit = false, source = 'api' } = {}) {
        let normalized;
        if (isSelector) {
            const i = itemIndex(next);
            normalized = i >= 0 ? selectorItems[i].value : current;
        } else {
            normalized = snap(next);
        }
        if (Object.is(normalized, current)) {
            render();
            return current;
        }
        current = normalized;
        render();
        if (emit) onChange(current, { source, item: isSelector ? selectedItem() : undefined });
        return current;
    }

    function setDisabled(next) {
        isDisabled = !!next;
        root.dataset.disabled = String(isDisabled);
        root.setAttribute('aria-disabled', String(isDisabled));
        if (isSelector) {
            body.disabled = isDisabled;
            body.setAttribute('aria-disabled', String(isDisabled));
            itemsWrap.querySelectorAll('input').forEach(i => {
                i.disabled = isDisabled;
                i.tabIndex = isDisabled ? -1 : (open ? 0 : -1);
            });
        } else {
            root.setAttribute('tabindex', isDisabled ? '-1' : '0');
        }
    }

    // continuous interaction

    function beginDrag(e) {
        if (isDisabled || e.button !== 0 || isSelector) return;
        e.preventDefault();
        dragging = true;
        const dial = body;
        const startY = e.clientY;
        const startPct = pctOf(current);
        const sensitivity = e.shiftKey ? 640 : 180;
        let moved = false;

        // Pointer capture keeps the gesture alive over the rest of the page.
        if (e.pointerId != null) {
            try { dial.setPointerCapture?.(e.pointerId); } catch { /* optional */ }
        }

        const anglePct = (ev) => {
            const rect = dial.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            // 0° is up, 90° is right; the sweep is -135°..+135°.
            let deg = Math.atan2(ev.clientX - cx, -(ev.clientY - cy)) * 180 / Math.PI;
            if (deg < -135) deg = -135;
            if (deg > 135) deg = 135;
            return (deg + 135) / 270;
        };

        const move = (ev) => {
            if (ev.pointerId != null && e.pointerId != null && ev.pointerId !== e.pointerId) return;
            if (dragMode === 'angle') {
                moved = true;
                setValue(valueOf(anglePct(ev)), { emit: true, source: 'drag' });
                return;
            }
            const delta = (startY - ev.clientY) / sensitivity;
            if (Math.abs(ev.clientY - startY) > 2) moved = true;
            setValue(valueOf(clamp(startPct + delta, 0, 1)), { emit: true, source: 'drag' });
        };
        const up = (ev) => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
            if (ev?.pointerId != null) {
                try { dial.releasePointerCapture?.(ev.pointerId); } catch { /* optional */ }
            }
            dragging = false;
            root.dataset.dragging = 'false';
            if (!moved) root.focus();
        };

        root.dataset.dragging = 'true';
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
        if (dragMode === 'angle') setValue(valueOf(anglePct(e)), { emit: true, source: 'drag' });
        cleanups.push(() => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('pointercancel', up);
        });
    }

    function onWheel(e) {
        if (isDisabled || isSelector) return;
        if (wheel === 'off') return;
        if (wheel === 'focus' && document.activeElement !== root && !root.contains(document.activeElement)) return;
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        const mult = e.shiftKey ? 0.2 : 1;
        setValue(current + dir * stepValue * mult, { emit: true, source: 'wheel' });
    }

    function onKeydown(e) {
        if (isDisabled) return;
        const big = Math.max(stepValue, (max - min) / 10);
        const fine = e.shiftKey ? 0.1 : 1;
        const key = e.key;
        if (isSelector) {
            if (key === 'Enter' || key === ' ' || key === 'ArrowDown') {
                e.preventDefault();
                open ? closeMenu() : openMenu();
            } else if (key === 'Escape' && open) {
                e.preventDefault();
                closeMenu();
            } else if (open && (key === 'ArrowRight' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowUp')) {
                e.preventDefault();
                const dir = (key === 'ArrowRight' || key === 'ArrowDown') ? 1 : -1;
                const i = itemIndex(current);
                const next = selectorItems[(i + dir + selectorItems.length) % selectorItems.length];
                if (next && !next.disabled) setValue(next.value, { emit: true, source: 'key' });
            }
            return;
        }
        if (key === 'ArrowUp' || key === 'ArrowRight') { e.preventDefault(); setValue(current + stepValue * fine, { emit: true, source: 'key' }); }
        else if (key === 'ArrowDown' || key === 'ArrowLeft') { e.preventDefault(); setValue(current - stepValue * fine, { emit: true, source: 'key' }); }
        else if (key === 'PageUp') { e.preventDefault(); setValue(current + big, { emit: true, source: 'key' }); }
        else if (key === 'PageDown') { e.preventDefault(); setValue(current - big, { emit: true, source: 'key' }); }
        else if (key === 'Home') { e.preventDefault(); setValue(min, { emit: true, source: 'key' }); }
        else if (key === 'End') { e.preventDefault(); setValue(max, { emit: true, source: 'key' }); }
        else if (key === ' ') { e.preventDefault(); }
    }

    // selector open/close

    function openMenu() {
        if (!isSelector || isDisabled || open) return;
        open = true;
        root.dataset.open = 'true';
        body.setAttribute('aria-expanded', 'true');
        itemsWrap.querySelectorAll('.oja-knob-radio').forEach(i => { i.tabIndex = isDisabled ? -1 : 0; });
        const checked = itemsWrap.querySelector('.oja-knob-radio:checked') || itemsWrap.querySelector('.oja-knob-radio');
        checked?.focus();
        const handler = (e) => {
            if (!root.contains(e.target)) closeMenu();
        };
        outsideHandler = handler;
        // defer so the click that opened cannot immediately close it
        setTimeout(() => {
            if (open && outsideHandler === handler) {
                document.addEventListener('pointerdown', handler, true);
            }
        }, 0);
    }

    function closeMenu() {
        if (!isSelector || !open) return;
        open = false;
        root.dataset.open = 'false';
        body.setAttribute('aria-expanded', 'false');
        if (outsideHandler) document.removeEventListener('pointerdown', outsideHandler, true);
        outsideHandler = null;
        itemsWrap.querySelectorAll('.oja-knob-radio').forEach(i => { i.tabIndex = -1; });
        body.focus();
    }

    // wiring

    if (isSelector) {
        on(body, 'click', () => open ? closeMenu() : openMenu());
    } else {
        on(root, 'pointerdown', beginDrag);
        on(root, 'wheel', onWheel, { passive: false });
        on(root, 'keydown', onKeydown);
        on(root, 'dblclick', () => { if (!isDisabled) setValue(defaultValue, { emit: true, source: 'reset' }); });
    }
    if (isSelector) on(root, 'keydown', onKeydown);

    buildItems();
    render();
    setDisabled(isDisabled);

    return {
        el: root,
        get value() { return current; },
        get isOpen() { return open; },
        setValue,
        setDisabled,
        setItems(next) {
            if (!isSelector) {
                console.warn('[oja/knob] setItems() is only available on selector knobs');
                return this;
            }
            selectorItems = (next || []).slice();
            const keep = itemIndex(current);
            if (keep === -1) current = selectorItems[0]?.value;
            buildItems();
            render();
            return this;
        },
        open() { openMenu(); return this; },
        close() { closeMenu(); return this; },
        focus() { (isSelector ? body : root).focus(); return this; },
        destroy() {
            closeMenu();
            for (const fn of cleanups.splice(0)) fn();
            root.remove();
        },
    };
}

export const knob = { create: createKnob };
