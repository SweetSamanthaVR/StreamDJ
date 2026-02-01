'use strict';

/**
 * Playback Controller Module
 *
 * Manages audio playback via FFmpeg, including play/pause/resume/skip
 * functionality, position tracking, and metadata posting to the server.
 *
 * @module player/playback-controller
 */

const { spawn } = require('child_process');
const { createLogger } = require('../lib/utils/logger');
const { ignoreErrors } = require('../lib/utils/errors');
const { HTTP_PORT } = require('../lib/config');

const { log, warn, error } = createLogger('playback');

/**
 * Audio configuration constants
 */
const SAMPLE_RATE = 44100;
const CHANNELS = 2;

/**
 * @typedef {Object} PlaybackState
 * @property {import('child_process').ChildProcess|null} process - Current FFmpeg process
 * @property {number|null} startTime - Timestamp when playback started
 * @property {number} offset - Playback offset in seconds
 * @property {boolean} isPaused - Whether playback is paused
 * @property {string|null} stopIntent - Reason for stopping (manual, pause, auto)
 * @property {boolean} shuttingDown - Whether application is shutting down
 */

/**
 * @typedef {Object} PlayOptions
 * @property {number} [offset] - Start position in seconds
 * @property {string} [intent] - Playback intent ('auto', 'manual', etc.)
 */

/**
 * Creates a new PlaybackController instance
 * @param {Object} options - Configuration options
 * @param {Object} options.playlistManager - PlaylistManager instance
 * @param {Object} options.audioSocket - AudioSocket instance
 * @returns {Object} PlaybackController instance
 */
