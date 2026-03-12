import { useEffect, useMemo, useState } from 'react'
import {
  type Column,
  ColumnDef,
  ColumnFiltersState,
  type Row,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  Ban,
  Clock,
  Edit,
  Eye,
  Key,
  Mail,
  MoreHorizontal,
  RotateCcw,
  Shield,
  Trash2,
  UserCheck,
  UserCog,
  UserMinus,
  UserX,
} from 'lucide-react'
import { logger } from '@/lib/utils/logger'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { useUserManagementContext } from '../context/user-management-context'
import { useUserManagement } from '../hooks/use-user-management'
import {
  USER_STATUS_CONFIG,
  type UserFilters,
  type UserProfile,
  type UserStatus,
} from '../types'
import { BulkActionsDialog } from './bulk-actions-dialog'
import { DataTablePagination } from './data-table-pagination'
import { DataTableToolbar } from './data-table-toolbar'

interface UserManagementTableProps {
  filter?: {
    status?: UserStatus
    include_deleted?: boolean
  }
}

export function UserManagementTable({ filter }: UserManagementTableProps) {
  const {
    users,
    loading,
    isFetching,
    filters,
    setFilters,
    searchInput,
    setSearchInput,
    updateUserStatus,
    deleteUser,
    restoreUser,
    permanentlyDeleteUser,
    refreshUsers,
    exportUsers,
  } = useUserManagement()

  const {
    setCurrentUser,
    setIsViewDialogOpen,
    setIsEditDialogOpen,
    setIsPermissionsDialogOpen,
    setIsPasswordResetDialogOpen,
    setIsChangeRoleDialogOpen,
    setIsStatusChangeDialogOpen,
  } = useUserManagementContext()

  // React Table state management
  const [rowSelection, setRowSelection] = useState({})
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([])
  const [isBulkActionsOpen, setIsBulkActionsOpen] = useState(false)

  // Determine if we're viewing deleted users
  const isViewingDeletedUsers = filter?.include_deleted === true

  // Update filters when the filter prop changes (for deleted users tab)
  useEffect(() => {
    if (filter?.include_deleted !== undefined) {
      setFilters({ ...filters, include_deleted: filter.include_deleted })
    } else {
      const { include_deleted: _, ...rest } = filters
      setFilters(rest)
    }
  }, [filter?.include_deleted]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filter users based on props
  const filteredUsers = useMemo(() => {
    let result = users

    // Apply tab filter (from props)
    if (filter?.status) {
      result = result.filter((user) => user.status === filter.status)
    }

    return result
  }, [users, filter])

  // Get selected user IDs
  const selectedUserIds = useMemo(() => {
    return Object.keys(rowSelection)
      .filter((key) => rowSelection[key as keyof typeof rowSelection])
      .map((index) => filteredUsers[parseInt(index)]?.id)
      .filter(Boolean) as string[]
  }, [rowSelection, filteredUsers])

  const selectedUsers = useMemo(() => {
    return filteredUsers.filter((user) => selectedUserIds.includes(user.id))
  }, [filteredUsers, selectedUserIds])

  // Clear selection when filtered users change
  useEffect(() => {
    setRowSelection({})
  }, [filter?.status])

  const getStatusColor = (status: UserStatus) => {
    return (
      USER_STATUS_CONFIG[status]?.color ||
      'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300'
    )
  }

  const getStatusIcon = (status: UserStatus) => {
    const icons = {
      active: <UserCheck className='h-3 w-3' />,
      inactive: <UserMinus className='h-3 w-3' />,
      invited: <Mail className='h-3 w-3' />,
      suspended: <Ban className='h-3 w-3' />,
      terminated: <UserX className='h-3 w-3' />,
      on_leave: <Clock className='h-3 w-3' />,
    }
    return icons[status] || null
  }

  const getRoleColor = (role: string) => {
    const colors: Record<string, string> = {
      superadmin:
        'bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-300',
      admin: 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300',
      manager:
        'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-300',
      cashier:
        'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300',
      viewer:
        'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300',
      tka_associate:
        'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/20 dark:text-cyan-300',
      inventory_specialist:
        'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300',
      logistics_coordinator:
        'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300',
      quality_specialist:
        'bg-rose-100 text-rose-800 dark:bg-rose-900/20 dark:text-rose-300',
    }
    return colors[role] || colors.viewer
  }

  const handleRowAction = async (action: string, user: UserProfile) => {
    logger.log(
      '🎯 handleRowAction called with action:',
      action,
      'user:',
      user.email
    )

    switch (action) {
      case 'view':
        logger.log('🔍 Opening view dialog for user:', user.email)
        setCurrentUser(user)
        setIsViewDialogOpen(true)
        break
      case 'edit':
        logger.log('✏️ Opening edit dialog for user:', user.email)
        setCurrentUser(user)
        setIsEditDialogOpen(true)
        break
      case 'change-status':
        logger.log('📊 Opening status change dialog for user:', user.email)
        setCurrentUser(user)
        setIsStatusChangeDialogOpen(true)
        break
      case 'activate':
        logger.log('✅ Activating user:', user.email)
        await updateUserStatus(user.id, 'active')
        break
      case 'suspend':
        logger.log('⏸️ Suspending user:', user.email)
        await updateUserStatus(user.id, 'suspended')
        break
      case 'resend-invite':
        // TODO: Resend invitation
        logger.log('📧 Resend invite:', user.id)
        break
      case 'reset-password':
        logger.log('🔑 Opening password reset dialog for user:', user.email)
        setCurrentUser(user)
        setIsPasswordResetDialogOpen(true)
        break
      case 'permissions':
        logger.log('⚙️ Opening permissions dialog for user:', user.email)
        setCurrentUser(user)
        setIsPermissionsDialogOpen(true)
        break
      case 'change-role':
        logger.log('👤 Opening change role dialog for user:', user.email)
        setCurrentUser(user)
        setIsChangeRoleDialogOpen(true)
        break
      case 'delete':
        if (
          confirm(
            'Are you sure you want to delete this user? This action cannot be undone.'
          )
        ) {
          logger.log('🗑️ Deleting user:', user.email)
          await deleteUser(user.id)
        }
        break
      case 'restore':
        if (
          confirm(
            'Are you sure you want to restore this user? They will be restored to inactive status.'
          )
        ) {
          logger.log('♻️ Restoring user:', user.email)
          await restoreUser(user.id)
        }
        break
      case 'permanent-delete':
        // Double confirmation for permanent deletion
        if (
          confirm(
            `⚠️ PERMANENT DELETE\n\nAre you sure you want to PERMANENTLY delete ${user.email}?\n\nThis will remove the user from:\n- User profiles table\n- Supabase Auth\n- All related records\n\nThis action CANNOT be undone!`
          )
        ) {
          if (
            confirm(
              `🚨 FINAL WARNING\n\nType "DELETE" mentally and confirm to permanently remove:\n${user.email}\n\nThis is your last chance to cancel.`
            )
          ) {
            logger.log('🗑️ Permanently deleting user:', user.email)
            await permanentlyDeleteUser(user.id)
          }
        }
        break
    }
  }

  const handleFiltersChange = (newFilters: UserFilters) => {
    setFilters(newFilters)
  }

  const handleExport = () => {
    if (selectedUsers.length > 0) {
      exportUsers(selectedUsers)
    } else {
      exportUsers(filteredUsers)
    }
  }

  const handleRefresh = async () => {
    await refreshUsers()
  }

  const handleBulkAction = () => {
    setIsBulkActionsOpen(true)
  }

  const columns: ColumnDef<UserProfile>[] = [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label='Select all'
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label='Select row'
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: 'user',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='User' />
      ),
      cell: ({ row }) => {
        const user = row.original
        const initials =
          `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase()

        return (
          <div className='flex items-center space-x-3'>
            <Avatar className='h-8 w-8'>
              <AvatarImage
                src={user.avatar_url || ''}
                alt={user.full_name || ''}
              />
              <AvatarFallback>{initials || 'U'}</AvatarFallback>
            </Avatar>
            <div>
              <div className='text-sm font-medium'>
                {user.full_name ||
                  `${user.first_name || ''} ${user.last_name || ''}`.trim() ||
                  'Unnamed User'}
              </div>
              <div className='text-muted-foreground text-xs'>{user.email}</div>
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'username',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Username' />
      ),
      cell: ({ row }) => {
        const username = row.getValue('username') as string
        return username ? (
          <span className='font-mono text-sm'>{username}</span>
        ) : (
          <span className='text-muted-foreground text-sm italic'>Not set</span>
        )
      },
    },
    {
      accessorKey: 'role',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Role' />
      ),
      cell: ({ row }) => {
        // CRITICAL FIX (Dec 20, 2025): Use role_display_name for custom roles
        const role = row.getValue('role') as string
        const roleDisplayName = (row.original as Record<string, unknown>)
          .role_display_name as string | undefined
        const displayRole = roleDisplayName || role
        return (
          <Badge variant='outline' className={getRoleColor(role)}>
            {displayRole}
          </Badge>
        )
      },
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
      },
    },
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Status' />
      ),
      cell: ({ row }) => {
        const status = row.getValue('status') as UserStatus
        return (
          <Badge variant='outline' className={getStatusColor(status)}>
            <span className='mr-1'>{getStatusIcon(status)}</span>
            {USER_STATUS_CONFIG[status]?.label || status}
          </Badge>
        )
      },
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
      },
    },
    {
      accessorKey: 'email_verified',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Email Verified' />
      ),
      cell: ({ row }) => {
        const verified = row.getValue('email_verified') as boolean
        return (
          <div className='flex items-center'>
            {verified ? (
              <Badge
                variant='outline'
                className='bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300'
              >
                <UserCheck className='mr-1 h-3 w-3' />
                Verified
              </Badge>
            ) : (
              <Badge
                variant='outline'
                className='bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300'
              >
                <UserX className='mr-1 h-3 w-3' />
                Unverified
              </Badge>
            )}
          </div>
        )
      },
      filterFn: (row, id, value) => {
        return value.includes(row.getValue(id))
      },
    },
    {
      accessorKey: 'last_seen',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Last Seen' />
      ),
      cell: ({ row }) => {
        const lastSeen = row.getValue('last_seen') as string
        if (!lastSeen)
          return <span className='text-muted-foreground text-sm'>Never</span>

        const date = new Date(lastSeen)
        const now = new Date()
        const diffMs = now.getTime() - date.getTime()
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
        const diffDays = Math.floor(diffHours / 24)

        let timeAgo: string
        if (diffHours < 1) {
          timeAgo = 'Just now'
        } else if (diffHours < 24) {
          timeAgo = `${diffHours}h ago`
        } else if (diffDays < 7) {
          timeAgo = `${diffDays}d ago`
        } else {
          timeAgo = date.toLocaleDateString()
        }

        return <span className='text-sm'>{timeAgo}</span>
      },
    },
    {
      accessorKey: 'created_at',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='Created' />
      ),
      cell: ({ row }) => {
        const createdAt = row.getValue('created_at') as string
        return (
          <span className='text-sm'>
            {new Date(createdAt).toLocaleDateString()}
          </span>
        )
      },
    },
    // Deleted At column - only shown when viewing deleted users
    ...((isViewingDeletedUsers
      ? [
          {
            accessorKey: 'deleted_at',
            header: ({ column }: { column: Column<UserProfile> }) => (
              <DataTableColumnHeader column={column} title='Deleted At' />
            ),
            cell: ({ row }: { row: Row<UserProfile> }) => {
              const deletedAt = row.getValue('deleted_at') as string
              if (!deletedAt)
                return <span className='text-muted-foreground text-sm'>-</span>
              return (
                <span className='text-sm text-red-600'>
                  {new Date(deletedAt).toLocaleDateString()}
                </span>
              )
            },
          },
        ]
      : []) as ColumnDef<UserProfile>[]),
    {
      id: 'actions',
      cell: ({ row }) => {
        const user = row.original
        const canChangeStatus = user.status !== 'terminated'
        const isDeleted = !!user.deleted_at

        // Simplified actions for deleted users
        if (isDeleted) {
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant='ghost' className='h-8 w-8 p-0'>
                  <span className='sr-only'>Open menu</span>
                  <MoreHorizontal className='h-4 w-4' />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-56'>
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => handleRowAction('view', user)}>
                  <Eye className='mr-2 h-4 w-4' />
                  View Details
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <PermissionGuard resource='users' action='delete'>
                  <DropdownMenuItem
                    onClick={() => handleRowAction('restore', user)}
                    className='text-green-600 focus:text-green-600'
                  >
                    <RotateCcw className='mr-2 h-4 w-4' />
                    Restore User
                  </DropdownMenuItem>
                </PermissionGuard>
                <DropdownMenuSeparator />
                <PermissionGuard resource='users' action='delete'>
                  <DropdownMenuItem
                    onClick={() => handleRowAction('permanent-delete', user)}
                    className='text-red-600 focus:bg-red-50 focus:text-red-600 dark:focus:bg-red-900/20'
                  >
                    <Trash2 className='mr-2 h-4 w-4' />
                    Permanently Delete
                  </DropdownMenuItem>
                </PermissionGuard>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='ghost' className='h-8 w-8 p-0'>
                <span className='sr-only'>Open menu</span>
                <MoreHorizontal className='h-4 w-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-48'>
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => handleRowAction('view', user)}>
                <Eye className='mr-2 h-4 w-4' />
                View Details
              </DropdownMenuItem>
              <PermissionGuard resource='users' action='update'>
                <DropdownMenuItem onClick={() => handleRowAction('edit', user)}>
                  <Edit className='mr-2 h-4 w-4' />
                  Edit User
                </DropdownMenuItem>
              </PermissionGuard>
              <DropdownMenuSeparator />

              {/* Status Change - opens dedicated dialog */}
              {canChangeStatus && (
                <PermissionGuard resource='users' action='update'>
                  <DropdownMenuItem
                    onClick={() => handleRowAction('change-status', user)}
                  >
                    <UserCog className='mr-2 h-4 w-4' />
                    Change Status
                  </DropdownMenuItem>
                </PermissionGuard>
              )}

              {/* Quick status actions */}
              {user.status === 'suspended' && (
                <PermissionGuard resource='users' action='update'>
                  <DropdownMenuItem
                    onClick={() => handleRowAction('activate', user)}
                  >
                    <UserCheck className='mr-2 h-4 w-4' />
                    Activate User
                  </DropdownMenuItem>
                </PermissionGuard>
              )}

              {user.status === 'active' && (
                <PermissionGuard resource='users' action='update'>
                  <DropdownMenuItem
                    onClick={() => handleRowAction('suspend', user)}
                  >
                    <Ban className='mr-2 h-4 w-4' />
                    Suspend User
                  </DropdownMenuItem>
                </PermissionGuard>
              )}

              {user.status === 'on_leave' && (
                <PermissionGuard resource='users' action='update'>
                  <DropdownMenuItem
                    onClick={() => handleRowAction('activate', user)}
                  >
                    <UserCheck className='mr-2 h-4 w-4' />
                    Return from Leave
                  </DropdownMenuItem>
                </PermissionGuard>
              )}

              {user.status === 'invited' && (
                <DropdownMenuItem
                  onClick={() => handleRowAction('resend-invite', user)}
                >
                  <Mail className='mr-2 h-4 w-4' />
                  Resend Invitation
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator />

              <PermissionGuard resource='users' action='update'>
                <DropdownMenuItem
                  onClick={() => handleRowAction('reset-password', user)}
                >
                  <Key className='mr-2 h-4 w-4' />
                  Reset Password
                </DropdownMenuItem>
              </PermissionGuard>

              <PermissionGuard resource='permissions' action='manage'>
                <DropdownMenuItem
                  onClick={() => handleRowAction('permissions', user)}
                >
                  <Shield className='mr-2 h-4 w-4' />
                  Manage Permissions
                </DropdownMenuItem>
              </PermissionGuard>

              <PermissionGuard resource='roles' action='update'>
                <DropdownMenuItem
                  onClick={() => handleRowAction('change-role', user)}
                >
                  <UserCog className='mr-2 h-4 w-4' />
                  Change Role
                </DropdownMenuItem>
              </PermissionGuard>

              <DropdownMenuSeparator />
              <PermissionGuard resource='users' action='delete'>
                <DropdownMenuItem
                  onClick={() => handleRowAction('delete', user)}
                  className='text-red-600 focus:text-red-600'
                >
                  <Trash2 className='mr-2 h-4 w-4' />
                  Delete User
                </DropdownMenuItem>
              </PermissionGuard>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  // React Table configuration
  const table = useReactTable({
    data: filteredUsers,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
    },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  // Loading skeleton
  if (loading) {
    return (
      <div className='space-y-4'>
        <div className='flex items-center gap-2'>
          <Skeleton className='h-9 w-[200px]' />
          <Skeleton className='h-9 w-[100px]' />
          <Skeleton className='h-9 w-[100px]' />
        </div>
        <div className='rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                {Array.from({ length: 8 }).map((_, i) => (
                  <TableHead key={i}>
                    <Skeleton className='h-4 w-20' />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className='h-4 w-full' />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {/* Toolbar */}
      <DataTableToolbar
        table={table}
        filters={filters}
        onFiltersChange={handleFiltersChange}
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        onExport={handleExport}
        onRefresh={handleRefresh}
        selectedCount={selectedUserIds.length}
        onBulkAction={handleBulkAction}
        isLoading={loading || isFetching}
      />

      {/* Table */}
      <div className='rounded-md border'>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className='h-24 text-center'
                >
                  No users found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <DataTablePagination table={table} />

      {/* Bulk Actions Dialog */}
      <BulkActionsDialog
        selectedUsers={selectedUsers}
        selectedUserIds={selectedUserIds}
        open={isBulkActionsOpen}
        onOpenChange={setIsBulkActionsOpen}
      />
    </div>
  )
}
