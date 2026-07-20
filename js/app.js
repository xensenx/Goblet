/**
 * Gob Goblet — Application (v2)
 * ─────────────────────────────────────────────────────────────────────────────
 * State machine: idle → file-selected → password-entry → processing →
 *                retrieve-ready (decrypt) | done (encrypt) → error
 *
 * Terminology used throughout the UI:
 *   Encrypt  = "protect" / "offer for protection" / "Gob Goblet is negotiating"
 *   Decrypt  = "retrieve your offering" / "Gob Goblet is examining"
 *   File     = "offering"
 *   Password = "Pact Password"
 *   .gob     = "Goblet container"
 */

import config from './config.js';
import {
  buildGobFile,
  buildInnerContainer,
  parseGobFile,
  parseInnerContainer,
  isGobFile,
  toGobFilename,
  bytesToBase64,
  GobletError,
} from './container.js';
import {
  isCryptoSupported,
  randomBytes,
  deriveOuterKey,
  deriveInnerKeyFromWorker,
  aesgcmEncrypt,
  aesgcmDecrypt,
} from './crypto.js';
import { icons } from './icons.js';

// ─── App State ───────────────────────────────────────────────────────────────

const state = {
  phase:    'idle',   // 'idle' | 'file-selected' | 'processing' | 'retrieve-ready' | 'done' | 'error'
  mode:     null,     // 'protect' | 'retrieve'
  file:     null,     // File
  gobData:  null,     // parsed outer envelope from parseGobFile()
  innerData: null,    // parsed inner container from parseInnerContainer()
  resultBlob: null,   // Blob ready for download (decrypt flow)
  resultName: null,   // filename for download
  busy:     false,
};

// ─── DOM helpers ─────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const dom = {
  dropZone:        () => $('drop-zone'),
  fileInput:       () => $('file-input'),
  fileSelectBtn:   () => $('file-select-btn'),
  fileInfo:        () => $('file-info'),
  fileInfoName:    () => $('file-info-name'),
  fileInfoSize:    () => $('file-info-size'),
  modeBadge:       () => $('mode-badge'),
  modeSection:     () => $('mode-section'),
  gobMetaCard:     () => $('gob-meta-card'),
  gobOrigName:     () => $('gob-orig-name'),
  gobTimestamp:    () => $('gob-timestamp'),
  passwordSection: () => $('password-section'),
  passwordInput:   () => $('password-input'),
  passwordToggle:  () => $('password-toggle'),
  passwordWarn:    () => $('password-warn'),
  actionBtn:       () => $('action-btn'),
  resetBtn:        () => $('reset-btn'),
  statusBar:       () => $('status-bar'),
  statusText:      () => $('status-text'),
  statusSpinner:   () => $('status-spinner'),
  downloadCard:    () => $('download-card'),
  downloadFilename:() => $('download-filename'),
  downloadBtn:     () => $('download-btn'),
  cryptoWarning:   () => $('crypto-warning'),
  mainCard:        () => $('main-card'),
};

// ─── Boot ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Inject SVG icons into toggle button
  if (dom.passwordToggle()) {
    dom.passwordToggle().innerHTML = icons.eye;
  }

  if (!isCryptoSupported()) {
    dom.cryptoWarning()?.classList.remove('hidden');
    dom.mainCard()?.classList.add('hidden');
    return;
  }

  bindEvents();
  renderIdle();
});

// ─── Events ───────────────────────────────────────────────────────────────────

