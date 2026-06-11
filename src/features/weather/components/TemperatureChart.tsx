// Created and developed by Jai Singh
import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Bar,
  ComposedChart,
} from 'recharts'
import type { HourlyForecast, TemperatureUnit } from '../types/weather.types'
import { formatHour, formatTempValue } from '../utils/weather-helpers'
import { getWeatherMapping } from '../utils/wmo-codes'
import { WeatherIcon } from './WeatherIcon'

interface TemperatureChartProps {
  hourly: HourlyForecast
  unit: TemperatureUnit
}

export function TemperatureChart({ hourly, unit }: TemperatureChartProps) {
  const now = new Date()
  const currentIdx = hourly.time.findIndex((t) => new Date(t) >= now)
  const startIdx = Math.max(0, currentIdx - 1)

  const data = useMemo(() => {
    return hourly.time.slice(startIdx, startIdx + 25).map((time, i) => {
      const idx = startIdx + i
      return {
        hour: formatHour(time),
        temp: formatTempValue(hourly.temperature[idx]!, unit),
        feelsLike: formatTempValue(hourly.apparentTemperature[idx]!, unit),
        precip: hourly.precipitationProbability[idx]!,
        weatherCode: hourly.weatherCode[idx]!,
        isDay: hourly.isDay[idx] === 1,
      }
    })
  }, [hourly, unit, startIdx])

  const temps = data.map((d) => d.temp)
  const minTemp = Math.min(...temps) - 3
  const maxTemp = Math.max(...temps) + 3

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30, delay: 0.1 }}
      className='rounded-xl bg-white/[0.07] p-4 ring-1 ring-white/10 backdrop-blur-lg'
    >
      <h3 className='mb-3 text-[11px] font-bold tracking-[0.15em] text-white/40 uppercase'>
        24-Hour Forecast
      </h3>

      <div className='h-52'>
        <ResponsiveContainer width='100%' height='100%'>
          <ComposedChart
            data={data}
            margin={{ top: 5, right: 5, bottom: 0, left: -15 }}
          >
            <defs>
              <linearGradient id='tempGradientMain' x1='0' y1='0' x2='0' y2='1'>
                <stop offset='5%' stopColor='#fbbf24' stopOpacity={0.3} />
                <stop offset='95%' stopColor='#fbbf24' stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray='3 3'
              stroke='rgba(255,255,255,0.04)'
            />
            <XAxis
              dataKey='hour'
              tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
              tickLine={false}
              interval={3}
            />
            <YAxis
              yAxisId='temp'
              domain={[minTemp, maxTemp]}
              tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v}°`}
            />
            <YAxis
              yAxisId='precip'
              orientation='right'
              domain={[0, 100]}
              hide
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0]!.payload as (typeof data)[0]
                const mapping = getWeatherMapping(d.weatherCode, d.isDay)
                return (
                  <div className='rounded-xl border border-white/10 bg-black/80 px-3.5 py-2.5 text-xs text-white shadow-2xl backdrop-blur-xl'>
                    <div className='mb-1.5 flex items-center gap-2'>
                      <WeatherIcon condition={mapping.condition} size={18} />
                      <span className='font-semibold'>{d.hour}</span>
                    </div>
                    <div className='space-y-0.5 text-white/60'>
                      <p>
                        Temp:{' '}
                        <span className='font-medium text-white'>
                          {d.temp}°
                        </span>
                      </p>
                      <p>
                        Feels:{' '}
                        <span className='font-medium text-white/80'>
                          {d.feelsLike}°
                        </span>
                      </p>
                      <p>
                        Rain:{' '}
                        <span className='font-medium text-blue-300'>
                          {d.precip}%
                        </span>
                      </p>
                    </div>
                  </div>
                )
              }}
            />
            <Bar
              yAxisId='precip'
              dataKey='precip'
              fill='rgba(96,165,250,0.15)'
              radius={[2, 2, 0, 0]}
              isAnimationActive
              animationDuration={1000}
            />
            <Area
              yAxisId='temp'
              type='monotone'
              dataKey='feelsLike'
              stroke='rgba(148,163,184,0.25)'
              strokeWidth={1}
              strokeDasharray='4 4'
              fill='none'
              isAnimationActive
              animationDuration={1200}
            />
            <Area
              yAxisId='temp'
              type='monotone'
              dataKey='temp'
              stroke='#fbbf24'
              strokeWidth={2.5}
              fill='url(#tempGradientMain)'
              isAnimationActive
              animationDuration={1000}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className='mt-3 flex justify-center gap-6 text-[10px] text-white/30'>
        <div className='flex items-center gap-1.5'>
          <div className='h-0.5 w-4 rounded-full bg-amber-400' />
          <span>Temperature</span>
        </div>
        <div className='flex items-center gap-1.5'>
          <div className='h-0.5 w-4 border-t border-dashed border-slate-400/50' />
          <span>Feels Like</span>
        </div>
        <div className='flex items-center gap-1.5'>
          <div className='h-2.5 w-4 rounded-sm bg-blue-400/15' />
          <span>Precipitation</span>
        </div>
      </div>
    </motion.div>
  )
}

// Created and developed by Jai Singh
