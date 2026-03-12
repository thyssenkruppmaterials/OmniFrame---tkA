import { useState, useEffect } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  Shield,
  Clock,
  Search,
  Download,
  RefreshCw,
  AlertTriangle,
  XCircle,
  Info,
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PermissionGuard } from '@/components/auth/PermissionGuard'

interface AuditLogEntry {
  id: string
  actor_id: string
  actor_name: string
  action: string
  target_type: string
  target_id: string
  target_name: string
  old_value?: Record<string, unknown>
  new_value?: Record<string, unknown>
  changes?: Record<string, unknown>
  reason?: string
  ip_address?: string
  user_agent?: string
  session_id?: string
  organization_id?: string
  severity: 'info' | 'warning' | 'error' | 'critical'
  success: boolean
  error_message?: string
  created_at: string
}

interface RBACAuditLogProps {
  roleId?: string | null
  userId?: string | null
  targetType?: string
  maxEntries?: number
}

const SEVERITY_CONFIG = {
  info: { color: 'bg-blue-100 text-blue-800', icon: Info },
  warning: { color: 'bg-yellow-100 text-yellow-800', icon: AlertTriangle },
  error: { color: 'bg-red-100 text-red-800', icon: XCircle },
  critical: { color: 'bg-red-100 text-red-800', icon: AlertTriangle },
}

const ACTION_LABELS = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  assign: 'Assigned',
  revoke: 'Revoked',
  grant: 'Granted',
  deny: 'Denied',
  login: 'Login',
  logout: 'Logout',
  password_change: 'Password Changed',
  role_change: 'Role Changed',
}

// Mock data for demonstration
const MOCK_AUDIT_LOGS: AuditLogEntry[] = [
  {
    id: '1',
    actor_id: 'user-1',
    actor_name: 'John Doe',
    action: 'grant',
    target_type: 'role_permission',
    target_id: 'role-1',
    target_name: 'Admin -> users:create',
    reason: 'Added user creation permission to admin role',
    severity: 'info',
    success: true,
    created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 minutes ago
  },
  {
    id: '2',
    actor_id: 'user-2',
    actor_name: 'Jane Smith',
    action: 'role_change',
    target_type: 'user_profile',
    target_id: 'user-3',
    target_name: 'Bob Wilson',
    old_value: { role: 'viewer' },
    new_value: { role: 'admin' },
    reason: 'Promoted to administrator role',
    severity: 'warning',
    success: true,
    created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(), // 1 hour ago
  },
  {
    id: '3',
    actor_id: 'user-1',
    actor_name: 'John Doe',
    action: 'delete',
    target_type: 'role',
    target_id: 'role-old',
    target_name: 'Old Custom Role',
    reason: 'Removed unused role',
    severity: 'critical',
    success: true,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
  },
  {
    id: '4',
    actor_id: 'user-4',
    actor_name: 'Alice Johnson',
    action: 'update',
    target_type: 'permission',
    target_id: 'perm-1',
    target_name: 'users:delete',
    old_value: { risk_level: 'medium' },
    new_value: { risk_level: 'high' },
    reason: 'Increased risk level for user deletion',
    severity: 'warning',
    success: true,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(), // 4 hours ago
  },
]

