'use strict';

/**
 * FFmpeg Manager Module
 *
 * Handles FFmpeg process lifecycle including spawning, monitoring,
 * restart scheduling with exponential backoff, and crash loop prevention.
 *
 * @module server/ffmpeg-manager
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
  SAMPLE_RATE,
  CHANNELS,
  VIDEO_WIDTH,
  VIDEO_HEIGHT,
  VIDEO_FPS,
  VIDEO_BITRATE,
  VIDEO_PRESET,
  FFMPEG_HEARTBEAT_INTERVAL_MS,
  FFMPEG_STALL_WARN_MS,
  FFMPEG_RESTART_MAX_ATTEMPTS,
  FFMPEG_RESTART_WINDOW_MS,
  FFMPEG_RESTART_BACKOFF_BASE_MS,
  FFMPEG_RESTART_BACKOFF_MAX_MS,
  FFMPEG_STABLE_RUN_MS,
  FFMPEG_AUTO_RESTART,
} = require('./constants');

/**
 * Creates an FFmpeg manager instance
 * @param {Object} deps - Dependencies
 * @param {string} deps.rtmpUrl - Base RTMP URL
 * @param {string} deps.streamKey - Stream key
 * @param {Function} deps.log - Logger function
 * @param {Function} deps.warn - Warning logger function
 * @param {Function} deps.error - Error logger function
 * @param {Function} deps.getBackground - Function to get current background
 * @param {Function} deps.getOverlayStyle - Function to get overlay style
 * @param {Function} deps.getMetadata - Function to get current metadata
 * @param {Function} deps.buildDrawtextFilter - Function to build drawtext filter
 * @param {Object} deps.diagnostics - Diagnostics instance
 * @param {Function} deps.onSpawn - Callback when FFmpeg spawns
 * @param {Function} deps.onClose - Callback when FFmpeg closes
 * @param {Function} deps.onDrain - Callback when stdin drains
 * @returns {Object} FFmpeg manager API
 */
