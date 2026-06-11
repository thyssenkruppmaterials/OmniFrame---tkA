// Created and developed by Jai Singh
import { Easing } from '@/features/prototype/lib/anim'

/**
 * Scene 02 · PERCEPTION
 *
 * First-person POV through the XR glasses. A warehouse shelf with 24 cartons
 * fades in; a scan sweep rolls top-to-bottom; the on-device vision model
 * progressively draws corner-accent bounding boxes with confidence %; the
 * target SKU is locked in amber. Right-rail telemetry panel reports objects
 * detected, confidence, distance, NPU latency, and WMS link.
 */

const FG = '#f2efe6'
const CYAN = 'oklch(0.82 0.13 220)'
const AMBER = 'oklch(0.82 0.14 70)'
const OK_GREEN = 'oklch(0.82 0.13 140)'

type WarehouseStageProps = {
  time: number
}

export function WarehouseStage({ time }: WarehouseStageProps) {
  if (time < 9.5 || time > 19.0) return null

  const p = Math.max(0, Math.min(1, (time - 10.0) / 8.0))
  const phase: Phase = p < 0.6 ? 'scan' : p < 0.85 ? 'lock' : 'execute'

  let op = 1
  if (time < 10.0) op = Math.max(0, 1 - (10.0 - time) / 0.5)
  if (time > 18.0) op = Math.max(0, 1 - (time - 18.0) / 1.0)

  return (
    <g opacity={op} transform='translate(410, 200)'>
      <WarehouseView progress={p} phase={phase} />

      {/* Right telemetry rail */}
      <g transform='translate(1140, 0)'>
        <rect
          x='0'
          y='0'
          width='340'
          height='620'
          rx='12'
          fill='rgba(14,16,20,0.96)'
          stroke='rgba(242,239,230,0.1)'
        />
        <g transform='translate(20, 28)'>
          <text
            x='0'
            y='0'
            fontFamily='"JetBrains Mono", monospace'
            fontSize='11'
            fill='rgba(242,239,230,0.55)'
            letterSpacing='0.14em'
          >
            VISION · TELEMETRY
          </text>
        </g>
        <line x1='0' y1='52' x2='340' y2='52' stroke='rgba(242,239,230,0.08)' />

        <g transform='translate(20, 76)'>
          <MetricRow
            label='OBJECTS DETECTED'
            value={String(Math.floor(6 * Math.min(1, p / 0.5)))}
            y={0}
          />
          <MetricRow
            label='TARGET SKU'
            value={p > 0.2 ? 'B-2202' : '—'}
            y={56}
            accent={phase !== 'scan' ? AMBER : undefined}
          />
          <MetricRow
            label='CONFIDENCE'
            value={
              p > 0.2
                ? `${(97 * Math.min(1, (p - 0.2) / 0.2)).toFixed(1)}%`
                : '—'
            }
            y={112}
          />
          <MetricRow
            label='DISTANCE'
            value={p > 0.3 ? '1.24 m' : '—'}
            y={168}
          />
          <MetricRow label='NPU LATENCY' value='38 ms' y={224} />
          <MetricRow label='LINK' value='WMS · OK' y={280} accent={OK_GREEN} />
        </g>

        {phase !== 'scan' && (
          <g
            transform='translate(20, 460)'
            opacity={Math.min(1, (p - 0.6) / 0.1)}
          >
            <rect
              x='0'
              y='0'
              width='300'
              height='124'
              rx='8'
              fill='oklch(0.82 0.14 70 / 0.08)'
              stroke='oklch(0.82 0.14 70 / 0.6)'
            />
            <text
              x='14'
              y='22'
              fontFamily='"JetBrains Mono", monospace'
              fontSize='10'
              fill={AMBER}
              letterSpacing='0.14em'
            >
              TARGET ACQUIRED
            </text>
            <text
              x='14'
              y='54'
              fontFamily='Inter, sans-serif'
              fontSize='24'
              fontWeight='600'
              fill={FG}
              letterSpacing='-0.01em'
            >
              B-2202
            </text>
            <text
              x='14'
              y='80'
              fontFamily='Inter, sans-serif'
              fontSize='14'
              fill='rgba(242,239,230,0.7)'
            >
              Shelf B · Bay 22 · Slot 02
            </text>
            <text
              x='14'
              y='104'
              fontFamily='"JetBrains Mono", monospace'
              fontSize='11'
              fill='rgba(242,239,230,0.5)'
            >
              QTY 4 · LOT L-9821
            </text>
          </g>
        )}
      </g>
    </g>
  )
}

