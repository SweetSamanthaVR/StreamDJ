'use strict';

/**
 * StreamDJ Server Orchestrator
 *
 * Accepts audio streams from the player via TCP, manages FFmpeg encoding
 * with real-time text overlay, and outputs to an RTMP endpoint. Provides
 * an HTTP API for metadata updates, background switching, and status monitoring.
 *
 * This module serves as the main orchestrator that initializes and coordinates
 * all server submodules.
 *
 * @module server
 */

/*
 * Dependencies
 */

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const http = require('http');
const dotenv = require('dotenv');
const { requireEnv, requireUrlEnv, optionalEnv } = require('./lib/utils/env');
const { TCP_PORT, HTTP_PORT, HTTP_HOST, PLAYER_API_PORT } = require('./lib/config');
const { createLogger, setDiagnosticsRecorder } = require('./lib/utils/logger');
const { validateFfmpegAvailable, logFfmpegInstallHelp } = require('./lib/services/ffmpeg');
const { createAuthMiddleware, isAuthEnabled } = require('./lib/utils/auth');
const {
  getOverlayStyleSnapshot,
  setOverlayStyle,
  resetOverlayStyle,
  onOverlayStyleChange,
  hasOverlayStylePersisted,
} = require('./lib/services/overlayStyleStore');
const diagnostics = require('./lib/services/diagnostics');

/* Import server submodules */
const {
  constants,
  createOverlayRenderer,
  createBackgroundManager,
  createSilenceGenerator,
  createTcpServer,
  createFfmpegManager,
  createHttpRoutes,
} = require('./server/index');

/* Wire up logger to diagnostics buffer */
setDiagnosticsRecorder(diagnostics);

/*
 * Environment Configuration
 */

if (dotenv) {
  dotenv.config();
}

const RTMP_URL = requireUrlEnv('RTMP_URL', 'rtmp://', 'server');
const STREAM_KEY = requireEnv('STREAM_KEY', 'server');
const { log, warn, error } = createLogger('server');

/* Paths */
const PROJECT_ROOT = path.resolve(__dirname, '..');
const UPLOAD_DIR = path.join(PROJECT_ROOT, 'media', 'stream-backgrounds');
const DEFAULT_BACKGROUND = path.join(UPLOAD_DIR, 'streamdj-default.png');
const BACKGROUND_PERSISTENCE_FILE = path.join(PROJECT_ROOT, 'data', 'background.json');
const BACKGROUND_IMAGE = path.resolve(optionalEnv('OVERLAY_BACKGROUND', DEFAULT_BACKGROUND));

/* Allowed directories for background images */
const ALLOWED_BACKGROUND_DIRS = process.env.ALLOWED_BACKGROUND_DIRS
  ? process.env.ALLOWED_BACKGROUND_DIRS.split(path.delimiter).map((dir) => path.resolve(dir.trim()))
  : [PROJECT_ROOT];

/*
 * Initialize Overlay Style Defaults
 */

if (!hasOverlayStylePersisted()) {
  try {
    setOverlayStyle(
      {
        font: {
          size: constants.OVERLAY_FONT_SIZE,
          lineSpacing: constants.OVERLAY_LINE_SPACING,
        },
      },
      { actor: 'bootstrap:env', skipRestart: true }
    );
  } catch (err) {
    warn('Failed to seed overlay style defaults:', err.message);
  }
}

/*
 * State Variables
 */

let ffmpegSupportsLetterSpacing = false;
let currentOverlayStyle = getOverlayStyleSnapshot().values;

/* Metadata state */
let lastMetadata = null;
let desiredMetadata = createDefaultMetadata();
let currentPositionSeconds = 0;
let positionUpdateInterval = null;

/* Server instances */
let tcpServer = null;
let httpServer = null;

/**
 * Creates default metadata for when no track is playing
 * @returns {Object} Default metadata
 */
function createDefaultMetadata() {
  return {
    title: 'StreamDJ Live',
    artist: 'StreamDJ',
    album: 'Live Mix',
    comment: 'Waiting for tracks…',
  };
}

