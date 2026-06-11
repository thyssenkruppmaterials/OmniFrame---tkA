// Created and developed by Jai Singh
import type { ReactElement } from 'react'
import { Easing, lerp } from '@/features/prototype/lib/anim'
import { Callout } from '@/features/prototype/scenes/callout'

/**
 * Scene 01 · HARDWARE
 *
 * Exploded-isometric render of the OmniFrame XR-G2 glasses. Arms slide in
 * from left/right, the frame descends, and the right-front camera module
 * separates into its 8 optical + electro layers along the optical axis.
 * Technical callouts fan out to label each layer once the explosion holds.
 */

const FG = '#f2efe6'
const FAINT = 'rgba(242,239,230,0.14)'
const CYAN = 'oklch(0.82 0.13 220)'
const AMBER = 'oklch(0.82 0.14 70)'
const SHELL = '#1c1c1e'
const SHELL_HI = '#2a2a2c'
const GLASS = 'oklch(0.45 0.05 220)'

type GlassesStageProps = {
  time: number
}

export function GlassesStage({ time }: GlassesStageProps) {
  const assemble = Math.max(0, Math.min(1, (time - 0.4) / 2.8))
  let explode = 0
  if (time >= 3.5 && time <= 5.5) {
    explode = Easing.easeOutCubic((time - 3.5) / 2.0)
  } else if (time > 5.5 && time <= 8.5) {
    explode = 1
  } else if (time > 8.5 && time <= 9.0) {
    explode = 1 - Easing.easeInCubic((time - 8.5) / 0.5)
  }

  let opacity = 1
  if (time > 9.0) opacity = Math.max(0, 1 - (time - 9.0) / 1.0)
  if (time > 10.0) return null

  const cx = 960
  const cy = 540
  const camAnchorX = cx + 220
  const camAnchorY = cy - 6
  const axis = { dx: 160, dy: -110 }
  const layerPos = (k: number) => ({
    x: camAnchorX + axis.dx * explode * (k / 5.4),
    y: camAnchorY + axis.dy * explode * (k / 5.4),
  })
  const calloutP = (offset: number) =>
    Math.max(0, Math.min(1, (time - (4.2 + offset)) / 0.5))

  return (
    <g opacity={opacity}>
      <GlassesAssembly p={assemble} explodeCam={explode} cx={cx} cy={cy} />

      {explode > 0.4 && (
        <g>
          <Callout
            {...layerPos(0.0)}
            lx={camAnchorX + axis.dx * 1.2 + 60}
            ly={camAnchorY + axis.dy * 1.2 - 60}
            code='C-01 · BEZEL'
            title='Machined aluminum bezel'
            spec={['Ø 42 mm · anodized', 'Gorilla Glass 3 cover']}
            progress={calloutP(0)}
            align='left'
          />
          <Callout
            {...layerPos(1.7)}
            lx={camAnchorX + axis.dx * 1.1 + 60}
            ly={camAnchorY + axis.dy * 1.1}
            code='C-03 · IR CUT'
            title='IR-cut filter'
            spec={['650 nm cut', 'Stabilizes low-lux']}
            progress={calloutP(0.4)}
            align='left'
          />
          <Callout
            {...layerPos(3.1)}
            lx={camAnchorX + axis.dx + 60}
            ly={camAnchorY + axis.dy + 80}
            code='C-05 · APERTURE'
            title='Adaptive iris'
            spec={['f/1.8 – f/8', '6-blade · sub-ms']}
            progress={calloutP(0.8)}
            accent={AMBER}
            align='left'
          />
          <Callout
            {...layerPos(4.6)}
            lx={camAnchorX - 360}
            ly={camAnchorY - 220}
            code='C-07 · IMAGER'
            title='12 MP global-shutter CMOS'
            spec={['1/2.3″ · RGB-IR', 'On-sensor HDR merge', '120 fps @ 1080p']}
            progress={calloutP(1.2)}
            align='right'
          />
          <Callout
            {...layerPos(5.4)}
            lx={camAnchorX - 360}
            ly={camAnchorY - 80}
            code='C-08 · NPU'
            title='Edge NPU + flex PCB'
            spec={['7 TOPS · fp16', 'On-device vision', '<40 ms latency']}
            progress={calloutP(1.6)}
            align='right'
          />
        </g>
      )}

      {time >= 6.0 && time <= 9.0 && (
        <g
          transform='translate(64, 880)'
          opacity={
            Math.min(1, (time - 6.0) / 0.5) * Math.min(1, (9.0 - time) / 0.3)
          }
        >
          <text
            x='0'
            y='0'
            fontFamily='"JetBrains Mono", monospace'
            fontSize='11'
            fill='rgba(242,239,230,0.5)'
            letterSpacing='0.2em'
          >
            CAMERA STACK · RIGHT ORBIT
          </text>
          <text
            x='0'
            y='26'
            fontFamily='Inter, sans-serif'
            fontSize='20'
            fontWeight='500'
            fill={FG}
            letterSpacing='-0.01em'
          >
            8 optical + electro elements, 9.4 mm deep. The whole module swaps as
            a serviceable cartridge with 3 captive screws.
          </text>
        </g>
      )}
    </g>
  )
}

