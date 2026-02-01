'use strict';

/**
 * FFmpeg utilities module
 *
 * Provides shared FFmpeg-related functionality used by both the server
 * and player components of StreamDJ.
 *
 * @module lib/ffmpeg
 */

const { spawn } = require('child_process');

/**
 * Timeout duration for FFmpeg availability checks in milliseconds.
 * @constant {number}
 */
const FFMPEG_CHECK_TIMEOUT_MS = 5000;

/**
 * Validates that FFmpeg is available in the system PATH.
 *
 * Spawns a test FFmpeg process with the `-version` flag to verify the
 * executable is accessible and functioning. Includes timeout protection
 * to prevent hanging if FFmpeg is unresponsive.
 *
 * @returns {Promise<boolean>} Resolves to true if FFmpeg is available and working,
 *                             false otherwise.
 *
 * @example
 * const { validateFfmpegAvailable } = require('./lib/ffmpeg');
 *
 * const available = await validateFfmpegAvailable();
 * if (!available) {
 *   console.error('FFmpeg is not installed');
 *   process.exit(1);
 * }
 */
function validateFfmpegAvailable() {
  return new Promise((resolve) => {
    let resolved = false;

    const complete = (result) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    try {
      const testProcess = spawn('ffmpeg', ['-version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      /* Consume output to prevent hanging */
      if (testProcess.stdout) {
        testProcess.stdout.on('data', () => {});
      }
      if (testProcess.stderr) {
        testProcess.stderr.on('data', () => {});
      }

      testProcess.on('error', () => {
        /* Log only in debug scenarios; callers handle the failure */
        complete(false);
      });

      testProcess.on('close', (code) => {
        complete(code === 0);
      });

      /* Timeout protection */
      const timeout = setTimeout(() => {
        try {
          testProcess.kill('SIGTERM');
          setTimeout(() => {
            if (testProcess.exitCode === null) {
              testProcess.kill('SIGKILL');
            }
          }, 1000);
        } catch {
          /* Ignore kill errors */
        }
        complete(false);
      }, FFMPEG_CHECK_TIMEOUT_MS);

      testProcess.on('close', () => {
        clearTimeout(timeout);
      });
    } catch {
      complete(false);
    }
  });
}

/**
 * Logs a formatted FFmpeg installation help message to the console.
 *
 * Provides platform-specific installation instructions for FFmpeg.
 * Used by both server and player components when FFmpeg is not found.
 *
 * @param {Function} errorLogger - Logger function to use for output (e.g., console.error)
 * @param {string} [componentName='StreamDJ'] - Name of the component for context
 */
function logFfmpegInstallHelp(errorLogger, componentName = 'StreamDJ') {
  errorLogger('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  errorLogger('FATAL: FFmpeg is not available in your system PATH');
  errorLogger('');
  errorLogger(`${componentName} requires FFmpeg to function properly.`);
  errorLogger('');
  errorLogger('Please install FFmpeg:');
  errorLogger('  • Windows: Download from https://ffmpeg.org/download.html');
  errorLogger('            or use: winget install ffmpeg');
  errorLogger('  • macOS:   brew install ffmpeg');
  errorLogger('  • Linux:   sudo apt install ffmpeg (Ubuntu/Debian)');
  errorLogger('            or sudo yum install ffmpeg (RHEL/CentOS)');
  errorLogger('');
  errorLogger('After installation, ensure "ffmpeg" is in your PATH');
  errorLogger('and restart this application.');
  errorLogger('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

module.exports = {
  validateFfmpegAvailable,
  logFfmpegInstallHelp,
  FFMPEG_CHECK_TIMEOUT_MS,
};
