// Created and developed by Jai Singh
/**
 * Scene 03 · EXECUTION
 *
 * Three-column layout showing the closing loop of a pick:
 *  · Left  — Mini POV of the highlighted SKU + instruction overlay
 *  · Mid   — Operator dialog transcript (AI ↔ human, staggered reveal)
 *  · Right — WMS execution trace with action rows + KPI strip
 */

const FG = '#f2efe6'
const AMBER = 'oklch(0.82 0.14 70)'
const CYAN = 'oklch(0.82 0.13 220)'
const GREEN = 'oklch(0.78 0.17 140)'

type Who = 'ai' | 'op'

type Message = {
  at: number
  who: Who
  text: string
}

type Action = {
  at: number
  code: string
  label: string
  status: 'ok' | 'run' | 'queued'
}

const DIALOG_MESSAGES: Message[] = [
  {
    at: 0.02,
    who: 'ai',
    text: 'Task TSK-4827. 4 units of SKU B-2202 for pallet PLT-19. Look to shelf B, bay 22.',
  },
  {
    at: 0.12,
    who: 'op',
    text: 'Walking up. I see three similar cartons — which one?',
  },
  {
    at: 0.24,
    who: 'ai',
    text: 'Middle shelf, second from left. Highlighting it now in your view. Lot L-9821.',
  },
  { at: 0.38, who: 'op', text: 'Got it. Scanning the label.' },
  {
    at: 0.5,
    who: 'ai',
    text: "Verified. Pick 4, place on cart lane 2. I've already reserved stock in the WMS.",
  },
  { at: 0.66, who: 'op', text: 'Confirmed, 4 on cart.' },
  {
    at: 0.8,
    who: 'ai',
    text: 'Nice. Posted to WMS. Next task routes you to aisle 11 — 42 m, 35 s walk.',
  },
]

const WMS_ACTIONS: Action[] = [
  {
    at: 0.04,
    code: 'T+00.0s',
    label: 'GET /tasks/next → TSK-4827',
    status: 'ok',
  },
  {
    at: 0.18,
    code: 'T+02.1s',
    label: 'VISION.detect(shelf_B22) → 6 obj',
    status: 'ok',
  },
  {
    at: 0.3,
    code: 'T+03.8s',
    label: 'MATCH sku=B-2202 · conf=0.97',
    status: 'ok',
  },
  {
    at: 0.44,
    code: 'T+05.6s',
    label: 'LOCK target · overlay to user HUD',
    status: 'ok',
  },
  {
    at: 0.56,
    code: 'T+07.4s',
    label: 'OCR label · lot=L-9821 · qty=4',
    status: 'ok',
  },
  {
    at: 0.7,
    code: 'T+09.9s',
    label: 'POST /wms/reserve · 4 × B-2202',
    status: 'ok',
  },
  {
    at: 0.82,
    code: 'T+11.8s',
    label: 'POST /wms/commit · pallet=PLT-19',
    status: 'ok',
  },
  {
    at: 0.92,
    code: 'T+12.6s',
    label: 'ROUTE → aisle 11 · bay 07',
    status: 'run',
  },
]

type ExecuteStageProps = {
  time: number
}

