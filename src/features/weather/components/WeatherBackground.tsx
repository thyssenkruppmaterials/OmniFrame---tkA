// Created and developed by Jai Singh
import { useRef, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { AnimationState } from '../types/weather.types'

interface WeatherBackgroundProps {
  animation: AnimationState
  isDay: boolean
}

const SKY_COLORS: Record<string, [string, string, string, string]> = {
  'clear-day': ['#38bdf8', '#2563eb', '#1d4ed8', '#1e40af'],
  'clear-night': ['#020617', '#0c1445', '#0f172a', '#020617'],
  'clouds-day': ['#94a3b8', '#64748b', '#475569', '#334155'],
  'clouds-night': ['#1e293b', '#111827', '#0f172a', '#020617'],
  'fog-day': ['#cbd5e1', '#94a3b8', '#64748b', '#475569'],
  'fog-night': ['#334155', '#1e293b', '#111827', '#0f172a'],
  'rain-day': ['#64748b', '#475569', '#334155', '#1e293b'],
  'rain-night': ['#1e293b', '#111827', '#0f172a', '#020617'],
  'heavy-rain-day': ['#475569', '#334155', '#1e293b', '#0f172a'],
  'heavy-rain-night': ['#0f172a', '#020617', '#000000', '#000000'],
  'snow-day': ['#e0f2fe', '#bae6fd', '#93c5fd', '#7dd3fc'],
  'snow-night': ['#334155', '#1e3a5f', '#1e293b', '#0f172a'],
  'heavy-snow-day': ['#f0f9ff', '#e0f2fe', '#bae6fd', '#93c5fd'],
  'heavy-snow-night': ['#475569', '#1e3a5f', '#334155', '#1e293b'],
  'thunderstorm-day': ['#1e293b', '#3b0764', '#1e1b4b', '#0f172a'],
  'thunderstorm-night': ['#020617', '#1a0533', '#0c0a1a', '#000000'],
}

function getGradient(animation: AnimationState, isDay: boolean): string {
  const key = `${animation}-${isDay ? 'day' : 'night'}`
  const c = SKY_COLORS[key] ?? SKY_COLORS['clear-day']!
  return `linear-gradient(170deg, ${c[0]} 0%, ${c[1]} 35%, ${c[2]} 70%, ${c[3]} 100%)`
}

interface Particle {
  x: number
  y: number
  speed: number
  length: number
  opacity: number
  drift?: number
  thickness?: number
}

function drawRain(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  drops: Particle[],
  heavy: boolean
) {
  const count = heavy ? 400 : 150
  while (drops.length < count) {
    drops.push({
      x: Math.random() * w * 1.2 - w * 0.1,
      y: Math.random() * h,
      speed: (heavy ? 16 : 9) + Math.random() * 10,
      length: (heavy ? 22 : 14) + Math.random() * 14,
      opacity: 0.1 + Math.random() * 0.4,
      thickness: heavy ? 1.2 + Math.random() * 0.8 : 0.8 + Math.random() * 0.4,
    })
  }

  ctx.clearRect(0, 0, w, h)

  for (const drop of drops) {
    // Rain streak
    ctx.beginPath()
    ctx.strokeStyle = `rgba(174, 194, 224, ${drop.opacity})`
    ctx.lineWidth = drop.thickness ?? 1
    ctx.moveTo(drop.x, drop.y)
    ctx.lineTo(drop.x + 1.5, drop.y + drop.length)
    ctx.stroke()

    drop.y += drop.speed
    drop.x += 0.8

    // Splash particles at bottom
    if (drop.y > h) {
      if (Math.random() > 0.7) {
        ctx.beginPath()
        ctx.fillStyle = `rgba(174, 194, 224, ${drop.opacity * 0.6})`
        ctx.arc(drop.x, h - 2, 1.5, 0, Math.PI, true)
        ctx.fill()
      }
      drop.y = -drop.length - Math.random() * 40
      drop.x = Math.random() * w * 1.2 - w * 0.1
    }
  }
}

function drawSnow(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  flakes: Particle[],
  heavy: boolean,
  tick: number
) {
  const count = heavy ? 250 : 100
  while (flakes.length < count) {
    flakes.push({
      x: Math.random() * w,
      y: Math.random() * h,
      speed: 0.4 + Math.random() * (heavy ? 2.5 : 1.5),
      length: 1.5 + Math.random() * (heavy ? 4.5 : 3),
      opacity: 0.3 + Math.random() * 0.6,
      drift: Math.random() * Math.PI * 2,
    })
  }

  ctx.clearRect(0, 0, w, h)

  for (const flake of flakes) {
    const wobble = Math.sin(tick * 0.015 + (flake.drift ?? 0)) * 1.2
    ctx.beginPath()
    ctx.fillStyle = `rgba(255, 255, 255, ${flake.opacity})`
    ctx.shadowBlur = flake.length * 0.8
    ctx.shadowColor = 'rgba(255, 255, 255, 0.3)'
    ctx.arc(flake.x + wobble, flake.y, flake.length, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0

    flake.y += flake.speed
    flake.x += wobble * 0.1

    if (flake.y > h + flake.length) {
      flake.y = -flake.length * 2
      flake.x = Math.random() * w
    }
  }
}

export function WeatherBackground({
  animation,
  isDay,
}: WeatherBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const tickRef = useRef(0)
  const rafRef = useRef<number>(0)

  const needsCanvas = [
    'rain',
    'heavy-rain',
    'snow',
    'heavy-snow',
    'thunderstorm',
  ].includes(animation)

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = canvas.offsetWidth * dpr
    canvas.height = canvas.offsetHeight * dpr
    const ctx = canvas.getContext('2d')
    ctx?.scale(dpr, dpr)
  }, [])

  useEffect(() => {
    if (!needsCanvas || prefersReducedMotion) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    particlesRef.current = []
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    const animate = () => {
      tickRef.current++
      const w = canvas.offsetWidth
      const h = canvas.offsetHeight

      if (
        animation === 'rain' ||
        animation === 'heavy-rain' ||
        animation === 'thunderstorm'
      ) {
        drawRain(ctx, w, h, particlesRef.current, animation !== 'rain')
      } else if (animation === 'snow' || animation === 'heavy-snow') {
        drawSnow(
          ctx,
          w,
          h,
          particlesRef.current,
          animation === 'heavy-snow',
          tickRef.current
        )
      }
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resizeCanvas)
    }
  }, [animation, needsCanvas, prefersReducedMotion, resizeCanvas])

  const gradient = getGradient(animation, isDay)

  return (
    <div className='pointer-events-none absolute inset-0 overflow-hidden rounded-xl'>
      {/* Sky gradient with smooth transition */}
      <motion.div
        className='absolute inset-0'
        animate={{ background: gradient }}
        transition={{ duration: 3, ease: 'easeInOut' }}
      />

      {/* Star field for night */}
      {!isDay &&
        (animation === 'clear' || animation === 'clouds') &&
        !prefersReducedMotion && <NightSky />}

      {/* Aurora for clear night */}
      {animation === 'clear' && !isDay && !prefersReducedMotion && (
        <AuroraBorealis />
      )}

      {/* Sun glow + rays for clear day */}
      {animation === 'clear' && isDay && !prefersReducedMotion && <SunGlow />}

      {/* Multi-layer clouds */}
      {(animation === 'clouds' ||
        animation === 'rain' ||
        animation === 'heavy-rain') &&
        !prefersReducedMotion && (
          <CloudLayers opacity={animation === 'clouds' ? 0.25 : 0.35} />
        )}

      {/* Fog layers */}
      {animation === 'fog' && !prefersReducedMotion && <FogLayers />}

      {/* Lightning */}
      <AnimatePresence>
        {animation === 'thunderstorm' && !prefersReducedMotion && (
          <>
            <LightningFlash delay={0} />
            <LightningFlash delay={4.5} />
          </>
        )}
      </AnimatePresence>

      {/* Canvas particles */}
      {needsCanvas && !prefersReducedMotion && (
        <canvas ref={canvasRef} className='absolute inset-0 h-full w-full' />
      )}

      {/* Vignette overlay */}
      <div
        className='absolute inset-0'
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.3) 100%)',
        }}
      />

      {/* Bottom fade for readability */}
      <div
        className='absolute inset-x-0 bottom-0 h-1/3'
        style={{
          background:
            'linear-gradient(to top, rgba(0,0,0,0.4) 0%, transparent 100%)',
        }}
      />
    </div>
  )
}

