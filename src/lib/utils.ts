// Created and developed by Jai Singh
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Returns a date as a YYYY-MM-DD string in the user's **local** timezone.
 *
 * IMPORTANT: Do NOT use `new Date().toISOString().split('T')[0]` for "today"
 * calculations — `toISOString()` converts to UTC first, so users in negative-
 * offset timezones (e.g. US Central, UTC-6) will get *tomorrow's* date after
 * 6 PM local time.
 */
export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Created and developed by Jai Singh
