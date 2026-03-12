/**
 * Performance Chart Component
 * Weekly/monthly trend visualization using Recharts
 * Created: December 20, 2025
 * Updated: December 25, 2025 - Aligned with standard shadcn chart style
 */
import { motion } from 'framer-motion'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
  Area,
  AreaChart,
  ComposedChart,
} from 'recharts'
import { cn } from '@/lib/utils'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type {
  PerformanceTrendData,
  WeeklyPerformance,
} from '../types/team-performance.types'

interface PerformanceChartProps {
  data: PerformanceTrendData[]
  title?: string
  description?: string
  height?: number
  showLegend?: boolean
  className?: string
}

// Custom tooltip component - styled to match shadcn/inbound charts
function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ color: string; name: string; value: number }>
  label?: string
}) {
  if (!active || !payload || !payload.length) return null

  return (
    <div className='bg-background border-border rounded-lg border p-3 shadow-lg'>
      <p className='text-foreground mb-2 font-semibold'>{label}</p>
      <div className='space-y-1'>
        {payload.map(
          (
            entry: {
              color: string
              name: string
              value: number
              dataKey?: string
            },
            index: number
          ) => (
            <p key={index} className='text-sm' style={{ color: entry.color }}>
              <span className='font-medium'>{entry.name}:</span> {entry.value}
              {entry.dataKey === 'efficiency' ? '%' : ''}
            </p>
          )
        )}
      </div>
    </div>
  )
}

// Bar Chart variant - styled to match standard shadcn charts
export function PerformanceBarChart({
  data,
  title = 'Weekly Performance',
  description = 'Task completion trends across all departments',
  height = 400,
  showLegend = true,
  className,
}: PerformanceChartProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <Card className={className}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width='100%' height={height}>
            <BarChart
              data={data}
              margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
            >
              <CartesianGrid
                strokeDasharray='3 3'
                stroke='var(--border)'
                opacity={0.3}
              />
              <XAxis
                dataKey='day'
                className='text-xs'
                tick={{ fill: 'var(--foreground)', fontSize: 11 }}
                stroke='var(--border)'
              />
              <YAxis
                className='text-xs'
                tick={{ fill: 'var(--foreground)', fontSize: 11 }}
                stroke='var(--border)'
                label={{
                  value: 'Tasks',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fill: 'var(--foreground)', fontSize: 12 },
                }}
              />
              <Tooltip content={<CustomTooltip />} />
              {showLegend && (
                <Legend iconType='line' wrapperStyle={{ paddingTop: '20px' }} />
              )}
              <Bar
                dataKey='completed'
                name='Completed'
                fill='var(--primary)'
                radius={[4, 4, 0, 0]}
                opacity={0.9}
              />
              <Bar
                dataKey='pending'
                name='Pending'
                fill='var(--primary)'
                radius={[4, 4, 0, 0]}
                opacity={0.5}
              />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// Line Chart variant for efficiency trends - styled to match standard shadcn charts
