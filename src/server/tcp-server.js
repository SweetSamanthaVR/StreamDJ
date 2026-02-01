'use strict';

/**
 * TCP Server Module
 *
 * Handles TCP connections from the player for audio ingestion.
 * Manages producer socket lifecycle, backpressure, and data flow to FFmpeg.
 *
 * @module server/tcp-server
 */

const net = require('net');
const { INGEST_LOG_INTERVAL_MS, INGEST_IDLE_WARN_MS } = require('./constants');

/**
 * Creates a TCP server instance for audio ingestion
 * @param {Object} deps - Dependencies
 * @param {number} deps.port - TCP port to listen on
 * @param {Function} deps.log - Logger function
 * @param {Function} deps.warn - Warning logger function
 * @param {Function} deps.error - Error logger function
 * @param {Function} deps.onData - Callback for incoming audio data
 * @param {Function} deps.onProducerConnect - Callback when producer connects
 * @param {Function} deps.onProducerDisconnect - Callback when producer disconnects
 * @returns {Object} TCP server API
 */
function createTcpServer(deps) {
  const { port, log, warn, error, onData, onProducerConnect, onProducerDisconnect } = deps;

  /* State */
  let server = null;
  let currentProducer = null;
  let pendingSocketResume = null;
  let ingestIdleTimer = null;

  /* Statistics */
  const ingestStats = {
    bytesTotal: 0,
    bytesSinceLog: 0,
    chunksTotal: 0,
    lastLog: Date.now(),
    start: Date.now(),
  };

  /**
   * Computes kilobits per second
   * @param {number} bytes - Number of bytes
   * @param {number} durationMs - Duration in milliseconds
   * @returns {number} Kilobits per second
   */
  function computeKbps(bytes, durationMs) {
    if (!Number.isFinite(bytes) || bytes <= 0 || !Number.isFinite(durationMs) || durationMs <= 0) {
      return 0;
    }
    const seconds = durationMs / 1000;
    return seconds <= 0 ? 0 : (bytes * 8) / 1000 / seconds;
  }

  /**
   * Formats byte count into human-readable format
   * @param {number} bytes - Number of bytes
   * @returns {string} Formatted byte string
   */
  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '0 B';
    }
    const units = ['B', 'KiB', 'MiB', 'GiB'];
    let idx = 0;
    let value = bytes;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx += 1;
    }
    return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
  }

  /**
   * Flushes and logs ingest statistics
   * @param {string} reason - Reason for logging
   */
  function flushIngestLog(reason) {
    const now = Date.now();
    const intervalDuration = now - ingestStats.lastLog;
    const kbps = computeKbps(ingestStats.bytesSinceLog, intervalDuration);
    log(
      `[ingest] ${reason} ${formatBytes(ingestStats.bytesSinceLog)} in ${(intervalDuration / 1000).toFixed(2)}s (${kbps.toFixed(1)} kbps) | total ${formatBytes(ingestStats.bytesTotal)} across ${ingestStats.chunksTotal} chunks`
    );
    ingestStats.bytesSinceLog = 0;
    ingestStats.lastLog = now;
  }

  /**
   * Schedules idle warning if no data received
   */
  function scheduleIngestIdleWarning() {
    if (ingestIdleTimer) {
      clearTimeout(ingestIdleTimer);
    }
    ingestIdleTimer = setTimeout(() => {
      warn('[ingest] No audio data received from producer within expected window');
      ingestIdleTimer = null;
    }, INGEST_IDLE_WARN_MS);
  }

  /**
   * Records an audio chunk and updates statistics
   * @param {number} size - Chunk size in bytes
   */
  function noteIngestChunk(size) {
    ingestStats.bytesTotal += size;
    ingestStats.bytesSinceLog += size;
    ingestStats.chunksTotal += 1;
    const now = Date.now();
    if (now - ingestStats.lastLog >= INGEST_LOG_INTERVAL_MS) {
      flushIngestLog('Recent ingest rate:');
    }
    scheduleIngestIdleWarning();
  }

  /**
   * Resets ingest counters
   */
  function resetIngestCounters() {
    ingestStats.bytesTotal = 0;
    ingestStats.bytesSinceLog = 0;
    ingestStats.chunksTotal = 0;
    ingestStats.lastLog = Date.now();
    ingestStats.start = ingestStats.lastLog;
  }

  /**
   * Stops idle warning timer
   */
  function stopIngestIdleWarning() {
    if (ingestIdleTimer) {
      clearTimeout(ingestIdleTimer);
      ingestIdleTimer = null;
    }
  }

  /**
   * Logs producer session summary
   * @param {string} label - Log label
   */
  function logProducerSessionSummary(label) {
    const durationMs = Date.now() - ingestStats.start;
    const avgKbps = computeKbps(ingestStats.bytesTotal, durationMs);
    log(
      `[ingest] ${label} ${formatBytes(ingestStats.bytesTotal)} over ${(durationMs / 1000).toFixed(2)}s (${avgKbps.toFixed(1)} kbps avg) across ${ingestStats.chunksTotal} chunks`
    );
  }

  /**
   * Handles incoming data from producer
   * @param {net.Socket} socket - Producer socket
   * @param {Buffer} chunk - Audio data
   */
  function handleProducerData(socket, chunk) {
    noteIngestChunk(chunk.length);

    /* Delegate to external handler for FFmpeg writing */
    const result = onData(chunk, {
      pause: () => {
        socket.pause();
        pendingSocketResume = socket;
      },
      resume: () => {
        if (socket && !socket.destroyed) {
          socket.resume();
        }
      },
      isPaused: () => socket.isPaused(),
    });

    if (result && result.paused) {
      pendingSocketResume = socket;
    }
  }

  /**
   * Attaches event handlers to producer socket
   * @param {net.Socket} socket - Producer socket
   */
  function attachProducer(socket) {
    const connectionTime = new Date().toISOString();

    if (currentProducer) {
      log(`[DEBUG] ${connectionTime} Replacing existing producer connection`);
      currentProducer.destroy();
    }

    currentProducer = socket;
    log(
      `[DEBUG] ${connectionTime} Player connected from ${socket.remoteAddress}:${socket.remotePort}`
    );
    log(`[DEBUG] Socket options: keepAlive=${socket.bufferSize}, timeout=${socket.timeout}`);

    socket.on('error', (err) => {
      const timestamp = new Date().toISOString();
      error(`[DEBUG] ${timestamp} Producer socket error: ${err.message}`);
      error(`[DEBUG] Error code: ${err.code}, errno: ${err.errno}`);
    });

    socket.on('close', () => {
      const timestamp = new Date().toISOString();
      const duration = ingestStats.start ? (Date.now() - ingestStats.start) / 1000 : 0;
      logProducerSessionSummary('Producer session ended:');
      warn(`[DEBUG] ${timestamp} Player disconnected`);
      warn(`[DEBUG] Connection duration: ${duration.toFixed(2)}s`);
      warn(`[DEBUG] Total bytes received: ${ingestStats.bytesTotal}`);
      warn(`[DEBUG] Socket state: destroyed=${socket.destroyed}`);

      if (pendingSocketResume === socket) {
        pendingSocketResume = null;
      }
      if (currentProducer === socket) {
        currentProducer = null;
      }

      resetIngestCounters();
      stopIngestIdleWarning();

      if (onProducerDisconnect) {
        onProducerDisconnect();
      }
    });

    socket.on('data', (chunk) => {
      if (!chunk || chunk.length === 0) {
        return;
      }
      handleProducerData(socket, chunk);
    });

    resetIngestCounters();
    scheduleIngestIdleWarning();
    log('[ingest] Producer connection established; ingest counters reset');

    if (onProducerConnect) {
      onProducerConnect(socket);
    }
  }

  /**
   * Starts the TCP server
   * @returns {net.Server} Server instance
   */
  function start() {
    server = net.createServer((socket) => {
      const timestamp = new Date().toISOString();
      log(`[DEBUG] ${timestamp} New TCP connection received`);
      socket.setNoDelay(true);
      log(`[DEBUG] Socket configured with TCP_NODELAY`);
      attachProducer(socket);
    });

    server.on('error', (err) => {
      error('TCP server error:', err);
    });

    server.listen(port, () => {
      log(`TCP ingest listening on ${port}`);

      /* Periodic status logging */
      setInterval(() => {
        const timestamp = new Date().toISOString();
        if (currentProducer && !currentProducer.destroyed) {
          const duration = ingestStats.start ? (Date.now() - ingestStats.start) / 1000 : 0;
          log(
            `[DEBUG] ${timestamp} Producer socket status: alive for ${duration.toFixed(1)}s, bytes=${ingestStats.bytesTotal}`
          );
        } else {
          log(`[DEBUG] ${timestamp} No active producer connection`);
        }
      }, 30000);
    });

    return server;
  }

  /**
   * Stops the TCP server
   */
  function stop() {
    stopIngestIdleWarning();
    if (currentProducer) {
      currentProducer.destroy();
      currentProducer = null;
    }
    if (server) {
      server.close();
      server = null;
    }
  }

  /**
   * Pauses producer for planned restart
   * @param {string} reason - Pause reason
   */
  function pauseProducer(reason) {
    if (currentProducer && !currentProducer.destroyed) {
      try {
        currentProducer.pause();
        pendingSocketResume = currentProducer;
        log(`[ingest] Paused producer (${reason})`);
      } catch (err) {
        warn('[ingest] Failed to pause producer during planned restart:', err.message);
      }
    } else {
      pendingSocketResume = null;
    }
  }

  /**
   * Resumes producer after planned restart
   * @param {string} reason - Resume reason
   */
  function resumeProducer(reason) {
    if (pendingSocketResume && !pendingSocketResume.destroyed) {
      try {
        pendingSocketResume.resume();
        const suffix = reason ? ` (${reason})` : '';
        log(`[ingest] Resumed producer after planned restart${suffix}`);
      } catch (err) {
        warn('[ingest] Failed to resume producer after planned restart:', err.message);
      }
    }
    pendingSocketResume = null;
  }

  /**
   * Gets current producer socket
   * @returns {net.Socket|null} Producer socket or null
   */
  function getProducer() {
    return currentProducer;
  }

  /**
   * Checks if server is listening
   * @returns {boolean} True if listening
   */
  function isListening() {
    return server && server.listening;
  }

  /**
   * Gets ingest statistics
   * @returns {Object} Statistics object
   */
  function getStats() {
    return { ...ingestStats };
  }

  return {
    /* Lifecycle */
    start,
    stop,

    /* Producer management */
    pauseProducer,
    resumeProducer,
    getProducer,

    /* State */
    isListening,
    getStats,
  };
}

module.exports = { createTcpServer };
