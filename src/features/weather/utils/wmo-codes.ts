// Created and developed by Jai Singh
import type {
  WeatherCodeMapping,
  WeatherCondition,
  AnimationState,
} from '../types/weather.types'

const WMO_CODES: Record<
  number,
  {
    label: string
    dayCondition: WeatherCondition
    nightCondition: WeatherCondition
    animation: AnimationState
  }
> = {
  0: {
    label: 'Clear sky',
    dayCondition: 'clear-day',
    nightCondition: 'clear-night',
    animation: 'clear',
  },
  1: {
    label: 'Mainly clear',
    dayCondition: 'clear-day',
    nightCondition: 'clear-night',
    animation: 'clear',
  },
  2: {
    label: 'Partly cloudy',
    dayCondition: 'partly-cloudy-day',
    nightCondition: 'partly-cloudy-night',
    animation: 'clouds',
  },
  3: {
    label: 'Overcast',
    dayCondition: 'cloudy',
    nightCondition: 'cloudy',
    animation: 'clouds',
  },
  45: {
    label: 'Fog',
    dayCondition: 'fog',
    nightCondition: 'fog',
    animation: 'fog',
  },
  48: {
    label: 'Depositing rime fog',
    dayCondition: 'fog',
    nightCondition: 'fog',
    animation: 'fog',
  },
  51: {
    label: 'Light drizzle',
    dayCondition: 'drizzle',
    nightCondition: 'drizzle',
    animation: 'rain',
  },
  53: {
    label: 'Moderate drizzle',
    dayCondition: 'drizzle',
    nightCondition: 'drizzle',
    animation: 'rain',
  },
  55: {
    label: 'Dense drizzle',
    dayCondition: 'drizzle',
    nightCondition: 'drizzle',
    animation: 'rain',
  },
  56: {
    label: 'Light freezing drizzle',
    dayCondition: 'sleet',
    nightCondition: 'sleet',
    animation: 'rain',
  },
  57: {
    label: 'Dense freezing drizzle',
    dayCondition: 'sleet',
    nightCondition: 'sleet',
    animation: 'rain',
  },
  61: {
    label: 'Slight rain',
    dayCondition: 'rain',
    nightCondition: 'rain',
    animation: 'rain',
  },
  63: {
    label: 'Moderate rain',
    dayCondition: 'rain',
    nightCondition: 'rain',
    animation: 'rain',
  },
  65: {
    label: 'Heavy rain',
    dayCondition: 'heavy-rain',
    nightCondition: 'heavy-rain',
    animation: 'heavy-rain',
  },
  66: {
    label: 'Light freezing rain',
    dayCondition: 'sleet',
    nightCondition: 'sleet',
    animation: 'rain',
  },
  67: {
    label: 'Heavy freezing rain',
    dayCondition: 'sleet',
    nightCondition: 'sleet',
    animation: 'heavy-rain',
  },
  71: {
    label: 'Slight snowfall',
    dayCondition: 'snow',
    nightCondition: 'snow',
    animation: 'snow',
  },
  73: {
    label: 'Moderate snowfall',
    dayCondition: 'snow',
    nightCondition: 'snow',
    animation: 'snow',
  },
  75: {
    label: 'Heavy snowfall',
    dayCondition: 'heavy-snow',
    nightCondition: 'heavy-snow',
    animation: 'heavy-snow',
  },
  77: {
    label: 'Snow grains',
    dayCondition: 'snow',
    nightCondition: 'snow',
    animation: 'snow',
  },
  80: {
    label: 'Slight rain showers',
    dayCondition: 'rain',
    nightCondition: 'rain',
    animation: 'rain',
  },
  81: {
    label: 'Moderate rain showers',
    dayCondition: 'rain',
    nightCondition: 'rain',
    animation: 'rain',
  },
  82: {
    label: 'Violent rain showers',
    dayCondition: 'heavy-rain',
    nightCondition: 'heavy-rain',
    animation: 'heavy-rain',
  },
  85: {
    label: 'Slight snow showers',
    dayCondition: 'snow',
    nightCondition: 'snow',
    animation: 'snow',
  },
  86: {
    label: 'Heavy snow showers',
    dayCondition: 'heavy-snow',
    nightCondition: 'heavy-snow',
    animation: 'heavy-snow',
  },
  95: {
    label: 'Thunderstorm',
    dayCondition: 'thunderstorm',
    nightCondition: 'thunderstorm',
    animation: 'thunderstorm',
  },
  96: {
    label: 'Thunderstorm with slight hail',
    dayCondition: 'thunderstorm',
    nightCondition: 'thunderstorm',
    animation: 'thunderstorm',
  },
  99: {
    label: 'Thunderstorm with heavy hail',
    dayCondition: 'thunderstorm',
    nightCondition: 'thunderstorm',
    animation: 'thunderstorm',
  },
}

export function getWeatherMapping(
  code: number,
  isDay: boolean
): WeatherCodeMapping {
  const mapping = WMO_CODES[code] ?? WMO_CODES[0]!
  return {
    label: mapping.label,
    condition: isDay ? mapping.dayCondition : mapping.nightCondition,
    animation: mapping.animation,
    icon: isDay ? mapping.dayCondition : mapping.nightCondition,
  }
}

export function getWeatherLabel(code: number): string {
  return WMO_CODES[code]?.label ?? 'Unknown'
}

export function getAnimationState(code: number): AnimationState {
  return WMO_CODES[code]?.animation ?? 'clear'
}

// Created and developed by Jai Singh
