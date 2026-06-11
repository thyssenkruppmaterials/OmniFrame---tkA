// Created and developed by Jai Singh
import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Cinematic multisystem overture.
 *
 * A ~4.8-second opening act: a lone spark descends into the void, ignites the
 * central OmniFrame hub, eight satellite systems (database, AI, api, flow,
 * analytics, identity, messaging, storage) emerge into orbit, beams connect
 * them to the hub, data packets begin to flow along the lines, and the
 * chorus converges in a bright push-in that hands off to the existing intro
 * reveal.
 *
 * Everything is driven by a single requestAnimationFrame playhead expressed
 * in seconds, so all beats can be tuned against one timeline. Translated and
 * condensed from the standalone design in Downloads/Loading.
 */

const OVERTURE_DURATION = 4.8
const HANDOFF_START = 4.2

const PALETTE = {
  bg0: '#020617',
  bg1: '#06131f',
  ink: '#dff1ff',
  dim: '#6b8097',
  blue: '#06b6d4',
  blueHot: '#22d3ee',
  blueDeep: '#0ea5e9',
  cyan: '#7dd3fc',
}

const FONT_MONO =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace'

type SystemKind =
  | 'db'
  | 'ai'
  | 'api'
  | 'flow'
  | 'ana'
  | 'auth'
  | 'queue'
  | 'store'

type SystemDef = {
  id: SystemKind
  label: string
  code: string
  angle: number
}

const SYSTEMS: SystemDef[] = [
  { id: 'db', label: 'DATABASE', code: 'SYS:01', angle: -90 },
  { id: 'ai', label: 'AI ENGINE', code: 'SYS:02', angle: -45 },
  { id: 'api', label: 'API GATEWAY', code: 'SYS:03', angle: 0 },
  { id: 'flow', label: 'WORKFLOWS', code: 'SYS:04', angle: 45 },
  { id: 'ana', label: 'ANALYTICS', code: 'SYS:05', angle: 90 },
  { id: 'auth', label: 'IDENTITY', code: 'SYS:06', angle: 135 },
  { id: 'queue', label: 'MESSAGING', code: 'SYS:07', angle: 180 },
  { id: 'store', label: 'STORAGE', code: 'SYS:08', angle: 225 },
]

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v))
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
const easeInCubic = (t: number) => t * t * t
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
const easeOutBack = (t: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

function tween(
  from: number,
  to: number,
  start: number,
  end: number,
  t: number,
  ease: (x: number) => number = easeInOutCubic
) {
  if (t <= start) return from
  if (t >= end) return to
  const local = (t - start) / (end - start)
  return from + (to - from) * ease(local)
}

function useOvertureClock(onComplete: () => void) {
  const [time, setTime] = useState(0)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)
  const completedRef = useRef(false)

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (reduced) {
      setTime(OVERTURE_DURATION)
      onComplete()
      return
    }

    const step = (ts: number) => {
      if (startRef.current == null) startRef.current = ts
      const t = (ts - startRef.current) / 1000
      setTime(t)
      if (t >= OVERTURE_DURATION) {
        if (!completedRef.current) {
          completedRef.current = true
          onComplete()
        }
        return
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [onComplete])

  return time
}

type OvertureProps = {
  onComplete: () => void
  width?: number
  height?: number
}

export function CinematicOverture({
  onComplete,
  width = 1920,
  height = 1080,
}: OvertureProps) {
  const time = useOvertureClock(onComplete)
  const handoffT =
    time < HANDOFF_START
      ? 0
      : clamp(
          (time - HANDOFF_START) / (OVERTURE_DURATION - HANDOFF_START),
          0,
          1
        )

  // Push-in + brighten as we hand off to the existing intro
  const cameraZoom = tween(
    1.0,
    1.55,
    HANDOFF_START,
    OVERTURE_DURATION,
    time,
    easeInCubic
  )
  const sceneOpacity = tween(
    1,
    0,
    HANDOFF_START + 0.25,
    OVERTURE_DURATION,
    time,
    easeInCubic
  )
  const flashOpacity =
    handoffT <= 0
      ? 0
      : handoffT < 0.6
        ? easeOutCubic(handoffT / 0.6)
        : 1 - easeInCubic((handoffT - 0.6) / 0.4)

  const cx = width / 2
  const cy = height / 2
  const radius = 360

  const orbitOffset = time > 2.2 ? (time - 2.2) * 12 : 0

  return (
    <div
      aria-hidden='true'
      data-testid='cinematic-overture'
      className='pointer-events-none absolute inset-0 overflow-hidden'
      style={{ opacity: sceneOpacity }}
    >
      <div
        className='absolute top-1/2 left-1/2'
        style={{
          width,
          height,
          marginLeft: -width / 2,
          marginTop: -height / 2,
          transform: `scale(${fitScale(width, height)}) scale(${cameraZoom})`,
          transformOrigin: 'center',
          willChange: 'transform',
        }}
      >
        <CosmicBackdrop w={width} h={height} time={time} />
        <OpeningSpark cx={cx} cy={cy} time={time} />
        <ConnectionLines
          cx={cx}
          cy={cy}
          radius={radius}
          time={time}
          orbitOffset={orbitOffset}
        />
        <DataPackets
          cx={cx}
          cy={cy}
          radius={radius}
          time={time}
          orbitOffset={orbitOffset}
        />
        <Shockwaves cx={cx} cy={cy} time={time} />
        <CentralHub cx={cx} cy={cy} time={time} />
        {SYSTEMS.map((sys) => (
          <SystemNode
            key={sys.id}
            sys={sys}
            cx={cx}
            cy={cy}
            radius={radius}
            time={time}
            orbitOffset={orbitOffset}
          />
        ))}
        <Hud w={width} h={height} time={time} />
      </div>

      {/* Bright handoff flash — wipes into the existing intro reveal */}
      <div
        className='absolute inset-0'
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(186,230,253,0.95) 0%, rgba(6,182,212,0.45) 40%, rgba(2,6,23,0) 75%)',
          opacity: flashOpacity,
        }}
      />
    </div>
  )
}