type Phase = 'scan' | 'lock' | 'execute'

function WarehouseView({
  progress,
  phase,
}: {
  progress: number
  phase: Phase
}) {
  return (
    <g>
      <defs>
        <linearGradient id='warehouseBg' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor='#1a1e22' />
          <stop offset='1' stopColor='#0d1013' />
        </linearGradient>
        <clipPath id='povClip'>
          <rect x='0' y='0' width='1100' height='620' rx='14' />
        </clipPath>
      </defs>

      <g clipPath='url(#povClip)'>
        <rect x='0' y='0' width='1100' height='620' fill='url(#warehouseBg)' />
        <WarehouseShelf />
        <HudReticle />
        {phase === 'scan' && <ScanSweep progress={progress} />}
        <VisionBoxes progress={progress} phase={phase} />
      </g>

      <rect
        x='0'
        y='0'
        width='1100'
        height='620'
        rx='14'
        fill='none'
        stroke='rgba(242,239,230,0.15)'
        strokeWidth='1'
      />
      <HudCorners />
    </g>
  )
}

function WarehouseShelf() {
  return (
    <g>
      {/* floor */}
      <polygon points='0,520 1100,520 1100,620 0,620' fill='#0a0c0e' />
      <line
        x1='0'
        y1='520'
        x2='1100'
        y2='520'
        stroke='rgba(242,239,230,0.2)'
        strokeWidth='1'
      />
      {/* vanishing lines */}
      <g stroke='rgba(242,239,230,0.08)' strokeWidth='1'>
        <line x1='0' y1='620' x2='550' y2='520' />
        <line x1='1100' y1='620' x2='550' y2='520' />
      </g>

      {/* uprights */}
      <rect x='30' y='40' width='8' height='480' fill='#2b2f33' />
      <rect x='540' y='40' width='8' height='480' fill='#2b2f33' />
      <rect x='1062' y='40' width='8' height='480' fill='#2b2f33' />

      {/* shelf beams */}
      {[90, 240, 390].map((y) => (
        <g key={y}>
          <rect x='38' y={y} width='1024' height='6' fill='#3a3f44' />
          <rect
            x='38'
            y={y - 1}
            width='1024'
            height='1'
            fill='rgba(255,255,255,0.08)'
          />
        </g>
      ))}

      {/* boxes */}
      {TOP_BOXES.map((b, i) => (
        <Box key={`t${i}`} {...b} />
      ))}
      {MID_BOXES.map((b, i) => (
        <Box key={`m${i}`} {...b} />
      ))}
      {BOT_BOXES.map((b, i) => (
        <Box key={`b${i}`} {...b} />
      ))}
    </g>
  )
}

type BoxDef = {
  x: number
  y: number
  w: number
  h: number
  color: string
  label: string
}

const TOP_BOXES: BoxDef[] = [
  { x: 70, y: 100, w: 110, h: 120, color: '#b28a5a', label: 'A-1101' },
  { x: 200, y: 100, w: 90, h: 120, color: '#c7a06b', label: 'A-1102' },
  { x: 310, y: 120, w: 130, h: 100, color: '#8c6a42', label: 'A-1103' },
  { x: 460, y: 100, w: 70, h: 120, color: '#a07e51', label: 'A-1104' },
  { x: 570, y: 110, w: 120, h: 110, color: '#b28a5a', label: 'A-1105' },
  { x: 710, y: 100, w: 90, h: 120, color: '#c7a06b', label: 'A-1106' },
  { x: 820, y: 130, w: 110, h: 90, color: '#8c6a42', label: 'A-1107' },
  { x: 950, y: 110, w: 100, h: 110, color: '#a07e51', label: 'A-1108' },
]
const MID_BOXES: BoxDef[] = [
  { x: 70, y: 260, w: 130, h: 120, color: '#7a5a3a', label: 'B-2201' },
  { x: 220, y: 250, w: 100, h: 130, color: '#b28a5a', label: 'B-2202' },
  { x: 340, y: 270, w: 80, h: 110, color: '#c7a06b', label: 'B-2203' },
  { x: 440, y: 250, w: 100, h: 130, color: '#a07e51', label: 'B-2204' },
  { x: 570, y: 270, w: 110, h: 110, color: '#8c6a42', label: 'B-2205' },
  { x: 700, y: 250, w: 130, h: 130, color: '#b28a5a', label: 'B-2206' },
  { x: 850, y: 260, w: 100, h: 120, color: '#a07e51', label: 'B-2207' },
  { x: 970, y: 270, w: 90, h: 110, color: '#7a5a3a', label: 'B-2208' },
]
const BOT_BOXES: BoxDef[] = [
  { x: 70, y: 410, w: 100, h: 100, color: '#3e4b5a', label: 'C-3301' },
  { x: 190, y: 400, w: 130, h: 110, color: '#4a5a6c', label: 'C-3302' },
  { x: 340, y: 420, w: 90, h: 90, color: '#3e4b5a', label: 'C-3303' },
  { x: 450, y: 400, w: 100, h: 110, color: '#4a5a6c', label: 'C-3304' },
  { x: 570, y: 410, w: 110, h: 100, color: '#3e4b5a', label: 'C-3305' },
  { x: 700, y: 400, w: 100, h: 110, color: '#4a5a6c', label: 'C-3306' },
  { x: 820, y: 420, w: 120, h: 90, color: '#3e4b5a', label: 'C-3307' },
  { x: 960, y: 400, w: 100, h: 110, color: '#4a5a6c', label: 'C-3308' },
]

