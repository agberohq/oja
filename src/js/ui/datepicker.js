/**
 * oja/datepicker.js
 * Date and time picker — pure HTML/CSS, no external dependency.
 * Works with any input[type=text] or input[type=date].
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { datepicker } from '../ui/datepicker.js';
 *
 *   // Attach to an existing input
 *   const dp = datepicker.attach('#expiryDate', {
 *       format:   'YYYY-MM-DD',
 *       onChange: (date, str) => console.log(date, str),
 *   });
 *
 *   dp.getValue();           // → Date object
 *   dp.getFormatted();       // → '2026-04-11'
 *   dp.setValue(new Date()); // programmatic set
 *   dp.clear();
 *   dp.destroy();
 *
 * ─── Date + time ──────────────────────────────────────────────────────────────
 *
 *   datepicker.attach('#scheduledAt', {
 *       format:   'YYYY-MM-DD HH:mm',
 *       showTime: true,
 *       onChange: (date) => schedule(date),
 *   });
 *
 * ─── Range constraints ────────────────────────────────────────────────────────
 *
 *   datepicker.attach('#certExpiry', {
 *       min:    new Date(),              // can't select past
 *       max:    new Date('2030-01-01'),  // can't select beyond
 *   });
 *
 * ─── Options ──────────────────────────────────────────────────────────────────
 *
 *   format   : string    — display format (default: 'YYYY-MM-DD')
 *   showTime : boolean   — include time selector (default: false)
 *   min      : Date      — minimum selectable date
 *   max      : Date      — maximum selectable date
 *   firstDay : 0|1       — first day of week: 0=Sun, 1=Mon (default: 1)
 *   placeholder: string
 *   onChange : fn(date, formattedString)
 *   value    : Date      — initial value
 */

const DAYS_SHORT   = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
let _dpSeq = 0;

const MONTHS_LONG  = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];

function _pad(n) { return String(n).padStart(2, '0'); }

function _format(date, fmt) {
    if (!date) return '';
    const Y = date.getFullYear();
    const M = _pad(date.getMonth() + 1);
    const D = _pad(date.getDate());
    const H = _pad(date.getHours());
    const m = _pad(date.getMinutes());
    return fmt
        .replace('YYYY', Y).replace('MM', M).replace('DD', D)
        .replace('HH', H).replace('mm', m);
}

function _parse(str, fmt) {
    if (!str) return null;
    try {
        const yIdx = fmt.indexOf('YYYY');
        const mIdx = fmt.indexOf('MM');
        const dIdx = fmt.indexOf('DD');
        const hIdx = fmt.indexOf('HH');
        const minIdx = fmt.indexOf('mm');
        const y  = yIdx  >= 0 ? parseInt(str.slice(yIdx,  yIdx + 4)) : new Date().getFullYear();
        const mo = mIdx  >= 0 ? parseInt(str.slice(mIdx,  mIdx + 2)) - 1 : 0;
        const d  = dIdx  >= 0 ? parseInt(str.slice(dIdx,  dIdx + 2)) : 1;
        const h  = hIdx  >= 0 ? parseInt(str.slice(hIdx,  hIdx + 2)) : 0;
        const mi = minIdx >= 0 ? parseInt(str.slice(minIdx, minIdx + 2)) : 0;
        const dt = new Date(y, mo, d, h, mi);
        return isNaN(dt.getTime()) ? null : dt;
    } catch { return null; }
}

