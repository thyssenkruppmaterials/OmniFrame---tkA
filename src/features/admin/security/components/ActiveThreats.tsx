import { format } from 'date-fns'
import {
  IconAlertTriangle,
  IconCheck,
  IconEyeOff,
  IconShield,
} from '@tabler/icons-react'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useThreatDetection } from '../hooks/use-security-monitoring'
import type { ThreatIndicator } from '../types'

interface ActiveThreatsProps {
  threats: ThreatIndicator[]
  isLoading?: boolean
  showActions?: boolean
}

export function ActiveThreats({
  threats,
  isLoading,
  showActions,
}: ActiveThreatsProps) {
  const { deactivateThreatIndicator } = useThreatDetection()

  const getThreatLevelColor = (level: string) => {
    const colors = {
      low: 'bg-blue-100 text-blue-800 border-blue-300',
      medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      high: 'bg-red-100 text-red-800 border-red-300',
    }
    return colors[level as keyof typeof colors] || colors.low
  }

  const getThreatTypeIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'ip':
      case 'ip_address':
        return <IconShield className='h-4 w-4' />
      case 'domain':
      case 'url':
        return <IconAlertTriangle className='h-4 w-4' />
      default:
        return <IconAlertTriangle className='h-4 w-4' />
    }
  }

  const handleDeactivate = async (threatId: string) => {
    try {
      await deactivateThreatIndicator.mutateAsync(threatId)
    } catch (error) {
      logger.error('Failed to deactivate threat:', error)
    }
  }

  if (isLoading) {
    return (
      <div className='space-y-3'>
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className='p-3'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center space-x-3'>
                  <Skeleton className='h-4 w-4' />
                  <div>
                    <Skeleton className='mb-1 h-4 w-32' />
                    <Skeleton className='h-3 w-24' />
                  </div>
                </div>
                <Skeleton className='h-5 w-12' />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (threats.length === 0) {
    return (
      <div className='py-6 text-center'>
        <IconCheck className='mx-auto mb-3 h-10 w-10 text-green-500' />
        <h3 className='mb-1 font-medium text-gray-900'>No Active Threats</h3>
        <p className='text-sm text-gray-500'>
          All clear! No threat indicators are currently active.
        </p>
      </div>
    )
  }

  return (
    <div className='space-y-3'>
      {threats.map((threat) => (
        <Card key={threat.id}>
          <CardContent className='p-3'>
            <div className='flex items-start justify-between space-x-3'>
              <div className='flex min-w-0 flex-1 items-start space-x-3'>
                <div className='mt-0.5'>
                  {getThreatTypeIcon(threat.indicator_type)}
                </div>
                <div className='min-w-0 flex-1'>
                  <div className='mb-1 flex items-center space-x-2'>
                    <span className='truncate text-sm font-medium'>
                      {threat.value}
                    </span>
                    <Badge className={getThreatLevelColor(threat.threat_level)}>
                      {threat.threat_level.toUpperCase()}
                    </Badge>
                  </div>
                  <div className='mb-1 text-xs text-gray-600'>
                    Type: {threat.indicator_type.toUpperCase()}
                  </div>
                  {threat.description && (
                    <div className='mb-2 text-xs text-gray-500'>
                      {threat.description}
                    </div>
                  )}
                  <div className='text-xs text-gray-400'>
                    Detected:{' '}
                    {format(new Date(threat.created_at), 'MMM dd, HH:mm')}
                  </div>
                </div>
              </div>

              {showActions && (
                <div className='flex space-x-1'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => handleDeactivate(threat.id)}
                    disabled={deactivateThreatIndicator.isPending}
                  >
                    <IconEyeOff className='h-3 w-3' />
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
