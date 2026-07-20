/**
 * Gob Goblet — Crypto Module (v1 — Double-Layer)
 * ─────────────────────────────────────────────────────────────────────────────
 * Two distinct key derivation paths:
 *
 *  1. OUTER KEY (client-side, no server):
 *     PBKDF2(password, outerSalt, 100_000 iterations, SHA-256) → AES-256-GCM key
 *     Purpose: encrypts the inner container JSON, hiding all metadata (filename,
 *     timestamp, innerSalt) from anyone without the password.
 *
 *  2. INNER KEY (server-side via Goblet Engine Worker):
 *     PBKDF2(password, pepper || innerSalt, 100_000 iterations, SHA-256)
 *     Purpose: encrypts the actual file bytes. Requires server secret (pepper),
 *     so offline brute-force of a stolen .gob requires both file AND server.
 */

import config from './config.js';
import { GobletError } from './container.js';

// ─── Browser support ──────────────────────────────────────────────────────────

/**
 * Returns true if all required Web Crypto APIs are available.
 * @returns {boolean}
 */
export function isCryptoSupported() {
  return (
    typeof window !== 'undefined' &&
    window.crypto != null &&
    typeof window.crypto.subtle?.importKey === 'function' &&
    typeof window.crypto.subtle?.deriveKey === 'function' &&
    typeof window.crypto.subtle?.encrypt === 'function' &&
    typeof window.crypto.subtle?.decrypt === 'function' &&
    typeof window.crypto.getRandomValues === 'function'
  );
}

// ─── Random bytes ─────────────────────────────────────────────────────────────

/**
 * Generates cryptographically random bytes.
 * @param {number} length
 * @returns {Uint8Array}
 */
export function randomBytes(length) {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}

// ─── OUTER key derivation (browser-side PBKDF2, no server) ───────────────────

/**
 * Derives the outer AES-256-GCM key entirely in the browser via PBKDF2.
 * No server call. No pepper. Purpose is metadata hiding only.
 *
 * @param {string}     password   — UTF-8 user password
 * @param {Uint8Array} saltBytes  — 16-byte random outer salt
 * @returns {Promise<CryptoKey>} non-extractable AES-GCM CryptoKey
 * @throws {GobletError}
 */
export async function deriveOuterKey(password, saltBytes) {
  try {
    const passwordBytes = new TextEncoder().encode(password);

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordBytes,
      { name: 'PBKDF2' },
      false,
      ['deriveKey'],
    );

    const cryptoKey = await crypto.subtle.deriveKey(
      {
        name:       'PBKDF2',
        salt:       saltBytes,
        iterations: config.OUTER_KDF_ITERATIONS,
        hash:       'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false, // non-extractable
      ['encrypt', 'decrypt'],
    );

    return cryptoKey;
  } catch (err) {
    throw new GobletError('Failed to derive outer encryption key. Please try again.');
  }
}

// ─── INNER key derivation (via Goblet Engine Worker) ─────────────────────────

/**
 * Calls the Goblet Engine Worker to derive the inner AES-256 key.
 * The Worker mixes the server-side pepper into the derivation.
 *
 * @param {string} password  — UTF-8 user password
 * @param {string} saltB64   — base64-encoded 16-byte inner salt
 * @returns {Promise<CryptoKey>} non-extractable AES-GCM CryptoKey
 * @throws {GobletError} on network or server errors
 */
export async function deriveInnerKeyFromWorker(password, saltB64) {
  const url = `${config.WORKER_URL}/derive-key`;

  let response;
  try {
    response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ password, salt: saltB64 }),
    });
  } catch {
    throw new GobletError(
      'The key service is unreachable. Please check your connection and try again.'
    );
  }

  let data;
  try { data = await response.json(); }
  catch {
    throw new GobletError('Unexpected response from the key service. Please try again.');
  }

  if (!response.ok) {
    if (response.status >= 500) {
      throw new GobletError('An internal error occurred in the key service. Please try again later.');
    }
    if (response.status === 403) {
      throw new GobletError('Access was denied by the key service. Configuration issue.');
    }
    throw new GobletError(`Key service returned an error. Please try again.`);
  }

  if (typeof data.key !== 'string' || data.key.length === 0) {
    throw new GobletError('Key service returned an unexpected response.');
  }

  let rawKeyBytes;
  try {
    const bin = atob(data.key);
    rawKeyBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) rawKeyBytes[i] = bin.charCodeAt(i);
  } catch {
    throw new GobletError('Key service returned an undecodable key.');
  }

  if (rawKeyBytes.length !== 32) {
    throw new GobletError(`Key service returned a key of unexpected length.`);
  }

  try {
    return await crypto.subtle.importKey(
      'raw',
      rawKeyBytes,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    );
  } catch {
    throw new GobletError('Failed to import the derived key. Please try again.');
  }
}

// ─── AES-256-GCM encryption ───────────────────────────────────────────────────

/**
 * Encrypts bytes using AES-256-GCM.
 *
 * @param {ArrayBuffer|Uint8Array} plainBytes — data to encrypt
 * @param {CryptoKey}              cryptoKey
 * @param {Uint8Array}             iv         — 12-byte IV
 * @returns {Promise<Uint8Array>} ciphertext + 16-byte GCM auth tag
 * @throws {GobletError}
 */
export async function aesgcmEncrypt(plainBytes, cryptoKey, iv) {
  try {
    const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plainBytes);
    return new Uint8Array(buf);
  } catch {
    throw new GobletError('Encryption failed unexpectedly. Please try again.');
  }
}

// ─── AES-256-GCM decryption ───────────────────────────────────────────────────

/**
 * Decrypts AES-256-GCM ciphertext.
 *
 * @param {Uint8Array} cipherBytes — ciphertext (includes GCM auth tag)
 * @param {CryptoKey}  cryptoKey
 * @param {Uint8Array} iv          — 12-byte IV
 * @returns {Promise<Uint8Array>} plaintext bytes
 * @throws {GobletError} on auth tag failure (wrong key / tampered data)
 */
export async function aesgcmDecrypt(cipherBytes, cryptoKey, iv) {
  try {
    const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, cipherBytes);
    return new Uint8Array(buf);
  } catch {
    // AES-GCM auth tag failure → wrong password or corrupt ciphertext
    throw new GobletError('Incorrect password or corrupt file. The pact was not recognised.');
  }
}