function bindEvents() {
  // File select
  dom.fileSelectBtn().addEventListener('click', () => dom.fileInput().click());
  dom.fileInput().addEventListener('change', e => {
    handleFileList(e.target.files);
    e.target.value = '';
  });

  // Drag and drop
  const dz = dom.dropZone();
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dz-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dz-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('dz-over');
    handleFileList(e.dataTransfer.files);
  });

  // Password input
  dom.passwordInput().addEventListener('input', () => {
    const empty = dom.passwordInput().value.length === 0;
    dom.passwordWarn().classList.toggle('visible', empty);
    updateActionBtn();
  });

  // Password visibility
  let pwVisible = false;
  dom.passwordToggle().addEventListener('click', () => {
    pwVisible = !pwVisible;
    dom.passwordInput().type = pwVisible ? 'text' : 'password';
    dom.passwordToggle().innerHTML = pwVisible ? icons.eyeOff : icons.eye;
    dom.passwordToggle().setAttribute('aria-label', pwVisible ? 'Hide password' : 'Show password');
  });

  // Action
  dom.actionBtn().addEventListener('click', handleAction);

  // Reset
  dom.resetBtn().addEventListener('click', handleReset);

  // Download button (decrypt flow)
  dom.downloadBtn()?.addEventListener('click', handleDownload);
}

// ─── File handling ────────────────────────────────────────────────────────────

async function handleFileList(files) {
  if (state.busy) return;
  if (!files?.length) return;

  if (files.length > 1) {
    setStatus('error', 'Please offer one file at a time.');
    return;
  }

  const file = files[0];
  state.file = file;
  state.phase = 'file-selected';

  await detectMode(file);
}

async function detectMode(file) {
  setStatus('processing', 'Examining your offering\u2026');

  let mode = 'protect';
  let gobData = null;

  try {
    // Quick probe: read first 2 KB just to check for the magic header
    const probe = await readFileAsText(file, 2048);
    if (isGobFile(probe)) {
      mode = 'retrieve';
      // Magic found — now read the FULL file for proper parsing
      try {
        const fullText = await readFileAsText(file);
        gobData = parseGobFile(fullText);
      } catch (err) {
        setStatus('error', err instanceof GobletError ? err.message : 'This Goblet container appears to be damaged.');
        return;
      }
    }
  } catch {
    mode = 'protect'; // Binary file, not text
  }

  state.mode    = mode;
  state.gobData = gobData;
  state.phase   = 'password-entry';

  renderFileSelected(file, mode, gobData);
}

// ─── Action handler ───────────────────────────────────────────────────────────

async function handleAction() {
  if (state.busy) return;
  const password = dom.passwordInput().value;

  if (state.mode === 'protect') {
    await runProtect(state.file, password);
  } else {
    await runRetrieve(state.file, state.gobData, password);
  }
}

// ─── PROTECT (Encrypt) flow ───────────────────────────────────────────────────

async function runProtect(file, password) {
  setBusy(true);
  try {
    // 1. Read file bytes
    setStatus('processing', 'Reading your offering\u2026');
    const fileBytes = await readFileAsArrayBuffer(file);

    // 2. Generate inner salt & IV
    const innerSalt = randomBytes(config.SALT_BYTES);
    const innerIv   = randomBytes(config.IV_BYTES);

    // 3. Derive inner key via Worker (PBKDF2 + pepper)
    setStatus('processing', 'Gob Goblet is negotiating the inner pact\u2026');
    const innerSaltB64 = bytesToBase64(innerSalt);
    const innerKey = await deriveInnerKeyFromWorker(password, innerSaltB64);

    // 4. Encrypt file bytes (inner layer)
    setStatus('processing', 'Sealing your file\u2026');
    const innerCiphertext = await aesgcmEncrypt(fileBytes, innerKey, innerIv);

    // 5. Build inner container JSON bytes
    const innerContainerBytes = buildInnerContainer({
      originalName: file.name,
      innerSalt,
      innerIv,
      ciphertext: innerCiphertext,
    });

    // 6. Generate outer salt & IV
    const outerSalt = randomBytes(config.SALT_BYTES);
    const outerIv   = randomBytes(config.IV_BYTES);

    // 7. Derive outer key in browser (PBKDF2, no server)
    setStatus('processing', 'Gob Goblet is negotiating the outer pact\u2026');
    const outerKey = await deriveOuterKey(password, outerSalt);

    // 8. Encrypt inner container bytes (outer layer)
    const outerPayload = await aesgcmEncrypt(innerContainerBytes, outerKey, outerIv);

    // 9. Build .gob file text
    setStatus('processing', 'Assembling the Goblet container\u2026');
    const gobText = buildGobFile({ outerSalt, outerIv, payload: outerPayload });

    // 10. Trigger download
    const gobFilename = toGobFilename(file.name);
    const gobBytes = new TextEncoder().encode(gobText);
    triggerDownload(gobBytes, gobFilename, 'application/octet-stream');

    setStatus('done', `Gob Goblet has gobbled the file. \u201c${gobFilename}\u201d is ready.`);
    renderProtectDone();
  } catch (err) {
    handleError(err);
  } finally {
    setBusy(false);
  }
}

