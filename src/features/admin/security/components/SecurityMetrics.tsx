import {
  IconActivity,
  IconAlertTriangle,
  IconCheck,
  IconExclamationMark,
  IconShield,
} from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { SecurityMetrics as SecurityMetricsType } from '../types'

interface SecurityMetricsProps {
  metrics: SecurityMetricsType
  isLoading?: boolean
}

export function SecurityMetrics({ metrics, isLoading }: SecurityMetricsProps) {
  const metricCards = [
    {
      title: 'Total Events',
      value: metrics.total_events,
      icon: IconActivity,
      color: 'blue',
      description: 'All security events',
    },
    {
      title: 'Critical Events',
      value: metrics.critical_events,
      icon: IconExclamationMark,
      color: 'red',
      description: 'Require immediate attention',
    },
    {
      title: 'High Priority',
      value: metrics.high_events,
      icon: IconAlertTriangle,
      color: 'orange',
      description: 'High severity events',
    },
    {
      title: 'Active Threats',
      value: metrics.active_threats,
      icon: IconShield,
      color: 'purple',
      description: 'Currently monitored threats',
    },
    {
      title: 'Resolved',
      value: metrics.resolved_events,
      icon: IconCheck,
      color: 'green',
      description: 'Successfully resolved events',
    },
  ]

  const getColorClasses = (color: string) => {
    const colorMap = {
      blue: 'text-blue-600 bg-blue-100 border-blue-200',
      red: 'text-red-600 bg-red-100 border-red-200',
      orange: 'text-orange-600 bg-orange-100 border-orange-200',
      purple: 'text-purple-600 bg-purple-100 border-purple-200',
      green: 'text-green-600 bg-green-100 border-green-200',
    }
    return colorMap[color as keyof typeof colorMap] || colorMap.blue
  }

  const getIconColorClass = (color: string) => {
    const colorMap = {
      blue: 'text-blue-600',
      red: 'text-red-600',
      orange: 'text-orange-600',
      purple: 'text-purple-600',
      green: 'text-green-600',
    }
    return colorMap[color as keyof typeof colorMap] || colorMap.blue
  }

  if (isLoading) {
    return (
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5'>
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <Skeleton className='h-4 w-20' />
              <Skeleton className='h-4 w-4' />
            </CardHeader>
            <CardContent>
              <Skeleton className='mb-1 h-8 w-16' />
              <Skeleton className='h-3 w-24' />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5'>
      {metricCards.map((metric) => {
        const IconComponent = metric.icon
        const isHighValue = metric.color === 'red' && metric.value > 0
        const isWarning = metric.color === 'orange' && metric.value > 5

        return (
          <Card
            key={metric.title}
            className={isHighValue ? 'border-red-200 bg-red-50' : ''}
          >
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-muted-foreground text-sm font-medium'>
                {metric.title}
              </CardTitle>
              <div
                className={`rounded-md p-2 ${getColorClasses(metric.color)}`}
              >
                <IconComponent
                  className={`h-4 w-4 ${getIconColorClass(metric.color)}`}
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className='flex items-center space-x-2'>
                <div className='text-2xl font-bold'>
                  {metric.value.toLocaleString()}
                </div>
                {isHighValue && (
                  <Badge variant='destructive' className='text-xs'>
                    Urgent
                  </Badge>
                )}
                {isWarning && (
                  <Badge variant='secondary' className='text-xs'>
                    Review
                  </Badge>
                )}
              </div>
              <p className='text-muted-foreground mt-1 text-xs'>
                {metric.description}
              </p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
