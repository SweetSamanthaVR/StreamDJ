/**
 * StreamDJ Web UI Client-Side JavaScript
 *
 * Main application logic for the StreamDJ control panel interface.
 * Extracted from webui.ejs for better maintainability.
 *
 * Requires window.INITIAL_STATE and window.CONFIG to be set before loading.
 */

/* global INITIAL_STATE, CONFIG */

'use strict';

/* ==========================================================================
 * Application State
 * ========================================================================== */

const state = {
  playerCurrent: INITIAL_STATE.playerCurrent,
  playlist: INITIAL_STATE.playlist || [],
  serverStatus: INITIAL_STATE.serverStatus,
  lastTimestamp: INITIAL_STATE.timestamp,
};

const API_KEY = CONFIG && CONFIG.apiKey ? CONFIG.apiKey : null;

const overlayStyleState = {
  snapshot: null,
  pending: null,
  dirty: false,
  busy: false,
  capabilities: { letterSpacing: true },
};

/* ==========================================================================
 * DOM Element References
 * ========================================================================== */

const elements = {
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  statusBadge: document.getElementById('status-badge'),
  title: document.getElementById('track-title'),
  artist: document.getElementById('track-artist'),
  album: document.getElementById('track-album'),
  duration: document.getElementById('track-duration'),
  position: document.getElementById('track-position'),
  playbackState: document.getElementById('playback-state'),
  btnPrevious: document.getElementById('btn-previous'),
  btnPlay: document.getElementById('btn-play'),
  btnNext: document.getElementById('btn-next'),
  tcpPort: document.getElementById('tcp-port'),
  playerPort: document.getElementById('player-port'),
  httpPort: document.getElementById('http-port'),
  bitrate: document.getElementById('bitrate'),
  restarts: document.getElementById('restarts'),
  background: document.getElementById('background'),
  playlistBody: document.getElementById('playlist-body'),
  lastUpdate: document.getElementById('last-update'),
  toast: document.getElementById('toast'),
  backgroundForm: document.getElementById('background-form'),
  backgroundInput: document.getElementById('background-input'),
  clearBackground: document.getElementById('btn-clear-background'),
  uploadForm: document.getElementById('upload-background-form'),
  uploadInput: document.getElementById('background-upload-input'),
  uploadBtn: document.getElementById('btn-background-upload'),
  uploadSubmit: document.getElementById('btn-upload-submit'),
  uploadProgress: document.getElementById('upload-progress'),
  uploadProgressBar: document.getElementById('upload-progress-bar'),
  uploadStatus: document.getElementById('upload-status'),
  uploadFilename: document.getElementById('upload-filename'),
  recentUploadsList: document.getElementById('recent-uploads-list'),
  recentUploadsSection: document.getElementById('recent-uploads-section'),
  overlayForm: document.getElementById('overlay-style-form'),
  overlaySave: document.getElementById('btn-style-save'),
  overlayReset: document.getElementById('btn-style-reset'),
  overlayMeta: document.getElementById('overlay-style-meta'),
  overlayPreview: document.getElementById('overlay-preview'),
  previewHeader: document.getElementById('preview-header'),
  previewTitle: document.getElementById('preview-title'),
  previewArtist: document.getElementById('preview-artist'),
  previewAlbum: document.getElementById('preview-album'),
  previewComment: document.getElementById('preview-comment'),
  letterSpacingInput: document.getElementById('style-letter-spacing'),
  letterSpacingWarning: document.getElementById('letter-spacing-warning'),
};

const overlayStyleInputs = Array.from(document.querySelectorAll('[data-style-path]'));

let progressTimer = null;

/* ==========================================================================
 * Utility Functions
 * ========================================================================== */

function formatDuration(value) {
  if (!Number.isFinite(value) || value <= 0) return '--:--';
  const total = Math.round(value);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

let toastTimer = null;

function showToast(message, type = 'info') {
  if (!elements.toast) return;
  elements.toast.textContent = message;
  elements.toast.className = `toast ${type} visible`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elements.toast.classList.remove('visible');
  }, 2600);
}

