// Created and developed by Jai Singh
import {
  IconClock,
  IconHistory,
  IconSettings,
  IconShield,
  IconUserOff,
  IconUsers,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
// Import session management components
import { ActiveSessionsTable } from './components/active-sessions-table'
import { SecurityMonitoring } from './components/security-monitoring'
import { SessionAnalytics } from './components/session-analytics'
import { SessionHistory } from './components/session-history'
import { SessionTimeoutSettings } from './components/session-timeout-settings'
// Import services and types
import {
  SessionManagementProvider,
  useSessionManagementContext,
} from './context/session-management-context'
import { useSessionManagement } from './hooks/use-session-management'

function SessionManagementContent() {
  const { activeSessions, sessionStats, isLoading } = useSessionManagement()

  const { refreshSessions, terminateAllSessions, terminateUserSession } =
    useSessionManagementContext()

  return (
    <>
      <Header fixed>
        <Search />
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className='space-y-8'>
          <div className='flex items-center justify-between'>
            <div>
              <h2 className='text-2xl font-bold tracking-tight'>
                Session Management
              </h2>
              <p className='text-muted-foreground'>
                Monitor and manage user sessions, configure timeouts, and
                control access security
              </p>
            </div>
            <div className='flex items-center space-x-2'>
              <Button onClick={refreshSessions} variant='outline' size='sm'>
                Refresh Sessions
              </Button>
              <PermissionGuard resource='sessions' action='manage'>
                <Button
                  onClick={terminateAllSessions}
                  variant='destructive'
                  size='sm'
                  className='text-white'
                >
                  <IconUserOff className='mr-2 h-4 w-4' />
                  Logout All Users
                </Button>
              </PermissionGuard>
            </div>
          </div>

          {/* Session Statistics Cards */}
          <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                <CardTitle className='text-sm font-medium'>
                  Active Sessions
                </CardTitle>
                <IconUsers className='text-muted-foreground h-4 w-4' />
              </CardHeader>
              <CardContent>
                <div className='text-2xl font-bold'>
                  {sessionStats?.activeSessions || 0}
                </div>
                <p className='text-muted-foreground text-xs'>
                  Currently logged in users
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                <CardTitle className='text-sm font-medium'>
                  Avg Session Duration
                </CardTitle>
                <IconClock className='text-muted-foreground h-4 w-4' />
              </CardHeader>
              <CardContent>
                <div className='text-2xl font-bold'>
                  {sessionStats?.avgDuration || '0m'}
                </div>
                <p className='text-muted-foreground text-xs'>
                  Average session length
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                <CardTitle className='text-sm font-medium'>
                  Security Alerts
                </CardTitle>
                <IconShield className='text-muted-foreground h-4 w-4' />
              </CardHeader>
              <CardContent>
                <div className='text-2xl font-bold'>
                  {sessionStats?.securityAlerts || 0}
                </div>
                <p className='text-muted-foreground text-xs'>
                  Suspicious activities detected
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
                <CardTitle className='text-sm font-medium'>
                  Auto Logout Rate
                </CardTitle>
                <IconSettings className='text-muted-foreground h-4 w-4' />
              </CardHeader>
              <CardContent>
                <div className='text-2xl font-bold'>
                  {sessionStats?.autoLogoutRate || '0%'}
                </div>
                <p className='text-muted-foreground text-xs'>
                  Sessions ended by timeout
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Main Session Management Interface */}
          <Tabs defaultValue='active-sessions' className='w-full'>
            <TabsList className='grid w-full grid-cols-5'>
              <TabsTrigger value='active-sessions'>
                <IconUsers className='mr-2 h-4 w-4' />
                Active Sessions
              </TabsTrigger>
              <TabsTrigger value='timeout-settings'>
                <IconClock className='mr-2 h-4 w-4' />
                Timeout Settings
              </TabsTrigger>
              <TabsTrigger value='analytics'>
                <IconHistory className='mr-2 h-4 w-4' />
                Analytics
              </TabsTrigger>
              <TabsTrigger value='history'>
                <IconHistory className='mr-2 h-4 w-4' />
                Session History
              </TabsTrigger>
              <TabsTrigger value='security'>
                <IconShield className='mr-2 h-4 w-4' />
                Security
              </TabsTrigger>
            </TabsList>

            <TabsContent value='active-sessions' className='space-y-4'>
              <Card>
                <CardHeader>
                  <CardTitle>Active User Sessions</CardTitle>
                  <p className='text-muted-foreground text-sm'>
                    View and manage currently active user sessions
                  </p>
                </CardHeader>
                <CardContent>
                  <ActiveSessionsTable
                    sessions={activeSessions}
                    onTerminateSession={terminateUserSession}
                    isLoading={isLoading}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value='timeout-settings' className='space-y-4'>
              <Card>
                <CardHeader>
                  <CardTitle>Session Timeout Configuration</CardTitle>
                  <p className='text-muted-foreground text-sm'>
                    Configure automatic logout timeouts for different user roles
                  </p>
                </CardHeader>
                <CardContent>
                  <SessionTimeoutSettings />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value='analytics' className='space-y-4'>
              <Card>
                <CardHeader>
                  <CardTitle>Session Analytics</CardTitle>
                  <p className='text-muted-foreground text-sm'>
                    View session patterns, usage trends, and performance metrics
                  </p>
                </CardHeader>
                <CardContent>
                  <SessionAnalytics />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value='history' className='space-y-4'>
              <Card>
                <CardHeader>
                  <CardTitle>Session History</CardTitle>
                  <p className='text-muted-foreground text-sm'>
                    Track login/logout events and session lifecycle
                  </p>
                </CardHeader>
                <CardContent>
                  <SessionHistory />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value='security' className='space-y-4'>
              <Card>
                <CardHeader>
                  <CardTitle>Security Monitoring</CardTitle>
                  <p className='text-muted-foreground text-sm'>
                    Monitor suspicious activities and security threats
                  </p>
                </CardHeader>
                <CardContent>
                  <SecurityMonitoring />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </Main>
    </>
  )
}

export default function SessionManagement() {
  return (
    <SessionManagementProvider>
      <SessionManagementContent />
    </SessionManagementProvider>
  )
}

// Created and developed by Jai Singh