function fitScale(designW: number, designH: number) {
  if (typeof window === 'undefined') return 1
  const s = Math.min(window.innerWidth / designW, window.innerHeight / designH)
  // Slight over-fit so corners always cover at any aspect ratio.
  return Math.max(s, Math.min(window.innerWidth / designW, 1)) * 1.02
}

function CosmicBackdrop({
  w,
  h,
  time,
}: {
  w: number
  h: number
  time: number
}) {
  const stars = useMemo(() => {
    const arr: Array<{
      x: number
      y: number
      r: number
      a: number
      phase: number
      speed: number
    }> = []
    let seed = 7
    const rnd = () => {
      seed = (seed * 9301 + 49297) % 233280
      return seed / 233280
    }
    for (let i = 0; i < 140; i++) {
      arr.push({
        x: rnd() * w,
        y: rnd() * h,
        r: 0.4 + rnd() * 1.6,
        a: 0.2 + rnd() * 0.7,
        phase: rnd() * Math.PI * 2,
        speed: 0.4 + rnd() * 1.4,
      })
    }
    return arr
  }, [w, h])

  const gridOpacity = tween(0, 0.22, 0.25, 1.2, time, easeOutCubic)
  const auroraX = Math.sin(time * 0.35) * 60
  const auroraY = Math.cos(time * 0.24) * 40

  return (
    <div className='absolute inset-0 overflow-hidden'>
      <div
        className='absolute inset-0'
        style={{
          background: `radial-gradient(ellipse at 50% 50%, ${PALETTE.bg1} 0%, ${PALETTE.bg0} 70%, #000 100%)`,
        }}
      />
      <div
        className='absolute'
        style={{
          left: w * 0.5 + auroraX - 900,
          top: h * 0.5 + auroraY - 900,
          width: 1800,
          height: 1800,
          background: `radial-gradient(circle, rgba(6,182,212,0.22) 0%, rgba(14,165,233,0.08) 30%, transparent 60%)`,
          filter: 'blur(40px)',
          mixBlendMode: 'screen',
        }}
      />
      <svg
        width={w}
        height={h}
        className='absolute inset-0'
        style={{ opacity: gridOpacity }}
      >
        <defs>
          <pattern
            id='overture-grid'
            width='80'
            height='80'
            patternUnits='userSpaceOnUse'
          >
            <path
              d='M 80 0 L 0 0 0 80'
              fill='none'
              stroke={PALETTE.blue}
              strokeWidth='0.5'
              opacity='0.5'
            />
          </pattern>
          <radialGradient id='overture-gridFade' cx='50%' cy='50%' r='50%'>
            <stop offset='0%' stopColor='white' stopOpacity='1' />
            <stop offset='60%' stopColor='white' stopOpacity='0.4' />
            <stop offset='100%' stopColor='white' stopOpacity='0' />
          </radialGradient>
          <mask id='overture-gridMask'>
            <rect width={w} height={h} fill='url(#overture-gridFade)' />
          </mask>
        </defs>
        <rect
          width={w}
          height={h}
          fill='url(#overture-grid)'
          mask='url(#overture-gridMask)'
        />
      </svg>
      <svg width={w} height={h} className='absolute inset-0'>
        {stars.map((s, i) => {
          const tw = 0.5 + 0.5 * Math.sin(time * s.speed + s.phase)
          return (
            <circle
              key={i}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill={PALETTE.ink}
              opacity={s.a * tw}
            />
          )
        })}
      </svg>
      <div
        className='absolute inset-0'
        style={{
          background:
            'radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(0,0,0,0.75) 100%)',
        }}
      />
    </div>
  )
}