function cloneDeep(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function getValueAtPath(obj, path) {
  return path
    .split('.')
    .reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function setValueAtPath(obj, path, value) {
  const keys = path.split('.');
  let target = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (typeof target[key] !== 'object' || target[key] === null) target[key] = {};
    target = target[key];
  }
  target[keys[keys.length - 1]] = value;
}

function appendPrefix(prefix, value) {
  if (!prefix) return value;
  return /\s$/.test(prefix) ? `${prefix}${value}` : `${prefix} ${value}`;
}

function hexToRgba(hex, alpha = 1) {
  const normalized = typeof hex === 'string' ? hex.replace('#', '') : 'FFFFFF';
  const match = /^([0-9a-fA-F]{6})$/.exec(normalized);
  const safe = match ? match[1] : 'FFFFFF';
  const r = parseInt(safe.slice(0, 2), 16);
  const g = parseInt(safe.slice(2, 4), 16);
  const b = parseInt(safe.slice(4, 6), 16);
  const clamped = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${clamped.toFixed(2)})`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function buildApiHeaders(contentType) {
  const headers = {};
  if (contentType) headers['Content-Type'] = contentType;
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;
  return headers;
}

/* ==========================================================================
 * Overlay Style Form Helpers
 * ========================================================================== */

function setInputFromValue(input, value) {
  if (!input) return;
  const scale = input.dataset.scale;
  if (input.type === 'checkbox') {
    input.checked = Boolean(value);
    return;
  }
  if (scale === 'percent') {
    const percent = Math.round(Number(value) * 100);
    input.value = Number.isFinite(percent) ? String(percent) : input.value;
    return;
  }
  if (input.dataset.type === 'number') {
    input.value = value !== undefined && value !== null ? String(value) : '';
    return;
  }
  input.value = value !== undefined && value !== null ? value : '';
}

function extractInputValue(input) {
  if (input.dataset.type === 'boolean') return input.checked;
  if (input.dataset.scale === 'percent')
    return Math.max(0, Math.min(100, Number(input.value))) / 100;
  if (input.dataset.type === 'number') return Number(input.value);
  return input.value;
}

function updateOverlayPreview() {
  if (!overlayStyleState.pending || !elements.overlayPreview) return;

  const style = overlayStyleState.pending;
  const font = style.font || {};
  const box = style.box || {};
  const labels = style.labels || {};
  const layout = style.layout || {};

  // Visual updates for preview box
  const previewBox = elements.overlayPreview.querySelector('.preview-box');
  const previewElement = elements.overlayPreview.querySelector('.preview-element');

  previewBox.style.setProperty(
    '--preview-font-color',
    hexToRgba(font.color || '#FFFFFF', font.opacity ?? 1)
  );
  previewBox.style.setProperty('--preview-font-size', `${font.size ?? 48}px`);
  previewBox.style.setProperty('--preview-letter-spacing', `${font.letterSpacing ?? 0}px`);
  previewBox.style.setProperty('--preview-line-spacing', `${font.lineSpacing ?? 12}px`);
  previewBox.style.setProperty(
    '--preview-box-color',
    hexToRgba(box.color || '#000000', box.opacity ?? 0.45)
  );

  // Box Border / Enable
  if (box.enabled === false) {
    previewBox.style.background = 'transparent';
    previewBox.style.border = '1px dashed rgba(255,255,255,0.2)';
  } else {
    previewBox.style.border = `${box.borderWidth || 0}px solid rgba(255,255,255,0.1)`;
  }

  // Layout Alignment
  previewElement.style.justifyContent =
    layout.horizontal === 'left'
      ? 'flex-start'
      : layout.horizontal === 'right'
        ? 'flex-end'
        : 'center';
  previewElement.style.alignItems =
    layout.vertical === 'top' ? 'flex-start' : layout.vertical === 'bottom' ? 'flex-end' : 'center';

  // Mock Offsets (scaled down for preview)
  const offX = (layout.offsetX || 0) / 4;
  const offY = (layout.offsetY || 0) / 4;
  previewBox.style.transform = `translate(${offX}px, ${offY}px)`;

  // Content
  if (elements.previewHeader) {
    if (labels.showHeader && labels.headerText) {
      elements.previewHeader.textContent = labels.headerText;
      elements.previewHeader.style.display = 'block';
    } else {
      elements.previewHeader.textContent = '';
      elements.previewHeader.style.display = 'none';
    }
  }

  const sampleTitle = state.playerCurrent?.track?.title || 'Song Title';
  const sampleArtist = state.playerCurrent?.track?.artist || 'Example Artist';
  const sampleAlbum = state.playerCurrent?.track?.album || 'Example Album';
  const sampleComment = state.serverStatus?.lastMetadata?.comment || 'Duration 3:45';

  if (elements.previewTitle)
    elements.previewTitle.textContent = appendPrefix(labels.titlePrefix, sampleTitle);
  if (elements.previewArtist)
    elements.previewArtist.textContent = appendPrefix(labels.artistPrefix, sampleArtist);

  if (elements.previewAlbum) {
    if (labels.showAlbum !== false) {
      elements.previewAlbum.textContent = appendPrefix(labels.albumPrefix, sampleAlbum);
      elements.previewAlbum.style.display = 'block';
    } else {
      elements.previewAlbum.style.display = 'none';
    }
  }

  if (elements.previewComment)
    elements.previewComment.textContent = appendPrefix(labels.commentPrefix || '', sampleComment);
}

function updateOverlayMeta(snapshot) {
  if (!elements.overlayMeta || !snapshot) return;
  elements.overlayMeta.textContent = `v${snapshot.version} (Synced)`;
}

function applyOverlayInputs(values) {
  overlayStyleInputs.forEach((input) => {
    const path = input.dataset.stylePath;
    if (!path) return;
    const value = getValueAtPath(values, path);
    setInputFromValue(input, value);
  });
  updateOverlayPreview();
}

function applyOverlayCapabilities(snapshot) {
  const caps = snapshot && typeof snapshot === 'object' ? snapshot.capabilities || {} : {};
  overlayStyleState.capabilities = caps;
  const letterSpacingEnabled = caps.letterSpacing !== false;
  if (elements.letterSpacingInput) {
    elements.letterSpacingInput.disabled = !letterSpacingEnabled;
  }
}

function handleOverlayInputChange(event) {
  console.log('[DEBUG] handleOverlayInputChange called', event.target);
  if (!overlayStyleState.pending) {
    console.warn('[DEBUG] overlayStyleState.pending is null, cannot handle change');
    return;
  }
  const input = event.target;
  if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLSelectElement)) {
    console.warn('[DEBUG] target is not an input or select', input);
    return;
  }
  const path = input.dataset.stylePath;
  if (!path) {
    console.warn('[DEBUG] input has no data-style-path', input);
    return;
  }
  const value = extractInputValue(input);
  console.log('[DEBUG] Setting', path, '=', value);
  setValueAtPath(overlayStyleState.pending, path, value);
  overlayStyleState.dirty = true;
  if (elements.overlaySave) elements.overlaySave.disabled = false;
  updateOverlayPreview();
}

overlayStyleInputs.forEach((input) => {
  const eventName = input.type === 'range' || input.type === 'color' ? 'input' : 'change';
  input.addEventListener(eventName, handleOverlayInputChange);
});

if (elements.overlayForm) {
  elements.overlayForm.addEventListener('change', handleOverlayInputChange);
  elements.overlayForm.addEventListener('input', handleOverlayInputChange);
}

/* ==========================================================================
 * Overlay Style API
 * ========================================================================== */

async function loadOverlayStyle() {
  console.log('[DEBUG] loadOverlayStyle called, overlayForm exists:', !!elements.overlayForm);
  if (!elements.overlayForm) return;
  try {
    console.log('[DEBUG] Fetching /api/overlay/style with headers:', buildApiHeaders());
    const response = await fetch('/api/overlay/style', {
      cache: 'no-store',
      headers: buildApiHeaders(),
    });
    console.log('[DEBUG] Response status:', response.status);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    console.log('[DEBUG] Loaded overlay style (full):', JSON.stringify(data, null, 2));
    console.log('[DEBUG] data.values:', data.values);
    overlayStyleState.snapshot = data;
    overlayStyleState.pending = cloneDeep(data.values);
    console.log('[DEBUG] overlayStyleState.pending set to:', overlayStyleState.pending);
    overlayStyleState.dirty = false;
    if (elements.overlaySave) elements.overlaySave.disabled = true;
    applyOverlayCapabilities(data);
    updateOverlayMeta(data);
    applyOverlayInputs(data.values);
  } catch (err) {
    console.error('Overlay style load failed', err);
    showToast('Unable to load overlay style', 'error');
  }
}

async function saveOverlayStyle() {
  if (!overlayStyleState.pending || overlayStyleState.busy) return;
  overlayStyleState.busy = true;
  if (elements.overlaySave) elements.overlaySave.disabled = true;
  try {
    const body = {
      version: overlayStyleState.snapshot?.version,
      values: overlayStyleState.pending,
    };
    const response = await fetch('/api/overlay/style', {
      method: 'PUT',
      headers: buildApiHeaders('application/json'),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Save failed');
    }
    showToast('Overlay style saved', 'success');
    await loadOverlayStyle();
  } catch (err) {
    console.error('Overlay style save failed', err);
    showToast(`Save failed: ${err.message}`, 'error');
    if (elements.overlaySave) elements.overlaySave.disabled = false;
  } finally {
    overlayStyleState.busy = false;
  }
}

async function resetOverlayStyleSettings() {
  if (overlayStyleState.busy) return;
  if (!confirm('Reset styles to default?')) return;
  overlayStyleState.busy = true;
  try {
    const response = await fetch('/api/overlay/style/reset', {
      method: 'POST',
      headers: buildApiHeaders(),
    });
    if (!response.ok) throw new Error('Reset failed');
    showToast('Overlay style reset', 'success');
    await loadOverlayStyle();
  } catch (err) {
    showToast('Overlay style reset failed', 'error');
  } finally {
    overlayStyleState.busy = false;
  }
}

/* ==========================================================================
 * Status & Track UI Updates
 * ========================================================================== */

function updateStatus(status) {
  if (!status) {
    elements.statusBadge.className = 'status-badge status-error';
    elements.statusText.textContent = 'Offline';
    elements.bitrate.textContent = '0 kbps';
    elements.restarts.textContent = '0';
    elements.background.textContent = 'None';
    elements.tcpPort.textContent = '-';
    elements.playerPort.textContent = '-';
    return;
  }
  const isOnline = Boolean(status.connected);
  elements.statusBadge.className = isOnline
    ? 'status-badge status-healthy'
    : 'status-badge status-warning';
  elements.statusText.textContent = isOnline ? 'Live' : 'Ready';

  elements.bitrate.textContent = `${Math.round(status.bitrateKbps || 0)} kbps`;
  elements.restarts.textContent = String(status.ffmpegRestarts || 0);
  elements.background.textContent = status.backgroundSource || 'None';
  elements.tcpPort.textContent = String(status.tcpPort);
  elements.playerPort.textContent = String(status.playerApiPort);
}

function updateTrack(current) {
  if (!current || !current.track) {
    elements.title.textContent = 'Waiting for player...';
    elements.artist.textContent = '--';
    elements.album.textContent = '--';
    elements.duration.textContent = '--:--';
    elements.position.textContent = '0:00';
    elements.playbackState.textContent = 'Idle';
    elements.btnPlay.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
    elements.btnPlay.dataset.mode = 'resume';
    return;
  }

  const { track, isPlaying, isPaused, positionSeconds } = current;
  elements.title.textContent = track.title || track.filename;
  elements.artist.textContent = track.artist || 'Unknown Artist';
  elements.album.textContent = track.album || 'Unknown Album';
  elements.duration.textContent = formatDuration(track.duration);

  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }

  const initialPosition = Number(positionSeconds || 0);
  let currentPosition = initialPosition;
  elements.position.textContent = formatDuration(currentPosition);

  if (isPlaying && !isPaused) {
    progressTimer = setInterval(() => {
      currentPosition += 1;
      elements.position.textContent = formatDuration(currentPosition);
    }, 1000);
  }

  if (isPaused) {
    elements.playbackState.textContent = 'Paused';
    elements.btnPlay.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>'; // Play Icon
    elements.btnPlay.dataset.mode = 'resume';
  } else if (isPlaying) {
    elements.playbackState.textContent = 'Playing';
    elements.btnPlay.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>'; // Pause Icon
    elements.btnPlay.dataset.mode = 'pause';
  } else {
    elements.playbackState.textContent = 'Ready';
    elements.btnPlay.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
    elements.btnPlay.dataset.mode = 'resume';
  }
}

function renderPlaylist(list, currentTrack) {
  const body = elements.playlistBody;
  if (!list || list.length === 0) {
    body.innerHTML =
      '<tr><td colspan="4" class="empty-state" style="text-align:center; padding:2rem; color:var(--text-secondary)">No tracks available.</td></tr>';
    return;
  }
  const currentFilename = currentTrack && currentTrack.track ? currentTrack.track.filename : null;
  body.innerHTML = '';
  for (const entry of list) {
    const row = document.createElement('tr');
    if (entry.filename === currentFilename) {
      row.style.background = 'rgba(129, 140, 248, 0.1)';
      row.style.color = 'var(--accent)';
    }

    row.innerHTML = `
        <td>${entry.index + 1}</td>
        <td style="font-weight:600">${entry.title || entry.filename}</td>
        <td style="color:var(--text-secondary)">${entry.artist || 'Unknown'}</td>
        <td style="font-family:var(--font-mono); font-size:0.85rem">${formatDuration(entry.duration)}</td>
    `;
    body.appendChild(row);
  }
}

function applyState(next) {
  const prevBackground = state.serverStatus?.backgroundSource;
  state.playerCurrent = next.playerCurrent;
  state.playlist = next.playlist;
  state.serverStatus = next.serverStatus;
  state.lastTimestamp = next.timestamp;
  updateTrack(state.playerCurrent);
  updateStatus(state.serverStatus);
  renderPlaylist(state.playlist, state.playerCurrent);
  elements.lastUpdate.textContent = `Last update: ${new Date(state.lastTimestamp).toLocaleTimeString()}`;
  updateOverlayPreview();

  /* Refresh recent backgrounds list if active background changed */
  if (prevBackground !== state.serverStatus?.backgroundSource) {
    loadRecentBackgrounds();
  }
}

/* ==========================================================================
 * API Interactions
 * ========================================================================== */

async function refreshState() {
  try {
    const response = await fetch('/api/state', { cache: 'no-store', headers: buildApiHeaders() });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    applyState(data);
  } catch (err) {
    console.error('State refresh failed', err);
    updateStatus(null);
  }
}

async function sendAction(action) {
  const buttonMap = {
    previous: elements.btnPrevious,
    pause: elements.btnPlay,
    resume: elements.btnPlay,
    next: elements.btnNext,
  };
  const button = buttonMap[action];
  if (button) button.disabled = true;
  try {
    const response = await fetch(`/api/player/${action}`, {
      method: 'POST',
      headers: buildApiHeaders(),
    });
    if (!response.ok) throw new Error(await response.text());
    await refreshState();
    showToast(action === 'pause' ? 'Playback paused' : 'Command sent', 'success');
  } catch (err) {
    showToast(`Action failed: ${err.message}`, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

/* ==========================================================================
 * Background Management
 * ========================================================================== */

async function loadRecentBackgrounds() {
  try {
    const response = await fetch(`${CONFIG.serverBase}/api/backgrounds`, {
      headers: buildApiHeaders(),
    });
    if (!response.ok) return;
    const data = await response.json();
    const backgrounds = data.backgrounds || [];

    if (backgrounds.length === 0) {
      if (elements.recentUploadsSection) elements.recentUploadsSection.style.display = 'none';
      return;
    }

    /* Get the current active background filename for comparison */
    const currentBgSource = state.serverStatus?.backgroundSource || '';
    const currentBgFilename = currentBgSource.split(/[/\\]/).pop() || '';

    if (elements.recentUploadsSection) elements.recentUploadsSection.style.display = 'block';
    if (elements.recentUploadsList) {
      elements.recentUploadsList.innerHTML = backgrounds
        .slice(0, 5)
        .map((bg) => {
          const isActive = bg.filename === currentBgFilename;
          const useDisabled = isActive ? 'disabled title="Currently active"' : '';
          const deleteDisabled = isActive ? 'disabled title="Cannot delete active background"' : '';
          const deleteStyle = isActive
            ? 'background: rgba(100, 100, 100, 0.1); color: var(--text-secondary); cursor: not-allowed;'
            : 'background: rgba(239, 68, 68, 0.1); color: var(--danger);';
          const activeLabel = isActive
            ? '<span style="color: var(--accent); font-size: 0.7rem; margin-left: 0.5rem;">(Active)</span>'
            : '';
          return `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; background: var(--bg-input); border-radius: 4px; font-size: 0.85rem;">
          <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            <div style="color: var(--text-primary); margin-bottom: 0.25rem;">${escapeHtml(bg.filename)}${activeLabel}</div>
            <div style="color: var(--text-secondary); font-size: 0.75rem;">${(bg.size / 1024 / 1024).toFixed(1)} MB</div>
          </div>
          <div style="display: flex; gap: 8px; margin-left: 0.5rem;">
            <button type="button" class="btn btn-sm" onclick="setBackgroundByFilename('${escapeHtml(bg.filename)}'); return false;" ${useDisabled}>Use</button>
            <button type="button" class="btn btn-sm" onclick="deleteBackground('${escapeHtml(bg.filename)}'); return false;" style="${deleteStyle}" ${deleteDisabled}>Delete</button>
          </div>
        </div>
      `;
        })
        .join('');
    }
  } catch (err) {
    console.error('Failed to load recent backgrounds:', err);
  }
}

// Expose to global scope for inline onclick handlers
window.setBackgroundByFilename = function (filename) {
  if (!filename) return;
  setBackgroundByPath(filename);
};

async function setBackgroundByPath(filePath) {
  try {
    const response = await fetch(`${CONFIG.serverBase}/background`, {
      method: 'POST',
      headers: buildApiHeaders('application/json'),
      body: JSON.stringify({ path: filePath }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Failed');
    }
    showToast('Background set', 'success');
    await refreshState();
  } catch (err) {
    showToast(`Failed to set background: ${err.message}`, 'error');
  }
}

// Expose to global scope for inline onclick handlers
window.deleteBackground = async function (filename) {
  if (!confirm('Delete this background?')) return;
  try {
    const response = await fetch(
      `${CONFIG.serverBase}/api/backgrounds/${encodeURIComponent(filename)}`,
      { method: 'DELETE', headers: buildApiHeaders() }
    );
    if (!response.ok) throw new Error('Failed');
    showToast('Background deleted', 'success');
    await loadRecentBackgrounds();
  } catch (err) {
    showToast('Failed to delete background', 'error');
  }
};

/* ==========================================================================
 * Technical / Diagnostics Page Logic
 * ========================================================================== */

const diagElements = {
  pageDashboard: document.getElementById('page-dashboard'),
  pageOverlay: document.getElementById('page-overlay'),
  pageTechnical: document.getElementById('page-technical'),
  streamState: document.getElementById('diag-stream-state'),
  state: document.getElementById('diag-state'),
  sessionUptime: document.getElementById('diag-session-uptime'),
  totalUptime: document.getElementById('diag-total-uptime'),
  restartCount: document.getElementById('diag-restart-count'),
  lastRestartReason: document.getElementById('diag-last-restart-reason'),
  lastRestartTime: document.getElementById('diag-last-restart-time'),
  lastError: document.getElementById('diag-last-error'),
  ffmpegPid: document.getElementById('diag-ffmpeg-pid'),
  ffmpegRunning: document.getElementById('diag-ffmpeg-running'),
  ffmpegUptime: document.getElementById('diag-ffmpeg-uptime'),
  rtmpConnected: document.getElementById('diag-rtmp-connected'),
  ffmpegRestarts: document.getElementById('diag-ffmpeg-restarts'),
  ffmpegBlocked: document.getElementById('diag-ffmpeg-blocked'),
  producerConnected: document.getElementById('diag-producer-connected'),
  silenceActive: document.getElementById('diag-silence-active'),
  ingestTotal: document.getElementById('diag-ingest-total'),
  endpoint: document.getElementById('diag-endpoint'),
  connectionType: document.getElementById('diag-connection-type'),
  bytesTransferred: document.getElementById('diag-bytes-transferred'),
  throughput: document.getElementById('diag-throughput'),
  platform: document.getElementById('diag-platform'),
  nodeVersion: document.getElementById('diag-node-version'),
  cpus: document.getElementById('diag-cpus'),
  memory: document.getElementById('diag-memory'),
  load: document.getElementById('diag-load'),
  processUptime: document.getElementById('diag-process-uptime'),
  restartHistory: document.getElementById('diag-restart-history'),
  events: document.getElementById('diag-events'),
  logViewer: document.getElementById('log-viewer'),
  logLevelFilter: document.getElementById('log-level-filter'),
  logSearch: document.getElementById('log-search'),
  logCount: document.getElementById('log-count'),
  diagLastUpdate: document.getElementById('diag-last-update'),
  btnCopyLogs: document.getElementById('btn-copy-logs'),
  btnDownloadLogs: document.getElementById('btn-download-logs'),
  btnClearLogs: document.getElementById('btn-clear-logs'),
  btnExportDiagnostics: document.getElementById('btn-export-diagnostics'),
  btnCopyDiagnostics: document.getElementById('btn-copy-diagnostics'),
};

let currentDiagnostics = null;
let currentLogs = [];
let diagPollInterval = null;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatUptime(ms) {
  if (!ms || ms <= 0) return '--';
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

function formatTime(isoString) {
  if (!isoString) return '--';
  try {
    return new Date(isoString).toLocaleTimeString();
  } catch {
    return isoString;
  }
}

function formatDateTime(isoString) {
  if (!isoString) return '--';
  try {
    return new Date(isoString).toLocaleString();
  } catch {
    return isoString;
  }
}

function sanitizeEndpoint(url) {
  if (!url) return '--';
  try {
    /* Hide stream key from URL */
    return url.replace(/\/[^\/]+$/, '/***');
  } catch {
    return url;
  }
}

function getStateClass(state) {
  switch (state) {
    case 'streaming':
      return 'success';
    case 'connecting':
    case 'reconnecting':
    case 'buffering':
      return 'warning';
    case 'error':
      return 'error';
    default:
      return '';
  }
}

function updateDiagnosticsUI(data) {
  if (!data) return;

  const lifecycle = data.streamLifecycle || {};
  const serverState = data.serverState || {};
  const network = data.networkStats || {};
  const env = data.environment || {};

  /* Stream Lifecycle */
  if (diagElements.state) {
    diagElements.state.textContent = lifecycle.state || 'unknown';
    diagElements.state.className = `diag-stat-value ${getStateClass(lifecycle.state)}`;
  }
  if (diagElements.streamState) {
    const stateText = lifecycle.state ? lifecycle.state.toUpperCase() : 'UNKNOWN';
    diagElements.streamState.textContent = stateText;
    diagElements.streamState.className = `status-badge status-${getStateClass(lifecycle.state) || 'warning'}`;
  }
  if (diagElements.sessionUptime)
    diagElements.sessionUptime.textContent = formatUptime(lifecycle.sessionUptimeMs);
  if (diagElements.totalUptime)
    diagElements.totalUptime.textContent = formatUptime(lifecycle.totalUptimeMs);
  if (diagElements.restartCount)
    diagElements.restartCount.textContent = String(lifecycle.restartCount || 0);
  if (diagElements.lastRestartReason)
    diagElements.lastRestartReason.textContent = lifecycle.lastRestartReason || '--';
  if (diagElements.lastRestartTime)
    diagElements.lastRestartTime.textContent = formatDateTime(lifecycle.lastRestartTimestamp);
  if (diagElements.lastError) {
    const err = lifecycle.lastError;
    diagElements.lastError.textContent = err
      ? typeof err === 'object'
        ? JSON.stringify(err)
        : String(err)
      : 'None';
    diagElements.lastError.className = `diag-stat-value ${err ? 'error' : ''}`;
  }

  /* Server State */
  if (diagElements.ffmpegPid) diagElements.ffmpegPid.textContent = serverState.ffmpegPid || '--';
  if (diagElements.ffmpegRunning) {
    diagElements.ffmpegRunning.textContent = serverState.ffmpegRunning ? 'Yes' : 'No';
    diagElements.ffmpegRunning.className = `diag-stat-value ${serverState.ffmpegRunning ? 'success' : 'warning'}`;
  }
  if (diagElements.ffmpegUptime)
    diagElements.ffmpegUptime.textContent = formatUptime(serverState.ffmpegUptimeMs);
  if (diagElements.rtmpConnected) {
    diagElements.rtmpConnected.textContent = serverState.rtmpConnected ? 'Yes' : 'No';
    diagElements.rtmpConnected.className = `diag-stat-value ${serverState.rtmpConnected ? 'success' : 'error'}`;
  }
  if (diagElements.ffmpegRestarts)
    diagElements.ffmpegRestarts.textContent = String(serverState.ffmpegRestarts || 0);
  if (diagElements.ffmpegBlocked) {
    diagElements.ffmpegBlocked.textContent = serverState.ffmpegBlocked ? 'BLOCKED' : 'No';
    diagElements.ffmpegBlocked.className = `diag-stat-value ${serverState.ffmpegBlocked ? 'error' : ''}`;
  }
  if (diagElements.producerConnected) {
    diagElements.producerConnected.textContent = serverState.producerConnected ? 'Yes' : 'No';
    diagElements.producerConnected.className = `diag-stat-value ${serverState.producerConnected ? 'success' : 'warning'}`;
  }
  if (diagElements.silenceActive)
    diagElements.silenceActive.textContent = serverState.silenceActive ? 'Yes' : 'No';
  if (diagElements.ingestTotal && serverState.ingestStats) {
    diagElements.ingestTotal.textContent = `${formatBytes(serverState.ingestStats.bytesTotal)} (${serverState.ingestStats.chunksTotal || 0} chunks)`;
  }

  /* Network */
  if (diagElements.endpoint) diagElements.endpoint.textContent = sanitizeEndpoint(network.endpoint);
  if (diagElements.connectionType)
    diagElements.connectionType.textContent = network.connectionType || '--';
  if (diagElements.bytesTransferred)
    diagElements.bytesTransferred.textContent = formatBytes(network.bytesTransferred);
  if (diagElements.throughput)
    diagElements.throughput.textContent = `${(network.throughputKbps || 0).toFixed(1)} kbps`;

  /* Environment */
  if (diagElements.platform)
    diagElements.platform.textContent = `${env.platform || '--'} (${env.arch || '--'})`;
  if (diagElements.nodeVersion) diagElements.nodeVersion.textContent = env.nodeVersion || '--';
  if (diagElements.cpus) diagElements.cpus.textContent = String(env.cpus || '--');
  if (diagElements.memory)
    diagElements.memory.textContent = `${env.freeMemoryMB || '--'} MB / ${env.totalMemoryMB || '--'} MB`;
  if (diagElements.load && env.loadAverage) {
    diagElements.load.textContent = env.loadAverage.map((v) => v.toFixed(2)).join(', ');
  }
  if (diagElements.processUptime)
    diagElements.processUptime.textContent = formatUptime((env.processUptimeSeconds || 0) * 1000);

  /* Restart History */
  if (diagElements.restartHistory && data.restartHistory) {
    const restarts = data.restartHistory.slice().reverse();
    if (restarts.length === 0) {
      diagElements.restartHistory.innerHTML =
        '<div style="color: var(--text-secondary); text-align: center; padding: 1rem;">No restarts recorded</div>';
    } else {
      diagElements.restartHistory.innerHTML = restarts
        .map(
          (r) => `
        <div class="restart-history-item">
          <div class="restart-reason">${escapeHtml(r.reason || 'Unknown')}</div>
          <div class="restart-meta">
            <span>Trigger: ${escapeHtml(r.trigger || '--')}</span> &bull;
            <span>${formatDateTime(r.timestamp)}</span>
          </div>
        </div>
      `
        )
        .join('');
    }
  }

  /* Recent Events */
  if (diagElements.events && data.recentEvents) {
    const events = data.recentEvents.slice().reverse();
    if (events.length === 0) {
      diagElements.events.innerHTML =
        '<div style="color: var(--text-secondary); text-align: center; padding: 1rem;">No events recorded</div>';
    } else {
      diagElements.events.innerHTML = events
        .map((e) => {
          let itemClass = 'event-item';
          if (e.type.includes('restart')) itemClass += ' restart';
          if (e.type.includes('error') || e.type.includes('unexpectedExit')) itemClass += ' error';
          if (e.type.includes('start')) itemClass += ' start';
          return `
          <div class="${itemClass}">
            <div class="event-type">${escapeHtml(e.type)}</div>
            <div class="event-time">${formatDateTime(e.timestamp)}</div>
            ${e.data && Object.keys(e.data).length > 0 ? `<div class="event-data">${escapeHtml(JSON.stringify(e.data, null, 2).substring(0, 500))}</div>` : ''}
          </div>
        `;
        })
        .join('');
    }
  }

  if (diagElements.diagLastUpdate) {
    diagElements.diagLastUpdate.textContent = `Diagnostics last updated: ${new Date().toLocaleTimeString()}`;
  }
}

function renderLogs(logs) {
  if (!diagElements.logViewer) return;

  const searchTerm = (diagElements.logSearch?.value || '').toLowerCase();
  let filtered = logs;

  if (searchTerm) {
    filtered = logs.filter(
      (log) =>
        (log.message || '').toLowerCase().includes(searchTerm) ||
        (log.scope || '').toLowerCase().includes(searchTerm)
    );
  }

  if (diagElements.logCount) {
    diagElements.logCount.textContent = `${filtered.length} entries`;
  }

  if (filtered.length === 0) {
    diagElements.logViewer.innerHTML =
      '<div style="color: var(--text-secondary); text-align: center; padding: 2rem;">No matching logs</div>';
    return;
  }

  /* Show most recent first, limit to 500 for performance */
  const displayLogs = filtered.slice(-500).reverse();

  diagElements.logViewer.innerHTML = displayLogs
    .map(
      (log) => `
    <div class="log-entry">
      <span class="log-time">${formatDateTime(log.timestamp)}</span>
      <span class="log-level ${log.level}">${log.level}</span>
      <span class="log-scope">${escapeHtml(log.scope || 'app')}</span>
      <span class="log-message">${escapeHtml(log.message || '')}</span>
    </div>
  `
    )
    .join('');
}

async function fetchDiagnostics() {
  try {
    const response = await fetch('/api/diagnostics', {
      cache: 'no-store',
      headers: buildApiHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    currentDiagnostics = await response.json();
    updateDiagnosticsUI(currentDiagnostics);
  } catch (err) {
    console.error('Diagnostics fetch failed:', err);
  }
}

async function fetchLogs() {
  try {
    const level = diagElements.logLevelFilter?.value || 'INFO';
    const response = await fetch(`/api/diagnostics/logs?level=${level}&limit=1000`, {
      cache: 'no-store',
      headers: buildApiHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    currentLogs = data.logs || [];
    renderLogs(currentLogs);
  } catch (err) {
    console.error('Logs fetch failed:', err);
  }
}

async function exportDiagnostics() {
  try {
    const response = await fetch('/api/diagnostics/export', {
      cache: 'no-store',
      headers: buildApiHeaders(),
    });
    if (!response.ok) throw new Error('Export failed');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `streamdj-diagnostics-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Diagnostics exported', 'success');
  } catch (err) {
    showToast('Export failed: ' + err.message, 'error');
  }
}

