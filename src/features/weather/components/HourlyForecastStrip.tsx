// Created and developed by Jai Singh
import { useRef } from 'react'
import { motion } from 'framer-motion'
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts'
import type { HourlyForecast, TemperatureUnit } from '../types/weather.types'
import { formatHour, formatTempValue } from '../utils/weather-helpers'
import { getWeatherMapping } from '../utils/wmo-codes'
import { WeatherIcon } from './WeatherIcon'

interface HourlyForecastStripProps {
  hourly: HourlyForecast
  unit: TemperatureUnit
}

const cardVariants = {
  hidden: { opacity: 0, y: 12, scale: 0.95 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 400,
      damping: 30,
      delay: 0.03 * i,
    },
  }),
}

export function HourlyForecastStrip({
  hourly,
  unit,
}: HourlyForecastStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const now = new Date()
  const currentHourIndex = hourly.time.findIndex((t) => new Date(t) >= now)
  const startIdx = Math.max(0, currentHourIndex - 1)
  const hours = hourly.time.slice(startIdx, startIdx + 25).map((time, i) => {
    const idx = startIdx + i
    return {
      time,
      hour: formatHour(time),
      temp: formatTempValue(hourly.temperature[idx]!, unit),
      weatherCode: hourly.weatherCode[idx]!,
      precipProb: hourly.precipitationProbability[idx]!,
      isDay: hourly.isDay[idx] === 1,
      isCurrent: idx === currentHourIndex,
    }
  })

  const chartData = hours.map((h) => ({ temp: h.temp }))
  const temps = hours.map((h) => h.temp)
  const minTemp = Math.min(...temps)
  const maxTemp = Math.max(...temps)

  return (
    <div className='space-y-3'>
      {/* Sparkline chart */}
      <div className='h-14 w-full rounded-xl bg-white/5 px-2 ring-1 ring-white/5 backdrop-blur-md'>
        <ResponsiveContainer width='100%' height='100%'>
          <AreaChart
            data={chartData}
            margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
          >
            <defs>
              <linearGradient
                id='tempGradientHourly'
                x1='0'
                y1='0'
                x2='0'
                y2='1'
              >
                <stop offset='5%' stopColor='#fbbf24' stopOpacity={0.3} />
                <stop offset='95%' stopColor='#fbbf24' stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <YAxis domain={[minTemp - 2, maxTemp + 2]} hide />
            <Area
              type='monotone'
              dataKey='temp'
              stroke='#fbbf24'
              strokeWidth={2}
              fill='url(#tempGradientHourly)'
              isAnimationActive
              animationDuration={1200}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Scrollable cards */}
      <div
        ref={scrollRef}
        className='no-scrollbar flex gap-1.5 overflow-x-auto pb-1'
      >
        {hours.map((h, i) => {
          const mapping = getWeatherMapping(h.weatherCode, h.isDay)
          return (
            <motion.div
              key={h.time}
              custom={i}
              variants={cardVariants}
              initial='hidden'
              animate='visible'
              whileHover={{ scale: 1.05, y: -2 }}
              className={`flex min-w-[4.5rem] flex-shrink-0 flex-col items-center gap-1.5 rounded-xl px-2.5 py-3 transition-shadow ${
                h.isCurrent
                  ? 'bg-white/15 shadow-lg ring-1 shadow-white/5 ring-white/25 backdrop-blur-lg'
                  : 'bg-white/5 ring-1 ring-white/5 backdrop-blur-sm hover:bg-white/10 hover:ring-white/10'
              }`}
            >
              <span
                className={`text-[11px] font-medium ${h.isCurrent ? 'text-white' : 'text-white/50'}`}
              >
                {h.isCurrent ? 'Now' : h.hour}
              </span>
              <WeatherIcon condition={mapping.condition} size={22} />
              <span className='text-sm font-semibold text-white tabular-nums'>
                {h.temp}°
              </span>
              {h.precipProb > 0 && (
                <span className='text-[10px] font-medium text-blue-300/80'>
                  {h.precipProb}%
                </span>
              )}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
