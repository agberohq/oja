/**
 * oja/encrypt.js
 * AES-GCM encryption via the Web Crypto API.
 *
 * Standalone module — import wherever encryption is needed.
 * Used by store.js (secure storage), auth.js (token storage),
 * and available to vfs.js or any third-party extension.
 *
 * ─── Usage ────────────────────────────────────────────────────────────────────
 *
 *   import { encrypt } from '../oja/encrypt.js';
 *
 *   // Encrypt / decrypt strings
 *   const ciphertext = await encrypt.seal('my secret', 'passphrase', 'salt');
 *   const plaintext  = await encrypt.open(ciphertext, 'passphrase', 'salt');
 *
 *   // Sign / verify (HMAC-SHA256)
 *   const sig  = await encrypt.sign('message', 'secret');
 *   const ok   = await encrypt.verify('message', sig, 'secret');
 *
 *   // Rotate a ciphertext to a new passphrase without exposing the plaintext
 *   const newCiphertext = await encrypt.rotate(old, 'oldPass', 'newPass', 'salt');
 *
 *   // Check Web Crypto availability
 *   if (encrypt.available()) { ... }
 */

const ENC_PREFIX  = '__oja_enc__:';
const KEY_VERSION = 1;
const ITERATIONS  = 100_000;

// Derive an AES-GCM key from a passphrase and salt using PBKDF2.
// The salt prevents rainbow-table attacks across different namespaces.
async function _deriveKey(passphrase, salt) {
    const enc    = new TextEncoder();
    const keyMat = await crypto.subtle.importKey(
        'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode(salt), iterations: ITERATIONS, hash: 'SHA-256' },
        keyMat,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export const encrypt = {
    // Encrypt a plaintext string. Returns a prefixed base64 string safe for storage.
    // AAD (additional authenticated data) is optional but binds ciphertext to a context.
    async seal(plaintext, passphrase, salt, aad = null) {
        const key = await _deriveKey(passphrase, salt);
        const iv  = crypto.getRandomValues(new Uint8Array(12));
        const enc = new TextEncoder();
        const ct  = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, ...(aad ? { additionalData: enc.encode(aad) } : {}) },
            key,
            enc.encode(plaintext)
        );

        const buf = new Uint8Array(1 + 12 + ct.byteLength);
        buf[0] = KEY_VERSION;
        buf.set(iv, 1);
        buf.set(new Uint8Array(ct), 13);
        return ENC_PREFIX + btoa(String.fromCharCode(...buf));
    },

    // Decrypt a ciphertext produced by seal(). Returns the original plaintext.
    // Returns the input unchanged if it is not a recognised ciphertext (plain passthrough).
    async open(stored, passphrase, salt, aad = null) {
        if (!stored.startsWith(ENC_PREFIX)) return stored;

        const raw = atob(stored.slice(ENC_PREFIX.length));
        const buf = Uint8Array.from(raw, c => c.charCodeAt(0));
        const iv  = buf.slice(1, 13);
        const ct  = buf.slice(13);
        const enc = new TextEncoder();
        const key = await _deriveKey(passphrase, salt);

        const dec = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv, ...(aad ? { additionalData: enc.encode(aad) } : {}) },
            key,
            ct
        );
        return new TextDecoder().decode(dec);
    },

    // Re-encrypt a ciphertext under a new passphrase without ever exposing the plaintext.
    async rotate(stored, oldPassphrase, newPassphrase, salt, aad = null) {
        const plaintext = await encrypt.open(stored, oldPassphrase, salt, aad);
        return encrypt.seal(plaintext, newPassphrase, salt, aad);
    },

    // Sign a message with HMAC-SHA256. Returns a hex string.
    async sign(message, secret) {
        const enc     = new TextEncoder();
        const keyMat  = await crypto.subtle.importKey(
            'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
        );
        const sig = await crypto.subtle.sign('HMAC', keyMat, enc.encode(message));
        return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    },

    // Verify an HMAC-SHA256 signature produced by sign().
    async verify(message, signature, secret) {
        const expected = await encrypt.sign(message, secret);
        return expected === signature;
    },

    // Returns true when Web Crypto is available in this environment.
    available() {
        return (
            typeof crypto !== 'undefined' &&
            typeof crypto.subtle !== 'undefined' &&
            typeof crypto.getRandomValues === 'function'
        );
    },

    // Exposed so store.js can detect its own ciphertexts without re-importing the constant.
    isSealed(value) {
        return typeof value === 'string' && value.startsWith(ENC_PREFIX);
    },
};