function copyDiagnosticsSummary() {
  if (!currentDiagnostics) {
    showToast('No diagnostics data available', 'error');
    return;
  }

  const summary = [
    '=== StreamDJ Diagnostics Summary ===',
    `Generated: ${new Date().toISOString()}`,
    '',
    '--- Stream Lifecycle ---',
    `State: ${currentDiagnostics.streamLifecycle?.state || 'unknown'}`,
    `Restart Count: ${currentDiagnostics.streamLifecycle?.restartCount || 0}`,
    `Last Restart: ${currentDiagnostics.streamLifecycle?.lastRestartReason || 'N/A'}`,
    `Last Error: ${currentDiagnostics.streamLifecycle?.lastError || 'None'}`,
    '',
    '--- Server State ---',
    `FFmpeg Running: ${currentDiagnostics.serverState?.ffmpegRunning ? 'Yes' : 'No'}`,
    `FFmpeg PID: ${currentDiagnostics.serverState?.ffmpegPid || 'N/A'}`,
    `FFmpeg Restarts: ${currentDiagnostics.serverState?.ffmpegRestarts || 0}`,
    `FFmpeg Blocked: ${currentDiagnostics.serverState?.ffmpegBlocked ? 'YES' : 'No'}`,
    `RTMP Connected: ${currentDiagnostics.serverState?.rtmpConnected ? 'Yes' : 'No'}`,
    '',
    '--- Recent Restarts ---',
    ...(currentDiagnostics.restartHistory || [])
      .slice(-5)
      .map((r) => `  - ${r.reason} (${r.trigger}) at ${r.timestamp}`),
  ].join('\n');

  navigator.clipboard
    .writeText(summary)
    .then(() => {
      showToast('Summary copied to clipboard', 'success');
    })
    .catch(() => {
      showToast('Failed to copy', 'error');
    });
}

