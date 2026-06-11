// Created and developed by Jai Singh
/**
 * Centralized EST date formatting helpers (Phase 8.3).
 *
 * Extracted from `manual-counts-search.tsx` (lines 106-126) so the same
 * formatting is reused across all surfaces that display warehouse-local
 * timestamps. Date-only strings (YYYY-MM-DD) are treated as business dates
 * and rendered without timezone conversion to avoid the classic UTC-midnight
 * off-by-one shift.
 */
import { format, toZonedTime } from 'date-fns-tz'
import { logger } from '@/lib/utils/logger'

const EST_TZ = 'America/New_York'

export function formatDateEST(dateString: string | null | undefined): string {
  if (!dateString) return 'N/A'
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      const [y, m, d] = dateString.split('-')
      return `${m}/${d}/${y}`
    }
    const zoned = toZonedTime(new Date(dateString), EST_TZ)
    return format(zoned, 'MM/dd/yyyy', { timeZone: EST_TZ })
  } catch (error) {
    logger.error('Date formatting error:', error)
    return 'Invalid Date'
  }
}

export function formatTimestampEST(
  dateString: string | null | undefined
): string {
  if (!dateString) return 'N/A'
  try {
    const zoned = toZonedTime(new Date(dateString), EST_TZ)
    return format(zoned, 'MM/dd/yyyy hh:mm a', { timeZone: EST_TZ })
  } catch (error) {
    logger.error('Timestamp formatting error:', error)
    return 'Invalid Date'
  }
}

// Created and developed by Jai Singh
