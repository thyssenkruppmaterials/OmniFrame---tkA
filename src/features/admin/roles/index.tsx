import { useMemo } from 'react'
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Users,
  Palette,
  Key,
  Settings,
  LayoutGrid,
  Table as TableIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
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
import { RoleRBACDemo } from './components/role-rbac-demo'
import { columns } from './components/roles-columns'
import { RolesDialogs } from './components/roles-dialogs'
import { RolesPrimaryButtons } from './components/roles-primary-buttons'
import { RolesTable } from './components/roles-table'
import RolesProvider, { useRoles } from './context/roles-context'

function RoleManagementContent() {
  const {
    roles,
    isLoading,
    selectedRoles: _selectedRoles,
    setCurrentRole,
    setIsPermissionsDialogOpen,
    setIsQuickEditDialogOpen,
  } = useRoles()

  const stats = useMemo(() => {
    const total = roles.length
    const system = roles.filter((r) => r.isSystem).length
    const custom = roles.filter((r) => !r.isSystem).length
    const active = roles.filter((r) => r.isActive).length
    const inactive = total - active
    const totalUsers = roles.reduce((acc, r) => acc + (r.userCount || 0), 0)
    const avgPermissions =
      total > 0
        ? Math.round(
            roles.reduce((acc, r) => acc + (r.permissions?.length || 0), 0) /
              total
          )
        : 0
    return {
      total,
      system,
      custom,
      active,
      inactive,
      totalUsers,
      avgPermissions,
    }
  }, [roles])

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
        {/* Section 1: Page Header */}
        <div className='mb-8 flex flex-wrap items-start justify-between gap-4'>
          <div className='space-y-1'>
            <h1 className='text-3xl font-bold tracking-tight'>
              Role Management
            </h1>
            <p className='text-muted-foreground max-w-2xl'>
              Configure access control policies, manage role-based permissions,
              and oversee organizational security posture.
            </p>
          </div>
          <RolesPrimaryButtons />
        </div>

        {/* Section 2: Metrics Strip */}
        {isLoading ? (
          <Card className='mb-8'>
            <CardContent className='py-4'>
              <div className='flex items-center justify-between'>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className='flex flex-1 flex-col items-center gap-2 px-4'
                  >
                    <Skeleton className='h-3 w-16' />
                    <Skeleton className='h-8 w-12' />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className='mb-8'>
            <CardContent className='py-4'>
              <div className='divide-border flex items-center justify-between divide-x'>
                <div className='flex flex-1 flex-col items-center gap-1 px-4'>
                  <span className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                    Total Roles
                  </span>
                  <span className='text-3xl font-bold'>{stats.total}</span>
                </div>
                <div className='flex flex-1 flex-col items-center gap-1 px-4'>
                  <span className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                    System
                  </span>
                  <div className='flex items-center gap-2'>
                    <span className='text-3xl font-bold text-purple-600 dark:text-purple-400'>
                      {stats.system}
                    </span>
                    <ShieldCheck className='h-5 w-5 text-purple-600 dark:text-purple-400' />
                  </div>
                </div>
                <div className='flex flex-1 flex-col items-center gap-1 px-4'>
                  <span className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                    Custom
                  </span>
                  <div className='flex items-center gap-2'>
                    <span className='text-3xl font-bold text-blue-600 dark:text-blue-400'>
                      {stats.custom}
                    </span>
                    <Palette className='h-5 w-5 text-blue-600 dark:text-blue-400' />
                  </div>
                </div>
                <div className='flex flex-1 flex-col items-center gap-1 px-4'>
                  <span className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                    Active
                  </span>
                  <div className='flex items-center gap-2'>
                    <span className='text-3xl font-bold text-green-600 dark:text-green-400'>
                      {stats.active}
                    </span>
                    {stats.inactive > 0 && (
                      <Badge
                        variant='outline'
                        className='border-orange-300 text-xs text-orange-600 dark:border-orange-600 dark:text-orange-400'
                      >
                        {stats.inactive} inactive
                      </Badge>
                    )}
                  </div>
                </div>
                <div className='flex flex-1 flex-col items-center gap-1 px-4'>
                  <span className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                    Users Assigned
                  </span>
                  <div className='flex items-center gap-2'>
                    <span className='text-3xl font-bold'>
                      {stats.totalUsers}
                    </span>
                    <Users className='text-muted-foreground h-5 w-5' />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Section 3: Tabs — Overview, Table View, Permissions Matrix */}
        <Tabs defaultValue='overview' className='space-y-6'>
          <TabsList className='h-10'>
            <TabsTrigger value='overview' className='gap-2'>
              <LayoutGrid className='h-4 w-4' />
              Overview
            </TabsTrigger>
            <TabsTrigger value='table' className='gap-2'>
              <TableIcon className='h-4 w-4' />
              Table View
            </TabsTrigger>
            <TabsTrigger value='permissions' className='gap-2'>
              <Key className='h-4 w-4' />
              Permissions Matrix
            </TabsTrigger>
          </TabsList>

          {/* Section 3a: Overview Tab — Visual Role Cards Grid */}
          <TabsContent value='overview'>
            {isLoading ? (
              <div className='grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
                {Array.from({ length: 10 }).map((_, i) => (
                  <Card key={i} className='p-4'>
                    <div className='mb-3 flex items-start justify-between'>
                      <div className='space-y-1.5'>
                        <Skeleton className='h-5 w-28' />
                        <Skeleton className='h-3.5 w-20' />
                      </div>
                      <Skeleton className='h-7 w-7 rounded-full' />
                    </div>
                    <Skeleton className='mb-3 h-4 w-full' />
                    <Skeleton className='mb-3 h-1.5 w-full' />
                    <div className='flex gap-2'>
                      <Skeleton className='h-5 w-14' />
                      <Skeleton className='h-5 w-14' />
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <div className='grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
                {roles.map((role) => {
                  const permCount = role.permissions?.length || 0
                  const isElevated =
                    role.permissions?.some(
                      (p) =>
                        p.includes('*:*') ||
                        p.includes('users:') ||
                        p.includes('roles:') ||
                        role.name === 'superadmin' ||
                        role.name === 'admin'
                    ) || false
                  const createdRecently =
                    Date.now() - new Date(role.createdAt).getTime() <
                    7 * 24 * 60 * 60 * 1000

                  return (
                    <Card
                      key={role.id}
                      className={cn(
                        'glass-card relative overflow-hidden transition-all duration-300',
                        !role.isActive && 'opacity-60'
                      )}
                    >
                      {/* Colored top accent bar */}
                      <div
                        className={cn(
                          'absolute top-0 right-0 left-0 h-[3px]',
                          role.isSystem ? 'bg-purple-500' : 'bg-blue-500',
                          !role.isActive && 'bg-gray-400'
                        )}
                      />

                      <CardHeader className='px-4 pt-4 pb-2'>
                        <div className='flex items-start justify-between'>
                          <div className='min-w-0 flex-1'>
                            <CardTitle className='flex items-center gap-1.5 truncate text-sm font-semibold'>
                              {role.displayName}
                              {createdRecently && (
                                <Badge className='border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0 text-[11px] leading-none text-emerald-600 dark:text-emerald-400'>
                                  NEW
                                </Badge>
                              )}
                            </CardTitle>
                            <code className='text-muted-foreground text-[13px]'>
                              {role.name}
                            </code>
                          </div>
                          <div className='ml-1.5 flex shrink-0 items-center gap-1'>
                            {role.isSystem ? (
                              <Badge
                                variant='secondary'
                                className='border-purple-500/20 bg-purple-500/10 px-1.5 py-0 text-[11px] leading-none text-purple-600 dark:text-purple-400'
                              >
                                SYS
                              </Badge>
                            ) : (
                              <Badge
                                variant='secondary'
                                className='border-blue-500/20 bg-blue-500/10 px-1.5 py-0 text-[11px] leading-none text-blue-600 dark:text-blue-400'
                              >
                                CUS
                              </Badge>
                            )}
                            {isElevated && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <ShieldAlert className='h-4 w-4 text-amber-500' />
                                </TooltipTrigger>
                                <TooltipContent>
                                  Elevated privileges
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </div>
                      </CardHeader>

                      <CardContent className='space-y-3 px-4 pb-3'>
                        <p className='text-muted-foreground line-clamp-1 text-[13px]'>
                          {role.description || 'No description provided'}
                        </p>

                        {/* Permission coverage bar */}
                        <div className='space-y-1'>
                          <div className='flex items-center justify-between text-[13px]'>
                            <span className='text-muted-foreground'>Perms</span>
                            <span className='font-medium'>{permCount}</span>
                          </div>
                          <div className='bg-muted h-1.5 w-full overflow-hidden rounded-full'>
                            <div
                              className={cn(
                                'h-full rounded-full transition-all duration-500',
                                permCount > 20
                                  ? 'bg-amber-500'
                                  : permCount > 10
                                    ? 'bg-blue-500'
                                    : 'bg-emerald-500'
                              )}
                              style={{
                                width: `${Math.min((permCount / 30) * 100, 100)}%`,
                              }}
                            />
                          </div>
                        </div>

                        {/* Users + Status row */}
                        <div className='flex items-center justify-between'>
                          <div className='flex items-center gap-1.5 text-[13px]'>
                            <Users className='text-muted-foreground h-3.5 w-3.5' />
                            <span className='font-medium'>
                              {role.userCount || 0}
                            </span>
                            <span className='text-muted-foreground'>users</span>
                          </div>
                          <Badge
                            variant='outline'
                            className={cn(
                              'px-1.5 py-0 text-[11px] leading-none',
                              role.isActive
                                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : 'border-gray-500/20 bg-gray-500/10 text-gray-500'
                            )}
                          >
                            {role.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                      </CardContent>

                      <CardFooter className='border-t px-4 pt-2 pb-2'>
                        <div className='flex w-full items-center justify-between'>
                          <span className='text-muted-foreground text-xs'>
                            {new Date(role.createdAt).toLocaleDateString(
                              'en-US',
                              {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              }
                            )}
                          </span>
                          <div className='flex items-center gap-1'>
                            <PermissionGuard resource='roles' action='update'>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    className='h-7 w-7 p-0'
                                    onClick={() => {
                                      setCurrentRole(role)
                                      setIsPermissionsDialogOpen(true)
                                    }}
                                  >
                                    <Shield className='h-3.5 w-3.5' />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Manage Permissions
                                </TooltipContent>
                              </Tooltip>
                            </PermissionGuard>
                            <PermissionGuard resource='roles' action='update'>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant='ghost'
                                    size='sm'
                                    className='h-7 w-7 p-0'
                                    onClick={() => {
                                      setCurrentRole(role)
                                      setIsQuickEditDialogOpen(true)
                                    }}
                                  >
                                    <Settings className='h-3.5 w-3.5' />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Edit Role</TooltipContent>
                              </Tooltip>
                            </PermissionGuard>
                          </div>
                        </div>
                      </CardFooter>
                    </Card>
                  )
                })}
              </div>
            )}
          </TabsContent>

          {/* Section 3b: Table View Tab */}
          <TabsContent value='table'>
            <RolesTable data={roles} columns={columns} isLoading={isLoading} />
          </TabsContent>

          {/* Section 3c: Permissions Matrix Tab */}
          <TabsContent value='permissions'>
            <div className='flex justify-center'>
              <RoleRBACDemo />
            </div>
          </TabsContent>
        </Tabs>
      </Main>

      <RolesDialogs />
    </>
  )
}

export default function RoleManagement() {
  return (
    <RolesProvider>
      <RoleManagementContent />
    </RolesProvider>
  )
}
