// Created and developed by Jai Singh
import type {
  TemperatureUnit,
  SpeedUnit,
  AnimationState,
} from '../types/weather.types'

export function celsiusToFahrenheit(c: number): number {
  return Math.round((c * 9) / 5 + 32)
}

export function formatTemp(value: number, unit: TemperatureUnit): string {
  const converted =
    unit === 'fahrenheit' ? celsiusToFahrenheit(value) : Math.round(value)
  return `${converted}°`
}

export function formatTempValue(value: number, unit: TemperatureUnit): number {
  return unit === 'fahrenheit' ? celsiusToFahrenheit(value) : Math.round(value)
}

export function kmhToMph(kmh: number): number {
  return Math.round(kmh * 0.621371)
}

export function formatSpeed(value: number, unit: SpeedUnit): string {
  const converted = unit === 'mph' ? kmhToMph(value) : Math.round(value)
  return `${converted} ${unit}`
}

export function formatVisibility(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`
  }
  return `${Math.round(meters)} m`
}

export function formatPressure(hPa: number): string {
  return `${Math.round(hPa)} hPa`
}

export function getUvLabel(index: number): string {
  if (index <= 2) return 'Low'
  if (index <= 5) return 'Moderate'
  if (index <= 7) return 'High'
  if (index <= 10) return 'Very High'
  return 'Extreme'
}

export function getUvColor(index: number): string {
  if (index <= 2) return '#4ade80'
  if (index <= 5) return '#facc15'
  if (index <= 7) return '#fb923c'
  if (index <= 10) return '#ef4444'
  return '#a855f7'
}

export function getWindDirection(degrees: number): string {
  const directions = [
    'N',
    'NNE',
    'NE',
    'ENE',
    'E',
    'ESE',
    'SE',
    'SSE',
    'S',
    'SSW',
    'SW',
    'WSW',
    'W',
    'WNW',
    'NW',
    'NNW',
  ]
  const index = Math.round(degrees / 22.5) % 16
  return directions[index]!
}

export function formatTime(isoString: string, timezone?: string): string {
  const date = new Date(isoString)
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  })
}

export function formatHour(isoString: string): string {
  const date = new Date(isoString)
  const hours = date.getHours()
  if (hours === 0) return '12 AM'
  if (hours === 12) return '12 PM'
  return hours > 12 ? `${hours - 12} PM` : `${hours} AM`
}

export function formatDay(isoString: string): string {
  const date = new Date(isoString)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'

  return date.toLocaleDateString(undefined, { weekday: 'short' })
}

export function getSunPosition(sunrise: string, sunset: string): number {
  const now = Date.now()
  const rise = new Date(sunrise).getTime()
  const set = new Date(sunset).getTime()

  if (now <= rise) return 0
  if (now >= set) return 1
  return (now - rise) / (set - rise)
}

export function getSkyGradient(
  animation: AnimationState,
  isDay: boolean
): string {
  const gradients: Record<string, string> = {
    'clear-day': 'from-sky-400 via-blue-500 to-blue-600',
    'clear-night': 'from-slate-900 via-indigo-950 to-slate-950',
    'clouds-day': 'from-slate-300 via-gray-400 to-slate-500',
    'clouds-night': 'from-slate-800 via-gray-900 to-slate-950',
    'fog-day': 'from-gray-300 via-slate-400 to-gray-500',
    'fog-night': 'from-gray-700 via-slate-800 to-gray-900',
    'rain-day': 'from-slate-500 via-gray-600 to-slate-700',
    'rain-night': 'from-slate-800 via-gray-900 to-slate-950',
    'heavy-rain-day': 'from-slate-600 via-gray-700 to-slate-800',
    'heavy-rain-night': 'from-gray-900 via-slate-950 to-black',
    'snow-day': 'from-blue-100 via-slate-200 to-blue-200',
    'snow-night': 'from-slate-700 via-blue-900 to-slate-900',
    'heavy-snow-day': 'from-white via-blue-100 to-slate-200',
    'heavy-snow-night': 'from-slate-600 via-blue-800 to-slate-800',
    'thunderstorm-day': 'from-slate-700 via-purple-900 to-slate-900',
    'thunderstorm-night': 'from-gray-950 via-purple-950 to-black',
  }

  const key = `${animation}-${isDay ? 'day' : 'night'}`
  return gradients[key] ?? gradients['clear-day']!
}

// Created and developed by Jai Singh
