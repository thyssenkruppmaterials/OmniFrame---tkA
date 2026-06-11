// Created and developed by Jai Singh
export type TemperatureUnit = 'celsius' | 'fahrenheit'
export type SpeedUnit = 'kmh' | 'mph'

export interface GeoLocation {
  latitude: number
  longitude: number
  name: string
  country?: string
  admin1?: string // state/province
}

export interface CurrentWeather {
  temperature: number
  apparentTemperature: number
  weatherCode: number
  windSpeed: number
  windDirection: number
  windGusts: number
  humidity: number
  precipitation: number
  pressure: number
  visibility: number
  uvIndex: number
  cloudCover: number
  dewPoint: number
  isDay: boolean
  time: string
}

export interface HourlyForecast {
  time: string[]
  temperature: number[]
  apparentTemperature: number[]
  weatherCode: number[]
  precipitationProbability: number[]
  precipitation: number[]
  windSpeed: number[]
  windDirection: number[]
  humidity: number[]
  cloudCover: number[]
  visibility: number[]
  uvIndex: number[]
  isDay: number[]
}

export interface DailyForecast {
  time: string[]
  weatherCode: number[]
  temperatureMax: number[]
  temperatureMin: number[]
  apparentTemperatureMax: number[]
  apparentTemperatureMin: number[]
  sunrise: string[]
  sunset: string[]
  precipitationSum: number[]
  precipitationProbabilityMax: number[]
  windSpeedMax: number[]
  windGustsMax: number[]
  windDirectionDominant: number[]
  uvIndexMax: number[]
}

export interface WeatherData {
  current: CurrentWeather
  hourly: HourlyForecast
  daily: DailyForecast
  timezone: string
  location: GeoLocation
}

export interface GeocodingResult {
  id: number
  name: string
  latitude: number
  longitude: number
  country: string
  country_code: string
  admin1?: string
  admin2?: string
  population?: number
}

export interface RainViewerData {
  version: string
  generated: number
  host: string
  radar: {
    past: RainViewerFrame[]
    nowcast: RainViewerFrame[]
  }
}

export interface RainViewerFrame {
  time: number
  path: string
}

export type WeatherCondition =
  | 'clear-day'
  | 'clear-night'
  | 'partly-cloudy-day'
  | 'partly-cloudy-night'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'heavy-rain'
  | 'snow'
  | 'heavy-snow'
  | 'sleet'
  | 'thunderstorm'

export type AnimationState =
  | 'clear'
  | 'clouds'
  | 'fog'
  | 'rain'
  | 'heavy-rain'
  | 'snow'
  | 'heavy-snow'
  | 'thunderstorm'

export interface WeatherCodeMapping {
  label: string
  condition: WeatherCondition
  animation: AnimationState
  icon: string
}

// Created and developed by Jai Singh
