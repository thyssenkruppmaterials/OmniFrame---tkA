/**
 * Analytics Dashboard Component
 * Comprehensive analytics and reporting for work queue system
 * Shows performance trends, bottleneck analysis, and detailed metrics
 */
import { useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle,
  Clock,
  Download,
  PieChart,
  RefreshCw,
  Users,
} from 'lucide-react'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useWorkQueue } from '../context/work-queue-context-simple'

export function AnalyticsDashboard() {
  const {
    realtimeMetrics,
    bottleneckAnalysis,
    isLoadingStats,
    refreshAllData,
  } = useWorkQueue()

  const [selectedPeriod, setSelectedPeriod] = useState('7d')

  const handleExportReport = () => {
    logger.log('Export analytics report')
    // Would implement report export functionality
  }

  const handlePeriodChange = (period: string) => {
    setSelectedPeriod(period)
    // Would reload data for selected period
  }

  return (
    <div className='space-y-6'>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='text-lg font-semibold'>Analytics Dashboard</h3>
          <p className='text-muted-foreground text-sm'>
            Performance insights and system analytics
          </p>
        </div>
        <div className='flex items-center space-x-2'>
          <select
            value={selectedPeriod}
            onChange={(e) => handlePeriodChange(e.target.value)}
            className='border-input bg-background h-9 rounded-md border px-3 text-sm'
          >
            <option value='1d'>Last 24 Hours</option>
            <option value='7d'>Last 7 Days</option>
            <option value='30d'>Last 30 Days</option>
            <option value='90d'>Last 90 Days</option>
          </select>
          <Button variant='outline' size='sm' onClick={handleExportReport}>
            <Download className='mr-2 h-4 w-4' />
            Export
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={refreshAllData}
            disabled={isLoadingStats}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isLoadingStats ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* Key Performance Indicators */}
      {realtimeMetrics && (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
          <Card>
            <CardContent className='p-4'>
              <div className='flex items-center justify-between'>
                <div>
                  <div className='mb-1 flex items-center space-x-2'>
                    <Clock className='h-4 w-4 text-blue-600' />
                    <span className='text-sm font-medium'>Avg Wait Time</span>
                  </div>
                  <div className='text-2xl font-bold'>
                    {realtimeMetrics.average_wait_time}min
                  </div>
                </div>
                <div className='text-right'>
                  <Badge
                    variant={
                      realtimeMetrics.average_wait_time > 30
                        ? 'secondary'
                        : 'default'
                    }
                  >
                    {realtimeMetrics.average_wait_time > 30 ? 'High' : 'Good'}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className='p-4'>
              <div className='flex items-center justify-between'>
                <div>
                  <div className='mb-1 flex items-center space-x-2'>
                    <BarChart3 className='h-4 w-4 text-green-600' />
                    <span className='text-sm font-medium'>Throughput</span>
                  </div>
                  <div className='text-2xl font-bold'>
                    {realtimeMetrics.tasks_per_minute}
                  </div>
                  <div className='text-muted-foreground text-xs'>tasks/min</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className='p-4'>
              <div className='flex items-center justify-between'>
                <div>
                  <div className='mb-1 flex items-center space-x-2'>
                    <Users className='h-4 w-4 text-purple-600' />
                    <span className='text-sm font-medium'>Utilization</span>
                  </div>
                  <div className='text-2xl font-bold'>
                    {realtimeMetrics.worker_utilization}%
                  </div>
                </div>
                <div className='text-right'>
                  <Badge
                    variant={
                      realtimeMetrics.worker_utilization > 90
                        ? 'destructive'
                        : realtimeMetrics.worker_utilization > 70
                          ? 'secondary'
                          : 'default'
                    }
                  >
                    {realtimeMetrics.worker_utilization > 90
                      ? 'High'
                      : 'Normal'}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className='p-4'>
              <div className='flex items-center justify-between'>
                <div>
                  <div className='mb-1 flex items-center space-x-2'>
                    <CheckCircle className='h-4 w-4 text-green-600' />
                    <span className='text-sm font-medium'>SLA Compliance</span>
                  </div>
                  <div className='text-2xl font-bold'>
                    {realtimeMetrics.sla_compliance}%
                  </div>
                </div>
                <div className='text-right'>
                  <Badge
                    variant={
                      realtimeMetrics.sla_compliance >= 95
                        ? 'default'
                        : 'secondary'
                    }
                  >
                    {realtimeMetrics.sla_compliance >= 95
                      ? 'Good'
                      : 'Needs Attention'}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Bottleneck Analysis */}
      {bottleneckAnalysis && (
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center space-x-2'>
              <AlertTriangle className='h-5 w-5' />
              <span>System Health Analysis</span>
              <Badge
                variant={
                  bottleneckAnalysis.overall_health_score >= 80
                    ? 'default'
                    : bottleneckAnalysis.overall_health_score >= 60
                      ? 'secondary'
                      : 'destructive'
                }
              >
                Health Score: {bottleneckAnalysis.overall_health_score}%
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bottleneckAnalysis.identified_bottlenecks.length > 0 ? (
              <div className='space-y-4'>
                {bottleneckAnalysis.identified_bottlenecks.map(
                  (
                    bottleneck: {
                      type: string
                      severity: string
                      description: string
                      affected_tasks: number
                      recommended_actions: string[]
                    },
                    index: number
                  ) => (
                    <div key={index} className='rounded-lg border p-4'>
                      <div className='mb-2 flex items-start justify-between'>
                        <div className='flex items-center space-x-2'>
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
                          <span className='text-sm font-medium'>
                            {bottleneck.type.replace('_', ' ')}
                          </span>
                        </div>
                        <span className='text-muted-foreground text-xs'>
                          {bottleneck.affected_tasks} tasks affected
                        </span>
                      </div>
                      <p className='text-muted-foreground mb-3 text-sm'>
                        {bottleneck.description}
                      </p>
                      <div className='space-y-1'>
                        <span className='text-xs font-medium'>
                          Recommended Actions:
                        </span>
                        <ul className='text-muted-foreground space-y-1 text-xs'>
                          {bottleneck.recommended_actions.map(
                            (action: string, actionIndex: number) => (
                              <li
                                key={actionIndex}
                                className='flex items-center space-x-2'
                              >
                                <span>•</span>
                                <span>{action}</span>
                              </li>
                            )
                          )}
                        </ul>
                      </div>
                    </div>
                  )
                )}
              </div>
            ) : (
              <div className='py-8 text-center'>
                <CheckCircle className='mx-auto mb-4 h-12 w-12 text-green-600' />
                <h3 className='mb-2 text-lg font-semibold text-green-800'>
                  System Healthy
                </h3>
                <p className='text-muted-foreground'>
                  No bottlenecks or performance issues detected
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Performance Charts Placeholder */}
      <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>Task Completion Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-muted-foreground flex h-64 items-center justify-center'>
              <div className='text-center'>
                <BarChart3 className='mx-auto mb-4 h-12 w-12' />
                <p>Performance trends chart would be implemented here</p>
                <p className='text-xs'>Showing completion rates over time</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Worker Utilization</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='text-muted-foreground flex h-64 items-center justify-center'>
              <div className='text-center'>
                <PieChart className='mx-auto mb-4 h-12 w-12' />
                <p>Worker utilization chart would be implemented here</p>
                <p className='text-xs'>Showing capacity distribution</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
