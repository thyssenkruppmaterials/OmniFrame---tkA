import { Row } from '@tanstack/react-table'
import { MoreHorizontal, Edit, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Permission } from '../../roles/data/schema'
import { usePermissions } from '../context/permissions-context'

interface DataTableRowActionsProps<TData> {
  row: Row<TData>
}

export function DataTableRowActions<TData>({
  row,
}: DataTableRowActionsProps<TData>) {
  const permission = row.original as Permission
  const { setCurrentPermission, setIsEditDialogOpen, setIsDeleteDialogOpen } =
    usePermissions()

  const handleEdit = () => {
    setCurrentPermission(permission)
    setIsEditDialogOpen(true)
  }

  const handleDelete = () => {
    setCurrentPermission(permission)
    setIsDeleteDialogOpen(true)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          className='data-[state=open]:bg-muted flex h-8 w-8 p-0'
        >
          <MoreHorizontal />
          <span className='sr-only'>Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-[160px]'>
        <PermissionGuard resource='permissions' action='update'>
          <DropdownMenuItem onClick={handleEdit}>
            <Edit className='mr-2 h-4 w-4' />
            Edit Permission
          </DropdownMenuItem>
        </PermissionGuard>
        <DropdownMenuSeparator />
        <PermissionGuard resource='permissions' action='delete'>
          <DropdownMenuItem
            onClick={handleDelete}
            className='text-destructive focus:text-destructive'
          >
            <Trash2 className='mr-2 h-4 w-4' />
            Delete Permission
          </DropdownMenuItem>
        </PermissionGuard>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
