/**
 * oja/form.js
 * Form lifecycle — submit, validation, error display, reset, and image upload.
 * No schema. No magic. HTML stays pure.
 *
 * ─── Basic form ───────────────────────────────────────────────────────────────
 *
 *   import { form } from '../oja/form.js';
 *
 *   form.on('#loginForm', {
 *       submit:  async (data) => api.post('/login', data),
 *       success: (res)  => router.navigate('/dashboard'),
 *       error:   (err)  => form.showError('#loginForm', 'password', err.message)
 *   });
 *
 * ─── Validation ───────────────────────────────────────────────────────────────
 *
 *   // form.validate() checks fields against rules before the API call.
 *   // A rule returns true if valid, or an error string if invalid.
 *   // Async rules are supported (e.g. checking if a username is taken).
 *   // Returns true if all pass, false if any fail (errors shown inline).
 *
 *   form.on('#firewallForm', {
 *       submit: async (data) => {
 *           const ok = await form.validate('#firewallForm', {
 *               ip:     (v) => /^\d+\.\d+\.\d+\.\d+(\/\d+)?$/.test(v) || 'Invalid IP or CIDR',
 *               reason: (v) => v.length >= 5 || 'Reason must be at least 5 characters',
 *           });
 *           if (!ok) return;
 *           return api.post('/api/firewall', data);
 *       },
 *       success: () => notify.success('Rule added'),
 *       error:   (err) => notify.error(err.message),
 *   });
 *
 *   // Or call standalone — useful when you need to validate on blur
 *   const ok = await form.validate('#myForm', rules);
 *
 * ─── Dirty tracking ───────────────────────────────────────────────────────────
 *
 *   // Track which fields have been modified
 *   form.dirty('#myForm', (fieldName, isDirty) => {
 *       if (isDirty) highlightField(fieldName);
 *   });
 *
 *   // Check if form or specific field is dirty
 *   form.isDirty('#myForm');           // → true/false
 *   form.isDirty('#myForm', 'email');  // → true/false
 *
 *   // Reset dirty state
 *   form.resetDirty('#myForm');
 *
 * ─── Field-level validation ───────────────────────────────────────────────────
 *
 *   // Validate on blur or input
 *   form.watch('#email', {
 *       onBlur: async (value) => {
 *           const taken = await checkEmail(value);
 *           return taken ? 'Email already taken' : true;
 *       },
 *       onInput: debounce((value) => {
 *           return value.includes('@') || 'Invalid email format';
 *       }, 300)
 *   });
 *
 * ─── Rich text areas ──────────────────────────────────────────────────────────
 *
 *   // Simple rich text with toolbar
 *   form.editor('#content', {
 *       placeholder: 'Write your content...',
 *       maxLength: 5000,
 *       toolbar: ['bold', 'italic', 'link', 'list'],
 *       onChange: (html, text) => console.log('Content changed', { html, text })
 *   });
 *
 *   // Read-only mode
 *   form.editor('#preview', { readonly: true });
 *
 *   // Get/set content programmatically
 *   const editor = form.editor('#content');
 *   editor.setContent('<p>New content</p>');
 *   const html = editor.getContent();
 *   const text = editor.getText();
 *
 * ─── Select, radio, checkbox ─────────────────────────────────────────────────
 *
 *   // Select with options
 *   form.select('#region', {
 *       options:[
 *           { value: 'us', label: 'United States' },
 *           { value: 'eu', label: 'Europe' },
 *           { value: 'asia', label: 'Asia' }
 *       ],
 *       onChange: (value) => loadRegionData(value)
 *   });
 *
 *   // Radio group
 *   form.radio('[name="plan"]', {
 *       onChange: (value) => updatePricing(value)
 *   });
 *
 *   // Checkbox with indeterminate state
 *   form.checkbox('#select-all', {
 *       indeterminate: true,
 *       onChange: (checked) => toggleAll(checked)
 *   });
 *
 * ─── Textarea with character count ────────────────────────────────────────────
 *
 *   form.textarea('#description', {
 *       maxLength: 500,
 *       showCount: true,
 *       counter: '#desc-counter',
 *       onExceed: (exceeded) => warnUser(exceeded)
 *   });
 *
 * ─── HTML (pure — no special attributes needed) ───────────────────────────────
 *
 *   <form id="loginForm">
 *       <input name="username" required>
 *       <input name="password" type="password" required>
 *       <span class="field-error" data-field="password"></span>
 *       <button type="submit">Sign In</button>
 *   </form>
 *
 * ─── Image upload + preview ───────────────────────────────────────────────────
 *
 *   // Wire in one line — preview updates instantly on file select
 *   form.image('#avatarInput', '#avatarPreview');
 *
 *   // With options
 *   form.image('#avatarInput', '#avatarPreview', {
 *       maxSizeMb  : 2,
 *       accept     : ['image/jpeg', 'image/png'],
 *       onError    : (err) => notify.error(err),
 *       onSelect   : (file, dataUrl) => console.log('selected', file.name),
 *   });
 *
 *   // Multiple images
 *   form.images('#galleryInput', '#galleryPreview', {
 *       max      : 5,
 *       onSelect : (files) => console.log(files.length, 'files selected'),
 *   });
 *
 * ─── File upload with progress ────────────────────────────────────────────────
 *
 *   form.upload('#uploadForm', {
 *       url      : '/api/upload',
 *       progress : (pct) => updateBar(pct),
 *       success  : (res) => notify.success('Uploaded'),
 *       error    : (err) => notify.error(err.message),
 *   });
 */

import { Out }          from '../core/out.js';
import { autocomplete } from './autocomplete.js';

const _dirtyState = new WeakMap(); // form -> Map<fieldName, { original, current, isDirty }>
const _dirtyListeners = new WeakMap(); // form -> Set<function>
const _fieldWatchers = new WeakMap(); // field -> Set<{ type, fn, debounced }>
const _editorInstances = new Map(); // field -> editor instance — must be Map, not WeakMap, because collect() iterates it