// ─── RETRIEVE (Decrypt) flow ──────────────────────────────────────────────────

async function runRetrieve(file, gobData, password) {
  setBusy(true);
  try {
    // 1. Derive outer key in browser
    setStatus('processing', 'Gob Goblet is examining the outer seal\u2026');
    const outerKey = await deriveOuterKey(password, gobData.outerSalt);

    // 2. Decrypt outer payload → inner container JSON bytes
    let innerBytes;
    try {
      innerBytes = await aesgcmDecrypt(gobData.payload, outerKey, gobData.outerIv);
    } catch {
      throw new GobletError('Incorrect password or corrupt file. The pact was not recognised.');
    }

    // 3. Parse inner container (reveals originalName + salts)
    setStatus('processing', 'Unwrapping the offering\u2026');
    const innerData = parseInnerContainer(innerBytes);
    state.innerData = innerData;

    // Show metadata card
    showGobMeta(innerData.originalName, innerData.timestamp);

    // 4. Derive inner key via Worker (PBKDF2 + pepper)
    setStatus('processing', 'Gob Goblet is retrieving the inner pact\u2026');
    const innerKey = await deriveInnerKeyFromWorker(password, innerData.innerSaltB64);

    // 5. Decrypt file bytes (inner layer)
    setStatus('processing', 'Unsealing the original file\u2026');
    let plainBytes;
    try {
      plainBytes = await aesgcmDecrypt(innerData.ciphertext, innerKey, innerData.innerIv);
    } catch {
      throw new GobletError('Incorrect password or corrupt file. The pact was not recognised.');
    }

    // 6. Hold result in memory — show download button (no auto-download)
    state.resultBlob = new Blob([plainBytes], { type: 'application/octet-stream' });
    state.resultName = innerData.originalName;
    state.phase = 'retrieve-ready';

    setStatus('done', `Your offering has been retrieved. Download \u201c${innerData.originalName}\u201d below.`);
    renderRetrieveReady(innerData.originalName);
  } catch (err) {
    handleError(err);
  } finally {
    setBusy(false);
  }
}

// ─── Download (manual, decrypt flow) ─────────────────────────────────────────

function handleDownload() {
  if (!state.resultBlob || !state.resultName) return;
  const url = URL.createObjectURL(state.resultBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = state.resultName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 2000);
}

// ─── Render helpers ───────────────────────────────────────────────────────────

function renderIdle() {
  // Reset everything
  hide('mode-section', 'password-section', 'gob-meta-card', 'file-info', 'download-card');
  show();
  dom.resetBtn().classList.add('hidden');
  dom.actionBtn().classList.add('hidden');
  dom.dropZone().classList.remove('dz-has-file');
  dom.passwordInput().value = '';
  dom.passwordWarn().classList.remove('visible');
  dom.modeBadge().className = 'mode-badge';
  dom.modeBadge().textContent = '';
  setStatus('idle', 'Offer your file for protection, or retrieve a Goblet container');
}

