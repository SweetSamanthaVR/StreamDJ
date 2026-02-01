'use strict';

/**
 * Background Manager Module
 *
 * Handles background image/video management for FFmpeg overlay.
 * Manages uploads, persistence, and validation of background sources.
 *
 * @module server/background-manager
 */

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { LOOPABLE_IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, MAX_UPLOAD_SIZE } = require('./constants');

/**
 * Creates a background manager instance
 * @param {Object} deps - Dependencies
 * @param {string} deps.uploadDir - Directory for uploaded backgrounds
 * @param {string} deps.defaultBackground - Path to default background
 * @param {string} deps.persistenceFile - Path to background persistence JSON
 * @param {string[]} deps.allowedDirs - Whitelist of allowed background directories
 * @param {Function} deps.log - Logger function
 * @param {Function} deps.warn - Warning logger function
 * @returns {Object} Background manager API
 */
function createBackgroundManager(deps) {
  const { uploadDir, defaultBackground, persistenceFile, allowedDirs, log, warn } = deps;

  let currentBackground = null;

  /**
   * Ensures the upload directory exists
   * @returns {void}
   */
  function ensureUploadDir() {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      log('Created upload directory:', uploadDir);
    }
  }

  /**
   * Loads persisted background path from disk
   * @returns {string|null} Background path or null if not found/invalid
   */
  function loadPersistedBackground() {
    try {
      if (fs.existsSync(persistenceFile)) {
        const data = JSON.parse(fs.readFileSync(persistenceFile, 'utf8'));
        if (data.backgroundPath && typeof data.backgroundPath === 'string') {
          const resolved = path.resolve(data.backgroundPath);
          if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
            log(`Loaded persisted background: ${resolved}`);
            return resolved;
          } else {
            warn(`Persisted background no longer exists: ${resolved}, using default`);
          }
        }
      }
    } catch (err) {
      warn(`Failed to load persisted background: ${err.message}`);
    }
    return null;
  }

  /**
   * Persists background path to disk
   * @param {string|null} backgroundPath - Path to persist (null for default)
   * @returns {void}
   */
  function saveBackgroundPersistence(backgroundPath) {
    try {
      const dataDir = path.dirname(persistenceFile);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const data = {
        backgroundPath: backgroundPath || null,
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(persistenceFile, JSON.stringify(data, null, 2), 'utf8');
      log(`Background preference saved: ${backgroundPath || 'default'}`);
    } catch (err) {
      warn(`Failed to save background persistence: ${err.message}`);
    }
  }

  /**
   * Validates that a path is within allowed directories
   * @param {string} resolvedPath - Absolute path to validate
   * @returns {boolean} True if path is allowed
   */
  function isPathAllowed(resolvedPath) {
    return allowedDirs.some((allowedDir) => {
      const relative = path.relative(allowedDir, resolvedPath);
      return !relative.startsWith('..') && !path.isAbsolute(relative);
    });
  }

  /**
   * Validates a background file path
   * @param {string} requestedPath - Path to validate
   * @returns {{ valid: boolean, resolved?: string, error?: string }}
   */
  function validateBackgroundPath(requestedPath) {
    /* Empty path resets to solid color */
    if (!requestedPath) {
      return { valid: true, resolved: null };
    }

    /* Validate path length */
    if (requestedPath.length > 1024) {
      return { valid: false, error: 'Path exceeds maximum length' };
    }

    /* Check for null bytes */
    if (requestedPath.includes('\0')) {
      return { valid: false, error: 'Path contains invalid characters' };
    }

    /* Resolve relative paths to upload directory */
    const isAbsolute = path.isAbsolute(requestedPath) || /^[a-zA-Z]:\\/.test(requestedPath);
    const candidatePath = isAbsolute ? requestedPath : path.join(uploadDir, requestedPath);
    const resolved = path.resolve(candidatePath);

    /* Validate path is within allowed directories */
    if (!isPathAllowed(resolved)) {
      warn(`Directory traversal attempt blocked (not in whitelist): ${requestedPath}`);
      return { valid: false, error: 'Path not in allowed directories' };
    }

    /* Validate file exists and is supported format */
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        return { valid: false, error: 'Background path must point to a file' };
      }

      const ext = path.extname(resolved).toLowerCase();
      const supportedExtensions = [...LOOPABLE_IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS];
      if (!supportedExtensions.includes(ext)) {
        return { valid: false, error: 'Unsupported file format. Use image or video files.' };
      }
    } catch (err) {
      return { valid: false, error: `Unable to read background file: ${err.message}` };
    }

    return { valid: true, resolved };
  }

  /**
   * Validates a filename for safe use
   * @param {string} filename - Filename to validate
   * @returns {{ valid: boolean, resolved?: string, error?: string }}
   */
  function validateFilename(filename) {
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      return { valid: false, error: 'Invalid filename' };
    }

    const fullPath = path.join(uploadDir, filename);
    const resolved = path.resolve(fullPath);
    const uploadDirResolved = path.resolve(uploadDir);

    if (!resolved.startsWith(uploadDirResolved)) {
      warn(`Directory traversal attempt blocked on delete: ${filename}`);
      return { valid: false, error: 'Invalid path' };
    }

    if (!fs.existsSync(resolved)) {
      return { valid: false, error: 'File not found', notFound: true };
    }

    return { valid: true, resolved };
  }

  /**
   * Lists all available backgrounds
   * @returns {Object[]} Array of background info objects
   */
  function listBackgrounds() {
    ensureUploadDir();
    const files = fs.readdirSync(uploadDir);
    return files
      .filter((filename) => {
        const ext = path.extname(filename).toLowerCase();
        return LOOPABLE_IMAGE_EXTENSIONS.includes(ext);
      })
      .map((filename) => {
        const fullPath = path.join(uploadDir, filename);
        const stat = fs.statSync(fullPath);
        return {
          filename,
          path: fullPath,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
  }

  /**
   * Deletes a background file
   * @param {string} resolved - Resolved path to delete
   * @returns {void}
   */
  function deleteBackground(resolved) {
    fs.unlinkSync(resolved);
  }

  /**
   * Creates Multer storage configuration
   * @returns {multer.StorageEngine}
   */
  function createUploadStorage() {
    return multer.diskStorage({
      destination: (_req, _file, cb) => {
        ensureUploadDir();
        cb(null, uploadDir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const base = path
          .basename(file.originalname, ext)
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .substring(0, 50);
        const timestamp = Date.now();
        cb(null, `${base}-${timestamp}${ext}`);
      },
    });
  }

  /**
   * Creates Multer file filter
   * @returns {Function}
   */
  function createUploadFilter() {
    return (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (LOOPABLE_IMAGE_EXTENSIONS.includes(ext)) {
        cb(null, true);
      } else {
        cb(
          new Error(
            `Unsupported file type: ${ext}. Allowed: ${LOOPABLE_IMAGE_EXTENSIONS.join(', ')}`
          ),
          false
        );
      }
    };
  }

  /**
   * Creates configured Multer uploader
   * @returns {multer.Multer}
   */
  function createUploader() {
    return multer({
      storage: createUploadStorage(),
      fileFilter: createUploadFilter(),
      limits: { fileSize: MAX_UPLOAD_SIZE },
    });
  }

  /**
   * Initializes background manager
   * @returns {string} Current background path
   */
  function initialize() {
    try {
      ensureUploadDir();
    } catch (err) {
      warn('Failed to create upload directory:', err.message);
    }

    const persisted = loadPersistedBackground();
    if (persisted) {
      currentBackground = persisted;
      log(`Using persisted background: ${currentBackground}`);
    } else {
      currentBackground = defaultBackground;
      log(`Using default background: ${currentBackground}`);
    }

    return currentBackground;
  }

  /**
   * Sets current background
   * @param {string|null} backgroundPath - New background path
   * @returns {void}
   */
  function setBackground(backgroundPath) {
    currentBackground = backgroundPath;
    saveBackgroundPersistence(backgroundPath);
  }

  /**
   * Gets current background
   * @returns {string|null} Current background path
   */
  function getBackground() {
    return currentBackground;
  }

  /**
   * Gets upload directory path
   * @returns {string} Upload directory path
   */
  function getUploadDir() {
    return uploadDir;
  }

  return {
    /* Initialization */
    initialize,
    ensureUploadDir,

    /* Background state */
    getBackground,
    setBackground,
    getUploadDir,

    /* Validation */
    validateBackgroundPath,
    validateFilename,
    isPathAllowed,

    /* File operations */
    listBackgrounds,
    deleteBackground,

    /* Multer integration */
    createUploader,

    /* Persistence */
    saveBackgroundPersistence,
    loadPersistedBackground,
  };
}

module.exports = { createBackgroundManager };
