// Created and developed by Jai Singh
import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  IconCircleCheck,
  IconClock,
  IconProgress,
  IconRefresh,
} from '@tabler/icons-react'
import { Loader2 } from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { createStandardProtectedRoute } from '@/lib/auth/route-protection'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { useTabSearchParam } from '@/hooks/use-tab-search-param'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TabMenu } from '@/components/ui/tab-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { PortalDashboard } from '@/features/customer-portal'
import {
  TicketStatus,
  isResolvedStatus,
  useTickets,
  useCustomerPortalMetrics,
  type Ticket,
} from '@/features/customer-portal/hooks/useTickets'

const customerPortalTabs = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'metrics', label: 'Customer Metrics' },
]

// Chart color configuration
const CHART_COLORS = {
  submitted: 'hsl(221, 83%, 53%)', // Blue - chart-1
  closed: 'hsl(142, 71%, 45%)', // Green - chart-2
  reopened: 'hsl(38, 92%, 50%)', // Orange - chart-3
}

// Pie chart colors for department charts
const PIE_COLORS = [
  'hsl(221, 83%, 53%)', // Blue
  'hsl(142, 71%, 45%)', // Green
  'hsl(38, 92%, 50%)', // Orange
  'hsl(262, 83%, 58%)', // Purple
  'hsl(0, 84%, 60%)', // Red
  'hsl(180, 70%, 45%)', // Teal
  'hsl(330, 81%, 60%)', // Pink
  'hsl(45, 93%, 47%)', // Yellow
]

interface ChartDataPoint {
  date: string
  submitted: number
  closed: number
  reopened: number
}

/**
 * Process tickets into daily aggregates for the chart
 */
function processTicketChartData(
  tickets: Ticket[],
  days: number
): ChartDataPoint[] {
  const today = new Date()
  today.setHours(23, 59, 59, 999)

  // Create a map for each day
  const dailyData = new Map<string, ChartDataPoint>()

  // Initialize all days in the range
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    const dateStr = date.toISOString().split('T')[0]
    dailyData.set(dateStr, {
      date: dateStr,
      submitted: 0,
      closed: 0,
      reopened: 0,
    })
  }

  const startDate = new Date(today)
  startDate.setDate(startDate.getDate() - days + 1)
  startDate.setHours(0, 0, 0, 0)

  // Process each ticket
  tickets.forEach((ticket) => {
    // Submitted - use created_at
    if (ticket.created_at) {
      const createdDate = new Date(ticket.created_at)
      if (createdDate >= startDate && createdDate <= today) {
        const dateStr = createdDate.toISOString().split('T')[0]
        const existing = dailyData.get(dateStr)
        if (existing) {
          existing.submitted++
        }
      }
    }

    // Closed - use the actual date_closed field from Smartsheet
    if (ticket.date_closed) {
      const closedDate = new Date(ticket.date_closed)
      if (closedDate >= startDate && closedDate <= today) {
        const dateStr = closedDate.toISOString().split('T')[0]
        const existing = dailyData.get(dateStr)
        if (existing) {
          existing.closed++
        }
      }
    }

    // Reopened - use the actual date_reopened field from Smartsheet
    if (ticket.date_reopened) {
      const reopenedDate = new Date(ticket.date_reopened)
      if (reopenedDate >= startDate && reopenedDate <= today) {
        const dateStr = reopenedDate.toISOString().split('T')[0]
        const existing = dailyData.get(dateStr)
        if (existing) {
          existing.reopened++
        }
      }
    }
  })

  // Convert map to sorted array and filter out days with no activity
  return Array.from(dailyData.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((day) => day.submitted > 0 || day.closed > 0 || day.reopened > 0)
}

/**
 * Format date for display on chart x-axis
 */
function formatChartDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * Custom tooltip component for the chart
 */
function ChartTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{
    color: string
    dataKey: string
    value: number
    name?: string
  }>
  label?: string
}) {
  if (!active || !payload || !payload.length) return null

  return (
    <div className='bg-background border-border min-w-[150px] rounded-lg border p-3 shadow-lg'>
      <p className='text-foreground mb-2 text-sm font-semibold'>
        {formatChartDate(label ?? '')}
      </p>
      <div className='space-y-1.5'>
        {payload.map(
          (
            entry: {
              color: string
              dataKey: string
              value: number
              name?: string
            },
            index: number
          ) => (
            <div
              key={index}
              className='flex items-center justify-between gap-4 text-sm'
            >
              <div className='flex items-center gap-2'>
                <div
                  className='h-2.5 w-2.5 rounded-full'
                  style={{ backgroundColor: entry.color }}
                />
                <span className='text-muted-foreground'>{entry.name}</span>
              </div>
              <span className='text-foreground font-medium'>{entry.value}</span>
            </div>
          )
        )}
      </div>
    </div>
  )
}

/**
 * Ticket Trends Area Chart Component
 * Displays daily ticket activity over selected time range
 */
function TicketTrendsChart({ tickets }: { tickets: Ticket[] }) {
  const [timeRange, setTimeRange] = useState('30')

  const chartData = useMemo(() => {
    const days = parseInt(timeRange)
    return processTicketChartData(tickets, days)
  }, [tickets, timeRange])

  // Calculate totals for the header
  const totals = useMemo(() => {
    return chartData.reduce(
      (acc, day) => ({
        submitted: acc.submitted + day.submitted,
        closed: acc.closed + day.closed,
        reopened: acc.reopened + day.reopened,
      }),
      { submitted: 0, closed: 0, reopened: 0 }
    )
  }, [chartData])

  return (
    <Card>
      <CardHeader className='flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row'>
        <div className='grid flex-1 gap-1 text-center sm:text-left'>
          <CardTitle>Ticket Activity Trends</CardTitle>
          <CardDescription>
            Showing ticket submissions, closures, and reopenings
          </CardDescription>
        </div>
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger
            className='w-[160px] rounded-lg sm:ml-auto'
            aria-label='Select time range'
          >
            <SelectValue placeholder='Last 30 days' />
          </SelectTrigger>
          <SelectContent className='rounded-xl'>
            <SelectItem value='7' className='rounded-lg'>
              Last 7 days
            </SelectItem>
            <SelectItem value='30' className='rounded-lg'>
              Last 30 days
            </SelectItem>
            <SelectItem value='90' className='rounded-lg'>
              Last 3 months
            </SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className='px-2 pt-4 sm:px-6 sm:pt-6'>
        {/* Summary stats row */}
        <div className='mb-4 flex flex-wrap justify-center gap-x-8 gap-y-2 text-sm'>
          <div className='flex items-center gap-2'>
            <div
              className='h-3 w-3 rounded-full'
              style={{ backgroundColor: CHART_COLORS.submitted }}
            />
            <span className='text-muted-foreground'>Submitted:</span>
            <span className='font-semibold'>{totals.submitted}</span>
          </div>
          <div className='flex items-center gap-2'>
            <div
              className='h-3 w-3 rounded-full'
              style={{ backgroundColor: CHART_COLORS.closed }}
            />
            <span className='text-muted-foreground'>Closed:</span>
            <span className='font-semibold'>{totals.closed}</span>
          </div>
          <div className='flex items-center gap-2'>
            <div
              className='h-3 w-3 rounded-full'
              style={{ backgroundColor: CHART_COLORS.reopened }}
            />
            <span className='text-muted-foreground'>Reopened:</span>
            <span className='font-semibold'>{totals.reopened}</span>
          </div>
        </div>

        {/* Chart */}
        <div className='h-[300px]'>
          <ResponsiveContainer
            width='100%'
            height='100%'
            minWidth={0}
            minHeight={0}
          >
            <AreaChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id='fillSubmitted' x1='0' y1='0' x2='0' y2='1'>
                  <stop
                    offset='5%'
                    stopColor={CHART_COLORS.submitted}
                    stopOpacity={0.8}
                  />
                  <stop
                    offset='95%'
                    stopColor={CHART_COLORS.submitted}
                    stopOpacity={0.1}
                  />
                </linearGradient>
                <linearGradient id='fillClosed' x1='0' y1='0' x2='0' y2='1'>
                  <stop
                    offset='5%'
                    stopColor={CHART_COLORS.closed}
                    stopOpacity={0.8}
                  />
                  <stop
                    offset='95%'
                    stopColor={CHART_COLORS.closed}
                    stopOpacity={0.1}
                  />
                </linearGradient>
                <linearGradient id='fillReopened' x1='0' y1='0' x2='0' y2='1'>
                  <stop
                    offset='5%'
                    stopColor={CHART_COLORS.reopened}
                    stopOpacity={0.8}
                  />
                  <stop
                    offset='95%'
                    stopColor={CHART_COLORS.reopened}
                    stopOpacity={0.1}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray='3 3'
                stroke='var(--border)'
                opacity={0.3}
                vertical={false}
              />
              <XAxis
                dataKey='date'
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                tickFormatter={formatChartDate}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                allowDecimals={false}
              />
              <Tooltip content={<ChartTooltipContent />} />
              <Legend
                iconType='circle'
                wrapperStyle={{ paddingTop: '16px' }}
                formatter={(value) => (
                  <span className='text-foreground text-sm'>{value}</span>
                )}
              />
              <Area
                dataKey='submitted'
                name='Submitted'
                type='monotone'
                fill='url(#fillSubmitted)'
                stroke={CHART_COLORS.submitted}
                strokeWidth={2}
                stackId='a'
              />
              <Area
                dataKey='closed'
                name='Closed'
                type='monotone'
                fill='url(#fillClosed)'
                stroke={CHART_COLORS.closed}
                strokeWidth={2}
                stackId='a'
              />
              <Area
                dataKey='reopened'
                name='Reopened'
                type='monotone'
                fill='url(#fillReopened)'
                stroke={CHART_COLORS.reopened}
                strokeWidth={2}
                stackId='a'
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Average Open Days by ILC Department - Horizontal Bar Chart
 */
function AvgOpenDaysByDeptChart({ tickets }: { tickets: Ticket[] }) {
  const chartData = useMemo(() => {
    // Group tickets by ilc_department and calculate average days_open.
    // Skip tickets with a blank or whitespace-only ILC department — those
    // are typically legacy/closed rows from before the field was required,
    // and bucketing them as a synthetic "Unassigned" department was
    // misleading on the chart.
    const deptMap = new Map<string, { totalDays: number; count: number }>()

    tickets.forEach((ticket) => {
      const dept = ticket.ilc_department?.trim()
      if (!dept) return
      const daysOpen = ticket.days_open ?? 0

      if (!deptMap.has(dept)) {
        deptMap.set(dept, { totalDays: 0, count: 0 })
      }
      const entry = deptMap.get(dept)!
      entry.totalDays += daysOpen
      entry.count++
    })

    return Array.from(deptMap.entries())
      .map(([dept, data]) => ({
        department: dept,
        avgDays:
          data.count > 0
            ? Math.round((data.totalDays / data.count) * 10) / 10
            : 0,
      }))
      .sort((a, b) => b.avgDays - a.avgDays) // Sort by highest average
      .slice(0, 8) // Limit to top 8 departments
  }, [tickets])

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className='text-sm'>Avg Open Days by Department</CardTitle>
        </CardHeader>
        <CardContent className='text-muted-foreground flex h-[200px] items-center justify-center text-sm'>
          No department data available
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='text-sm'>Avg Open Days by Department</CardTitle>
        <CardDescription className='text-xs'>
          Average ticket age by ILC department
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className='h-[280px]'>
          <ResponsiveContainer
            width='100%'
            height='100%'
            minWidth={0}
            minHeight={0}
          >
            <BarChart
              data={chartData}
              layout='vertical'
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid
                strokeDasharray='3 3'
                stroke='var(--border)'
                opacity={0.3}
                horizontal={false}
              />
              <XAxis
                type='number'
                tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type='category'
                dataKey='department'
                width={80}
                tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className='bg-background border-border rounded-lg border p-2 text-sm shadow-lg'>
                      <p className='font-medium'>
                        {payload[0].payload.department}
                      </p>
                      <p className='text-muted-foreground'>
                        {payload[0].value} days avg
                      </p>
                    </div>
                  )
                }}
              />
              <Bar
                dataKey='avgDays'
                fill='hsl(221, 83%, 53%)'
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Open Requests by ILC Department - Interactive Pie Chart with Selector
 */
