import React, { useMemo } from 'react'
import { format as formatDate } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { toZonedTime } from 'date-fns-tz'
import { BarChart3, Calendar, Loader2, TrendingUp } from 'lucide-react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { rustInboundScanService } from '@/lib/rust-core/inbound-scan.service'
import { logger } from '@/lib/utils/logger'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

interface InboundReportsProps {
  enableRealtime?: boolean
}

const InboundReports: React.FC<InboundReportsProps> = () => {
  // Fetch pre-aggregated report stats (FAST - database does the aggregation)
  // Returns ~30 daily counts instead of thousands of raw records
  const { data: reportStats, isLoading } = useQuery({
    queryKey: ['inbound-report-stats-30-days'],
    queryFn: async () => {
      const { data, error } = await rustInboundScanService.fetchReportStats(30)

      if (error) {
        logger.error('Failed to fetch report stats:', error)
        return null
      }

      return data
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  })

  // Process data for daily scans chart with rolling average
  const dailyScansData = useMemo(() => {
    const EST_TIMEZONE = 'America/New_York'

    // Generate last 30 days regardless of data (in EST)
    const chartData: Array<{
      date: string
      displayDate: string
      scans: number
      rollingAverage: number
    }> = []
    const todayUTC = new Date()
    const todayEST = toZonedTime(todayUTC, EST_TIMEZONE)

    // Create array of last 30 days in EST
    for (let i = 29; i >= 0; i--) {
      const dateEST = new Date(todayEST)
      dateEST.setDate(dateEST.getDate() - i)

      // Format as YYYY-MM-DD in EST
      const year = dateEST.getFullYear()
      const month = String(dateEST.getMonth() + 1).padStart(2, '0')
      const day = String(dateEST.getDate()).padStart(2, '0')
      const dateStr = `${year}-${month}-${day}`

      chartData.push({
        date: dateStr,
        displayDate: formatDate(dateEST, 'MMM dd'),
        scans: 0,
        rollingAverage: 0,
      })
    }

    // If no data, return empty chart structure
    if (!reportStats?.daily_counts) return chartData

    // Create lookup from aggregated daily counts
    const scansByDate: Record<string, number> = {}
    reportStats.daily_counts.forEach((day) => {
      scansByDate[day.date] = day.count
    })

    // Fill in actual scan counts
    chartData.forEach((day) => {
      day.scans = scansByDate[day.date] || 0
    })

    // Calculate rolling average (7-day)
    const rollingWindow = 7
    chartData.forEach((day, index) => {
      let rollingSum = 0
      let rollingCount = 0

      for (let i = Math.max(0, index - rollingWindow + 1); i <= index; i++) {
        rollingSum += chartData[i].scans
        rollingCount++
      }

      day.rollingAverage =
        rollingCount > 0 ? Math.round(rollingSum / rollingCount) : 0
    })

    return chartData
  }, [reportStats])

  // Use pre-calculated summary statistics from database
  const summaryStats = useMemo(() => {
    if (!reportStats?.summary) {
      return {
        totalDays: 0,
        totalScans: 0,
        averagePerDay: 0,
        peakDay: { date: 'N/A', scans: 0 },
        trend: 0,
      }
    }

    const { summary } = reportStats

    // Format peak day date
    let peakDateFormatted = 'N/A'
    if (summary.peak_day?.date) {
      const [year, month, day] = summary.peak_day.date.split('-').map(Number)
      const peakDate = new Date(year, month - 1, day)
      peakDateFormatted = formatDate(peakDate, 'MMM dd, yyyy') + ' EST'
    }

    return {
      totalDays: summary.total_days || 0,
      totalScans: summary.total_scans || 0,
      averagePerDay: summary.average_per_day || 0,
      peakDay: {
        date: peakDateFormatted,
        scans: summary.peak_day?.count || 0,
      },
      trend: summary.trend || 0,
    }
  }, [reportStats])

  // Custom tooltip for the chart
  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    payload?: Array<{ payload: { date: string }; value: number }>
  }) => {
    if (active && payload && payload.length) {
      // Parse date string and display in EST
      const dateStr = payload[0].payload.date // YYYY-MM-DD format
      const [year, month, day] = dateStr.split('-').map(Number)
      const date = new Date(year, month - 1, day) // Create date object

      return (
        <div className='bg-background border-border rounded-lg border p-3 shadow-lg'>
          <p className='text-foreground mb-2 font-semibold'>
            {formatDate(date, 'MMMM dd, yyyy')} EST
          </p>
          <div className='space-y-1'>
            <p className='text-sm' style={{ color: 'var(--primary)' }}>
              <span className='font-medium'>Scans:</span> {payload[0].value}
            </p>
            <p className='text-muted-foreground text-sm'>
              <span className='font-medium'>7-Day Avg:</span>{' '}
              {payload[1]?.value || 0}
            </p>
          </div>
        </div>
      )
    }
    return null
  }

  if (isLoading) {
    return (
      <div className='flex flex-col items-center justify-center gap-3 py-12'>
        <div className='flex items-center'>
          <Loader2 className='text-muted-foreground h-8 w-8 animate-spin' />
          <span className='text-muted-foreground ml-2'>
            Loading reports data...
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-6'>
      {/* Page Header */}
      <div className='flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center'>
        <div>
          <h3 className='text-2xl font-bold tracking-tight'>
            Inbound Reports & Analytics
          </h3>
          <p className='text-muted-foreground mt-1'>
            Track inbound scanning trends, patterns, and performance metrics
          </p>
        </div>
      </div>

      {/* Summary Statistics Cards */}
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>
              Total Days Tracked
            </CardTitle>
            <Calendar className='text-muted-foreground h-4 w-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>{summaryStats.totalDays}</div>
            <p className='text-muted-foreground text-xs'>
              Days with scan activity
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>
              Average Per Day
            </CardTitle>
            <BarChart3 className='text-muted-foreground h-4 w-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>
              {summaryStats.averagePerDay}
            </div>
            <p className='text-muted-foreground text-xs'>
              Scans per day (30-day period)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>Peak Day</CardTitle>
            <TrendingUp className='text-muted-foreground h-4 w-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>
              {summaryStats.peakDay.scans}
            </div>
            <p className='text-muted-foreground text-xs'>
              {summaryStats.peakDay.date}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>Trend</CardTitle>
            <TrendingUp
              className={`h-4 w-4 ${summaryStats.trend >= 0 ? 'text-green-500' : 'text-red-500'}`}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${summaryStats.trend >= 0 ? 'text-green-600' : 'text-red-600'}`}
            >
              {summaryStats.trend >= 0 ? '+' : ''}
              {summaryStats.trend}
            </div>
            <p className='text-muted-foreground text-xs'>
              Week-over-week change
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Inbound Scans</CardTitle>
          <CardDescription>
            Total scans per day with 7-day rolling average (Last 30 days)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dailyScansData.length === 0 ? (
            <div className='text-muted-foreground flex items-center justify-center py-12'>
              No scan data available for the selected period
            </div>
          ) : (
            <ResponsiveContainer width='100%' height={400}>
              <ComposedChart
                data={dailyScansData}
                margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
              >
                <CartesianGrid
                  strokeDasharray='3 3'
                  stroke='var(--border)'
                  opacity={0.3}
                />
                <XAxis
                  dataKey='displayDate'
                  className='text-xs'
                  tick={{ fill: 'var(--foreground)', fontSize: 11 }}
                  stroke='var(--border)'
                  angle={-45}
                  textAnchor='end'
                  height={80}
                />
                <YAxis
                  className='text-xs'
                  tick={{ fill: 'var(--foreground)', fontSize: 11 }}
                  stroke='var(--border)'
                  label={{
                    value: 'Number of Scans',
                    angle: -90,
                    position: 'insideLeft',
                    style: { fill: 'var(--foreground)', fontSize: 12 },
                  }}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ paddingTop: '20px' }} iconType='line' />
                <Bar
                  dataKey='scans'
                  fill='var(--primary)'
                  name='Daily Scans'
                  radius={[4, 4, 0, 0]}
                  opacity={0.9}
                />
                <Line
                  type='monotone'
                  dataKey='rollingAverage'
                  stroke='var(--primary)'
                  strokeWidth={3}
                  name='7-Day Average'
                  dot={false}
                  opacity={0.6}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Additional Insights */}
      <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>Key Insights</CardTitle>
            <CardDescription>Performance analysis and trends</CardDescription>
          </CardHeader>
          <CardContent>
            <div className='space-y-4'>
              <div className='flex items-start gap-3'>
                <div className='mt-1'>
                  <div className='bg-primary h-2 w-2 rounded-full' />
                </div>
                <div>
                  <p className='text-sm font-medium'>Daily Average</p>
                  <p className='text-muted-foreground text-xs'>
                    {summaryStats.averagePerDay} scans per day over the last{' '}
                    {summaryStats.totalDays} days
                  </p>
                </div>
              </div>

              <div className='flex items-start gap-3'>
                <div className='mt-1'>
                  <div className='bg-primary/70 h-2 w-2 rounded-full' />
                </div>
                <div>
                  <p className='text-sm font-medium'>Peak Performance</p>
                  <p className='text-muted-foreground text-xs'>
                    Highest activity on {summaryStats.peakDay.date} with{' '}
                    {summaryStats.peakDay.scans} scans
                  </p>
                </div>
              </div>

              <div className='flex items-start gap-3'>
                <div className='mt-1'>
                  <div
                    className={`h-2 w-2 rounded-full ${summaryStats.trend >= 0 ? 'bg-primary/80' : 'bg-destructive'}`}
                  />
                </div>
                <div>
                  <p className='text-sm font-medium'>Trend Analysis</p>
                  <p className='text-muted-foreground text-xs'>
                    {summaryStats.trend >= 0 ? 'Increasing' : 'Decreasing'} by{' '}
                    {Math.abs(summaryStats.trend)} scans/day (comparing first vs
                    last week)
                  </p>
                </div>
              </div>

              <div className='flex items-start gap-3'>
                <div className='mt-1'>
                  <div className='bg-primary/50 h-2 w-2 rounded-full' />
                </div>
                <div>
                  <p className='text-sm font-medium'>Rolling Average</p>
                  <p className='text-muted-foreground text-xs'>
                    7-day rolling average smooths daily variations and shows
                    overall trends
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Data Quality</CardTitle>
            <CardDescription>
              Import and data completeness metrics
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className='space-y-4'>
              <div className='flex items-start gap-3'>
                <div className='mt-1'>
                  <div className='bg-primary h-2 w-2 rounded-full' />
                </div>
                <div>
                  <p className='text-sm font-medium'>Total Records</p>
                  <p className='text-muted-foreground text-xs'>
                    {summaryStats.totalScans.toLocaleString()} inbound scan(s)
                    in last 30 days
                  </p>
                </div>
              </div>

              <div className='flex items-start gap-3'>
                <div className='mt-1'>
                  <div className='bg-primary/70 h-2 w-2 rounded-full' />
                </div>
                <div>
                  <p className='text-sm font-medium'>Date Range</p>
                  <p className='text-muted-foreground text-xs'>
                    {dailyScansData.length > 0
                      ? (() => {
                          const [startYear, startMonth, startDay] =
                            dailyScansData[0].date.split('-').map(Number)
                          const [endYear, endMonth, endDay] = dailyScansData[
                            dailyScansData.length - 1
                          ].date
                            .split('-')
                            .map(Number)
                          const startDate = new Date(
                            startYear,
                            startMonth - 1,
                            startDay
                          )
                          const endDate = new Date(
                            endYear,
                            endMonth - 1,
                            endDay
                          )
                          return `${formatDate(startDate, 'MMM dd, yyyy')} - ${formatDate(endDate, 'MMM dd, yyyy')} EST`
                        })()
                      : 'No data available'}
                  </p>
                </div>
              </div>

              <div className='flex items-start gap-3'>
                <div className='mt-1'>
                  <div className='bg-primary/50 h-2 w-2 rounded-full' />
                </div>
                <div>
                  <p className='text-sm font-medium'>Data Completeness</p>
                  <p className='text-muted-foreground text-xs'>
                    {summaryStats.totalDays} days with recorded activity
                  </p>
                </div>
              </div>

              <div className='flex items-start gap-3'>
                <div className='mt-1'>
                  <div className='bg-primary/40 h-2 w-2 rounded-full' />
                </div>
                <div>
                  <p className='text-sm font-medium'>Historical Data</p>
                  <p className='text-muted-foreground text-xs'>
                    Includes legacy imports and current operational data
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

InboundReports.displayName = 'InboundReports'

export default InboundReports
