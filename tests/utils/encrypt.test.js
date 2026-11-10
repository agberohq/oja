import { describe, it, expect } from 'vitest';
import { encrypt } from '../../src/js/utils/encrypt.js';


describe('encrypt — available()', () => {
    it('returns true in jsdom environment', () => {
        expect(encrypt.available()).toBe(true);
    });
});


describe('encrypt — isSealed()', () => {
    it('returns false for a plain string', () => {
        expect(encrypt.isSealed('hello')).toBe(false);
    });

    it('returns false for an empty string', () => {
        expect(encrypt.isSealed('')).toBe(false);
    });

    it('returns true for a ciphertext produced by seal()', async () => {
        const ct = await encrypt.seal('secret', 'pass', 'salt');
        expect(encrypt.isSealed(ct)).toBe(true);
    });
});


describe('encrypt — seal() and open()', () => {
    it('round-trips a plain string', async () => {
        const ct = await encrypt.seal('hello world', 'password', 'my-salt');
        const pt = await encrypt.open(ct, 'password', 'my-salt');
        expect(pt).toBe('hello world');
    });

    it('round-trips an empty string', async () => {
        const ct = await encrypt.seal('', 'password', 'salt');
        const pt = await encrypt.open(ct, 'password', 'salt');
        expect(pt).toBe('');
    });

    it('round-trips a JSON payload', async () => {
        const obj = { token: 'jwt.abc.def', roles: ['admin'] };
        const ct  = await encrypt.seal(JSON.stringify(obj), 'pass', 'ns');
        const pt  = await encrypt.open(ct, 'pass', 'ns');
        expect(JSON.parse(pt)).toEqual(obj);
    });

    it('produces different ciphertexts on each call (random IV)', async () => {
        const ct1 = await encrypt.seal('same', 'pass', 'salt');
        const ct2 = await encrypt.seal('same', 'pass', 'salt');
        expect(ct1).not.toBe(ct2);
    });

    it('open() returns the input unchanged when not sealed', async () => {
        const plain = await encrypt.open('not-encrypted', 'pass', 'salt');
        expect(plain).toBe('not-encrypted');
    });

    it('fails to decrypt with wrong password', async () => {
        const ct = await encrypt.seal('secret', 'correct-pass', 'salt');
        await expect(encrypt.open(ct, 'wrong-pass', 'salt')).rejects.toThrow();
    });

    it('fails to decrypt with wrong salt', async () => {
        const ct = await encrypt.seal('secret', 'pass', 'correct-salt');
        await expect(encrypt.open(ct, 'pass', 'wrong-salt')).rejects.toThrow();
    });

    it('round-trips with AAD', async () => {
        const ct = await encrypt.seal('data', 'pass', 'salt', 'extra-context');
        const pt = await encrypt.open(ct, 'pass', 'salt', 'extra-context');
        expect(pt).toBe('data');
    });

    it('fails to decrypt when AAD does not match', async () => {
        const ct = await encrypt.seal('data', 'pass', 'salt', 'correct-aad');
        await expect(encrypt.open(ct, 'pass', 'salt', 'wrong-aad')).rejects.toThrow();
    });
});


describe('encrypt — rotate()', () => {
    it('re-encrypts under a new passphrase and decrypts correctly', async () => {
        const ct      = await encrypt.seal('my secret', 'old-pass', 'salt');
        const rotated = await encrypt.rotate(ct, 'old-pass', 'new-pass', 'salt');
        const pt      = await encrypt.open(rotated, 'new-pass', 'salt');
        expect(pt).toBe('my secret');
    });

    it('old passphrase no longer decrypts after rotation', async () => {
        const ct      = await encrypt.seal('value', 'old', 'salt');
        const rotated = await encrypt.rotate(ct, 'old', 'new', 'salt');
        await expect(encrypt.open(rotated, 'old', 'salt')).rejects.toThrow();
    });
});


describe('encrypt — sign() and verify()', () => {
    it('produces a hex string signature', async () => {
        const sig = await encrypt.sign('message', 'secret');
        expect(typeof sig).toBe('string');
        expect(sig).toMatch(/^[0-9a-f]+$/);
    });

    it('verify() returns true for a valid signature', async () => {
        const sig = await encrypt.sign('hello', 'key');
        expect(await encrypt.verify('hello', sig, 'key')).toBe(true);
    });

    it('verify() returns false for a tampered message', async () => {
        const sig = await encrypt.sign('hello', 'key');
        expect(await encrypt.verify('HELLO', sig, 'key')).toBe(false);
    });

    it('verify() returns false for a wrong key', async () => {
        const sig = await encrypt.sign('hello', 'correct-key');
        expect(await encrypt.verify('hello', sig, 'wrong-key')).toBe(false);
    });

    it('verify() returns false for a tampered signature', async () => {
        const sig     = await encrypt.sign('hello', 'key');
        const tampered = sig.slice(0, -4) + 'dead';
        expect(await encrypt.verify('hello', tampered, 'key')).toBe(false);
    });

    it('same message + key always produces the same signature', async () => {
        const sig1 = await encrypt.sign('msg', 'key');
        const sig2 = await encrypt.sign('msg', 'key');
        expect(sig1).toBe(sig2);
    });
});