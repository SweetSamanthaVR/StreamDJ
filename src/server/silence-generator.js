'use strict';

/**
 * Silence Generator Module
 *
 * Generates silent audio when no producer is connected to keep
 * FFmpeg encoding continuously running.
 *
 * @module server/silence-generator
 */

const {
  SILENCE_CHUNK,
  SILENCE_CHUNK_DURATION_MS,
  SILENCE_RESUME_DELAY_MS,
} = require('./constants');

/**
 * Creates a silence generator instance
 * @param {Object} deps - Dependencies
 * @param {Function} deps.log - Logger function
 * @param {Function} deps.warn - Warning logger function
 * @param {Function} deps.getFfmpegStdin - Function to get FFmpeg stdin stream
 * @param {Function} deps.isFfmpegWritable - Function to check if FFmpeg is writable
 * @param {Function} deps.setFfmpegWritable - Function to update FFmpeg writable state
 * @returns {Object} Silence generator API
 */
function createSilenceGenerator(deps) {
  const { log, warn, getFfmpegStdin, isFfmpegWritable, setFfmpegWritable } = deps;

  /* State */
  let silenceInterval = null;
  let silencePaused = false;
  let silenceBackpressure = false;
  let idleSilenceTimer = null;

  /**
   * Writes silence chunks to FFmpeg stdin
   * @returns {void}
   */
  function writeSilenceChunk() {
    if (silencePaused || silenceBackpressure) {
      return;
    }

    const stdin = getFfmpegStdin();
    if (!stdin || stdin.destroyed) {
      silenceBackpressure = true;
      return;
    }

    if (!isFfmpegWritable()) {
      silenceBackpressure = true;
      return;
    }

    try {
      const ok = stdin.write(SILENCE_CHUNK);
      if (!ok) {
        setFfmpegWritable(false);
        silenceBackpressure = true;
      }
    } catch (err) {
      if (err && err.code === 'EPIPE') {
        silenceBackpressure = true;
      } else {
        warn('Silence write error:', err.message);
      }
    }
  }

  /**
   * Starts or ensures the silence writer interval is running
   * @returns {void}
   */
  function ensureSilenceWriter() {
    if (silenceInterval) {
      return;
    }
    silencePaused = false;
    silenceBackpressure = false;
    silenceInterval = setInterval(writeSilenceChunk, SILENCE_CHUNK_DURATION_MS);
    log('Silence generator active');
  }

  /**
   * Starts the silence generator loop
   * @returns {void}
   */
  function start() {
    ensureSilenceWriter();
  }

  /**
   * Stops the silence generator
   * @returns {void}
   */
  function stop() {
    if (silenceInterval) {
      clearInterval(silenceInterval);
      silenceInterval = null;
    }
    if (idleSilenceTimer) {
      clearTimeout(idleSilenceTimer);
      idleSilenceTimer = null;
    }
    silencePaused = false;
    silenceBackpressure = false;
  }

  /**
   * Temporarily pauses the silence generator
   * @returns {void}
   */
  function suspendTemporarily() {
    if (silenceInterval) {
      silencePaused = true;
    }
  }

  /**
   * Schedules resumption of silence generator after delay
   * @returns {void}
   */
  function resumeAfterDelay() {
    if (idleSilenceTimer) {
      clearTimeout(idleSilenceTimer);
    }
    idleSilenceTimer = setTimeout(() => {
      if (silenceInterval) {
        silencePaused = false;
        silenceBackpressure = false;
      }
    }, SILENCE_RESUME_DELAY_MS);
  }

  /**
   * Sets backpressure state
   * @param {boolean} value - Backpressure state
   * @returns {void}
   */
  function setBackpressure(value) {
    silenceBackpressure = value;
  }

  /**
   * Resets backpressure state
   * @returns {void}
   */
  function resetBackpressure() {
    silenceBackpressure = false;
  }

  /**
   * Checks if silence generator is active
   * @returns {boolean} True if running
   */
  function isActive() {
    return silenceInterval !== null;
  }

  /**
   * Checks if silence is paused
   * @returns {boolean} True if paused
   */
  function isPaused() {
    return silencePaused;
  }

  /**
   * Checks backpressure state
   * @returns {boolean} True if experiencing backpressure
   */
  function hasBackpressure() {
    return silenceBackpressure;
  }

  return {
    /* Lifecycle */
    start,
    stop,

    /* Pause/Resume */
    suspendTemporarily,
    resumeAfterDelay,

    /* Backpressure */
    setBackpressure,
    resetBackpressure,
    hasBackpressure,

    /* State */
    isActive,
    isPaused,
  };
}

module.exports = { createSilenceGenerator };
