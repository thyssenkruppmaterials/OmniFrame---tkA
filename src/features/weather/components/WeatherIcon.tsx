// Created and developed by Jai Singh
import { motion } from 'framer-motion'
import type { WeatherCondition } from '../types/weather.types'

interface WeatherIconProps {
  condition: WeatherCondition
  size?: number
  className?: string
}

export function WeatherIcon({
  condition,
  size = 48,
  className = '',
}: WeatherIconProps) {
  const half = size / 2
  const r = size * 0.3

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      fill='none'
    >
      {condition === 'clear-day' && <SunIcon cx={half} cy={half} r={r} />}
      {condition === 'clear-night' && <MoonIcon cx={half} cy={half} r={r} />}
      {condition === 'partly-cloudy-day' && (
        <>
          <SunIcon cx={half * 1.2} cy={half * 0.7} r={r * 0.7} />
          <CloudShape cx={half * 0.85} cy={half * 1.1} scale={r * 0.04} />
        </>
      )}
      {condition === 'partly-cloudy-night' && (
        <>
          <MoonIcon cx={half * 1.2} cy={half * 0.7} r={r * 0.55} />
          <CloudShape cx={half * 0.85} cy={half * 1.1} scale={r * 0.04} />
        </>
      )}
      {condition === 'cloudy' && (
        <CloudShape cx={half} cy={half} scale={r * 0.055} />
      )}
      {condition === 'fog' && <FogIcon cx={half} cy={half} w={size} />}
      {(condition === 'drizzle' || condition === 'rain') && (
        <>
          <CloudShape cx={half} cy={half * 0.75} scale={r * 0.045} />
          <RainDrops
            cx={half}
            cy={half * 1.3}
            size={size}
            light={condition === 'drizzle'}
          />
        </>
      )}
      {condition === 'heavy-rain' && (
        <>
          <CloudShape cx={half} cy={half * 0.7} scale={r * 0.045} />
          <RainDrops cx={half} cy={half * 1.3} size={size} light={false} />
          <RainDrops
            cx={half * 0.7}
            cy={half * 1.4}
            size={size}
            light={false}
          />
        </>
      )}
      {(condition === 'snow' || condition === 'heavy-snow') && (
        <>
          <CloudShape cx={half} cy={half * 0.75} scale={r * 0.045} />
          <SnowFlakes
            cx={half}
            cy={half * 1.3}
            size={size}
            heavy={condition === 'heavy-snow'}
          />
        </>
      )}
      {condition === 'sleet' && (
        <>
          <CloudShape cx={half} cy={half * 0.75} scale={r * 0.045} />
          <RainDrops cx={half * 0.85} cy={half * 1.3} size={size} light />
          <SnowFlakes
            cx={half * 1.15}
            cy={half * 1.3}
            size={size}
            heavy={false}
          />
        </>
      )}
      {condition === 'thunderstorm' && (
        <>
          <CloudShape cx={half} cy={half * 0.65} scale={r * 0.05} />
          <LightningBolt cx={half} cy={half * 1.15} size={size} />
          <RainDrops
            cx={half * 0.7}
            cy={half * 1.35}
            size={size}
            light={false}
          />
        </>
      )}
    </svg>
  )
}

function SunIcon({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const rayLength = r * 0.45
  return (
    <motion.g
      animate={{ rotate: 360 }}
      transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
      style={{ originX: `${cx}px`, originY: `${cy}px` }}
    >
      <circle cx={cx} cy={cy} r={r} fill='#FBBF24' />
      <circle cx={cx} cy={cy} r={r * 0.8} fill='#FCD34D' />
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i * Math.PI * 2) / 8
        const x1 = cx + Math.cos(angle) * (r + 3)
        const y1 = cy + Math.sin(angle) * (r + 3)
        const x2 = cx + Math.cos(angle) * (r + 3 + rayLength)
        const y2 = cy + Math.sin(angle) * (r + 3 + rayLength)
        return (
          <motion.line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke='#FBBF24'
            strokeWidth={2.5}
            strokeLinecap='round'
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 2, repeat: Infinity, delay: i * 0.15 }}
          />
        )
      })}
    </motion.g>
  )
}

