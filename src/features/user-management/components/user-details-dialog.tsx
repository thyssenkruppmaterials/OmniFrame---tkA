import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import {
  User,
  Mail,
  Phone,
  Shield,
  Calendar,
  Clock,
  CheckCircle,
  XCircle,
  Activity,
  Loader2,
} from 'lucide-react'
import { logger } from '@/lib/utils/logger'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useUserManagement } from '../hooks/use-user-management'
import type { UserProfile, UserPermission, UserActivity } from '../types'

interface UserDetailsDialogProps {
  userId?: string
  user?: UserProfile | null
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function UserDetailsDialog({
  userId,
  user: initialUser,
  open = false,
  onOpenChange,
}: UserDetailsDialogProps) {
  const { getUserById, getUserPermissions, getUserActivity } =
    useUserManagement()
  const [user, setUser] = useState<UserProfile | null>(initialUser || null)
  const [permissions, setPermissions] = useState<UserPermission[]>([])
  const [activity, setActivity] = useState<UserActivity[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')

  // Load user data when dialog opens
  useEffect(() => {
    if (open && (userId || initialUser)) {
      loadUserData()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadUserData is defined below; runs on dialog open
  }, [open, userId, initialUser])

  const loadUserData = async () => {
    if (!userId && !initialUser) return

    setLoading(true)
    try {
      let userData = initialUser
      if (userId && !initialUser) {
        userData = await getUserById(userId)
        setUser(userData)
      }

      if (userData) {
        // Load permissions and activity in parallel
        const [userPermissions, userActivity] = await Promise.all([
          getUserPermissions(userData.id),
          getUserActivity(userData.id),
        ])
        setPermissions(userPermissions)
        setActivity(userActivity)
      }
    } catch (error) {
      logger.error('Error loading user data:', error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    const colors = {
      active:
        'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300',
      inactive:
        'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300',
      invited:
        'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300',
      suspended: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300',
    }
    return colors[status as keyof typeof colors] || colors.inactive
  }

  const getRoleColor = (role: string) => {
    const colors = {
      superadmin:
        'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300',
      admin: 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300',
      manager:
        'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-300',
      cashier:
        'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300',
      viewer:
        'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300',
    }
    return colors[role as keyof typeof colors] || colors.viewer
  }

  if (!user) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='max-w-4xl'>
          <DialogHeader>
            <DialogTitle>User Details</DialogTitle>
          </DialogHeader>
          <div className='flex items-center justify-center py-8'>
            <p className='text-muted-foreground'>No user selected</p>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  const initials =
    `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase()
  const fullName =
    user.full_name ||
    `${user.first_name || ''} ${user.last_name || ''}`.trim() ||
    'Unnamed User'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] max-w-4xl overflow-hidden'>
        <DialogHeader>
          <DialogTitle>User Details</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className='flex items-center justify-center py-8'>
            <Loader2 className='mr-2 h-6 w-6 animate-spin' />
            <span>Loading user details...</span>
          </div>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className='h-full'
          >
            <TabsList className='grid w-full grid-cols-3'>
              <TabsTrigger value='overview'>Overview</TabsTrigger>
              <TabsTrigger value='permissions'>Permissions</TabsTrigger>
              <TabsTrigger value='activity'>Activity</TabsTrigger>
            </TabsList>

            <ScrollArea className='h-[600px] w-full'>
              <TabsContent value='overview' className='space-y-4'>
                {/* User Profile Card */}
                <Card>
                  <CardHeader>
                    <div className='flex items-center space-x-4'>
                      <Avatar className='h-16 w-16'>
                        <AvatarImage
                          src={user.avatar_url || ''}
                          alt={fullName}
                        />
                        <AvatarFallback className='text-lg'>
                          {initials || 'U'}
                        </AvatarFallback>
                      </Avatar>
                      <div className='flex-1'>
                        <CardTitle className='text-xl'>{fullName}</CardTitle>
                        <CardDescription>{user.email}</CardDescription>
                        <div className='mt-2 flex items-center gap-2'>
                          <Badge
                            variant='outline'
                            className={getRoleColor(user.role || '')}
                          >
                            {user.role || 'No Role'}
                          </Badge>
                          <Badge
                            variant='outline'
                            className={getStatusColor(
                              user.status || 'inactive'
                            )}
                          >
                            {user.status || 'inactive'}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                </Card>

                {/* Account Details */}
                <Card>
                  <CardHeader>
                    <CardTitle>Account Details</CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-4'>
                    <div className='grid grid-cols-2 gap-4'>
                      <div className='space-y-2'>
                        <div className='flex items-center space-x-2'>
                          <User className='text-muted-foreground h-4 w-4' />
                          <span className='text-sm font-medium'>Username:</span>
                          <span className='text-sm'>
                            {user.username || 'Not set'}
                          </span>
                        </div>
                        <div className='flex items-center space-x-2'>
                          <Mail className='text-muted-foreground h-4 w-4' />
                          <span className='text-sm font-medium'>
                            Email Verified:
                          </span>
                          {user.email_verified ? (
                            <CheckCircle className='h-4 w-4 text-green-600' />
                          ) : (
                            <XCircle className='h-4 w-4 text-red-600' />
                          )}
                        </div>
                        <div className='flex items-center space-x-2'>
                          <Phone className='text-muted-foreground h-4 w-4' />
                          <span className='text-sm font-medium'>Phone:</span>
                          <span className='text-sm'>
                            {user.phone_number || 'Not provided'}
                          </span>
                        </div>
                      </div>
                      <div className='space-y-2'>
                        <div className='flex items-center space-x-2'>
                          <Shield className='text-muted-foreground h-4 w-4' />
                          <span className='text-sm font-medium'>
                            2FA Enabled:
                          </span>
                          {user.two_factor_enabled ? (
                            <CheckCircle className='h-4 w-4 text-green-600' />
                          ) : (
                            <XCircle className='h-4 w-4 text-red-600' />
                          )}
                        </div>
                        <div className='flex items-center space-x-2'>
                          <Clock className='text-muted-foreground h-4 w-4' />
                          <span className='text-sm font-medium'>
                            Last Seen:
                          </span>
                          <span className='text-sm'>
                            {user.last_seen
                              ? format(new Date(user.last_seen), 'PPp')
                              : 'Never'}
                          </span>
                        </div>
                        <div className='flex items-center space-x-2'>
                          <Calendar className='text-muted-foreground h-4 w-4' />
                          <span className='text-sm font-medium'>Created:</span>
                          <span className='text-sm'>
                            {format(new Date(user.created_at), 'PP')}
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value='permissions' className='space-y-4'>
                <Card>
                  <CardHeader>
                    <CardTitle>User Permissions</CardTitle>
                    <CardDescription>
                      Permissions granted through role assignment and individual
                      grants
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {permissions.length === 0 ? (
                      <p className='text-muted-foreground py-4 text-center'>
                        No permissions found
                      </p>
                    ) : (
                      <div className='space-y-4'>
                        {Object.entries(
                          permissions.reduce(
                            (acc, perm) => {
                              if (!acc[perm.resource]) acc[perm.resource] = []
                              acc[perm.resource].push(perm)
                              return acc
                            },
                            {} as Record<string, UserPermission[]>
                          )
                        ).map(([resource, perms]) => (
                          <div key={resource}>
                            <h4 className='mb-2 font-medium capitalize'>
                              {resource}
                            </h4>
                            <div className='grid grid-cols-2 gap-2'>
                              {perms.map((perm) => (
                                <div
                                  key={perm.id}
                                  className='flex items-center justify-between rounded-lg border p-2'
                                >
                                  <div>
                                    <span className='text-sm font-medium'>
                                      {perm.name}
                                    </span>
                                    {perm.description && (
                                      <p className='text-muted-foreground text-xs'>
                                        {perm.description}
                                      </p>
                                    )}
                                  </div>
                                  <Badge
                                    variant={
                                      perm.granted ? 'default' : 'destructive'
                                    }
                                  >
                                    {perm.granted ? 'Granted' : 'Denied'}
                                  </Badge>
                                </div>
                              ))}
                            </div>
                            {resource !==
                              Object.keys(
                                permissions.reduce(
                                  (acc, perm) => {
                                    if (!acc[perm.resource])
                                      acc[perm.resource] = []
                                    return acc
                                  },
                                  {} as Record<string, UserPermission[]>
                                )
                              ).slice(-1)[0] && <Separator className='mt-4' />}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value='activity' className='space-y-4'>
                <Card>
                  <CardHeader>
                    <CardTitle>Recent Activity</CardTitle>
                    <CardDescription>
                      User actions and system events
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {activity.length === 0 ? (
                      <p className='text-muted-foreground py-4 text-center'>
                        No activity found
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Action</TableHead>
                            <TableHead>Resource</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Details</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {activity.slice(0, 20).map((log) => (
                            <TableRow key={log.id}>
                              <TableCell>
                                <div className='flex items-center space-x-2'>
                                  <Activity className='text-muted-foreground h-4 w-4' />
                                  <span className='capitalize'>
                                    {log.action}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant='outline'>{log.resource}</Badge>
                              </TableCell>
                              <TableCell>
                                <span className='text-sm'>
                                  {format(new Date(log.created_at), 'PPp')}
                                </span>
                              </TableCell>
                              <TableCell>
                                <div className='text-muted-foreground text-sm'>
                                  {log.ip_address && (
                                    <span>IP: {log.ip_address}</span>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </ScrollArea>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
