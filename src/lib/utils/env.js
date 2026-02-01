'use strict';

const { URL } = require('url');

/*
 * Environment variable helpers for StreamDJ.
 *
 * Conventions:
 *  - Functions prefixed with `require*` will log an error and exit the
 *    process immediately when the variable is missing or invalid.
 *  - Functions prefixed with `optional*` accept a fallback and only exit
 *    when a provided value fails validation.
 *  - The optional `context` string is included in error messages to
 *    indicate which component is reading the variable (e.g. "server",
 *    "player", or "streamdj").
 */

/*
 * Required / optional string environment variables
 */

function requireEnv(name, context) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    const prefix = context ? `[${context}]` : '[env]';
    console.error(`${prefix} Missing required environment variable ${name}`);
    process.exit(1);
  }
  return value;
}

function requireIntEnv(name, context) {
  const raw = requireEnv(name, context);
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    const prefix = context ? `[${context}]` : '[env]';
    console.error(`${prefix} Environment variable ${name} must be an integer. Received: ${raw}`);
    process.exit(1);
  }
  return parsed;
}

function optionalEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }
  return value;
}

/*
 * Integer / port helpers
 */

function optionalIntEnv(name, fallback, context) {
  const value = optionalEnv(name, undefined);
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    const prefix = context ? `[${context}]` : '[env]';
    console.error(
      `${prefix} Environment variable ${name} must be an integer when provided. Received: ${value}`
    );
    process.exit(1);
  }
  return parsed;
}

function requirePortEnv(name, context) {
  const port = requireIntEnv(name, context);
  if (port < 1 || port > 65535) {
    const prefix = context ? `[${context}]` : '[env]';
    console.error(`${prefix} Port ${name} must be between 1-65535. Got: ${port}`);
    process.exit(1);
  }
  return port;
}

function optionalPortEnv(name, fallback, context) {
  const port = optionalIntEnv(name, fallback, context);
  if (port < 1 || port > 65535) {
    const prefix = context ? `[${context}]` : '[env]';
    console.error(`${prefix} Port ${name} must be between 1-65535. Got: ${port}`);
    process.exit(1);
  }
  return port;
}

/*
 * URL helpers
 */

function requireUrlEnv(name, protocol, context) {
  const url = requireEnv(name, context);
  try {
    const parsed = new URL(url);
    /* Normalize protocol param like 'rtmp://' -> 'rtmp:' for comparison with URL.protocol */
    const normalizedProto = protocol.replace(/:\/\/$/, ':');
    if (parsed.protocol !== normalizedProto) {
      const prefix = context ? `[${context}]` : '[env]';
      console.error(`${prefix} ${name} must start with ${protocol}. Got: ${url}`);
      process.exit(1);
    }
    if (!parsed.hostname) {
      const prefix = context ? `[${context}]` : '[env]';
      console.error(`${prefix} ${name} must include a hostname (eg ${protocol}host). Got: ${url}`);
      process.exit(1);
    }
  } catch (err) {
    const prefix = context ? `[${context}]` : '[env]';
    console.error(`${prefix} ${name} is not a valid URL: ${err.message}`);
    process.exit(1);
  }
  return url;
}

/*
 * Positive integer helpers
 */

function requirePositiveIntEnv(name, context) {
  const value = requireIntEnv(name, context);
  if (value <= 0) {
    const prefix = context ? `[${context}]` : '[env]';
    console.error(`${prefix} ${name} must be a positive integer. Got: ${value}`);
    process.exit(1);
  }
  return value;
}

function optionalPositiveIntEnv(name, fallback, context) {
  const value = optionalIntEnv(name, fallback, context);
  if (value <= 0) {
    const prefix = context ? `[${context}]` : '[env]';
    console.error(`${prefix} ${name} must be a positive integer when provided. Got: ${value}`);
    process.exit(1);
  }
  return value;
}

/*
 * File path helpers
 */

function requireFilePathEnv(name, context) {
  const fs = require('fs');
  const filePath = requireEnv(name, context);
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      const prefix = context ? `[${context}]` : '[env]';
      console.error(`${prefix} ${name} must point to a file. Got: ${filePath}`);
      process.exit(1);
    }
  } catch (err) {
    const prefix = context ? `[${context}]` : '[env]';
    const detail = err && err.message ? ` (${err.message})` : '';
    console.error(
      `${prefix} ${name} file does not exist or is not accessible: ${filePath}${detail}`
    );
    process.exit(1);
  }
  return filePath;
}

function optionalFilePathEnv(name, fallback, context) {
  const fs = require('fs');
  const filePath = optionalEnv(name, fallback);
  if (filePath === undefined) {
    return fallback;
  }
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      const prefix = context ? `[${context}]` : '[env]';
      console.error(`${prefix} ${name} must point to a file when provided. Got: ${filePath}`);
      process.exit(1);
    }
  } catch (err) {
    const prefix = context ? `[${context}]` : '[env]';
    const detail = err && err.message ? ` (${err.message})` : '';
    console.error(
      `${prefix} ${name} file does not exist or is not accessible: ${filePath}${detail}`
    );
    process.exit(1);
  }
  return filePath;
}

module.exports = {
  requireEnv,
  requireIntEnv,
  optionalEnv,
  optionalIntEnv,
  requirePortEnv,
  optionalPortEnv,
  requireUrlEnv,
  requirePositiveIntEnv,
  optionalPositiveIntEnv,
  requireFilePathEnv,
  optionalFilePathEnv,
};
