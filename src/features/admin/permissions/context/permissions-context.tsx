// Created and developed by Jai Singh
import { createContext, useContext, useState, type ReactNode } from 'react'
import { type Permission } from '../../../admin/roles/data/schema'

interface PermissionsState {
  permissions: Permission[]
  selectedPermissions: Permission[]
  setSelectedPermissions: (permissions: Permission[]) => void
  currentPermission: Permission | null
  setCurrentPermission: (permission: Permission | null) => void
  isCreateDialogOpen: boolean
  setIsCreateDialogOpen: (open: boolean) => void
  isEditDialogOpen: boolean
  setIsEditDialogOpen: (open: boolean) => void
  isDeleteDialogOpen: boolean
  setIsDeleteDialogOpen: (open: boolean) => void
}

const PermissionsContext = createContext<PermissionsState | undefined>(
  undefined
)

export function usePermissions() {
  const context = useContext(PermissionsContext)
  if (!context) {
    throw new Error('usePermissions must be used within a PermissionsProvider')
  }
  return context
}

interface PermissionsProviderProps {
  children: ReactNode
}

export default function PermissionsProvider({
  children,
}: PermissionsProviderProps) {
  const [permissions] = useState<Permission[]>([])
  const [selectedPermissions, setSelectedPermissions] = useState<Permission[]>(
    []
  )
  const [currentPermission, setCurrentPermission] = useState<Permission | null>(
    null
  )
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const value: PermissionsState = {
    permissions,
    selectedPermissions,
    setSelectedPermissions,
    currentPermission,
    setCurrentPermission,
    isCreateDialogOpen,
    setIsCreateDialogOpen,
    isEditDialogOpen,
    setIsEditDialogOpen,
    isDeleteDialogOpen,
    setIsDeleteDialogOpen,
  }

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  )
}

// Created and developed by Jai Singh
