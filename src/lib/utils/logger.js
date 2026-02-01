'use strict';

/*
 * Simple logger utility
 *
 * Behavior:
 *  - Adds an ISO timestamp and log level to each line
 *  - Adds an optional scope prefix when createLogger(scope) is used
 *  - Supports JSON output when LOG_FORMAT=json e.g. { timestamp, level, scope, message }
 *  - Uses environment variable LOG_LEVEL to filter messages (DEBUG, INFO, WARN, ERROR)
 *
 * Usage:
 *  const { createLogger } = require('./lib/logger');
 *  const { log, warn, error } = createLogger('server');
 *  log('Message', { metadata: true });
 */

const LOG_LEVEL = process.env.LOG_LEVEL || 'INFO';
const LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const CURRENT_LEVEL = LEVELS[LOG_LEVEL.toUpperCase()] ?? LEVELS.INFO;

/*
 * Safely serializes arguments passed to logger methods. JSON.stringify may throw
 * for circular references; fall back to util.inspect for a readable alternative.
 */
const util = require('util');

function serializeArg(arg) {
  if (typeof arg === 'string') return arg;
  try {
    if (typeof arg === 'object' && arg !== null) {
      return JSON.stringify(arg);
    }
    return String(arg);
  } catch {
    return util.inspect(arg, { depth: null });
  }
}

/**
 * Builds the final textual output for a log invocation.
 *
 * For non-JSON output this creates a human-readable line like:
 *  2025-11-17T12:34:56.789Z INFO  [server] My message
 *
 * When LOG_FORMAT=json is set, it produces a single JSON object string with
 * keys: timestamp, level, scope, message.
 */
function formatMessage(level, scope, args) {
  const timestamp = new Date().toISOString();
  const message = args.map(serializeArg).join(' ');

  if (process.env.LOG_FORMAT === 'json') {
    return JSON.stringify({ timestamp, level, scope, message });
  }

  const scopePrefix = scope ? `[${scope}]` : '[app]';
  return `${timestamp} ${level.padEnd(5)} ${scopePrefix} ${message}`;
}

function shouldLog(level) {
  return LEVELS[level] >= CURRENT_LEVEL;
}

/*
 * Optional diagnostics recorder - lazy loaded to avoid circular dependency.
 * Set via setDiagnosticsRecorder() after diagnostics module is loaded.
 */
let diagnosticsRecorder = null;

function setDiagnosticsRecorder(recorder) {
  diagnosticsRecorder = recorder;
}

function recordToDiagnostics(level, scope, message) {
  if (diagnosticsRecorder && typeof diagnosticsRecorder.recordLog === 'function') {
    try {
      diagnosticsRecorder.recordLog(level, scope, message);
    } catch {
      /* Ignore errors in diagnostics recording */
    }
  }
}

function createLogger(scope) {
  /*
   * Create a logger object with scoped convenience methods:
   *  - debug(...args)
   *  - log(...args) [info]
   *  - warn(...args)
   *  - error(...args)
   *
   * The scope string will be placed in square brackets in the log output.
   * Logs are also piped to the diagnostics buffer if configured.
   */
  return {
    debug: (...args) => {
      const message = args.map(serializeArg).join(' ');
      recordToDiagnostics('DEBUG', scope, message);
      if (shouldLog('DEBUG')) {
        console.debug(formatMessage('DEBUG', scope, args));
      }
    },
    log: (...args) => {
      const message = args.map(serializeArg).join(' ');
      recordToDiagnostics('INFO', scope, message);
      if (shouldLog('INFO')) {
        console.log(formatMessage('INFO', scope, args));
      }
    },
    warn: (...args) => {
      const message = args.map(serializeArg).join(' ');
      recordToDiagnostics('WARN', scope, message);
      if (shouldLog('WARN')) {
        console.warn(formatMessage('WARN', scope, args));
      }
    },
    error: (...args) => {
      const message = args.map(serializeArg).join(' ');
      recordToDiagnostics('ERROR', scope, message);
      if (shouldLog('ERROR')) {
        console.error(formatMessage('ERROR', scope, args));
      }
    },
  };
}

module.exports = {
  createLogger,
  setDiagnosticsRecorder,
};
