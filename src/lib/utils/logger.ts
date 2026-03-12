/**
 * Structured logger for OmniFrame
 *
 * Replaces direct console.* usage across the codebase.
 * Environment-aware: verbose in development, minimal in production.
 */

/* eslint-disable no-console -- This IS the console wrapper; every method delegates to console.* */

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const isProduction =
  typeof import.meta !== 'undefined' && import.meta.env?.PROD === true
const minLevel: LogLevel = isProduction ? 'warn' : 'debug'

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[minLevel]
}

function formatArgs(args: unknown[]): unknown[] {
  return args
}

export const logger = {
  debug(...args: unknown[]): void {
    if (shouldLog('debug')) {
      console.debug(...formatArgs(args))
    }
  },

  info(...args: unknown[]): void {
    if (shouldLog('info')) {
      console.info(...formatArgs(args))
    }
  },

  log(...args: unknown[]): void {
    if (shouldLog('info')) {
      console.log(...formatArgs(args))
    }
  },

  warn(...args: unknown[]): void {
    if (shouldLog('warn')) {
      console.warn(...formatArgs(args))
    }
  },

  error(...args: unknown[]): void {
    if (shouldLog('error')) {
      console.error(...formatArgs(args))
    }
  },

  /** Log a table (development only) */
  table(data: unknown): void {
    if (shouldLog('debug')) {
      console.table(data)
    }
  },

  /** Timing utilities */
  time(label: string): void {
    if (shouldLog('debug')) {
      console.time(label)
    }
  },

  timeEnd(label: string): void {
    if (shouldLog('debug')) {
      console.timeEnd(label)
    }
  },

  /** Grouped logging */
  group(...args: unknown[]): void {
    if (shouldLog('debug')) {
      console.group(...formatArgs(args))
    }
  },

  groupEnd(): void {
    if (shouldLog('debug')) {
      console.groupEnd()
    }
  },
}

export default logger
// Developer and Creator: Jai Singh