export function EfficiencyLineChart({
  data,
  title = 'Efficiency Trend',
  description = 'Average team efficiency over time',
  height = 400,
  className,
}: PerformanceChartProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
    >
      <Card className={className}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width='100%' height={height}>
            <LineChart
              data={data}
              margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
            >
              <CartesianGrid
                strokeDasharray='3 3'
                stroke='var(--border)'
                opacity={0.3}
              />
              <XAxis
                dataKey='day'
                className='text-xs'
                tick={{ fill: 'var(--foreground)', fontSize: 11 }}
                stroke='var(--border)'
              />
              <YAxis
                className='text-xs'
                tick={{ fill: 'var(--foreground)', fontSize: 11 }}
                stroke='var(--border)'
                domain={[0, 100]}
                tickFormatter={(value) => `${value}%`}
                label={{
                  value: 'Efficiency %',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fill: 'var(--foreground)', fontSize: 12 },
                }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ paddingTop: '20px' }} iconType='line' />
              <Line
                type='monotone'
                dataKey='efficiency'
                name='Efficiency'
                stroke='var(--primary)'
                strokeWidth={3}
                dot={{
                  fill: 'var(--primary)',
                  strokeWidth: 2,
                  r: 4,
                }}
                activeDot={{
                  r: 6,
                  fill: 'var(--primary)',
                  stroke: 'var(--background)',
                  strokeWidth: 2,
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// Area Chart variant for cumulative tasks - styled to match standard shadcn charts
export function TasksAreaChart({
  data,
  title = 'Cumulative Tasks',
  description = 'Task completion volume over time',
  height = 400,
  className,
}: PerformanceChartProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
    >
      <Card className={className}>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width='100%' height={height}>
            <AreaChart
              data={data}
              margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
            >
              <defs>
                <linearGradient
                  id='completedGradient'
                  x1='0'
                  y1='0'
                  x2='0'
                  y2='1'
                >
                  <stop
                    offset='5%'
                    stopColor='var(--primary)'
                    stopOpacity={0.4}
                  />
                  <stop
                    offset='95%'
                    stopColor='var(--primary)'
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray='3 3'
                stroke='var(--border)'
                opacity={0.3}
              />
              <XAxis
                dataKey='day'
                className='text-xs'
                tick={{ fill: 'var(--foreground)', fontSize: 11 }}
                stroke='var(--border)'
              />
              <YAxis
                className='text-xs'
                tick={{ fill: 'var(--foreground)', fontSize: 11 }}
                stroke='var(--border)'
                label={{
                  value: 'Tasks',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fill: 'var(--foreground)', fontSize: 12 },
                }}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ paddingTop: '20px' }} iconType='line' />
              <Area
                type='monotone'
                dataKey='completed'
                name='Completed Tasks'
                stroke='var(--primary)'
                strokeWidth={3}
                fill='url(#completedGradient)'
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// Combined Chart with tabs - styled to match inbound reports charts
interface CombinedChartProps {
  weeklyPerformance: WeeklyPerformance
  className?: string
}

