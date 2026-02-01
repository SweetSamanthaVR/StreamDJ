'use strict';

/**
 * StreamDJ Authentication and Network Binding Tests
 *
 * Tests for H-2 audit item: Unauthenticated HTTP APIs on Multiple Ports
 *
 * Verifies:
 * 1. Default binding is localhost (127.0.0.1)
 * 2. When auth is enabled, protected endpoints reject unauthenticated requests
 * 3. When auth is enabled, authenticated requests succeed
 *
 * Run with: npm test
 */

const assert = require('assert');
const { describe, it, before, after } = require('node:test');

/* Import auth module */
const {
  getApiKey,
  isAuthEnabled,
  extractApiKey,
  validateApiKey,
  createAuthMiddleware,
} = require('../src/lib/utils/auth');

/* Import config module */
const { HTTP_HOST, PLAYER_API_HOST, DEFAULT_HTTP_HOST } = require('../src/lib/config');

/* ==========================================================================
 * Test Suite: Configuration Defaults
 * ========================================================================== */

describe('Configuration Defaults', () => {
  it('DEFAULT_HTTP_HOST should be 127.0.0.1', () => {
    assert.strictEqual(DEFAULT_HTTP_HOST, '127.0.0.1', 'Default host should be localhost');
  });

  it('HTTP_HOST should default to 127.0.0.1 when not set', () => {
    /* When HTTP_HOST env is not set, it should use the default */
    if (!process.env.HTTP_HOST) {
      assert.strictEqual(HTTP_HOST, '127.0.0.1', 'HTTP_HOST should default to localhost');
    }
  });

  it('PLAYER_API_HOST should default to 127.0.0.1 when not set', () => {
    /* When PLAYER_API_HOST env is not set, it should use the default */
    if (!process.env.PLAYER_API_HOST) {
      assert.strictEqual(
        PLAYER_API_HOST,
        '127.0.0.1',
        'PLAYER_API_HOST should default to localhost'
      );
    }
  });
});

/* ==========================================================================
 * Test Suite: Auth Module - No Auth Configured
 * ========================================================================== */

describe('Auth Module - No Auth Configured', () => {
  before(() => {
    /* Ensure no API key is set for these tests */
    delete process.env.STREAMDJ_API_KEY;
  });

  it('getApiKey should return null when not configured', () => {
    delete process.env.STREAMDJ_API_KEY;
    const key = getApiKey();
    assert.strictEqual(key, null, 'API key should be null when not set');
  });

  it('isAuthEnabled should return false when not configured', () => {
    delete process.env.STREAMDJ_API_KEY;
    const enabled = isAuthEnabled();
    assert.strictEqual(enabled, false, 'Auth should be disabled when no key is set');
  });

  it('validateApiKey should return true for any key when auth is disabled', () => {
    delete process.env.STREAMDJ_API_KEY;
    assert.strictEqual(validateApiKey(null), true, 'Should allow null key when auth disabled');
    assert.strictEqual(validateApiKey('any-key'), true, 'Should allow any key when auth disabled');
  });
});

/* ==========================================================================
 * Test Suite: Auth Module - Auth Enabled
 * ========================================================================== */

describe('Auth Module - Auth Enabled', () => {
  const TEST_API_KEY = 'test-secret-key-12345';

  before(() => {
    process.env.STREAMDJ_API_KEY = TEST_API_KEY;
  });

  after(() => {
    delete process.env.STREAMDJ_API_KEY;
  });

  it('getApiKey should return the configured key', () => {
    const key = getApiKey();
    assert.strictEqual(key, TEST_API_KEY, 'Should return configured API key');
  });

  it('isAuthEnabled should return true when key is configured', () => {
    const enabled = isAuthEnabled();
    assert.strictEqual(enabled, true, 'Auth should be enabled when key is set');
  });

  it('validateApiKey should reject null key when auth is enabled', () => {
    assert.strictEqual(validateApiKey(null), false, 'Should reject null key');
  });

  it('validateApiKey should reject wrong key when auth is enabled', () => {
    assert.strictEqual(validateApiKey('wrong-key'), false, 'Should reject wrong key');
  });

  it('validateApiKey should accept correct key when auth is enabled', () => {
    assert.strictEqual(validateApiKey(TEST_API_KEY), true, 'Should accept correct key');
  });

  it('validateApiKey should reject empty string key', () => {
    assert.strictEqual(validateApiKey(''), false, 'Should reject empty key');
  });
});

/* ==========================================================================
 * Test Suite: Auth Key Extraction
 * ========================================================================== */

