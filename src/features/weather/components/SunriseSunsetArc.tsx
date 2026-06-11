// Created and developed by Jai Singh
import { motion } from 'framer-motion'
import { formatTime } from '../utils/weather-helpers'

interface SunriseSunsetArcProps {
  sunrise: string
  sunset: string
  timezone?: string
  size?: number
}

export function SunriseSunsetArc({
  sunrise,
  sunset,
  timezone,
  size = 120,
}: SunriseSunsetArcProps) {
  const now = Date.now()
  const riseTime = new Date(sunrise).getTime()
  const setTime = new Date(sunset).getTime()

  const isBeforeSunrise = now < riseTime
  const isAfterSunset = now > setTime
  const progress = isBeforeSunrise
    ? 0
    : isAfterSunset
      ? 1
      : (now - riseTime) / (setTime - riseTime)

  const padding = 10
  const arcR = (size - padding * 2) / 2
  const cx = size / 2
  const cy = size - padding - 4

  // Arc from left to right (semicircle)
  const startAngle = Math.PI
  const endAngle = 0
  const sunAngle = startAngle + (endAngle - startAngle) * progress

  const sunX = cx + arcR * Math.cos(sunAngle)
  const sunY = cy + arcR * Math.sin(sunAngle)

  // Arc path
  const arcStartX = cx - arcR
  const arcStartY = cy
  const arcEndX = cx + arcR
  const arcEndY = cy

  // Dashed arc path
  const arcPath = `M ${arcStartX} ${arcStartY} A ${arcR} ${arcR} 0 0 1 ${arcEndX} ${arcEndY}`

  // Filled arc path up to sun position
  const filledEndX = cx + arcR * Math.cos(sunAngle)
  const filledEndY = cy + arcR * Math.sin(sunAngle)
  const largeArc = progress > 0.5 ? 1 : 0
  const filledPath = `M ${arcStartX} ${arcStartY} A ${arcR} ${arcR} 0 ${largeArc} 1 ${filledEndX} ${filledEndY}`

  return (
    <div className='flex flex-col items-center'>
      <svg
        width={size}
        height={size * 0.55}
        viewBox={`0 0 ${size} ${size * 0.55}`}
      >
        {/* Dashed background arc */}
        <path
          d={arcPath}
          fill='none'
          stroke='rgba(255,255,255,0.1)'
          strokeWidth={2}
          strokeDasharray='4 3'
        />

        {/* Progress arc */}
        {progress > 0 && progress < 1 && (
          <motion.path
            d={filledPath}
            fill='none'
            stroke='#fbbf24'
            strokeWidth={2}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        )}

        {progress >= 1 && (
          <path
            d={arcPath}
            fill='none'
            stroke='rgba(255,255,255,0.2)'
            strokeWidth={2}
          />
        )}

        {/* Horizon line */}
        <line
          x1={padding}
          y1={cy}
          x2={size - padding}
          y2={cy}
          stroke='rgba(255,255,255,0.1)'
          strokeWidth={1}
        />

        {/* Sun dot */}
        {!isAfterSunset && (
          <motion.g
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.3, type: 'spring' }}
          >
            <circle cx={sunX} cy={sunY} r={6} fill='#fbbf24' />
            <circle cx={sunX} cy={sunY} r={10} fill='#fbbf24' opacity={0.2} />
          </motion.g>
        )}

        {/* Moon dot for after sunset */}
        {isAfterSunset && (
          <circle cx={arcEndX} cy={arcEndY} r={5} fill='#94a3b8' />
        )}
      </svg>

      <div className='mt-1 flex w-full justify-between px-1 text-[10px] text-white/50'>
        <span>{formatTime(sunrise, timezone)}</span>
        <span>{formatTime(sunset, timezone)}</span>
      </div>
    </div>
  )
}

// Created and developed by Jai Singh