function OpeningSpark({
  cx,
  cy,
  time,
}: {
  cx: number
  cy: number
  time: number
}) {
  if (time > 1.1) return null
  const t = tween(0, 1, 0.1, 1.0, time, easeInCubic)
  const py = -80 + t * (cy + 80)
  const op =
    t < 0.1 ? t / 0.1 : t > 0.9 ? Math.max(0, 1 - ((t - 0.9) / 0.1) * 6) : 1
  const size = 3 + t * 12
  return (
    <div
      className='absolute rounded-full'
      style={{
        left: cx,
        top: py,
        transform: 'translate(-50%, -50%)',
        width: size,
        height: size,
        background: PALETTE.cyan,
        opacity: op,
        boxShadow: `0 0 ${16 + t * 40}px ${PALETTE.cyan}, 0 0 ${30 + t * 80}px ${PALETTE.blueDeep}`,
        filter: 'blur(0.3px)',
      }}
    />
  )
}

function CentralHub({
  cx,
  cy,
  time,
}: {
  cx: number
  cy: number
  time: number
}) {
  const appear = tween(0, 1, 0.95, 1.5, time, easeOutCubic)
  const scaleIn = tween(0.3, 1, 0.95, 1.6, time, easeOutBack)
  const pulse =
    time > 1.5 ? 1 + 0.035 * Math.sin((time - 1.5) * Math.PI * 1.4) : 1
  const flare1 = Math.max(0, 1 - Math.abs(time - 1.25) * 2.5)
  const flare2 = Math.max(0, 1 - Math.abs(time - 3.8) * 2)
  const bloom = 0.4 + 0.5 * flare1 + 0.8 * flare2
  const ring1 = (time * 42) % 360
  const ring2 = -(time * 30) % 360
  const size = 260

  return (
    <div
      className='absolute'
      style={{
        left: cx,
        top: cy,
        transform: `translate(-50%, -50%) scale(${scaleIn * pulse})`,
        opacity: appear,
        willChange: 'transform, opacity',
      }}
    >
      {/* Bloom halo */}
      <div
        className='pointer-events-none absolute top-1/2 left-1/2'
        style={{
          width: 520,
          height: 520,
          marginLeft: -260,
          marginTop: -260,
          background: `radial-gradient(circle, rgba(34,211,238,${0.38 * bloom}) 0%, rgba(6,182,212,${0.16 * bloom}) 30%, transparent 65%)`,
          filter: 'blur(8px)',
        }}
      />

      {/* Outer dashed orbit with tick marks */}
      <svg
        width={size + 120}
        height={size + 120}
        className='absolute top-1/2 left-1/2'
        style={{
          marginLeft: -(size + 120) / 2,
          marginTop: -(size + 120) / 2,
          transform: `rotate(${ring1}deg)`,
        }}
      >
        <circle
          cx={(size + 120) / 2}
          cy={(size + 120) / 2}
          r={(size + 100) / 2}
          fill='none'
          stroke={PALETTE.blue}
          strokeWidth='1'
          opacity='0.45'
          strokeDasharray='2 6'
        />
        {Array.from({ length: 24 }).map((_, i) => {
          const a = (i / 24) * Math.PI * 2
          const r = (size + 100) / 2
          const tx = (size + 120) / 2 + Math.cos(a) * r
          const ty = (size + 120) / 2 + Math.sin(a) * r
          return (
            <circle
              key={i}
              cx={tx}
              cy={ty}
              r={i % 3 === 0 ? 2.2 : 1}
              fill={PALETTE.blue}
              opacity={i % 3 === 0 ? 0.9 : 0.45}
            />
          )
        })}
      </svg>

      {/* Inner counter-rotating arc ring */}
      <svg
        width={size + 60}
        height={size + 60}
        className='absolute top-1/2 left-1/2'
        style={{
          marginLeft: -(size + 60) / 2,
          marginTop: -(size + 60) / 2,
          transform: `rotate(${ring2}deg)`,
        }}
      >
        <circle
          cx={(size + 60) / 2}
          cy={(size + 60) / 2}
          r={(size + 40) / 2}
          fill='none'
          stroke={PALETTE.cyan}
          strokeWidth='0.8'
          opacity='0.55'
        />
        {[0, 90, 180, 270].map((deg) => {
          const r = (size + 40) / 2
          const cx2 = (size + 60) / 2
          const cy2 = (size + 60) / 2
          const a1 = ((deg - 12) * Math.PI) / 180
          const a2 = ((deg + 12) * Math.PI) / 180
          return (
            <path
              key={deg}
              d={`M ${cx2 + Math.cos(a1) * r} ${cy2 + Math.sin(a1) * r} A ${r} ${r} 0 0 1 ${cx2 + Math.cos(a2) * r} ${cy2 + Math.sin(a2) * r}`}
              fill='none'
              stroke={PALETTE.cyan}
              strokeWidth='3'
              opacity='0.9'
              strokeLinecap='round'
            />
          )
        })}
      </svg>

      {/* Disc */}
      <div
        className='absolute top-1/2 left-1/2 rounded-full'
        style={{
          width: size,
          height: size,
          marginLeft: -size / 2,
          marginTop: -size / 2,
          background: `radial-gradient(circle, rgba(8,20,35,0.95) 0%, rgba(3,12,22,0.88) 70%, rgba(3,12,22,0) 100%)`,
          boxShadow: `inset 0 0 40px rgba(6,182,212,0.28), 0 0 60px rgba(6,182,212,${0.45 * bloom}), 0 0 120px rgba(34,211,238,${0.28 * bloom})`,
          border: '1px solid rgba(34,211,238,0.4)',
        }}
      />

      {/* Sweep line */}
      <div
        className='absolute top-1/2 left-1/2 overflow-hidden rounded-full'
        style={{
          width: size,
          height: size,
          marginLeft: -size / 2,
          marginTop: -size / 2,
          opacity: 0.6,
        }}
      >
        <div
          className='absolute top-1/2 left-1/2'
          style={{
            width: size,
            height: 2,
            marginLeft: -size / 2,
            marginTop: -1,
            background: `linear-gradient(90deg, transparent, ${PALETTE.cyan}, transparent)`,
            transform: `rotate(${(time * 200) % 360}deg)`,
            filter: 'blur(1px)',
          }}
        />
      </div>

      {/* Logo core */}
      <img
        src='/images/OneBoxLogoX.png'
        alt=''
        className='absolute top-1/2 left-1/2'
        style={{
          width: size * 0.62,
          height: size * 0.62,
          marginLeft: -size * 0.31,
          marginTop: -size * 0.31,
          filter: `drop-shadow(0 0 12px rgba(34,211,238,${0.5 + 0.4 * flare1 + 0.6 * flare2})) drop-shadow(0 0 24px rgba(6,182,212,${0.3 + 0.3 * flare2}))`,
        }}
      />
    </div>
  )
}

