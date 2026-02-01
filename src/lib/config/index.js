'use strict';

/**
 * Centralized configuration module
 *
 * Provides shared constants and environment variable loading.
 * Used by server.js, player.js, and webui.ts to ensure consistent
 * port assignments across all StreamDJ components.
 *
 * @module lib/config
 */

const dotenv = require('dotenv');
const { optionalPortEnv, optionalEnv } = require('../utils/env');

/*
 * Ensure .env is loaded before we read any variables. This file is imported
 * very early (often before server.js or player.js call dotenv), so we double
 * check here to avoid missing required ports when running `node server.js`.
 */
if (dotenv && typeof dotenv.config === 'function') {
  dotenv.config();
}

/**
 * Default port configuration values.
 * These match the documented defaults in README.md.
 */
const DEFAULT_TCP_PORT = 5000;
const DEFAULT_HTTP_PORT = 4000;
const DEFAULT_PLAYER_API_PORT = 3000;

/**
 * Default host binding - localhost for security.
 * Users must explicitly set to 0.0.0.0 to expose to network.
 */
const DEFAULT_HTTP_HOST = '127.0.0.1';

/**
 * TCP port for audio stream communication between player and server.
 * @type {number}
 */
const TCP_PORT = optionalPortEnv('TCP_PORT', DEFAULT_TCP_PORT, 'streamdj');

/**
 * HTTP port for the server control API.
 * @type {number}
 */
const HTTP_PORT = optionalPortEnv('HTTP_PORT', DEFAULT_HTTP_PORT, 'streamdj');

/**
 * HTTP host binding for the server control API.
 * Defaults to localhost for security.
 * @type {string}
 */
const HTTP_HOST = optionalEnv('HTTP_HOST', DEFAULT_HTTP_HOST);

/**
 * HTTP port for the player API and WebUI access.
 * @type {number}
 */
const PLAYER_API_PORT = optionalPortEnv('PLAYER_API_PORT', DEFAULT_PLAYER_API_PORT, 'streamdj');

/**
 * HTTP host binding for the player API.
 * Defaults to localhost for security.
 * @type {string}
 */
const PLAYER_API_HOST = optionalEnv('PLAYER_API_HOST', DEFAULT_HTTP_HOST);

module.exports = {
  TCP_PORT,
  HTTP_PORT,
  HTTP_HOST,
  PLAYER_API_PORT,
  PLAYER_API_HOST,
  DEFAULT_TCP_PORT,
  DEFAULT_HTTP_PORT,
  DEFAULT_HTTP_HOST,
  DEFAULT_PLAYER_API_PORT,
};
