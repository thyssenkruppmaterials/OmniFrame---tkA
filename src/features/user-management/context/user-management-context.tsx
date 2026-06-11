// Created and developed by Jai Singh
import { createContext, useContext, useState, ReactNode } from 'react'
import type {
  UserManagementContextType,
  UserProfile,
  UserFilters,
} from '../types'

const UserManagementContext = createContext<
  UserManagementContextType | undefined
>(undefined)

interface UserManagementProviderProps {
  children: ReactNode
}

export function UserManagementProvider({
  children,
}: UserManagementProviderProps) {
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null)
  const [filters, setFilters] = useState<UserFilters>({})

  // Dialog states
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isPermissionsDialogOpen, setIsPermissionsDialogOpen] = useState(false)
  const [isPasswordResetDialogOpen, setIsPasswordResetDialogOpen] =
    useState(false)
  const [isChangeRoleDialogOpen, setIsChangeRoleDialogOpen] = useState(false)
  // ADDED January 4, 2026: New dialog states for status management
  const [isStatusChangeDialogOpen, setIsStatusChangeDialogOpen] =
    useState(false)
  const [isBulkActionsDialogOpen, setIsBulkActionsDialogOpen] = useState(false)

  const clearError = () => {
    // This will be handled by React Query
  }

  // Context value will be populated by the useUserManagement hook
  const contextValue: UserManagementContextType = {
    users: [],
    loading: false,
    error: null,
    stats: null,
    selectedUsers,
    currentUser,
    filters,

    // Dialog states
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
    // ADDED January 4, 2026: New dialog states
    isStatusChangeDialogOpen,
    setIsStatusChangeDialogOpen,
    isBulkActionsDialogOpen,
    setIsBulkActionsDialogOpen,

    setSelectedUsers,
    setCurrentUser,
    setFilters,
    clearError,

    // These will be properly implemented in the hook
    refreshUsers: async () => {},
    createUser: async () => ({}) as UserProfile,
    updateUser: async () => ({}) as UserProfile,
    deleteUser: async () => {},
    restoreUser: async () => {},
    permanentlyDeleteUser: async () => {},
    getUserById: async () => ({}) as UserProfile,
    inviteUser: async () => {},
    resetPassword: async () => {},
    updateUserRole: async () => {},
    updateUserStatus: async () => {},
    updateUserStatusWithReason: async () => {},
    resendInvitation: async () => {},
    bulkUpdateUsers: async () => {},
    getUserPermissions: async () => [],
    updateUserPermissions: async () => {},
    getUserActivity: async () => [],
    getUserStatusHistory: async () => [],
  }

  return (
    <UserManagementContext.Provider value={contextValue}>
      {children}
    </UserManagementContext.Provider>
  )
}

export function useUserManagementContext() {
  const context = useContext(UserManagementContext)
  if (context === undefined) {
    throw new Error(
      'useUserManagementContext must be used within a UserManagementProvider'
    )
  }
  return context
}

// Created and developed by Jai Singh