function Box({ x, y, w, h, color, label }: BoxDef) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={color} />
      <polygon
        points={`${x},${y} ${x + w},${y} ${x + w - 6},${y - 8} ${x + 6},${
          y - 8
        }`}
        fill={shade(color, -0.25)}
      />
      <polygon
        points={`${x + w},${y} ${x + w},${y + h} ${x + w + 4},${y + h - 4} ${
          x + w + 4
        },${y - 4}`}
        fill={shade(color, -0.35)}
        opacity='0.8'
      />
      <rect
        x={x}
        y={y + h * 0.42}
        width={w}
        height='8'
        fill='rgba(0,0,0,0.15)'
      />
      <rect
        x={x + 8}
        y={y + h - 26}
        width={w - 16}
        height='18'
        fill='rgba(255,255,255,0.8)'
      />
      <text
        x={x + w / 2}
        y={y + h - 13}
        textAnchor='middle'
        fontFamily='"JetBrains Mono", monospace'
        fontSize='9'
        fill='#222'
      >
        {label}
      </text>
    </g>
  )
}

/** crude hex darken; `amt` is negative to darken, positive to lighten. */
function shade(color: string, amt: number) {
  if (!color.startsWith('#')) return color
  const hex = color.slice(1)
  const n = parseInt(hex, 16)
  let r = (n >> 16) & 0xff
  let g = (n >> 8) & 0xff
  let b = n & 0xff
  r = Math.max(0, Math.min(255, Math.round(r * (1 + amt))))
  g = Math.max(0, Math.min(255, Math.round(g * (1 + amt))))
  b = Math.max(0, Math.min(255, Math.round(b * (1 + amt))))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

type VisionBox = {
  id: string
  x: number
  y: number
  w: number
  h: number
  conf: number
  appear: number
  label: string
  target?: boolean
}

const VISION_BOXES: VisionBox[] = [
  {
    id: 'A-1103',
    x: 310,
    y: 120,
    w: 130,
    h: 100,
    conf: 0.91,
    appear: 0.05,
    label: 'CARTON',
  },
  {
    id: 'A-1106',
    x: 710,
    y: 100,
    w: 90,
    h: 120,
    conf: 0.88,
    appear: 0.12,
    label: 'CARTON',
  },
  {
    id: 'B-2202',
    x: 220,
    y: 250,
    w: 100,
    h: 130,
    conf: 0.97,
    appear: 0.2,
    label: 'TARGET ▸ B-2202',
    target: true,
  },
  {
    id: 'B-2205',
    x: 570,
    y: 270,
    w: 110,
    h: 110,
    conf: 0.83,
    appear: 0.3,
    label: 'CARTON',
  },
  {
    id: 'C-3302',
    x: 190,
    y: 400,
    w: 130,
    h: 110,
    conf: 0.86,
    appear: 0.4,
    label: 'CARTON',
  },
  {
    id: 'C-3306',
    x: 700,
    y: 400,
    w: 100,
    h: 110,
    conf: 0.8,
    appear: 0.5,
    label: 'CARTON',
  },
]

function VisionBoxes({ progress, phase }: { progress: number; phase: Phase }) {
  return (
    <g>
      {VISION_BOXES.map((b) => {
        const localP = Math.max(0, Math.min(1, (progress - b.appear) / 0.12))
        if (localP <= 0) return null
        const isTarget = b.target && phase !== 'scan'
        const colorMain = b.target ? AMBER : CYAN
        const opa = isTarget ? 1 : Math.min(1, localP)
        const labelWidth = b.label.length * 6 + 64
        return (
          <g key={b.id} opacity={opa}>
            <BBox
              x={b.x - 4}
              y={b.y - 4}
              w={b.w + 8}
              h={b.h + 8}
              color={colorMain}
              pulse={Boolean(isTarget)}
            />
            <g transform={`translate(${b.x - 4}, ${b.y - 22})`}>
              <rect
                x='0'
                y='0'
                width={labelWidth}
                height='18'
                fill='rgba(0,0,0,0.7)'
                stroke={colorMain}
                strokeWidth='0.5'
              />
              <text
                x='6'
                y='12'
                fontFamily='"JetBrains Mono", monospace'
                fontSize='10'
                fill={colorMain}
              >
                {b.label}
              </text>
              <text
                x={b.label.length * 6 + 14}
                y='12'
                fontFamily='"JetBrains Mono", monospace'
                fontSize='10'
                fill='rgba(255,255,255,0.6)'
              >
                {(b.conf * 100).toFixed(0)}%
              </text>
            </g>
          </g>
        )
      })}
    </g>
  )
}

function BBox({
  x,
  y,
  w,
  h,
  color,
  pulse,
}: {
  x: number
  y: number
  w: number
  h: number
  color: string
  pulse: boolean
}) {
  const len = 18
  return (
    <g>
      {pulse && (
        <rect x={x} y={y} width={w} height={h} fill={color} opacity='0.08' />
      )}
      <g stroke={color} strokeWidth='2' fill='none' strokeLinecap='square'>
        <path d={`M ${x} ${y + len} L ${x} ${y} L ${x + len} ${y}`} />
        <path
          d={`M ${x + w - len} ${y} L ${x + w} ${y} L ${x + w} ${y + len}`}
        />
        <path
          d={`M ${x + w} ${y + h - len} L ${x + w} ${y + h} L ${x + w - len} ${
            y + h
          }`}
        />
        <path
          d={`M ${x + len} ${y + h} L ${x} ${y + h} L ${x} ${y + h - len}`}
        />
      </g>
    </g>
  )
}

function ScanSweep({ progress }: { progress: number }) {
  const y = 40 + Easing.easeInOutCubic(progress) * 480
  return (
    <g>
      <defs>
        <linearGradient id='scanGrad' x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor={CYAN} stopOpacity='0' />
          <stop offset='0.5' stopColor={CYAN} stopOpacity='0.35' />
          <stop offset='1' stopColor={CYAN} stopOpacity='0' />
        </linearGradient>
      </defs>
      <rect x='0' y={y - 40} width='1100' height='80' fill='url(#scanGrad)' />
      <line
        x1='0'
        y1={y}
        x2='1100'
        y2={y}
        stroke={CYAN}
        strokeWidth='1'
        opacity='0.9'
      />
    </g>
  )
}

function HudReticle() {
  return (
    <g transform='translate(550, 310)'>
      <g opacity='0.75'>
        <line x1='-8' y1='0' x2='8' y2='0' stroke={FG} strokeWidth='1' />
        <line x1='0' y1='-8' x2='0' y2='8' stroke={FG} strokeWidth='1' />
        <circle cx='0' cy='0' r='2' fill={FG} />
      </g>
    </g>
  )
}

function HudCorners() {
  const corners: Array<[number, number, number]> = [
    [10, 10, 0],
    [1090, 10, 90],
    [1090, 610, 180],
    [10, 610, 270],
  ]
  return (
    <g stroke='rgba(242,239,230,0.4)' strokeWidth='1.2' fill='none'>
      {corners.map(([cx, cy, rot], i) => (
        <g key={i} transform={`translate(${cx}, ${cy}) rotate(${rot})`}>
          <path d='M 0 20 L 0 0 L 20 0' />
        </g>
      ))}
    </g>
  )
}

function MetricRow({
  label,
  value,
  y,
  accent,
}: {
  label: string
  value: string
  y: number
  accent?: string
}) {
  return (
    <g transform={`translate(0, ${y})`}>
      <text
        x='0'
        y='0'
        fontFamily='"JetBrains Mono", monospace'
        fontSize='10'
        fill='rgba(242,239,230,0.4)'
        letterSpacing='0.12em'
      >
        {label}
      </text>
      <text
        x='0'
        y='26'
        fontFamily='Inter, sans-serif'
        fontSize='22'
        fontWeight='500'
        fill={accent ?? FG}
        letterSpacing='-0.005em'
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </text>
    </g>
  )
}

// Created and developed by Jai Singh
