// Created and developed by Jai Singh
import { useEffect, useState } from 'react'
import { IconMapPin, IconDroplet, IconWind, IconEye } from '@tabler/icons-react'
import { motion, useSpring, useTransform } from 'framer-motion'
import type {
  CurrentWeather,
  DailyForecast,
  TemperatureUnit,
  GeoLocation,
} from '../types/weather.types'
import {
  formatTemp,
  formatSpeed,
  getWindDirection,
} from '../utils/weather-helpers'
import { getWeatherMapping } from '../utils/wmo-codes'
import { WeatherIcon } from './WeatherIcon'

interface CurrentConditionsHeroProps {
  current: CurrentWeather
  daily: DailyForecast
  location: GeoLocation
  unit: TemperatureUnit
}

function AnimatedNumber({ value }: { value: number }) {
  const spring = useSpring(0, { stiffness: 40, damping: 18 })
  const display = useTransform(spring, (v) => Math.round(v))
  const [displayValue, setDisplayValue] = useState(value)

  useEffect(() => {
    spring.set(value)
    const unsubscribe = display.on('change', (v) => setDisplayValue(v))
    return unsubscribe
  }, [value, spring, display])

  return <>{displayValue}</>
}

export function CurrentConditionsHero({
  current,
  daily,
  location,
  unit,
}: CurrentConditionsHeroProps) {
  const mapping = getWeatherMapping(current.weatherCode, current.isDay)
  const tempValue =
    unit === 'fahrenheit'
      ? Math.round((current.temperature * 9) / 5 + 32)
      : Math.round(current.temperature)

  const feelsLike = formatTemp(current.apparentTemperature, unit)
  const high = formatTemp(daily.temperatureMax[0]!, unit)
  const low = formatTemp(daily.temperatureMin[0]!, unit)

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 200, damping: 25, delay: 0.15 }}
      className='relative flex flex-col items-center gap-2 py-6 text-white md:items-start'
    >
      {/* Location */}
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.3 }}
        className='flex items-center gap-1.5 text-sm text-white/60'
      >
        <IconMapPin size={14} />
        <span className='font-medium'>
          {location.name}
          {location.admin1 ? `, ${location.admin1}` : ''}
          {location.country ? `, ${location.country}` : ''}
        </span>
      </motion.div>

      {/* Icon + Temperature */}
      <div className='flex items-center gap-5'>
        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{
            type: 'spring',
            stiffness: 150,
            damping: 15,
            delay: 0.25,
          }}
        >
          <WeatherIcon condition={mapping.condition} size={88} />
        </motion.div>

        <div className='flex flex-col'>
          <div className='flex items-start'>
            <motion.span
              className='text-8xl font-extralight tracking-tighter md:text-9xl'
              style={{ lineHeight: 0.9 }}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                type: 'spring',
                stiffness: 120,
                damping: 20,
                delay: 0.3,
              }}
            >
              <AnimatedNumber value={tempValue} />
            </motion.span>
            <motion.span
              className='mt-3 text-3xl font-extralight text-white/50'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
            >
              °{unit === 'fahrenheit' ? 'F' : 'C'}
            </motion.span>
          </div>
        </div>
      </div>

      {/* Condition */}
      <motion.p
        className='text-xl font-medium tracking-wide text-white/90'
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45 }}
      >
        {mapping.label}
      </motion.p>

      {/* Feels like + H/L */}
      <motion.div
        className='flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/50'
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.55 }}
      >
        <span>Feels like {feelsLike}</span>
        <span className='text-white/20'>|</span>
        <span>
          H: {high} &nbsp; L: {low}
        </span>
      </motion.div>

      {/* Quick metrics */}
      <motion.div
        className='mt-4 flex flex-wrap gap-3'
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.65 }}
      >
        {[
          {
            icon: IconWind,
            label: `${formatSpeed(current.windSpeed, unit === 'fahrenheit' ? 'mph' : 'kmh')} ${getWindDirection(current.windDirection)}`,
          },
          { icon: IconDroplet, label: `${current.humidity}%` },
          {
            icon: IconEye,
            label: `${(current.visibility / 1000).toFixed(1)} km`,
          },
        ].map((item, i) => (
          <div
            key={i}
            className='flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs text-white/60 ring-1 ring-white/5 backdrop-blur-sm'
          >
            <item.icon size={12} />
            <span>{item.label}</span>
          </div>
        ))}
      </motion.div>

      {/* Live indicator */}
      <motion.div
        className='mt-2 flex items-center gap-1.5 text-[10px] text-white/30'
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
      >
        <motion.div
          className='h-1.5 w-1.5 rounded-full bg-emerald-400'
          animate={{ opacity: [1, 0.3, 1], scale: [1, 0.8, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
        <span>Live</span>
      </motion.div>
    </motion.div>
  )
}

// Created and developed by Jai Singh
