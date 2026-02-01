'use strict';

/**
 * Server Modules Index
 *
 * Re-exports all server submodules for convenient importing.
 *
 * @module server
 */

const constants = require('./constants');
const { createOverlayRenderer } = require('./overlay-renderer');
const { createBackgroundManager } = require('./background-manager');
const { createSilenceGenerator } = require('./silence-generator');
const { createTcpServer } = require('./tcp-server');
const { createFfmpegManager } = require('./ffmpeg-manager');
const { createHttpRoutes } = require('./http-routes');

module.exports = {
  constants,
  createOverlayRenderer,
  createBackgroundManager,
  createSilenceGenerator,
  createTcpServer,
  createFfmpegManager,
  createHttpRoutes,
};
