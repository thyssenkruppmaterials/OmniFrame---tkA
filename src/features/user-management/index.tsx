import {
  Users,
  UserCheck,
  Mail,
  Clock,
  Ban,
  Trash2,
  Shield,
  AlertTriangle,
  ArrowUpRight,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { BulkActionsDialog } from './components/bulk-actions-dialog'
import { CreateUserDialog } from './components/create-user-dialog'
import { EditUserDialog } from './components/edit-user-dialog'
import { PasswordResetDialog } from './components/password-reset-dialog'
import { UserChangeRoleDialog } from './components/user-change-role-dialog'
import { UserDetailsDialog } from './components/user-details-dialog'
import { UserInviteDialog } from './components/user-invite-dialog'
import { UserManagementTable } from './components/user-management-table'
import { UserPermissionsDialog } from './components/user-permissions-dialog'
import { UserStatusChangeDialog } from './components/user-status-change-dialog'
import {
  UserManagementProvider,
  useUserManagementContext,
} from './context/user-management-context'
import { useUserManagement } from './hooks/use-user-management'

function UserManagementContent() {
  const { stats } = useUserManagement()

  const {
    currentUser,
    isViewDialogOpen,
    setIsViewDialogOpen,
    isEditDialogOpen,
    setIsEditDialogOpen,
    isPermissionsDialogOpen,
    setIsPermissionsDialogOpen,
    isPasswordResetDialogOpen,
    setIsPasswordResetDialogOpen,
    isChangeRoleDialogOpen,
    setIsChangeRoleDialogOpen,
    isStatusChangeDialogOpen,
    setIsStatusChangeDialogOpen,
    isBulkActionsDialogOpen,
    setIsBulkActionsDialogOpen,
  } = useUserManagementContext()

  return (
    <>
      <Header fixed>
        <Search placeholder='Search users...' />
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      <Main>
        {/* Page Header */}
        <div className='mb-8 flex flex-wrap items-start justify-between gap-4'>
          <div className='space-y-1'>
            <h1 className='text-3xl font-bold tracking-tight'>
              User Management
            </h1>
            <p className='text-muted-foreground max-w-2xl'>
              Manage workforce accounts, monitor team status, and control
              organizational access across your platform.
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <PermissionGuard resource='users' action='create'>
              <UserInviteDialog />
            </PermissionGuard>
            <PermissionGuard resource='users' action='create'>
              <CreateUserDialog />
            </PermissionGuard>
          </div>
        </div>

        {/* Workforce Overview Hero Card */}
        <Card className='mb-8 overflow-hidden'>
          <CardContent className='p-0'>
            <div className='grid lg:grid-cols-[1fr_auto]'>
              {/* Left: Main stats area */}
              <div className='space-y-6 p-6'>
                {/* Primary headline stat */}
                <div className='flex items-end gap-4'>
                  <div>
                    <p className='text-muted-foreground mb-1 text-xs font-medium tracking-wider uppercase'>
                      Total Workforce
                    </p>
                    <div className='flex items-baseline gap-3'>
                      <span className='text-5xl font-bold tracking-tight'>
                        {stats?.total || 0}
                      </span>
                      {(stats?.newThisMonth || 0) > 0 && (
                        <span className='flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400'>
                          <ArrowUpRight className='h-4 w-4' />+
                          {stats?.newThisMonth} this month
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Status Distribution Bar */}
                <div className='space-y-2'>
                  <div className='text-muted-foreground flex items-center justify-between text-xs'>
                    <span>Status Distribution</span>
                    <span>{stats?.activePercentage || 0}% active</span>
                  </div>
                  <div className='bg-muted flex h-2.5 w-full overflow-hidden rounded-full'>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className='bg-emerald-500 transition-all duration-700'
                          style={{
                            width: `${stats?.total ? ((stats?.active || 0) / stats.total) * 100 : 0}%`,
                          }}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        Active: {stats?.active || 0}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className='bg-yellow-500 transition-all duration-700'
                          style={{
                            width: `${stats?.total ? ((stats?.pending || 0) / stats.total) * 100 : 0}%`,
                          }}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        Pending: {stats?.pending || 0}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className='bg-orange-500 transition-all duration-700'
                          style={{
                            width: `${stats?.total ? ((stats?.on_leave || 0) / stats.total) * 100 : 0}%`,
                          }}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        On Leave: {stats?.on_leave || 0}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className='bg-red-500 transition-all duration-700'
                          style={{
                            width: `${stats?.total ? ((stats?.suspended || 0) / stats.total) * 100 : 0}%`,
                          }}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        Suspended: {stats?.suspended || 0}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  {/* Legend */}
                  <div className='text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs'>
                    <span className='flex items-center gap-1.5'>
                      <span className='h-2 w-2 rounded-full bg-emerald-500' />
                      Active
                    </span>
                    <span className='flex items-center gap-1.5'>
                      <span className='h-2 w-2 rounded-full bg-yellow-500' />
                      Pending
                    </span>
                    <span className='flex items-center gap-1.5'>
                      <span className='h-2 w-2 rounded-full bg-orange-500' />
                      On Leave
                    </span>
                    <span className='flex items-center gap-1.5'>
                      <span className='h-2 w-2 rounded-full bg-red-500' />
                      Suspended
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: Quick stat chips grid */}
              <div className='bg-muted/30 border-l p-6'>
                <div className='grid min-w-[280px] grid-cols-2 gap-4'>
                  <div className='space-y-1'>
                    <div className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium'>
                      <UserCheck className='h-3.5 w-3.5 text-emerald-500' />
                      Active
                    </div>
                    <p className='text-2xl font-bold text-emerald-600 dark:text-emerald-400'>
                      {stats?.active || 0}
                    </p>
                  </div>
                  <div className='space-y-1'>
                    <div className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium'>
                      <Mail className='h-3.5 w-3.5 text-yellow-500' />
                      Pending
                    </div>
                    <p className='text-2xl font-bold text-yellow-600 dark:text-yellow-400'>
                      {stats?.pending || 0}
                    </p>
                  </div>
                  <div className='space-y-1'>
                    <div className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium'>
                      <Ban className='h-3.5 w-3.5 text-red-500' />
                      Suspended
                    </div>
                    <p className='text-2xl font-bold text-red-600 dark:text-red-400'>
                      {stats?.suspended || 0}
                    </p>
                  </div>
                  <div className='space-y-1'>
                    <div className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium'>
                      <Clock className='h-3.5 w-3.5 text-orange-500' />
                      On Leave
                    </div>
                    <p className='text-2xl font-bold text-orange-600 dark:text-orange-400'>
                      {stats?.on_leave || 0}
                    </p>
                  </div>
                  <div className='space-y-1'>
                    <div className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium'>
                      <Shield className='h-3.5 w-3.5 text-purple-500' />
                      Admins
                    </div>
                    <p className='text-2xl font-bold text-purple-600 dark:text-purple-400'>
                      {stats?.admins || 0}
                    </p>
                  </div>
                  <div className='space-y-1'>
                    <div className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium'>
                      <Trash2 className='h-3.5 w-3.5' />
                      Deleted
                    </div>
                    <p className='text-muted-foreground text-2xl font-bold'>
                      {stats?.deleted || 0}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Attention Required Banner */}
        {((stats?.suspended || 0) > 0 || (stats?.pending || 0) > 3) && (
          <div className='mb-6 flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3'>
            <AlertTriangle className='h-4 w-4 shrink-0 text-amber-500' />
            <div className='flex flex-wrap items-center gap-x-4 gap-y-1 text-sm'>
              {(stats?.suspended || 0) > 0 && (
                <span className='text-amber-700 dark:text-amber-400'>
                  <strong>{stats?.suspended}</strong> user
                  {(stats?.suspended || 0) > 1 ? 's' : ''} suspended
                </span>
              )}
              {(stats?.pending || 0) > 3 && (
                <span className='text-amber-700 dark:text-amber-400'>
                  <strong>{stats?.pending}</strong> invitations awaiting
                  response
                </span>
              )}
            </div>
          </div>
        )}

        {/* Tabs with Icons and Live Counts */}
        <Tabs defaultValue='users' className='w-full'>
          <div className='no-scrollbar mb-4 overflow-x-auto'>
            <TabsList className='inline-flex h-10 w-auto gap-1 bg-transparent p-0'>
              <TabsTrigger
                value='users'
                className='data-[state=active]:border-border data-[state=active]:bg-background gap-2 rounded-lg border border-transparent data-[state=active]:shadow-sm'
              >
                <Users className='h-4 w-4' />
                All
                <Badge
                  variant='secondary'
                  className='h-5 min-w-[20px] px-1.5 text-[10px] font-semibold'
                >
                  {stats?.total || 0}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value='active'
                className='data-[state=active]:border-border data-[state=active]:bg-background gap-2 rounded-lg border border-transparent data-[state=active]:shadow-sm'
              >
                <span className='h-2 w-2 rounded-full bg-emerald-500' />
                Active
                <Badge
                  variant='secondary'
                  className='h-5 min-w-[20px] px-1.5 text-[10px] font-semibold'
                >
                  {stats?.active || 0}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value='pending'
                className='data-[state=active]:border-border data-[state=active]:bg-background gap-2 rounded-lg border border-transparent data-[state=active]:shadow-sm'
              >
                <span className='h-2 w-2 rounded-full bg-yellow-500' />
                Pending
                <Badge
                  variant='secondary'
                  className='h-5 min-w-[20px] px-1.5 text-[10px] font-semibold'
                >
                  {stats?.pending || 0}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value='on_leave'
                className='data-[state=active]:border-border data-[state=active]:bg-background gap-2 rounded-lg border border-transparent data-[state=active]:shadow-sm'
              >
                <span className='h-2 w-2 rounded-full bg-orange-500' />
                On Leave
                <Badge
                  variant='secondary'
                  className='h-5 min-w-[20px] px-1.5 text-[10px] font-semibold'
                >
                  {stats?.on_leave || 0}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value='suspended'
                className='data-[state=active]:border-border data-[state=active]:bg-background gap-2 rounded-lg border border-transparent data-[state=active]:shadow-sm'
              >
                <span className='h-2 w-2 rounded-full bg-red-500' />
                Suspended
                <Badge
                  variant='secondary'
                  className='h-5 min-w-[20px] px-1.5 text-[10px] font-semibold'
                >
                  {stats?.suspended || 0}
                </Badge>
              </TabsTrigger>
              <TabsTrigger
                value='terminated'
                className='data-[state=active]:border-border data-[state=active]:bg-background gap-2 rounded-lg border border-transparent data-[state=active]:shadow-sm'
              >
                <span className='h-2 w-2 rounded-full bg-red-800 dark:bg-red-600' />
                Terminated
              </TabsTrigger>
              <TabsTrigger
                value='inactive'
                className='data-[state=active]:border-border data-[state=active]:bg-background gap-2 rounded-lg border border-transparent data-[state=active]:shadow-sm'
              >
                <span className='h-2 w-2 rounded-full bg-gray-400' />
                Inactive
              </TabsTrigger>
              <TabsTrigger
                value='deleted'
                className='data-[state=active]:border-border data-[state=active]:bg-background text-muted-foreground gap-2 rounded-lg border border-transparent data-[state=active]:shadow-sm'
              >
                <Trash2 className='h-3.5 w-3.5' />
                Deleted
                {(stats?.deleted || 0) > 0 && (
                  <Badge
                    variant='secondary'
                    className='h-5 min-w-[20px] px-1.5 text-[10px] font-semibold'
                  >
                    {stats?.deleted}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value='users' className='mt-0 space-y-4'>
            <UserManagementTable />
          </TabsContent>
          <TabsContent value='active' className='mt-0 space-y-4'>
            <UserManagementTable filter={{ status: 'active' }} />
          </TabsContent>
          <TabsContent value='pending' className='mt-0 space-y-4'>
            <UserManagementTable filter={{ status: 'invited' }} />
          </TabsContent>
          <TabsContent value='on_leave' className='mt-0 space-y-4'>
            <UserManagementTable filter={{ status: 'on_leave' }} />
          </TabsContent>
          <TabsContent value='suspended' className='mt-0 space-y-4'>
            <UserManagementTable filter={{ status: 'suspended' }} />
          </TabsContent>
          <TabsContent value='terminated' className='mt-0 space-y-4'>
            <UserManagementTable filter={{ status: 'terminated' }} />
          </TabsContent>
          <TabsContent value='inactive' className='mt-0 space-y-4'>
            <UserManagementTable filter={{ status: 'inactive' }} />
          </TabsContent>
          <TabsContent value='deleted' className='mt-0 space-y-4'>
            <UserManagementTable filter={{ include_deleted: true }} />
          </TabsContent>
        </Tabs>

        {/* Dialogs */}
        <UserDetailsDialog
          open={isViewDialogOpen}
          onOpenChange={setIsViewDialogOpen}
          user={currentUser}
        />
        <EditUserDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          user={currentUser}
        />
        <UserPermissionsDialog
          open={isPermissionsDialogOpen}
          onOpenChange={setIsPermissionsDialogOpen}
          user={currentUser}
        />
        <PasswordResetDialog
          userId={currentUser?.id || null}
          userEmail={currentUser?.email || null}
          open={isPasswordResetDialogOpen}
          onOpenChange={setIsPasswordResetDialogOpen}
        />
        <UserChangeRoleDialog
          user={currentUser}
          open={isChangeRoleDialogOpen}
          onOpenChange={setIsChangeRoleDialogOpen}
        />
        <UserStatusChangeDialog
          user={currentUser}
          open={isStatusChangeDialogOpen}
          onOpenChange={setIsStatusChangeDialogOpen}
        />
        <BulkActionsDialog
          open={isBulkActionsDialogOpen}
          onOpenChange={setIsBulkActionsDialogOpen}
        />
      </Main>
    </>
  )
}

export default function UserManagement() {
  return (
    <UserManagementProvider>
      <UserManagementContent />
    </UserManagementProvider>
  )
}
