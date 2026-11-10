import { describe, it, expect } from 'vitest';
import {
    uppercase, lowercase, capitalize, titleCase,
    toJson, toCompactJson,
    formatBytes, formatPercent,
    timeAgo, formatDate, formatTime,
    truncate, fallback,
    booleanStatus, booleanClass,
} from '../../src/js/utils/formatter.js';

describe('uppercase()', () => {
    it('converts to uppercase', () => expect(uppercase('hello')).toBe('HELLO'));
    it('handles null',          () => expect(uppercase(null)).toBe(''));
    it('handles undefined',     () => expect(uppercase(undefined)).toBe(''));
    it('handles numbers',       () => expect(uppercase(42)).toBe('42'));
});

describe('lowercase()', () => {
    it('converts to lowercase', () => expect(lowercase('HELLO')).toBe('hello'));
    it('handles null',          () => expect(lowercase(null)).toBe(''));
});

describe('capitalize()', () => {
    it('capitalises first letter only', () => expect(capitalize('hello world')).toBe('Hello world'));
    it('handles empty string',          () => expect(capitalize('')).toBe(''));
    it('handles null',                  () => expect(capitalize(null)).toBe(''));
});

describe('titleCase()', () => {
    it('capitalises every word', () => expect(titleCase('hello world')).toBe('Hello World'));
    it('handles null',           () => expect(titleCase(null)).toBe(''));
});

describe('toJson()', () => {
    it('serialises to indented JSON', () => {
        expect(toJson({ a: 1 })).toBe(JSON.stringify({ a: 1 }, null, 2));
    });
    it('handles arrays', () => expect(toJson([1, 2])).toBe(JSON.stringify([1, 2], null, 2)));
});

describe('toCompactJson()', () => {
    it('serialises to compact JSON', () => expect(toCompactJson({ a: 1 })).toBe('{"a":1}'));
});

describe('formatBytes()', () => {
    it('returns 0 B for zero',           () => expect(formatBytes(0)).toBe('0 B'));
    it('returns 0 B for NaN',            () => expect(formatBytes('nope')).toBe('0 B'));
    it('formats bytes',                  () => expect(formatBytes(500)).toBe('500.0 B'));
    it('formats kilobytes',              () => expect(formatBytes(1024)).toBe('1.0 KB'));
    it('formats megabytes',              () => expect(formatBytes(1024 * 1024)).toBe('1.0 MB'));
    it('formats gigabytes',              () => expect(formatBytes(1024 ** 3)).toBe('1.0 GB'));
    it('accepts string numbers',         () => expect(formatBytes('2048')).toBe('2.0 KB'));
});

describe('formatPercent()', () => {
    it('formats integer',       () => expect(formatPercent(75)).toBe('75.0%'));
    it('formats float',         () => expect(formatPercent(3.14159)).toBe('3.1%'));
    it('passes through NaN',    () => expect(formatPercent('nope')).toBe('nope'));
    it('handles null',          () => expect(formatPercent(null)).toBe(''));
    it('formats zero',          () => expect(formatPercent(0)).toBe('0.0%'));
});

describe('timeAgo()', () => {
    it('returns empty string for falsy', () => expect(timeAgo(null)).toBe(''));
    it('formats seconds',  () => {
        const ts = Date.now() - 30 * 1000;
        expect(timeAgo(ts)).toBe('30s ago');
    });
    it('formats minutes',  () => {
        const ts = Date.now() - 5 * 60 * 1000;
        expect(timeAgo(ts)).toBe('5m ago');
    });
    it('formats hours',    () => {
        const ts = Date.now() - 3 * 3600 * 1000;
        expect(timeAgo(ts)).toBe('3h ago');
    });
    it('formats days',     () => {
        const ts = Date.now() - 2 * 86400 * 1000;
        expect(timeAgo(ts)).toBe('2d ago');
    });
});

describe('formatDate()', () => {
    it('returns empty string for falsy', () => expect(formatDate(null)).toBe(''));
    it('returns a non-empty string for a valid timestamp', () => {
        expect(formatDate(Date.now()).length).toBeGreaterThan(0);
    });
});

describe('formatTime()', () => {
    it('returns empty string for falsy', () => expect(formatTime(null)).toBe(''));
    it('returns a non-empty string for a valid timestamp', () => {
        expect(formatTime(Date.now()).length).toBeGreaterThan(0);
    });
});

describe('truncate()', () => {
    it('returns string unchanged when shorter than n',  () => expect(truncate('hello', 10)).toBe('hello'));
    it('returns string unchanged when equal to n',      () => expect(truncate('hello', 5)).toBe('hello'));
    it('truncates and appends ellipsis when longer',    () => expect(truncate('hello world', 5)).toBe('hello…'));
    it('uses default n of 50',  () => {
        const long = 'a'.repeat(60);
        expect(truncate(long)).toBe('a'.repeat(50) + '…');
    });
    it('handles null',  () => expect(truncate(null, 5)).toBe(''));
});

describe('fallback()', () => {
    it('returns value when present',        () => expect(fallback('hi', 'default')).toBe('hi'));
    it('returns dflt for null',             () => expect(fallback(null, 'default')).toBe('default'));
    it('returns dflt for undefined',        () => expect(fallback(undefined, 'default')).toBe('default'));
    it('returns dflt for empty string',     () => expect(fallback('', 'default')).toBe('default'));
    it('returns 0 when value is zero',      () => expect(fallback(0, 'default')).toBe(0));
    it('returns false when value is false', () => expect(fallback(false, 'default')).toBe(false));
    it('defaults dflt to empty string',     () => expect(fallback(null)).toBe(''));
});

describe('booleanStatus()', () => {
    it('returns active for truthy',   () => expect(booleanStatus(true)).toBe('active'));
    it('returns inactive for falsy',  () => expect(booleanStatus(false)).toBe('inactive'));
    it('returns inactive for null',   () => expect(booleanStatus(null)).toBe('inactive'));
});

describe('booleanClass()', () => {
    it('returns is-true for truthy',  () => expect(booleanClass(true)).toBe('is-true'));
    it('returns is-false for falsy',  () => expect(booleanClass(false)).toBe('is-false'));
    it('returns is-false for null',   () => expect(booleanClass(null)).toBe('is-false'));
});