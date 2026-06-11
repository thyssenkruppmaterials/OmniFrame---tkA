// Created and developed by Jai Singh
import { usePermissions } from '../context/permissions-context'
import { PermissionCreateDialog } from './permission-create-dialog'
import { PermissionDeleteDialog } from './permission-delete-dialog'
import { PermissionEditDialog } from './permission-edit-dialog'

export function PermissionsDialogs() {
  const {
    isCreateDialogOpen,
    setIsCreateDialogOpen,
    isEditDialogOpen,
    setIsEditDialogOpen,
    isDeleteDialogOpen,
    setIsDeleteDialogOpen,
    currentPermission,
  } = usePermissions()

  return (
    <>
      <PermissionCreateDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />

      <PermissionEditDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        permission={currentPermission}
      />

      <PermissionDeleteDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        permission={currentPermission}
      />
    </>
  )
}

// Created and developed by Jai Singh
