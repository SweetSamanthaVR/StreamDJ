'use strict';

/**
 * HTTP API Module
 *
 * Provides Express-based HTTP endpoints for player control,
 * status queries, and health checks.
 *
 * @module player/http-api
 */

const express = require('express');
const http = require('http');
const { createLogger } = require('../lib/utils/logger');
const { PLAYER_API_PORT, PLAYER_API_HOST } = require('../lib/config');
const { createAuthMiddleware, isAuthEnabled } = require('../lib/utils/auth');

const { log, error } = createLogger('api');

/**
 * Creates and configures the HTTP API server
 * @param {Object} options - Configuration options
 * @param {Object} options.playlistManager - PlaylistManager instance
 * @param {Object} options.playbackController - PlaybackController instance
 * @param {Object} options.audioSocket - AudioSocket instance
 * @param {number} [options.port] - HTTP port to listen on
 * @param {string} [options.host] - HTTP host to bind to
 * @returns {Object} HTTP API instance
 */
function createHttpApi(options) {
  const {
    playlistManager,
    playbackController,
    audioSocket,
    port = PLAYER_API_PORT,
    host = PLAYER_API_HOST,
  } = options;

  const app = express();
  app.use(express.json());

  /* Optional API key authentication - enabled when STREAMDJ_API_KEY is set */
  app.use(createAuthMiddleware({ excludePaths: ['/health'] }));

  if (isAuthEnabled()) {
    log('API key authentication enabled for player API');
  }

  let server = null;

  /**
   * Registers an action route that accepts both GET and POST
   * @param {string} path - Route path
   * @param {string} verbLabel - Label for logging
   * @param {Function} handler - Async handler function
   */
  function registerActionRoute(path, verbLabel, handler) {
    app.all(path, async (req, res) => {
      if (req.method !== 'POST' && req.method !== 'GET') {
        res.set('Allow', 'GET, POST');
        res.status(405).json({ error: 'Method not allowed' });
        return;
      }
      try {
        await handler();
        res.status(204).end();
      } catch (err) {
        error(`${verbLabel} failed:`, err.message);
        res.status(500).json({ error: `${verbLabel} failed` });
      }
    });
  }

  /**
   * Sets up all HTTP routes
   */
  function setupRoutes() {
    /* Playback control routes */
    registerActionRoute('/next', 'Skip to next', () => playbackController.skipToNext());
    registerActionRoute('/previous', 'Skip to previous', () => playbackController.skipToPrevious());
    registerActionRoute('/pause', 'Pause playback', () => playbackController.pausePlayback());
    registerActionRoute('/resume', 'Resume playback', () => playbackController.resumePlayback());

    /* Health check endpoint */
    app.get('/health', (_req, res) => {
      const socket = audioSocket.getSocket();
      const healthy = Boolean(socket && !socket.destroyed && !playlistManager.isEmpty);
      const status = healthy ? 200 : 503;
      res.status(status).json({
        status: healthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        checks: {
          audioSocketConnected: audioSocket.isConnected(),
          playlistLoaded: !playlistManager.isEmpty,
          playbackActive: playbackController.isPlaying(),
        },
      });
    });

    /* Current track status endpoint */
    app.get('/current', (_req, res) => {
      res.json({
        track: playlistManager.getCurrentTrackInfo(),
        isPlaying: playbackController.isPlaying(),
        isPaused: playbackController.isPaused(),
        positionSeconds: Number(playbackController.getCurrentPositionSeconds().toFixed(2)),
      });
    });

    /* Playlist endpoint */
    app.get('/playlist', (_req, res) => {
      res.json(playlistManager.listPlaylist());
    });
  }

  /**
   * Starts the HTTP server
   * @returns {Promise<void>} Resolves when server is listening
   */
  function start() {
    return new Promise((resolve) => {
      setupRoutes();
      server = http.createServer(app);
      server.listen(port, host, () => {
        log(`Player control API listening on ${host}:${port}`);
        resolve();
      });
    });
  }

  /**
   * Stops the HTTP server
   * @returns {Promise<void>} Resolves when server is closed
   */
  function stop() {
    return new Promise((resolve) => {
      if (server) {
        server.close(() => {
          server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  return {
    start,
    stop,
    get app() {
      return app;
    },
  };
}

module.exports = { createHttpApi };
