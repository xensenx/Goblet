/**
 * Gob Goblet Frontend — Configuration
 * ─────────────────────────────────────────────────────────────────────────────
 * Update WORKER_URL before deploying to production.
 */

const config = {
  /**
   * The base URL of the Goblet Engine Cloudflare Worker.
   * @example 'https://goblet-engine.xsen1947.workers.dev'
   */
  WORKER_URL: 'https://goblet-engine.xsen1947.workers.dev',

  /**
   * PBKDF2 iteration count used by the Worker for the inner (server-side) key.
   * Must match exactly what the Worker uses.
   */
  KDF_ITERATIONS: 100_000,

  /**
   * PBKDF2 iteration count for the outer (client-side) envelope key.
   * This runs entirely in the browser — no server involved.
   */
  OUTER_KDF_ITERATIONS: 100_000,

  /**
   * Salt length in bytes (16 bytes = 128 bits).
   */
  SALT_BYTES: 16,

  /**
   * AES-GCM IV length in bytes (12 bytes = 96 bits, NIST SP 800-38D).
   */
  IV_BYTES: 12,

  /**
   * Magic header lines that prefix every .gob file.
   * Parsers check for the %gob marker and END_MARKER to locate payload.
   */
  GOB_MAGIC:      '%gob',
  GOB_VERSION:    '1',
  GOB_END_MARKER: '--- END OF NOTICE ---',
};

export default config;
