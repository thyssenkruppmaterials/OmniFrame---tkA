// Created and developed by Jai Singh
import { IconDroplet } from '@tabler/icons-react'
import { motion } from 'framer-motion'
import type { DailyForecast, TemperatureUnit } from '../types/weather.types'
import { formatDay, formatTempValue } from '../utils/weather-helpers'
import { getWeatherMapping } from '../utils/wmo-codes'
import { WeatherIcon } from './WeatherIcon'

interface DailyForecastCardsProps {
  daily: DailyForecast
  unit: TemperatureUnit
}

const rowVariants = {
  hidden: { opacity: 0, x: -16 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: {
      type: 'spring' as const,
      stiffness: 400,
      damping: 30,
      delay: 0.06 * i,
    },
  }),
}

export function DailyForecastCards({ daily, unit }: DailyForecastCardsProps) {
  const allMaxTemps = daily.temperatureMax.map((t) => formatTempValue(t, unit))
  const allMinTemps = daily.temperatureMin.map((t) => formatTempValue(t, unit))
  const globalMax = Math.max(...allMaxTemps)
  const globalMin = Math.min(...allMinTemps)
  const range = globalMax - globalMin || 1

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className='rounded-xl bg-white/[0.07] p-4 ring-1 ring-white/10 backdrop-blur-lg'
    >
      <h3 className='mb-3 text-[11px] font-bold tracking-[0.15em] text-white/40 uppercase'>
        7-Day Forecast
      </h3>

      <div className='divide-y divide-white/[0.06]'>
        {daily.time.map((time, i) => {
          const mapping = getWeatherMapping(daily.weatherCode[i]!, true)
          const high = formatTempValue(daily.temperatureMax[i]!, unit)
          const low = formatTempValue(daily.temperatureMin[i]!, unit)
          const precipProb = daily.precipitationProbabilityMax[i]!

          const barLeft = ((low - globalMin) / range) * 100
          const barWidth = ((high - low) / range) * 100

          return (
            <motion.div
              key={time}
              custom={i}
              variants={rowVariants}
              initial='hidden'
              animate='visible'
              whileHover={{ x: 4, backgroundColor: 'rgba(255,255,255,0.04)' }}
              className={`flex items-center gap-3 rounded-lg px-1 py-2.5 transition-colors ${i === 0 ? 'text-white' : 'text-white/80'}`}
            >
              <span className='w-16 text-sm font-medium'>
                {formatDay(time)}
              </span>

              <div className='flex w-7 justify-center'>
                <WeatherIcon condition={mapping.condition} size={22} />
              </div>

              {precipProb > 0 ? (
                <span className='flex w-10 items-center gap-0.5 text-xs font-medium text-blue-300/80'>
                  <IconDroplet size={10} />
                  {precipProb}%
                </span>
              ) : (
                <span className='w-10' />
              )}

              <span className='w-9 text-right text-sm text-white/40 tabular-nums'>
                {low}°
              </span>

              {/* Temperature bar */}
              <div className='relative mx-1 h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]'>
                <motion.div
                  className='absolute h-full rounded-full'
                  style={{
                    left: `${barLeft}%`,
                    background:
                      'linear-gradient(to right, #60a5fa, #fbbf24, #f97316)',
                  }}
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: `${Math.max(barWidth, 4)}%`, opacity: 1 }}
                  transition={{
                    width: {
                      delay: 0.08 * i + 0.3,
                      duration: 0.8,
                      ease: 'easeOut',
                    },
                    opacity: { delay: 0.08 * i + 0.2, duration: 0.3 },
                  }}
                />
              </div>

              <span className='w-9 text-sm font-semibold tabular-nums'>
                {high}°
              </span>
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}

// Created and developed by Jai Singh
