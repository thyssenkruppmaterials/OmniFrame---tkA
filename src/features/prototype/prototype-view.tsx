// Created and developed by Jai Singh
import { Stage, useStageTime } from '@/features/prototype/lib/stage'
import { ExecuteStage } from '@/features/prototype/scenes/execute-scene'
import { GlassesStage } from '@/features/prototype/scenes/glasses-scene'
import { WarehouseStage } from '@/features/prototype/scenes/warehouse-scene'

/**
 * OmniFrame XR-G2 · Animated concept prototype
 *
 * Scene layout (seconds):
 *   0.0 –  3.5   Intro + exploded glasses assemble
 *   3.5 –  9.0   Camera module explodes, technical callouts reveal
 *   9.0 – 10.0   Camera collapses, stage transition
 *  10.0 – 18.0   Warehouse POV — scan, lock on target SKU B-2202
 *  18.0 – 28.0   Operator dialog + WMS execution trace
 *  28.0 – 30.0   Hold ending frame, then loop
 */

export default function PrototypeView() {
  return (
    <div
      className='fixed inset-0'
      data-testid='prototype-view'
      style={{ background: '#0a0a0b', color: '#f2efe6' }}
    >
      <Stage
        width={1920}
        height={1080}
        duration={30}
        background='oklch(0.18 0.01 60)'
        persistKey='omniframe-xr-g2'
        autoplay
        loop
      >
        <svg
          width='1920'
          height='1080'
          viewBox='0 0 1920 1080'
          style={{
            position: 'absolute',
            inset: 0,
            display: 'block',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          <defs>
            <pattern
              id='dotgrid'
              x='0'
              y='0'
              width='80'
              height='80'
              patternUnits='userSpaceOnUse'
            >
              <circle cx='1' cy='1' r='0.8' fill='rgba(242,239,230,0.05)' />
            </pattern>
          </defs>
          <rect x='0' y='0' width='1920' height='1080' fill='url(#dotgrid)' />

          <Timeline />
        </svg>
      </Stage>
    </div>
  )
}

function Timeline() {
  const time = useStageTime()
  return (
    <>
      <SceneChrome time={time} />
      <GlassesStage time={time} />
      <WarehouseStage time={time} />
      <ExecuteStage time={time} />
      <TitleBar />
    </>
  )
}

type SceneLabel = {
  t0: number
  t1: number
  code: string
  title: string
}

const SCENE_LABELS: SceneLabel[] = [
  {
    t0: 0.0,
    t1: 9.0,
    code: '01 / HARDWARE',
    title: 'Exploded assembly · camera stack',
  },
  {
    t0: 9.0,
    t1: 18.0,
    code: '02 / PERCEPTION',
    title: 'On-head vision AI · scan + lock',
  },
  {
    t0: 18.0,
    t1: 30.0,
    code: '03 / EXECUTION',
    title: 'Operator dialog · WMS write-through',
  },
]

function SceneChrome({ time }: { time: number }) {
  const active =
    SCENE_LABELS.find((l) => time >= l.t0 && time <= l.t1) ?? SCENE_LABELS[0]
  const segP = (time - active.t0) / Math.max(0.0001, active.t1 - active.t0)
  const fade = Math.min(1, Math.min(segP / 0.06, (1 - segP) / 0.06 + 1))

  return (
    <g>
      {/* corner ticks */}
      <g
        opacity='0.4'
        stroke='rgba(242,239,230,0.3)'
        strokeWidth='1'
        fill='none'
      >
        <path d='M 40 40 L 40 80 M 40 40 L 80 40' />
        <path d='M 1880 40 L 1880 80 M 1880 40 L 1840 40' />
        <path d='M 40 1040 L 40 1000 M 40 1040 L 80 1040' />
        <path d='M 1880 1040 L 1880 1000 M 1880 1040 L 1840 1040' />
      </g>

      {/* scene label */}
      <g transform='translate(64, 998)' opacity={Math.max(0.4, fade)}>
        <text
          x='0'
          y='0'
          fontFamily='"JetBrains Mono", monospace'
          fontSize='13'
          fill='rgba(242,239,230,0.5)'
          letterSpacing='0.18em'
        >
          {active.code}
        </text>
        <text
          x='0'
          y='22'
          fontFamily='Inter, sans-serif'
          fontSize='18'
          fontWeight='500'
          fill='#f2efe6'
          letterSpacing='-0.005em'
        >
          {active.title}
        </text>
      </g>
    </g>
  )
}

function TitleBar() {
  return (
    <g>
      <g transform='translate(64, 56)'>
        <text
          x='0'
          y='0'
          fontFamily='"JetBrains Mono", monospace'
          fontSize='12'
          fill='rgba(242,239,230,0.55)'
          letterSpacing='0.22em'
        >
          OMNIFRAME · XR-G2 · CONCEPT SPEC
        </text>
        <text
          x='0'
          y='40'
          fontFamily='Inter, sans-serif'
          fontSize='36'
          fontWeight='600'
          fill='#f2efe6'
          letterSpacing='-0.02em'
        >
          Warehouse-grade XR glasses for hands-free picking
        </text>
      </g>

      <g transform='translate(1880, 56)'>
        <text
          x='0'
          y='0'
          textAnchor='end'
          fontFamily='"JetBrains Mono", monospace'
          fontSize='12'
          fill='rgba(242,239,230,0.4)'
          letterSpacing='0.18em'
        >
          DOC · CNF-042 · REV 03
        </text>
        <text
          x='0'
          y='20'
          textAnchor='end'
          fontFamily='"JetBrains Mono", monospace'
          fontSize='12'
          fill='rgba(242,239,230,0.4)'
          letterSpacing='0.18em'
        >
          2026 · 04 · 23
        </text>
        <g transform='translate(-4, 34)'>
          <circle cx='0' cy='0' r='4' fill='oklch(0.78 0.17 140)'>
            <animate
              attributeName='opacity'
              values='0.4;1;0.4'
              dur='1.6s'
              repeatCount='indefinite'
            />
          </circle>
          <text
            x='-12'
            y='4'
            textAnchor='end'
            fontFamily='"JetBrains Mono", monospace'
            fontSize='11'
            fill='oklch(0.82 0.13 140)'
            letterSpacing='0.12em'
          >
            REC · PLAYING
          </text>
        </g>
      </g>
    </g>
  )
}

// Created and developed by Jai Singh
