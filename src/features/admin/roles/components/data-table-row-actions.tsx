// Created and developed by Jai Singh
import { Row } from '@tanstack/react-table'
import {
  MoreHorizontal,
  Edit,
  Shield,
  Trash2,
  Menu,
  Layout,
  Zap,
  Wand2,
  Copy,
  Download,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { useRoles } from '../context/roles-context'
import { Role } from '../data/schema'

interface DataTableRowActionsProps<TData> {
  row: Row<TData>
}

export function DataTableRowActions<TData>({
  row,
}: DataTableRowActionsProps<TData>) {
  const role = row.original as Role
  const {
    setCurrentRole,
    setIsEditDialogOpen,
    setIsDeleteDialogOpen,
    setIsPermissionsDialogOpen,
    setIsNavigationDialogOpen,
    setIsTabPermissionsDialogOpen,
    setIsQuickEditDialogOpen,
    setIsWizardEditDialogOpen,
    duplicateRole,
    exportRole,
    isDuplicating,
  } = useRoles()

  // Quick Edit - Opens unified tabbed dialog
  const handleQuickEdit = () => {
    setCurrentRole(role)
    setIsQuickEditDialogOpen(true)
  }

  // Full Edit - Opens enhanced wizard
  const handleWizardEdit = () => {
    setCurrentRole(role)
    setIsWizardEditDialogOpen(true)
  }

  // Legacy: Basic Edit (just name/description)
  const handleEdit = () => {
    setCurrentRole(role)
    setIsEditDialogOpen(true)
  }

  // Legacy: Manage Permissions only
  const handleManagePermissions = () => {
    setCurrentRole(role)
    setIsPermissionsDialogOpen(true)
  }

  // Legacy: Manage Navigation only
  const handleManageNavigation = () => {
    setCurrentRole(role)
    setIsNavigationDialogOpen(true)
  }

  // Legacy: Manage Tab Permissions only
  const handleManageTabPermissions = () => {
    setCurrentRole(role)
    setIsTabPermissionsDialogOpen(true)
  }

  /**
   * Duplicate role with all permissions, navigation, and tabs
   * BUG FIX (Jan 27, 2026): Now properly calls the service to copy all permission types
   */
  const handleDuplicate = async () => {
    // The duplicateRole function now handles everything including:
    // - Creating the new role
    // - Copying all THREE permission types (base, navigation, tabs)
    // - Showing toast notifications with counts
    // - Refreshing the roles list
    await duplicateRole(role)
  }

  // Export role
  const handleExport = () => {
    exportRole(role)
  }

  // Delete role
  const handleDelete = () => {
    setCurrentRole(role)
    setIsDeleteDialogOpen(true)
  }

  const isSystemRole = role.isSystem
  const isSuperAdmin = role.name === 'superadmin'

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
      <DropdownMenuContent align='end' className='w-[200px]'>
        <PermissionGuard resource='roles' action='update'>
          <DropdownMenuLabel>Edit Role</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={handleQuickEdit}>
              <Zap className='mr-2 h-4 w-4 text-blue-500' />
              Quick Edit
              <span className='text-muted-foreground ml-auto text-xs'>
                Tabs
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleWizardEdit}>
              <Wand2 className='mr-2 h-4 w-4 text-purple-500' />
              Full Edit
              <span className='text-muted-foreground ml-auto text-xs'>
                Wizard
              </span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </PermissionGuard>

        <PermissionGuard resource='roles' action='update'>
          <DropdownMenuLabel>Manage</DropdownMenuLabel>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Shield className='mr-2 h-4 w-4' />
              Quick Access
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={handleEdit}>
                <Edit className='mr-2 h-4 w-4' />
                Basic Info
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleManagePermissions}>
                <Shield className='mr-2 h-4 w-4' />
                Permissions Only
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleManageNavigation}>
                <Menu className='mr-2 h-4 w-4' />
                Navigation Only
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleManageTabPermissions}>
                <Layout className='mr-2 h-4 w-4' />
                Tab Permissions Only
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
        </PermissionGuard>

        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuGroup>
          <PermissionGuard resource='roles' action='create'>
            <DropdownMenuItem
              onClick={handleDuplicate}
              disabled={isDuplicating}
            >
              {isDuplicating ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : (
                <Copy className='mr-2 h-4 w-4' />
              )}
              {isDuplicating ? 'Duplicating...' : 'Duplicate Role'}
            </DropdownMenuItem>
          </PermissionGuard>
          <DropdownMenuItem onClick={handleExport}>
            <Download className='mr-2 h-4 w-4' />
            Export Config
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <PermissionGuard resource='roles' action='delete'>
          <DropdownMenuItem
            onClick={handleDelete}
            className='text-destructive focus:text-destructive'
            disabled={isSuperAdmin || isSystemRole}
          >
            <Trash2 className='mr-2 h-4 w-4' />
            Delete Role
          </DropdownMenuItem>
        </PermissionGuard>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Created and developed by Jai Singh
