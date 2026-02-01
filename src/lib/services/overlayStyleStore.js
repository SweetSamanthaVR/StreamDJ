'use strict';

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { createLogger } = require('../utils/logger');

const { log, warn } = createLogger('overlay-style');

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const CONFIG_PATH = path.join(ROOT_DIR, 'config', 'default-ffmpeg-overlay.json');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const STORE_PATH = path.join(DATA_DIR, 'ffmpeg-overlay-style.json');

const COLOR_PATTERN = /^#([0-9a-fA-F]{6})$/;
const H_ALIGN = new Set(['left', 'center', 'right']);
const V_ALIGN = new Set(['top', 'center', 'bottom']);

const BASELINE_STYLE = {
  font: { color: '#FFFFFF', opacity: 1, size: 48, lineSpacing: 12, letterSpacing: 0 },
  box: { enabled: true, color: '#000000', opacity: 0.45, borderWidth: 20 },
  layout: { horizontal: 'right', vertical: 'bottom', offsetX: 40, offsetY: 40 },
  labels: {
    showHeader: false,
    headerText: '',
    titlePrefix: '',
    artistPrefix: 'Artist: ',
    albumPrefix: 'Album: ',
    showAlbum: true,
    commentPrefix: '',
  },
};

const emitter = new EventEmitter();

let hasPersistedFile = false;
let defaultStyle = loadDefaultStyle();
let snapshot = loadInitialSnapshot();

function loadDefaultStyle() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeStyle(parsed, BASELINE_STYLE);
  } catch (err) {
    warn('Unable to read default overlay style config. Using baseline.', err.message);
    return clone(BASELINE_STYLE);
  }
}

function loadInitialSnapshot() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      hasPersistedFile = true;
      const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.values) {
        return {
          version: Number.isFinite(parsed.version) ? parsed.version : 1,
          updatedAt:
            typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
          values: normalizeStyle(parsed.values, defaultStyle),
        };
      }
    }
  } catch (err) {
    warn('Failed to read persisted overlay style. Falling back to defaults.', err.message);
  }
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    values: clone(defaultStyle),
  };
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function sanitizeColor(value, field) {
  if (typeof value !== 'string' || !COLOR_PATTERN.test(value.trim())) {
    throw new Error(`${field} must be a hex color in the form #RRGGBB`);
  }
  return value.trim().toUpperCase();
}