function createPlaybackController(options) {
  const { playlistManager, audioSocket } = options;

  /** @type {PlaybackState} */
  const state = {
    process: null,
    startTime: null,
    offset: 0,
    isPaused: false,
    stopIntent: null,
    shuttingDown: false,
  };

  let lastAudioDataLogTime = 0;

  /**
   * Posts track metadata to the server via HTTP
   * @param {Object} track - Track metadata to post
   * @returns {Promise<void>}
   */
  async function postTrackMetadata(track) {
    const payload = {
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      filename: track.filename,
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      await fetch(`http://127.0.0.1:${HTTP_PORT}/metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      warn('Failed to POST metadata:', err.message);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Builds FFmpeg command line arguments for audio decoding
   * @param {string} trackPath - Path to audio file
   * @param {number} offsetSeconds - Start position in seconds
   * @returns {string[]} Array of FFmpeg arguments
   */
  function buildFfmpegArgs(trackPath, offsetSeconds) {
    const args = ['-hide_banner', '-loglevel', 'error', '-re'];
    if (offsetSeconds > 0) {
      args.push('-ss', offsetSeconds.toFixed(3));
    }
    args.push(
      '-i',
      trackPath,
      '-f',
      's16le',
      '-ac',
      String(CHANNELS),
      '-ar',
      String(SAMPLE_RATE),
      'pipe:1'
    );
    return args;
  }

  /**
   * Handles audio data chunks from FFmpeg, writing to server socket
   * @param {Buffer} chunk - Audio data chunk
   */
  function handleAudioData(chunk) {
    if (!chunk || chunk.length === 0) {
      return;
    }
    const socket = audioSocket.getSocket();
    if (!socket || socket.destroyed) {
      const now = Date.now();
      if (now - lastAudioDataLogTime > 5000) {
        warn(
          `[DEBUG] ${new Date().toISOString()} Audio socket not available (destroyed=${socket ? socket.destroyed : 'null'})`
        );
        lastAudioDataLogTime = now;
      }
      return;
    }
    if (!audioSocket.isWritable()) {
      const now = Date.now();
      if (now - lastAudioDataLogTime > 5000) {
        warn(`[DEBUG] ${new Date().toISOString()} Socket not writable, pausing FFmpeg stdout`);
        lastAudioDataLogTime = now;
      }
      if (state.process) {
        state.process.stdout.pause();
      }
      return;
    }
    const ok = socket.write(chunk);
    if (!ok) {
      warn(
        `[DEBUG] ${new Date().toISOString()} Socket write returned false (backpressure), pausing`
      );
      audioSocket.setWritable(false);
      if (state.process) {
        state.process.stdout.pause();
      }
    }
  }

  /**
   * Starts playback of a track at the specified playlist index
   * @param {number} index - Playlist index to play
   * @param {PlayOptions} [options={}] - Playback options
   * @returns {Promise<void>}
   */
  async function playTrackAtIndex(index, options = {}) {
    const track = playlistManager.getTrackAtIndex(index);
    if (!track) {
      return;
    }

    /* Update playlist state */
    playlistManager.setCurrentIndex(index);

    /* Update playback state */
    state.offset = options.offset || 0;
    state.isPaused = false;

    /* Spawn FFmpeg process to decode audio */
    const args = buildFfmpegArgs(track.fullPath, state.offset);

    let ffmpeg;
    try {
      ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      error(`Failed to spawn FFmpeg process: ${err.message}`);
      error('Please ensure FFmpeg is installed and available in your system PATH');
      playlistManager.setCurrentIndex(-1);
      return;
    }

    /* Verify spawn succeeded by checking for PID */
    if (!ffmpeg || !ffmpeg.pid) {
      error('FFmpeg process failed to start - no PID assigned');
      error('Please ensure FFmpeg is installed and available in your system PATH');
      playlistManager.setCurrentIndex(-1);
      return;
    }

    state.process = ffmpeg;
    state.startTime = Date.now();
    state.stopIntent = null;

    log(`[DEBUG] ${new Date().toISOString()} Starting track: ${track.title} (${track.filename})`);
    log(`[DEBUG] FFmpeg PID: ${ffmpeg.pid}, offset: ${state.offset.toFixed(2)}s`);
    log(
      `[DEBUG] Socket state: connected=${audioSocket.isConnected()}, writable=${audioSocket.isWritable()}`
    );
    ignoreErrors(postTrackMetadata(track), warn, 'Failed to post track metadata');

    /* Pipe audio data to server */
    ffmpeg.stdout.on('data', handleAudioData);

    /* Log FFmpeg errors */
    ffmpeg.stderr.setEncoding('utf8');
    ffmpeg.stderr.on('data', (chunk) => {
      const message = chunk.trim();
      if (message) {
        log('ffmpeg:', message);
      }
    });

    /* Handle track completion and auto-play next */
    ffmpeg.on('close', (code, signal) => {
      const timestamp = new Date().toISOString();
      const elapsedTime = state.startTime ? (Date.now() - state.startTime) / 1000 : 0;
      state.process = null;

      log(`[DEBUG] ${timestamp} FFmpeg process closed`);
      log(`[DEBUG] Track: ${track.filename}, code=${code}, signal=${signal}`);
      log(`[DEBUG] Elapsed time: ${elapsedTime.toFixed(2)}s, stopIntent=${state.stopIntent}`);
      log(
        `[DEBUG] Socket state: connected=${audioSocket.isConnected()}, destroyed=${audioSocket.getSocket() ? audioSocket.getSocket().destroyed : 'N/A'}`
      );

      /* Don't auto-play if stopped intentionally */
      if (state.stopIntent) {
        log(`[DEBUG] Skipping auto-play due to stopIntent: ${state.stopIntent}`);
        return;
      }

      /* Don't auto-play if shutting down */
      if (state.shuttingDown) {
        log(`[DEBUG] Skipping auto-play due to shutdown`);
        return;
      }

      log(`Track ended (${track.filename}) code=${code} signal=${signal}`);
      playlistManager.addToHistory();

      /* Pick and play next track */
      const nextIndex = playlistManager.pickNextIndex();
      if (nextIndex === -1) {
        warn('No tracks available for continuation.');
        playlistManager.setCurrentIndex(-1);
        return;
      }
      ignoreErrors(playTrackAtIndex(nextIndex), error, 'Failed to start next track');
    });

    ffmpeg.on('error', (err) => {
      const timestamp = new Date().toISOString();
      const elapsedTime = state.startTime ? (Date.now() - state.startTime) / 1000 : 0;
      const currentTrack = playlistManager.currentTrack;
      error(`[DEBUG] ${timestamp} ffmpeg error: ${err.message}`);
      error(`[DEBUG] Elapsed time: ${elapsedTime.toFixed(2)}s`);
      error(`[DEBUG] Track: ${currentTrack ? currentTrack.filename : 'none'}`);
    });
  }

  /**
   * Gets current playback position in seconds
   * @returns {number} Current position in seconds
   */
  function getCurrentPositionSeconds() {
    if (state.isPaused) {
      return state.offset;
    }
    if (!state.startTime) {
      return 0;
    }
    const elapsedMs = Date.now() - state.startTime;
    return state.offset + elapsedMs / 1000;
  }

  /**
   * Stops current playback and terminates the FFmpeg process
   * @param {string} [intent='manual'] - The reason for stopping (manual, pause, etc.)
   * @returns {Promise<void>} Resolves when playback is stopped
   */
  async function stopPlayback(intent = 'manual') {
    if (!state.process) {
      return;
    }
    state.stopIntent = intent;
    const proc = state.process;
    return new Promise((resolve) => {
      proc.once('close', () => {
        state.stopIntent = null;
        resolve();
      });
      proc.kill('SIGTERM');
    });
  }

  /**
   * Pauses current playback by saving position and stopping the process
   * @returns {Promise<void>} Resolves when playback is paused
   */
  async function pausePlayback() {
    if (!state.process || state.isPaused) {
      return;
    }
    state.offset = getCurrentPositionSeconds();
    await stopPlayback('pause');
    state.isPaused = true;
    log('Playback paused');
  }

  /**
   * Resumes playback from the saved position
   * @returns {Promise<void>} Resolves when playback resumes
   */
  async function resumePlayback() {
    if (state.isPaused && playlistManager.currentIndex !== -1) {
      log('Resuming playback');
      await playTrackAtIndex(playlistManager.currentIndex, { offset: state.offset });
    }
  }

  /**
   * Skips to the next track in the playlist
   * @returns {Promise<void>} Resolves when the next track starts playing
   */
  async function skipToNext() {
    if (playlistManager.isEmpty) {
      return;
    }
    const nextIndex = playlistManager.pickNextIndex();
    if (nextIndex === -1) {
      warn('No next track available');
      return;
    }
    playlistManager.addToHistory();
    await stopPlayback('manual');
    await playTrackAtIndex(nextIndex);
    log('Skipped to next track');
  }

  /**
   * Skips to the previous track from history
   * @returns {Promise<void>} Resolves when the previous track starts playing
   */
  async function skipToPrevious() {
    const previousIndex = playlistManager.popFromHistory();
    if (previousIndex === null) {
      warn('No previous track in history');
      return;
    }
    await stopPlayback('manual');
    await playTrackAtIndex(previousIndex);
    log('Rewound to previous track');
  }

  /**
   * Starts the automatic playback loop
   * @returns {Promise<void>} Resolves when playback starts
   */
  async function startPlaybackLoop() {
    if (playlistManager.isEmpty) {
      warn('No tracks available to start playback. Waiting for new files...');
      return;
    }
    const index = playlistManager.pickNextIndex();
    const startIndex = index === -1 ? 0 : index;
    await playTrackAtIndex(startIndex);
  }

  /**
   * Resumes FFmpeg stdout when socket drains
   */
  function resumeFfmpegStdout() {
    if (state.process && !state.isPaused) {
      state.process.stdout.resume();
      log(`[DEBUG] FFmpeg stdout resumed`);
    }
  }

  /**
   * Sets the shutdown flag
   * @param {boolean} value - Shutdown state
   */
  function setShuttingDown(value) {
    state.shuttingDown = value;
  }

  /**
   * Checks if playback is active
   * @returns {boolean} True if playback process is running
   */
  function isPlaying() {
    return Boolean(state.process);
  }

  /**
   * Checks if playback is paused
   * @returns {boolean} True if paused
   */
  function isPaused() {
    return state.isPaused;
  }

  return {
    /* Playback control */
    playTrackAtIndex,
    stopPlayback,
    pausePlayback,
    resumePlayback,
    skipToNext,
    skipToPrevious,
    startPlaybackLoop,

    /* State queries */
    getCurrentPositionSeconds,
    isPlaying,
    isPaused,

    /* Lifecycle */
    setShuttingDown,
    resumeFfmpegStdout,
  };
}

module.exports = { createPlaybackController };