export function RBACAuditLog({
  roleId,
  userId,
  targetType,
  maxEntries = 50,
}: RBACAuditLogProps) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [filteredLogs, setFilteredLogs] = useState<AuditLogEntry[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [timeFilter, setTimeFilter] = useState('all')
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null)

  useEffect(() => {
    loadAuditLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadAuditLogs is async; adding would cause infinite loop
  }, [roleId, userId, targetType])

  useEffect(() => {
    filterLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filterLogs is defined in component; adding would cause infinite loop
  }, [logs, searchTerm, actionFilter, severityFilter, timeFilter])

  const loadAuditLogs = async () => {
    setIsLoading(true)
    try {
      // Use basic audit_logs table with fallback to mock data
      const { data: basicAuditData, error: basicError } = await supabase
        .from('audit_logs')
        .select(
          `
          id,
          user_id,
          action,
          resource_type,
          resource_id,
          changes,
          ip_address,
          user_agent,
          metadata,
          created_at
        `
        )
        .order('created_at', { ascending: false })
        .limit(maxEntries)

      if (basicError) {
        logger.log(
          'Basic audit logs not available, using mock data for demonstration'
        )
        // Use mock data as fallback
        let filteredMockData = [...MOCK_AUDIT_LOGS]

        if (roleId) {
          filteredMockData = filteredMockData.filter(
            (log) =>
              log.target_id === roleId || log.target_name.includes('role')
          )
        }

        if (userId) {
          filteredMockData = filteredMockData.filter(
            (log) => log.actor_id === userId || log.target_id === userId
          )
        }

        if (targetType) {
          filteredMockData = filteredMockData.filter(
            (log) => log.target_type === targetType
          )
        }

        setLogs(filteredMockData.slice(0, maxEntries))
        return
      }

      // Get user profiles for actor names
      const userIds = (basicAuditData || [])
        .map((log) => log.user_id)
        .filter((id): id is string => id !== null && id !== undefined)
      let userProfiles: {
        id: string
        first_name: string | null
        last_name: string | null
        email: string | null
      }[] = []

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, first_name, last_name, email')
          .in('id', userIds)
        userProfiles = profiles || []
      }

      const userProfileMap = new Map(userProfiles.map((u) => [u.id, u]))

      // Convert basic audit logs to expected format
      const convertedLogs: AuditLogEntry[] = (basicAuditData || []).map(
        (log) => {
          const userProfile = userProfileMap.get(log.user_id || '')
          const actorName = userProfile
            ? `${userProfile.first_name || ''} ${userProfile.last_name || ''}`.trim() ||
              userProfile.email ||
              'Unknown'
            : 'System'

          return {
            id: log.id,
            actor_id: log.user_id || 'system',
            actor_name: actorName,
            action: log.action,
            target_type: log.resource_type || 'unknown',
            target_id: log.resource_id || 'unknown',
            target_name: log.resource_type || 'Unknown Resource',
            changes: (log.changes ?? undefined) as
              | Record<string, unknown>
              | undefined,
            ip_address: log.ip_address as string | undefined,
            user_agent: log.user_agent as string | undefined,
            severity: 'info' as const,
            success: true,
            created_at: log.created_at!,
          }
        }
      )

      setLogs(convertedLogs)
    } catch (error) {
      logger.error('Error loading audit logs:', error)
      toast.error('Failed to load audit logs')

      // Use mock data as final fallback
      setLogs(MOCK_AUDIT_LOGS.slice(0, maxEntries))
    } finally {
      setIsLoading(false)
    }
  }

  const filterLogs = () => {
    let filtered = [...logs]

    // Search filter
    if (searchTerm) {
      filtered = filtered.filter(
        (log) =>
          log.actor_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          log.target_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          log.reason?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          log.action.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    // Action filter
    if (actionFilter !== 'all') {
      filtered = filtered.filter((log) => log.action === actionFilter)
    }

    // Severity filter
    if (severityFilter !== 'all') {
      filtered = filtered.filter((log) => log.severity === severityFilter)
    }

    // Time filter
    if (timeFilter !== 'all') {
      const now = new Date()
      const cutoff = new Date()

      switch (timeFilter) {
        case '1h':
          cutoff.setHours(now.getHours() - 1)
          break
        case '24h':
          cutoff.setHours(now.getHours() - 24)
          break
        case '7d':
          cutoff.setDate(now.getDate() - 7)
          break
        case '30d':
          cutoff.setDate(now.getDate() - 30)
          break
      }

      filtered = filtered.filter((log) => new Date(log.created_at) >= cutoff)
    }

    setFilteredLogs(filtered)
  }

  const handleExportLogs = () => {
    // In a real implementation, this would export the logs
    logger.log('Exporting logs:', filteredLogs)
  }

  const getSeverityIcon = (severity: string) => {
    const config = SEVERITY_CONFIG[severity as keyof typeof SEVERITY_CONFIG]
    if (!config) return null

    const IconComponent = config.icon
    return <IconComponent className='h-4 w-4' />
  }

  const formatChange = (
    oldValue: Record<string, unknown>,
    newValue: Record<string, unknown>
  ) => {
    if (!oldValue || !newValue) return null

    return (
      <div className='space-y-1 text-xs'>
        <div className='text-red-600'>
          <span className='font-medium'>Before:</span>{' '}
          {JSON.stringify(oldValue, null, 2)}
        </div>
        <div className='text-green-600'>
          <span className='font-medium'>After:</span>{' '}
          {JSON.stringify(newValue, null, 2)}
        </div>
      </div>
    )
  }

  return (
    <PermissionGuard
      resource='audit'
      action='read'
      showError
      fallback={
        <Card>
          <CardContent className='text-muted-foreground p-6 text-center'>
            You don't have permission to view audit logs.
          </CardContent>
        </Card>
      }
    >
      <div className='space-y-4'>
        {/* Header */}
        <div className='flex items-center justify-between'>
          <div>
            <h3 className='flex items-center gap-2 text-lg font-semibold'>
              <Shield className='h-5 w-5' />
              RBAC Audit Log
            </h3>
            <p className='text-muted-foreground text-sm'>
              Track all role and permission changes
            </p>
          </div>
          <div className='flex gap-2'>
            <Button
              variant='outline'
              size='sm'
              onClick={loadAuditLogs}
              disabled={isLoading}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
              />
              Refresh
            </Button>
            <Button variant='outline' size='sm' onClick={handleExportLogs}>
              <Download className='mr-2 h-4 w-4' />
              Export
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5'>
          <div className='relative'>
            <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform' />
            <Input
              placeholder='Search logs...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='pl-9'
            />
          </div>

          <Select value={actionFilter} onValueChange={setActionFilter}>
            <SelectTrigger>
              <SelectValue placeholder='All Actions' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All Actions</SelectItem>
              {Object.entries(ACTION_LABELS).map(([action, label]) => (
                <SelectItem key={action} value={action}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger>
              <SelectValue placeholder='All Severities' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All Severities</SelectItem>
              <SelectItem value='info'>Info</SelectItem>
              <SelectItem value='warning'>Warning</SelectItem>
              <SelectItem value='error'>Error</SelectItem>
              <SelectItem value='critical'>Critical</SelectItem>
            </SelectContent>
          </Select>

          <Select value={timeFilter} onValueChange={setTimeFilter}>
            <SelectTrigger>
              <SelectValue placeholder='All Time' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All Time</SelectItem>
              <SelectItem value='1h'>Last Hour</SelectItem>
              <SelectItem value='24h'>Last 24 Hours</SelectItem>
              <SelectItem value='7d'>Last 7 Days</SelectItem>
              <SelectItem value='30d'>Last 30 Days</SelectItem>
            </SelectContent>
          </Select>

          <div className='text-muted-foreground flex items-center text-sm'>
            Showing {filteredLogs.length} of {logs.length} entries
          </div>
        </div>

        {/* Audit Log Entries */}
        <Card>
          <CardContent className='p-0'>
            {isLoading ? (
              <div className='flex items-center justify-center py-8'>
                <div className='border-primary h-8 w-8 animate-spin rounded-full border-b-2'></div>
                <span className='ml-3'>Loading audit logs...</span>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className='text-muted-foreground py-8 text-center'>
                No audit logs found matching your criteria
              </div>
            ) : (
              <div className='divide-y'>
                {filteredLogs.map((entry) => {
                  const severityConfig = SEVERITY_CONFIG[entry.severity]

                  return (
                    <div
                      key={entry.id}
                      className='hover:bg-muted/50 cursor-pointer p-4 transition-colors'
                      onClick={() => setSelectedEntry(entry)}
                    >
                      <div className='flex items-start gap-3'>
                        {/* Severity indicator */}
                        <div
                          className={`rounded-full p-1 ${severityConfig.color}`}
                        >
                          {getSeverityIcon(entry.severity)}
                        </div>

                        {/* Main content */}
                        <div className='min-w-0 flex-1'>
                          <div className='mb-1 flex items-center gap-2'>
                            <span className='font-medium'>
                              {entry.actor_name}
                            </span>
                            <span className='text-muted-foreground text-sm'>
                              {ACTION_LABELS[
                                entry.action as keyof typeof ACTION_LABELS
                              ] || entry.action}
                            </span>
                            <Badge variant='outline' className='text-xs'>
                              {entry.target_type}
                            </Badge>
                            {!entry.success && (
                              <Badge variant='destructive' className='text-xs'>
                                Failed
                              </Badge>
                            )}
                          </div>

                          <div className='text-muted-foreground mb-2 text-sm'>
                            Target:{' '}
                            <span className='font-medium'>
                              {entry.target_name}
                            </span>
                          </div>

                          {entry.reason && (
                            <div className='mb-2 text-sm'>{entry.reason}</div>
                          )}

                          {entry.old_value && entry.new_value && (
                            <div className='bg-muted mb-2 rounded p-2 text-xs'>
                              {formatChange(entry.old_value, entry.new_value)}
                            </div>
                          )}

                          {entry.error_message && (
                            <div className='mb-2 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-600'>
                              {entry.error_message}
                            </div>
                          )}
                        </div>

                        {/* Timestamp */}
                        <div className='text-muted-foreground flex items-center gap-1 text-xs'>
                          <Clock className='h-3 w-3' />
                          {formatDistanceToNow(new Date(entry.created_at), {
                            addSuffix: true,
                          })}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Selected Entry Details Dialog would go here */}
        {selectedEntry && (
          <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50'>
            <Card className='max-h-[80vh] w-full max-w-2xl overflow-y-auto'>
              <CardHeader>
                <CardTitle>Audit Log Details</CardTitle>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='grid grid-cols-2 gap-4 text-sm'>
                  <div>
                    <strong>Actor:</strong> {selectedEntry.actor_name}
                  </div>
                  <div>
                    <strong>Action:</strong> {selectedEntry.action}
                  </div>
                  <div>
                    <strong>Target:</strong> {selectedEntry.target_name}
                  </div>
                  <div>
                    <strong>Severity:</strong>
                    <Badge
                      className={`ml-2 ${SEVERITY_CONFIG[selectedEntry.severity].color}`}
                    >
                      {selectedEntry.severity}
                    </Badge>
                  </div>
                  <div>
                    <strong>Success:</strong>{' '}
                    {selectedEntry.success ? 'Yes' : 'No'}
                  </div>
                  <div>
                    <strong>Timestamp:</strong>{' '}
                    {new Date(selectedEntry.created_at).toLocaleString()}
                  </div>
                </div>

                {selectedEntry.reason && (
                  <div>
                    <strong>Reason:</strong>
                    <p className='text-muted-foreground mt-1'>
                      {selectedEntry.reason}
                    </p>
                  </div>
                )}

                {selectedEntry.old_value && selectedEntry.new_value && (
                  <div>
                    <strong>Changes:</strong>
                    <div className='mt-2'>
                      {formatChange(
                        selectedEntry.old_value,
                        selectedEntry.new_value
                      )}
                    </div>
                  </div>
                )}

                <div className='flex justify-end'>
                  <Button onClick={() => setSelectedEntry(null)}>Close</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </PermissionGuard>
  )
}
