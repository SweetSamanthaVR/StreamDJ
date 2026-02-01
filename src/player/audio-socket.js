'use strict';

/**
 * Audio Socket Module
 *
 * Manages the TCP connection to the audio server, including connection
 * establishment, reconnection with exponential backoff, and socket state.
 *
 * @module player/audio-socket
 */

const net = require('net');
const { createLogger } = require('../lib/utils/logger');
const { TCP_PORT } = require('../lib/config');

const { log, warn, error } = createLogger('socket');

/**
 * @typedef {Object} SocketState
 * @property {net.Socket|null} socket - TCP connection to audio server
 * @property {boolean} writable - Whether socket is writable
 * @property {number} reconnectDelay - Current reconnection delay in milliseconds
 * @property {NodeJS.Timeout|null} reconnectTimer - Timer for scheduled reconnection
 * @property {number} reconnectAttempts - Number of consecutive failed attempts
 * @property {boolean} shuttingDown - Whether application is shutting down
 */

/**
 * Creates a new AudioSocket instance
 * @param {Object} [options={}] - Configuration options
 * @param {number} [options.port] - TCP port to connect to
 * @param {string} [options.host='127.0.0.1'] - Host to connect to
 * @param {number} [options.maxReconnectAttempts=10] - Maximum reconnection attempts
 * @param {Function} [options.onDrain] - Callback when socket drains
 * @returns {Object} AudioSocket instance
 */
function createAudioSocket(options = {}) {
  const {
    port = TCP_PORT,
    host = '127.0.0.1',
    maxReconnectAttempts = 10,
    onDrain = null,
  } = options;

  /** @type {SocketState} */
  const state = {
    socket: null,
    writable: true,
    reconnectDelay: 1000,
    reconnectTimer: null,
    reconnectAttempts: 0,
    shuttingDown: false,
  };

  /**
   * Clears any pending reconnection timer
   */
  function clearReconnectTimer() {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
  }

  /**
   * Schedules a reconnection attempt to the audio server with exponential backoff
   */
  function scheduleReconnect() {
    if (state.shuttingDown) {
      return;
    }
    if (state.reconnectTimer) {
      return;
    }

    /* Check if maximum reconnection attempts reached */
    if (state.reconnectAttempts >= maxReconnectAttempts) {
      error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      error(`Maximum reconnection attempts (${maxReconnectAttempts}) reached.`);
      error('Unable to connect to audio server.');
      error('');
      error('Please ensure the server is running and listening on:');
      error(`  tcp://${host}:${port}`);
      error('');
      error('To restart reconnection attempts, restart the player.');
      error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      return;
    }

    state.reconnectAttempts++;

    /* Calculate exponential backoff delay with max cap */
    const delay = Math.min(state.reconnectDelay, 30000);
    warn(
      `Reconnecting to audio server in ${delay}ms (attempt ${state.reconnectAttempts}/${maxReconnectAttempts})`
    );

    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      connect();
    }, delay);

    /* Double the delay for next attempt */
    state.reconnectDelay = Math.min(delay * 2, 30000);
  }

  /**
   * Establishes TCP connection to the audio server
   */
  function connect() {
    if (state.shuttingDown) {
      return;
    }
    clearReconnectTimer();

    const socket = net.createConnection({ port, host });
    socket.setNoDelay(true);

    socket.on('connect', () => {
      const timestamp = new Date().toISOString();
      state.socket = socket;
      state.writable = true;
      state.reconnectDelay = 1000; /* Reset reconnection delay on successful connection */
      state.reconnectAttempts = 0; /* Reset reconnection attempt counter */
      log(`[DEBUG] ${timestamp} Connected to audio server on tcp://${host}:${port}`);
      log(`[DEBUG] Socket state: writable=${state.writable}, destroyed=${socket.destroyed}`);
    });

    /* Resume playback when socket is ready to write again */
    socket.on('drain', () => {
      const timestamp = new Date().toISOString();
      log(`[DEBUG] ${timestamp} Socket drain event - resuming audio flow`);
      state.writable = true;
      if (onDrain) {
        onDrain();
      }
    });

    socket.on('error', (err) => {
      const timestamp = new Date().toISOString();
      error(`[DEBUG] ${timestamp} Audio socket error: ${err.message}`);
      error(`[DEBUG] Socket state: destroyed=${socket.destroyed}, writable=${state.writable}`);
      error(`[DEBUG] Error code: ${err.code}, errno: ${err.errno}`);
    });

    /* Schedule reconnection on socket close */
    socket.on('close', () => {
      const timestamp = new Date().toISOString();
      warn(`[DEBUG] ${timestamp} Audio server connection closed`);
      state.writable = false;
      if (state.socket === socket) {
        state.socket = null;
      }
      scheduleReconnect();
    });
  }

  /**
   * Closes the socket connection
   */
  function disconnect() {
    clearReconnectTimer();
    if (state.socket) {
      state.socket.end();
      state.socket = null;
    }
  }

  /**
   * Sets the shutdown flag to prevent reconnection
   * @param {boolean} value - Shutdown state
   */
  function setShuttingDown(value) {
    state.shuttingDown = value;
    if (value) {
      clearReconnectTimer();
    }
  }

  /**
   * Gets the current socket instance
   * @returns {net.Socket|null} Current socket or null
   */
  function getSocket() {
    return state.socket;
  }

  /**
   * Checks if socket is connected
   * @returns {boolean} True if connected
   */
  function isConnected() {
    return Boolean(state.socket && !state.socket.destroyed);
  }

  /**
   * Checks if socket is writable
   * @returns {boolean} True if writable
   */
  function isWritable() {
    return state.writable;
  }

  /**
   * Sets the writable state
   * @param {boolean} value - Writable state
   */
  function setWritable(value) {
    state.writable = value;
  }

  return {
    /* Connection management */
    connect,
    disconnect,
    setShuttingDown,

    /* State queries */
    getSocket,
    isConnected,
    isWritable,
    setWritable,
  };
}

module.exports = { createAudioSocket };
