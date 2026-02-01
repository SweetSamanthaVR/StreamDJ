'use strict';

/**
 * Overlay Renderer Module
 *
 * Handles text overlay generation for FFmpeg drawtext filter.
 * Manages overlay file writes, position updates, and style-to-filter conversion.
 *
 * @module server/overlay-renderer
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { OVERLAY_FONT_SIZE, OVERLAY_LINE_SPACING, FONT_PATH_DEFAULT } = require('./constants');
const { ignoreErrors } = require('../lib/utils/errors');

/**
 * Creates an overlay renderer instance
 * @param {Object} deps - Dependencies
 * @param {Function} deps.log - Logger function
 * @param {Function} deps.warn - Warning logger function
 * @param {Function} deps.getOverlayStyle - Function to get current overlay style
 * @param {boolean} deps.ffmpegSupportsLetterSpacing - Whether FFmpeg supports letter_spacing
 * @returns {Object} Overlay renderer API
 */
function createOverlayRenderer(deps) {
  const { log, warn, getOverlayStyle, ffmpegSupportsLetterSpacing = false } = deps;

  /* Temporary file for overlay text */
  const OVERLAY_FILE = path.join(os.tmpdir(), `streamdj-overlay-${process.pid}.txt`);

  /* State for write queue and deduplication */
  let overlayWriteQueue = Promise.resolve();
  let lastOverlaySignature = null;
  let lastOverlayWriteError = null;
  let lastOverlayWriteErrorTime = 0;

  /**
   * Escapes a file path for use in FFmpeg filter strings
   * @param {string} p - File path to escape
   * @returns {string} Escaped path suitable for FFmpeg filters
   */
  function ffmpegFilterPath(p) {
    const normalized = p.replace(/\\/g, '/');
    const escaped = normalized.replace(/:/g, '\\:').replace(/'/g, "\\'");
    return `'${escaped}'`;
  }

  /**
   * Formats FFmpeg color with optional opacity
   * @param {string} hex - Hex color (e.g., '#FFFFFF')
   * @param {number} [opacity=1] - Opacity value (0-1)
   * @returns {string} FFmpeg-formatted color string
   */
  function formatFfmpegColor(hex, opacity) {
    const normalized =
      typeof hex === 'string' && hex.startsWith('#') ? hex.toUpperCase() : '#FFFFFF';
    const clampedOpacity = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
    if (clampedOpacity >= 1) {
      return normalized;
    }
    return `${normalized}@${clampedOpacity.toFixed(2)}`;
  }

  /**
   * Formats a signed integer value for FFmpeg filter expressions
   * @param {number} value - Numeric value
   * @returns {string} Signed string ('+5', '-3', or '')
   */
  function formatSigned(value) {
    const offset = Math.round(value || 0);
    if (!offset) {
      return '';
    }
    return offset > 0 ? `+${offset}` : `${offset}`;
  }

  /**
   * Computes X position expression for FFmpeg drawtext filter
   * @param {Object} layout - Layout configuration
   * @returns {string} FFmpeg expression for X position
   */
  function computeOverlayX(layout) {
    const horizontal = (layout.horizontal || 'center').toLowerCase();
    const offset = Math.round(layout.offsetX || 0);
    if (horizontal === 'left') {
      return String(offset);
    }
    if (horizontal === 'right') {
      if (!offset) {
        return 'w-text_w';
      }
      return offset > 0 ? `w-text_w-${offset}` : `w-text_w+${Math.abs(offset)}`;
    }
    return `(w-text_w)/2${formatSigned(offset)}`;
  }

  /**
   * Computes Y position expression for FFmpeg drawtext filter
   * @param {Object} layout - Layout configuration
   * @returns {string} FFmpeg expression for Y position
   */
  function computeOverlayY(layout) {
    const vertical = (layout.vertical || 'center').toLowerCase();
    const offset = Math.round(layout.offsetY || 0);
    if (vertical === 'top') {
      return String(offset);
    }
    if (vertical === 'bottom') {
      if (!offset) {
        return 'h-text_h';
      }
      return offset > 0 ? `h-text_h-${offset}` : `h-text_h+${Math.abs(offset)}`;
    }
    return `(h-text_h)/2${formatSigned(offset)}`;
  }

  /**
   * Combines prefix and value with proper spacing
   * @param {string} prefix - Label prefix
   * @param {string} value - Value to display
   * @returns {string} Combined string
   */
  function combinePrefix(prefix, value) {
    if (!prefix) {
      return value;
    }
    const needsSpace = !/\s$/.test(prefix);
    return needsSpace ? `${prefix} ${value}` : `${prefix}${value}`;
  }

  /**
   * Escapes special characters for drawtext filter
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  function escapeDrawtextText(text) {
    if (!text) return '';
    return String(text).replace(/%/g, '%%');
  }

  /**
   * Builds multi-line overlay text from metadata
   * @param {Object} meta - Normalized metadata object
   * @param {Object} [style] - Optional style override
   * @returns {string} Formatted overlay text with newlines
   */
  function buildOverlayLines(meta, style) {
    const safeStyle = style || getOverlayStyle() || {};
    const labels = safeStyle.labels || {};
    const lines = [];

    if (labels.showHeader && labels.headerText) {
      lines.push(labels.headerText);
    }

    lines.push(combinePrefix(labels.titlePrefix ?? '', escapeDrawtextText(meta.title)));
    lines.push(combinePrefix(labels.artistPrefix ?? 'Artist: ', escapeDrawtextText(meta.artist)));

    if (labels.showAlbum !== false) {
      lines.push(combinePrefix(labels.albumPrefix ?? 'Album: ', escapeDrawtextText(meta.album)));
    }

    lines.push(combinePrefix(labels.commentPrefix ?? '', escapeDrawtextText(meta.comment)));

    return lines.filter((line) => line && line.trim().length > 0).join(os.EOL);
  }

  /**
   * Builds the FFmpeg drawtext filter string from style configuration
   * @param {Object} style - Overlay style configuration
   * @returns {string} FFmpeg drawtext filter string
   */
  function buildDrawtextFilter(style) {
    const font = style.font || {};
    const box = style.box || {};
    const layout = style.layout || {};
    const fontColor = formatFfmpegColor(font.color, font.opacity);
    const boxColor = formatFfmpegColor(box.color, box.opacity);
    const lineSpacing = Math.round(font.lineSpacing ?? OVERLAY_LINE_SPACING);
    const letterSpacing = Math.round(font.letterSpacing ?? 0);
    const fontSize = Math.round(font.size ?? OVERLAY_FONT_SIZE);
    const parts = [
      `drawtext=fontfile=${ffmpegFilterPath(FONT_PATH_DEFAULT)}`,
      `textfile=${ffmpegFilterPath(OVERLAY_FILE)}`,
      'reload=1',
      `fontcolor=${fontColor}`,
      `fontsize=${fontSize}`,
      `line_spacing=${lineSpacing}`,
      `box=${box.enabled === false ? 0 : 1}`,
      `boxcolor=${boxColor}`,
      `boxborderw=${Math.round(box.borderWidth ?? 20)}`,
      `x=${computeOverlayX(layout)}`,
      `y=${computeOverlayY(layout)}`,
    ];

    if (ffmpegSupportsLetterSpacing && letterSpacing !== 0) {
      parts.push(`letter_spacing=${letterSpacing}`);
    }

    return parts.join(':');
  }

  /**
   * Writes overlay content in-place (atomic update)
   * @param {string} payload - Text content to write
   * @returns {Promise<void>}
   */
  async function writeOverlayInPlace(payload) {
    const fh = await fs.promises.open(OVERLAY_FILE, 'r+');
    try {
      const prevStat = await fh.stat();
      const buf = Buffer.from(payload, 'utf8');
      await fh.write(buf, 0, buf.length, 0);
      if (prevStat.size > buf.length) {
        await fh.truncate(buf.length);
      }
      await fh.sync();
    } finally {
      await ignoreErrors(fh.close());
    }
  }

  /**
   * Ensures overlay file exists with initial content
   * @param {Object} initialMeta - Initial metadata for default content
   * @returns {Promise<void>}
   */
  async function ensureOverlayFile(initialMeta) {
    const initialContent = buildOverlayLines(
      initialMeta || {
        title: 'StreamDJ Live',
        artist: 'StreamDJ',
        album: 'Live Mix',
        comment: 'Waiting for tracks…',
      }
    );
    await fs.promises.writeFile(OVERLAY_FILE, initialContent, 'utf8');
    lastOverlaySignature = initialContent;
    log(`[overlay] Created overlay file: ${OVERLAY_FILE}`);
  }

  /**
   * Synchronously queues an overlay file update
   * @param {Object} meta - Normalized metadata
   * @param {boolean} [force=false] - Force write even if signature unchanged
   * @returns {Promise} Write queue promise
   */
  function syncOverlayFileImmediate(meta, force = false) {
    const nextPayload = buildOverlayLines(meta);
    if (!force && nextPayload === lastOverlaySignature) {
      log(`[DEBUG] Skipping overlay write - signature unchanged`);
      return overlayWriteQueue;
    }

    overlayWriteQueue = overlayWriteQueue.then(async () => {
      const timestamp = new Date().toISOString();
      try {
        log(`[DEBUG] ${timestamp} Overlay signature changed, writing update (queued)`);
        await writeOverlayInPlace(nextPayload);
        lastOverlaySignature = nextPayload;
        lastOverlayWriteError = null;
      } catch (err) {
        const now = Date.now();
        if (now - lastOverlayWriteErrorTime > 5000 || lastOverlayWriteError !== err.message) {
          warn(`[DEBUG] ${timestamp} Overlay write failed: ${err.message} (code: ${err.code})`);
          lastOverlayWriteError = err.message;
          lastOverlayWriteErrorTime = now;
        }
      }
    });

    return overlayWriteQueue;
  }

  /**
   * Asynchronous overlay file sync with change detection
   * @param {Object} meta - Normalized metadata
   * @param {boolean} [force=false] - Force write even if signature unchanged
   * @returns {Promise} Write queue promise
   */
  function syncOverlayFile(meta, force = false) {
    const nextPayload = buildOverlayLines(meta);
    if (!force && nextPayload === lastOverlaySignature) {
      return overlayWriteQueue;
    }
    const timestamp = new Date().toISOString();
    log(`[DEBUG] ${timestamp} Async syncOverlayFile starting`);
    overlayWriteQueue = overlayWriteQueue
      .then(async () => {
        await writeOverlayInPlace(nextPayload);
        lastOverlaySignature = nextPayload;
        lastOverlayWriteError = null;
      })
      .catch((err) => {
        warn(`[DEBUG] ${timestamp} Overlay write failed: ${err.message} (code: ${err.code})`);
      });
    return overlayWriteQueue;
  }

  /**
   * Cleans up overlay file on shutdown
   * @returns {Promise<void>}
   */
  async function cleanup() {
    try {
      await fs.promises.unlink(OVERLAY_FILE);
      log(`[overlay] Removed overlay file: ${OVERLAY_FILE}`);
    } catch {
      /* File may not exist, ignore */
    }
  }

  /**
   * Gets the current overlay file path
   * @returns {string} Path to overlay file
   */
  function getOverlayFilePath() {
    return OVERLAY_FILE;
  }

  return {
    /* File management */
    ensureOverlayFile,
    getOverlayFilePath,
    cleanup,

    /* Text building */
    buildOverlayLines,
    buildDrawtextFilter,

    /* File writing */
    syncOverlayFile,
    syncOverlayFileImmediate,

    /* Utilities */
    ffmpegFilterPath,
    formatFfmpegColor,
  };
}

module.exports = { createOverlayRenderer };
