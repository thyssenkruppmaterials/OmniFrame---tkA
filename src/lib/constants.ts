/**
 * Application-wide constants
 * Centralized location for configuration values used across the codebase
 */

/**
 * Get the timezone for the application
 * Issue 1.5: Now uses browser's local timezone instead of hardcoded EST
 * Falls back to 'America/New_York' if browser timezone detection fails
 */
export const getTimezone = (): string => {
  try {
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return browserTimezone || 'America/New_York'
  } catch {
    return 'America/New_York'
  }
}

/**
 * Default timezone constant (for backwards compatibility)
 * @deprecated Use getTimezone() for dynamic timezone detection
 */
export const TIMEZONE = getTimezone()

/**
 * Date format constants
 */
export const DATE_FORMAT = {
  /** Display format for dates (e.g., "Jan 5, 2026") */
  DISPLAY: 'MMM d, yyyy',
  /** ISO format for API/database (e.g., "2026-01-05") */
  ISO: 'yyyy-MM-dd',
  /** Full datetime display format */
  DATETIME: 'MMM d, yyyy h:mm a',
  /** Time only format */
  TIME: 'h:mm a',
  /** 24-hour time format */
  TIME_24: 'HH:mm',
} as const

/**
 * Pagination defaults
 */
export const PAGINATION = {
  /** Default page size for lists */
  DEFAULT_PAGE_SIZE: 25,
  /** Maximum allowed page size */
  MAX_PAGE_SIZE: 100,
} as const

/**
 * Validation constants
 */
export const VALIDATION = {
  /** Maximum length for notes fields */
  MAX_NOTES_LENGTH: 1000,
  /** Maximum length for reason fields */
  MAX_REASON_LENGTH: 500,
  /** Maximum length for name fields */
  MAX_NAME_LENGTH: 255,
  /** Maximum overtime duration in minutes (8 hours) */
  MAX_OVERTIME_MINUTES: 480,
} as const

/**
 * Cache TTL values in milliseconds
 */
export const CACHE_TTL = {
  /** Short-lived cache (1 minute) */
  SHORT: 60 * 1000,
  /** Medium cache (5 minutes) */
  MEDIUM: 5 * 60 * 1000,
  /** Long cache (15 minutes) */
  LONG: 15 * 60 * 1000,
  /** Extended cache (1 hour) */
  EXTENDED: 60 * 60 * 1000,
} as const

/**
 * Status badge color mappings
 */
export const STATUS_COLORS = {
  success: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  warning:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  neutral: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
} as const
