// Created and developed by Jai Singh
/**
 * Weather Feature
 *
 * Real-time weather tracking dashboard with:
 * - Live weather conditions from Open-Meteo API
 * - Animated weather backgrounds (rain, snow, clouds, sun, fog, thunderstorm)
 * - 24-hour and 7-day forecasts
 * - Interactive radar map via RainViewer + Leaflet
 * - Detailed metrics: UV, wind compass, humidity, pressure, sunrise/sunset
 * - Location search with geolocation support
 */

export { WeatherDashboard } from './components/WeatherDashboard'

export { useWeather, WEATHER_QUERY_KEY } from './hooks/use-weather'
export { useGeolocation } from './hooks/use-geolocation'
export { useLocationSearch } from './hooks/use-location-search'
export { useRainViewer } from './hooks/use-rain-viewer'

export type {
  WeatherData,
  CurrentWeather,
  HourlyForecast,
  DailyForecast,
  GeoLocation,
  GeocodingResult,
  WeatherCondition,
  AnimationState,
  TemperatureUnit,
  SpeedUnit,
} from './types/weather.types'

// Created and developed by Jai Singh