export function ExecuteStage({ time }: ExecuteStageProps) {
  if (time < 17.5 || time > 30.0) return null

  const p = Math.max(0, Math.min(1, (time - 18.0) / 10.0))

  let op = 1
  if (time < 18.0) op = Math.max(0, 1 - (18.0 - time) / 0.5)
  if (time > 28.5) op = Math.max(0, 1 - (time - 28.5) / 1.5)

  return (
    <g opacity={op}>
      {/* Left peripheral — mini POV + HUD instruction */}
      <g transform='translate(64, 200)'>
        <rect
          x='0'
          y='0'
          width='560'
          height='620'
          rx='12'
          fill='rgba(14,16,20,0.96)'
          stroke='rgba(242,239,230,0.1)'
        />
        <g transform='translate(24, 28)'>
          <text
            x='0'
            y='0'
            fontFamily='"JetBrains Mono", monospace'
            fontSize='11'
            fill='rgba(242,239,230,0.55)'
            letterSpacing='0.14em'
          >
            OPERATOR VIEW · GLASSES
          </text>
        </g>
        <line x1='0' y1='54' x2='560' y2='54' stroke='rgba(242,239,230,0.08)' />
        <g transform='translate(24, 76)'>
          <MiniWarehouse highlighted={p > 0.1} />
        </g>

        {/* HUD instruction overlay */}
        <g transform='translate(24, 450)'>
          <rect
            x='0'
            y='0'
            width='512'
            height='130'
            rx='8'
            fill='oklch(0.82 0.14 70 / 0.1)'
            stroke='oklch(0.82 0.14 70 / 0.5)'
          />
          <text
            x='18'
            y='24'
            fontFamily='"JetBrains Mono", monospace'
            fontSize='10'
            fill={AMBER}
            letterSpacing='0.14em'
          >
            INSTRUCTION · HUD
          </text>
          <text
            x='18'
            y='60'
            fontFamily='Inter, sans-serif'
            fontSize='24'
            fontWeight='600'
            fill={FG}
          >
            Pick 4 from B-2202
          </text>
          <text
            x='18'
            y='92'
            fontFamily='Inter, sans-serif'
            fontSize='15'
            fill='rgba(242,239,230,0.75)'
          >
            Middle shelf · 2nd from left · Lot L-9821
          </text>
          <text
            x='18'
            y='116'
            fontFamily='"JetBrains Mono", monospace'
            fontSize='11'
            fill='rgba(242,239,230,0.45)'
          >
            Place on cart lane 2 when done
          </text>
        </g>
      </g>

      {/* Center — dialog transcript */}
      <g transform='translate(660, 200)'>
        <OperatorDialog messages={DIALOG_MESSAGES} progress={p} />
      </g>

      {/* Right — WMS execution trace */}
      <g transform='translate(1320, 200)'>
        <SystemPanel actions={WMS_ACTIONS} progress={p} />
      </g>
    </g>
  )
}

