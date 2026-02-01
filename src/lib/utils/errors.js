'use strict';

/**
 * Error handling utilities
 * Provides standardized async/await error handling patterns
 */

/**
 * Wraps an async operation with error handling and logging
 * @param {Function} operation - Async function to execute
 * @param {any} fallback - Value to return if operation fails
 * @param {Function} logger - Logger function (warn, error, etc.)
 * @param {string} context - Description of the operation for logging
 * @returns {Promise<any>} Result of operation or fallback value
 */
async function safeAsync(operation, fallback, logger, context) {
  try {
    return await operation();
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    if (logger && context) {
      logger(`${context}: ${message}`);
    }
    return fallback;
  }
}

/**
 * Wraps an async operation that should not return a fallback
 * Logs error but re-throws for caller to handle
 * @param {Function} operation - Async function to execute
 * @param {Function} logger - Logger function (warn, error, etc.)
 * @param {string} context - Description of the operation for logging
 * @returns {Promise<any>} Result of operation
 * @throws {Error} Re-throws the caught error after logging
 */
async function tryAsync(operation, logger, context) {
  try {
    return await operation();
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    if (logger && context) {
      logger(`${context}: ${message}`);
    }
    throw err;
  }
}

/**
 * Wraps a promise with error handling (for fire-and-forget operations)
 * @param {Promise} promise - Promise to handle
 * @param {Function} logger - Logger function (optional)
 * @param {string} context - Description for logging (optional)
 */
function ignoreErrors(promise, logger, context) {
  promise.catch((err) => {
    if (logger && context) {
      const message = err && err.message ? err.message : String(err);
      logger(`${context}: ${message}`);
    }
  });
}

module.exports = {
  safeAsync,
  tryAsync,
  ignoreErrors,
};