export const datepicker = {
    /**
     * @param {string|Element} target
     * @param {Object} opts
     * @returns {datepickerHandle}
     */
    attach(target, opts = {}) {
        const input = typeof target === 'string' ? document.querySelector(target) : target;
        if (!input) { console.warn('[oja/datepicker] target not found:', target); return null; }

        const {
            format      = 'YYYY-MM-DD',
            showTime    = format.includes('HH'),
            min         = null,
            max         = null,
            firstDay    = 1,
            placeholder = format,
            onChange    = null,
            value: initValue = null,
            ariaLabel   = 'Choose date',
            classes     = {},
        } = opts;

        const _cls = (base, key) => [base, classes[key]].filter(Boolean).join(' ');

        input.setAttribute('placeholder', placeholder);
        const popupId = `oja-dp-${++_dpSeq}`;
        input.setAttribute('readonly', true);
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-haspopup', 'dialog');
        input.setAttribute('aria-controls', popupId);
        input.setAttribute('aria-expanded', 'false');
        input.style.cursor = 'pointer';

        // Wrap input
        const wrap = document.createElement('div');
        wrap.className = _cls('oja-dp-wrap', 'wrap');
        input.insertAdjacentElement('beforebegin', wrap);
        wrap.appendChild(input);

        // State
        let _value    = initValue || _parse(input.value, format) || null;
        let _view     = _value ? new Date(_value) : new Date();
        let _popup    = null;
        let _open     = false;
        let _timeH    = _value ? _value.getHours() : 0;
        let _timeM    = _value ? _value.getMinutes() : 0;

        function _isDisabled(d) {
            if (min && d < new Date(min.getFullYear(), min.getMonth(), min.getDate())) return true;
            if (max && d > new Date(max.getFullYear(), max.getMonth(), max.getDate())) return true;
            return false;
        }

        function _syncInput() {
            input.value = _value ? _format(_value, format) : '';
        }

        // Popup rendering

        function _buildPopup() {
            const pop = document.createElement('div');
            pop.className = _cls('oja-dp-popup', 'popup');
            pop.id = popupId;
            pop.setAttribute('role', 'dialog');
            pop.setAttribute('aria-label', ariaLabel);

            // Nav
            const nav = document.createElement('div');
            nav.className = _cls('oja-dp-nav', 'nav');

            const prevBtn = document.createElement('button');
            prevBtn.type = 'button'; prevBtn.className = _cls('oja-dp-nav-btn', 'navButton');
            prevBtn.innerHTML = '&#8249;'; prevBtn.title = 'Previous month';
            prevBtn.setAttribute('aria-label', 'Previous month');
            prevBtn.addEventListener('click', () => {
                _view.setMonth(_view.getMonth() - 1);
                _rebuildCalendar(pop);
            });

            const heading = document.createElement('span');
            heading.className = _cls('oja-dp-heading', 'heading');
            heading.textContent = `${MONTHS_LONG[_view.getMonth()]} ${_view.getFullYear()}`;

            const nextBtn = document.createElement('button');
            nextBtn.type = 'button'; nextBtn.className = _cls('oja-dp-nav-btn', 'navButton');
            nextBtn.innerHTML = '&#8250;'; nextBtn.title = 'Next month';
            nextBtn.setAttribute('aria-label', 'Next month');
            nextBtn.addEventListener('click', () => {
                _view.setMonth(_view.getMonth() + 1);
                _rebuildCalendar(pop);
            });

            nav.appendChild(prevBtn);
            nav.appendChild(heading);
            nav.appendChild(nextBtn);
            pop.appendChild(nav);

            // Grid placeholder (filled by _rebuildCalendar)
            const grid = document.createElement('div');
            grid.className = _cls('oja-dp-grid', 'grid');
            grid.id = 'oja-dp-grid';
            grid.setAttribute('role', 'grid');

            // Day-of-week headers
            const days = [...DAYS_SHORT.slice(firstDay), ...DAYS_SHORT.slice(0, firstDay)];
            days.forEach(d => {
                const el = document.createElement('div');
                el.className = _cls('oja-dp-dow', 'dow'); el.textContent = d;
                grid.appendChild(el);
            });
            grid.addEventListener('keydown', _onGridKeydown);
            pop.appendChild(grid);

            // Time picker
            if (showTime) {
                const timePick = document.createElement('div');
                timePick.className = _cls('oja-dp-time', 'time');
                const hInput = document.createElement('input');
                hInput.type = 'number'; hInput.min = 0; hInput.max = 23;
                hInput.value = _pad(_timeH); hInput.className = _cls('oja-dp-h', 'timeInput');
                const sep = document.createElement('span');
                sep.className = 'oja-dp-time-sep'; sep.textContent = ':';
                const mInput = document.createElement('input');
                mInput.type = 'number'; mInput.min = 0; mInput.max = 59;
                mInput.value = _pad(_timeM); mInput.className = _cls('oja-dp-m', 'timeInput');
                hInput.addEventListener('change', () => { _timeH = parseInt(hInput.value) || 0; hInput.value = _pad(_timeH); });
                mInput.addEventListener('change', () => { _timeM = parseInt(mInput.value) || 0; mInput.value = _pad(_timeM); });
                timePick.appendChild(hInput); timePick.appendChild(sep); timePick.appendChild(mInput);
                pop.appendChild(timePick);
            }

            // Footer
            const footer = document.createElement('div');
            footer.className = _cls('oja-dp-footer', 'footer');
            const clearBtn = document.createElement('button');
            clearBtn.type = 'button'; clearBtn.className = _cls('oja-dp-btn', 'button');
            clearBtn.textContent = 'Clear';
            clearBtn.addEventListener('click', () => { handle.clear(); handle.close(); });
            const todayBtn = document.createElement('button');
            todayBtn.type = 'button'; todayBtn.className = _cls('oja-dp-btn', 'button');
            todayBtn.textContent = 'Today';
            todayBtn.addEventListener('click', () => {
                const t = new Date(); t.setHours(_timeH, _timeM, 0, 0);
                _pickDate(t); handle.close();
            });
            const okBtn = document.createElement('button');
            okBtn.type = 'button'; okBtn.textContent = 'OK';
            okBtn.className = _cls('oja-dp-btn primary', 'ok');
            okBtn.addEventListener('click', () => {
                if (_value) {
                    _value.setHours(_timeH, _timeM, 0, 0);
                    _syncInput();
                    onChange?.(_value, _format(_value, format));
                }
                handle.close();
            });
            footer.appendChild(clearBtn); footer.appendChild(todayBtn); footer.appendChild(okBtn);
            pop.appendChild(footer);

            _rebuildCalendar(pop);
            return pop;
        }

        function _rebuildCalendar(pop) {
            // Update heading
            const heading = pop.querySelector('.oja-dp-heading');
            if (heading) heading.textContent = `${MONTHS_LONG[_view.getMonth()]} ${_view.getFullYear()}`;

            // Remove old day cells (keep DOW headers = 7 items)
            const grid = pop.querySelector('.oja-dp-grid');
            if (!grid) return;
            const existing = grid.querySelectorAll('.oja-dp-day');
            existing.forEach(e => e.remove());

            const today = new Date();
            const year  = _view.getFullYear();
            const month = _view.getMonth();

            // First day of month, adjusted for firstDay of week
            const first = new Date(year, month, 1);
            let startDow = (first.getDay() - firstDay + 7) % 7;

            // Days from previous month
            for (let i = 0; i < startDow; i++) {
                const d = new Date(year, month, -startDow + 1 + i);
                grid.appendChild(_dayEl(d, true));
            }

            // Days of this month
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            for (let i = 1; i <= daysInMonth; i++) {
                const d = new Date(year, month, i);
                grid.appendChild(_dayEl(d, false));
            }

            // Fill remaining cells
            const total = startDow + daysInMonth;
            const remaining = total % 7 === 0 ? 0 : 7 - (total % 7);
            for (let i = 1; i <= remaining; i++) {
                const d = new Date(year, month + 1, i);
                grid.appendChild(_dayEl(d, true));
            }

            // Roving tabindex: one day is reachable by Tab, arrows move within.
            const days = grid.querySelectorAll('.oja-dp-day');
            const selectedEl = grid.querySelector('.oja-dp-day.selected');
            const focusEl = selectedEl || days[0];
            if (focusEl) focusEl.tabIndex = 0;
        }

        function _dayEl(date, otherMonth) {
            const el    = document.createElement('div');
            el.className = _cls('oja-dp-day', 'day');
            el.textContent = date.getDate();

            const today = new Date();
            if (date.toDateString() === today.toDateString()) el.classList.add('today');
            if (otherMonth) el.classList.add('other-month');
            const disabled = _isDisabled(date);
            if (disabled) el.classList.add('disabled');
            const selected = !!( _value && date.toDateString() === _value.toDateString());
            if (selected) el.classList.add('selected');

            el.setAttribute('role', 'gridcell');
            el.setAttribute('aria-selected', String(selected));
            el.setAttribute('aria-label', date.toDateString());
            el.dataset.date = _format(date, 'YYYY-MM-DD');
            el.tabIndex = selected ? 0 : -1;
            if (disabled) el.setAttribute('aria-disabled', 'true');

            el.addEventListener('click', () => {
                el.focus({ preventScroll: true });
                _pickDate(date);
            });
            return el;
        }

        function _dateFromDay(el) {
            const [y, m, d] = String(el?.dataset?.date || '').split('-').map(Number);
            return (y && m && d) ? new Date(y, m - 1, d) : null;
        }

        function _focusDay(date) {
            if (!_popup) return;
            let el = _popup.querySelector(`.oja-dp-day[data-date="${_format(date, 'YYYY-MM-DD')}"]`);
            if (!el) {
                _view = new Date(date.getFullYear(), date.getMonth(), 1);
                _rebuildCalendar(_popup);
                el = _popup.querySelector(`.oja-dp-day[data-date="${_format(date, 'YYYY-MM-DD')}"]`);
            }
            if (!el) return;
            _popup.querySelectorAll('.oja-dp-day').forEach(d => { d.tabIndex = -1; });
            el.tabIndex = 0;
            el.focus({ preventScroll: true });
        }

        function _onGridKeydown(e) {
            const day = e.target?.closest?.('.oja-dp-day');
            if (!day) return;
            const date = _dateFromDay(day);
            if (!date) return;
            let next = null;

            if (e.key === 'ArrowLeft')       next = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
            else if (e.key === 'ArrowRight') next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
            else if (e.key === 'ArrowUp')    next = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 7);
            else if (e.key === 'ArrowDown')  next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7);
            else if (e.key === 'PageUp')     next = new Date(date.getFullYear(), date.getMonth() - 1, date.getDate());
            else if (e.key === 'PageDown')   next = new Date(date.getFullYear(), date.getMonth() + 1, date.getDate());
            else if (e.key === 'Home')       next = new Date(date.getFullYear(), date.getMonth(), 1);
            else if (e.key === 'End')        next = new Date(date.getFullYear(), date.getMonth() + 1, 0);
            else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                _pickDate(date);
                return;
            } else if (e.key === 'Escape') {
                e.preventDefault();
                handle.close();
                input.focus();
                return;
            } else {
                return;
            }

            e.preventDefault();
            _view = new Date(next.getFullYear(), next.getMonth(), 1);
            _rebuildCalendar(_popup);
            _focusDay(next);
        }

        function _pickDate(date) {
            if (_isDisabled(date)) return;
            _value = new Date(date.getFullYear(), date.getMonth(), date.getDate(), _timeH, _timeM);
            _view  = new Date(_value);
            _syncInput();
            if (!showTime) {
                onChange?.(_value, _format(_value, format));
                handle.close();
            } else {
                _rebuildCalendar(_popup);
            }
        }

        // Open / close

        const handle = {
            open() {
                if (_open) return;
                _open = true;
                input.setAttribute('aria-expanded', 'true');
                _popup = _buildPopup();
                wrap.appendChild(_popup);
                setTimeout(() => {
                    document.addEventListener('mousedown', _outside, { capture: true });
                    const anchor = _value ? new Date(_value) : new Date();
                    _focusDay(anchor);
                }, 0);
            },
            close() {
                if (!_open) return;
                _open = false;
                input.setAttribute('aria-expanded', 'false');
                _popup?.remove(); _popup = null;
                document.removeEventListener('mousedown', _outside, { capture: true });
            },
            getValue()      { return _value ? new Date(_value) : null; },
            getFormatted()  { return _value ? _format(_value, format) : ''; },
            setValue(date)  {
                _value = date ? new Date(date) : null;
                if (_value) { _timeH = _value.getHours(); _timeM = _value.getMinutes(); }
                _view  = _value ? new Date(_value) : new Date();
                _syncInput();
            },
            clear()  { _value = null; _syncInput(); onChange?.(null, ''); },
            destroy() {
                handle.close();
                // Unwrap
                wrap.insertAdjacentElement('beforebegin', input);
                wrap.remove();
                input.removeAttribute('readonly');
            },
        };

        function _outside(e) { if (!wrap.contains(e.target)) handle.close(); }

        input.addEventListener('click', () => _open ? handle.close() : handle.open());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
                e.preventDefault();
                handle.open();
            } else if (e.key === 'Escape') handle.close();
        });

        _syncInput();
        return handle;
    },
};