function createFfmpegManager(deps) {
  const {
    rtmpUrl,
    streamKey,
    log,
    warn,
    error,
    getBackground,
    getOverlayStyle,
    getMetadata,
    buildDrawtextFilter,
    diagnostics,
    onSpawn,
    onClose,
    onDrain,
  } = deps;

  /* State */
  let ffmpegProcess = null;
  let ffmpegWritable = true;
  let restartingFfmpeg = false;
  let ffmpegRestartAttempts = [];
  let ffmpegStartedAt = null;
  let ffmpegBlocked = false;
  let ffmpegBlockTimeout = null; /* Timer for automatic unblock */
  let manualRestartReason = null;
  let pendingOverlayStyleRestart = false;
  let plannedPauseReason = null;

  /* Heartbeat state */
  let heartbeatTimer = null;
  const heartbeatState = {
    lastFrame: null,
    stallWarnings: 0,
    lastWarningAt: null,
    startedAt: null,
  };
  let lastProgress = null;
  let lastProgressUpdateAt = null;

  /* Status tracking */
  const rtmpStatus = {
    connected: false,
    bitrateKbps: 0,
    ffmpegRestarts: 0,
    backgroundSource: null,
    overlayStyleVersion: null,
    overlayStyleUpdatedAt: null,
    lastMetadata: null,
    lastUpdate: null,
  };

  /**
   * Builds complete RTMP target URL
   * @returns {string} Complete RTMP URL
   */
  function buildRtmpTarget() {
    const separator = rtmpUrl.endsWith('/') ? '' : '/';
    return `${rtmpUrl}${separator}${streamKey}`;
  }

  /**
   * Resolves and validates background path
   * @param {string|null} backgroundPath - Path to background
   * @returns {string|null} Resolved path or null for solid color
   */
  function resolveBackgroundPath(backgroundPath) {
    if (!backgroundPath) {
      return null;
    }

    try {
      const candidate = path.resolve(backgroundPath);
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        return candidate;
      } else {
        warn(`Background source at ${candidate} is not a file. Using solid color.`);
        return null;
      }
    } catch (err) {
      warn(`Background source ${backgroundPath} unavailable: ${err.message}. Using solid color.`);
      return null;
    }
  }

  /**
   * Formats FFmpeg progress time
   * @param {Object} progress - Progress object
   * @returns {string} Formatted time
   */
  function formatProgressTime(progress) {
    if (!progress || typeof progress !== 'object') {
      return 'n/a';
    }
    const timeVal = Number(progress.out_time_ms);
    if (!Number.isFinite(timeVal) || timeVal <= 0) {
      return 'n/a';
    }
    const totalSeconds = Math.floor(timeVal / 1000000);
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return [hrs, mins, secs].map((part) => String(part).padStart(2, '0')).join(':');
  }

  /**
   * Starts heartbeat monitoring
   */
  function startHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    heartbeatState.startedAt = Date.now();
    heartbeatTimer = setInterval(() => {
      /* Check if process still exists */
      if (ffmpegProcess && ffmpegProcess.killed) {
        error(`[DEBUG] FFmpeg process detected as killed but close event not fired`);
        rtmpStatus.connected = false;
        ffmpegProcess = null;
        stopHeartbeat();
        scheduleRestart();
        return;
      }

      /* Log progress */
      const timeDisplay = formatProgressTime(lastProgress);
      const frameValueRaw = lastProgress && lastProgress.frame ? lastProgress.frame : null;
      const frameValue = frameValueRaw !== null ? Number(String(frameValueRaw).trim()) : null;
      const frameDisplay = Number.isFinite(frameValue) ? frameValue : frameValueRaw || 'n/a';
      log(
        `[ffmpeg-heartbeat] time=${timeDisplay} frame=${frameDisplay} bitrate=${rtmpStatus.bitrateKbps.toFixed(1)} kbps connected=${rtmpStatus.connected}`
      );

      /* Reset stall warnings if frame progressed */
      if (Number.isFinite(frameValue) && heartbeatState.lastFrame !== frameValue) {
        heartbeatState.lastFrame = frameValue;
        heartbeatState.stallWarnings = 0;
        heartbeatState.lastWarningAt = null;
      }

      /* Check for stalled encoding */
      const now = Date.now();
      const progressTimestamp = lastProgressUpdateAt || heartbeatState.startedAt;
      if (!progressTimestamp) {
        return;
      }

      const stalledMs = now - progressTimestamp;
      if (stalledMs > FFMPEG_STALL_WARN_MS) {
        if (
          !heartbeatState.lastWarningAt ||
          now - heartbeatState.lastWarningAt >= FFMPEG_STALL_WARN_MS
        ) {
          heartbeatState.stallWarnings += 1;
          heartbeatState.lastWarningAt = now;
          warn(
            `[ffmpeg-heartbeat] Encoder progress stalled for ${(stalledMs / 1000).toFixed(1)}s (frame=${frameDisplay}, bitrate=${rtmpStatus.bitrateKbps.toFixed(1)} kbps)`
          );
        }
      }
    }, FFMPEG_HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Stops heartbeat monitoring
   */
  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    heartbeatState.lastFrame = null;
    heartbeatState.stallWarnings = 0;
    heartbeatState.lastWarningAt = null;
    heartbeatState.startedAt = null;
    lastProgressUpdateAt = null;
  }

  /**
   * Schedules FFmpeg restart with exponential backoff
   */
  function scheduleRestart() {
    if (!FFMPEG_AUTO_RESTART) {
      warn('FFmpeg auto-restart disabled by configuration');
      if (diagnostics) {
        diagnostics.recordEvent('ffmpeg.restart.disabled', { reason: 'config' });
      }
      return;
    }

    if (restartingFfmpeg) {
      return;
    }

    const now = Date.now();

    /* Filter to recent attempts */
    ffmpegRestartAttempts = ffmpegRestartAttempts.filter(
      (ts) => now - ts <= FFMPEG_RESTART_WINDOW_MS
    );

    /* Check threshold */
    if (ffmpegRestartAttempts.length >= FFMPEG_RESTART_MAX_ATTEMPTS) {
      ffmpegBlocked = true;
      rtmpStatus.connected = false;
      error(
        `FFmpeg restart limit exceeded (${ffmpegRestartAttempts.length} restarts in ${FFMPEG_RESTART_WINDOW_MS}ms window) - entering blocked state.`
      );

      /* Schedule automatic unblock after 5 minutes */
      if (ffmpegBlockTimeout) {
        clearTimeout(ffmpegBlockTimeout);
      }
      ffmpegBlockTimeout = setTimeout(() => {
        ffmpegBlocked = false;
        ffmpegRestartAttempts = [];
        log('FFmpeg blocked state cleared automatically after timeout - ready to retry');
      }, 300000); /* 5 minutes */

      if (diagnostics) {
        diagnostics.recordEvent('ffmpeg.crashLoop', {
          attemptsInWindow: ffmpegRestartAttempts.length,
          windowMs: FFMPEG_RESTART_WINDOW_MS,
        });
        diagnostics.setStreamState('error', { reason: 'crash_loop_detected' });
      }
      return;
    }

    /* Calculate backoff */
    const attemptNo = ffmpegRestartAttempts.length;
    const baseDelay = Math.min(
      FFMPEG_RESTART_BACKOFF_BASE_MS * Math.pow(2, attemptNo),
      FFMPEG_RESTART_BACKOFF_MAX_MS
    );
    const jitter = Math.floor(Math.random() * Math.min(1000, baseDelay));
    const delay = baseDelay + jitter;

    ffmpegRestartAttempts.push(now);
    rtmpStatus.ffmpegRestarts += 1;

    if (diagnostics) {
      diagnostics.recordRestart({
        reason: manualRestartReason || 'auto_recovery',
        trigger: manualRestartReason ? 'manual' : 'auto',
        codePath: 'scheduleRestart',
      });
    }

    log(
      `Scheduling FFmpeg restart (attempt ${ffmpegRestartAttempts.length}/${FFMPEG_RESTART_MAX_ATTEMPTS}) with ${delay}ms backoff`
    );

    restartingFfmpeg = true;
    setTimeout(() => {
      restartingFfmpeg = false;
      spawn_();
    }, delay);
  }

  /**
   * Spawns the FFmpeg process
   */
  function spawn_() {
    const target = buildRtmpTarget();
    const currentStyle = getOverlayStyle();
    const drawTextFilter = buildDrawtextFilter(currentStyle);
    const currentBackground = getBackground();
    const bgPath = resolveBackgroundPath(currentBackground);
    const metadata = getMetadata();

    log(`[ffmpeg] Background source: ${bgPath || 'solid black'}`);
    log(`[ffmpeg] Audio input (pipe:0): ${SAMPLE_RATE}Hz ${CHANNELS}ch s16le`);

    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-progress',
      'pipe:2',
      '-thread_queue_size',
      '512',
    ];

    /* Video input */
    if (bgPath) {
      args.push('-loop', '1', '-i', bgPath);
    } else {
      args.push(
        '-f',
        'lavfi',
        '-i',
        `color=size=${VIDEO_WIDTH}x${VIDEO_HEIGHT}:rate=${VIDEO_FPS}:color=black`
      );
    }

    /* Audio input */
    args.push('-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', String(CHANNELS), '-i', 'pipe:0');

    /* Filter chain */
    let filterChain = '';
    if (bgPath) {
      filterChain = `scale=w=iw*max(${VIDEO_WIDTH}/iw\\,${VIDEO_HEIGHT}/ih):h=ih*max(${VIDEO_WIDTH}/iw\\,${VIDEO_HEIGHT}/ih),crop=${VIDEO_WIDTH}:${VIDEO_HEIGHT},fps=${VIDEO_FPS},format=yuv420p,${drawTextFilter}`;
    } else {
      filterChain = `format=yuv420p,${drawTextFilter}`;
    }

    /* Encoding */
    args.push(
      '-vf',
      filterChain,
      '-c:v',
      'libx264',
      '-preset',
      VIDEO_PRESET,
      '-tune',
      'zerolatency',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(VIDEO_FPS),
      '-g',
      String(VIDEO_FPS * 2),
      '-b:v',
      VIDEO_BITRATE,
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-metadata',
      `title=${metadata.title}`,
      '-metadata',
      `artist=${metadata.artist}`,
      '-metadata',
      `album=${metadata.album}`,
      '-metadata',
      `comment=${metadata.comment}`,
      '-f',
      'flv',
      target
    );

    log('Spawning ffmpeg ->', ['ffmpeg', ...args].join(' '));

    try {
      ffmpegProcess = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] });
    } catch (err) {
      error(`Failed to spawn FFmpeg process: ${err.message}`);
      rtmpStatus.connected = false;
      ffmpegBlocked = true;
      return;
    }

    if (!ffmpegProcess || !ffmpegProcess.pid) {
      error('FFmpeg process failed to start - no PID assigned');
      rtmpStatus.connected = false;
      ffmpegBlocked = true;
      return;
    }

    ffmpegWritable = true;
    lastProgress = null;
    lastProgressUpdateAt = null;
    rtmpStatus.connected = true;
    rtmpStatus.backgroundSource = bgPath;
    ffmpegStartedAt = Date.now();

    /* Schedule stability check */
    setTimeout(() => {
      if (
        ffmpegProcess &&
        ffmpegStartedAt &&
        Date.now() - ffmpegStartedAt >= FFMPEG_STABLE_RUN_MS
      ) {
        const previousAttempts = ffmpegRestartAttempts.length;
        ffmpegRestartAttempts = [];
        if (ffmpegBlocked) {
          ffmpegBlocked = false;
          log(`FFmpeg stable for ${FFMPEG_STABLE_RUN_MS}ms - clearing blocked state`);
        } else if (previousAttempts > 0) {
          log(`FFmpeg stable for ${FFMPEG_STABLE_RUN_MS}ms - resetting restart counters`);
        }
      }
    }, FFMPEG_STABLE_RUN_MS);

    startHeartbeat();

    /* Event handlers */
    ffmpegProcess.on('spawn', () => {
      log(`ffmpeg process started with pid=${ffmpegProcess.pid}`);

      if (diagnostics) {
        diagnostics.recordEvent('ffmpeg.start', {
          pid: ffmpegProcess.pid,
          background: currentBackground,
          restartCount: rtmpStatus.ffmpegRestarts,
        });
        diagnostics.setStreamState('streaming');
      }

      if (onSpawn) {
        onSpawn({
          reason: manualRestartReason || plannedPauseReason,
        });
      }
    });

    if (ffmpegProcess.stdin) {
      ffmpegProcess.stdin.on('error', (err) => {
        if (err && err.code === 'EPIPE') {
          return;
        }
        warn('ffmpeg stdin error:', err ? err.message : err);
      });

      ffmpegProcess.stdin.on('close', () => {
        warn('ffmpeg audio pipe (stdin) closed by encoder');
      });

      ffmpegProcess.stdin.on('drain', () => {
        ffmpegWritable = true;
        if (onDrain) {
          onDrain();
        }
      });
    }

    /* Parse stderr for progress */
    ffmpegProcess.stderr.setEncoding('utf8');
    let stderrBuffer = '';
    ffmpegProcess.stderr.on('data', (chunk) => {
      stderrBuffer += chunk;
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) {
          log('[ffmpeg]', line);
          continue;
        }

        const key = line.slice(0, eqIdx).trim();
        const rawVal = line.slice(eqIdx + 1).trim();

        if (!key) {
          log('[ffmpeg]', line);
          continue;
        }

        if (!lastProgress) {
          lastProgress = {};
        }
        lastProgress[key] = rawVal;
        lastProgressUpdateAt = Date.now();

        if (key === 'bitrate' && rawVal && rawVal !== 'N/A') {
          const match = rawVal.match(/([0-9]+(?:\.[0-9]+)?)/);
          if (match) {
            const numeric = parseFloat(match[1]);
            if (!Number.isNaN(numeric)) {
              rtmpStatus.bitrateKbps = numeric;
            }
          }
        }
      }
    });

    ffmpegProcess.on('close', (code, signal) => {
      const uptime = ffmpegStartedAt ? (Date.now() - ffmpegStartedAt) / 1000 : 0;
      const reason = manualRestartReason;

      log(`[DEBUG] FFmpeg closed: code=${code} signal=${signal} uptime=${uptime.toFixed(2)}s`);

      if (diagnostics) {
        diagnostics.recordEvent('ffmpeg.close', {
          exitCode: code,
          signal: signal,
          uptimeSeconds: uptime,
          manualReason: reason,
          wasPlanned: Boolean(reason),
        });
      }

      rtmpStatus.connected = false;
      ffmpegProcess = null;
      stopHeartbeat();
      pendingOverlayStyleRestart = false;

      if (onClose) {
        onClose({ code, signal, uptime, manualReason: reason });
      }

      if (reason) {
        log(`ffmpeg exited for planned restart (${reason})`);
        manualRestartReason = null;
        if (diagnostics) {
          diagnostics.setStreamState('reconnecting', { reason });
        }
        setTimeout(() => spawn_(), 250);
        return;
      }

      manualRestartReason = null;
      error(`UNEXPECTED FFmpeg exit after ${uptime.toFixed(2)}s`);

      if (diagnostics) {
        diagnostics.recordEvent('ffmpeg.unexpectedExit', {
          exitCode: code,
          signal: signal,
          uptimeSeconds: uptime,
        });
        diagnostics.setStreamState('error', { reason: 'unexpected_exit' });
      }

      scheduleRestart();
    });

    ffmpegProcess.on('error', (err) => {
      rtmpStatus.connected = false;
      stopHeartbeat();
      pendingOverlayStyleRestart = false;
      manualRestartReason = null;
      error('ffmpeg process error:', err);

      if (diagnostics) {
        diagnostics.recordEvent('ffmpeg.error', { errorMessage: err?.message });
        diagnostics.setStreamState('error', { reason: 'process_error' });
      }

      scheduleRestart();
    });
  }

  /**
   * Kills FFmpeg for planned restart
   * @param {string} reason - Reason for restart
   */
  function requestRestart(reason) {
    if (!ffmpegProcess) {
      log(`[ffmpeg] ${reason}; ffmpeg not running yet`);
      return false;
    }
    if (pendingOverlayStyleRestart) {
      return false;
    }
    pendingOverlayStyleRestart = true;
    manualRestartReason = reason;
    log(`[ffmpeg] ${reason}; restarting ffmpeg`);
    try {
      ffmpegProcess.kill('SIGTERM');
      return true;
    } catch (err) {
      pendingOverlayStyleRestart = false;
      manualRestartReason = null;
      warn('Failed to signal ffmpeg for restart:', err.message);
      return false;
    }
  }

  /**
   * Gets FFmpeg stdin stream
   * @returns {Stream|null} stdin stream or null
   */
  function getStdin() {
    return ffmpegProcess && ffmpegProcess.stdin && !ffmpegProcess.stdin.destroyed
      ? ffmpegProcess.stdin
      : null;
  }

  /**
   * Checks if FFmpeg is writable
   * @returns {boolean} True if writable
   */
  function isWritable() {
    return ffmpegWritable;
  }

  /**
   * Sets writable state
   * @param {boolean} value - Writable state
   */
  function setWritable(value) {
    ffmpegWritable = value;
  }

  /**
   * Checks if FFmpeg is running
   * @returns {boolean} True if running
   */
  function isRunning() {
    return Boolean(ffmpegProcess);
  }

  /**
   * Checks if FFmpeg is blocked
   * @returns {boolean} True if blocked
   */
  function isBlocked() {
    return ffmpegBlocked;
  }

  /**
   * Gets RTMP status
   * @returns {Object} Status object
   */
  function getStatus() {
    return {
      ...rtmpStatus,
      ffmpegPid: ffmpegProcess?.pid || null,
      ffmpegUptimeMs: ffmpegStartedAt ? Date.now() - ffmpegStartedAt : null,
      ffmpegBlocked: ffmpegBlocked,
      restartAttemptsInWindow: ffmpegRestartAttempts.length,
      lastProgress: lastProgress,
    };
  }

  /**
   * Shuts down FFmpeg
   */
  function shutdown() {
    if (ffmpegProcess) {
      if (ffmpegProcess.stdin) {
        ffmpegProcess.stdin.end();
      }
      ffmpegProcess.kill('SIGTERM');
    }
    stopHeartbeat();
  }

  /**
   * Sets planned pause reason
   * @param {string} reason - Pause reason
   */
  function setPlannedPause(reason) {
    plannedPauseReason = reason;
    ffmpegWritable = false;
  }

  /**
   * Clears planned pause
   */
  function clearPlannedPause() {
    plannedPauseReason = null;
    ffmpegWritable = true;
  }

  /**
   * Gets planned pause reason
   * @returns {string|null} Pause reason
   */
  function getPlannedPause() {
    return plannedPauseReason;
  }

  return {
    /* Lifecycle */
    spawn: spawn_,
    shutdown,
    requestRestart,

    /* Stdin access */
    getStdin,
    isWritable,
    setWritable,

    /* State */
    isRunning,
    isBlocked,
    getStatus,

    /* Pause management */
    setPlannedPause,
    clearPlannedPause,
    getPlannedPause,
  };
}

module.exports = { createFfmpegManager };
