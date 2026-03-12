import { ColumnDef } from '@tanstack/react-table'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import LongText from '@/components/long-text'
import { permissionActions, resourceTypes } from '../../roles/data/data'
import { Permission } from '../../roles/data/schema'
import { DataTableColumnHeader } from './data-table-column-header'
import { DataTableRowActions } from './data-table-row-actions'

export const columns: ColumnDef<Permission>[] = [
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
      <DataTableColumnHeader column={column} title='Permission Name' />
    ),
    cell: ({ row }) => (
      <LongText className='max-w-48 font-mono text-sm'>
        {row.getValue('name')}
      </LongText>
    ),
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
    accessorKey: 'resource',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Resource' />
    ),
    cell: ({ row }) => {
      const resource = row.getValue('resource') as string
      const resourceType = resourceTypes.find((r) => r.value === resource)

      return (
        <Badge variant='outline' className='capitalize'>
          {resourceType?.label || resource}
        </Badge>
      )
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id))
    },
    enableSorting: false,
  },
  {
    accessorKey: 'action',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Action' />
    ),
    cell: ({ row }) => {
      const action = row.getValue('action') as string
      const actionType = permissionActions.find((a) => a.value === action)

      return (
        <div className='flex items-center gap-2'>
          {actionType?.icon && (
            <actionType.icon size={16} className='text-muted-foreground' />
          )}
          <span className='capitalize'>{actionType?.label || action}</span>
        </div>
      )
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id))
    },
    enableSorting: false,
  },
  {
    accessorKey: 'description',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Description' />
    ),
    cell: ({ row }) => (
      <LongText className='text-muted-foreground max-w-64 text-sm'>
        {row.getValue('description') || 'No description'}
      </LongText>
    ),
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
