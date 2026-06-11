// Created and developed by Jai Singh
import { useQuery } from '@tanstack/react-query'
import type {
  WeatherData,
  GeoLocation,
  CurrentWeather,
  HourlyForecast,
  DailyForecast,
} from '../types/weather.types'

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast'

const CURRENT_VARS = [
  'temperature_2m',
  'apparent_temperature',
  'weather_code',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'relative_humidity_2m',
  'precipitation',
  'pressure_msl',
  'visibility',
  'uv_index',
  'cloud_cover',
  'dew_point_2m',
  'is_day',
].join(',')

const HOURLY_VARS = [
  'temperature_2m',
  'apparent_temperature',
  'weather_code',
  'precipitation_probability',
  'precipitation',
  'wind_speed_10m',
  'wind_direction_10m',
  'relative_humidity_2m',
  'cloud_cover',
  'visibility',
  'uv_index',
  'is_day',
].join(',')

const DAILY_VARS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'apparent_temperature_max',
  'apparent_temperature_min',
  'sunrise',
  'sunset',
  'precipitation_sum',
  'precipitation_probability_max',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'wind_direction_10m_dominant',
  'uv_index_max',
].join(',')

async function fetchWeather(location: GeoLocation): Promise<WeatherData> {
  const url = new URL(OPEN_METEO_BASE)
  url.searchParams.set('latitude', String(location.latitude))
  url.searchParams.set('longitude', String(location.longitude))
  url.searchParams.set('current', CURRENT_VARS)
  url.searchParams.set('hourly', HOURLY_VARS)
  url.searchParams.set('daily', DAILY_VARS)
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('forecast_days', '7')

  const response = await fetch(url.toString())
  if (!response.ok) throw new Error(`Weather API error: ${response.status}`)

  const data = await response.json()

  const current: CurrentWeather = {
    temperature: data.current.temperature_2m,
    apparentTemperature: data.current.apparent_temperature,
    weatherCode: data.current.weather_code,
    windSpeed: data.current.wind_speed_10m,
    windDirection: data.current.wind_direction_10m,
    windGusts: data.current.wind_gusts_10m,
    humidity: data.current.relative_humidity_2m,
    precipitation: data.current.precipitation,
    pressure: data.current.pressure_msl,
    visibility: data.current.visibility,
    uvIndex: data.current.uv_index,
    cloudCover: data.current.cloud_cover,
    dewPoint: data.current.dew_point_2m,
    isDay: data.current.is_day === 1,
    time: data.current.time,
  }

  const hourly: HourlyForecast = {
    time: data.hourly.time,
    temperature: data.hourly.temperature_2m,
    apparentTemperature: data.hourly.apparent_temperature,
    weatherCode: data.hourly.weather_code,
    precipitationProbability: data.hourly.precipitation_probability,
    precipitation: data.hourly.precipitation,
    windSpeed: data.hourly.wind_speed_10m,
    windDirection: data.hourly.wind_direction_10m,
    humidity: data.hourly.relative_humidity_2m,
    cloudCover: data.hourly.cloud_cover,
    visibility: data.hourly.visibility,
    uvIndex: data.hourly.uv_index,
    isDay: data.hourly.is_day,
  }

  const daily: DailyForecast = {
    time: data.daily.time,
    weatherCode: data.daily.weather_code,
    temperatureMax: data.daily.temperature_2m_max,
    temperatureMin: data.daily.temperature_2m_min,
    apparentTemperatureMax: data.daily.apparent_temperature_max,
    apparentTemperatureMin: data.daily.apparent_temperature_min,
    sunrise: data.daily.sunrise,
    sunset: data.daily.sunset,
    precipitationSum: data.daily.precipitation_sum,
    precipitationProbabilityMax: data.daily.precipitation_probability_max,
    windSpeedMax: data.daily.wind_speed_10m_max,
    windGustsMax: data.daily.wind_gusts_10m_max,
    windDirectionDominant: data.daily.wind_direction_10m_dominant,
    uvIndexMax: data.daily.uv_index_max,
  }

  return {
    current,
    hourly,
    daily,
    timezone: data.timezone,
    location,
  }
}

export const WEATHER_QUERY_KEY = 'weather-forecast'

export function useWeather(location: GeoLocation) {
  return useQuery<WeatherData>({
    queryKey: [WEATHER_QUERY_KEY, location.latitude, location.longitude],
    queryFn: () => fetchWeather(location),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 2,
  })
}

// Created and developed by Jai Singh