function MiniWarehouse({ highlighted }: { highlighted: boolean }) {
  const mini: Array<
    | [number, number, number, number, string]
    | [number, number, number, number, string, boolean]
  > = [
    [20, 64, 70, 90, '#b28a5a'],
    [100, 64, 70, 90, '#c7a06b'],
    [180, 64, 90, 90, '#8c6a42'],
    [280, 64, 70, 90, '#b28a5a'],
    [360, 64, 90, 90, '#a07e51'],
    [20, 164, 80, 90, '#7a5a3a'],
    [110, 164, 70, 90, '#b28a5a', true],
    [190, 164, 90, 90, '#c7a06b'],
    [290, 164, 80, 90, '#a07e51'],
    [380, 164, 80, 90, '#8c6a42'],
    [20, 264, 80, 60, '#3e4b5a'],
    [110, 264, 90, 60, '#4a5a6c'],
    [210, 264, 70, 60, '#3e4b5a'],
    [290, 264, 90, 60, '#4a5a6c'],
    [390, 264, 80, 60, '#3e4b5a'],
  ]

  return (
    <svg
      x='0'
      y='0'
      width='512'
      height='350'
      viewBox='0 0 512 350'
      style={{ overflow: 'visible' }}
    >
      <rect x='0' y='0' width='512' height='350' fill='#0d1013' rx='6' />
      {[60, 160, 260].map((y) => (
        <rect key={y} x='10' y={y} width='492' height='4' fill='#3a3f44' />
      ))}
      {mini.map((row, i) => {
        const [x, y, w, h, c, tgt] = row
        return (
          <g key={i}>
            <rect x={x} y={y} width={w} height={h} fill={c} />
            <rect
              x={x + 4}
              y={y + h - 14}
              width={w - 8}
              height='10'
              fill='rgba(255,255,255,0.75)'
            />
            {tgt && highlighted && (
              <g>
                <rect
                  x={x - 4}
                  y={y - 4}
                  width={w + 8}
                  height={h + 8}
                  fill='none'
                  stroke={AMBER}
                  strokeWidth='2'
                >
                  <animate
                    attributeName='opacity'
                    values='0.4;1;0.4'
                    dur='1.2s'
                    repeatCount='indefinite'
                  />
                </rect>
                <g transform={`translate(${x - 4}, ${y - 22})`}>
                  <rect x='0' y='0' width='90' height='16' fill={AMBER} />
                  <text
                    x='6'
                    y='11'
                    fontFamily='"JetBrains Mono", monospace'
                    fontSize='10'
                    fill='#0d1013'
                    fontWeight='600'
                  >
                    ▸ B-2202
                  </text>
                </g>
              </g>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function OperatorDialog({
  messages,
  progress,
}: {
  messages: Message[]
  progress: number
}) {
  return (
    <g>
      <rect
        x='0'
        y='0'
        width='640'
        height='620'
        rx='12'
        fill='rgba(18,20,24,0.96)'
        stroke='rgba(242,239,230,0.12)'
        strokeWidth='1'
      />
      <g transform='translate(24, 26)'>
        <circle cx='6' cy='2' r='4' fill={GREEN} />
        <text
          x='20'
          y='6'
          fontFamily='"JetBrains Mono", monospace'
          fontSize='11'
          fill='rgba(242,239,230,0.7)'
          letterSpacing='0.1em'
        >
          LIVE · OPERATOR CHANNEL
        </text>
        <text
          x='480'
          y='6'
          fontFamily='"JetBrains Mono", monospace'
          fontSize='11'
          fill='rgba(242,239,230,0.4)'
          letterSpacing='0.1em'
        >
          ZONE B · AISLE 22
        </text>
      </g>
      <line x1='0' y1='56' x2='640' y2='56' stroke='rgba(242,239,230,0.08)' />

      <g transform='translate(0, 74)'>
        {messages.map((m, i) => (
          <DialogBubble
            key={i}
            message={m}
            y={i * 86}
            visible={progress >= m.at}
            entryP={Math.max(0, Math.min(1, (progress - m.at) / 0.08))}
          />
        ))}
      </g>
    </g>
  )
}

function DialogBubble({
  message,
  y,
  visible,
  entryP,
}: {
  message: Message
  y: number
  visible: boolean
  entryP: number
}) {
  if (!visible) return null
  const isAI = message.who === 'ai'
  const pad = 16
  const x = isAI ? 24 : 280
  const w = isAI ? 360 : 336
  const bg = isAI ? 'rgba(40,48,58,0.9)' : 'oklch(0.82 0.13 220 / 0.12)'
  const border = isAI ? 'rgba(242,239,230,0.12)' : 'oklch(0.82 0.13 220 / 0.4)'
  const labelColor = isAI ? 'rgba(242,239,230,0.5)' : CYAN
  const label = isAI ? 'OMNIFRAME · AI' : 'OPERATOR · M. VELEZ'

  const tY = (1 - entryP) * 10
  const lines = wrapText(message.text, 44)

  return (
    <g transform={`translate(${x}, ${y + tY})`} opacity={entryP}>
      <rect
        x='0'
        y='0'
        width={w}
        height={lines.length * 18 + 42}
        rx='8'
        fill={bg}
        stroke={border}
        strokeWidth='1'
      />
      <text
        x={pad}
        y='20'
        fontFamily='"JetBrains Mono", monospace'
        fontSize='9.5'
        fill={labelColor}
        letterSpacing='0.12em'
      >
        {label}
      </text>
      {lines.map((ln, i) => (
        <text
          key={i}
          x={pad}
          y={40 + i * 18}
          fontFamily='Inter, sans-serif'
          fontSize='14'
          fill={FG}
          letterSpacing='-0.005em'
        >
          {ln}
        </text>
      ))}
    </g>
  )
}

function wrapText(text: string, maxChars: number) {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars) {
      lines.push(line)
      line = w
    } else {
      line = (line + ' ' + w).trim()
    }
  }
  if (line) lines.push(line)
  return lines
}

function SystemPanel({
  actions,
  progress,
}: {
  actions: Action[]
  progress: number
}) {
  return (
    <g>
      <rect
        x='0'
        y='0'
        width='560'
        height='620'
        rx='12'
        fill='rgba(14,16,20,0.96)'
        stroke='rgba(242,239,230,0.1)'
        strokeWidth='1'
      />
      <g transform='translate(24, 26)'>
        <text
          x='0'
          y='6'
          fontFamily='"JetBrains Mono", monospace'
          fontSize='11'
          fill='rgba(242,239,230,0.55)'
          letterSpacing='0.14em'
        >
          WMS · EXECUTION TRACE
        </text>
        <text
          x='420'
          y='6'
          fontFamily='"JetBrains Mono", monospace'
          fontSize='11'
          fill='rgba(242,239,230,0.35)'
          letterSpacing='0.1em'
        >
          TSK-4827
        </text>
      </g>
      <line x1='0' y1='56' x2='560' y2='56' stroke='rgba(242,239,230,0.08)' />

      <g transform='translate(0, 76)'>
        {actions.map((a, i) => {
          const visible = progress >= a.at
          const entryP = Math.max(0, Math.min(1, (progress - a.at) / 0.06))
          return (
            <ActionRow
              key={i}
              y={i * 52}
              action={a}
              visible={visible}
              entryP={entryP}
            />
          )
        })}
      </g>

      {/* KPI strip */}
      <g transform='translate(24, 540)'>
        <KPI label='SLA' value='00:01:42' x={0} />
        <KPI label='ACCURACY' value='99.8%' valueColor={CYAN} x={140} />
        <KPI label='PICKS / HR' value='214' x={300} />
        <g transform='translate(440, 0)'>
          <text
            x='0'
            y='0'
            fontFamily='"JetBrains Mono", monospace'
            fontSize='10'
            fill='rgba(242,239,230,0.4)'
            letterSpacing='0.1em'
          >
            STATUS
          </text>
          <g transform='translate(0, 12)'>
            <circle cx='6' cy='6' r='4' fill={GREEN} />
            <text
              x='16'
              y='10'
              fontFamily='Inter, sans-serif'
              fontSize='15'
              fontWeight='600'
              fill='oklch(0.82 0.13 140)'
            >
              NOMINAL
            </text>
          </g>
        </g>
      </g>
    </g>
  )
}

function KPI({
  label,
  value,
  valueColor = FG,
  x,
}: {
  label: string
  value: string
  valueColor?: string
  x: number
}) {
  return (
    <g transform={`translate(${x}, 0)`}>
      <text
        x='0'
        y='0'
        fontFamily='"JetBrains Mono", monospace'
        fontSize='10'
        fill='rgba(242,239,230,0.4)'
        letterSpacing='0.1em'
      >
        {label}
      </text>
      <text
        x='0'
        y='20'
        fontFamily='Inter, sans-serif'
        fontSize='22'
        fontWeight='600'
        fill={valueColor}
      >
        {value}
      </text>
    </g>
  )
}

function ActionRow({
  y,
  action,
  visible,
  entryP,
}: {
  y: number
  action: Action
  visible: boolean
  entryP: number
}) {
  if (!visible) return null
  const tX = (1 - entryP) * 12
  const statusColor = {
    ok: 'oklch(0.82 0.14 140)',
    run: 'oklch(0.82 0.14 70)',
    queued: 'rgba(242,239,230,0.35)',
  }[action.status]
  const statusText = { ok: 'OK', run: 'RUN', queued: 'QUEUED' }[action.status]

  return (
    <g transform={`translate(${24 + tX}, ${y})`} opacity={entryP}>
      <circle cx='4' cy='14' r='3' fill={statusColor} />
      <line
        x1='4'
        y1='18'
        x2='4'
        y2='48'
        stroke='rgba(242,239,230,0.14)'
        strokeWidth='1'
      />
      <text
        x='20'
        y='10'
        fontFamily='"JetBrains Mono", monospace'
        fontSize='9.5'
        fill='rgba(242,239,230,0.5)'
        letterSpacing='0.1em'
      >
        {action.code}
      </text>
      <text
        x='20'
        y='32'
        fontFamily='Inter, sans-serif'
        fontSize='15'
        fill={FG}
        fontWeight='500'
      >
        {action.label}
      </text>
      <g transform='translate(440, 14)'>
        <rect
          x='0'
          y='0'
          width='64'
          height='18'
          rx='3'
          fill='rgba(0,0,0,0.3)'
          stroke={statusColor}
          strokeWidth='0.8'
        />
        <text
          x='32'
          y='12'
          textAnchor='middle'
          fontFamily='"JetBrains Mono", monospace'
          fontSize='10'
          fill={statusColor}
          letterSpacing='0.1em'
        >
          {statusText}
        </text>
      </g>
    </g>
  )
}

// Created and developed by Jai Singh
