/**
 * Type definitions for StreamDJ lib modules
 */

declare module './lib/utils/env' {
  /**
   * Requires an environment variable to be set, exits process if missing
   */
  export function requireEnv(name: string, context?: string): string;

  /**
   * Requires an environment variable to be a valid integer
   */
  export function requireIntEnv(name: string, context?: string): number;

  /**
   * Returns environment variable value or fallback if not set
   */
  export function optionalEnv(name: string, fallback: string): string;

  /**
   * Returns environment variable as integer or fallback if not set
   */
  export function optionalIntEnv(name: string, fallback: number, context?: string): number;

  /**
   * Requires environment variable to be a valid port number (1-65535)
   */
  export function requirePortEnv(name: string, context?: string): number;

  /**
   * Returns environment variable as port number or fallback
   */
  export function optionalPortEnv(name: string, fallback: number, context?: string): number;

  /**
   * Requires environment variable to be a valid URL with specified protocol
   */
  export function requireUrlEnv(name: string, protocol: string, context?: string): string;

  /**
   * Requires environment variable to be a positive integer
   */
  export function requirePositiveIntEnv(name: string, context?: string): number;

  /**
   * Returns environment variable as positive integer or fallback
   */
  export function optionalPositiveIntEnv(name: string, fallback: number, context?: string): number;

  /**
   * Requires environment variable to point to an existing file
   */
  export function requireFilePathEnv(name: string, context?: string): string;

  /**
   * Returns environment variable as file path or fallback, validates if set
   */
  export function optionalFilePathEnv(name: string, fallback: string, context?: string): string;
}

declare module './lib/config' {
  /** TCP port for audio stream communication between player and server */
  export const TCP_PORT: number;

  /** HTTP port for the server control API */
  export const HTTP_PORT: number;

  /** HTTP port for the player API and WebUI access */
  export const PLAYER_API_PORT: number;

  /** Default TCP port value */
  export const DEFAULT_TCP_PORT: number;

  /** Default HTTP port value */
  export const DEFAULT_HTTP_PORT: number;

  /** Default player API port value */
  export const DEFAULT_PLAYER_API_PORT: number;
}

declare module './lib/utils/errors' {
  /**
   * Wraps an async operation with error handling and logging
   */
  export function safeAsync<T>(
    operation: () => Promise<T>,
    fallback: T,
    logger?: (...args: unknown[]) => void,
    context?: string
  ): Promise<T>;

  /**
   * Wraps an async operation, logs error, and re-throws
   */
  export function tryAsync<T>(
    operation: () => Promise<T>,
    logger?: (...args: unknown[]) => void,
    context?: string
  ): Promise<T>;

  /**
   * Fire-and-forget promise wrapper that logs errors
   */
  export function ignoreErrors(
    promise: Promise<unknown>,
    logger?: (...args: unknown[]) => void,
    context?: string
  ): void;
}

declare module './lib/services/ffmpeg' {
  /** Timeout duration for FFmpeg availability checks in milliseconds */
  export const FFMPEG_CHECK_TIMEOUT_MS: number;

  /**
   * Validates that FFmpeg is available in the system PATH
   */
  export function validateFfmpegAvailable(): Promise<boolean>;

  /**
   * Logs a formatted FFmpeg installation help message
   */
  export function logFfmpegInstallHelp(
    errorLogger: (...args: unknown[]) => void,
    componentName?: string
  ): void;
}

declare module './lib/services/overlayStyleStore' {
  interface OverlayStyleFont {
    color: string;
    opacity: number;
    size: number;
    lineSpacing: number;
    letterSpacing: number;
  }

  interface OverlayStyleBox {
    enabled: boolean;
    color: string;
    opacity: number;
    borderWidth: number;
  }

  interface OverlayStyleLayout {
    horizontal: 'left' | 'center' | 'right';
    vertical: 'top' | 'center' | 'bottom';
    offsetX: number;
    offsetY: number;
  }

  interface OverlayStyleLabels {
    showHeader: boolean;
    headerText: string;
    artistPrefix: string;
    albumPrefix: string;
    commentPrefix: string;
  }

  interface OverlayStyleValues {
    font: OverlayStyleFont;
    box: OverlayStyleBox;
    layout: OverlayStyleLayout;
    labels: OverlayStyleLabels;
  }

  interface OverlayStyleSnapshot {
    version: number;
    updatedAt: string;
    values: OverlayStyleValues;
  }

  interface OverlayStyleMeta {
    actor?: string;
    skipRestart?: boolean;
  }

  /**
   * Returns current overlay style snapshot
   */
  export function getOverlayStyleSnapshot(): OverlayStyleSnapshot;

  /**
   * Returns current overlay style values only
   */
  export function getOverlayStyleValues(): OverlayStyleValues;

  /**
   * Updates overlay style with partial values
   */
  export function setOverlayStyle(
    payload: Partial<OverlayStyleValues>,
    meta?: OverlayStyleMeta
  ): OverlayStyleSnapshot;

  /**
   * Resets overlay style to defaults
   */
  export function resetOverlayStyle(meta?: OverlayStyleMeta): OverlayStyleSnapshot;

  /**
   * Registers a change handler, returns unsubscribe function
   */
  export function onOverlayStyleChange(
    handler: (snapshot: OverlayStyleSnapshot, meta: OverlayStyleMeta) => void
  ): () => void;

  /**
   * Returns true if a persisted style file exists
   */
  export function hasOverlayStylePersisted(): boolean;
}