function NightSky() {
  const stars = useMemo(
    () =>
      Array.from({ length: 80 }).map((_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 65,
        size: Math.random() * 2 + 0.5,
        delay: Math.random() * 5,
        duration: 2 + Math.random() * 4,
        brightness: 0.3 + Math.random() * 0.7,
      })),
    []
  )

  return (
    <div className='absolute inset-0'>
      {stars.map((s) => (
        <motion.div
          key={s.id}
          className='absolute rounded-full bg-white'
          style={{
            width: s.size,
            height: s.size,
            left: `${s.x}%`,
            top: `${s.y}%`,
          }}
          animate={{
            opacity: [s.brightness * 0.3, s.brightness, s.brightness * 0.3],
            scale: [0.8, 1.2, 0.8],
          }}
          transition={{
            duration: s.duration,
            repeat: Infinity,
            delay: s.delay,
            ease: 'easeInOut',
          }}
        />
      ))}

      {/* Shooting star */}
      <motion.div
        className='absolute h-px bg-gradient-to-r from-transparent via-white to-transparent'
        style={{ width: 80, top: '15%', left: '20%', rotate: -25 }}
        animate={{
          x: [0, 300],
          y: [0, 120],
          opacity: [0, 1, 0],
        }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          repeatDelay: 12,
          ease: 'easeIn',
        }}
      />
      <motion.div
        className='absolute h-px bg-gradient-to-r from-transparent via-white/70 to-transparent'
        style={{ width: 50, top: '8%', left: '60%', rotate: -30 }}
        animate={{
          x: [0, 200],
          y: [0, 80],
          opacity: [0, 0.8, 0],
        }}
        transition={{
          duration: 1.2,
          repeat: Infinity,
          repeatDelay: 20,
          delay: 7,
          ease: 'easeIn',
        }}
      />
    </div>
  )
}