function SystemNode({
  sys,
  cx,
  cy,
  radius,
  time,
  orbitOffset,
}: {
  sys: SystemDef
  cx: number
  cy: number
  radius: number
  time: number
  orbitOffset: number
}) {
  const order = SYSTEMS.findIndex((s) => s.id === sys.id)
  const emergeStart = 1.55 + order * 0.08
  const emergeEnd = emergeStart + 0.55

  const appear = tween(0, 1, emergeStart, emergeEnd, time, easeOutCubic)
  const scaleIn = tween(0.4, 1, emergeStart, emergeEnd, time, easeOutBack)

  const angle = ((sys.angle + orbitOffset) * Math.PI) / 180
  const x = cx + Math.cos(angle) * radius
  const y = cy + Math.sin(angle) * radius

  const syncFlash = Math.max(
    Math.max(0, 1 - Math.abs(time - (3.7 + order * 0.04)) * 3.5),
    Math.max(0, 1 - Math.abs(time - (4.3 + order * 0.04)) * 3.5)
  )
  const breathe = time > 2.0 ? 1 + 0.03 * Math.sin(time * 2.2 + order) : 1
  const nodeSize = 108

  return (
    <div
      className='absolute'
      style={{
        left: x,
        top: y,
        transform: `translate(-50%, -50%) scale(${scaleIn * breathe})`,
        opacity: appear,
        willChange: 'transform, opacity',
      }}
    >
      {/* Halo */}
      <div
        className='pointer-events-none absolute top-1/2 left-1/2 rounded-full'
        style={{
          width: nodeSize * 2,
          height: nodeSize * 2,
          marginLeft: -nodeSize,
          marginTop: -nodeSize,
          background: `radial-gradient(circle, rgba(34,211,238,${0.22 + 0.45 * syncFlash}) 0%, transparent 55%)`,
          filter: 'blur(6px)',
        }}
      />

      {/* Hex frame */}
      <svg
        width={nodeSize}
        height={nodeSize}
        className='absolute top-1/2 left-1/2'
        style={{ marginLeft: -nodeSize / 2, marginTop: -nodeSize / 2 }}
      >
        {renderHex(nodeSize, syncFlash)}
      </svg>

      {/* Glyph */}
      <div
        className='absolute top-1/2 left-1/2'
        style={{
          width: 56,
          height: 56,
          marginLeft: -28,
          marginTop: -28,
          color: PALETTE.blueHot,
          filter: `drop-shadow(0 0 4px rgba(34,211,238,${0.6 + 0.4 * syncFlash}))`,
        }}
      >
        <Glyph kind={sys.id} color={PALETTE.blueHot} />
      </div>

      {/* Labels */}
      <div
        className='absolute left-1/2 whitespace-nowrap'
        style={{
          top: nodeSize / 2 + 10,
          transform: 'translate(-50%, 0)',
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: '0.2em',
          color: PALETTE.blueHot,
          textShadow: '0 0 6px rgba(34,211,238,0.6)',
        }}
      >
        {sys.label}
      </div>
      <div
        className='absolute left-1/2 whitespace-nowrap'
        style={{
          top: nodeSize / 2 + 24,
          transform: 'translate(-50%, 0)',
          fontFamily: FONT_MONO,
          fontSize: 8,
          letterSpacing: '0.2em',
          color: PALETTE.dim,
        }}
      >
        {sys.code}
      </div>
    </div>
  )
}