function OpenRequestsByDeptChart({ tickets }: { tickets: Ticket[] }) {
  const [selectedDept, setSelectedDept] = useState<string>('all')

  // Get unique departments (ignoring blank / whitespace-only values)
  const departments = useMemo(() => {
    const depts = new Set<string>()
    tickets.forEach((ticket) => {
      const dept = ticket.ilc_department?.trim()
      if (dept) {
        depts.add(dept)
      }
    })
    return ['all', ...Array.from(depts).sort()]
  }, [tickets])

  // Filter for open/active tickets and group by department
  const chartData = useMemo(() => {
    const openStatuses = [
      TicketStatus.NOT_STARTED,
      TicketStatus.IN_PROGRESS,
      TicketStatus.ESCALATED,
      TicketStatus.REOPENED,
      TicketStatus.BLANK,
    ]

    // Filter for open tickets
    const openTickets = tickets.filter((t) => openStatuses.includes(t.status))

    // If a department is selected, show status breakdown for that dept
    if (selectedDept !== 'all') {
      const deptTickets = openTickets.filter(
        (t) => t.ilc_department?.trim() === selectedDept
      )
      const statusCounts = new Map<string, number>()

      deptTickets.forEach((ticket) => {
        const status = ticket.status || 'Blank'
        statusCounts.set(status, (statusCounts.get(status) || 0) + 1)
      })

      return Array.from(statusCounts.entries())
        .map(([status, count]) => ({ name: status, value: count }))
        .filter((d) => d.value > 0)
    }

    // Show all departments breakdown — skip tickets without an ILC
    // department instead of bucketing them as a synthetic "Unassigned"
    // slice (legacy/closed rows usually have no ILC department set).
    const deptCounts = new Map<string, number>()
    openTickets.forEach((ticket) => {
      const dept = ticket.ilc_department?.trim()
      if (!dept) return
      deptCounts.set(dept, (deptCounts.get(dept) || 0) + 1)
    })

    return Array.from(deptCounts.entries())
      .map(([dept, count]) => ({ name: dept, value: count }))
      .sort((a, b) => b.value - a.value)
  }, [tickets, selectedDept])

  const totalOpen = chartData.reduce((sum, d) => sum + d.value, 0)

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className='text-sm'>Open Requests by Department</CardTitle>
        </CardHeader>
        <CardContent className='text-muted-foreground flex h-[200px] items-center justify-center text-sm'>
          No open requests
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className='pb-2'>
        <div className='flex items-center justify-between'>
          <div>
            <CardTitle className='text-sm'>
              Open Requests by Department
            </CardTitle>
            <CardDescription className='text-xs'>
              {selectedDept === 'all' ? 'All departments' : selectedDept} •{' '}
              {totalOpen} open
            </CardDescription>
          </div>
          <Select value={selectedDept} onValueChange={setSelectedDept}>
            <SelectTrigger className='h-7 w-[120px] text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {departments.map((dept) => (
                <SelectItem key={dept} value={dept} className='text-xs'>
                  {dept === 'all' ? 'All Depts' : dept}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className='pt-4'>
        <div className='h-[220px]'>
          <ResponsiveContainer
            width='100%'
            height='100%'
            minWidth={0}
            minHeight={0}
          >
            <PieChart margin={{ top: 20, right: 10, left: 10, bottom: 10 }}>
              <Pie
                data={chartData}
                cx='50%'
                cy='50%'
                innerRadius={35}
                outerRadius={60}
                paddingAngle={2}
                dataKey='value'
                labelLine={false}
                label={({ percent }: { percent?: number }) =>
                  (percent ?? 0) > 0.05
                    ? `${((percent ?? 0) * 100).toFixed(0)}%`
                    : ''
                }
              >
                {chartData.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={PIE_COLORS[index % PIE_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className='bg-background border-border rounded-lg border p-2 text-sm shadow-lg'>
                      <p className='font-medium'>{payload[0].payload.name}</p>
                      <p className='text-muted-foreground'>
                        {payload[0].value} requests
                      </p>
                    </div>
                  )
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Total Requests by Type (Requestor Department) - Labeled Pie Chart
 */
function RequestsByTypeChart({ tickets }: { tickets: Ticket[] }) {
  const chartData = useMemo(() => {
    const deptCounts = new Map<string, number>()

    tickets.forEach((ticket) => {
      const dept = ticket.requestor_department || 'Unspecified'
      deptCounts.set(dept, (deptCounts.get(dept) || 0) + 1)
    })

    return Array.from(deptCounts.entries())
      .map(([dept, count]) => ({ name: dept, value: count }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8) // Limit to top 8 for readability
  }, [tickets])

  const total = chartData.reduce((sum, d) => sum + d.value, 0)

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className='text-sm'>Requests by Requestor Dept</CardTitle>
        </CardHeader>
        <CardContent className='text-muted-foreground flex h-[200px] items-center justify-center text-sm'>
          No requestor department data
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='text-sm'>Requests by Requestor Dept</CardTitle>
        <CardDescription className='text-xs'>
          Total: {total} requests
        </CardDescription>
      </CardHeader>
      <CardContent className='pt-4'>
        <div className='h-[260px]'>
          <ResponsiveContainer
            width='100%'
            height='100%'
            minWidth={0}
            minHeight={0}
          >
            <PieChart margin={{ top: 25, right: 20, left: 20, bottom: 5 }}>
              <Pie
                data={chartData}
                cx='50%'
                cy='45%'
                outerRadius={55}
                dataKey='value'
                labelLine={true}
                label={({
                  name,
                  percent,
                }: {
                  name?: string
                  percent?: number
                }) => {
                  const displayName = name ?? ''
                  return (percent ?? 0) > 0.05
                    ? `${displayName.substring(0, 10)}${displayName.length > 10 ? '...' : ''}`
                    : ''
                }}
              >
                {chartData.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={PIE_COLORS[index % PIE_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className='bg-background border-border rounded-lg border p-2 text-sm shadow-lg'>
                      <p className='font-medium'>{payload[0].payload.name}</p>
                      <p className='text-muted-foreground'>
                        {payload[0].value} requests (
                        {((payload[0].payload.value / total) * 100).toFixed(1)}
                        %)
                      </p>
                    </div>
                  )
                }}
              />
              <Legend
                layout='horizontal'
                verticalAlign='bottom'
                align='center'
                iconSize={8}
                wrapperStyle={{ fontSize: '10px' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Format milliseconds to a human-readable duration string
 */
function formatResponseTime(ms: number | null | undefined): string {
  if (!ms || ms === 0) return 'N/A'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`
  return `${(ms / 3600000).toFixed(1)}h`
}

/**
 * Agent Productivity Panel
 * Shows per-user productivity metrics from the customer portal ticket actions.
 * Powered by the get_customer_portal_metrics() RPC function.
 */
function AgentProductivityPanel() {
  const { authState } = useUnifiedAuth()
  const organizationId = authState.profile?.organization_id

  // Date range: today by default
  const [dateRange] = useState<'today' | 'week' | 'month'>('today')
  const { startDate, endDate } = useMemo(() => {
    const now = new Date()
    const end = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59
    )
    let start: Date

    switch (dateRange) {
      case 'week': {
        start = new Date(end)
        start.setDate(start.getDate() - 7)
        start.setHours(0, 0, 0, 0)
        break
      }
      case 'month': {
        start = new Date(end)
        start.setDate(start.getDate() - 30)
        start.setHours(0, 0, 0, 0)
        break
      }
      default: {
        start = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          0,
          0,
          0
        )
        break
      }
    }
    return { startDate: start, endDate: end }
  }, [dateRange])

  const { data: agentMetrics, isLoading: isLoadingMetrics } =
    useCustomerPortalMetrics(organizationId ?? undefined, startDate, endDate)

  if (!organizationId) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-lg'>Agent Productivity</CardTitle>
        <CardDescription>
          Customer portal actions tracked per agent for today
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoadingMetrics ? (
          <div className='flex items-center justify-center py-8'>
            <Loader2 className='h-5 w-5 animate-spin' />
            <span className='text-muted-foreground ml-2 text-sm'>
              Loading productivity data...
            </span>
          </div>
        ) : !agentMetrics || agentMetrics.length === 0 ? (
          <div className='text-muted-foreground py-8 text-center text-sm'>
            No portal activity recorded yet. Actions will appear here as agents
            work on tickets.
          </div>
        ) : (
          <div className='space-y-4'>
            {/* Summary Stats */}
            <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
              <div className='rounded-lg border p-3'>
                <div className='text-2xl font-bold'>
                  {agentMetrics.reduce((sum, m) => sum + m.total_actions, 0)}
                </div>
                <div className='text-muted-foreground text-xs'>
                  Total Actions
                </div>
              </div>
              <div className='rounded-lg border p-3'>
                <div className='text-2xl font-bold'>
                  {agentMetrics.reduce((sum, m) => sum + m.tickets_handled, 0)}
                </div>
                <div className='text-muted-foreground text-xs'>
                  Tickets Handled
                </div>
              </div>
              <div className='rounded-lg border p-3'>
                <div className='text-2xl font-bold'>
                  {agentMetrics.reduce((sum, m) => sum + m.comments_made, 0)}
                </div>
                <div className='text-muted-foreground text-xs'>
                  Comments Made
                </div>
              </div>
              <div className='rounded-lg border p-3'>
                <div className='text-2xl font-bold'>
                  {formatResponseTime(
                    agentMetrics.length > 0
                      ? agentMetrics.reduce(
                          (sum, m) => sum + (m.avg_response_time_ms || 0),
                          0
                        ) / agentMetrics.length
                      : 0
                  )}
                </div>
                <div className='text-muted-foreground text-xs'>
                  Avg Response Time
                </div>
              </div>
            </div>

            {/* Per-Agent Table */}
            <div className='rounded-md border'>
              <Table className='text-sm'>
                <TableHeader>
                  <TableRow className='bg-muted/50'>
                    <TableHead className='p-3 font-medium'>Agent</TableHead>
                    <TableHead className='p-3 text-right font-medium'>
                      Tickets
                    </TableHead>
                    <TableHead className='p-3 text-right font-medium'>
                      Comments
                    </TableHead>
                    <TableHead className='p-3 text-right font-medium'>
                      Status Changes
                    </TableHead>
                    <TableHead className='p-3 text-right font-medium'>
                      Updates
                    </TableHead>
                    <TableHead className='p-3 text-right font-medium'>
                      Total
                    </TableHead>
                    <TableHead className='p-3 text-right font-medium'>
                      Avg Response
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agentMetrics
                    .sort((a, b) => b.total_actions - a.total_actions)
                    .map((metric) => {
                      const displayName =
                        metric.user_full_name ||
                        [metric.user_first_name, metric.user_last_name]
                          .filter(Boolean)
                          .join(' ') ||
                        metric.user_email ||
                        metric.user_id.slice(0, 8) + '...'

                      return (
                        <TableRow
                          key={metric.user_id}
                          className='hover:bg-muted/30 transition-colors'
                        >
                          <TableCell className='p-3'>
                            <div className='font-medium'>{displayName}</div>
                            {metric.user_email &&
                              displayName !== metric.user_email && (
                                <div className='text-muted-foreground text-xs'>
                                  {metric.user_email}
                                </div>
                              )}
                          </TableCell>
                          <TableCell className='p-3 text-right'>
                            {metric.tickets_handled}
                          </TableCell>
                          <TableCell className='p-3 text-right'>
                            {metric.comments_made}
                          </TableCell>
                          <TableCell className='p-3 text-right'>
                            {metric.status_changes}
                          </TableCell>
                          <TableCell className='p-3 text-right'>
                            {metric.field_updates}
                          </TableCell>
                          <TableCell className='p-3 text-right font-semibold'>
                            {metric.total_actions}
                          </TableCell>
                          <TableCell className='p-3 text-right'>
                            {formatResponseTime(metric.avg_response_time_ms)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Customer Metrics Statistics Component
 * Displays 4 stat cards matching the design from Inbound Scan Search
 */
function CustomerMetrics() {
  const { allTickets, isLoading } = useTickets()

  // Calculate metrics from ticket data
  const metrics = useMemo(() => {
    if (!allTickets || allTickets.length === 0) {
      return {
        averageOpenDays: 0,
        openRequests: 0,
        closedRequests: 0,
        reopenedRequests: 0,
        totalRequests: 0,
      }
    }

    // Average Open Days - calculate from days_open field
    const ticketsWithDaysOpen = allTickets.filter(
      (t) => t.days_open !== undefined && t.days_open !== null
    )
    const totalDaysOpen = ticketsWithDaysOpen.reduce(
      (sum, t) => sum + (t.days_open || 0),
      0
    )
    const averageOpenDays =
      ticketsWithDaysOpen.length > 0
        ? totalDaysOpen / ticketsWithDaysOpen.length
        : 0

    // Open Requests - count all non-resolved tickets (Not Started, In Progress, Escalated, Reopened, Blank)
    const openRequests = allTickets.filter(
      (t) => !isResolvedStatus(t.status)
    ).length

    // Closed Requests - count "Closed" status
    const closedRequests = allTickets.filter(
      (t) => t.status === TicketStatus.CLOSED
    ).length

    // Reopened Requests - count "Reopened" status
    const reopenedRequests = allTickets.filter(
      (t) => t.status === TicketStatus.REOPENED
    ).length

    return {
      averageOpenDays,
      openRequests,
      closedRequests,
      reopenedRequests,
      totalRequests: allTickets.length,
    }
  }, [allTickets])

  if (isLoading) {
    return (
      <div className='flex items-center justify-center py-12'>
        <Loader2 className='h-8 w-8 animate-spin' />
        <span className='ml-2'>Loading ticket metrics...</span>
      </div>
    )
  }

  return (
    <div className='space-y-6'>
      {/* Statistics Cards - matching inbound-scan-search design */}
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
        {/* Average Open Days */}
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>
              Average Open Days
            </CardTitle>
            <IconClock className='text-muted-foreground h-4 w-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>
              {metrics.averageOpenDays.toFixed(1)} days
            </div>
            <p className='text-muted-foreground text-xs'>
              Average time tickets remain open
            </p>
          </CardContent>
        </Card>

        {/* Open Requests */}
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>Open Requests</CardTitle>
            <IconProgress className='text-muted-foreground h-4 w-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>{metrics.openRequests}</div>
            <p className='text-muted-foreground text-xs'>
              All active and pending tickets
            </p>
          </CardContent>
        </Card>

        {/* Closed Requests */}
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>
              Closed Requests
            </CardTitle>
            <IconCircleCheck className='text-muted-foreground h-4 w-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>{metrics.closedRequests}</div>
            <p className='text-muted-foreground text-xs'>
              Total resolved tickets
            </p>
          </CardContent>
        </Card>

        {/* Reopened Requests */}
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>
              Reopened Requests
            </CardTitle>
            <IconRefresh className='text-muted-foreground h-4 w-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>{metrics.reopenedRequests}</div>
            <p className='text-muted-foreground text-xs'>
              Tickets reopened after closure
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Summary info */}
      <div className='text-muted-foreground text-sm'>
        Based on {metrics.totalRequests} total tickets in the system
      </div>

      {/* Ticket Trends Chart */}
      <TicketTrendsChart tickets={allTickets} />

      {/* Department Charts Row */}
      <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
        <AvgOpenDaysByDeptChart tickets={allTickets} />
        <OpenRequestsByDeptChart tickets={allTickets} />
        <RequestsByTypeChart tickets={allTickets} />
      </div>

      {/* Agent Productivity Panel */}
      <AgentProductivityPanel />
    </div>
  )
}

function CustomerPortal() {
  const [activeTab, setActiveTab] = useTabSearchParam('dashboard')

  const renderTabContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <PortalDashboard />
      case 'metrics':
        return <CustomerMetrics />
      default:
        return <PortalDashboard />
    }
  }

  return (
    <>
      <Header fixed>
        <Search />
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      <Main>
        <div className='mb-4 flex flex-wrap items-center justify-between'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>
              Customer Portal
            </h2>
            <p className='text-muted-foreground text-sm'>
              Manage customer support tickets and relationships.
            </p>
          </div>
        </div>

        <div className='space-y-4'>
          <TabMenu
            tabs={customerPortalTabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            pageResource='customer_portal'
            fallbackTab='dashboard'
          />

          {activeTab === 'dashboard' ? (
            renderTabContent()
          ) : (
            <div className='bg-background rounded-lg border p-6'>
              {renderTabContent()}
            </div>
          )}
        </div>
      </Main>
    </>
  )
}

export const Route = createFileRoute('/_authenticated/apps/customer-portal')({
  beforeLoad: createStandardProtectedRoute('CUSTOMER_PORTAL'),
  component: CustomerPortal,
})

// Created and developed by Jai Singh
