// Created and developed by Jai Singh
import type React from 'react'
import {
  IconSun,
  IconDroplet,
  IconGauge,
  IconEye,
  IconTemperature,
  IconCloud,
} from '@tabler/icons-react'
import { motion } from 'framer-motion'
import type {
  CurrentWeather,
  DailyForecast,
  TemperatureUnit,
} from '../types/weather.types'
import {
  formatTemp,
  formatVisibility,
  formatPressure,
  getUvLabel,
  getUvColor,
  getWindDirection,
} from '../utils/weather-helpers'
import { SunriseSunsetArc } from './SunriseSunsetArc'
import { WindCompass } from './WindCompass'

interface WeatherMetricsGridProps {
  current: CurrentWeather
  daily: DailyForecast
  unit: TemperatureUnit
  timezone?: string
}

const cardVariants = {
  hidden: { opacity: 0, scale: 0.9, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: 'spring' as const,
      stiffness: 400,
      damping: 28,
      delay: 0.05 * i,
    },
  }),
}

export function WeatherMetricsGrid({
  current,
  daily,
  unit,
  timezone,
}: WeatherMetricsGridProps) {
  const metrics: Array<{
    label: string
    value: string
    sublabel: string
    icon: typeof IconSun | null
    color?: string
    render?: () => React.ReactNode
  }> = [
    {
      label: 'UV Index',
      value: current.uvIndex.toFixed(1),
      sublabel: getUvLabel(current.uvIndex),
      icon: IconSun,
      color: getUvColor(current.uvIndex),
      render: () => <UvGauge value={current.uvIndex} />,
    },
    {
      label: 'Wind',
      value: `${Math.round(current.windSpeed)} km/h`,
      sublabel: getWindDirection(current.windDirection),
      icon: null,
      render: () => (
        <WindCompass
          direction={current.windDirection}
          speed={current.windSpeed}
          size={76}
        />
      ),
    },
    {
      label: 'Humidity',
      value: `${current.humidity}%`,
      sublabel:
        current.humidity > 70
          ? 'High'
          : current.humidity > 40
            ? 'Moderate'
            : 'Low',
      icon: IconDroplet,
      render: () => <HumidityRing value={current.humidity} />,
    },
    {
      label: 'Pressure',
      value: formatPressure(current.pressure),
      sublabel:
        current.pressure > 1020
          ? 'High'
          : current.pressure < 1000
            ? 'Low'
            : 'Normal',
      icon: IconGauge,
    },
    {
      label: 'Visibility',
      value: formatVisibility(current.visibility),
      sublabel:
        current.visibility > 10000
          ? 'Clear'
          : current.visibility > 5000
            ? 'Moderate'
            : 'Poor',
      icon: IconEye,
    },
    {
      label: 'Dew Point',
      value: formatTemp(current.dewPoint, unit),
      sublabel:
        current.dewPoint > 20
          ? 'Uncomfortable'
          : current.dewPoint > 10
            ? 'Comfortable'
            : 'Dry',
      icon: IconTemperature,
    },
    {
      label: 'Cloud Cover',
      value: `${current.cloudCover}%`,
      sublabel:
        current.cloudCover > 80
          ? 'Overcast'
          : current.cloudCover > 40
            ? 'Partly cloudy'
            : 'Clear',
      icon: IconCloud,
    },
    {
      label: 'Sunrise / Sunset',
      value: '',
      sublabel: '',
      icon: null,
      render: () => (
        <SunriseSunsetArc
          sunrise={daily.sunrise[0]!}
          sunset={daily.sunset[0]!}
          timezone={timezone}
          size={110}
        />
      ),
    },
  ]

  return (
    <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
      {metrics.map((metric, i) => (
        <motion.div
          key={metric.label}
          custom={i}
          variants={cardVariants}
          initial='hidden'
          animate='visible'
          whileHover={{
            scale: 1.03,
            y: -3,
            transition: { type: 'spring', stiffness: 500, damping: 25 },
          }}
          className='flex flex-col items-center gap-1.5 rounded-xl bg-white/[0.07] px-3 py-3.5 ring-1 ring-white/10 backdrop-blur-lg transition-shadow hover:shadow-lg hover:shadow-white/5 hover:ring-white/15'
        >
          <span className='text-[10px] font-bold tracking-[0.15em] text-white/35 uppercase'>
            {metric.label}
          </span>

          {metric.render ? (
            <div className='my-1'>{metric.render()}</div>
          ) : (
            <>
              {metric.icon && (
                <metric.icon
                  size={22}
                  className='mt-1 text-white/40'
                  style={metric.color ? { color: metric.color } : undefined}
                />
              )}
              <span className='text-xl font-semibold text-white tabular-nums'>
                {metric.value}
              </span>
            </>
          )}

          {metric.sublabel && (
            <span className='text-[10px] font-medium text-white/40'>
              {metric.sublabel}
            </span>
          )}
        </motion.div>
      ))}
    </div>
  )
}

function UvGauge({ value }: { value: number }) {
  const maxVal = 12
  const normalised = Math.min(value / maxVal, 1)
  const angle = normalised * 180

  return (
    <svg width={70} height={40} viewBox='0 0 70 40'>
      <path
        d='M 8 36 A 27 27 0 0 1 62 36'
        fill='none'
        stroke='rgba(255,255,255,0.06)'
        strokeWidth={4}
        strokeLinecap='round'
      />
      <defs>
        <linearGradient id='uvGrad' x1='0%' y1='0%' x2='100%' y2='0%'>
          <stop offset='0%' stopColor='#4ade80' />
          <stop offset='40%' stopColor='#facc15' />
          <stop offset='70%' stopColor='#fb923c' />
          <stop offset='90%' stopColor='#ef4444' />
          <stop offset='100%' stopColor='#a855f7' />
        </linearGradient>
      </defs>
      <motion.path
        d='M 8 36 A 27 27 0 0 1 62 36'
        fill='none'
        stroke='url(#uvGrad)'
        strokeWidth={4}
        strokeLinecap='round'
        initial={{ pathLength: 0 }}
        animate={{ pathLength: normalised }}
        transition={{ duration: 1.2, ease: 'easeOut', delay: 0.3 }}
      />
      <motion.circle
        cx={35 + 27 * Math.cos(Math.PI - (angle * Math.PI) / 180)}
        cy={36 - 27 * Math.sin((angle * Math.PI) / 180)}
        r={3.5}
        fill='white'
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 1.2, type: 'spring', stiffness: 300 }}
      />
      <text
        x={35}
        y={34}
        textAnchor='middle'
        fill='white'
        fontSize={13}
        fontWeight={600}
      >
        {value.toFixed(1)}
      </text>
    </svg>
  )
}

function HumidityRing({ value }: { value: number }) {
  const r = 22
  const circumference = 2 * Math.PI * r
  const offset = circumference - (value / 100) * circumference

  return (
    <svg width={56} height={56} viewBox='0 0 56 56'>
      <circle
        cx={28}
        cy={28}
        r={r}
        fill='none'
        stroke='rgba(255,255,255,0.06)'
        strokeWidth={3}
      />
      <motion.circle
        cx={28}
        cy={28}
        r={r}
        fill='none'
        stroke='#60a5fa'
        strokeWidth={3}
        strokeLinecap='round'
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1.2, ease: 'easeOut', delay: 0.3 }}
        transform='rotate(-90 28 28)'
      />
      <text
        x={28}
        y={30}
        textAnchor='middle'
        fill='white'
        fontSize={12}
        fontWeight={600}
      >
        {value}%
      </text>
    </svg>
  )
}

// Created and developed by Jai Singh