function renderHex(nodeSize: number, syncFlash: number) {
  const r = nodeSize / 2 - 4
  const cx = nodeSize / 2
  const cy = nodeSize / 2
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const
  })
  const d = 'M ' + pts.map((p) => p.join(' ')).join(' L ') + ' Z'
  return (
    <>
      <path
        d={d}
        fill='rgba(8,20,35,0.92)'
        stroke={PALETTE.blue}
        strokeWidth='1.4'
        opacity={0.9}
      />
      <path
        d={d}
        fill='none'
        stroke={PALETTE.cyan}
        strokeWidth='0.6'
        opacity={0.5 + 0.5 * syncFlash}
        style={{ transform: 'scale(1.08)', transformOrigin: `${cx}px ${cy}px` }}
      />
    </>
  )
}

function ConnectionLines({
  cx,
  cy,
  radius,
  time,
  orbitOffset,
}: {
  cx: number
  cy: number
  radius: number
  time: number
  orbitOffset: number
}) {
  return (
    <svg className='pointer-events-none absolute inset-0 h-full w-full'>
      {SYSTEMS.map((sys, i) => {
        const drawStart = 1.55 + i * 0.08 + 0.15
        const drawEnd = drawStart + 0.5
        const drawT = tween(0, 1, drawStart, drawEnd, time, easeInOutCubic)

        const angle = ((sys.angle + orbitOffset) * Math.PI) / 180
        const hubR = 130
        const nodeR = 54
        const x1 = cx + Math.cos(angle) * hubR
        const y1 = cy + Math.sin(angle) * hubR
        const nx = cx + Math.cos(angle) * (radius - nodeR)
        const ny = cy + Math.sin(angle) * (radius - nodeR)
        const ex = x1 + (nx - x1) * drawT
        const ey = y1 + (ny - y1) * drawT

        const flash = Math.max(
          Math.max(0, 1 - Math.abs(time - (3.7 + i * 0.04)) * 3.5),
          Math.max(0, 1 - Math.abs(time - (4.3 + i * 0.04)) * 3.5)
        )

        return (
          <g key={sys.id}>
            <line
              x1={x1}
              y1={y1}
              x2={ex}
              y2={ey}
              stroke={PALETTE.blue}
              strokeWidth={1.4 + 2 * flash}
              opacity={0.55 + 0.4 * flash}
              strokeLinecap='round'
            />
            <line
              x1={x1}
              y1={y1}
              x2={ex}
              y2={ey}
              stroke={PALETTE.cyan}
              strokeWidth={0.5 + 1 * flash}
              opacity={0.9}
              strokeLinecap='round'
              style={{ filter: `drop-shadow(0 0 3px ${PALETTE.cyan})` }}
            />
          </g>
        )
      })}
    </svg>
  )
}

