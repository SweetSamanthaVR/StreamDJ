'use strict';

/**
 * StreamDJ Player Module
 *
 * Orchestrates the music player components: playlist management, audio playback,
 * server connection, and HTTP API. Scans the music directory for MP3 files,
 * extracts metadata, and streams decoded audio to the StreamDJ server via TCP.
 *
 * @module player
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { requireEnv } = require('./lib/utils/env');
const { createLogger } = require('./lib/utils/logger');
const { validateFfmpegAvailable, logFfmpegInstallHelp } = require('./lib/services/ffmpeg');

/* Load environment variables from .env file */
if (dotenv) {
  dotenv.config();
}

/* Import modular components */
const { createPlaylistManager } = require('./player/playlist-manager');
const { createPlaybackController } = require('./player/playback-controller');
const { createAudioSocket } = require('./player/audio-socket');
const { createHttpApi } = require('./player/http-api');

/*
 * Configuration
 */

const RAW_MUSIC_DIR = requireEnv('MUSIC_DIR', 'player');
const SHUFFLE_DEFAULT = true;

/*
 * Logger
 */

const { log, warn, error } = createLogger('player');

/**
 * Resolve music directory with a fallback for project-relative paths.
 * @param {string} input - Raw MUSIC_DIR value
 * @returns {string} Resolved path
 */
function resolveMusicDir(input) {
  const resolved = path.resolve(input);
  if (fs.existsSync(resolved)) {
    return resolved;
  }

  const trimmed = input.replace(/^[/\\]+/, '');
  const projectRoot = path.resolve(__dirname, '..');
  const fallback = path.join(projectRoot, trimmed);
  if (fallback !== resolved && fs.existsSync(fallback)) {
    warn(`MUSIC_DIR not found at ${resolved}; falling back to ${fallback}`);
    return fallback;
  }

  return resolved;
}

const MUSIC_DIR = resolveMusicDir(RAW_MUSIC_DIR);

/*
 * Component Instances
 */

let playlistManager = null;
let audioSocket = null;
let playbackController = null;
let httpApi = null;

/**
 * Registers signal handlers for graceful shutdown
 */
function registerSignalHandlers() {
  let shuttingDown = false;

  async function shutdown() {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log('Shutting down ...');

    /* Signal all components to stop */
    if (playbackController) {
      playbackController.setShuttingDown(true);
    }
    if (audioSocket) {
      audioSocket.setShuttingDown(true);
      audioSocket.disconnect();
    }
    if (playlistManager) {
      playlistManager.stopWatcher();
    }
    if (httpApi) {
      await httpApi.stop();
    }

    /* Stop playback */
    if (playbackController) {
      await playbackController.stopPlayback('manual');
    }

    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Bootstraps the music player application by initializing all components
 * @returns {Promise<void>} Resolves when all initialization is complete
 * @throws {Error} If Node.js version doesn't support fetch API
 */
async function bootstrap() {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch API is required (Node 18+).');
  }

  log('Validating FFmpeg availability...');
  const ffmpegAvailable = await validateFfmpegAvailable();

  if (!ffmpegAvailable) {
    logFfmpegInstallHelp(error, 'StreamDJ Player');
    process.exit(1);
  }

  log('FFmpeg validation passed');

  /* Initialize playlist manager */
  if (!MUSIC_DIR) {
    error(
      'MUSIC_DIR environment variable is not set. Set it in .env file, e.g., MUSIC_DIR=./media/music'
    );
    process.exit(1);
  }

  playlistManager = createPlaylistManager({
    musicDir: MUSIC_DIR,
    shuffle: SHUFFLE_DEFAULT,
  });

  /* Initialize audio socket with drain callback */
  audioSocket = createAudioSocket({
    onDrain: () => {
      if (playbackController) {
        playbackController.resumeFfmpegStdout();
      }
    },
  });

  /* Initialize playback controller */
  playbackController = createPlaybackController({
    playlistManager,
    audioSocket,
  });

  /* Initialize HTTP API */
  httpApi = createHttpApi({
    playlistManager,
    playbackController,
    audioSocket,
  });

  /* Register signal handlers */
  registerSignalHandlers();

  /* Initialize playlist and start components */
  await playlistManager.ensureMusicDir();
  await playlistManager.loadInitialPlaylist();
  playlistManager.watchMusicDirectory();

  /* Connect to audio server */
  audioSocket.connect();

  /* Start HTTP API */
  await httpApi.start();

  /* Start playback loop */
  await playbackController.startPlaybackLoop();
}

bootstrap().catch((err) => {
  error('Fatal error during startup:', err);
  process.exit(1);
});
