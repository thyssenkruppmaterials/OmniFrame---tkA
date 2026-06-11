// Created and developed by Jai Singh
/**
 * UsageSparkline — small per-tool 24h activity line.
 *
 * Accepts a pre-bucketed `hourlyCounts` series so the section can
 * reshape MV rows once (in `bucketByTool`) and feed each sparkline
 * a thin, sorted array.
 */
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

interface UsageSparklineProps {
  toolLabel: string
  hourlyCounts: Array<{ hour: string; count: number }>
  color?: string
  height?: number
}

export function UsageSparkline({
  toolLabel,
  hourlyCounts,
  color = 'var(--primary)',
  height = 60,
}: UsageSparklineProps) {
  if (hourlyCounts.length === 0) {
    return (
      <div className='border-border/40 bg-muted/10 rounded-md border p-2'>
        <div className='text-xs font-medium'>{toolLabel}</div>
        <div
          style={{ height }}
          className='text-muted-foreground flex items-center justify-center text-[11px]'
        >
          No events yet
        </div>
      </div>
    )
  }

  const totalEvents = hourlyCounts.reduce((sum, p) => sum + p.count, 0)

  return (
    <div className='border-border/40 bg-muted/10 rounded-md border p-2'>
      <div className='mb-1 flex items-center justify-between text-xs'>
        <span className='font-medium'>{toolLabel}</span>
        <span className='text-muted-foreground tabular-nums'>
          {totalEvents}
        </span>
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width='100%' height='100%'>
          <AreaChart
            data={hourlyCounts}
            margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient
                id={`spark-${slug(toolLabel)}`}
                x1='0'
                y1='0'
                x2='0'
                y2='1'
              >
                <stop offset='5%' stopColor={color} stopOpacity={0.5} />
                <stop offset='95%' stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey='hour' hide />
            <YAxis hide allowDecimals={false} />
            <Tooltip
              formatter={(value) => [String(value), 'events']}
              labelFormatter={(label) => `Hour ${label}`}
              contentStyle={{ fontSize: 11 }}
            />
            <Area
              type='monotone'
              dataKey='count'
              stroke={color}
              fill={`url(#spark-${slug(toolLabel)})`}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

// Created and developed by Jai Singh