function renderFileSelected(file, mode, gobData) {
  // File info row
  dom.fileInfoName().textContent = file.name;
  dom.fileInfoName().title = file.name;
  dom.fileInfoSize().textContent = formatBytes(file.size);
  dom.fileInfo().classList.remove('hidden');
  dom.dropZone().classList.add('dz-has-file');

  // Mode badge
  const badge = dom.modeBadge();
  if (mode === 'protect') {
    badge.textContent = 'Protection Mode';
    badge.className = 'mode-badge mode-protect';
  } else {
    badge.textContent = 'Retrieval Mode';
    badge.className = 'mode-badge mode-retrieve';
  }
  dom.modeSection().classList.remove('hidden');

  // .gob meta card (shown but populated later after outer decrypt in retrieve flow)
  // For protect mode: hide it
  dom.gobMetaCard().classList.add('hidden');

  // Password
  dom.passwordSection().classList.remove('hidden');
  dom.passwordInput().placeholder =
    mode === 'protect'
      ? 'Enter the Pact Password to protect this file'
      : 'Enter the Pact Password used when this file was protected';
  dom.passwordInput().focus();

  // Action btn
  dom.actionBtn().textContent =
    mode === 'protect' ? 'Offer for Protection' : 'Retrieve Offering';
  dom.actionBtn().classList.remove('hidden');
  updateActionBtn();

  dom.resetBtn().classList.remove('hidden');

  const statusMsg = mode === 'protect'
    ? 'Enter your Pact Password and offer the file for protection'
    : 'Enter your Pact Password to retrieve your offering';
  setStatus('idle', statusMsg);
}

function showGobMeta(originalName, timestamp) {
  dom.gobOrigName().textContent = originalName;
  dom.gobTimestamp().textContent = timestamp
    ? new Date(timestamp).toLocaleString()
    : 'Unknown';
  dom.gobMetaCard().classList.remove('hidden');
}

function renderProtectDone() {
  dom.actionBtn().classList.add('hidden');
  dom.passwordSection().classList.add('hidden');
  dom.passwordInput().value = '';
}

function renderRetrieveReady(originalName) {
  dom.actionBtn().classList.add('hidden');
  dom.passwordSection().classList.add('hidden');
  dom.passwordInput().value = '';

  // Show download card
  const card = dom.downloadCard();
  dom.downloadFilename().textContent = originalName;
  card.classList.remove('hidden');
}

// ─── Status bar ───────────────────────────────────────────────────────────────

function setStatus(type, message) {
  const bar     = dom.statusBar();
  const text    = dom.statusText();
  const spinner = dom.statusSpinner();

  bar.className = `status-bar status-${type}`;
  text.textContent = message;
  spinner.style.display = type === 'processing' ? '' : 'none';
}

// ─── Error handler ────────────────────────────────────────────────────────────

function handleError(err) {
  const msg = err instanceof GobletError
    ? err.message
    : 'An unexpected error occurred. Please try again.';
  setStatus('error', msg);
  console.error('[Gob Goblet]', err);
}

// ─── Reset ────────────────────────────────────────────────────────────────────

function handleReset() {
  if (state.busy) return;
  // Revoke any held blob URL
  if (state.resultBlob) {
    state.resultBlob = null;
    state.resultName = null;
  }
  Object.assign(state, {
    phase: 'idle', mode: null, file: null,
    gobData: null, innerData: null,
    resultBlob: null, resultName: null, busy: false,
  });
  renderIdle();
}

// ─── Busy ─────────────────────────────────────────────────────────────────────

function setBusy(busy) {
  state.busy = busy;
  dom.actionBtn().disabled = busy;
  dom.fileSelectBtn().disabled = busy;
  dom.resetBtn().disabled = busy;
  dom.dropZone().style.pointerEvents = busy ? 'none' : '';
}

function updateActionBtn() {
  dom.actionBtn().disabled = !state.file || state.busy;
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function hide(...ids) {
  ids.forEach(id => $(id)?.classList.add('hidden'));
}

function show(...ids) {
  ids.forEach(id => $(id)?.classList.remove('hidden'));
}

// ─── File I/O ─────────────────────────────────────────────────────────────────

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(new GobletError('Failed to read the file.'));
    r.readAsArrayBuffer(file);
  });
}

function readFileAsText(file, maxBytes) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(new Error('Cannot read file as text'));
    // If maxBytes is given, read a slice; otherwise read the entire file
    const src = maxBytes != null ? file.slice(0, maxBytes) : file;
    r.readAsText(src, 'utf-8');
  });
}

function triggerDownload(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function formatBytes(n) {
  if (n === 0) return '0 B';
  const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${parseFloat((n / Math.pow(k, i)).toFixed(1))} ${s[i]}`;
}
