'use strict';

/**
 * StreamDJ Diagnostics Module
 *
 * Provides centralized diagnostic logging, event tracking, and telemetry
 * for debugging stream restarts and performance issues.
 *
 * @module diagnostics
 */

const os = require('os');

/*
 * Configuration
 */

const MAX_LOG_ENTRIES = 5000;
const MAX_EVENTS = 1000;
const MAX_RESTART_HISTORY = 100;

/*
 * Ring buffer implementation for efficient log storage
 */
class RingBuffer {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.buffer = [];
    this.head = 0;
    this.count = 0;
  }

  push(item) {
    if (this.buffer.length < this.maxSize) {
      this.buffer.push(item);
    } else {
      this.buffer[this.head] = item;
    }
    this.head = (this.head + 1) % this.maxSize;
    this.count = Math.min(this.count + 1, this.maxSize);
  }

  toArray() {
    if (this.buffer.length < this.maxSize) {
      return [...this.buffer];
    }
    /* Return in chronological order */
    const result = [];
    for (let i = 0; i < this.maxSize; i++) {
      const idx = (this.head + i) % this.maxSize;
      result.push(this.buffer[idx]);
    }
    return result;
  }

  clear() {
    this.buffer = [];
    this.head = 0;
    this.count = 0;
  }

  get length() {
    return this.buffer.length;
  }
}

/*
 * Diagnostics state
 */

const logBuffer = new RingBuffer(MAX_LOG_ENTRIES);
const eventBuffer = new RingBuffer(MAX_EVENTS);
const restartHistory = new RingBuffer(MAX_RESTART_HISTORY);

/* Stream lifecycle state */
const streamLifecycle = {
  state: 'idle' /* idle | connecting | buffering | streaming | paused | error | reconnecting */,
  stateChangedAt: null,
  sessionStartedAt: null,
  totalUptimeMs: 0,
  sessionUptimeMs: 0,
  restartCount: 0,
  lastRestartReason: null,
  lastRestartTimestamp: null,
  lastError: null,
  lastErrorTimestamp: null,
};

/* Network telemetry */
const networkStats = {
  endpoint: null,
  connectionType: 'TCP/RTMP',
  lastRequestStatus: null,
  lastRequestTimestamp: null,
  bytesTransferred: 0,
  throughputKbps: 0,
  latencyMs: null,
  retryCount: 0,
  timeoutCount: 0,
};

/* Playback/Buffer stats */
const bufferStats = {
  currentTimeSeconds: 0,
  bufferedSeconds: 0,
  bufferHealth: 'unknown' /* healthy | low | critical | empty */,
  droppedFrames: 0,
  decodeErrors: 0,
  stallCount: 0,
  stallEvents: [],
  qualityChanges: [],
  currentBitrateKbps: 0,
};

/* Environment info */
let environmentInfo = null;

/* Process start time for uptime calculation */
const processStartTime = Date.now();

/*
 * Log levels for filtering
 */
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/*
 * Public API
 */

/**
 * Records a log entry to the diagnostics buffer
 * @param {string} level - Log level (DEBUG, INFO, WARN, ERROR)
 * @param {string} scope - Source module/component
 * @param {string} message - Log message
 * @param {Object} [metadata] - Optional structured metadata
 */
function recordLog(level, scope, message, metadata = null) {
  const entry = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    scope: scope || 'app',
    message: String(message),
    metadata: metadata,
  };
  logBuffer.push(entry);
}

/**
 * Records a diagnostic event
 * @param {string} type - Event type (e.g., 'stream.restart', 'error.ffmpeg')
 * @param {Object} data - Event data
 */
function recordEvent(type, data = {}) {
  const event = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toISOString(),
    type: type,
    data: data,
  };
  eventBuffer.push(event);

  /* Track specific event types */
  if (type === 'stream.restart') {
    restartHistory.push({
      timestamp: event.timestamp,
      reason: data.reason || 'unknown',
      trigger: data.trigger || 'unknown',
      bufferLevel: data.bufferLevel,
      lastError: data.lastError,
      networkState: data.networkState,
    });
    streamLifecycle.restartCount++;
    streamLifecycle.lastRestartReason = data.reason || 'unknown';
    streamLifecycle.lastRestartTimestamp = event.timestamp;
  }

  if (type === 'stream.error') {
    streamLifecycle.lastError = data.error || null;
    streamLifecycle.lastErrorTimestamp = event.timestamp;
  }

  if (type === 'buffer.stall') {
    bufferStats.stallCount++;
    bufferStats.stallEvents.push({
      timestamp: event.timestamp,
      duration: data.duration || 0,
      bufferLevel: data.bufferLevel,
    });
    /* Keep only last 50 stall events */
    if (bufferStats.stallEvents.length > 50) {
      bufferStats.stallEvents.shift();
    }
  }
}

/**
 * Updates the stream lifecycle state
 * @param {string} newState - New state
 * @param {Object} [context] - Additional context
 */
function setStreamState(newState, context = {}) {
  const previousState = streamLifecycle.state;
  const now = new Date().toISOString();

  streamLifecycle.state = newState;
  streamLifecycle.stateChangedAt = now;

  if (newState === 'streaming' && previousState !== 'streaming') {
    streamLifecycle.sessionStartedAt = now;
  }

  recordEvent('stream.stateChange', {
    from: previousState,
    to: newState,
    ...context,
  });
}

/**
 * Records a stream restart event with full context
 * @param {Object} params - Restart parameters
 */
