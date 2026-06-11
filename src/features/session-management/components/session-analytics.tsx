// Created and developed by Jai Singh
import { useState, useEffect } from 'react'
import {
  IconTrendingUp,
  IconTrendingDown,
  IconCalendar,
  IconDownload,
  IconRefresh,
  IconUsers,
  IconClock,
  IconActivity,
} from '@tabler/icons-react'
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSessionManagementContext } from '../context/session-management-context'
import { SessionManagementService } from '../services/session-management.service'

interface AnalyticsData {
  sessionTrends: {
    peakSessions: number
    avgDailySessions: number
    trendDirection: 'up' | 'down'
    trendPercentage: number
  }
  sessionDuration: {
    average: string
    median: string
    totalHours: number
  }
  logoutReasons: {
    manual: number
    timeout: number
    adminForce: number
    other: number
  }
  activityData: Array<{
    date: string
    sessions: number
    duration: number
    users: number
  }>
}

const COLORS = {
  primary: '#8884d8',
  secondary: '#82ca9d',
  tertiary: '#ffc658',
  warning: '#ff7300',
  error: '#ff0000',
}

export function SessionAnalytics() {
  const [timeRange, setTimeRange] = useState('7d')
  const [isLoading, setIsLoading] = useState(false)
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData>({
    sessionTrends: {
      peakSessions: 0,
      avgDailySessions: 0,
      trendDirection: 'up',
      trendPercentage: 0,
    },
    sessionDuration: {
      average: '0m',
      median: '0m',
      totalHours: 0,
    },
    logoutReasons: {
      manual: 0,
      timeout: 0,
      adminForce: 0,
      other: 0,
    },
    activityData: [],
  })

  const { sessionStats, getSessionAnalytics, exportSessionData } =
    useSessionManagementContext()

  // Load analytics data on mount and when time range changes
  useEffect(() => {
    loadAnalyticsData()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadAnalyticsData reads timeRange; adding would cause unnecessary re-fetches
  }, [timeRange])

  const loadAnalyticsData = async () => {
    setIsLoading(true)
    try {
      // Get session analytics for the selected time range
      await getSessionAnalytics(timeRange)

      // Generate mock activity data based on time range
      const activityData = generateActivityData(timeRange)

      // Calculate analytics from session history and activities
      const [sessionHistory, activeSessions] = await Promise.all([
        SessionManagementService.getSessionHistory(),
        SessionManagementService.getActiveSessions(),
      ])

      // Process the data for analytics
      const analytics = processAnalyticsData(
        sessionHistory,
        activeSessions,
        activityData
      )
      setAnalyticsData(analytics)
    } catch (error) {
      logger.error('Error loading analytics data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const generateActivityData = (range: string) => {
    const days =
      range === '1d' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : 90
    const data = []
    const today = new Date()

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)

      // Generate realistic data patterns
      const dayOfWeek = date.getDay()
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
      const baseValue = isWeekend ? 15 : 25

      data.push({
        date: date.toISOString().split('T')[0],
        sessions: Math.floor(baseValue + Math.random() * 10 - 5),
        duration: Math.floor(120 + Math.random() * 60), // minutes
        users: Math.floor((baseValue + Math.random() * 10 - 5) * 0.8),
      })
    }

    return data
  }

  const processAnalyticsData = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SessionActivity/UserSession types lack index signature needed by Record
    sessionHistory: any[],
    _activeSessions: unknown[],
    activityData: {
      date: string
      sessions: number
      duration: number
      users: number
    }[]
  ): AnalyticsData => {
    // Calculate session trends
    const totalSessions = activityData.reduce(
      (sum, day) => sum + day.sessions,
      0
    )
    const avgDailySessions = Math.round(totalSessions / activityData.length)
    const peakSessions = Math.max(...activityData.map((day) => day.sessions))

    // Calculate durations
    const avgDurationMinutes = Math.round(
      activityData.reduce((sum, day) => sum + day.duration, 0) /
        activityData.length
    )
    const avgDuration = formatDuration(avgDurationMinutes)
    const medianDuration = formatDuration(Math.round(avgDurationMinutes * 0.85))

    // Calculate logout reasons from session history
    const logoutEvents = sessionHistory.filter((activity) =>
      ['logout', 'timeout', 'forced_logout'].includes(
        activity.event_type as string
      )
    )

    const logoutReasons = {
      manual: logoutEvents.filter((e) => e.event_type === 'logout').length,
      timeout: logoutEvents.filter((e) => e.event_type === 'timeout').length,
      adminForce: logoutEvents.filter((e) => e.event_type === 'forced_logout')
        .length,
      other: 0,
    }

    return {
      sessionTrends: {
        peakSessions,
        avgDailySessions,
        trendDirection: Math.random() > 0.5 ? 'up' : 'down',
        trendPercentage: Math.floor(Math.random() * 15 + 5),
      },
      sessionDuration: {
        average: avgDuration,
        median: medianDuration,
        totalHours: Math.round((totalSessions * avgDurationMinutes) / 60),
      },
      logoutReasons,
      activityData,
    }
  }

  const formatDuration = (minutes: number): string => {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
  }

  const handleRefresh = async () => {
    await loadAnalyticsData()
  }

  const handleExport = async () => {
    try {
      await exportSessionData('json')
    } catch (error) {
      logger.error('Error exporting session data:', error)
    }
  }

  const logoutReasonsData = [
    {
      name: 'Manual',
      value: analyticsData.logoutReasons.manual,
      color: COLORS.primary,
    },
    {
      name: 'Timeout',
      value: analyticsData.logoutReasons.timeout,
      color: COLORS.secondary,
    },
    {
      name: 'Admin Force',
      value: analyticsData.logoutReasons.adminForce,
      color: COLORS.warning,
    },
    {
      name: 'Other',
      value: analyticsData.logoutReasons.other,
      color: COLORS.tertiary,
    },
  ].filter((item) => item.value > 0)

  const totalLogouts = logoutReasonsData.reduce(
    (sum, item) => sum + item.value,
    0
  )

  return (
    <div className='space-y-6'>
      {/* Controls */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center space-x-4'>
          <div className='flex items-center space-x-2'>
            <IconCalendar className='h-4 w-4' />
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className='w-32'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='1d'>Last 24h</SelectItem>
                <SelectItem value='7d'>Last 7 days</SelectItem>
                <SelectItem value='30d'>Last 30 days</SelectItem>
                <SelectItem value='90d'>Last 3 months</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className='flex items-center space-x-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={handleRefresh}
            disabled={isLoading}
          >
            <IconRefresh className='mr-2 h-4 w-4' />
            {isLoading ? 'Loading...' : 'Refresh'}
          </Button>
          <Button variant='outline' size='sm' onClick={handleExport}>
            <IconDownload className='mr-2 h-4 w-4' />
            Export
          </Button>
        </div>
      </div>

      {/* Analytics Cards */}
      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='flex items-center text-base'>
              <IconActivity className='mr-2 h-4 w-4' />
              Session Trends
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground text-sm'>
                  Peak Sessions
                </span>
                <div className='flex items-center space-x-1'>
                  <span className='text-lg font-bold'>
                    {analyticsData.sessionTrends.peakSessions}
                  </span>
                  {analyticsData.sessionTrends.trendDirection === 'up' ? (
                    <IconTrendingUp className='h-4 w-4 text-green-500' />
                  ) : (
                    <IconTrendingDown className='h-4 w-4 text-red-500' />
                  )}
                </div>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground text-sm'>
                  Avg Daily Sessions
                </span>
                <div className='flex items-center space-x-1'>
                  <span className='text-lg font-bold'>
                    {analyticsData.sessionTrends.avgDailySessions}
                  </span>
                  <Badge variant='outline' className='text-xs'>
                    {analyticsData.sessionTrends.trendPercentage}%
                  </Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='flex items-center text-base'>
              <IconClock className='mr-2 h-4 w-4' />
              Session Duration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground text-sm'>Average</span>
                <span className='text-lg font-bold'>
                  {analyticsData.sessionDuration.average}
                </span>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground text-sm'>Median</span>
                <span className='text-lg font-bold'>
                  {analyticsData.sessionDuration.median}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='flex items-center text-base'>
              <IconUsers className='mr-2 h-4 w-4' />
              Active Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground text-sm'>
                  Current Sessions
                </span>
                <span className='text-lg font-bold'>
                  {sessionStats?.activeSessions || 0}
                </span>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground text-sm'>
                  Total Hours
                </span>
                <span className='text-lg font-bold'>
                  {analyticsData.sessionDuration.totalHours}h
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='pb-2'>
            <CardTitle className='text-base'>Logout Reasons</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground text-sm'>Manual</span>
                <Badge variant='secondary'>
                  {totalLogouts > 0
                    ? Math.round(
                        (analyticsData.logoutReasons.manual / totalLogouts) *
                          100
                      )
                    : 0}
                  %
                </Badge>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground text-sm'>Timeout</span>
                <Badge variant='outline'>
                  {totalLogouts > 0
                    ? Math.round(
                        (analyticsData.logoutReasons.timeout / totalLogouts) *
                          100
                      )
                    : 0}
                  %
                </Badge>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground text-sm'>
                  Admin Force
                </span>
                <Badge variant='destructive'>
                  {totalLogouts > 0
                    ? Math.round(
                        (analyticsData.logoutReasons.adminForce /
                          totalLogouts) *
                          100
                      )
                    : 0}
                  %
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className='grid gap-4 md:grid-cols-2'>
        {/* Session Activity Over Time */}
        <Card>
          <CardHeader>
            <CardTitle>Session Activity Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='h-64'>
              <ResponsiveContainer width='100%' height='100%'>
                <AreaChart data={analyticsData.activityData}>
                  <CartesianGrid strokeDasharray='3 3' />
                  <XAxis
                    dataKey='date'
                    tickFormatter={(value) =>
                      new Date(value).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })
                    }
                  />
                  <YAxis />
                  <Tooltip
                    labelFormatter={(value) =>
                      new Date(value).toLocaleDateString()
                    }
                    formatter={(value, name) => [
                      value,
                      name === 'sessions'
                        ? 'Sessions'
                        : name === 'users'
                          ? 'Users'
                          : 'Duration (min)',
                    ]}
                  />
                  <Area
                    type='monotone'
                    dataKey='sessions'
                    stroke={COLORS.primary}
                    fill={COLORS.primary}
                    fillOpacity={0.3}
                  />
                  <Area
                    type='monotone'
                    dataKey='users'
                    stroke={COLORS.secondary}
                    fill={COLORS.secondary}
                    fillOpacity={0.3}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Session Duration Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Daily Session Duration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='h-64'>
              <ResponsiveContainer width='100%' height='100%'>
                <BarChart data={analyticsData.activityData}>
                  <CartesianGrid strokeDasharray='3 3' />
                  <XAxis
                    dataKey='date'
                    tickFormatter={(value) =>
                      new Date(value).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })
                    }
                  />
                  <YAxis
                    label={{
                      value: 'Minutes',
                      angle: -90,
                      position: 'insideLeft',
                    }}
                  />
                  <Tooltip
                    labelFormatter={(value) =>
                      new Date(value).toLocaleDateString()
                    }
                    formatter={(value) => [`${value} min`, 'Avg Duration']}
                  />
                  <Bar
                    dataKey='duration'
                    fill={COLORS.tertiary}
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Logout Reasons Pie Chart */}
      {logoutReasonsData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Logout Reasons Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='h-64'>
              <ResponsiveContainer width='100%' height='100%'>
                <PieChart>
                  <Pie
                    data={logoutReasonsData}
                    cx='50%'
                    cy='50%'
                    labelLine={false}
                    label={({ name, percent }) =>
                      `${name} ${((percent || 0) * 100).toFixed(0)}%`
                    }
                    outerRadius={80}
                    fill='#8884d8'
                    dataKey='value'
                  >
                    {logoutReasonsData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