function copyLogs() {
  const logsText = currentLogs
    .map((log) => `${log.timestamp} [${log.level}] [${log.scope}] ${log.message}`)
    .join('\n');

  navigator.clipboard
    .writeText(logsText)
    .then(() => {
      showToast('Logs copied to clipboard', 'success');
    })
    .catch(() => {
      showToast('Failed to copy logs', 'error');
    });
}

function downloadLogs() {
  const logsText = currentLogs
    .map((log) => `${log.timestamp} [${log.level}] [${log.scope}] ${log.message}`)
    .join('\n');

  const blob = new Blob([logsText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `streamdj-logs-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Logs downloaded', 'success');
}

async function clearDiagnostics() {
  if (!confirm('Clear all diagnostic data? This cannot be undone.')) return;
  try {
    const response = await fetch('/api/diagnostics/clear', {
      method: 'POST',
      headers: buildApiHeaders(),
    });
    if (!response.ok) throw new Error('Clear failed');
    showToast('Diagnostics cleared', 'success');
    await fetchDiagnostics();
    await fetchLogs();
  } catch (err) {
    showToast('Clear failed: ' + err.message, 'error');
  }
}

/* ==========================================================================
 * Page Navigation
 * ========================================================================== */

function showPage(pageName) {
  if (diagElements.pageDashboard) {
    diagElements.pageDashboard.classList.toggle('hidden', pageName !== 'dashboard');
  }
  if (diagElements.pageOverlay) {
    diagElements.pageOverlay.classList.toggle('hidden', pageName !== 'overlay');
  }
  if (diagElements.pageTechnical) {
    diagElements.pageTechnical.classList.toggle('hidden', pageName !== 'technical');
  }

  /* Update nav links */
  document.querySelectorAll('.nav-link').forEach((link) => {
    const linkPage = link.dataset.page || 'dashboard';
    link.classList.toggle('active', linkPage === pageName);
  });

  /* Start/stop diagnostics polling based on active page */
  if (pageName === 'technical') {
    fetchDiagnostics();
    fetchLogs();
    if (!diagPollInterval) {
      diagPollInterval = setInterval(() => {
        fetchDiagnostics();
        fetchLogs();
      }, 5000);
    }
  } else {
    if (diagPollInterval) {
      clearInterval(diagPollInterval);
      diagPollInterval = null;
    }
  }
}

/* Handle hash navigation */
function handleHashChange() {
  const hash = window.location.hash.replace('#', '');
  if (hash === 'technical') {
    showPage('technical');
  } else if (hash === 'overlay') {
    showPage('overlay');
  } else {
    showPage('dashboard');
  }
}

/* ==========================================================================
 * Event Listeners & Initialization
 * ========================================================================== */

/* Player control buttons */
elements.btnPrevious.addEventListener('click', () => sendAction('previous'));
elements.btnNext.addEventListener('click', () => sendAction('next'));
elements.btnPlay.addEventListener('click', () => {
  const mode = elements.btnPlay.dataset.mode || 'resume';
  sendAction(mode);
});

/* Background form */
elements.backgroundForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const pathValue = elements.backgroundInput.value.trim();
  try {
    const response = await fetch('/api/background', {
      method: 'POST',
      headers: buildApiHeaders('application/json'),
      body: JSON.stringify({ path: pathValue }),
    });
    if (!response.ok) throw new Error('Update failed');
    showToast('Overlay background updated', 'success');
    elements.backgroundInput.value = '';
    await refreshState();
  } catch (err) {
    showToast(`Background update failed: ${err.message}`, 'error');
  }
});

elements.clearBackground.addEventListener('click', async () => {
  elements.backgroundInput.value = '';
  try {
    const response = await fetch('/api/background', {
      method: 'POST',
      headers: buildApiHeaders('application/json'),
      body: JSON.stringify({ path: '' }),
    });
    if (!response.ok) throw new Error('Failed');
    showToast('Background cleared', 'success');
    await refreshState();
  } catch (err) {
    showToast('Failed to clear background', 'error');
  }
});

/* Overlay style form */
if (elements.overlayForm) {
  elements.overlayForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (confirm('Save overlay configuration changes? This will restart the stream.')) {
      saveOverlayStyle();
    }
  });
}

if (elements.overlayReset) {
  elements.overlayReset.addEventListener('click', () => {
    resetOverlayStyleSettings();
  });
}

/* Background upload handlers */
if (elements.uploadBtn) {
  elements.uploadBtn.addEventListener('click', () => {
    elements.uploadInput?.click();
  });
}

if (elements.uploadInput) {
  elements.uploadInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (elements.uploadFilename) {
        elements.uploadFilename.textContent = `Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
      }
      if (elements.uploadSubmit) elements.uploadSubmit.disabled = false;
    }
  });
}

