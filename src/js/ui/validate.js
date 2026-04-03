/**
 * oja/validate.js
 * Common validation rules and utilities.
 * Provides reusable validation functions for forms and data.
 *
 * ─── Basic usage ──────────────────────────────────────────────────────────────
 *
 *   import { validate } from '../oja/validate.js';
 *
 *   // Validate email
 *   if (!validate.email('test@example.com')) {
 *       showError('Invalid email');
 *   }
 *
 *   // Validate with custom message
 *   const result = validate.email('test@example.com', {
 *       message: 'Please enter a valid email address'
 *   });
 *
 * ─── Form integration ─────────────────────────────────────────────────────────
 *
 *   form.on('#signup', {
 *       submit: async (data) => {
 *           const rules = {
 *               email: validate.email(),
 *               password: validate.password({ minLength: 8 }),
 *               age: validate.number({ min: 18, max: 120 }),
 *               website: validate.url({ optional: true }),
 *           };
 *
 *           const errors = validate.all(data, rules);
 *           if (errors) {
 *               showErrors(errors);
 *               return;
 *           }
 *
 *           await api.post('/signup', data);
 *       }
 *   });
 *
 * ─── Available validators ─────────────────────────────────────────────────────
 *
 *   // Strings
 *   validate.required(value, message)
 *   validate.email(value, options)
 *   validate.url(value, options)
 *   validate.uuid(value, version)
 *   validate.regex(value, pattern, message)
 *   validate.minLength(value, min, message)
 *   validate.maxLength(value, max, message)
 *   validate.length(value, min, max, message)
 *   validate.alphanumeric(value, message)
 *
 *   // Numbers
 *   validate.number(value, options)
 *   validate.min(value, min, message)
 *   validate.max(value, max, message)
 *   validate.range(value, min, max, message)
 *   validate.integer(value, message)
 *   validate.positive(value, message)
 *   validate.negative(value, message)
 *
 *   // Dates
 *   validate.date(value, format)
 *   validate.after(value, date, inclusive)
 *   validate.before(value, date, inclusive)
 *   validate.betweenDates(value, start, end)
 *
 *   // Arrays
 *   validate.array(value, message)
 *   validate.minItems(value, min, message)
 *   validate.maxItems(value, max, message)
 *   validate.unique(value, message)
 *
 *   // Objects
 *   validate.object(value, message)
 *   validate.hasKeys(value, keys, message)
 *
 *   // Files
 *   validate.file(value, options)
 *   validate.fileSize(value, maxSize, message)
 *   validate.fileType(value, types, message)
 *   validate.imageDimensions(value, options)
 *
 *   // Custom
 *   validate.custom(value, fn, message)
 *   validate.schema(value, schema)
 *   validate.oneOf(value, list, message)
 *
 * ─── Async validation ─────────────────────────────────────────────────────────
 *
 *   // Check if username is taken
 *   const usernameValid = await validate.async(
 *       username,
 *       async (value) => {
 *           const taken = await api.get(`/check-username/${value}`);
 *           return !taken || 'Username already taken';
 *       }
 *   );
 *
 * ─── Schema validation ────────────────────────────────────────────────────────
 *
 *   const userSchema = {
 *       name: validate.required(),
 *       email: validate.email(),
 *       age: validate.number({ min: 18 }),
 *       address: {
 *           street: validate.required(),
 *           city: validate.required(),
 *           zip: validate.regex(/^\d{5}$/, 'Invalid ZIP'),
 *       },
 *   };
 *
 *   const errors = validate.schema(userData, userSchema);
 *
 * ─── Sanitization ─────────────────────────────────────────────────────────────
 *
 *   // Trim and clean
 *   const clean = validate.sanitize(input, {
 *       trim: true,
 *       escape: true,
 *       lowercase: true,
 *   });
 *
 *   // Remove HTML
 *   const text = validate.stripHtml(html);
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {string} [message]
 * @property {any} [value]
 */

