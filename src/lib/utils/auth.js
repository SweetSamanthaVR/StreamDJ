'use strict';

/**
 * Authentication Middleware Module
 *
 * Provides optional API key authentication for StreamDJ HTTP endpoints.
 * When STREAMDJ_API_KEY is set in the environment, all protected endpoints
 * require a valid API key via Authorization header or X-API-Key header.
 *
 * @module lib/utils/auth
 */

const crypto = require('crypto');

/**
 * Get the configured API key from environment.
 * @returns {string|null} The API key if configured, null otherwise
 */
function getApiKey() {
  const key = process.env.STREAMDJ_API_KEY;
  return key && key.trim().length > 0 ? key.trim() : null;
}

/**
 * Check if authentication is enabled.
 * @returns {boolean} True if API key is configured
 */
function isAuthEnabled() {
  return getApiKey() !== null;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if strings are equal
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    /* Still do a comparison to prevent length-based timing attacks */
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Extract API key from request headers.
 * Supports both Authorization: Bearer <key> and X-API-Key: <key>
 * @param {Object} req - Express request object
 * @returns {string|null} The extracted API key or null
 */
function extractApiKey(req) {
  /* Check X-API-Key header first */
  const xApiKey = req.headers['x-api-key'];
  if (xApiKey && typeof xApiKey === 'string') {
    return xApiKey.trim();
  }

  /* Check Authorization: Bearer <key> header */
  const authHeader = req.headers['authorization'];
  if (authHeader && typeof authHeader === 'string') {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      return parts[1].trim();
    }
  }

  return null;
}

/**
 * Validate the provided API key against the configured key.
 * @param {string|null} providedKey - The key from the request
 * @returns {boolean} True if valid or auth is disabled
 */
function validateApiKey(providedKey) {
  const configuredKey = getApiKey();
  if (!configuredKey) {
    /* Auth not enabled, allow all requests */
    return true;
  }
  if (!providedKey) {
    return false;
  }
  return safeCompare(providedKey, configuredKey);
}

/**
 * Express middleware that enforces API key authentication when enabled.
 * If STREAMDJ_API_KEY is not set, all requests are allowed.
 * If set, requests must include a valid API key.
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
function authMiddleware(req, res, next) {
  if (!isAuthEnabled()) {
    return next();
  }

  const providedKey = extractApiKey(req);
  if (validateApiKey(providedKey)) {
    return next();
  }

  res.status(401).json({
    error: 'Unauthorized',
    message: 'Valid API key required. Provide via Authorization: Bearer <key> or X-API-Key header.',
  });
}

/**
 * Create an auth middleware with custom options.
 * @param {Object} [options] - Configuration options
 * @param {string[]} [options.excludePaths] - Paths to exclude from auth (e.g., ['/health'])
 * @returns {Function} Express middleware
 */
function createAuthMiddleware(options = {}) {
  const { excludePaths = [] } = options;

  return function (req, res, next) {
    /* Skip auth for excluded paths */
    if (excludePaths.some((p) => req.path === p || req.path.startsWith(p + '/'))) {
      return next();
    }
    return authMiddleware(req, res, next);
  };
}

module.exports = {
  getApiKey,
  isAuthEnabled,
  extractApiKey,
  validateApiKey,
  authMiddleware,
  createAuthMiddleware,
};