function DataPackets({
  cx,
  cy,
  radius,
  time,
  orbitOffset,
}: {
  cx: number
  cy: number
  radius: number
  time: number
  orbitOffset: number
}) {
  const packets = useMemo(() => {
    const arr: Array<{
      sysIdx: number
      phaseOffset: number
      direction: 1 | -1
      speed: number
      hue: string
    }> = []
    SYSTEMS.forEach((_, i) => {
      for (let k = 0; k < 3; k++) {
        arr.push({
          sysIdx: i,
          phaseOffset: k / 3,
          direction: k % 2 === 0 ? 1 : -1,
          speed: 1.1 + k * 0.18,
          hue: k === 0 ? PALETTE.cyan : PALETTE.blueHot,
        })
      }
    })
    return arr
  }, [])

  if (time < 2.4) return null
  const globalT = time - 2.4
  const intro = tween(0, 1, 2.4, 3.0, time, easeOutCubic)

  return (
    <svg className='pointer-events-none absolute inset-0 h-full w-full'>
      {packets.map((p, i) => {
        const sys = SYSTEMS[p.sysIdx]
        const angle = ((sys.angle + orbitOffset) * Math.PI) / 180
        const hubR = 130
        const nodeR = 54
        const x1 = cx + Math.cos(angle) * hubR
        const y1 = cy + Math.sin(angle) * hubR
        const x2 = cx + Math.cos(angle) * (radius - nodeR)
        const y2 = cy + Math.sin(angle) * (radius - nodeR)

        let ph = (globalT * p.speed + p.phaseOffset) % 1
        if (p.direction < 0) ph = 1 - ph
        const px = x1 + (x2 - x1) * ph
        const py = y1 + (y2 - y1) * ph
        const fade = Math.sin(ph * Math.PI)

        return (
          <g key={i} opacity={fade * intro}>
            <circle
              cx={px}
              cy={py}
              r={3.5}
              fill={p.hue}
              style={{ filter: `drop-shadow(0 0 6px ${p.hue})` }}
            />
            <circle cx={px} cy={py} r={1.6} fill='#fff' />
          </g>
        )
      })}
    </svg>
  )
}