export const validate = {
    // String validators

    /**
     * Check if value is present (not empty)
     */
    required(value, message = 'This field is required') {
        if (value === undefined || value === null || value === '') {
            return { valid: false, message };
        }
        if (typeof value === 'string' && value.trim() === '') {
            return { valid: false, message };
        }
        if (Array.isArray(value) && value.length === 0) {
            return { valid: false, message };
        }
        return { valid: true, value };
    },

    /**
     * Validate email address
     */
    email(value, options = {}) {
        const {
            message = 'Invalid email address',
            allowEmpty = false,
        } = options;

        if (allowEmpty && !value) return { valid: true, value };

        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const valid = regex.test(String(value).toLowerCase());

        return valid
            ? { valid: true, value }
            : { valid: false, message };
    },

    /**
     * Validate URL
     */
    url(value, options = {}) {
        const {
            message = 'Invalid URL',
            allowEmpty = false,
            protocols = ['http:', 'https:'],
        } = options;

        if (allowEmpty && !value) return { valid: true, value };

        try {
            const url = new URL(value);
            const valid = protocols.length === 0 || protocols.includes(url.protocol);
            return valid
                ? { valid: true, value }
                : { valid: false, message };
        } catch {
            return { valid: false, message };
        }
    },

    /**
     * Validate UUID
     */
    uuid(value, version = 4, message = 'Invalid UUID') {
        const patterns = {
            1: /^[0-9A-F]{8}-[0-9A-F]{4}-1[0-9A-F]{3}-[0-9A-F]{4}-[0-9A-F]{12}$/i,
            2: /^[0-9A-F]{8}-[0-9A-F]{4}-2[0-9A-F]{3}-[0-9A-F]{4}-[0-9A-F]{12}$/i,
            3: /^[0-9A-F]{8}-[0-9A-F]{4}-3[0-9A-F]{3}-[0-9A-F]{4}-[0-9A-F]{12}$/i,
            4: /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i,
            5: /^[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i,
        };

        const pattern = patterns[version] || patterns[4];
        const valid = pattern.test(String(value));

        return valid
            ? { valid: true, value }
            : { valid: false, message };
    },

    /**
     * Validate against regex pattern
     */
    regex(value, pattern, message = 'Invalid format') {
        const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
        const valid = regex.test(String(value));

        return valid
            ? { valid: true, value }
            : { valid: false, message };
    },

    /**
     * Minimum length
     */
    minLength(value, min, message = `Must be at least ${min} characters`) {
        const str = String(value || '');
        const valid = str.length >= min;

        return valid
            ? { valid: true, value }
            : { valid: false, message };
    },

    /**
     * Maximum length
     */
    maxLength(value, max, message = `Must be at most ${max} characters`) {
        const str = String(value || '');
        const valid = str.length <= max;

        return valid
            ? { valid: true, value }
            : { valid: false, message };
    },

    /**
     * Length between min and max
     */
    length(value, min, max, message = `Must be between ${min} and ${max} characters`) {
        const str = String(value || '');
        const valid = str.length >= min && str.length <= max;

        return valid
            ? { valid: true, value }
            : { valid: false, message };
    },

    /**
     * Alphanumeric only
     */
    alphanumeric(value, message = 'Only letters and numbers allowed') {
        const valid = /^[a-zA-Z0-9]+$/.test(String(value));

        return valid
            ? { valid: true, value }
            : { valid: false, message };
    },

    // Number validators

    /**
     * Validate number
     */
    number(value, options = {}) {
        const {
            message = 'Must be a number',
            allowEmpty = false,
            min,
            max,
            integer = false,
        } = options;

        if (allowEmpty && (value === undefined || value === null || value === '')) {
            return { valid: true, value };
        }

        const num = Number(value);
        if (isNaN(num)) {
            return { valid: false, message };
        }

        if (integer && !Number.isInteger(num)) {
            return { valid: false, message: 'Must be an integer' };
        }

        if (min !== undefined && num < min) {
            return { valid: false, message: `Must be at least ${min}` };
        }

        if (max !== undefined && num > max) {
            return { valid: false, message: `Must be at most ${max}` };
        }

        return { valid: true, value: num };
    },

    /**
     * Minimum value
     */
    min(value, min, message = `Must be at least ${min}`) {
        const num = Number(value);
        if (isNaN(num)) return { valid: false, message: 'Must be a number' };

        const valid = num >= min;
        return valid
            ? { valid: true, value: num }
            : { valid: false, message };
    },

    /**
     * Maximum value
     */
    max(value, max, message = `Must be at most ${max}`) {
        const num = Number(value);
        if (isNaN(num)) return { valid: false, message: 'Must be a number' };

        const valid = num <= max;
        return valid
            ? { valid: true, value: num }
            : { valid: false, message };
    },

    /**
     * Range between min and max
     */
    range(value, min, max, message = `Must be between ${min} and ${max}`) {
        const num = Number(value);
        if (isNaN(num)) return { valid: false, message: 'Must be a number' };

        const valid = num >= min && num <= max;
        return valid
            ? { valid: true, value: num }
            : { valid: false, message };
    },

    /**
     * Integer value
     */
    integer(value, message = 'Must be an integer') {
        const num = Number(value);
        const valid = Number.isInteger(num);

        return valid
            ? { valid: true, value: num }
            : { valid: false, message };
    },

    /**
     * Positive number
     */
    positive(value, message = 'Must be a positive number') {
        const num = Number(value);
        const valid = !isNaN(num) && num > 0;

        return valid
            ? { valid: true, value: num }
            : { valid: false, message };
    },

    /**
     * Negative number
     */
    negative(value, message = 'Must be a negative number') {
        const num = Number(value);
        const valid = !isNaN(num) && num < 0;

        return valid
            ? { valid: true, value: num }
            : { valid: false, message };
    },

    // Date validators

    /**
     * Validate date
     */
    date(value, options = {}) {
        const {
            message = 'Invalid date',
            allowEmpty = false,
            format = null,
        } = options;

        if (allowEmpty && !value) return { valid: true, value };

        const date = new Date(value);
        const valid = !isNaN(date.getTime());

        if (valid && format) {
            // Format validation would go here
        }

        return valid
            ? { valid: true, value: date }
            : { valid: false, message };
    },

    /**
     * Date after a given date
     */
    after(value, minDate, inclusive = true, message = `Date must be after ${minDate}`) {
        const date = new Date(value);
        const min = new Date(minDate);

        if (isNaN(date.getTime()) || isNaN(min.getTime())) {
            return { valid: false, message: 'Invalid date' };
        }

        const valid = inclusive ? date >= min : date > min;
        return valid
            ? { valid: true, value: date }
            : { valid: false, message };
    },

    /**
     * Date before a given date
     */
    before(value, maxDate, inclusive = true, message = `Date must be before ${maxDate}`) {
        const date = new Date(value);
        const max = new Date(maxDate);

        if (isNaN(date.getTime()) || isNaN(max.getTime())) {
            return { valid: false, message: 'Invalid date' };
        }

        const valid = inclusive ? date <= max : date < max;
        return valid
            ? { valid: true, value: date }
            : { valid: false, message };
    },

    /**
     * Date between two dates
     */
    betweenDates(value, start, end, message = `Date must be between ${start} and ${end}`) {
        const date = new Date(value);
        const startDate = new Date(start);
        const endDate = new Date(end);

        if (isNaN(date.getTime()) || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return { valid: false, message: 'Invalid date' };
        }

        const valid = date >= startDate && date <= endDate;
        return valid
            ? { valid: true, value: date }
            : { valid: false, message };
    },

    // Array validators

    /**
     * Validate array
     */
    array(value, message = 'Must be an array') {
        const valid = Array.isArray(value);
        return valid
            ? { valid: true, value }
            : { valid: false, message };
    },

    /**
     * Minimum array length
     */
    minItems(value, min, message = `Must have at least ${min} items`) {
        if (!Array.isArray(value)) {
            return { valid: false, message: 'Must be an array' };
        }

        const valid = value.length >= min;
        return valid
            ? { valid: true, value }
            : { valid: false, message };
    },

    /**
     * Maximum array length
     */
    maxItems(value, max, message = `Must have at most ${max} items`) {
        if (!Array.isArray(value)) {
            return { valid: false, message: 'Must be an array' };
        }

        const valid = value.length <= max;
        return valid
            ? { valid: true, value }
            : { valid: false, message };
    },

    /**
     * Array has unique values
     */
    unique(value, message = 'Items must be unique') {
        if (!Array.isArray(value)) {
            return { valid: false, message: 'Must be an array' };
        }

        const seen = new Set();
        for (const item of value) {
            const key = JSON.stringify(item);
            if (seen.has(key)) {
                return { valid: false, message };
            }
            seen.add(key);
        }

        return { valid: true, value };
    },

    // Object validators

    /**
     * Validate object
     */
    object(value, message = 'Must be an object') {
        const valid = value !== null && typeof value === 'object' && !Array.isArray(value);
        return valid
            ? { valid: true, value }
            : { valid: false, message };
    },

    /**
     * Object has required keys
     */
    hasKeys(value, keys, message = 'Missing required fields') {
        if (!value || typeof value !== 'object') {
            return { valid: false, message: 'Must be an object' };
        }

        const missing = keys.filter(key => !(key in value));
        if (missing.length > 0) {
            return {
                valid: false,
                message: `Missing fields: ${missing.join(', ')}`,
            };
        }

        return { valid: true, value };
    },

    // File validators

    /**
     * Validate file
     */
    file(value, options = {}) {
        const {
            message = 'Invalid file',
            maxSize,
            types = [],
        } = options;

        if (!(value instanceof File)) {
            return { valid: false, message: 'Must be a file' };
        }

        if (maxSize && value.size > maxSize) {
            return { valid: false, message: `File too large (max ${this._formatBytes(maxSize)})` };
        }

        if (types.length > 0) {
            const type = value.type || value.name.split('.').pop();
            if (!types.includes(type)) {
                return { valid: false, message: `File type must be: ${types.join(', ')}` };
            }
        }

        return { valid: true, value };
    },

    /**
     * Validate file size
     */
    fileSize(value, maxSize, message = `File too large`) {
        if (!(value instanceof File)) {
            return { valid: false, message: 'Must be a file' };
        }

        const valid = value.size <= maxSize;
        return valid
            ? { valid: true, value }
            : { valid: false, message: `${message} (max ${this._formatBytes(maxSize)})` };
    },

    /**
     * Validate file type
     */
    fileType(value, types, message = 'Invalid file type') {
        if (!(value instanceof File)) {
            return { valid: false, message: 'Must be a file' };
        }

        const fileType = value.type || value.name.split('.').pop();
        const valid = types.includes(fileType);

        return valid
            ? { valid: true, value }
            : { valid: false, message: `${message}. Allowed: ${types.join(', ')}` };
    },

    /**
     * Validate image dimensions
     */
    imageDimensions(value, options = {}) {
        const {
            minWidth,
            maxWidth,
            minHeight,
            maxHeight,
            message = 'Invalid image dimensions',
        } = options;

        if (!(value instanceof File)) {
            return { valid: false, message: 'Must be an image file' };
        }

        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(img.src);

                if (minWidth && img.width < minWidth) {
                    resolve({ valid: false, message: `Width must be at least ${minWidth}px` });
                } else if (maxWidth && img.width > maxWidth) {
                    resolve({ valid: false, message: `Width must be at most ${maxWidth}px` });
                } else if (minHeight && img.height < minHeight) {
                    resolve({ valid: false, message: `Height must be at least ${minHeight}px` });
                } else if (maxHeight && img.height > maxHeight) {
                    resolve({ valid: false, message: `Height must be at most ${maxHeight}px` });
                } else {
                    resolve({ valid: true, value });
                }
            };

            img.onerror = () => {
                URL.revokeObjectURL(img.src);
                resolve({ valid: false, message: 'Invalid image file' });
            };

            img.src = URL.createObjectURL(value);
        });
    },

    // Custom validators

    /**
     * Custom validation function
     */
    custom(value, fn, message = 'Validation failed') {
        try {
            const result = fn(value);
            if (result === true || result === undefined) {
                return { valid: true, value };
            }
            if (typeof result === 'string') {
                return { valid: false, message: result };
            }
            return { valid: false, message };
        } catch (err) {
            return { valid: false, message: err.message || message };
        }
    },

    /**
     * One of allowed values
     */
    oneOf(value, list, message = 'Invalid value') {
        const valid = list.includes(value);
        return valid
            ? { valid: true, value }
            : { valid: false, message };
    },

    // Schema validation

    /**
     * Validate against a schema
     */
    schema(data, schema) {
        const errors = {};

        for (const [key, rule] of Object.entries(schema)) {
            const value = data[key];

            if (typeof rule === 'function') {
                // Simple validator function
                const result = rule(value);
                if (result && result.valid === false) {
                    errors[key] = result.message;
                }
            } else if (rule && rule.valid) {
                // Validator object
                const result = rule(value);
                if (result.valid === false) {
                    errors[key] = result.message;
                }
            } else if (typeof rule === 'object' && !Array.isArray(rule)) {
                // Nested object
                const nested = this.schema(value || {}, rule);
                if (Object.keys(nested).length > 0) {
                    errors[key] = nested;
                }
            }
        }

        return errors;
    },

    /**
     * Validate multiple fields with rules
     */
    all(data, rules) {
        const errors = {};

        for (const [field, rule] of Object.entries(rules)) {
            const value = data[field];
            const result = typeof rule === 'function'
                ? rule(value)
                : this.custom(value, rule);

            if (result && result.valid === false) {
                errors[field] = result.message;
            }
        }

        return Object.keys(errors).length > 0 ? errors : null;
    },

    // Async validation

    /**
     * Async validation
     */
    async async(value, validator) {
        try {
            const result = await validator(value);
            if (result === true || result === undefined) {
                return { valid: true, value };
            }
            if (typeof result === 'string') {
                return { valid: false, message: result };
            }
            return { valid: false, message: 'Validation failed' };
        } catch (err) {
            return { valid: false, message: err.message || 'Validation failed' };
        }
    },

    // Sanitization

    /**
     * Sanitize input
     */
    sanitize(value, options = {}) {
        const {
            trim = true,
            escape = false,
            lowercase = false,
            uppercase = false,
            stripTags = false,
        } = options;

        let result = String(value || '');

        if (trim) result = result.trim();
        if (lowercase) result = result.toLowerCase();
        if (uppercase) result = result.toUpperCase();
        if (stripTags) result = result.replace(/<[^>]*>/g, '');
        if (escape) {
            result = result
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        return result;
    },

    /**
     * Strip HTML tags
     */
    stripHtml(html) {
        return String(html || '').replace(/<[^>]*>/g, '');
    },

    // Helpers

    _formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
    },
};
