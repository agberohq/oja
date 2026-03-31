import { describe, it, expect } from 'vitest';
import { validate } from '../../src/js/ui/validate.js';


describe('validate.required()', () => {
    it('passes for a non-empty string', () => {
        expect(validate.required('hello').valid).toBe(true);
    });

    it('fails for an empty string', () => {
        expect(validate.required('').valid).toBe(false);
    });

    it('fails for a whitespace-only string', () => {
        expect(validate.required('   ').valid).toBe(false);
    });

    it('fails for null', () => {
        expect(validate.required(null).valid).toBe(false);
    });

    it('fails for undefined', () => {
        expect(validate.required(undefined).valid).toBe(false);
    });

    it('fails for an empty array', () => {
        expect(validate.required([]).valid).toBe(false);
    });

    it('passes for a non-empty array', () => {
        expect(validate.required([1]).valid).toBe(true);
    });

    it('returns the custom message on failure', () => {
        const result = validate.required('', 'Name is required');
        expect(result.message).toBe('Name is required');
    });
});


describe('validate.email()', () => {
    it('passes for a valid email', () => {
        expect(validate.email('user@example.com').valid).toBe(true);
    });

    it('fails for missing @', () => {
        expect(validate.email('userexample.com').valid).toBe(false);
    });

    it('fails for missing domain', () => {
        expect(validate.email('user@').valid).toBe(false);
    });

    it('fails for missing TLD', () => {
        expect(validate.email('user@example').valid).toBe(false);
    });

    it('passes empty value when allowEmpty is true', () => {
        expect(validate.email('', { allowEmpty: true }).valid).toBe(true);
    });

    it('fails empty value when allowEmpty is false (default)', () => {
        expect(validate.email('').valid).toBe(false);
    });
});


describe('validate.url()', () => {
    it('passes for a valid https URL', () => {
        expect(validate.url('https://example.com').valid).toBe(true);
    });

    it('passes for a valid http URL', () => {
        expect(validate.url('http://example.com').valid).toBe(true);
    });

    it('fails for a plain string', () => {
        expect(validate.url('not-a-url').valid).toBe(false);
    });

    it('fails for ftp when only http/https are allowed', () => {
        expect(validate.url('ftp://example.com').valid).toBe(false);
    });

    it('passes ftp when protocols includes ftp:', () => {
        expect(validate.url('ftp://example.com', { protocols: ['ftp:'] }).valid).toBe(true);
    });

    it('passes empty value when allowEmpty is true', () => {
        expect(validate.url('', { allowEmpty: true }).valid).toBe(true);
    });
});


describe('validate.uuid()', () => {
    it('passes a valid v4 UUID', () => {
        expect(validate.uuid('550e8400-e29b-41d4-a716-446655440000').valid).toBe(true);
    });

    it('fails a malformed UUID', () => {
        expect(validate.uuid('not-a-uuid').valid).toBe(false);
    });

    it('fails a v4 UUID checked as v1', () => {
        expect(validate.uuid('550e8400-e29b-41d4-a716-446655440000', 1).valid).toBe(false);
    });
});


describe('validate.regex()', () => {
    it('passes when the pattern matches', () => {
        expect(validate.regex('abc123', /^[a-z0-9]+$/).valid).toBe(true);
    });

    it('fails when the pattern does not match', () => {
        expect(validate.regex('abc 123', /^[a-z0-9]+$/).valid).toBe(false);
    });

    it('accepts a string pattern', () => {
        expect(validate.regex('hello', '^hello$').valid).toBe(true);
    });
});