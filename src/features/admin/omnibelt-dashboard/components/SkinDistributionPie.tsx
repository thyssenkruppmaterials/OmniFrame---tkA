// Created and developed by Jai Singh
/**
 * SkinDistributionPie — pie chart of skin choice across users.
 *
 * Takes a pre-aggregated `distribution: Record<skinKey, count>`
 * (NULL skin is bucketed as `inherit`). RLS may restrict cross-
 * user reads — surfaces a helper line when the distribution is
 * empty.
 */
import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const SKIN_COLORS: Record<string, string> = {
  pill: '#3b82f6',
  orb: '#8b5cf6',
  skystrip: '#06b6d4',
  inherit: '#94a3b8',
}

interface SkinDistributionPieProps {
  distribution: Record<string, number>
  isLoading?: boolean
  height?: number
}

export function SkinDistributionPie({
  distribution,
  isLoading,
  height = 200,
}: SkinDistributionPieProps) {
  const data = useMemo(
    () =>
      Object.entries(distribution).map(([name, value]) => ({
        name,
        value,
        color: SKIN_COLORS[name] ?? '#9ca3af',
      })),
    [distribution]
  )

  const total = data.reduce((sum, d) => sum + d.value, 0)

  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='text-base'>Skin distribution</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className='h-40 w-full rounded' />
        ) : total === 0 ? (
          <p className='text-muted-foreground text-xs'>
            No skin telemetry yet (or RLS scopes prefs to self-only — see
            deviations).
          </p>
        ) : (
          <div style={{ height }}>
            <ResponsiveContainer width='100%' height='100%'>
              <PieChart>
                <Pie
                  data={data}
                  dataKey='value'
                  nameKey='name'
                  innerRadius='40%'
                  outerRadius='80%'
                  paddingAngle={2}
                  isAnimationActive={false}
                  label={({ name, percent }) =>
                    `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                  }
                >
                  {data.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [String(value), String(name)]}
                  contentStyle={{ fontSize: 11 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Created and developed by Jai Singh
