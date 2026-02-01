'use strict';

/**
 * HTTP Routes Module
 *
 * Defines all HTTP API endpoints for the server including
 * metadata, background, overlay style, status, and diagnostics.
 *
 * @module server/http-routes
 */

const {
  MAX_METADATA_TITLE_LENGTH,
  MAX_METADATA_ARTIST_LENGTH,
  MAX_METADATA_ALBUM_LENGTH,
  MAX_METADATA_COMMENT_LENGTH,
  MAX_UPLOAD_SIZE,
} = require('./constants');
const multer = require('multer');

/**
 * Validates that a value is a string within max length
 * @param {any} value - Value to validate
 * @param {number} maxLength - Maximum length
 * @param {string} fieldName - Field name for errors
 * @returns {string} Validated string
 * @throws {Error} If validation fails
 */
function validateString(value, maxLength, fieldName) {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }
  if (value.length > maxLength) {
    throw new Error(`${fieldName} exceeds maximum length of ${maxLength}`);
  }
  return value;
}

/**
 * Creates HTTP routes for the Express app
 * @param {Object} deps - Dependencies
 * @param {Object} deps.app - Express app instance
 * @param {Function} deps.log - Logger function
 * @param {Function} deps.warn - Warning logger function
 * @param {Object} deps.backgroundManager - Background manager instance
 * @param {Object} deps.ffmpegManager - FFmpeg manager instance
 * @param {Object} deps.tcpServer - TCP server instance
 * @param {Object} deps.silenceGenerator - Silence generator instance
 * @param {Object} deps.overlayStyleStore - Overlay style store functions
 * @param {Object} deps.diagnostics - Diagnostics instance
 * @param {Object} deps.config - Server configuration
 * @param {Function} deps.onMetadataUpdate - Callback when metadata updates
 * @param {Function} deps.onBackgroundChange - Callback when background changes
 * @returns {void}
 */