function recordRestart(params = {}) {
  const {
    reason = 'unknown',
    trigger = 'auto' /* 'auto' | 'manual' | 'error' | 'config_change' */,
    errorCode = null,
    errorMessage = null,
    bufferLevel = null,
    networkState = null,
    codePath = null,
  } = params;

  recordEvent('stream.restart', {
    reason,
    trigger,
    errorCode,
    errorMessage,
    bufferLevel,
    networkState,
    codePath,
    lastError: streamLifecycle.lastError,
    previousState: streamLifecycle.state,
    uptimeBeforeRestart: streamLifecycle.sessionUptimeMs,
  });

  setStreamState('reconnecting', { reason });
}

/**
 * Updates network statistics
 * @param {Object} stats - Network stats update
 */
function updateNetworkStats(stats) {
  Object.assign(networkStats, stats);
}

/**
 * Updates buffer/playback statistics
 * @param {Object} stats - Buffer stats update
 */
function updateBufferStats(stats) {
  Object.assign(bufferStats, stats);
}

/**
 * Updates stream uptime calculations
 */
function updateUptime() {
  const now = Date.now();
  streamLifecycle.totalUptimeMs = now - processStartTime;

  if (streamLifecycle.sessionStartedAt && streamLifecycle.state === 'streaming') {
    streamLifecycle.sessionUptimeMs = now - new Date(streamLifecycle.sessionStartedAt).getTime();
  }
}

/**
 * Gathers environment information
 * @returns {Object} Environment info
 */
function getEnvironmentInfo() {
  if (!environmentInfo) {
    environmentInfo = {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      cpus: os.cpus().length,
      totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
      hostname: os.hostname(),
    };
  }

  return {
    ...environmentInfo,
    freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
    loadAverage: os.loadavg(),
    uptimeSeconds: os.uptime(),
    processUptimeSeconds: process.uptime(),
  };
}

/**
 * Gets logs filtered by level
 * @param {string} [minLevel='DEBUG'] - Minimum log level
 * @param {number} [limit] - Maximum entries to return
 * @returns {Array} Filtered log entries
 */
function getLogs(minLevel = 'DEBUG', limit = 1000) {
  const minLevelNum = LOG_LEVELS[minLevel.toUpperCase()] || 0;
  const allLogs = logBuffer.toArray();

  const filtered = allLogs.filter((entry) => {
    const entryLevel = LOG_LEVELS[entry.level] || 0;
    return entryLevel >= minLevelNum;
  });

  return limit ? filtered.slice(-limit) : filtered;
}

/**
 * Gets recent events
 * @param {string} [type] - Filter by event type
 * @param {number} [limit] - Maximum entries to return
 * @returns {Array} Events
 */
function getEvents(type = null, limit = 100) {
  const allEvents = eventBuffer.toArray();

  const filtered = type
    ? allEvents.filter((e) => e.type === type || e.type.startsWith(type + '.'))
    : allEvents;

  return limit ? filtered.slice(-limit) : filtered;
}

/**
 * Gets restart history
 * @param {number} [limit] - Maximum entries to return
 * @returns {Array} Restart events
 */
function getRestartHistory(limit = 50) {
  const history = restartHistory.toArray();
  return limit ? history.slice(-limit) : history;
}

/**
 * Gets complete diagnostics snapshot
 * @returns {Object} Full diagnostics data
 */
function getDiagnosticsSnapshot() {
  updateUptime();

  return {
    generatedAt: new Date().toISOString(),
    streamLifecycle: { ...streamLifecycle },
    networkStats: { ...networkStats },
    bufferStats: {
      ...bufferStats,
      stallEvents: bufferStats.stallEvents.slice(-20),
      qualityChanges: bufferStats.qualityChanges.slice(-20),
    },
    environment: getEnvironmentInfo(),
    restartHistory: getRestartHistory(20),
    recentEvents: getEvents(null, 50),
    logStats: {
      totalEntries: logBuffer.length,
      maxEntries: MAX_LOG_ENTRIES,
    },
  };
}

/**
 * Exports full diagnostics data for sharing/download
 * @returns {Object} Exportable diagnostics bundle
 */
function exportDiagnostics() {
  updateUptime();

  return {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    streamLifecycle: { ...streamLifecycle },
    networkStats: { ...networkStats },
    bufferStats: { ...bufferStats },
    environment: getEnvironmentInfo(),
    restartHistory: restartHistory.toArray(),
    events: eventBuffer.toArray(),
    logs: logBuffer.toArray(),
  };
}

/**
 * Clears all diagnostic data
 */
function clearDiagnostics() {
  logBuffer.clear();
  eventBuffer.clear();
  restartHistory.clear();
  bufferStats.stallEvents = [];
  bufferStats.qualityChanges = [];
  bufferStats.stallCount = 0;
  bufferStats.droppedFrames = 0;
  bufferStats.decodeErrors = 0;
  streamLifecycle.restartCount = 0;

  recordEvent('diagnostics.cleared', {});
}

/**
 * Creates a diagnostics-aware logger that also pipes to the buffer
 * @param {string} scope - Logger scope
 * @returns {Object} Logger with debug, log, warn, error methods
 */
function createDiagnosticsLogger(scope) {
  return {
    debug: (...args) => {
      recordLog('DEBUG', scope, args.join(' '));
    },
    log: (...args) => {
      recordLog('INFO', scope, args.join(' '));
    },
    warn: (...args) => {
      recordLog('WARN', scope, args.join(' '));
    },
    error: (...args) => {
      recordLog('ERROR', scope, args.join(' '));
    },
  };
}

module.exports = {
  recordLog,
  recordEvent,
  recordRestart,
  setStreamState,
  updateNetworkStats,
  updateBufferStats,
  getLogs,
  getEvents,
  getRestartHistory,
  getDiagnosticsSnapshot,
  exportDiagnostics,
  clearDiagnostics,
  createDiagnosticsLogger,
  getEnvironmentInfo,
};