type AssemblyProps = {
  p: number
  explodeCam: number
  cx: number
  cy: number
}

function GlassesAssembly({ p, explodeCam, cx, cy }: AssemblyProps) {
  const leftArmX = lerp(-320, 0, p)
  const rightArmX = lerp(320, 0, p)
  const frameY = lerp(-60, 0, Easing.easeOutCubic(p))
  const frameOp = lerp(0.3, 1, p)

  return (
    <g transform={`translate(${cx}, ${cy})`}>
      <ReferenceGrid />

      <g transform={`translate(${leftArmX}, 0)`} opacity={lerp(0.2, 1, p)}>
        <Arm side='left' />
      </g>
      <g transform={`translate(${rightArmX}, 0)`} opacity={lerp(0.2, 1, p)}>
        <Arm side='right' />
      </g>

      <g transform={`translate(0, ${frameY})`} opacity={frameOp}>
        <Frame />
      </g>

      <g transform='translate(220, -6)'>
        <CameraModule explode={explodeCam} />
      </g>

      <g opacity={lerp(0, 1, p)}>
        <circle cx={-295} cy={18} r='2.2' fill={CYAN} opacity='0.9' />
        <circle cx={-285} cy={22} r='2.2' fill={CYAN} opacity='0.6' />
        <circle cx={-275} cy={26} r='2.2' fill={CYAN} opacity='0.3' />
      </g>
    </g>
  )
}

function ReferenceGrid() {
  const ticks: ReactElement[] = []
  for (let i = -400; i <= 400; i += 40) {
    ticks.push(
      <line
        key={`v${i}`}
        x1={i}
        y1={-4}
        x2={i}
        y2={4}
        stroke={FAINT}
        strokeWidth='1'
      />
    )
  }
  return (
    <g>
      <line x1={-440} y1={0} x2={440} y2={0} stroke={FAINT} strokeWidth='1' />
      <line x1={0} y1={-240} x2={0} y2={240} stroke={FAINT} strokeWidth='1' />
      {ticks}
    </g>
  )
}

function Frame() {
  return (
    <g>
      <path
        d='M -360 -30
           Q -360 -78 -300 -78
           L -60 -78
           Q -30 -78 -6 -64
           L 0 -58
           L 6 -64
           Q 30 -78 60 -78
           L 300 -78
           Q 360 -78 360 -30
           L 360 30
           Q 360 72 305 72
           L 75 72
           Q 45 72 18 58
           L 0 48
           L -18 58
           Q -45 72 -75 72
           L -305 72
           Q -360 72 -360 30 Z'
        fill={SHELL}
        stroke={SHELL_HI}
        strokeWidth='1.5'
      />
      <path
        d='M -340 -60
           Q -330 -70 -300 -70
           L -70 -70
           Q -40 -70 -14 -54
           L 0 -44
           L 14 -54
           Q 40 -70 70 -70
           L 300 -70
           Q 330 -70 340 -60'
        fill='none'
        stroke='rgba(255,255,255,0.08)'
        strokeWidth='1.2'
      />
      <g transform='translate(-200, 0)'>
        <Lens />
      </g>
      <g transform='translate(200, 0)'>
        <Lens />
      </g>
      <rect x={-10} y={-40} width={20} height={4} fill={SHELL_HI} />
      <circle cx={-190} cy={-42} r='2' fill={AMBER} opacity='0.85' />
    </g>
  )
}

