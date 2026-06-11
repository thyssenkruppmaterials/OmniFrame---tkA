// Created and developed by Jai Singh
import { motion } from 'framer-motion'

interface WindCompassProps {
  direction: number
  speed: number
  size?: number
}

export function WindCompass({ direction, speed, size = 80 }: WindCompassProps) {
  const half = size / 2
  const r = half - 8

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Outer ring */}
      <circle
        cx={half}
        cy={half}
        r={r}
        fill='none'
        stroke='rgba(255,255,255,0.15)'
        strokeWidth={1}
      />

      {/* Cardinal direction marks */}
      {['N', 'E', 'S', 'W'].map((dir, i) => {
        const angle = (i * Math.PI) / 2 - Math.PI / 2
        const tx = half + Math.cos(angle) * (r + 5)
        const ty = half + Math.sin(angle) * (r + 5)
        return (
          <text
            key={dir}
            x={tx}
            y={ty}
            textAnchor='middle'
            dominantBaseline='central'
            fill='rgba(255,255,255,0.4)'
            fontSize={8}
            fontWeight={dir === 'N' ? 600 : 400}
          >
            {dir}
          </text>
        )
      })}

      {/* Tick marks */}
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i * Math.PI * 2) / 12 - Math.PI / 2
        const isMajor = i % 3 === 0
        const innerR = isMajor ? r - 6 : r - 3
        return (
          <line
            key={i}
            x1={half + Math.cos(angle) * innerR}
            y1={half + Math.sin(angle) * innerR}
            x2={half + Math.cos(angle) * r}
            y2={half + Math.sin(angle) * r}
            stroke={
              isMajor ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.15)'
            }
            strokeWidth={isMajor ? 1.5 : 0.5}
          />
        )
      })}

      {/* Needle */}
      <motion.g
        style={{ originX: `${half}px`, originY: `${half}px` }}
        animate={{ rotate: direction }}
        transition={{ type: 'spring', stiffness: 60, damping: 15 }}
      >
        {/* Arrow head */}
        <polygon
          points={`${half},${half - r + 10} ${half - 4},${half - r + 20} ${half + 4},${half - r + 20}`}
          fill='#60a5fa'
        />
        {/* Shaft */}
        <line
          x1={half}
          y1={half - r + 20}
          x2={half}
          y2={half + 8}
          stroke='#60a5fa'
          strokeWidth={2}
          strokeLinecap='round'
        />
      </motion.g>

      {/* Center dot */}
      <circle cx={half} cy={half} r={3} fill='white' />

      {/* Speed label */}
      <text
        x={half}
        y={half + r * 0.45}
        textAnchor='middle'
        fill='white'
        fontSize={11}
        fontWeight={600}
      >
        {Math.round(speed)}
      </text>
      <text
        x={half}
        y={half + r * 0.45 + 11}
        textAnchor='middle'
        fill='rgba(255,255,255,0.5)'
        fontSize={7}
      >
        km/h
      </text>
    </svg>
  )
}

// Created and developed by Jai Singh
