// Created and developed by Jai Singh
import { useState, useEffect } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  IconShield,
  IconAlertTriangle,
  IconCheck,
  IconMapPin,
  IconUsers,
  IconRefresh,
  IconEye,
  IconLock,
  IconActivity,
  IconShieldLock,
  IconGlobe,
  IconReport,
  IconSearch,
} from '@tabler/icons-react'
import { logger } from '@/lib/utils/logger'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { useSessionManagementContext } from '../context/session-management-context'
import { SessionManagementService } from '../services/session-management.service'
import type { SecurityAlert } from '../types'

interface SecurityStats {
  activeAlerts: number
  resolvedToday: number
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  threatScore: number
  suspiciousIPs: number
  anomalousLogins: number
}

export function SecurityMonitoring() {
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null)
  const [viewingAlert, setViewingAlert] = useState<SecurityAlert | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [alertTypeFilter, setAlertTypeFilter] = useState('all')
  const [resolutionNotes, setResolutionNotes] = useState('')

  const [securityAlerts, setSecurityAlerts] = useState<SecurityAlert[]>([])
  const [securityStats, setSecurityStats] = useState<SecurityStats>({
    activeAlerts: 0,
    resolvedToday: 0,
    riskLevel: 'low',
    threatScore: 0,
    suspiciousIPs: 0,
    anomalousLogins: 0,
  })

  const {
    securityAlerts: contextAlerts,
    resolveSecurityAlert,
    generateSecurityReport,
  } = useSessionManagementContext()

  // Load security alerts and calculate stats
  useEffect(() => {
    loadSecurityData()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: run on mount only; loadSecurityData uses current state
  }, [])

  // Use context alerts when available
  useEffect(() => {
    if (contextAlerts && contextAlerts.length > 0) {
      setSecurityAlerts(contextAlerts)
      calculateSecurityStats(contextAlerts)
    }
  }, [contextAlerts])

  const loadSecurityData = async () => {
    setIsLoading(true)
    try {
      const alerts = await SessionManagementService.getSecurityAlerts()
      setSecurityAlerts(alerts)
      calculateSecurityStats(alerts)

      // Generate sample alerts if none exist for demo purposes
      if (alerts.length === 0) {
        await generateSampleAlerts()
      }
    } catch (error) {
      logger.error('Error loading security data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const generateSampleAlerts = async () => {
    // Generate sample security alerts for demonstration
    const sampleAlerts = [
      {
        userId: 'demo-user-1',
        alertType: 'multiple_logins' as const,
        severity: 'medium' as const,
        description:
          'Multiple concurrent sessions detected from different locations',
        metadata: { location: 'New York, USA → London, UK', sessions: 3 },
      },
      {
        userId: 'demo-user-2',
        alertType: 'unusual_location' as const,
        severity: 'high' as const,
        description: 'Login from unusual geographic location',
        metadata: {
          previousLocation: 'San Francisco, USA',
          newLocation: 'Moscow, Russia',
        },
      },
      {
        userId: 'demo-user-3',
        alertType: 'brute_force' as const,
        severity: 'critical' as const,
        description: '5 failed login attempts within 10 minutes',
        metadata: { attempts: 5, timeWindow: '10 minutes' },
      },
    ]

    for (const alert of sampleAlerts) {
      try {
        await SessionManagementService.createSecurityAlert(
          alert.userId,
          alert.alertType,
          alert.severity,
          alert.description,
          alert.metadata
        )
      } catch (error) {
        logger.warn('Error creating sample alert:', error)
      }
    }

    // Reload alerts after creating samples
    setTimeout(() => loadSecurityData(), 1000)
  }

  const calculateSecurityStats = (alerts: SecurityAlert[]): void => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    const activeAlerts = alerts.filter((alert) => !alert.resolved)
    const resolvedToday = alerts.filter(
      (alert) => alert.resolved && new Date(alert.timestamp) >= today
    )

    const criticalCount = activeAlerts.filter(
      (a) => a.severity === 'critical'
    ).length
    const highCount = activeAlerts.filter((a) => a.severity === 'high').length
    const mediumCount = activeAlerts.filter(
      (a) => a.severity === 'medium'
    ).length

    let riskLevel: SecurityStats['riskLevel'] = 'low'
    let threatScore = 0

    if (criticalCount > 0) {
      riskLevel = 'critical'
      threatScore = criticalCount * 40 + highCount * 25 + mediumCount * 15
    } else if (highCount > 1) {
      riskLevel = 'high'
      threatScore = highCount * 25 + mediumCount * 15
    } else if (highCount > 0 || mediumCount > 2) {
      riskLevel = 'medium'
      threatScore = highCount * 25 + mediumCount * 15
    }

    const suspiciousIPs = new Set(
      alerts.filter((a) => !a.resolved && a.ip_address).map((a) => a.ip_address)
    ).size

    const anomalousLogins = activeAlerts.filter((alert) =>
      ['unusual_location', 'multiple_logins', 'session_hijacking'].includes(
        alert.alert_type
      )
    ).length

    setSecurityStats({
      activeAlerts: activeAlerts.length,
      resolvedToday: resolvedToday.length,
      riskLevel,
      threatScore: Math.min(threatScore, 100),
      suspiciousIPs,
      anomalousLogins,
    })
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'destructive' as const
      case 'high':
        return 'destructive' as const
      case 'medium':
        return 'outline' as const
      case 'low':
        return 'secondary' as const
      default:
        return 'outline' as const
    }
  }

  const getAlertIcon = (alertType: string) => {
    switch (alertType) {
      case 'multiple_logins':
        return <IconUsers className='h-4 w-4' />
      case 'unusual_location':
        return <IconMapPin className='h-4 w-4' />
      case 'brute_force':
        return <IconLock className='h-4 w-4' />
      case 'session_hijacking':
        return <IconShieldLock className='h-4 w-4' />
      case 'privilege_escalation':
        return <IconActivity className='h-4 w-4' />
      case 'suspicious_activity':
        return <IconEye className='h-4 w-4' />
      case 'failed_authentication':
        return <IconShield className='h-4 w-4' />
      case 'account_lockout':
        return <IconLock className='h-4 w-4' />
      default:
        return <IconShield className='h-4 w-4' />
    }
  }

  const getRiskLevelColor = (level: string) => {
    switch (level) {
      case 'critical':
        return 'text-red-600 bg-red-50'
      case 'high':
        return 'text-orange-600 bg-orange-50'
      case 'medium':
        return 'text-yellow-600 bg-yellow-50'
      case 'low':
        return 'text-green-600 bg-green-50'
      default:
        return 'text-gray-600 bg-gray-50'
    }
  }

  const handleResolveAlert = async () => {
    if (!selectedAlert) return

    setIsResolving(true)
    try {
      await resolveSecurityAlert(selectedAlert)
      setResolutionNotes('')
      setSelectedAlert(null)

      // Reload security data to reflect changes
      await loadSecurityData()
    } catch (error) {
      logger.error('Error resolving alert:', error)
    } finally {
      setIsResolving(false)
    }
  }

  const handleViewAlert = (alert: SecurityAlert) => {
    setViewingAlert(alert)
  }

  const handleRefresh = async () => {
    await loadSecurityData()
  }

  const handleGenerateReport = async () => {
    try {
      await generateSecurityReport()
    } catch (error) {
      logger.error('Error generating security report:', error)
    }
  }

  const filteredAlerts = securityAlerts.filter((alert) => {
    const matchesSearch =
      !searchTerm ||
      (alert.user_name &&
        alert.user_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (alert.user_email &&
        alert.user_email.toLowerCase().includes(searchTerm.toLowerCase())) ||
      alert.description.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesSeverity =
      severityFilter === 'all' || alert.severity === severityFilter
    const matchesType =
      alertTypeFilter === 'all' || alert.alert_type === alertTypeFilter

    return matchesSearch && matchesSeverity && matchesType
  })

  const unresolvedAlerts = filteredAlerts.filter((alert) => !alert.resolved)
  const resolvedAlerts = filteredAlerts.filter((alert) => alert.resolved)

  return (
    <div className='space-y-6'>
      {/* Security Overview */}
      <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>Active Alerts</CardTitle>
            <IconAlertTriangle className='text-destructive h-4 w-4' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>
              {securityStats.activeAlerts}
            </div>
            <p className='text-muted-foreground text-xs'>Requiring attention</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>Risk Level</CardTitle>
            <IconShield className='h-4 w-4' />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold capitalize ${getRiskLevelColor(securityStats.riskLevel).split(' ')[0]}`}
            >
              {securityStats.riskLevel}
            </div>
            <p className='text-muted-foreground text-xs'>
              Threat Score: {securityStats.threatScore}/100
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>
              Suspicious IPs
            </CardTitle>
            <IconGlobe className='h-4 w-4 text-orange-500' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>
              {securityStats.suspiciousIPs}
            </div>
            <p className='text-muted-foreground text-xs'>Monitored addresses</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
            <CardTitle className='text-sm font-medium'>
              Resolved Today
            </CardTitle>
            <IconCheck className='h-4 w-4 text-green-500' />
          </CardHeader>
          <CardContent>
            <div className='text-2xl font-bold'>
              {securityStats.resolvedToday}
            </div>
            <p className='text-muted-foreground text-xs'>Incidents handled</p>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center space-x-4'>
          <div className='relative'>
            <IconSearch className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform' />
            <Input
              placeholder='Search alerts...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='w-64 pl-10'
            />
          </div>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className='w-32'>
              <SelectValue placeholder='Severity' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All Levels</SelectItem>
              <SelectItem value='critical'>Critical</SelectItem>
              <SelectItem value='high'>High</SelectItem>
              <SelectItem value='medium'>Medium</SelectItem>
              <SelectItem value='low'>Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={alertTypeFilter} onValueChange={setAlertTypeFilter}>
            <SelectTrigger className='w-48'>
              <SelectValue placeholder='Alert Type' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All Types</SelectItem>
              <SelectItem value='multiple_logins'>Multiple Logins</SelectItem>
              <SelectItem value='unusual_location'>Unusual Location</SelectItem>
              <SelectItem value='brute_force'>Brute Force</SelectItem>
              <SelectItem value='session_hijacking'>
                Session Hijacking
              </SelectItem>
              <SelectItem value='privilege_escalation'>
                Privilege Escalation
              </SelectItem>
              <SelectItem value='suspicious_activity'>
                Suspicious Activity
              </SelectItem>
            </SelectContent>
          </Select>
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
          <PermissionGuard resource='sessions' action='manage'>
            <Button variant='outline' size='sm' onClick={handleGenerateReport}>
              <IconReport className='mr-2 h-4 w-4' />
              Generate Report
            </Button>
          </PermissionGuard>
        </div>
      </div>

      {/* Active Security Alerts */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center space-x-2'>
            <IconAlertTriangle className='h-5 w-5' />
            <span>Active Security Alerts</span>
            <Badge variant='outline'>{unresolvedAlerts.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className='space-y-3'>
            {unresolvedAlerts.map((alert) => (
              <div
                key={alert.id}
                className='bg-muted/20 hover:bg-muted/30 flex items-center justify-between rounded-lg border p-4 transition-colors'
              >
                <div className='flex items-center space-x-4'>
                  <div className='flex-shrink-0'>
                    {getAlertIcon(alert.alert_type)}
                  </div>
                  <div className='min-w-0 flex-1'>
                    <div className='mb-1 flex items-center space-x-2'>
                      <span className='truncate font-medium'>
                        {alert.user_name || 'Unknown User'}
                      </span>
                      <Badge
                        variant={getSeverityColor(alert.severity)}
                        className='text-xs capitalize'
                      >
                        {alert.severity}
                      </Badge>
                    </div>
                    <p className='text-muted-foreground mb-1 line-clamp-2 text-sm'>
                      {alert.description}
                    </p>
                    <div className='text-muted-foreground flex items-center space-x-4 text-xs'>
                      {alert.ip_address && <span>IP: {alert.ip_address}</span>}
                      <span>
                        {formatDistanceToNow(new Date(alert.timestamp), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </div>
                </div>
                <div className='flex flex-shrink-0 items-center space-x-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => handleViewAlert(alert)}
                  >
                    <IconEye className='mr-2 h-4 w-4' />
                    Details
                  </Button>
                  <PermissionGuard resource='sessions' action='manage'>
                    <Button
                      variant='default'
                      size='sm'
                      onClick={() => setSelectedAlert(alert.id)}
                    >
                      <IconCheck className='mr-2 h-4 w-4' />
                      Resolve
                    </Button>
                  </PermissionGuard>
                </div>
              </div>
            ))}

            {unresolvedAlerts.length === 0 && (
              <div className='text-muted-foreground py-8 text-center'>
                <IconShield className='mx-auto mb-2 h-8 w-8' />
                <p>No active security alerts</p>
                <p className='text-sm'>
                  All security incidents have been resolved
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Resolved Alerts (Recent) */}
      {resolvedAlerts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center space-x-2'>
              <IconCheck className='h-5 w-5 text-green-500' />
              <span>Recently Resolved</span>
              <Badge variant='secondary'>{resolvedAlerts.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className='space-y-3'>
              {resolvedAlerts.slice(0, 5).map((alert) => (
                <div
                  key={alert.id}
                  className='flex items-center justify-between rounded-lg border p-3 opacity-60'
                >
                  <div className='flex items-center space-x-3'>
                    {getAlertIcon(alert.alert_type)}
                    <div>
                      <div className='font-medium'>
                        {alert.user_name || 'Unknown User'}
                      </div>
                      <div className='text-muted-foreground text-sm'>
                        {alert.description}
                      </div>
                      <div className='text-muted-foreground text-xs'>
                        Resolved{' '}
                        {formatDistanceToNow(new Date(alert.timestamp), {
                          addSuffix: true,
                        })}
                      </div>
                    </div>
                  </div>
                  <Badge variant='secondary'>
                    <IconCheck className='mr-1 h-3 w-3' />
                    Resolved
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Alert Details Dialog */}
      <Dialog open={!!viewingAlert} onOpenChange={() => setViewingAlert(null)}>
        <DialogContent className='max-w-2xl'>
          <DialogHeader>
            <DialogTitle className='flex items-center space-x-2'>
              {viewingAlert && getAlertIcon(viewingAlert.alert_type)}
              <span>Security Alert Details</span>
            </DialogTitle>
            <DialogDescription>
              Detailed information about this security incident
            </DialogDescription>
          </DialogHeader>
          {viewingAlert && (
            <div className='space-y-4'>
              <div className='grid grid-cols-2 gap-4'>
                <div>
                  <label className='text-sm font-medium'>User</label>
                  <p className='text-muted-foreground text-sm'>
                    {viewingAlert.user_name} ({viewingAlert.user_email})
                  </p>
                </div>
                <div>
                  <label className='text-sm font-medium'>Severity</label>
                  <p className='text-sm'>
                    <Badge
                      variant={getSeverityColor(viewingAlert.severity)}
                      className='capitalize'
                    >
                      {viewingAlert.severity}
                    </Badge>
                  </p>
                </div>
                <div>
                  <label className='text-sm font-medium'>Alert Type</label>
                  <p className='text-muted-foreground text-sm capitalize'>
                    {viewingAlert.alert_type.replace('_', ' ')}
                  </p>
                </div>
                <div>
                  <label className='text-sm font-medium'>IP Address</label>
                  <p className='text-muted-foreground text-sm'>
                    {viewingAlert.ip_address || 'Not available'}
                  </p>
                </div>
                <div>
                  <label className='text-sm font-medium'>Timestamp</label>
                  <p className='text-muted-foreground text-sm'>
                    {new Date(viewingAlert.timestamp).toLocaleString()}
                  </p>
                </div>
                <div>
                  <label className='text-sm font-medium'>Status</label>
                  <p className='text-sm'>
                    <Badge
                      variant={
                        viewingAlert.resolved ? 'secondary' : 'destructive'
                      }
                    >
                      {viewingAlert.resolved ? 'Resolved' : 'Active'}
                    </Badge>
                  </p>
                </div>
              </div>
              <div>
                <label className='text-sm font-medium'>Description</label>
                <p className='text-muted-foreground mt-1 text-sm'>
                  {viewingAlert.description}
                </p>
              </div>
              {viewingAlert.user_agent && (
                <div>
                  <label className='text-sm font-medium'>User Agent</label>
                  <p className='text-muted-foreground mt-1 font-mono text-sm text-xs'>
                    {viewingAlert.user_agent}
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Resolve Alert Confirmation Dialog */}
      <AlertDialog
        open={!!selectedAlert}
        onOpenChange={() => setSelectedAlert(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resolve Security Alert</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to mark this security alert as resolved?
              Make sure you have properly investigated and addressed the
              security concern.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className='my-4'>
            <label className='text-sm font-medium'>
              Resolution Notes (Optional)
            </label>
            <Textarea
              placeholder='Add any notes about how this alert was resolved...'
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              className='mt-1'
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setResolutionNotes('')}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleResolveAlert}
              disabled={isResolving}
            >
              {isResolving ? 'Resolving...' : 'Resolve Alert'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// Created and developed by Jai Singh
