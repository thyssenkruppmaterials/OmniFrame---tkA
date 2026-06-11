// Created and developed by Jai Singh
import { useState, Suspense, lazy } from 'react'
import { IconCloudRain, IconRefresh, IconLoader2 } from '@tabler/icons-react'
import { motion } from 'framer-motion'
import { useGeolocation } from '../hooks/use-geolocation'
import { useWeather } from '../hooks/use-weather'
import type { TemperatureUnit } from '../types/weather.types'
import { getWeatherMapping } from '../utils/wmo-codes'
import { CurrentConditionsHero } from './CurrentConditionsHero'
import { DailyForecastCards } from './DailyForecastCards'
import { HourlyForecastStrip } from './HourlyForecastStrip'
import { LocationSearchBar } from './LocationSearchBar'
import { TemperatureChart } from './TemperatureChart'
import { WeatherBackground } from './WeatherBackground'
import { WeatherMetricsGrid } from './WeatherMetricsGrid'

const WeatherRadarMap = lazy(() =>
  import('./WeatherRadarMap').then((m) => ({ default: m.WeatherRadarMap }))
)

const UNIT_STORAGE_KEY = 'weather-temp-unit'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
}

const sectionVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: 'spring' as const,
      stiffness: 300,
      damping: 30,
      mass: 0.8,
    },
  },
}

export function WeatherDashboard() {
  const { location, setLocation, detectLocation, isLocating } = useGeolocation()
  const { data, isLoading, isFetching, refetch, error } = useWeather(location)

  const [unit, setUnit] = useState<TemperatureUnit>(() => {
    try {
      const stored = localStorage.getItem(UNIT_STORAGE_KEY)
      if (stored === 'fahrenheit' || stored === 'celsius') return stored
    } catch {
      /* ignore */
    }
    return 'fahrenheit'
  })

  const handleUnitChange = (newUnit: TemperatureUnit) => {
    setUnit(newUnit)
    try {
      localStorage.setItem(UNIT_STORAGE_KEY, newUnit)
    } catch {
      /* ignore */
    }
  }

  if (error && !data) {
    return (
      <div className='border-destructive/20 bg-destructive/5 flex h-96 flex-col items-center justify-center gap-4 rounded-xl border text-center'>
        <IconCloudRain size={48} className='text-destructive/60' />
        <div>
          <p className='text-destructive font-medium'>
            Failed to load weather data
          </p>
          <p className='text-muted-foreground mt-1 text-sm'>{error.message}</p>
        </div>
        <button
          onClick={() => refetch()}
          className='bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-lg px-4 py-2 text-sm font-medium transition-colors'
        >
          Try Again
        </button>
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div className='flex h-96 flex-col items-center justify-center gap-3 rounded-xl border'>
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
        >
          <IconCloudRain size={48} className='text-primary/40' />
        </motion.div>
        <p className='text-muted-foreground text-sm'>Loading weather data...</p>
      </div>
    )
  }

  const mapping = getWeatherMapping(
    data.current.weatherCode,
    data.current.isDay
  )

  return (
    <div className='relative min-h-[50vh] overflow-hidden rounded-xl'>
      <WeatherBackground
        animation={mapping.animation}
        isDay={data.current.isDay}
      />

      <motion.div
        className='relative z-10 space-y-5 p-4 md:p-6'
        variants={containerVariants}
        initial='hidden'
        animate='visible'
      >
        {/* Top bar */}
        <motion.div
          variants={sectionVariants}
          className='flex flex-wrap items-center justify-between gap-2'
        >
          <LocationSearchBar
            currentLocation={location}
            onLocationChange={setLocation}
            onDetectLocation={detectLocation}
            isLocating={isLocating}
            unit={unit}
            onUnitChange={handleUnitChange}
          />
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className='flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white/60 ring-1 ring-white/10 backdrop-blur-md transition-all hover:bg-white/20 hover:text-white hover:ring-white/20 disabled:opacity-50'
            title='Refresh weather data'
          >
            {isFetching ? (
              <IconLoader2 size={14} className='animate-spin' />
            ) : (
              <IconRefresh size={14} />
            )}
          </button>
        </motion.div>

        {/* Hero + Chart */}
        <motion.div
          variants={sectionVariants}
          className='grid grid-cols-1 gap-4 lg:grid-cols-5'
        >
          <div className='lg:col-span-2'>
            <CurrentConditionsHero
              current={data.current}
              daily={data.daily}
              location={data.location}
              unit={unit}
            />
          </div>
          <div className='lg:col-span-3'>
            <TemperatureChart hourly={data.hourly} unit={unit} />
          </div>
        </motion.div>

        {/* Hourly strip */}
        <motion.div variants={sectionVariants}>
          <HourlyForecastStrip hourly={data.hourly} unit={unit} />
        </motion.div>

        {/* Daily + Radar */}
        <motion.div
          variants={sectionVariants}
          className='grid grid-cols-1 gap-4 lg:grid-cols-2'
        >
          <DailyForecastCards daily={data.daily} unit={unit} />
          <Suspense
            fallback={
              <div className='flex h-64 items-center justify-center rounded-xl bg-white/5 ring-1 ring-white/10 backdrop-blur-md'>
                <div className='border-primary/20 border-t-primary/60 h-6 w-6 animate-spin rounded-full border-2' />
              </div>
            }
          >
            <WeatherRadarMap location={location} />
          </Suspense>
        </motion.div>

        {/* Metrics grid */}
        <motion.div variants={sectionVariants}>
          <WeatherMetricsGrid
            current={data.current}
            daily={data.daily}
            unit={unit}
            timezone={data.timezone}
          />
        </motion.div>
      </motion.div>
    </div>
  )
}

// Created and developed by Jai Singh