describe('Auth Key Extraction', () => {
  it('extractApiKey should extract from X-API-Key header', () => {
    const mockReq = {
      headers: {
        'x-api-key': 'my-api-key',
      },
    };
    const key = extractApiKey(mockReq);
    assert.strictEqual(key, 'my-api-key', 'Should extract from X-API-Key header');
  });

  it('extractApiKey should extract from Authorization Bearer header', () => {
    const mockReq = {
      headers: {
        authorization: 'Bearer my-bearer-token',
      },
    };
    const key = extractApiKey(mockReq);
    assert.strictEqual(key, 'my-bearer-token', 'Should extract from Bearer header');
  });

  it('extractApiKey should prefer X-API-Key over Authorization', () => {
    const mockReq = {
      headers: {
        'x-api-key': 'x-api-key-value',
        authorization: 'Bearer bearer-value',
      },
    };
    const key = extractApiKey(mockReq);
    assert.strictEqual(key, 'x-api-key-value', 'Should prefer X-API-Key header');
  });

  it('extractApiKey should return null when no auth headers present', () => {
    const mockReq = {
      headers: {},
    };
    const key = extractApiKey(mockReq);
    assert.strictEqual(key, null, 'Should return null when no auth headers');
  });

  it('extractApiKey should handle malformed Authorization header', () => {
    const mockReq = {
      headers: {
        authorization: 'InvalidFormat',
      },
    };
    const key = extractApiKey(mockReq);
    assert.strictEqual(key, null, 'Should return null for malformed auth header');
  });

  it('extractApiKey should trim whitespace from keys', () => {
    const mockReq = {
      headers: {
        'x-api-key': '  trimmed-key  ',
      },
    };
    const key = extractApiKey(mockReq);
    assert.strictEqual(key, 'trimmed-key', 'Should trim whitespace from key');
  });
});

/* ==========================================================================
 * Test Suite: Auth Middleware
 * ========================================================================== */

describe('Auth Middleware', () => {
  const TEST_API_KEY = 'middleware-test-key';

  it('middleware should call next() when auth is disabled', (t, done) => {
    delete process.env.STREAMDJ_API_KEY;
    const middleware = createAuthMiddleware();
    const mockReq = { headers: {}, path: '/test' };
    const mockRes = {};

    middleware(mockReq, mockRes, () => {
      /* next() was called - test passes */
      done();
    });
  });

  it('middleware should skip auth for excluded paths', (t, done) => {
    process.env.STREAMDJ_API_KEY = TEST_API_KEY;
    const middleware = createAuthMiddleware({ excludePaths: ['/health'] });
    const mockReq = { headers: {}, path: '/health' };
    const mockRes = {};

    middleware(mockReq, mockRes, () => {
      /* next() was called - path was excluded */
      delete process.env.STREAMDJ_API_KEY;
      done();
    });
  });

  it('middleware should return 401 for missing key when auth enabled', (t, done) => {
    process.env.STREAMDJ_API_KEY = TEST_API_KEY;
    const middleware = createAuthMiddleware();
    const mockReq = { headers: {}, path: '/api/test' };
    let statusCode = null;
    let responseBody = null;
    const mockRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        responseBody = body;
        return this;
      },
    };

    middleware(mockReq, mockRes, () => {
      assert.fail('next() should not be called for missing key');
    });

    assert.strictEqual(statusCode, 401, 'Should return 401 status');
    assert.strictEqual(responseBody.error, 'Unauthorized', 'Should return Unauthorized error');
    delete process.env.STREAMDJ_API_KEY;
    done();
  });

  it('middleware should return 401 for invalid key when auth enabled', (t, done) => {
    process.env.STREAMDJ_API_KEY = TEST_API_KEY;
    const middleware = createAuthMiddleware();
    const mockReq = { headers: { 'x-api-key': 'wrong-key' }, path: '/api/test' };
    let statusCode = null;
    const mockRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json() {
        return this;
      },
    };

    middleware(mockReq, mockRes, () => {
      assert.fail('next() should not be called for invalid key');
    });

    assert.strictEqual(statusCode, 401, 'Should return 401 for invalid key');
    delete process.env.STREAMDJ_API_KEY;
    done();
  });

  it('middleware should call next() for valid key when auth enabled', (t, done) => {
    process.env.STREAMDJ_API_KEY = TEST_API_KEY;
    const middleware = createAuthMiddleware();
    const mockReq = { headers: { 'x-api-key': TEST_API_KEY }, path: '/api/test' };
    const mockRes = {};

    middleware(mockReq, mockRes, () => {
      /* next() was called - valid key accepted */
      delete process.env.STREAMDJ_API_KEY;
      done();
    });
  });

  it('middleware should accept valid Bearer token', (t, done) => {
    process.env.STREAMDJ_API_KEY = TEST_API_KEY;
    const middleware = createAuthMiddleware();
    const mockReq = {
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      path: '/api/test',
    };
    const mockRes = {};

    middleware(mockReq, mockRes, () => {
      /* next() was called - valid Bearer token accepted */
      delete process.env.STREAMDJ_API_KEY;
      done();
    });
  });
});

/* ==========================================================================
 * Test Suite: Empty/Whitespace API Key
 * ========================================================================== */

describe('Empty API Key Handling', () => {
  it('empty string API key should disable auth', () => {
    process.env.STREAMDJ_API_KEY = '';
    assert.strictEqual(isAuthEnabled(), false, 'Empty string key should disable auth');
    delete process.env.STREAMDJ_API_KEY;
  });

  it('whitespace-only API key should disable auth', () => {
    process.env.STREAMDJ_API_KEY = '   ';
    assert.strictEqual(isAuthEnabled(), false, 'Whitespace-only key should disable auth');
    delete process.env.STREAMDJ_API_KEY;
  });
});

console.log('Running StreamDJ authentication and binding tests...');