function AuroraBorealis() {
  return (
    <div className='absolute inset-0 overflow-hidden opacity-40'>
      <motion.div
        className='absolute top-0 -left-1/4 h-2/3 w-[150%]'
        style={{
          background:
            'linear-gradient(180deg, transparent 0%, rgba(34,197,94,0.15) 30%, rgba(59,130,246,0.1) 60%, transparent 100%)',
          filter: 'blur(40px)',
        }}
        animate={{
          x: ['-10%', '10%', '-10%'],
          scaleY: [1, 1.3, 1],
          opacity: [0.3, 0.6, 0.3],
        }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className='absolute top-[5%] -left-1/4 h-1/2 w-[150%]'
        style={{
          background:
            'linear-gradient(180deg, transparent 0%, rgba(139,92,246,0.12) 40%, rgba(34,197,94,0.08) 70%, transparent 100%)',
          filter: 'blur(50px)',
        }}
        animate={{
          x: ['10%', '-10%', '10%'],
          scaleY: [1.2, 0.9, 1.2],
          opacity: [0.4, 0.2, 0.4],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: 3,
        }}
      />
    </div>
  )
}

function SunGlow() {
  return (
    <>
      {/* Main glow */}
      <motion.div
        className='absolute -top-16 -right-16 h-72 w-72'
        style={{
          background:
            'radial-gradient(circle, rgba(250,204,21,0.5) 0%, rgba(251,191,36,0.2) 30%, rgba(245,158,11,0.08) 60%, transparent 80%)',
        }}
        animate={{
          scale: [1, 1.15, 1],
          opacity: [0.8, 1, 0.8],
        }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* Lens flare */}
      <motion.div
        className='absolute top-12 right-12 h-2 w-2 rounded-full bg-white'
        style={{ filter: 'blur(1px)' }}
        animate={{ opacity: [0.3, 0.8, 0.3], scale: [1, 1.5, 1] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* God rays */}
      <motion.div
        className='absolute -top-10 -right-10 h-[500px] w-[500px]'
        style={{
          background:
            'conic-gradient(from 200deg, transparent 0deg, rgba(250,204,21,0.06) 5deg, transparent 10deg, transparent 40deg, rgba(250,204,21,0.04) 45deg, transparent 50deg, transparent 80deg, rgba(250,204,21,0.05) 85deg, transparent 90deg, transparent 130deg, rgba(250,204,21,0.03) 135deg, transparent 140deg, transparent 180deg, rgba(250,204,21,0.06) 185deg, transparent 190deg, transparent 240deg, rgba(250,204,21,0.04) 245deg, transparent 250deg, transparent 300deg, rgba(250,204,21,0.05) 305deg, transparent 310deg, transparent 360deg)',
        }}
        animate={{ rotate: [0, 360] }}
        transition={{ duration: 120, repeat: Infinity, ease: 'linear' }}
      />
    </>
  )
}

function CloudLayers({ opacity }: { opacity: number }) {
  return (
    <>
      {[
        { top: '5%', speed: 60, w: '35rem', h: '12rem', op: opacity },
        { top: '15%', speed: 80, w: '28rem', h: '10rem', op: opacity * 0.8 },
        { top: '25%', speed: 45, w: '40rem', h: '14rem', op: opacity * 0.6 },
        { top: '8%', speed: 70, w: '25rem', h: '9rem', op: opacity * 0.5 },
      ].map((cloud, i) => (
        <motion.div
          key={i}
          className='absolute rounded-full'
          style={{
            top: cloud.top,
            width: cloud.w,
            height: cloud.h,
            background: `radial-gradient(ellipse, rgba(255,255,255,${cloud.op}) 0%, rgba(255,255,255,${cloud.op * 0.3}) 40%, transparent 70%)`,
            filter: 'blur(8px)',
          }}
          animate={{
            x: i % 2 === 0 ? ['-30%', '120%'] : ['120%', '-30%'],
          }}
          transition={{
            duration: cloud.speed,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      ))}
    </>
  )
}

function FogLayers() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className='absolute inset-x-0'
          style={{
            top: `${20 + i * 18}%`,
            height: '30%',
            background: `linear-gradient(90deg, transparent 0%, rgba(148,163,184,${0.15 + i * 0.05}) 20%, rgba(148,163,184,${0.25 + i * 0.05}) 50%, rgba(148,163,184,${0.15 + i * 0.05}) 80%, transparent 100%)`,
            filter: 'blur(12px)',
          }}
          animate={{
            x: i % 2 === 0 ? ['-15%', '15%'] : ['15%', '-15%'],
            opacity: [0.6, 1, 0.6],
          }}
          transition={{
            duration: 12 + i * 4,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
    </>
  )
}

function LightningFlash({ delay }: { delay: number }) {
  return (
    <>
      {/* Screen flash */}
      <motion.div
        className='absolute inset-0 bg-white'
        initial={{ opacity: 0 }}
        animate={{
          opacity: [0, 0, 0.9, 0, 0.5, 0, 0, 0, 0, 0, 0],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          repeatDelay: 3 + Math.random() * 6,
          delay,
          times: [0, 0.08, 0.1, 0.14, 0.16, 0.2, 0.3, 0.5, 0.7, 0.9, 1],
        }}
      />
      {/* Afterglow on clouds */}
      <motion.div
        className='absolute inset-x-0 top-0 h-1/3'
        style={{
          background:
            'linear-gradient(to bottom, rgba(167,139,250,0.15) 0%, transparent 100%)',
        }}
        animate={{
          opacity: [0, 0, 0.8, 0, 0.3, 0, 0],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          repeatDelay: 3 + Math.random() * 6,
          delay,
          times: [0, 0.08, 0.12, 0.18, 0.2, 0.25, 1],
        }}
      />
    </>
  )
}

// Created and developed by Jai Singh