if (elements.uploadForm) {
  elements.uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = elements.uploadInput?.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('background', file);

    if (elements.uploadProgress) elements.uploadProgress.style.display = 'block';
    if (elements.uploadSubmit) elements.uploadSubmit.disabled = true;

    try {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percent = (e.loaded / e.total) * 100;
          if (elements.uploadProgressBar) elements.uploadProgressBar.style.width = `${percent}%`;
          if (elements.uploadStatus) elements.uploadStatus.textContent = `${Math.round(percent)}%`;
        }
      });

      xhr.addEventListener('load', async () => {
        if (xhr.status === 201) {
          showToast('Background uploaded successfully', 'success');
          if (elements.uploadInput) elements.uploadInput.value = '';
          if (elements.uploadFilename) elements.uploadFilename.textContent = '';
          if (elements.uploadProgress) elements.uploadProgress.style.display = 'none';
          if (elements.uploadProgressBar) elements.uploadProgressBar.style.width = '0%';
          await loadRecentBackgrounds();
        } else {
          const data = JSON.parse(xhr.responseText);
          throw new Error(data.error || 'Upload failed');
        }
      });

      xhr.addEventListener('error', () => {
        throw new Error('Upload failed');
      });

      xhr.open('POST', `${CONFIG.serverBase}/api/backgrounds/upload`);
      if (API_KEY) {
        xhr.setRequestHeader('Authorization', `Bearer ${API_KEY}`);
      }
      xhr.send(formData);
    } catch (err) {
      showToast(`Upload error: ${err.message}`, 'error');
      if (elements.uploadProgress) elements.uploadProgress.style.display = 'none';
    } finally {
      if (elements.uploadSubmit) elements.uploadSubmit.disabled = false;
    }
  });
}

