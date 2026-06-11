// Created and developed by Jai Singh
import { Easing } from '@/features/prototype/lib/anim'

/**
 * Technical callout with anchor dot → leader line → label block.
 *
 * The leader draws from (x, y) to (lx, ly) over the first ~70% of `progress`
 * (eased out-cubic). Once fully drawn, a short horizontal extension renders
 * and the label block fades in.
 */
type CalloutProps = {
  x: number
  y: number
  lx: number
  ly: number
  align?: 'left' | 'right'
  code: string
  title: string
  spec?: string[]
  accent?: string
  progress?: number
}

export function Callout({
  x,
  y,
  lx,
  ly,
  align = 'left',
  code,
  title,
  spec = [],
  accent = 'oklch(0.82 0.13 220)',
  progress = 1,
}: CalloutProps) {
  const p = Math.max(0, Math.min(1, progress))
  const lineLen = 24
  const labelW = 220

  const drawP = Easing.easeOutCubic(Math.min(1, p * 1.4))
  const textP = Math.max(0, (p - 0.35) / 0.65)

  const dx = lx - x
  const dy = ly - y
  const midX = x + dx * drawP
  const midY = y + dy * drawP

  return (
    <g style={{ pointerEvents: 'none' }}>
      <circle cx={x} cy={y} r='2' fill={accent} />
      <circle
        cx={x}
        cy={y}
        r='6'
        fill='none'
        stroke={accent}
        strokeWidth='0.6'
        opacity={0.4}
      />
      <line
        x1={x}
        y1={y}
        x2={midX}
        y2={midY}
        stroke={accent}
        strokeWidth='0.8'
      />
      {drawP > 0.99 && (
        <line
          x1={lx}
          y1={ly}
          x2={align === 'left' ? lx + lineLen : lx - lineLen}
          y2={ly}
          stroke={accent}
          strokeWidth='0.8'
        />
      )}
      <g
        transform={`translate(${
          align === 'left' ? lx + lineLen + 6 : lx - lineLen - 6 - labelW
        }, ${ly - 12})`}
        opacity={textP}
      >
        <text
          x='0'
          y='0'
          fill={accent}
          fontFamily='"JetBrains Mono", monospace'
          fontSize='10'
          letterSpacing='0.1em'
        >
          {code}
        </text>
        <text
          x='0'
          y='16'
          fill='#f2efe6'
          fontFamily='Inter, sans-serif'
          fontSize='15'
          fontWeight='600'
          letterSpacing='-0.01em'
        >
          {title}
        </text>
        {spec.map((s, i) => (
          <text
            key={i}
            x='0'
            y={34 + i * 14}
            fill='rgba(242,239,230,0.55)'
            fontFamily='"JetBrains Mono", monospace'
            fontSize='10.5'
            letterSpacing='0.02em'
          >
            {s}
          </text>
        ))}
      </g>
    </g>
  )
}

// Created and developed by Jai Singh