function Lens() {
  return (
    <g>
      <ellipse cx='0' cy='0' rx='100' ry='50' fill='#0a0a0b' />
      <ellipse cx='0' cy='0' rx='100' ry='50' fill={GLASS} opacity='0.55' />
      <ellipse
        cx='0'
        cy='0'
        rx='94'
        ry='46'
        fill='none'
        stroke='rgba(255,255,255,0.08)'
        strokeWidth='1'
      />
      <ellipse
        cx='-40'
        cy='-22'
        rx='34'
        ry='10'
        fill='rgba(255,255,255,0.08)'
      />
      <g opacity='0.4'>
        <line
          x1={-80}
          y1={-10}
          x2={80}
          y2={-10}
          stroke={CYAN}
          strokeWidth='0.6'
        />
        <line x1={-80} y1={0} x2={80} y2={0} stroke={CYAN} strokeWidth='0.6' />
        <line
          x1={-80}
          y1={10}
          x2={80}
          y2={10}
          stroke={CYAN}
          strokeWidth='0.6'
        />
      </g>
    </g>
  )
}

function Arm({ side }: { side: 'left' | 'right' }) {
  const sign = side === 'left' ? -1 : 1
  return (
    <g transform={`translate(${sign * 340}, -8) scale(${sign}, 1)`}>
      <path
        d='M 0 -22
           Q 60 -22 90 -14
           L 200 10
           Q 220 16 220 30
           L 220 36
           Q 220 46 200 48
           L 80 48
           Q 20 48 0 30 Z'
        fill={SHELL}
        stroke={SHELL_HI}
        strokeWidth='1.2'
      />
      <circle
        cx='4'
        cy='4'
        r='10'
        fill={SHELL_HI}
        stroke={SHELL}
        strokeWidth='2'
      />
      <circle cx='4' cy='4' r='3' fill={AMBER} opacity='0.85' />
      <rect
        x='70'
        y='14'
        width='90'
        height='6'
        rx='3'
        fill='rgba(255,255,255,0.06)'
      />
    </g>
  )
}

type LayerId =
  | 'bezel'
  | 'front'
  | 'ir'
  | 'mid'
  | 'aperture'
  | 'rear'
  | 'sensor'
  | 'pcb'

function CameraModule({ explode }: { explode: number }) {
  const axis = { dx: 160, dy: -110 }
  const layers: Array<{ id: LayerId; k: number }> = [
    { id: 'bezel', k: 0.0 },
    { id: 'front', k: 0.9 },
    { id: 'ir', k: 1.7 },
    { id: 'mid', k: 2.4 },
    { id: 'aperture', k: 3.1 },
    { id: 'rear', k: 3.8 },
    { id: 'sensor', k: 4.6 },
    { id: 'pcb', k: 5.4 },
  ]
  const ordered = [...layers].reverse()

  return (
    <g>
      {explode > 0.05 && (
        <g opacity={explode * 0.6}>
          <line
            x1={0}
            y1={0}
            x2={axis.dx * explode * 1.1}
            y2={axis.dy * explode * 1.1}
            stroke={CYAN}
            strokeWidth='0.8'
            strokeDasharray='3 3'
          />
        </g>
      )}
      {ordered.map((layer) => {
        const ox = axis.dx * explode * (layer.k / 5.4)
        const oy = axis.dy * explode * (layer.k / 5.4)
        return (
          <g key={layer.id} transform={`translate(${ox}, ${oy})`}>
            <CamLayer id={layer.id} explode={explode} />
          </g>
        )
      })}
    </g>
  )
}

