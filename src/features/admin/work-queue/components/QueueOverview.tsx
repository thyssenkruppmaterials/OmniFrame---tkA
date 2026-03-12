/**
 * Queue Overview Component
 * Real-time dashboard showing queue status, metrics, and system health
 * Main overview for work queue administration
 */
import React, { useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle,
  Clock,
  Pause,
  Play,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useWorkQueue } from '../context/work-queue-context-simple'

// ============================================================================
// INTERFACES
// ============================================================================

interface MetricCardProps {
  title: string
  value: string | number
  subtitle?: string
  icon: React.ElementType
  trend?: {
    value: number
    isPositive: boolean
  }
  status?: 'good' | 'warning' | 'danger'
}

// ============================================================================
// METRIC CARD COMPONENT
// ============================================================================

const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  status = 'good',
}) => {
  const getStatusColor = () => {
    switch (status) {
      case 'warning':
        return 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/20'
      case 'danger':
        return 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20'
      default:
        return 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20'
    }
  }

  const getIconColor = () => {
    switch (status) {
      case 'warning':
        return 'text-yellow-600 dark:text-yellow-400'
      case 'danger':
        return 'text-red-600 dark:text-red-400'
      default:
        return 'text-green-600 dark:text-green-400'
    }
  }

  return (
    <Card className={getStatusColor()}>
      <CardContent className='p-6'>
        <div className='flex items-center justify-between'>
          <div className='flex-1'>
            <div className='mb-2 flex items-center space-x-2'>
              <Icon className={`h-5 w-5 ${getIconColor()}`} />
              <h3 className='text-muted-foreground text-sm font-medium'>
                {title}
              </h3>
            </div>
            <div className='text-2xl font-bold'>{value}</div>
            {subtitle && (
              <p className='text-muted-foreground mt-1 text-xs'>{subtitle}</p>
            )}
          </div>
          {trend && (
            <div
              className={`flex items-center space-x-1 ${
                trend.isPositive ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {trend.isPositive ? (
                <TrendingUp className='h-4 w-4' />
              ) : (
                <TrendingDown className='h-4 w-4' />
              )}
              <span className='text-sm font-medium'>
                {Math.abs(trend.value)}%
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function QueueOverview() {
  const {
    queueStats,
    realtimeMetrics,
    bottleneckAnalysis,
    isLoadingStats,
    refreshAllData,
    isSubscribed,
    subscribeToUpdates,
    unsubscribeFromUpdates,
  } = useWorkQueue()

  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  // ========================================================================
  // EFFECTS
  // ========================================================================

  useEffect(() => {
    // Auto-subscribe to real-time updates
    subscribeToUpdates()

    return () => {
      unsubscribeFromUpdates()
    }
  }, [subscribeToUpdates, unsubscribeFromUpdates])

  // ========================================================================
  // HANDLERS
  // ========================================================================

  const handleRefresh = async () => {
    await refreshAllData()
    setLastRefresh(new Date())
    toast.success('Dashboard refreshed')
  }

  const handleToggleSubscription = () => {
    if (isSubscribed) {
      unsubscribeFromUpdates()
    } else {
      subscribeToUpdates()
    }
  }

  // ========================================================================
  // COMPUTED VALUES
  // ========================================================================

  const getQueueHealth = () => {
    if (!queueStats || !realtimeMetrics) return 'unknown'

    const issues = [
      realtimeMetrics.worker_utilization > 90,
      realtimeMetrics.queue_depth > 50,
      realtimeMetrics.completion_rate < 80,
      realtimeMetrics.error_rate > 10,
    ].filter(Boolean).length

    if (issues === 0) return 'good'
    if (issues <= 2) return 'warning'
    return 'danger'
  }

  const formatLastRefresh = () => {
    const now = new Date()
    const diffSeconds = Math.floor(
      (now.getTime() - lastRefresh.getTime()) / 1000
    )

    if (diffSeconds < 60) return `${diffSeconds}s ago`
    const diffMinutes = Math.floor(diffSeconds / 60)
    if (diffMinutes < 60) return `${diffMinutes}m ago`
    const diffHours = Math.floor(diffMinutes / 60)
    return `${diffHours}h ago`
  }

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div className='space-y-6'>
      {/* Header Controls */}
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='text-lg font-semibold'>Queue Overview</h3>
          <p className='text-muted-foreground text-sm'>
            Last updated {formatLastRefresh()}
          </p>
        </div>
        <div className='flex items-center space-x-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={handleToggleSubscription}
          >
            {isSubscribed ? (
              <>
                <Pause className='mr-2 h-4 w-4' />
                Pause Live
              </>
            ) : (
              <>
                <Play className='mr-2 h-4 w-4' />
                Enable Live
              </>
            )}
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={handleRefresh}
            disabled={isLoadingStats}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isLoadingStats ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
        <MetricCard
          title='Queue Depth'
          value={queueStats?.total_pending || 0}
          subtitle='Tasks waiting'
          icon={Clock}
          status={
            queueStats && queueStats.total_pending > 20 ? 'warning' : 'good'
          }
        />

        <MetricCard
          title='Active Workers'
          value={queueStats?.total_in_progress || 0}
          subtitle='Currently working'
          icon={Users}
          status='good'
        />

        <MetricCard
          title='Completion Rate'
          value={`${realtimeMetrics?.completion_rate || 0}%`}
          subtitle='Last hour'
          icon={CheckCircle}
          status={
            realtimeMetrics && realtimeMetrics.completion_rate < 80
              ? 'warning'
              : 'good'
          }
        />

        <MetricCard
          title='Queue Health'
          value={
            getQueueHealth() === 'good'
              ? 'Healthy'
              : getQueueHealth() === 'warning'
                ? 'Warning'
                : 'Critical'
          }
          subtitle='Overall status'
          icon={Activity}
          status={getQueueHealth() as 'good' | 'warning' | 'danger' | undefined}
        />
      </div>

      {/* Real-time Performance */}
      {realtimeMetrics && (
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center space-x-2'>
              <BarChart3 className='h-5 w-5' />
              <span>Real-time Performance</span>
              {isSubscribed && (
                <Badge variant='secondary' className='ml-auto'>
                  <Activity className='mr-1 h-3 w-3' />
                  Live
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className='grid grid-cols-2 gap-4 md:grid-cols-4'>
              <div className='text-center'>
                <div className='text-2xl font-bold'>
                  {realtimeMetrics.tasks_per_minute}
                </div>
                <div className='text-muted-foreground text-xs'>Tasks/min</div>
              </div>
              <div className='text-center'>
                <div className='text-2xl font-bold'>
                  {realtimeMetrics.average_wait_time}m
                </div>
                <div className='text-muted-foreground text-xs'>Avg wait</div>
              </div>
              <div className='text-center'>
                <div className='text-2xl font-bold'>
                  {realtimeMetrics.worker_utilization}%
                </div>
                <div className='text-muted-foreground text-xs'>Utilization</div>
              </div>
              <div className='text-center'>
                <div className='text-2xl font-bold'>
                  {realtimeMetrics.sla_compliance}%
                </div>
                <div className='text-muted-foreground text-xs'>SLA</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* System Alerts */}
      {bottleneckAnalysis &&
        bottleneckAnalysis.identified_bottlenecks.length > 0 && (
          <Card className='border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/20'>
            <CardHeader>
              <CardTitle className='flex items-center space-x-2 text-yellow-800 dark:text-yellow-400'>
                <AlertTriangle className='h-5 w-5' />
                <span>System Alerts</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className='space-y-3'>
                {bottleneckAnalysis.identified_bottlenecks.slice(0, 3).map(
                  (
                    bottleneck: {
                      type: string
                      severity: string
                      description: string
                      affected_tasks: number
                    },
                    index: number
                  ) => (
                    <div key={index} className='flex items-start space-x-3'>
                      <Badge
                        variant={
                          bottleneck.severity === 'critical'
                            ? 'destructive'
                            : bottleneck.severity === 'high'
                              ? 'secondary'
                              : 'outline'
                        }
                      >
                        {bottleneck.severity}
                      </Badge>
                      <div className='flex-1'>
                        <p className='text-sm font-medium'>
                          {bottleneck.description}
                        </p>
                        <p className='text-muted-foreground text-xs'>
                          Affects {bottleneck.affected_tasks} tasks
                        </p>
                      </div>
                    </div>
                  )
                )}
              </div>
            </CardContent>
          </Card>
        )}

      {/* Queue Distribution */}
      {queueStats && (
        <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
          {/* By Priority */}
          <Card>
            <CardHeader>
              <CardTitle>Queue by Priority</CardTitle>
            </CardHeader>
            <CardContent>
              <div className='space-y-3'>
                {Object.entries(queueStats.queue_depth_by_priority || {}).map(
                  ([priority, count]) => (
                    <div
                      key={priority}
                      className='flex items-center justify-between'
                    >
                      <span className='text-sm font-medium capitalize'>
                        {priority} Priority
                      </span>
                      <Badge
                        variant={
                          priority === 'high'
                            ? 'destructive'
                            : priority === 'medium'
                              ? 'secondary'
                              : 'outline'
                        }
                      >
                        {count}
                      </Badge>
                    </div>
                  )
                )}
              </div>
            </CardContent>
          </Card>

          {/* By Task Type */}
          <Card>
            <CardHeader>
              <CardTitle>Queue by Task Type</CardTitle>
            </CardHeader>
            <CardContent>
              <div className='space-y-3'>
                {Object.entries(queueStats.queue_depth_by_type || {}).map(
                  ([type, count]) => (
                    <div
                      key={type}
                      className='flex items-center justify-between'
                    >
                      <span className='text-sm font-medium'>
                        {type.replace('_', ' ')}
                      </span>
                      <Badge variant='outline'>{count}</Badge>
                    </div>
                  )
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