export const form = {

    /**
     * Wire a form's full submit lifecycle.
     * Automatically: collects values, disables submit, calls handler, re-enables.
     *
     *   form.on('#loginForm', {
     *       submit  : async (data) => api.post('/login', data),
     *       success : (res) => router.navigate('/dashboard'),
     *       error   : (err) => form.showError('#loginForm', 'password', err.message)
     *   });
     */
    on(target, handlers = {}) {
        const el = _resolve(target);
        if (!el) return;

        el.addEventListener('submit', async (e) => {
            e.preventDefault();
            form.clearErrors(el);

            const data = form.collect(el);
            form.disable(el);

            try {
                const res = await handlers.submit(data);
                if (handlers.success) handlers.success(res);
                form.resetDirty(el);
            } catch (err) {
                if (handlers.error) handlers.error(err);
                else console.error('[oja/form] unhandled error:', err);
            } finally {
                form.enable(el);
            }
        });

        this._setupDirtyTracking(el);
        return this;
    },

    /**
     * Collect all named field values as a plain object.
     * Checkboxes → boolean. Radio → value. Multi-selects → array. Numbers → number.
     * Files → FileList. Rich text → HTML string.
     */
    collect(target) {
        const el = _resolve(target);
        const data = {};
        if (!el) return data;

        const formData = new FormData(el);

        // First pass: collect all FormData entries
        formData.forEach((value, key) => {
            this._setValue(data, key, value);
        });

        // Loop inputs directly to extract masked values where applicable
        el.querySelectorAll('input[data-oja-raw-value]').forEach(inp => {
            if (inp.name && inp.name in data) {
                data[inp.name] = inp.dataset.ojaRawValue;
            }
        });

        // Handle checkboxes — unchecked ones don't appear in FormData.
        // We need to distinguish two cases:
        // Single checkbox (name is unique): collect as boolean
        // Checkbox group (multiple share same name): collect as array of
        //      checked values, e.g. <input type="checkbox" name="roles" value="admin">
        const checkboxGroups = new Map(); // name → [{ el, value }]
        el.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            if (!checkboxGroups.has(cb.name)) checkboxGroups.set(cb.name,[]);
            checkboxGroups.get(cb.name).push(cb);
        });

        for (const [name, boxes] of checkboxGroups) {
            if (boxes.length === 1) {
                // Single checkbox — boolean
                data[name] = boxes[0].checked;
            } else {
                // Checkbox group — array of checked values
                data[name] = boxes
                    .filter(cb => cb.checked)
                    .map(cb => cb.value);
            }
        }

        // Handle radio groups
        el.querySelectorAll('input[type="radio"]').forEach(radio => {
            if (radio.checked) {
                data[radio.name] = radio.value;
            } else if (!(radio.name in data)) {
                data[radio.name] = null;
            }
        });

        // Handle number inputs (that are not masked)
        el.querySelectorAll('input[type="number"]').forEach(inp => {
            if (inp.name in data && !inp.hasAttribute('data-oja-raw-value')) {
                data[inp.name] = inp.value === '' ? null : Number(data[inp.name]);
            }
        });

        // Handle rich text editors
        for (const[field, editor] of _editorInstances) {
            if (field.form === el || el.contains(field)) {
                data[field.name] = editor.getContent();
            }
        }

        // Handle file inputs
        el.querySelectorAll('input[type="file"]').forEach(file => {
            if (file.name) {
                data[file.name] = file.files;
            }
        });

        return data;
    },

    _setValue(obj, key, value) {
        if (key in obj) {
            if (!Array.isArray(obj[key])) {
                obj[key] = [obj[key]];
            }
            obj[key].push(value);
        } else {
            obj[key] = value;
        }
    },

    /**
     * Validate form fields against a rules object.
     * Each rule is a function: (value) => true | 'error message'
     * Async rules are supported — useful for server-side checks.
     * Returns true if all rules pass, false if any fail.
     * Errors are shown inline using showError() — clears previous errors first.
     *
     *   const ok = await form.validate('#firewallForm', {
     *       ip:     (v) => v.includes('.') || 'Invalid IP address',
     *       reason: (v) => v.length >= 5   || 'Reason too short',
     *       username: async (v) => {
     *           const taken = await api.get(`/check-username?v=${v}`);
     *           return !taken || 'Username already taken';
     *       },
     *   });
     */
    async validate(target, rules = {}) {
        const el = _resolve(target);
        if (!el) return false;

        form.clearErrors(el);

        let valid = true;

        for (const [field, ruleFn] of Object.entries(rules)) {
            let value;
            const input = el.querySelector(`[name="${field}"]`);
            const editor = _editorInstances.get(input);

            if (editor) {
                value = editor.getContent();
            } else if (input) {
                if (input.dataset.ojaRawValue !== undefined) {
                    value = input.dataset.ojaRawValue;
                } else if (input.type === 'checkbox') {
                    value = input.checked;
                } else if (input.type === 'radio') {
                    const checked = el.querySelector(`[name="${field}"]:checked`);
                    value = checked ? checked.value : null;
                } else if (input.type === 'file') {
                    value = input.files;
                } else {
                    value = input.value;
                }
            } else {
                value = '';
            }

            try {
                const result = await Promise.resolve(ruleFn(value));
                if (result !== true) {
                    const message = typeof result === 'string' ? result : 'Invalid value';
                    form.showError(el, field, message);
                    valid = false;
                }
            } catch (e) {
                form.showError(el, field, e.message || 'Validation error');
                valid = false;
            }
        }

        return valid;
    },

    // Rich text editor

    /**
     * Initialize a rich text editor on a contenteditable element.
     *
     *   form.editor('#content', {
     *       placeholder: 'Write your content...',
     *       maxLength: 5000,
     *       toolbar:['bold', 'italic', 'link', 'list'],
     *       onChange: (html, text) => console.log('Changed', { html, text })
     *   });
     *
     *   // Returns editor API
     *   const editor = form.editor('#content');
     *   editor.setContent('<p>Hello</p>');
     *   editor.getContent(); // → '<p>Hello</p>'
     *   editor.getText();    // → 'Hello'
     */
    editor(target, options = {}) {
        const el = _resolve(target);
        if (!el) return null;

        if (_editorInstances.has(el)) {
            return _editorInstances.get(el);
        }

        const {
            placeholder = '',
            maxLength = Infinity,
            readonly = false,
            toolbar =[],
            onChange = null,
            onBlur = null,
            onFocus = null
        } = options;

        if (!el.isContentEditable && el.tagName !== 'TEXTAREA') {
            el.setAttribute('contenteditable', !readonly);
        }

        if (placeholder && !el.getAttribute('placeholder')) {
            el.setAttribute('placeholder', placeholder);
            this._setupPlaceholder(el, placeholder);
        }

        if (maxLength < Infinity) {
            el.setAttribute('maxlength', maxLength);
            this._setupMaxLength(el, maxLength);
        }

        if (toolbar.length > 0) {
            this._setupToolbar(el, toolbar);
        }

        const editor = {
            getContent: () => el.isContentEditable ? el.innerHTML : el.value,
            getText: () => el.isContentEditable ? el.innerText : el.value,
            setContent: (html) => {
                if (el.isContentEditable) {
                    el.innerHTML = html;
                } else {
                    el.value = html;
                }
                this._triggerChange(el);
            },
            focus: () => el.focus(),
            blur: () => el.blur(),
            clear: () => {
                if (el.isContentEditable) {
                    el.innerHTML = '';
                } else {
                    el.value = '';
                }
                this._triggerChange(el);
            }
        };

        const handlers = {
            input: () => {
                if (maxLength < Infinity) {
                    const content = el.isContentEditable ? el.innerText : el.value;
                    if (content.length > maxLength) {
                        if (el.isContentEditable) {
                            el.innerText = content.slice(0, maxLength);
                        } else {
                            el.value = content.slice(0, maxLength);
                        }
                    }
                }
                if (onChange) {
                    onChange(editor.getContent(), editor.getText());
                }
                this._updateDirtyState(el);
            },
            blur: () => {
                if (onBlur) onBlur(editor.getContent());
            },
            focus: () => {
                if (onFocus) onFocus(editor.getContent());
            }
        };

        el.addEventListener('input', handlers.input);
        el.addEventListener('blur', handlers.blur);
        el.addEventListener('focus', handlers.focus);

        editor.destroy = () => {
            el.removeEventListener('input', handlers.input);
            el.removeEventListener('blur', handlers.blur);
            el.removeEventListener('focus', handlers.focus);
            _editorInstances.delete(el);
        };

        _editorInstances.set(el, editor);
        return editor;
    },

    _setupPlaceholder(el, placeholder) {
        const handler = () => {
            if (el.isContentEditable) {
                if (el.innerText.trim() === '') {
                    el.classList.add('placeholder');
                    el.setAttribute('data-placeholder', placeholder);
                } else {
                    el.classList.remove('placeholder');
                    el.removeAttribute('data-placeholder');
                }
            }
        };
        el.addEventListener('input', handler);
        el.addEventListener('blur', handler);
        handler();
    },

    _setupMaxLength(el, maxLength) {
        const handler = (e) => {
            const content = el.isContentEditable ? el.innerText : el.value;
            if (content.length >= maxLength && e.key !== 'Backspace' && e.key !== 'Delete') {
                e.preventDefault();
                return false;
            }
        };
        el.addEventListener('keydown', handler);
    },

    _setupToolbar(el, toolbar) {
        const toolbarId = `toolbar-${Math.random().toString(36).slice(2)}`;
        const toolbarEl = document.createElement('div');
        toolbarEl.className = 'oja-editor-toolbar';
        toolbarEl.id = toolbarId;

        const buttons = {
            bold: { cmd: 'bold', icon: 'B' },
            italic: { cmd: 'italic', icon: 'I' },
            underline: { cmd: 'underline', icon: 'U' },
            link: {
                cmd: 'createLink',
                icon: '🔗',
                prompt: true,
                value: 'https://'
            },
            list: { cmd: 'insertUnorderedList', icon: '•' },
            ol: { cmd: 'insertOrderedList', icon: '1.' }
        };

        toolbar.forEach(item => {
            const btn = buttons[item];
            if (!btn) return;

            const button = document.createElement('button');
            button.type = 'button';
            button.innerHTML = btn.icon;
            button.setAttribute('aria-label', item);
            button.addEventListener('click', (e) => {
                e.preventDefault();
                el.focus();
                if (btn.prompt) {
                    const url = prompt('Enter URL:', btn.value);
                    if (url) document.execCommand(btn.cmd, false, url);
                } else {
                    document.execCommand(btn.cmd);
                }
                el.dispatchEvent(new Event('input'));
            });
            toolbarEl.appendChild(button);
        });

        el.parentNode.insertBefore(toolbarEl, el);
        el.setAttribute('aria-describedby', toolbarId);
    },

    // Select dropdown

    /**
     * Enhance a select element with options and change handler.
     *
     *   form.select('#region', {
     *       options:[
     *           { value: 'us', label: 'United States' },
     *           { value: 'eu', label: 'Europe' }
     *       ],
     *       onChange: (value) => loadData(value)
     *   });
     */
    select(target, options = {}) {
        const el = _resolve(target);
        if (!el || el.tagName !== 'SELECT') return this;

        const {
            options: optionList =[],
            onChange = null,
            placeholder = null
        } = options;

        if (optionList.length > 0) {
            el.innerHTML = '';

            if (placeholder) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.textContent = placeholder;
                opt.disabled = true;
                opt.selected = !el.value;
                el.appendChild(opt);
            }

            optionList.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                if (opt.disabled) option.disabled = true;
                if (opt.selected) option.selected = true;
                el.appendChild(option);
            });
        }

        if (onChange) {
            el.addEventListener('change', (e) => {
                onChange(e.target.value, e.target);
                this._updateDirtyState(el);
            });
        }

        return this;
    },

    // Radio group

    /**
     * Manage a radio group with change handler.
     *
     *   form.radio('[name="plan"]', {
     *       onChange: (value) => updatePricing(value)
     *   });
     */
    /**
     * Enhance a radio group with change handler, card/button visual style,
     * programmatic get/set, and keyboard navigation.
     *
     *   // Basic — change handler only
     *   form.radio('[name="plan"]', {
     *       onChange: (value) => updatePricing(value)
     *   });
     *
     *   // Card style — wraps each radio in a styled card label
     *   const r = form.radio('[name="plan"]', {
     *       style: 'card',    // or 'button' for pill-button toggle
     *       onChange: (value) => updatePricing(value)
     *   });
     *   r.get();         // → current checked value
     *   r.set('pro');    // → programmatically select
     *   r.disable('enterprise'); // → disable specific option
     *   r.enable('enterprise');
     *
     * @param {string|NodeList} target
     * @param {Object} options
     *   style    : 'default' | 'card' | 'button' — visual presentation
     *   onChange : fn(value, el)
     * @returns {{ get, set, disable, enable }}
     */
    radio(target, options = {}) {
        const radios = typeof target === 'string'
            ? [...document.querySelectorAll(target)]
            : [...target];

        if (!radios || radios.length === 0) return { get: () => null, set: () => {}, disable: () => {}, enable: () => {} };

        const { onChange = null, style = 'default' } = options;

        // Apply visual style by adding class to the wrapping label
        if (style === 'card' || style === 'button') {
            const cls = style === 'card' ? 'oja-radio-card' : 'oja-radio-btn';
            radios.forEach(radio => {
                const label = radio.closest('label') || radio.parentElement;
                if (label) label.classList.add(cls);
            });
        }

        const _updateStyles = (checkedValue) => {
            if (style === 'default') return;
            const cls = style === 'card' ? 'oja-radio-card--checked' : 'oja-radio-btn--checked';
            radios.forEach(radio => {
                const label = radio.closest('label') || radio.parentElement;
                if (label) label.classList.toggle(cls, radio.value === checkedValue);
            });
        };

        // Init styles for already-checked radio
        const initial = radios.find(r => r.checked);
        if (initial) _updateStyles(initial.value);

        radios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                if (e.target.checked) {
                    _updateStyles(e.target.value);
                    onChange?.(e.target.value, e.target);
                    this._updateDirtyState(radio.form);
                }
            });
        });

        return {
            get: () => radios.find(r => r.checked)?.value ?? null,
            set: (value) => {
                const match = radios.find(r => r.value === value);
                if (match && !match.disabled) {
                    match.checked = true;
                    match.dispatchEvent(new Event('change', { bubbles: true }));
                }
            },
            disable: (value) => { const r = radios.find(r => r.value === value); if (r) { r.disabled = true; const l = r.closest('label') || r.parentElement; l?.classList.add('oja-radio--disabled'); } },
            enable:  (value) => { const r = radios.find(r => r.value === value); if (r) { r.disabled = false; const l = r.closest('label') || r.parentElement; l?.classList.remove('oja-radio--disabled'); } },
        };
    },

    /**
     * Secret / password field with visibility toggle and optional strength meter.
     *
     *   form.secret('#password', {
     *       strength: true,   // show strength meter below field
     *       onStrength: (score, label) => console.log(score, label),
     *   });
     *
     *   form.secret('#apiKey', {
     *       toggleLabel: ['Show key', 'Hide key'],
     *   });
     *
     * Injects a toggle button as the next sibling and optionally a strength bar.
     * Adds class 'oja-secret-wrap' to the parent element for CSS positioning.
     *
     * @param {string|Element} target  — password/text input
     * @param {Object} options
     *   strength      : boolean — show password strength meter (default: false)
     *   toggleLabel   : [showText, hideText] — button labels
     *   onStrength    : fn(score 0-4, label string)
     * @returns {{ show, hide, toggle, strength }}
     */
    secret(target, options = {}) {
        const el = _resolve(target);
        if (!el || (el.type !== 'password' && el.type !== 'text')) return null;

        const {
            strength:     showStrength = false,
            toggleLabel:  [showLabel, hideLabel] = ['Show', 'Hide'],
            onStrength    = null,
        } = options;

        // Wrap parent for relative positioning
        const parent = el.parentElement;
        if (parent) parent.classList.add('oja-secret-wrap');

        // Toggle button
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'oja-secret-toggle';
        btn.setAttribute('aria-label', showLabel);
        btn.textContent = showLabel;

        let visible = false;

        const _toggle = () => {
            visible = !visible;
            el.type = visible ? 'text' : 'password';
            btn.textContent = visible ? hideLabel : showLabel;
            btn.setAttribute('aria-label', visible ? hideLabel : showLabel);
            btn.setAttribute('aria-pressed', String(visible));
        };

        btn.addEventListener('click', _toggle);
        el.insertAdjacentElement('afterend', btn);

        // Strength meter
        let _strengthBar = null;
        let _strengthLabel = null;

        if (showStrength) {
            const wrap = document.createElement('div');
            wrap.className = 'oja-strength';
            _strengthBar   = document.createElement('div');
            _strengthBar.className = 'oja-strength-bar';
            _strengthLabel = document.createElement('span');
            _strengthLabel.className = 'oja-strength-label';
            wrap.appendChild(_strengthBar);
            wrap.appendChild(_strengthLabel);
            btn.insertAdjacentElement('afterend', wrap);

            const _LEVELS = ['', 'Weak', 'Fair', 'Good', 'Strong'];
            const _CLASSES = ['', 'oja-strength--weak', 'oja-strength--fair', 'oja-strength--good', 'oja-strength--strong'];

            const _score = (val) => {
                if (!val) return 0;
                let s = 0;
                if (val.length >= 8)  s++;
                if (val.length >= 12) s++;
                if (/[A-Z]/.test(val) && /[a-z]/.test(val)) s++;
                if (/\d/.test(val)) s++;
                if (/[^A-Za-z0-9]/.test(val)) s++;
                return Math.min(4, s);
            };

            el.addEventListener('input', () => {
                const score = _score(el.value);
                _strengthBar.className = `oja-strength-bar ${_CLASSES[score]}`;
                _strengthBar.style.width = `${score * 25}%`;
                _strengthLabel.textContent = _LEVELS[score];
                onStrength?.(score, _LEVELS[score]);
            });
        }

        return {
            show:   () => { if (!visible) _toggle(); },
            hide:   () => { if (visible) _toggle(); },
            toggle: () => _toggle(),
            score:  () => {
                if (!showStrength) return null;
                const val = el.value;
                let s = 0;
                if (val.length >= 8)  s++;
                if (val.length >= 12) s++;
                if (/[A-Z]/.test(val) && /[a-z]/.test(val)) s++;
                if (/\d/.test(val)) s++;
                if (/[^A-Za-z0-9]/.test(val)) s++;
                return Math.min(4, s);
            },
        };
    },

    // Checkbox

    /**
     * Enhance a checkbox with indeterminate state and change handler.
     *
     *   form.checkbox('#select-all', {
     *       indeterminate: true,
     *       onChange: (checked) => toggleAll(checked)
     *   });
     */
    checkbox(target, options = {}) {
        const el = _resolve(target);
        if (!el || el.type !== 'checkbox') return this;

        const {
            indeterminate = false,
            onChange = null
        } = options;

        el.indeterminate = indeterminate;

        if (onChange) {
            el.addEventListener('change', (e) => {
                onChange(e.target.checked, e.target);
                this._updateDirtyState(el.form);
            });
        }

        return this;
    },

    // Textarea with counter

    /**
     * Enhance a textarea with character count and max length.
     *
     *   form.textarea('#description', {
     *       maxLength: 500,
     *       showCount: true,
     *       counter: '#desc-counter',
     *       onExceed: (exceeded) => warnUser(exceeded)
     *   });
     */
    textarea(target, options = {}) {
        const el = _resolve(target);
        if (!el || el.tagName !== 'TEXTAREA') return this;

        const {
            maxLength = Infinity,
            showCount = false,
            counter = null,
            onExceed = null,
            onChange = null
        } = options;

        if (maxLength < Infinity) {
            el.setAttribute('maxlength', maxLength);
        }

        if (showCount || counter) {
            const counterEl = counter ? _resolve(counter) : (() => {
                const div = document.createElement('div');
                div.className = 'oja-textarea-counter';
                el.parentNode.insertBefore(div, el.nextSibling);
                return div;
            })();

            const updateCounter = () => {
                const length = el.value.length;
                counterEl.textContent = `${length}${maxLength < Infinity ? ` / ${maxLength}` : ''}`;

                if (maxLength < Infinity) {
                    const exceeded = length > maxLength;
                    counterEl.classList.toggle('exceeded', exceeded);
                    if (onExceed) onExceed(exceeded);
                }
            };

            el.addEventListener('input', updateCounter);
            el.addEventListener('change', updateCounter);
            updateCounter();
        }

        if (onChange) {
            el.addEventListener('change', (e) => {
                onChange(e.target.value, e.target);
                this._updateDirtyState(el.form);
            });
        }

        return this;
    },

    // Watch field

    /**
     * Watch a specific field for validation on blur or input.
     *
     *   form.watch('#email', {
     *       onBlur: async (value) => {
     *           const taken = await checkEmail(value);
     *           return taken ? 'Email taken' : true;
     *       },
     *       onInput: debounce((value) => {
     *           return value.includes('@') || 'Invalid format';
     *       }, 300)
     */
    watch(target, handlers = {}) {
        const el = _resolve(target);
        if (!el) return this;

        if (!_fieldWatchers.has(el)) {
            _fieldWatchers.set(el, new Set());
        }

        const watchers = _fieldWatchers.get(el);
        const fieldName = el.name || el.id;
        const formEl = el.form;

        if (handlers.onBlur) {
            const fn = async (e) => {
                const value = this._getFieldValue(el);
                const result = await handlers.onBlur(value);
                if (result !== true && formEl) {
                    const message = typeof result === 'string' ? result : 'Invalid value';
                    form.showError(formEl, fieldName, message);
                } else if (formEl) {
                    form.clearErrors(formEl);
                }
            };
            watchers.add({ type: 'blur', fn });
            el.addEventListener('blur', fn);
        }

        if (handlers.onInput) {
            const fn = async (e) => {
                const value = this._getFieldValue(el);
                const result = await handlers.onInput(value);
                if (result !== true && formEl) {
                    const message = typeof result === 'string' ? result : 'Invalid value';
                    form.showError(formEl, fieldName, message);
                } else if (formEl) {
                    form.clearErrors(formEl);
                }
            };
            watchers.add({ type: 'input', fn });
            el.addEventListener('input', fn);
        }

        return this;
    },

    _getFieldValue(el) {
        if (el.dataset.ojaRawValue !== undefined) return el.dataset.ojaRawValue;
        if (el.type === 'checkbox') return el.checked;
        if (el.type === 'radio') {
            const name = el.name;
            const checked = document.querySelector(`[name="${name}"]:checked`);
            return checked ? checked.value : null;
        }
        if (el.type === 'file') return el.files;
        if (_editorInstances.has(el)) {
            return _editorInstances.get(el).getContent();
        }
        return el.value;
    },

    /**
     * Stop watching a field.
     */
    unwatch(target, type) {
        const el = _resolve(target);
        if (!el || !_fieldWatchers.has(el)) return this;

        const watchers = _fieldWatchers.get(el);
        for (const watcher of watchers) {
            if (!type || watcher.type === type) {
                el.removeEventListener(watcher.type, watcher.fn);
                watchers.delete(watcher);
            }
        }

        if (watchers.size === 0) {
            _fieldWatchers.delete(el);
        }

        return this;
    },

    // Dirty tracking

    /**
     * Enable dirty tracking for a form and listen to changes.
     *
     *   form.dirty('#myForm', (fieldName, isDirty) => {
     *       if (isDirty) highlightField(fieldName);
     *   });
     */
    dirty(target, onChange = null) {
        const el = _resolve(target);
        if (!el || !(el instanceof HTMLFormElement)) {
            console.warn('[oja/form] dirty tracking target must be a form');
            return () => {};
        }

        this._setupDirtyTracking(el);

        if (onChange) {
            if (!_dirtyListeners.has(el)) {
                _dirtyListeners.set(el, new Set());
            }
            _dirtyListeners.get(el).add(onChange);
        }

        // Return an unsubscribe/cleanup function.
        // Call it when the form is dynamically removed to prevent memory leaks
        // from the _dirtyState and _dirtyListeners WeakMaps accumulating
        // entries for destroyed form elements.
        //
        //   const stopTracking = form.dirty('#myForm', handler);
        //   // later, when form is removed:
        //   stopTracking();
        return () => {
            if (onChange) {
                _dirtyListeners.get(el)?.delete(onChange);
            }
            // Call dispose() to remove all DOM event listeners — without this,
            // the input handlers remain attached permanently even after the form
            // is removed from the DOM ("zombie" listeners).
            _dirtyState.get(el)?.dispose?.();
            _dirtyState.delete(el);
            _dirtyListeners.delete(el);
        };
    },

    /**
     * Check if a form or specific field has been modified.
     *
     *   form.isDirty('#myForm');           // → true/false
     *   form.isDirty('#myForm', 'email');  // → true/false
     */
    isDirty(target, fieldName = null) {
        const el = _resolve(target);
        if (!el) return false;

        const formState = _dirtyStateMap(el);
        if (!formState) return false;

        if (fieldName) {
            return formState.get(fieldName)?.isDirty || false;
        }

        for (const [, state] of formState) {
            if (state.isDirty) return true;
        }
        return false;
    },

    /**
     * Reset dirty state for a form or specific field.
     */
    resetDirty(target, fieldName = null) {
        const el = _resolve(target);
        if (!el) return this;

        const formState = _dirtyStateMap(el);
        if (!formState) return this;

        if (fieldName) {
            const field = el.querySelector(`[name="${fieldName}"]`);
            if (field) {
                const original = this._getFieldValue(field);
                formState.set(fieldName, { original, current: original, isDirty: false });
                this._notifyDirty(el, fieldName, false);
            }
        } else {
            for (const[name, input] of this._getFormFields(el)) {
                const original = this._getFieldValue(input);
                formState.set(name, { original, current: original, isDirty: false });
                this._notifyDirty(el, name, false);
            }
        }

        return this;
    },

    _setupDirtyTracking(form) {
        if (_dirtyState.has(form)) return;

        const formState  = new Map();
        const _listeners =[]; // Track every listener so dispose() can remove them

        for (const [name, input] of this._getFormFields(form)) {
            const original = this._getFieldValue(input);
            formState.set(name, { original, current: original, isDirty: false });

            const handler = () => this._updateDirtyState(form);

            // Checkboxes and radios only fire 'change'; text inputs fire both
            // 'input' (immediate) and 'change' (on blur / programmatic change).
            const events = (input.type === 'radio' || input.type === 'checkbox')
                ? ['change']
                : ['input', 'change'];

            for (const evt of events) {
                input.addEventListener(evt, handler);
                _listeners.push({ input, evt, handler });
            }
        }

        // Store both the field state and a dispose function that removes every
        // listener. Without dispose(), destroying a form that was tracked leaves
        // "zombie" handlers attached to every input indefinitely — the browser
        // holds them in memory even if the DOM elements are removed.
        _dirtyState.set(form, {
            state:   formState,
            dispose: () => {
                for (const { input, evt, handler } of _listeners) {
                    input.removeEventListener(evt, handler);
                }
            }
        });
    },

    _updateDirtyState(form) {
        const formState = _dirtyStateMap(form);
        if (!formState) return;

        for (const [name, input] of this._getFormFields(form)) {
            const current = this._getFieldValue(input);
            const state = formState.get(name);

            if (state) {
                const isDirty = this._compareValues(current, state.original);
                if (state.isDirty !== isDirty) {
                    state.isDirty = isDirty;
                    state.current = current;
                    this._notifyDirty(form, name, isDirty);
                }
            }
        }
    },

    _compareValues(a, b) {
        if (a instanceof FileList && b instanceof FileList) {
            if (a.length !== b.length) return true;
            for (let i = 0; i < a.length; i++) {
                if (a[i].name !== b[i].name || a[i].size !== b[i].size) return true;
            }
            return false;
        }
        return a !== b;
    },

    *_getFormFields(form) {
        for (const input of form.elements) {
            if (!input.name || input.disabled) continue;
            if (input.type === 'radio' || input.type === 'checkbox') {
                if (input === form.querySelector(`[name="${input.name}"]`)) {
                    yield[input.name, input];
                }
            } else if (!(input instanceof HTMLButtonElement)) {
                yield [input.name, input];
            }
        }
    },

    _notifyDirty(form, fieldName, isDirty) {
        const listeners = _dirtyListeners.get(form);
        if (!listeners) return;

        for (const fn of listeners) {
            try {
                fn(fieldName, isDirty, form);
            } catch (e) {
                console.warn('[oja/form] dirty listener error:', e);
            }
        }
    },

    _triggerChange(el) {
        if (el.form) {
            this._updateDirtyState(el.form);
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
    },

    // Error display

    /**
     * Show an error message next to a named field.
     * Accepts a plain string or an Out for rich error content.
     * Looks for <span data-field="name"> or <div data-field="name"> inside the form.
     *
     *   form.showError('#loginForm', 'password', 'Invalid credentials');
     *   form.showError('#loginForm', 'email', Out.h('<strong>Email</strong> already in use'));
     */
    showError(target, fieldName, message) {
        const el = _resolve(target);
        if (!el) return;

        const slot = el.querySelector(`[data-field="${fieldName}"]`);
        if (slot) {
            if (Out.is(message)) {
                slot.innerHTML = '';
                message.render(slot);
            } else {
                slot.textContent = message;
            }
            slot.style.display = 'block';
            slot.classList.add('oja-field-error');
        }

        const input = el.querySelector(`[name="${fieldName}"]`);
        if (input) {
            input.classList.add('oja-input-error');
            input.setAttribute('aria-invalid', 'true');
            input.setAttribute('aria-errormessage', slot?.id || '');
        }

        const editor = _editorInstances.get(input);
        if (editor) {
            input.classList.add('oja-input-error');
        }

        return this;
    },

    /** Clear all error messages inside a form. */
    clearErrors(target) {
        const el = _resolve(target);
        if (!el) return;

        el.querySelectorAll('[data-field]').forEach(slot => {
            slot.innerHTML = '';
            slot.style.display = 'none';
            slot.classList.remove('oja-field-error');
        });

        el.querySelectorAll('.oja-input-error').forEach(inp => {
            inp.classList.remove('oja-input-error');
            inp.removeAttribute('aria-invalid');
            inp.removeAttribute('aria-errormessage');
        });

        return this;
    },

    /** Disable all inputs and submit button — called automatically during submit. */
    disable(target) {
        const el = _resolve(target);
        if (!el) return this;

        el.querySelectorAll('input, select, textarea, button, [contenteditable]').forEach(f => {
            f.disabled = true;
            if (f.isContentEditable) {
                f.setAttribute('contenteditable', 'false');
            }
        });

        return this;
    },

    /** Re-enable all inputs — called automatically after submit completes. */
    enable(target) {
        const el = _resolve(target);
        if (!el) return this;

        el.querySelectorAll('input, select, textarea, button, [contenteditable]').forEach(f => {
            f.disabled = false;
            if (f.hasAttribute('contenteditable') && f.getAttribute('contenteditable') === 'false') {
                f.setAttribute('contenteditable', 'true');
            }
        });

        return this;
    },

    /** Reset all fields to default values and clear errors. */
    reset(target) {
        const el = _resolve(target);
        if (!el) return this;

        el.reset();

        for (const [field, editor] of _editorInstances) {
            if (field.form === el) {
                editor.clear();
            }
        }

        form.clearErrors(el);
        form.resetDirty(el);

        return this;
    },

    // Image upload + preview

    /**
     * Wire a file input to an image preview element.
     * Preview updates instantly on file select. No server call needed.
     *
     *   form.image('#avatarInput', '#avatarPreview');
     *
     *   form.image('#avatarInput', '#avatarPreview', {
     *       maxSizeMb : 2,
     *       accept    :['image/jpeg', 'image/png', 'image/webp'],
     *       onError   : (msg) => notify.error(msg),
     *       onSelect  : (file, dataUrl) => { ... },
     *   });
     *
     * HTML:
     *   <input type="file" id="avatarInput" accept="image/*">
     *   <img id="avatarPreview" src="" alt="Preview">
     */
    image(inputSelector, previewSelector, options = {}) {
        const input   = _resolve(inputSelector);
        const preview = _resolve(previewSelector);
        if (!input || !preview) return this;

        const {
            maxSizeMb = 5,
            accept    =['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
            onError   = null,
            onSelect  = null,
        } = options;

        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;

            if (accept.length && !accept.includes(file.type)) {
                const msg = `Invalid file type. Accepted: ${accept.join(', ')}`;
                if (onError) onError(msg);
                else console.warn('[oja/form] ' + msg);
                input.value = '';
                return;
            }

            if (file.size > maxSizeMb * 1024 * 1024) {
                const msg = `File too large. Maximum: ${maxSizeMb}MB`;
                if (onError) onError(msg);
                else console.warn('[oja/form] ' + msg);
                input.value = '';
                return;
            }

            const dataUrl = await _readFile(file);
            preview.src = dataUrl;
            preview.style.display = '';

            if (onSelect) onSelect(file, dataUrl);
            this._updateDirtyState(input.form);
        });

        return this;
    },

    /**
     * Wire a multi-file input to a preview container.
     * Appends <img> elements into the container for each selected file.
     *
     *   form.images('#galleryInput', '#galleryPreview', {
     *       max     : 5,
     *       onSelect: (files) => console.log(files.length, 'selected'),
     *   });
     *
     * HTML:
     *   <input type="file" id="galleryInput" accept="image/*" multiple>
     *   <div id="galleryPreview"></div>
     */
    images(inputSelector, containerSelector, options = {}) {
        const input     = _resolve(inputSelector);
        const container = _resolve(containerSelector);
        if (!input || !container) return this;

        const {
            max       = 10,
            maxSizeMb = 5,
            accept    =['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
            onError   = null,
            onSelect  = null,
        } = options;

        input.addEventListener('change', async () => {
            const files = Array.from(input.files ||[]);
            if (!files.length) return;

            if (files.length > max) {
                const msg = `Too many files. Maximum: ${max}`;
                if (onError) onError(msg);
                return;
            }

            container.innerHTML = '';
            const valid =[];

            for (const file of files) {
                if (accept.length && !accept.includes(file.type)) continue;
                if (file.size > maxSizeMb * 1024 * 1024) continue;

                const dataUrl = await _readFile(file);
                const img     = document.createElement('img');
                img.src              = dataUrl;
                img.style.maxWidth   = '120px';
                img.style.maxHeight  = '120px';
                img.style.objectFit  = 'cover';
                img.dataset.filename = file.name;
                img.setAttribute('alt', `Preview of ${file.name}`);
                container.appendChild(img);
                valid.push(file);
            }

            if (onSelect) onSelect(valid);
            this._updateDirtyState(input.form);
        });

        return this;
    },

    /**
     * serialize() — alias for collect().
     * Returns the same typed plain object: numbers stay numbers, checkboxes
     * become booleans, radio groups return the checked value, files return FileList.
     * The name collect() was chosen because serialize() conventionally implies
     * a string output (like URLSearchParams). Both names work identically.
     *
     *   const data = form.serialize(e.target);  // same as form.collect(e.target)
     */
    serialize(target) {
        return this.collect(target);
    },

    // XHR upload with progress

    /**
     * Upload form files with progress tracking.
     * Uses XMLHttpRequest — the only way to get upload progress in browsers.
     *
     *   form.upload('#uploadForm', {
     *       url      : '/api/upload',
     *       headers  : { 'Authorization': 'Bearer ' + token },
     *       progress : (percent) => updateProgressBar(percent),
     *       success  : (res)     => notify.success('Uploaded'),
     *       error    : (err)     => notify.error(err.message),
     *   });
     */
    upload(target, options = {}) {
        const el = _resolve(target);
        if (!el) return this;

        el.addEventListener('submit', (e) => {
            e.preventDefault();
            form.disable(el);

            const fd  = new FormData(el);
            const xhr = new XMLHttpRequest();

            xhr.open('POST', options.url || el.action || '/upload');

            if (options.headers) {
                for (const [k, v] of Object.entries(options.headers)) {
                    xhr.setRequestHeader(k, v);
                }
            }

            if (options.progress) {
                xhr.upload.addEventListener('progress', (e) => {
                    if (e.lengthComputable) {
                        options.progress(Math.round((e.loaded / e.total) * 100));
                    }
                });
            }

            xhr.addEventListener('load', () => {
                form.enable(el);
                if (xhr.status >= 200 && xhr.status < 300) {
                    let res = xhr.responseText;
                    try { res = JSON.parse(res); } catch {}
                    if (options.success) options.success(res);
                    form.resetDirty(el);
                } else {
                    if (options.error) options.error(new Error(`HTTP ${xhr.status}`));
                }
            });

            xhr.addEventListener('error', () => {
                form.enable(el);
                if (options.error) options.error(new Error('Network error'));
            });

            xhr.addEventListener('abort', () => form.enable(el));

            xhr.send(fd);
            return xhr;
        });

        return this;
    },

    /**
     * Attach an autocomplete widget to an input element.
     * Internally delegates to autocomplete.attach() — no duplicated rendering logic.
     * Returns the { destroy, show, hide } handle from autocomplete.attach().
     *
     *   form.input('#tag-input', { source: trie, limit: 5, onSelect: (item) => setTag(item) });
     *   form.input('#host-search', { source: search, fuzzy: true, onSelect: (r) => fill(r.doc) });
     */
    input(target, options = {}) {
        const el = _resolve(target);
        if (!el) return null;
        return autocomplete.attach(el, options);
    },

    // Slider
    //
    // Reactive range slider with value label. Wraps <input type="range"> with
    // consistent styling and change/input callbacks.
    //
    //   form.slider('#opacity-slider', {
    //       min:      0,
    //       max:      100,
    //       step:     1,
    //       value:    80,
    //       label:    (v) => `${v}%`,    // custom label fn (optional)
    //       onChange: (v) => setOpacity(v / 100),  // fires on change (pointer up)
    //       onInput:  (v) => setOpacity(v / 100),  // fires on every move
    //   });
    //
    slider(target, options = {}) {
        const container = _resolve(target);
        if (!container) return null;

        const {
            min      = 0,
            max      = 100,
            step     = 1,
            value    = 50,
            label    = null,
            onChange = null,
            onInput  = null,
        } = options;

        // Build widget
        const input = document.createElement('input');
        input.type  = 'range';
        input.min   = min;
        input.max   = max;
        input.step  = step;
        input.value = value;
        input.className = 'oja-slider';

        const labelEl = document.createElement('span');
        labelEl.className = 'oja-slider-label';

        const wrap = document.createElement('div');
        wrap.className = 'oja-slider-wrap';
        wrap.appendChild(input);
        wrap.appendChild(labelEl);

        container.innerHTML = '';
        container.appendChild(wrap);

        const updateLabel = (v) => {
            labelEl.textContent = label ? label(v) : String(v);
        };
        updateLabel(Number(value));

        input.addEventListener('input', () => {
            const v = Number(input.value);
            updateLabel(v);
            if (onInput) onInput(v);
        });
        input.addEventListener('change', () => {
            if (onChange) onChange(Number(input.value));
        });

        return {
            getValue: ()  => Number(input.value),
            setValue: (v) => { input.value = v; updateLabel(Number(v)); },
            destroy:  ()  => container.innerHTML = '',
        };
    },

    // Color picker
    //
    // Enhanced color input with swatch palette and optional alpha channel.
    // Falls back gracefully to native <input type="color"> on unsupported browsers.
    //
    //   form.colorPicker('#fill-color', {
    //       value:    '#3b82f6',
    //       alpha:    false,
    //       swatches:['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6'],
    //       onChange: (hex) => setFill(hex),
    //       onInput:  (hex) => previewFill(hex),
    //   });
    //
    colorPicker(target, options = {}) {
        const container = _resolve(target);
        if (!container) return null;

        const {
            value    = '#000000',
            alpha    = false,
            swatches =[],
            onChange = null,
            onInput  = null,
        } = options;

        const input = document.createElement('input');
        input.type  = 'color';
        input.value = value.slice(0, 7); // native color input only takes #rrggbb
        input.className = 'oja-color-input';

        const preview = document.createElement('div');
        preview.className = 'oja-color-preview';
        preview.style.background = value;

        const swatchRow = document.createElement('div');
        swatchRow.className = 'oja-color-swatches';

        swatches.forEach(sw => {
            const btn = document.createElement('button');
            btn.className = 'oja-color-swatch';
            btn.style.background = sw;
            btn.title = sw;
            btn.type  = 'button';
            btn.addEventListener('click', () => {
                input.value       = sw.slice(0, 7);
                preview.style.background = sw;
                if (onChange) onChange(sw);
            });
            swatchRow.appendChild(btn);
        });

        const wrap = document.createElement('div');
        wrap.className = 'oja-color-wrap';
        wrap.appendChild(preview);
        wrap.appendChild(input);
        if (swatches.length) wrap.appendChild(swatchRow);

        // Alpha channel (opacity slider)
        let alphaSlider = null;
        let _alpha = 1;
        if (alpha) {
            alphaSlider = document.createElement('input');
            alphaSlider.type      = 'range';
            alphaSlider.min       = 0;
            alphaSlider.max       = 100;
            alphaSlider.step      = 1;
            alphaSlider.value     = 100;
            alphaSlider.className = 'oja-color-alpha';
            alphaSlider.title     = 'Opacity';
            wrap.appendChild(alphaSlider);
            alphaSlider.addEventListener('input', () => {
                _alpha = Number(alphaSlider.value) / 100;
                preview.style.opacity = _alpha;
                if (onInput) onInput(_currentValue(), _alpha);
            });
        }

        function _currentValue() { return input.value; }

        // Click preview to open native picker
        preview.addEventListener('click', () => input.click());

        input.addEventListener('input', () => {
            preview.style.background = input.value;
            if (onInput) onInput(input.value, _alpha);
        });
        input.addEventListener('change', () => {
            if (onChange) onChange(input.value, _alpha);
        });

        container.innerHTML = '';
        container.appendChild(wrap);

        return {
            getValue:   ()    => ({ color: input.value, alpha: _alpha }),
            setValue:   (hex) => { input.value = hex.slice(0,7); preview.style.background = hex; },
            setAlpha:   (a)   => { _alpha = a; if (alphaSlider) { alphaSlider.value = Math.round(a * 100); preview.style.opacity = a; } },
            destroy:    ()    => container.innerHTML = '',
        };
    },
};

// Unwraps the { state: Map, dispose: fn } entry stored by _setupDirtyTracking.
// Returns the inner Map, or null if the form has not been tracked yet.
function _dirtyStateMap(el) {
    const entry = _dirtyState.get(el);
    if (!entry) return null;
    return entry.state ?? null;
}

function _resolve(target) {
    if (!target) return null;
    if (typeof target === 'string') {
        const el = document.querySelector(target);
        if (!el) console.warn(`[oja/form] element not found: ${target}`);
        return el;
    }
    return target;
}

function _readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = (e) => resolve(e.target.result);
        reader.onerror = ()  => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}