function CamLayer({ id, explode }: { id: LayerId; explode: number }) {
  const r = 28
  switch (id) {
    case 'bezel':
      return (
        <g>
          <circle cx='0' cy='0' r={r + 6} fill={SHELL_HI} />
          <circle
            cx='0'
            cy='0'
            r={r + 6}
            fill='none'
            stroke='rgba(255,255,255,0.15)'
            strokeWidth='0.8'
          />
          <circle cx='0' cy='0' r={r} fill='#050505' />
          <ellipse
            cx='-8'
            cy='-10'
            rx='10'
            ry='4'
            fill='rgba(255,255,255,0.18)'
          />
          <circle
            cx='0'
            cy='0'
            r={r - 4}
            fill='none'
            stroke={CYAN}
            strokeWidth='0.6'
            opacity={explode > 0 ? 0.2 : 0.7}
          />
        </g>
      )
    case 'front':
      return (
        <g>
          <ellipse
            cx='0'
            cy='0'
            rx={r - 2}
            ry={r - 6}
            fill='rgba(120,180,220,0.35)'
            stroke={CYAN}
            strokeWidth='0.6'
          />
          <ellipse
            cx='0'
            cy='0'
            rx={r - 8}
            ry={r - 10}
            fill='rgba(255,255,255,0.08)'
          />
        </g>
      )
    case 'ir':
      return (
        <g>
          <ellipse
            cx='0'
            cy='0'
            rx={r - 4}
            ry={r - 8}
            fill='rgba(220,110,80,0.22)'
            stroke={AMBER}
            strokeWidth='0.5'
          />
          <line
            x1={-(r - 4)}
            y1={0}
            x2={r - 4}
            y2={0}
            stroke={AMBER}
            strokeWidth='0.4'
            opacity='0.6'
          />
        </g>
      )
    case 'mid':
      return (
        <g>
          <ellipse
            cx='0'
            cy='0'
            rx={r - 5}
            ry={r - 9}
            fill='rgba(180,200,220,0.35)'
            stroke={CYAN}
            strokeWidth='0.5'
          />
        </g>
      )
    case 'aperture':
      return (
        <g>
          <circle cx='0' cy='0' r={r - 3} fill='#111' />
          {[0, 60, 120, 180, 240, 300].map((a) => (
            <path
              key={a}
              d={`M 0 0 L ${Math.cos((a * Math.PI) / 180) * (r - 3)} ${
                Math.sin((a * Math.PI) / 180) * (r - 3)
              }`}
              stroke={SHELL_HI}
              strokeWidth='1'
            />
          ))}
          <circle
            cx='0'
            cy='0'
            r='5'
            fill='#050505'
            stroke={CYAN}
            strokeWidth='0.5'
          />
        </g>
      )
    case 'rear':
      return (
        <g>
          <ellipse
            cx='0'
            cy='0'
            rx={r - 6}
            ry={r - 10}
            fill='rgba(160,190,220,0.3)'
            stroke={CYAN}
            strokeWidth='0.5'
          />
        </g>
      )
    case 'sensor':
      return (
        <g>
          <rect
            x={-(r - 4)}
            y={-(r - 12)}
            width={(r - 4) * 2}
            height={(r - 12) * 2}
            fill='#0b1320'
            stroke={CYAN}
            strokeWidth='0.8'
          />
          <g opacity='0.7'>
            {Array.from({ length: 5 }).map((_, i) => (
              <line
                key={`h${i}`}
                x1={-(r - 4)}
                y1={-(r - 12) + i * (((r - 12) * 2) / 4)}
                x2={r - 4}
                y2={-(r - 12) + i * (((r - 12) * 2) / 4)}
                stroke={CYAN}
                strokeWidth='0.3'
              />
            ))}
            {Array.from({ length: 9 }).map((_, i) => (
              <line
                key={`v${i}`}
                x1={-(r - 4) + i * (((r - 4) * 2) / 8)}
                y1={-(r - 12)}
                x2={-(r - 4) + i * (((r - 4) * 2) / 8)}
                y2={r - 12}
                stroke={CYAN}
                strokeWidth='0.3'
              />
            ))}
          </g>
        </g>
      )
    case 'pcb':
      return (
        <g>
          <rect
            x={-(r + 2)}
            y={-(r - 6)}
            width={(r + 2) * 2}
            height={(r - 6) * 2}
            rx='2'
            fill='#1a3a1e'
            stroke='rgba(120,200,140,0.5)'
            strokeWidth='0.6'
          />
          <g opacity='0.7'>
            <line
              x1={-r}
              y1={-8}
              x2={r}
              y2={-8}
              stroke='rgba(180,220,180,0.5)'
              strokeWidth='0.4'
            />
            <line
              x1={-r}
              y1={0}
              x2={r}
              y2={0}
              stroke='rgba(180,220,180,0.5)'
              strokeWidth='0.4'
            />
            <line
              x1={-r}
              y1={8}
              x2={r}
              y2={8}
              stroke='rgba(180,220,180,0.5)'
              strokeWidth='0.4'
            />
          </g>
          <rect x='-6' y='-4' width='12' height='8' fill='#000' />
          <rect x={r - 4} y='-3' width='10' height='6' fill='#c9b46a' />
        </g>
      )
  }
}

// Created and developed by Jai Singh
