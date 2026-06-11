// Created and developed by Jai Singh
/**
 * Timezone utility functions for OmniFrame
 * All date calculations should use EST/New York timezone
 */

/**
 * Get the current date in EST timezone formatted as YYYY-MM-DD
 * This ensures "today" is calculated correctly regardless of server/client UTC time
 */
export function getTodayEST(): string {
  const now = new Date()
  const estFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const estParts = estFormatter.formatToParts(now)
  const estYear = estParts.find((part) => part.type === 'year')?.value
  const estMonth = estParts.find((part) => part.type === 'month')?.value
  const estDay = estParts.find((part) => part.type === 'day')?.value

  return `${estYear}-${estMonth}-${estDay}`
}

/**
 * Get the start of today in EST timezone as ISO string in UTC
 * Returns timestamp like: 2025-10-30T04:00:00.000Z (UTC time representing EST midnight)
 */
export function getStartOfTodayEST(): string {
  const todayEST = getTodayEST()

  // Return the ISO string that Supabase can interpret correctly
  // The database will handle timezone conversion properly
  return `${todayEST}T00:00:00`
}

/**
 * Get the end of today in EST timezone as ISO string
 * Returns timestamp like: 2025-10-31T03:59:59.999Z (UTC time representing EST end of day)
 */
export function getEndOfTodayEST(): string {
  const todayEST = getTodayEST()

  // Return the end of day timestamp
  // The database will handle the timezone conversion properly
  return `${todayEST}T23:59:59.999`
}

/**
 * Get date N days ago in EST timezone formatted as YYYY-MM-DD
 */
export function getDaysAgoEST(days: number): string {
  const now = new Date()
  const pastDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)

  const estFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const estParts = estFormatter.formatToParts(pastDate)
  const estYear = estParts.find((part) => part.type === 'year')?.value
  const estMonth = estParts.find((part) => part.type === 'month')?.value
  const estDay = estParts.find((part) => part.type === 'day')?.value

  return `${estYear}-${estMonth}-${estDay}`
}

/**
 * Get the start of a specific date in EST timezone
 */
export function getStartOfDayEST(date: Date): string {
  const estFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const estParts = estFormatter.formatToParts(date)
  const estYear = estParts.find((part) => part.type === 'year')?.value
  const estMonth = estParts.find((part) => part.type === 'month')?.value
  const estDay = estParts.find((part) => part.type === 'day')?.value

  return `${estYear}-${estMonth}-${estDay}T00:00:00`
}

/**
 * Get current timestamp in EST timezone for logging
 */
export function getCurrentTimestampEST(): string {
  const now = new Date()
  return now.toLocaleString('en-US', { timeZone: 'America/New_York' })
}

// Created and developed by Jai Singh
