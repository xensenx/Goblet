/**
 * Gob Goblet — Container Module (v1 — Double-Envelope Format)
 * ─────────────────────────────────────────────────────────────────────────────
 * Every .gob file consists of a plain-text magic header followed by a
 * base64-encoded outer envelope JSON.
 *
 * ── File Structure ────────────────────────────────────────────────────────────
 *
 *   %gob
 *   1
 *   --- GOB GOBLET PROTECTED FILE ---
 *   This file has been placed under the protection of Gob Goblet.
 *   To retrieve the original file, visit https://gob-goblet.pages.dev
 *   A correct password is required to access its contents.
 *   Do not modify or delete the data below this notice.
 *   Renaming this file is permitted and will not affect decryption.
 *   --- END OF NOTICE ---
 *   <base64 of outerEnvelope JSON>
 *
 * ── Outer Envelope JSON (stored in plaintext as base64) ───────────────────────
 *
 *   { "outerSalt": "b64", "outerIv": "b64", "payload": "b64" }
 *
 *   "payload" = AES-GCM encrypted bytes of the inner container JSON.
 *   Outer key = browser-side PBKDF2(password, outerSalt). No server, no pepper.
 *   Purpose: hides all metadata (originalName, timestamp, innerSalt) from
 *            anyone who does not know the password.
 *
 * ── Inner Container JSON (encrypted inside payload) ──────────────────────────
 *
 *   {
 *     "version": 1,
 *     "timestamp": "ISO-8601",
 *     "originalName": "book.pdf",
 *     "innerSalt": "b64",
 *     "innerIv":   "b64",
 *     "ciphertext": "b64"
 *   }
 *
 *   "ciphertext" = AES-GCM encrypted file bytes.
 *   Inner key = server-side PBKDF2(password, pepper || innerSalt). Requires Worker.
 */

import config from './config.js';

// ─── Notice text ──────────────────────────────────────────────────────────────

const NOTICE_START = '--- GOB GOBLET PROTECTED FILE ---';
const NOTICE_END   = config.GOB_END_MARKER; // '--- END OF NOTICE ---'

const NOTICE_LINES = [
  NOTICE_START,
  'This file has been placed under the protection of Gob Goblet.',
  'To retrieve the original file, visit https://gob-goblet.pages.dev',
  'A correct password is required to access its contents.',
  'Do not modify or delete the data below this notice.',
  'Renaming this file is permitted and will not affect decryption.',
  NOTICE_END,
].join('\n');

// ─── Base64 helpers ──────────────────────────────────────────────────────────

/**
 * Encodes Uint8Array → standard base64 string (no line breaks).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function bytesToBase64(bytes) {
  let b = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) b += String.fromCharCode(bytes[i]);
  return btoa(b);
}

/**
 * Decodes standard base64 string → Uint8Array.
 * @param {string} b64
 * @returns {Uint8Array}
 * @throws {TypeError} on invalid base64
 */