function createHttpRoutes(deps) {
  const {
    app,
    log,
    warn,
    backgroundManager,
    ffmpegManager,
    tcpServer,
    silenceGenerator,
    overlayStyleStore,
    diagnostics,
    config,
    onMetadataUpdate,
    onBackgroundChange,
  } = deps;

  /* Create uploader for background images */
  const uploader = backgroundManager.createUploader();

  /**
   * Builds overlay style response with version info
   * @param {Object} [snapshot] - Optional style snapshot
   * @returns {Object} Response object
   */
  function buildOverlayStyleResponse(snapshot) {
    const snap = snapshot || overlayStyleStore.getOverlayStyleSnapshot();
    return {
      version: snap.version,
      updatedAt: snap.updatedAt,
      values: snap.values,
    };
  }

  /*
   * POST /metadata - Receive and validate track metadata
   */
  app.post('/metadata', (req, res) => {
    try {
      const body = req.body || {};

      /* Validate all provided metadata fields */
      if (body.title !== undefined) {
        validateString(body.title, MAX_METADATA_TITLE_LENGTH, 'title');
      }
      if (body.artist !== undefined) {
        validateString(body.artist, MAX_METADATA_ARTIST_LENGTH, 'artist');
      }
      if (body.album !== undefined) {
        validateString(body.album, MAX_METADATA_ALBUM_LENGTH, 'album');
      }
      if (body.comment !== undefined) {
        validateString(body.comment, MAX_METADATA_COMMENT_LENGTH, 'comment');
      }
      if (body.filename !== undefined) {
        validateString(body.filename, 255, 'filename');
      }

      log('Metadata received:', body);

      if (onMetadataUpdate) {
        onMetadataUpdate(body);
      }

      res.status(204).end();
    } catch (err) {
      warn('Metadata validation failed:', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  /*
   * POST /background - Change background video/image source
   */
  app.post('/background', (req, res) => {
    const payload = req.body || {};
    const requestedPath = typeof payload.path === 'string' ? payload.path.trim() : '';

    const validation = backgroundManager.validateBackgroundPath(requestedPath);

    if (!validation.valid) {
      if (validation.error === 'Path not in allowed directories') {
        return res.status(403).json({ error: validation.error });
      }
      return res.status(400).json({ error: validation.error });
    }

    /* Apply new background */
    backgroundManager.setBackground(validation.resolved);

    if (!validation.resolved) {
      log('Background reset to solid color');
    } else {
      log(`Background change requested -> ${validation.resolved}`);
    }

    if (onBackgroundChange) {
      onBackgroundChange(validation.resolved);
    }

    if (!validation.resolved) {
      return res.status(204).end();
    }
    return res.status(202).json({ background: validation.resolved });
  });

  /*
   * POST /api/backgrounds/upload - Upload a new background image
   */
  app.post(
    '/api/backgrounds/upload',
    uploader.single('background'),
    (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const uploadDir = backgroundManager.getUploadDir();
      const uploadedPath = require('path').join(uploadDir, req.file.filename);
      log(`Background uploaded: ${req.file.originalname} -> ${uploadedPath}`);

      res.status(201).json({
        filename: req.file.filename,
        originalName: req.file.originalname,
        path: uploadedPath,
        size: req.file.size,
      });
    },
    (err, req, res, next) => {
      /* Multer error handler */
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res
            .status(413)
            .json({ error: `File too large (max ${MAX_UPLOAD_SIZE / 1024 / 1024}MB)` });
        }
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      } else if (err) {
        return res.status(400).json({ error: err.message });
      }
      next();
    }
  );

  /*
   * GET /api/backgrounds - List uploaded backgrounds
   */
  app.get('/api/backgrounds', (req, res) => {
    try {
      const backgrounds = backgroundManager.listBackgrounds();
      res.json({ backgrounds });
    } catch (err) {
      warn('Failed to list backgrounds:', err.message);
      res.status(500).json({ error: 'Unable to list backgrounds' });
    }
  });

  /*
   * DELETE /api/backgrounds/:filename - Delete an uploaded background
   */
  app.delete('/api/backgrounds/:filename', (req, res) => {
    try {
      const validation = backgroundManager.validateFilename(req.params.filename);

      if (!validation.valid) {
        if (validation.notFound) {
          return res.status(404).json({ error: validation.error });
        }
        if (validation.error === 'Invalid path') {
          return res.status(403).json({ error: validation.error });
        }
        return res.status(400).json({ error: validation.error });
      }

      backgroundManager.deleteBackground(validation.resolved);
      log(`Background deleted: ${req.params.filename}`);
      res.status(204).end();
    } catch (err) {
      warn('Failed to delete background:', err.message);
      res.status(500).json({ error: 'Unable to delete background' });
    }
  });

  /*
   * GET /overlay/style - Get current overlay style
   */
  app.get('/overlay/style', (_req, res) => {
    res.json(buildOverlayStyleResponse());
  });

  /*
   * PUT /overlay/style - Update overlay style
   */
  app.put('/overlay/style', (req, res) => {
    try {
      const body = req.body || {};
      const payloadSource = body.values && typeof body.values === 'object' ? body.values : body;
      const payload = { ...payloadSource };
      delete payload.version;
      delete payload.values;
      const version = typeof body.version === 'number' ? body.version : undefined;

      if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ error: 'Overlay style payload missing or invalid' });
      }

      const currentSnapshot = overlayStyleStore.getOverlayStyleSnapshot();
      if (version !== undefined && version !== currentSnapshot.version) {
        return res.status(409).json({
          error: 'Overlay style version mismatch',
          currentVersion: currentSnapshot.version,
        });
      }

      const snapshot = overlayStyleStore.setOverlayStyle(payload, {
        actor: `api:${req.ip || 'unknown'}`,
      });
      res.json(buildOverlayStyleResponse(snapshot));
    } catch (err) {
      warn('Overlay style update failed:', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  /*
   * POST /overlay/style/reset - Reset overlay style to defaults
   */
  app.post('/overlay/style/reset', (_req, res) => {
    try {
      const snapshot = overlayStyleStore.resetOverlayStyle({ actor: 'api:reset' });
      res.json(buildOverlayStyleResponse(snapshot));
    } catch (err) {
      warn('Overlay style reset failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /*
   * GET /health - Health check endpoint
   */
  app.get('/health', (_req, res) => {
    const status = ffmpegManager.getStatus();
    const healthy = Boolean(
      ffmpegManager.isRunning() && status.connected && !ffmpegManager.isBlocked()
    );

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: {
        ffmpegRunning: ffmpegManager.isRunning(),
        rtmpConnected: status.connected,
        tcpServerListening: tcpServer.isListening(),
        producerConnected: Boolean(tcpServer.getProducer()),
        ffmpegBlocked: ffmpegManager.isBlocked(),
      },
    });
  });

  /*
   * GET /status - Detailed server status
   */
  app.get('/status', (_req, res) => {
    const status = ffmpegManager.getStatus();
    const overlaySnapshot = overlayStyleStore.getOverlayStyleSnapshot();

    res.json({
      tcpPort: config.tcpPort,
      httpPort: config.httpPort,
      playerApiPort: config.playerApiPort,
      rtmpUrl: config.rtmpUrl,
      streamKeyPresent: Boolean(config.streamKey),
      connected: status.connected,
      bitrateKbps: status.bitrateKbps,
      ffmpegRestarts: status.ffmpegRestarts,
      ffmpegBlocked: status.ffmpegBlocked,
      ffmpegRestartAttemptsInWindow: status.restartAttemptsInWindow,
      ffmpegUptimeMs: status.ffmpegUptimeMs,
      backgroundSource: status.backgroundSource,
      overlayStyleVersion: overlaySnapshot.version,
      overlayStyleUpdatedAt: overlaySnapshot.updatedAt,
      lastMetadata: status.lastMetadata,
      lastProgress: status.lastProgress,
    });
  });

  /*
   * GET /diagnostics - Full diagnostics snapshot
   */
  app.get('/diagnostics', (_req, res) => {
    const status = ffmpegManager.getStatus();
    const ingestStats = tcpServer.getStats();

    /* Update diagnostics */
    diagnostics.updateNetworkStats({
      endpoint: config.rtmpUrl,
      connectionType: 'TCP/RTMP',
      bytesTransferred: ingestStats.bytesTotal,
      throughputKbps: status.bitrateKbps,
    });

    const snapshot = diagnostics.getDiagnosticsSnapshot();

    /* Augment with server-specific data */
    snapshot.serverState = {
      ffmpegRunning: ffmpegManager.isRunning(),
      ffmpegPid: status.ffmpegPid,
      ffmpegUptimeMs: status.ffmpegUptimeMs,
      ffmpegRestarts: status.ffmpegRestarts,
      ffmpegBlocked: status.ffmpegBlocked,
      ffmpegRestartAttemptsInWindow: status.restartAttemptsInWindow,
      rtmpConnected: status.connected,
      producerConnected: Boolean(tcpServer.getProducer()),
      silenceActive: silenceGenerator.isActive(),
      currentBackground: backgroundManager.getBackground(),
      lastProgress: status.lastProgress,
      ingestStats: {
        bytesTotal: ingestStats.bytesTotal,
        chunksTotal: ingestStats.chunksTotal,
        startedAt: new Date(ingestStats.start).toISOString(),
      },
    };

    res.json(snapshot);
  });

  /*
   * GET /diagnostics/logs - Get diagnostic logs
   */
  app.get('/diagnostics/logs', (req, res) => {
    const level = typeof req.query.level === 'string' ? req.query.level : 'DEBUG';
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 1000));

    const logs = diagnostics.getLogs(level, limit);
    res.json({ logs, count: logs.length });
  });

  /*
   * GET /diagnostics/events - Get diagnostic events
   */
  app.get('/diagnostics/events', (req, res) => {
    const type = typeof req.query.type === 'string' ? req.query.type : null;
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 100));

    const events = diagnostics.getEvents(type, limit);
    res.json({ events, count: events.length });
  });

  /*
   * GET /diagnostics/restarts - Get restart history
   */
  app.get('/diagnostics/restarts', (req, res) => {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const restarts = diagnostics.getRestartHistory(limit);
    res.json({ restarts, count: restarts.length });
  });

  /*
   * GET /diagnostics/export - Export full diagnostics bundle
   */
  app.get('/diagnostics/export', (_req, res) => {
    const bundle = diagnostics.exportDiagnostics();
    const status = ffmpegManager.getStatus();
    const ingestStats = tcpServer.getStats();

    bundle.serverExport = {
      ffmpegRestarts: status.ffmpegRestarts,
      currentBackground: backgroundManager.getBackground(),
      lastProgress: status.lastProgress,
      ingestStats: { ...ingestStats },
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="streamdj-diagnostics-${Date.now()}.json"`
    );
    res.json(bundle);
  });

  /*
   * POST /diagnostics/clear - Clear diagnostic data
   */
  app.post('/diagnostics/clear', (_req, res) => {
    diagnostics.clearDiagnostics();
    res.status(204).end();
  });

  /*
   * POST /ffmpeg/unblock - Manually unblock FFmpeg if in crashed/blocked state
   */
  app.post('/ffmpeg/unblock', (_req, res) => {
    if (ffmpegManager.manualUnblock()) {
      res.status(204).end();
    } else {
      res.status(409).json({ error: 'FFmpeg is not in blocked state' });
    }
  });
}

module.exports = { createHttpRoutes };