function MoonIcon({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <motion.g
      animate={{ opacity: [0.85, 1, 0.85] }}
      transition={{ duration: 4, repeat: Infinity }}
    >
      <circle cx={cx} cy={cy} r={r} fill='#E2E8F0' />
      <circle
        cx={cx + r * 0.35}
        cy={cy - r * 0.3}
        r={r * 0.75}
        fill='#0f172a'
      />
      <circle
        cx={cx - r * 0.2}
        cy={cy + r * 0.15}
        r={r * 0.08}
        fill='#CBD5E1'
        opacity={0.5}
      />
      <circle
        cx={cx + r * 0.05}
        cy={cy + r * 0.45}
        r={r * 0.06}
        fill='#CBD5E1'
        opacity={0.4}
      />
    </motion.g>
  )
}

function CloudShape({
  cx,
  cy,
  scale,
}: {
  cx: number
  cy: number
  scale: number
}) {
  return (
    <motion.g
      animate={{ x: [-1, 1, -1] }}
      transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
    >
      <ellipse cx={cx} cy={cy} rx={12 * scale} ry={6 * scale} fill='#E2E8F0' />
      <ellipse
        cx={cx - 7 * scale}
        cy={cy - 2 * scale}
        rx={7 * scale}
        ry={6 * scale}
        fill='#F1F5F9'
      />
      <ellipse
        cx={cx + 5 * scale}
        cy={cy - 4 * scale}
        rx={9 * scale}
        ry={7 * scale}
        fill='#E2E8F0'
      />
      <ellipse
        cx={cx - 2 * scale}
        cy={cy - 5 * scale}
        rx={8 * scale}
        ry={6 * scale}
        fill='#F8FAFC'
      />
    </motion.g>
  )
}

function RainDrops({
  cx,
  cy,
  size,
  light,
}: {
  cx: number
  cy: number
  size: number
  light: boolean
}) {
  const drops = light ? 2 : 3
  const spacing = size * 0.12

  return (
    <g>
      {Array.from({ length: drops }).map((_, i) => (
        <motion.line
          key={i}
          x1={cx - spacing + i * spacing}
          y1={cy}
          x2={cx - spacing + i * spacing + 1}
          y2={cy + size * 0.1}
          stroke='#93C5FD'
          strokeWidth={1.5}
          strokeLinecap='round'
          animate={{ y: [0, size * 0.12, 0], opacity: [0.8, 0.3, 0.8] }}
          transition={{
            duration: light ? 1.2 : 0.8,
            repeat: Infinity,
            delay: i * 0.2,
          }}
        />
      ))}
    </g>
  )
}

function SnowFlakes({
  cx,
  cy,
  size,
  heavy,
}: {
  cx: number
  cy: number
  size: number
  heavy: boolean
}) {
  const count = heavy ? 4 : 3
  const spacing = size * 0.1

  return (
    <g>
      {Array.from({ length: count }).map((_, i) => (
        <motion.circle
          key={i}
          cx={cx - spacing * 1.5 + i * spacing}
          cy={cy + (i % 2) * 3}
          r={size * 0.025}
          fill='white'
          animate={{
            y: [0, size * 0.1, 0],
            x: [-2, 2, -2],
            opacity: [0.9, 0.5, 0.9],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            delay: i * 0.3,
          }}
        />
      ))}
    </g>
  )
}

function LightningBolt({
  cx,
  cy,
  size,
}: {
  cx: number
  cy: number
  size: number
}) {
  const s = size * 0.01
  return (
    <motion.polygon
      points={`${cx - 2 * s},${cy} ${cx + 1 * s},${cy + 5 * s} ${cx - 0.5 * s},${cy + 5 * s} ${cx + 2 * s},${cy + 12 * s} ${cx - 1 * s},${cy + 7 * s} ${cx + 0.5 * s},${cy + 7 * s}`}
      fill='#FDE047'
      animate={{ opacity: [1, 0.4, 1] }}
      transition={{ duration: 1.5, repeat: Infinity }}
    />
  )
}

function FogIcon({ cx, cy, w }: { cx: number; cy: number; w: number }) {
  const lineW = w * 0.5
  return (
    <g>
      {[0, 1, 2].map((i) => (
        <motion.line
          key={i}
          x1={cx - lineW / 2}
          y1={cy - 6 + i * 8}
          x2={cx + lineW / 2}
          y2={cy - 6 + i * 8}
          stroke='#CBD5E1'
          strokeWidth={3}
          strokeLinecap='round'
          animate={{ opacity: [0.4, 0.8, 0.4], x: [-3, 3, -3] }}
          transition={{ duration: 3, repeat: Infinity, delay: i * 0.5 }}
        />
      ))}
    </g>
  )
}

// Created and developed by Jai Singh