function sanitizeOpacity(value, field) {
  if (value === undefined || value === null) {
    return 1;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${field} must be a number between 0 and 1`);
  }
  return Number(clamp(value, 0, 1).toFixed(2));
}

function sanitizeText(value, field, maxLength) {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value !== 'string') {
    throw new Error(`${field} must be a string`);
  }
  const normalized = value.replace(/[\r\n]+/g, ' ').trim();
  if (normalized.length > maxLength) {
    throw new Error(`${field} exceeds maximum length of ${maxLength}`);
  }
  return normalized;
}

function normalizeStyle(payload, fallback) {
  const baseline = clone(fallback || BASELINE_STYLE);
  if (!payload || typeof payload !== 'object') {
    return baseline;
  }

  const next = baseline;

  if (payload.font && typeof payload.font === 'object') {
    if (payload.font.color !== undefined) {
      next.font.color = sanitizeColor(payload.font.color, 'font.color');
    }
    if (payload.font.opacity !== undefined) {
      next.font.opacity = sanitizeOpacity(payload.font.opacity, 'font.opacity');
    }
    if (payload.font.size !== undefined) {
      next.font.size = clamp(Number(payload.font.size), 16, 96);
    }
    if (payload.font.lineSpacing !== undefined) {
      next.font.lineSpacing = clamp(Number(payload.font.lineSpacing), 0, 64);
    }
    if (payload.font.letterSpacing !== undefined) {
      next.font.letterSpacing = clamp(Number(payload.font.letterSpacing), -10, 60);
    }
  }

  if (payload.box && typeof payload.box === 'object') {
    if (payload.box.enabled !== undefined) {
      next.box.enabled = Boolean(payload.box.enabled);
    }
    if (payload.box.color !== undefined) {
      next.box.color = sanitizeColor(payload.box.color, 'box.color');
    }
    if (payload.box.opacity !== undefined) {
      next.box.opacity = sanitizeOpacity(payload.box.opacity, 'box.opacity');
    }
    if (payload.box.borderWidth !== undefined) {
      next.box.borderWidth = clamp(Number(payload.box.borderWidth), 0, 80);
    }
  }

  if (payload.layout && typeof payload.layout === 'object') {
    if (payload.layout.horizontal !== undefined) {
      const horiz = String(payload.layout.horizontal).toLowerCase();
      if (!H_ALIGN.has(horiz)) {
        throw new Error('layout.horizontal must be one of left, center, right');
      }
      next.layout.horizontal = horiz;
    }
    if (payload.layout.vertical !== undefined) {
      const vert = String(payload.layout.vertical).toLowerCase();
      if (!V_ALIGN.has(vert)) {
        throw new Error('layout.vertical must be one of top, center, bottom');
      }
      next.layout.vertical = vert;
    }
    if (payload.layout.offsetX !== undefined) {
      next.layout.offsetX = clamp(Number(payload.layout.offsetX), -800, 800);
    }
    if (payload.layout.offsetY !== undefined) {
      next.layout.offsetY = clamp(Number(payload.layout.offsetY), -800, 800);
    }
  }

  if (payload.labels && typeof payload.labels === 'object') {
    if (payload.labels.showHeader !== undefined) {
      next.labels.showHeader = Boolean(payload.labels.showHeader);
    }
    if (payload.labels.headerText !== undefined) {
      next.labels.headerText = sanitizeText(payload.labels.headerText, 'labels.headerText', 60);
    }
    if (payload.labels.titlePrefix !== undefined) {
      next.labels.titlePrefix = sanitizeText(payload.labels.titlePrefix, 'labels.titlePrefix', 30);
    }
    if (payload.labels.artistPrefix !== undefined) {
      next.labels.artistPrefix = sanitizeText(
        payload.labels.artistPrefix,
        'labels.artistPrefix',
        30
      );
    }
    if (payload.labels.albumPrefix !== undefined) {
      next.labels.albumPrefix = sanitizeText(payload.labels.albumPrefix, 'labels.albumPrefix', 30);
    }
    if (payload.labels.showAlbum !== undefined) {
      next.labels.showAlbum = Boolean(payload.labels.showAlbum);
    }
    if (payload.labels.commentPrefix !== undefined) {
      next.labels.commentPrefix = sanitizeText(
        payload.labels.commentPrefix,
        'labels.commentPrefix',
        30
      );
    }
  }

  return next;
}

function persistSnapshot() {
  ensureDataDir();
  const tmpPath = `${STORE_PATH}.tmp`;
  fs.writeFileSync(
    tmpPath,
    JSON.stringify(
      { version: snapshot.version, updatedAt: snapshot.updatedAt, values: snapshot.values },
      null,
      2
    ),
    'utf8'
  );
  fs.renameSync(tmpPath, STORE_PATH);
  hasPersistedFile = true;
}

function getOverlayStyleSnapshot() {
  return {
    version: snapshot.version,
    updatedAt: snapshot.updatedAt,
    values: clone(snapshot.values),
  };
}

function getOverlayStyleValues() {
  return clone(snapshot.values);
}

function setOverlayStyle(payload, meta = {}) {
  const normalized = normalizeStyle(payload, snapshot.values);
  snapshot = {
    version: snapshot.version + 1,
    updatedAt: new Date().toISOString(),
    values: normalized,
  };
  persistSnapshot();
  log('Overlay style updated', { version: snapshot.version, actor: meta.actor || 'unknown' });
  emitter.emit('change', getOverlayStyleSnapshot(), meta);
  return getOverlayStyleSnapshot();
}

function resetOverlayStyle(meta = {}) {
  snapshot = {
    version: snapshot.version + 1,
    updatedAt: new Date().toISOString(),
    values: clone(defaultStyle),
  };
  persistSnapshot();
  log('Overlay style reset to defaults', {
    version: snapshot.version,
    actor: meta.actor || 'unknown',
  });
  emitter.emit('change', getOverlayStyleSnapshot(), meta);
  return getOverlayStyleSnapshot();
}

function onOverlayStyleChange(handler) {
  emitter.on('change', handler);
  return () => emitter.off('change', handler);
}

function hasOverlayStylePersisted() {
  return hasPersistedFile;
}

module.exports = {
  getOverlayStyleSnapshot,
  getOverlayStyleValues,
  setOverlayStyle,
  resetOverlayStyle,
  onOverlayStyleChange,
  hasOverlayStylePersisted,
};
