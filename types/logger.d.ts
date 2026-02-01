declare module './lib/utils/logger' {
  interface Logger {
    debug: (...args: unknown[]) => void;
    log: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  }

  export function createLogger(scope?: string): Logger;
}