/**
 * Sanitizes a metadata field
 * @param {any} value - Value to sanitize
 * @param {string} fallback - Fallback value
 * @returns {string} Sanitized string
 */
function sanitizeMetadataField(value, fallback) {
  if (value === null || value === undefined) {
    return fallback;
  }
  const str = String(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/[[\],:'\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return str.length > 0 ? str : fallback;
}

/**
 * Formats seconds into MM:SS format
 * @param {number} seconds - Duration in seconds
 * @returns {string|null} Formatted duration
 */
function formatDuration(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  const total = Math.round(n);
  const mins = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

/**
 * Normalizes raw metadata from player
 * @param {Object} meta - Raw metadata
 * @param {number} positionSeconds - Current position
 * @returns {Object} Normalized metadata
 */
function normalizeMetadata(meta = {}, positionSeconds = 0) {
  const durationDisplay = formatDuration(meta.duration);
  const posDisplay = formatDuration(positionSeconds);
  const commentBase = sanitizeMetadataField(meta.comment || meta.filename, null);

  let comment;
  if (durationDisplay && posDisplay) {
    comment = `${posDisplay} / ${durationDisplay}`;
  } else if (durationDisplay) {
    comment = durationDisplay;
  } else if (posDisplay) {
    comment = posDisplay;
  } else {
    comment = commentBase || 'Live set';
  }

  return {
    title: sanitizeMetadataField(meta.title, 'StreamDJ Live'),
    artist: sanitizeMetadataField(meta.artist, 'StreamDJ'),
    album: sanitizeMetadataField(meta.album, 'Live Mix'),
    comment,
  };
}

/**
 * Gets current normalized metadata
 * @returns {Object} Normalized metadata
 */
function currentNormalizedMetadata() {
  const raw = (lastMetadata && lastMetadata.original) || desiredMetadata || {};
  return normalizeMetadata(raw, currentPositionSeconds);
}

/**
 * Detects if FFmpeg supports letter_spacing in drawtext
 * @returns {Promise<boolean>} True if supported
 */
async function detectDrawtextLetterSpacingSupport() {
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    let resolved = false;
    let output = '';
    const complete = (result) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    try {
      const probe = spawn('ffmpeg', ['-hide_banner', '-h', 'filter=drawtext'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const capture = (chunk) => {
        if (chunk) output += chunk.toString('utf8');
      };

      if (probe.stdout) probe.stdout.on('data', capture);
      if (probe.stderr) probe.stderr.on('data', capture);

      const timeout = setTimeout(() => {
        try {
          probe.kill('SIGTERM');
        } catch {
          /* ignore */
        }
        complete(false);
      }, 5000);

      probe.on('error', () => {
        clearTimeout(timeout);
        complete(false);
      });

      probe.on('close', () => {
        clearTimeout(timeout);
        complete(output.toLowerCase().includes('letter_spacing'));
      });
    } catch {
      complete(false);
    }
  });
}

/*
 * Initialize Submodules
 */

/* Background Manager */
const backgroundManager = createBackgroundManager({
  uploadDir: UPLOAD_DIR,
  defaultBackground: BACKGROUND_IMAGE,
  persistenceFile: BACKGROUND_PERSISTENCE_FILE,
  allowedDirs: ALLOWED_BACKGROUND_DIRS,
  log,
  warn,
});

backgroundManager.initialize();

/* Overlay Renderer */
const overlayRenderer = createOverlayRenderer({
  log,
  warn,
  getOverlayStyle: () => currentOverlayStyle,
  ffmpegSupportsLetterSpacing,
});

/* Silence Generator (will be configured after ffmpegManager) */
let silenceGenerator = null;

/* FFmpeg Manager (will be configured after silenceGenerator) */
let ffmpegManager = null;

/**
 * Starts position update polling
 */
function startPositionUpdates() {
  if (positionUpdateInterval) return;
  positionUpdateInterval = setInterval(async () => {
    if (!lastMetadata || !lastMetadata.original) return;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(`http://127.0.0.1:${PLAYER_API_PORT}/current`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) return;
      const data = await response.json();
      if (data.positionSeconds !== undefined) {
        currentPositionSeconds = data.positionSeconds;
        overlayRenderer.syncOverlayFileImmediate(currentNormalizedMetadata());
      }
    } catch {
      /* ignore */
    }
  }, 1000);
  log('[position] Started position update polling');
}

/**
 * Stops position update polling
 */
function stopPositionUpdates() {
  if (positionUpdateInterval) {
    clearInterval(positionUpdateInterval);
    positionUpdateInterval = null;
    log('[position] Stopped position update polling');
  }
}

/**
 * Syncs overlay file with current metadata
 */
function syncOverlayFile() {
  overlayRenderer.syncOverlayFile(currentNormalizedMetadata());
}

/*
 * HTTP API - Express Application Setup
 */

const app = express();
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

/* CORS middleware */
app.use((req, res, next) => {
  const allowedOrigins = [
    `http://127.0.0.1:${PLAYER_API_PORT}`,
    `http://localhost:${PLAYER_API_PORT}`,
    'http://127.0.0.1:8080',
    'http://localhost:8080',
  ];
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

app.use(express.json({ limit: '100kb' }));

/* Optional API key authentication - enabled when STREAMDJ_API_KEY is set */
app.use(createAuthMiddleware({ excludePaths: ['/health'] }));

if (isAuthEnabled()) {
  log('API key authentication enabled for server API');
}

/*
 * Shutdown Handler
 */

let isShuttingDown = false;

function shutdown(reason = 'manual') {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log(`Shutting down (reason: ${reason})...`);

  if (silenceGenerator) silenceGenerator.stop();
  if (tcpServer) tcpServer.stop();
  if (ffmpegManager) ffmpegManager.shutdown();
  stopPositionUpdates();
  overlayRenderer.cleanup().catch(() => {});

  if (httpServer) {
    httpServer.close(() => {
      log('Shutdown complete');
      process.exit(0);
    });
  }

  setTimeout(() => {
    error('Graceful shutdown timeout - forcing exit');
    process.exit(1);
  }, 5000);
}

process.on('uncaughtException', (err) => {
  error('Uncaught exception:', err?.stack || err);
  shutdown('uncaught-exception');
});

process.on('unhandledRejection', (reason) => {
  error('Unhandled rejection:', reason?.stack || reason);
  shutdown('unhandled-rejection');
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

/*
 * Main Startup
 */

async function startServer() {
  log('Validating FFmpeg availability...');
  const ffmpegAvailable = await validateFfmpegAvailable();

  if (!ffmpegAvailable) {
    logFfmpegInstallHelp(error, 'StreamDJ Server');
    process.exit(1);
  }

  log('FFmpeg validation passed ✓');

  ffmpegSupportsLetterSpacing = await detectDrawtextLetterSpacingSupport();
  if (ffmpegSupportsLetterSpacing) {
    log('[ffmpeg] drawtext letter_spacing supported');
  } else {
    warn('[ffmpeg] drawtext letter_spacing not supported');
  }

  /* Initialize overlay file */
  await overlayRenderer.ensureOverlayFile(createDefaultMetadata());

  /* Create FFmpeg Manager */
  ffmpegManager = createFfmpegManager({
    rtmpUrl: RTMP_URL,
    streamKey: STREAM_KEY,
    log,
    warn,
    error,
    getBackground: () => backgroundManager.getBackground(),
    getOverlayStyle: () => currentOverlayStyle,
    getMetadata: () => desiredMetadata,
    buildDrawtextFilter: (style) => overlayRenderer.buildDrawtextFilter(style),
    diagnostics,
    onSpawn: (info) => {
      if (info.reason) {
        if (tcpServer) tcpServer.resumeProducer(info.reason);
      }
      startPositionUpdates();
    },
    onClose: () => {
      stopPositionUpdates();
    },
    onDrain: () => {
      if (silenceGenerator) silenceGenerator.resetBackpressure();
      if (tcpServer) tcpServer.resumeProducer('ffmpeg drain');
    },
  });

  /* Create Silence Generator */
  silenceGenerator = createSilenceGenerator({
    log,
    warn,
    getFfmpegStdin: () => ffmpegManager.getStdin(),
    isFfmpegWritable: () => ffmpegManager.isWritable(),
    setFfmpegWritable: (v) => ffmpegManager.setWritable(v),
  });

  /* Create TCP Server */
  tcpServer = createTcpServer({
    port: TCP_PORT,
    log,
    warn,
    error,
    onData: (chunk, socketControl) => {
      if (silenceGenerator.isActive()) {
        silenceGenerator.suspendTemporarily();
        silenceGenerator.resumeAfterDelay();
      }

      const stdin = ffmpegManager.getStdin();
      if (!stdin || stdin.destroyed) {
        return { paused: false };
      }

      if (!ffmpegManager.isWritable()) {
        socketControl.pause();
        return { paused: true };
      }

      try {
        const ok = stdin.write(chunk);
        if (!ok) {
          ffmpegManager.setWritable(false);
          socketControl.pause();
          return { paused: true };
        }
      } catch (err) {
        if (err?.code === 'EPIPE') {
          socketControl.pause();
          return { paused: true };
        }
        error('Write to ffmpeg failed:', err.message);
      }

      return { paused: false };
    },
    onProducerConnect: () => {
      log('[orchestrator] Producer connected');
    },
    onProducerDisconnect: () => {
      if (silenceGenerator) silenceGenerator.resumeAfterDelay();
    },
  });

  /* Configure HTTP Routes */
  createHttpRoutes({
    app,
    log,
    warn,
    backgroundManager,
    ffmpegManager,
    tcpServer,
    overlayRenderer,
    silenceGenerator,
    overlayStyleStore: {
      getOverlayStyleSnapshot,
      setOverlayStyle,
      resetOverlayStyle,
    },
    diagnostics,
    config: {
      tcpPort: TCP_PORT,
      httpPort: HTTP_PORT,
      playerApiPort: PLAYER_API_PORT,
      rtmpUrl: RTMP_URL,
      streamKey: STREAM_KEY,
    },
    onMetadataUpdate: (body) => {
      currentPositionSeconds = 0;
      const normalized = normalizeMetadata(body, currentPositionSeconds);
      lastMetadata = {
        ...normalized,
        original: body,
        receivedAt: new Date().toISOString(),
      };
      desiredMetadata = normalized;
      syncOverlayFile();
    },
    onBackgroundChange: (newBackground) => {
      const reason = newBackground
        ? 'background change'
        : 'background change (reset to solid color)';

      if (ffmpegManager.isRunning()) {
        if (tcpServer) tcpServer.pauseProducer(reason);
        ffmpegManager.setPlannedPause(reason);
        silenceGenerator.setBackpressure(true);
        ffmpegManager.requestRestart(reason);
      }
    },
  });

  /* Subscribe to overlay style changes */
  onOverlayStyleChange((snapshot) => {
    currentOverlayStyle = snapshot.values;

    /* Force overlay refresh */
    syncOverlayFile();

    /* Restart FFmpeg if style requires filter rebuild */
    if (ffmpegManager && ffmpegManager.isRunning()) {
      const reason = 'overlay style change';
      if (tcpServer) tcpServer.pauseProducer(reason);
      ffmpegManager.setPlannedPause(reason);
      silenceGenerator.setBackpressure(true);
      ffmpegManager.requestRestart(reason);
    }
  });

  /* Start HTTP server */
  httpServer = http.createServer(app);
  httpServer.listen(HTTP_PORT, HTTP_HOST, () => {
    log(`HTTP control API listening on ${HTTP_HOST}:${HTTP_PORT}`);
  });

  /* Start components */
  ffmpegManager.spawn();
  silenceGenerator.start();
  tcpServer.start();

  log('Server bootstrap complete. Ready to stream.');
}

startServer().catch((err) => {
  error('Server startup failed:', err.message);
  process.exit(1);
});