/* Navigation event listeners */
document.querySelectorAll('.nav-link').forEach((link) => {
  link.addEventListener('click', (e) => {
    const href = link.getAttribute('href');
    if (href && href.startsWith('#')) {
      const target = href.replace('#', '');
      if (target === 'technical') {
        showPage('technical');
      } else if (target === 'overlay') {
        showPage('overlay');
      } else {
        showPage('dashboard');
      }
    }
  });
});

/* Diagnostics event listeners */
if (diagElements.logLevelFilter) {
  diagElements.logLevelFilter.addEventListener('change', fetchLogs);
}
if (diagElements.logSearch) {
  let searchTimeout = null;
  diagElements.logSearch.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => renderLogs(currentLogs), 300);
  });
}
if (diagElements.btnCopyLogs) {
  diagElements.btnCopyLogs.addEventListener('click', copyLogs);
}
if (diagElements.btnDownloadLogs) {
  diagElements.btnDownloadLogs.addEventListener('click', downloadLogs);
}
if (diagElements.btnClearLogs) {
  diagElements.btnClearLogs.addEventListener('click', clearDiagnostics);
}
if (diagElements.btnExportDiagnostics) {
  diagElements.btnExportDiagnostics.addEventListener('click', exportDiagnostics);
}
if (diagElements.btnCopyDiagnostics) {
  diagElements.btnCopyDiagnostics.addEventListener('click', copyDiagnosticsSummary);
}

window.addEventListener('hashchange', handleHashChange);

/* ==========================================================================
 * Security Banner
 * ========================================================================== */

const securityBanner = document.getElementById('security-banner');
const dismissSecurityBanner = document.getElementById('dismiss-security-banner');

/**
 * Initialize security banner state from localStorage
 */
function initSecurityBanner() {
  const dismissed = localStorage.getItem('streamdj-security-banner-dismissed');
  if (dismissed === 'true' && securityBanner) {
    securityBanner.classList.add('hidden');
  }
}

/**
 * Dismiss the security banner and remember preference
 */
function dismissBanner() {
  if (securityBanner) {
    securityBanner.classList.add('hidden');
    localStorage.setItem('streamdj-security-banner-dismissed', 'true');
  }
}

if (dismissSecurityBanner) {
  dismissSecurityBanner.addEventListener('click', dismissBanner);
}

initSecurityBanner();

/* ==========================================================================
 * Application Bootstrap
 * ========================================================================== */

/* Apply initial state from server */
applyState(INITIAL_STATE);
loadOverlayStyle();
loadRecentBackgrounds();

/* Start state polling */
setInterval(refreshState, CONFIG.pollInterval || 3000);

/* Handle initial hash */
handleHashChange();