export function CombinedPerformanceChart({
  weeklyPerformance,
  className,
}: CombinedChartProps) {
  return (
    <Card className={cn('', className)}>
      <CardHeader>
        <div className='flex items-center justify-between'>
          <div>
            <CardTitle>Performance Analytics</CardTitle>
            <CardDescription>
              Weekly trends and efficiency metrics
            </CardDescription>
          </div>
          <div className='flex gap-4 text-sm'>
            <div className='text-center'>
              <p className='text-2xl font-bold'>
                {weeklyPerformance.totalCompleted}
              </p>
              <p className='text-muted-foreground text-xs'>Total Tasks</p>
            </div>
            <div className='text-center'>
              <p className='text-2xl font-bold'>
                {weeklyPerformance.averageEfficiency}%
              </p>
              <p className='text-muted-foreground text-xs'>Avg Efficiency</p>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue='tasks' className='w-full'>
          <TabsList className='mb-4'>
            <TabsTrigger value='tasks'>Tasks</TabsTrigger>
            <TabsTrigger value='efficiency'>Efficiency</TabsTrigger>
            <TabsTrigger value='combined'>Combined</TabsTrigger>
          </TabsList>

          {/* Tasks Tab - Bar Chart */}
          <TabsContent value='tasks' className='mt-0'>
            <ResponsiveContainer width='100%' height={400}>
              <BarChart
                data={weeklyPerformance.data}
                margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
              >
                <CartesianGrid
                  strokeDasharray='3 3'
                  stroke='var(--border)'
                  opacity={0.3}
                />
                <XAxis
                  dataKey='day'
                  className='text-xs'
                  tick={{ fill: 'var(--foreground)', fontSize: 11 }}
                  stroke='var(--border)'
                />
                <YAxis
                  className='text-xs'
                  tick={{ fill: 'var(--foreground)', fontSize: 11 }}
                  stroke='var(--border)'
                  label={{
                    value: 'Tasks Completed',
                    angle: -90,
                    position: 'insideLeft',
                    style: { fill: 'var(--foreground)', fontSize: 12 },
                  }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ paddingTop: '20px' }} iconType='line' />
                <Bar
                  dataKey='completed'
                  name='Completed Tasks'
                  fill='var(--primary)'
                  radius={[4, 4, 0, 0]}
                  opacity={0.9}
                />
              </BarChart>
            </ResponsiveContainer>
            <div className='text-muted-foreground mt-4 flex justify-between text-xs'>
              <span>Best: {weeklyPerformance.bestDay}</span>
              <span>Worst: {weeklyPerformance.worstDay}</span>
            </div>
          </TabsContent>

          {/* Efficiency Tab - Line Chart */}
          <TabsContent value='efficiency' className='mt-0'>
            <ResponsiveContainer width='100%' height={400}>
              <LineChart
                data={weeklyPerformance.data}
                margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
              >
                <CartesianGrid
                  strokeDasharray='3 3'
                  stroke='var(--border)'
                  opacity={0.3}
                />
                <XAxis
                  dataKey='day'
                  className='text-xs'
                  tick={{ fill: 'var(--foreground)', fontSize: 11 }}
                  stroke='var(--border)'
                />
                <YAxis
                  className='text-xs'
                  tick={{ fill: 'var(--foreground)', fontSize: 11 }}
                  stroke='var(--border)'
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                  label={{
                    value: 'Efficiency %',
                    angle: -90,
                    position: 'insideLeft',
                    style: { fill: 'var(--foreground)', fontSize: 12 },
                  }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ paddingTop: '20px' }} iconType='line' />
                <Line
                  type='monotone'
                  dataKey='efficiency'
                  name='Efficiency'
                  stroke='var(--primary)'
                  strokeWidth={3}
                  dot={{ fill: 'var(--primary)', strokeWidth: 2, r: 4 }}
                  activeDot={{
                    r: 6,
                    fill: 'var(--primary)',
                    stroke: 'var(--background)',
                    strokeWidth: 2,
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          </TabsContent>

          {/* Combined Tab - ComposedChart with Bar + Line */}
          <TabsContent value='combined' className='mt-0'>
            <ResponsiveContainer width='100%' height={400}>
              <ComposedChart
                data={weeklyPerformance.data}
                margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
              >
                <CartesianGrid
                  strokeDasharray='3 3'
                  stroke='var(--border)'
                  opacity={0.3}
                />
                <XAxis
                  dataKey='day'
                  className='text-xs'
                  tick={{ fill: 'var(--foreground)', fontSize: 11 }}
                  stroke='var(--border)'
                />
                <YAxis
                  yAxisId='left'
                  className='text-xs'
                  tick={{ fill: 'var(--foreground)', fontSize: 11 }}
                  stroke='var(--border)'
                  label={{
                    value: 'Tasks',
                    angle: -90,
                    position: 'insideLeft',
                    style: { fill: 'var(--foreground)', fontSize: 12 },
                  }}
                />
                <YAxis
                  yAxisId='right'
                  orientation='right'
                  className='text-xs'
                  tick={{ fill: 'var(--foreground)', fontSize: 11 }}
                  stroke='var(--border)'
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                  label={{
                    value: 'Efficiency %',
                    angle: 90,
                    position: 'insideRight',
                    style: { fill: 'var(--foreground)', fontSize: 12 },
                  }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ paddingTop: '20px' }} iconType='line' />
                <Bar
                  yAxisId='left'
                  dataKey='completed'
                  name='Tasks Completed'
                  fill='var(--primary)'
                  radius={[4, 4, 0, 0]}
                  opacity={0.9}
                />
                <Line
                  yAxisId='right'
                  type='monotone'
                  dataKey='efficiency'
                  name='Efficiency %'
                  stroke='var(--primary)'
                  strokeWidth={3}
                  dot={false}
                  opacity={0.6}
                />
              </ComposedChart>
            </ResponsiveContainer>
            <div className='text-muted-foreground mt-4 flex justify-between text-xs'>
              <span>Best: {weeklyPerformance.bestDay}</span>
              <span>Worst: {weeklyPerformance.worstDay}</span>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

// Mini sparkline chart for inline use
interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  color?: string
  className?: string
}

export function Sparkline({
  data,
  width = 100,
  height = 30,
  color = 'var(--primary)',
  className,
}: SparklineProps) {
  const chartData = data.map((value, index) => ({ value, index }))

  return (
    <div className={cn('inline-block', className)} style={{ width, height }}>
      <ResponsiveContainer width='100%' height='100%'>
        <LineChart
          data={chartData}
          margin={{ top: 2, right: 2, left: 2, bottom: 2 }}
        >
          <Line
            type='monotone'
            dataKey='value'
            stroke={color}
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