function Shockwaves({
  cx,
  cy,
  time,
}: {
  cx: number
  cy: number
  time: number
}) {
  const beats = [1.3, 2.6, 3.7, 4.4]
  return (
    <svg className='pointer-events-none absolute inset-0 h-full w-full'>
      {beats.map((b, i) => {
        const dt = time - b
        if (dt < 0 || dt > 1.6) return null
        const progress = dt / 1.6
        const r = 80 + progress * 900
        const op = (1 - progress) * 0.45
        return (
          <g key={i}>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill='none'
              stroke={PALETTE.cyan}
              strokeWidth={2.5 * (1 - progress) + 0.5}
              opacity={op}
            />
            <circle
              cx={cx}
              cy={cy}
              r={r - 14}
              fill='none'
              stroke={PALETTE.blue}
              strokeWidth={1.5 * (1 - progress)}
              opacity={op * 0.6}
            />
          </g>
        )
      })}
    </svg>
  )
}

function Hud({ w, h, time }: { w: number; h: number; time: number }) {
  const op = tween(0, 0.9, 0.1, 0.9, time, easeOutCubic)

  const bracket = (corner: 'tl' | 'tr' | 'bl' | 'br') => {
    const base = { position: 'absolute' as const, width: 40, height: 40 }
    const lineStyle = {
      position: 'absolute' as const,
      background: PALETTE.blue,
      opacity: 0.8,
    }
    const positions = {
      tl: { ...base, top: 36, left: 36 },
      tr: { ...base, top: 36, right: 36 },
      bl: { ...base, bottom: 72, left: 36 },
      br: { ...base, bottom: 72, right: 36 },
    } as const
    const sides = {
      tl: [
        { top: 0, left: 0, width: 24, height: 1 },
        { top: 0, left: 0, width: 1, height: 24 },
      ],
      tr: [
        { top: 0, right: 0, width: 24, height: 1 },
        { top: 0, right: 0, width: 1, height: 24 },
      ],
      bl: [
        { bottom: 0, left: 0, width: 24, height: 1 },
        { bottom: 0, left: 0, width: 1, height: 24 },
      ],
      br: [
        { bottom: 0, right: 0, width: 24, height: 1 },
        { bottom: 0, right: 0, width: 1, height: 24 },
      ],
    } as const
    return (
      <div style={positions[corner]}>
        {sides[corner].map((s, i) => (
          <div key={i} style={{ ...lineStyle, ...s }} />
        ))}
      </div>
    )
  }

  const hex = Math.floor(time * 983)
    .toString(16)
    .toUpperCase()
    .slice(-6)
    .padStart(6, '0')
  const tc = (() => {
    const m = Math.floor(time / 60)
    const s = Math.floor(time % 60)
    const f = Math.floor((time * 24) % 24)
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`
  })()

  const status =
    time < 1.0
      ? 'BOOT'
      : time < 1.7
        ? 'LINK'
        : time < 3.4
          ? 'SYNC'
          : time < 4.4
            ? 'FLUX'
            : 'LIVE'

  return (
    <div
      className='pointer-events-none absolute inset-0'
      style={{ opacity: op, width: w, height: h }}
    >
      {bracket('tl')}
      {bracket('tr')}
      {bracket('bl')}
      {bracket('br')}

      <div
        className='absolute whitespace-nowrap'
        style={{
          top: 42,
          left: 92,
          fontFamily: FONT_MONO,
          fontSize: 11,
          color: PALETTE.blueHot,
          letterSpacing: '0.25em',
        }}
      >
        OMNIFRAME · ORCHESTRATION LAYER
      </div>
      <div
        className='absolute whitespace-nowrap'
        style={{
          top: 60,
          left: 92,
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: PALETTE.dim,
          letterSpacing: '0.2em',
        }}
      >
        NODE:HUB-0 · CH:{hex}
      </div>
      <div
        className='absolute text-right whitespace-nowrap'
        style={{
          top: 42,
          right: 92,
          fontFamily: FONT_MONO,
          fontSize: 11,
          color: PALETTE.blueHot,
          letterSpacing: '0.25em',
        }}
      >
        STATUS · {status}
      </div>
      <div
        className='absolute text-right whitespace-nowrap'
        style={{
          top: 60,
          right: 92,
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: PALETTE.dim,
          letterSpacing: '0.2em',
        }}
      >
        TC {tc}
      </div>
      <div
        className='absolute'
        style={{
          bottom: 82,
          left: 92,
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: PALETTE.dim,
          letterSpacing: '0.25em',
        }}
      >
        ▸ {SYSTEMS.length} SYSTEMS · MESH ACTIVE
      </div>
      <div
        className='absolute text-right'
        style={{
          bottom: 82,
          right: 92,
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: PALETTE.dim,
          letterSpacing: '0.25em',
        }}
      >
        OMNI://link.mesh/v1
      </div>
    </div>
  )
}

function Glyph({ kind, color }: { kind: SystemKind; color: string }) {
  const s = {
    fill: 'none',
    stroke: color,
    strokeWidth: 2.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (kind) {
    case 'db':
      return (
        <svg viewBox='0 0 100 100' width='100%' height='100%'>
          <ellipse cx='50' cy='28' rx='24' ry='8' style={s} />
          <path d='M26 28v20c0 4.4 10.7 8 24 8s24-3.6 24-8V28' style={s} />
          <path d='M26 48v20c0 4.4 10.7 8 24 8s24-3.6 24-8V48' style={s} />
        </svg>
      )
    case 'ai':
      return (
        <svg viewBox='0 0 100 100' width='100%' height='100%'>
          <circle cx='50' cy='50' r='6' style={s} />
          <circle cx='28' cy='32' r='4' style={s} />
          <circle cx='72' cy='32' r='4' style={s} />
          <circle cx='28' cy='68' r='4' style={s} />
          <circle cx='72' cy='68' r='4' style={s} />
          <path
            d='M32 34l14 14M68 34l-14 14M32 66l14-14M68 66l-14-14'
            style={s}
          />
        </svg>
      )
    case 'api':
      return (
        <svg viewBox='0 0 100 100' width='100%' height='100%'>
          <rect x='20' y='30' width='60' height='40' rx='4' style={s} />
          <path d='M20 42h60M30 54h10M46 54h10M62 54h10' style={s} />
          <circle cx='28' cy='36' r='1.5' fill={color} />
          <circle cx='34' cy='36' r='1.5' fill={color} />
        </svg>
      )
    case 'flow':
      return (
        <svg viewBox='0 0 100 100' width='100%' height='100%'>
          <circle cx='26' cy='28' r='6' style={s} />
          <circle cx='74' cy='28' r='6' style={s} />
          <circle cx='50' cy='72' r='6' style={s} />
          <path d='M32 28h30M29 34l18 32M71 34L53 66' style={s} />
        </svg>
      )
    case 'ana':
      return (
        <svg viewBox='0 0 100 100' width='100%' height='100%'>
          <path d='M20 76V30M20 76h60' style={s} />
          <rect x='30' y='54' width='8' height='22' style={s} />
          <rect x='46' y='42' width='8' height='34' style={s} />
          <rect x='62' y='32' width='8' height='44' style={s} />
        </svg>
      )
    case 'auth':
      return (
        <svg viewBox='0 0 100 100' width='100%' height='100%'>
          <path
            d='M50 20l24 8v20c0 16-10.7 26-24 32-13.3-6-24-16-24-32V28l24-8z'
            style={s}
          />
          <path d='M40 52l7 7 14-14' style={s} />
        </svg>
      )
    case 'queue':
      return (
        <svg viewBox='0 0 100 100' width='100%' height='100%'>
          <rect x='18' y='40' width='18' height='20' style={s} />
          <rect x='42' y='40' width='18' height='20' style={s} />
          <rect x='66' y='40' width='18' height='20' style={s} />
          <path d='M36 50h6M60 50h6' style={s} />
        </svg>
      )
    case 'store':
      return (
        <svg viewBox='0 0 100 100' width='100%' height='100%'>
          <path
            d='M22 30h56l-4 42a4 4 0 01-4 4H30a4 4 0 01-4-4L22 30z'
            style={s}
          />
          <path d='M22 30l6-10h44l6 10M40 46v16M50 46v16M60 46v16' style={s} />
        </svg>
      )
  }
}

// Created and developed by Jai Singh
