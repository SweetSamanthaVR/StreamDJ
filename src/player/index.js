'use strict';

/**
 * Player Modules Index
 *
 * Re-exports all player submodules for convenient importing.
 *
 * @module player
 */

const { createPlaylistManager } = require('./playlist-manager');
const { createPlaybackController } = require('./playback-controller');
const { createAudioSocket } = require('./audio-socket');
const { createHttpApi } = require('./http-api');

module.exports = {
  createPlaylistManager,
  createPlaybackController,
  createAudioSocket,
  createHttpApi,
};
