import { useEffect, useState } from 'react'
import {
  IconActivity,
  IconAlertTriangle,
  IconEye,
  IconRadar,
  IconRefresh,
  IconShield,
  IconUsers,
} from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { useThreatDetection } from '../hooks/use-security-monitoring'

export function ThreatMonitor() {
  const [monitoringActive, setMonitoringActive] = useState(true)
  const [scanProgress, setScanProgress] = useState(0)
  const { suspiciousSessions, isLoading } = useThreatDetection()

  // Simulate real-time monitoring progress
  useEffect(() => {
    if (!monitoringActive) return

    const interval = setInterval(() => {
      setScanProgress((prev) => {
        if (prev >= 100) return 0
        return prev + Math.random() * 5
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [monitoringActive])

  const mockRealTimeStats = {
    activeScans: 3,
    threatsBlocked: 15,
    sessionMonitored: 247,
    anomaliesDetected: 2,
  }

  if (isLoading) {
    return (
      <div className='space-y-6'>
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className='p-4'>
                <Skeleton className='mb-2 h-4 w-20' />
                <Skeleton className='mb-1 h-8 w-12' />
                <Skeleton className='h-3 w-16' />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className='p-6'>
            <Skeleton className='mb-4 h-6 w-32' />
            <Skeleton className='mb-2 h-4 w-full' />
            <Skeleton className='h-20 w-full' />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className='space-y-6'>
      {/* Real-time Stats */}
      <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
        <Card>
          <CardContent className='p-4'>
            <div className='flex items-center space-x-2'>
              <IconRadar className='h-5 w-5 text-blue-500' />
              <div>
                <div className='text-2xl font-bold'>
                  {mockRealTimeStats.activeScans}
                </div>
                <div className='text-muted-foreground text-xs'>
                  Active Scans
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className='p-4'>
            <div className='flex items-center space-x-2'>
              <IconShield className='h-5 w-5 text-green-500' />
              <div>
                <div className='text-2xl font-bold'>
                  {mockRealTimeStats.threatsBlocked}
                </div>
                <div className='text-muted-foreground text-xs'>
                  Threats Blocked
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className='p-4'>
            <div className='flex items-center space-x-2'>
              <IconUsers className='h-5 w-5 text-purple-500' />
              <div>
                <div className='text-2xl font-bold'>
                  {mockRealTimeStats.sessionMonitored}
                </div>
                <div className='text-muted-foreground text-xs'>
                  Sessions Monitored
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className='p-4'>
            <div className='flex items-center space-x-2'>
              <IconAlertTriangle className='h-5 w-5 text-orange-500' />
              <div>
                <div className='text-2xl font-bold'>
                  {mockRealTimeStats.anomaliesDetected}
                </div>
                <div className='text-muted-foreground text-xs'>
                  Anomalies Detected
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Monitoring Status */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center justify-between'>
            <div className='flex items-center space-x-2'>
              <IconActivity className='h-5 w-5' />
              <span>Real-time Threat Monitoring</span>
              <Badge variant={monitoringActive ? 'default' : 'secondary'}>
                {monitoringActive ? 'ACTIVE' : 'PAUSED'}
              </Badge>
            </div>
            <Button
              variant='outline'
              size='sm'
              onClick={() => setMonitoringActive(!monitoringActive)}
            >
              <IconRefresh className='mr-1 h-4 w-4' />
              {monitoringActive ? 'Pause' : 'Resume'}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className='space-y-4'>
            <div>
              <div className='mb-2 flex justify-between text-sm'>
                <span>System Scan Progress</span>
                <span>{Math.round(scanProgress)}%</span>
              </div>
              <Progress value={scanProgress} className='h-2' />
            </div>

            <div className='grid grid-cols-1 gap-4 text-sm md:grid-cols-3'>
              <div>
                <div className='mb-1 font-medium'>Network Monitoring</div>
                <div className='flex items-center text-green-600'>
                  <div className='mr-2 h-2 w-2 rounded-full bg-green-500'></div>
                  Operational
                </div>
              </div>
              <div>
                <div className='mb-1 font-medium'>User Behavior Analysis</div>
                <div className='flex items-center text-green-600'>
                  <div className='mr-2 h-2 w-2 rounded-full bg-green-500'></div>
                  Operational
                </div>
              </div>
              <div>
                <div className='mb-1 font-medium'>Threat Intelligence</div>
                <div className='flex items-center text-green-600'>
                  <div className='mr-2 h-2 w-2 rounded-full bg-green-500'></div>
                  Operational
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Suspicious Sessions */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center space-x-2'>
            <IconEye className='h-5 w-5' />
            <span>Suspicious Sessions</span>
            {suspiciousSessions.length > 0 && (
              <Badge variant='destructive'>{suspiciousSessions.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {suspiciousSessions.length === 0 ? (
            <div className='text-muted-foreground py-6 text-center'>
              <IconShield className='mx-auto mb-2 h-8 w-8 text-green-500' />
              <div>No suspicious sessions detected</div>
            </div>
          ) : (
            <div className='space-y-3'>
              {suspiciousSessions.map((session, index) => (
                <Card key={index} className='border-orange-200 bg-orange-50'>
                  <CardContent className='p-3'>
                    <div className='flex items-center justify-between'>
                      <div className='space-y-1'>
                        <div className='font-medium'>
                          Session ID: {session.session_id}
                        </div>
                        <div className='text-muted-foreground text-sm'>
                          Risk Score: {session.risk_score}/100
                        </div>
                        {session.risk_factors &&
                          session.risk_factors.length > 0 && (
                            <div className='text-xs'>
                              Factors: {session.risk_factors.join(', ')}
                            </div>
                          )}
                      </div>
                      <Button variant='outline' size='sm'>
                        Investigate
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