export function base64ToBytes(b64) {
  let bin;
  try { bin = atob(b64.trim()); }
  catch { throw new TypeError('Invalid base64 string.'); }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ─── Filename helpers ─────────────────────────────────────────────────────────

/**
 * Strips the last extension from a filename and appends .gob.
 * book.pdf       → book.gob
 * archive.tar.gz → archive.tar.gob
 * myfile         → myfile.gob
 * @param {string} filename
 * @returns {string}
 */
export function toGobFilename(filename) {
  const lastDot = filename.lastIndexOf('.');
  const base = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  return base + '.gob';
}

// ─── File format builder ──────────────────────────────────────────────────────

/**
 * Assembles the final .gob file text from the outer envelope.
 *
 * @param {{ outerSalt: Uint8Array, outerIv: Uint8Array, payload: Uint8Array }} outer
 * @returns {string} complete .gob file content (text)
 */
export function buildGobFile({ outerSalt, outerIv, payload }) {
  const envelope = JSON.stringify({
    outerSalt: bytesToBase64(outerSalt),
    outerIv:   bytesToBase64(outerIv),
    payload:   bytesToBase64(payload),
  });

  return [
    config.GOB_MAGIC,           // %gob
    config.GOB_VERSION,         // 1
    NOTICE_LINES,               // notice block (includes --- END OF NOTICE ---)
    btoa(envelope),             // base64 of outer envelope JSON
  ].join('\n');
}

/**
 * Builds the inner container JSON bytes (to be encrypted by the outer layer).
 *
 * @param {{ originalName: string, innerSalt: Uint8Array, innerIv: Uint8Array, ciphertext: Uint8Array }} p
 * @returns {Uint8Array} UTF-8 encoded JSON
 */
export function buildInnerContainer({ originalName, innerSalt, innerIv, ciphertext }) {
  const inner = {
    version:      1,
    timestamp:    new Date().toISOString(),
    originalName: originalName,
    innerSalt:    bytesToBase64(innerSalt),
    innerIv:      bytesToBase64(innerIv),
    ciphertext:   bytesToBase64(ciphertext),
  };
  return new TextEncoder().encode(JSON.stringify(inner));
}

// ─── File format parser ───────────────────────────────────────────────────────

/**
 * Parses and validates a .gob file text.
 * Returns the outer envelope (decoded bytes) ready for decryption.
 *
 * @param {string} text — raw text content of the .gob file
 * @returns {{
 *   version: number,
 *   outerSalt: Uint8Array,
 *   outerIv: Uint8Array,
 *   payload: Uint8Array
 * }}
 * @throws {GobletError} on any format/validation failure
 */
export function parseGobFile(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // Line 0: magic
  if (lines[0]?.trim() !== config.GOB_MAGIC) {
    throw new GobletError(
      'This does not appear to be a Gob Goblet file. The magic header is missing or corrupt.'
    );
  }

  // Line 1: version
  const version = parseInt(lines[1]?.trim(), 10);
  if (isNaN(version)) {
    throw new GobletError('Gob Goblet file has an unreadable version number.');
  }
  if (version !== 1) {
    throw new GobletError(
      `This .gob file was created with version ${version}. This app supports version 1 only.`
    );
  }

  // Find the END_MARKER line — the payload follows on the next non-empty line
  const endIdx = lines.findIndex(l => l.trim() === NOTICE_END);
  if (endIdx === -1) {
    throw new GobletError('Gob Goblet file notice block is malformed or missing.');
  }

  // Collect everything after the end marker (join in case of line wrapping)
  const payloadB64 = lines.slice(endIdx + 1).join('').trim();
  if (!payloadB64) {
    throw new GobletError('Gob Goblet file is empty — no encrypted data found.');
  }

  // Decode outer envelope base64 → JSON string
  let envelopeText;
  try { envelopeText = atob(payloadB64); }
  catch { throw new GobletError('Gob Goblet file data is corrupted (invalid base64).'); }

  let envelope;
  try { envelope = JSON.parse(envelopeText); }
  catch { throw new GobletError('Gob Goblet file data is corrupted (invalid envelope JSON).'); }

  // Validate envelope fields
  for (const field of ['outerSalt', 'outerIv', 'payload']) {
    if (typeof envelope[field] !== 'string' || !envelope[field]) {
      throw new GobletError(`Gob Goblet file is missing required field: ${field}.`);
    }
  }

  let outerSalt, outerIv, payload;
  try { outerSalt = base64ToBytes(envelope.outerSalt); }
  catch { throw new GobletError('Gob Goblet file: outerSalt is not valid base64.'); }

  try { outerIv = base64ToBytes(envelope.outerIv); }
  catch { throw new GobletError('Gob Goblet file: outerIv is not valid base64.'); }

  try { payload = base64ToBytes(envelope.payload); }
  catch { throw new GobletError('Gob Goblet file: payload is not valid base64.'); }

  if (outerSalt.length !== 16) throw new GobletError('Gob Goblet file: outerSalt must be 16 bytes.');
  if (outerIv.length !== 12)   throw new GobletError('Gob Goblet file: outerIv must be 12 bytes.');
  if (payload.length < 16)     throw new GobletError('Gob Goblet file: payload is too short.');

  return { version, outerSalt, outerIv, payload };
}

/**
 * Parses and validates inner container JSON bytes (after outer decryption).
 *
 * @param {Uint8Array} innerBytes — decrypted bytes from outer payload
 * @returns {{
 *   version: number,
 *   timestamp: string|null,
 *   originalName: string,
 *   innerSalt: Uint8Array,
 *   innerSaltB64: string,
 *   innerIv: Uint8Array,
 *   ciphertext: Uint8Array
 * }}
 * @throws {GobletError}
 */
export function parseInnerContainer(innerBytes) {
  let text;
  try { text = new TextDecoder().decode(innerBytes); }
  catch { throw new GobletError('Inner container could not be decoded as UTF-8.'); }

  let obj;
  try { obj = JSON.parse(text); }
  catch { throw new GobletError('Incorrect password or corrupt file. The pact was not recognised.'); }

  if (typeof obj !== 'object' || obj === null) {
    throw new GobletError('Incorrect password or corrupt file. The pact was not recognised.');
  }

  for (const field of ['originalName', 'innerSalt', 'innerIv', 'ciphertext']) {
    if (typeof obj[field] !== 'string' || !obj[field]) {
      throw new GobletError(`Inner container is missing required field: ${field}.`);
    }
  }

  let innerSalt, innerIv, ciphertext;
  try { innerSalt = base64ToBytes(obj.innerSalt); }
  catch { throw new GobletError('Inner container: innerSalt is not valid base64.'); }

  try { innerIv = base64ToBytes(obj.innerIv); }
  catch { throw new GobletError('Inner container: innerIv is not valid base64.'); }

  try { ciphertext = base64ToBytes(obj.ciphertext); }
  catch { throw new GobletError('Inner container: ciphertext is not valid base64.'); }

  if (innerSalt.length !== 16) throw new GobletError('Inner container: innerSalt must be 16 bytes.');
  if (innerIv.length !== 12)   throw new GobletError('Inner container: innerIv must be 12 bytes.');
  if (ciphertext.length < 16)  throw new GobletError('Inner container: ciphertext is too short.');

  return {
    version:      obj.version ?? 1,
    timestamp:    typeof obj.timestamp === 'string' ? obj.timestamp : null,
    originalName: obj.originalName,
    innerSalt,
    innerSaltB64: obj.innerSalt,
    innerIv,
    ciphertext,
  };
}

/**
 * Fast probe: checks if a text string looks like a .gob file.
 * Does NOT fully validate — use parseGobFile() for that.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isGobFile(text) {
  return text.trimStart().startsWith(config.GOB_MAGIC);
}

// ─── Custom error class ───────────────────────────────────────────────────────

/**
 * GobletError — user-facing error. Message is safe to display in the UI.
 */
export class GobletError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GobletError';
  }
}
