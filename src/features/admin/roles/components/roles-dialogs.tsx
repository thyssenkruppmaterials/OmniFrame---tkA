import { useRoles } from '../context/roles-context'
import { EnhancedRoleWizard } from './enhanced-role-wizard'
import { RoleDeleteDialog } from './role-delete-dialog'
import { RoleEditDialog } from './role-edit-dialog'
import { RoleNavigationDialog } from './role-navigation-dialog'
import { RolePermissionsDialog } from './role-permissions-dialog'
import { RoleTabPermissionsDialog } from './role-tab-permissions-dialog'
import { UnifiedRoleEditor } from './unified-role-editor'

export function RolesDialogs() {
  const {
    // Legacy dialogs
    isCreateDialogOpen,
    setIsCreateDialogOpen,
    isEditDialogOpen,
    setIsEditDialogOpen,
    isDeleteDialogOpen,
    setIsDeleteDialogOpen,
    isPermissionsDialogOpen,
    setIsPermissionsDialogOpen,
    isNavigationDialogOpen,
    setIsNavigationDialogOpen,
    isTabPermissionsDialogOpen,
    setIsTabPermissionsDialogOpen,
    // New dialogs
    isQuickEditDialogOpen,
    setIsQuickEditDialogOpen,
    isWizardEditDialogOpen,
    setIsWizardEditDialogOpen,
    // Current role
    currentRole,
  } = useRoles()

  return (
    <>
      {/* New Enhanced Wizard for Create */}
      <EnhancedRoleWizard
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        mode='create'
      />

      {/* New Enhanced Wizard for Full Edit */}
      <EnhancedRoleWizard
        open={isWizardEditDialogOpen}
        onOpenChange={setIsWizardEditDialogOpen}
        mode='edit'
        role={currentRole}
      />

      {/* New Unified Role Editor for Quick Edit */}
      <UnifiedRoleEditor
        open={isQuickEditDialogOpen}
        onOpenChange={setIsQuickEditDialogOpen}
        role={currentRole}
      />

      {/* Legacy Dialogs - kept for quick access submenu */}
      <RoleEditDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        role={currentRole}
      />

      <RoleDeleteDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        role={currentRole}
      />

      <RolePermissionsDialog
        open={isPermissionsDialogOpen}
        onOpenChange={setIsPermissionsDialogOpen}
        role={currentRole}
      />

      {currentRole && (
        <RoleNavigationDialog
          open={isNavigationDialogOpen}
          onOpenChange={setIsNavigationDialogOpen}
          roleId={currentRole.id}
          roleName={currentRole.displayName || currentRole.name}
        />
      )}

      {currentRole && (
        <RoleTabPermissionsDialog
          open={isTabPermissionsDialogOpen}
          onOpenChange={setIsTabPermissionsDialogOpen}
          roleId={currentRole.id}
          roleName={currentRole.displayName || currentRole.name}
        />
      )}
    </>
  )
}
