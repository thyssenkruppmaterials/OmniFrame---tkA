import { ColumnDef } from '@tanstack/react-table'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import LongText from '@/components/long-text'
import { roleTypes } from '../data/data'
import { Role } from '../data/schema'
import { DataTableColumnHeader } from './data-table-column-header'
import { DataTableRowActions } from './data-table-row-actions'

export const columns: ColumnDef<Role>[] = [
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
        className='translate-y-[2px]'
      />
    ),
    meta: {
      className: cn(
        'sticky md:table-cell left-0 z-10 rounded-tl',
        'bg-background group-hover/row:bg-muted group-data-[state=selected]/row:bg-muted'
      ),
    },
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label='Select row'
        className='translate-y-[2px]'
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: 'name',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Role Name' />
    ),
    cell: ({ row }) => {
      const { name, displayName, isSystem, isActive, createdAt, permissions } =
        row.original
      const roleType = roleTypes.find(({ value }) => value === name)

      // Check if role is newly created (within last 7 days)
      const isNewRole =
        new Date().getTime() - new Date(createdAt).getTime() <
        7 * 24 * 60 * 60 * 1000

      // Check if role has elevated privileges (admin-level permissions)
      const hasElevatedPrivileges =
        permissions?.some(
          (perm) =>
            perm.includes('*:*') ||
            perm.includes('users:') ||
            perm.includes('roles:') ||
            name === 'superadmin' ||
            name === 'admin'
        ) || false

      return (
        <div className='flex flex-col space-y-1'>
          <div className='flex flex-wrap items-center gap-x-2'>
            {roleType?.icon && (
              <roleType.icon size={16} className='text-muted-foreground' />
            )}
            <LongText className='max-w-36 font-medium'>{displayName}</LongText>
            <div className='flex items-center gap-1'>
              {isSystem ? (
                <Badge variant='secondary' className='text-xs'>
                  System
                </Badge>
              ) : (
                <Badge
                  variant='outline'
                  className='border-blue-300 text-xs text-blue-700 dark:border-blue-600 dark:text-blue-400'
                >
                  Custom
                </Badge>
              )}
              {!isActive && (
                <Badge variant='destructive' className='text-xs'>
                  Inactive
                </Badge>
              )}
              {isNewRole && (
                <Badge
                  variant='default'
                  className='bg-green-600 text-xs hover:bg-green-600/80'
                >
                  New
                </Badge>
              )}
              {hasElevatedPrivileges && (
                <Badge
                  variant='outline'
                  className='border-orange-300 text-xs text-orange-700 dark:border-orange-600 dark:text-orange-400'
                >
                  Elevated
                </Badge>
              )}
            </div>
          </div>
          <code className='text-muted-foreground ml-6 text-xs'>{name}</code>
        </div>
      )
    },
    meta: {
      className: cn(
        'drop-shadow-[0_1px_2px_rgb(0_0_0_/_0.1)] dark:drop-shadow-[0_1px_2px_rgb(255_255_255_/_0.1)] lg:drop-shadow-none',
        'bg-background group-hover/row:bg-muted group-data-[state=selected]/row:bg-muted',
        'sticky left-6 md:table-cell'
      ),
    },
    enableHiding: false,
  },
  {
    accessorKey: 'description',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Description' />
    ),
    cell: ({ row }) => (
      <LongText className='max-w-64'>
        {row.getValue('description') || 'No description'}
      </LongText>
    ),
    meta: { className: 'w-64' },
  },
  {
    accessorKey: 'userCount',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Users' />
    ),
    cell: ({ row }) => (
      <Badge variant='secondary'>{row.getValue('userCount') || 0} users</Badge>
    ),
    enableSorting: true,
  },
  {
    accessorKey: 'permissions',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Permissions' />
    ),
    cell: ({ row }) => {
      const permissions = (row.getValue('permissions') as string[]) || []
      const permissionCount = permissions.length

      return (
        <div className='flex items-center gap-2'>
          <Badge variant='outline'>
            {permissionCount} permission{permissionCount !== 1 ? 's' : ''}
          </Badge>
          {permissions.slice(0, 2).map((perm, index) => (
            <Badge key={index} variant='outline' className='text-xs'>
              {perm}
            </Badge>
          ))}
          {permissionCount > 2 && (
            <Badge variant='outline' className='text-xs'>
              +{permissionCount - 2} more
            </Badge>
          )}
        </div>
      )
    },
    enableSorting: false,
  },
  {
    accessorKey: 'createdAt',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Created' />
    ),
    cell: ({ row }) => {
      const date = new Date(row.getValue('createdAt'))
      return (
        <div className='text-muted-foreground text-sm'>
          {date.toLocaleDateString()}
        </div>
      )
    },
    enableSorting: true,
  },
  {
    id: 'actions',
    cell: DataTableRowActions,
  },
]
