'use strict';

/**
 * Server Constants Module
 *
 * Centralized configuration constants for audio, video encoding,
 * overlay settings, and operational parameters.
 *
 * @module server/constants
 */

const { optionalEnv, optionalPositiveIntEnv } = require('../lib/utils/env');

/*
 * Metadata Length Limits
 */

const MAX_METADATA_TITLE_LENGTH = 200;
const MAX_METADATA_ARTIST_LENGTH = 100;
const MAX_METADATA_ALBUM_LENGTH = 100;
const MAX_METADATA_COMMENT_LENGTH = 300;

/*
 * Audio Configuration
 */

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;

/*
 * Silence Generator
 */

const SILENCE_CHUNK_DURATION_MS = 20;
const SILENCE_CHUNK_SIZE = Math.floor(BYTES_PER_SECOND * (SILENCE_CHUNK_DURATION_MS / 1000));
const SILENCE_CHUNK = Buffer.alloc(SILENCE_CHUNK_SIZE, 0);
const SILENCE_RESUME_DELAY_MS = 120;

/*
 * Monitoring and Intervals
 */

const INGEST_LOG_INTERVAL_MS = optionalPositiveIntEnv('INGEST_LOG_INTERVAL_MS', 5000, 'server');
const INGEST_IDLE_WARN_MS = optionalPositiveIntEnv('INGEST_IDLE_WARN_MS', 8000, 'server');
const FFMPEG_HEARTBEAT_INTERVAL_MS = optionalPositiveIntEnv(
  'FFMPEG_HEARTBEAT_INTERVAL_MS',
  7000,
  'server'
);
const FFMPEG_STALL_WARN_MS = optionalPositiveIntEnv('FFMPEG_STALL_WARN_MS', 20000, 'server');

/*
 * FFmpeg Restart and Crash Loop Prevention
 */

const FFMPEG_RESTART_MAX_ATTEMPTS = optionalPositiveIntEnv(
  'FFMPEG_RESTART_MAX_ATTEMPTS',
  5,
  'server'
);
const FFMPEG_RESTART_WINDOW_MS = optionalPositiveIntEnv(
  'FFMPEG_RESTART_WINDOW_MS',
  60000,
  'server'
);
const FFMPEG_RESTART_BACKOFF_BASE_MS = optionalPositiveIntEnv(
  'FFMPEG_RESTART_BACKOFF_BASE_MS',
  500,
  'server'
);
const FFMPEG_RESTART_BACKOFF_MAX_MS = optionalPositiveIntEnv(
  'FFMPEG_RESTART_BACKOFF_MAX_MS',
  60000,
  'server'
);
const FFMPEG_STABLE_RUN_MS = optionalPositiveIntEnv('FFMPEG_STABLE_RUN_MS', 120000, 'server');
const FFMPEG_AUTO_RESTART = process.env.FFMPEG_AUTO_RESTART !== 'false';

/*
 * Video Encoding Configuration
 */

const VIDEO_WIDTH = optionalPositiveIntEnv('OVERLAY_WIDTH', 1280, 'server');
const VIDEO_HEIGHT = optionalPositiveIntEnv('OVERLAY_HEIGHT', 720, 'server');
const VIDEO_FPS = optionalPositiveIntEnv('OVERLAY_FPS', 30, 'server');
const VIDEO_BITRATE = optionalEnv('OVERLAY_BITRATE', '1500k');
const VIDEO_PRESET = optionalEnv('OVERLAY_PRESET', 'veryfast');

/*
 * Overlay Configuration
 */

const OVERLAY_FONT_SIZE = optionalPositiveIntEnv('OVERLAY_FONTSIZE', 48, 'server');
const OVERLAY_LINE_SPACING = optionalPositiveIntEnv('OVERLAY_LINE_SPACING', 12, 'server');
const FONT_PATH_DEFAULT = optionalEnv(
  'OVERLAY_FONT',
  process.platform === 'win32'
    ? 'C:/Windows/Fonts/arial.ttf'
    : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
);

/*
 * Background and Upload Configuration
 */

const LOOPABLE_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.webp'];
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; /* 50 MB */

module.exports = {
  /* Metadata */
  MAX_METADATA_TITLE_LENGTH,
  MAX_METADATA_ARTIST_LENGTH,
  MAX_METADATA_ALBUM_LENGTH,
  MAX_METADATA_COMMENT_LENGTH,

  /* Audio */
  SAMPLE_RATE,
  CHANNELS,
  BYTES_PER_SAMPLE,
  BYTES_PER_SECOND,

  /* Silence */
  SILENCE_CHUNK_DURATION_MS,
  SILENCE_CHUNK_SIZE,
  SILENCE_CHUNK,
  SILENCE_RESUME_DELAY_MS,

  /* Monitoring */
  INGEST_LOG_INTERVAL_MS,
  INGEST_IDLE_WARN_MS,
  FFMPEG_HEARTBEAT_INTERVAL_MS,
  FFMPEG_STALL_WARN_MS,

  /* FFmpeg Restart */
  FFMPEG_RESTART_MAX_ATTEMPTS,
  FFMPEG_RESTART_WINDOW_MS,
  FFMPEG_RESTART_BACKOFF_BASE_MS,
  FFMPEG_RESTART_BACKOFF_MAX_MS,
  FFMPEG_STABLE_RUN_MS,
  FFMPEG_AUTO_RESTART,

  /* Video */
  VIDEO_WIDTH,
  VIDEO_HEIGHT,
  VIDEO_FPS,
  VIDEO_BITRATE,
  VIDEO_PRESET,

  /* Overlay */
  OVERLAY_FONT_SIZE,
  OVERLAY_LINE_SPACING,
  FONT_PATH_DEFAULT,

  /* Background */
  LOOPABLE_IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  MAX_UPLOAD_SIZE,
};
