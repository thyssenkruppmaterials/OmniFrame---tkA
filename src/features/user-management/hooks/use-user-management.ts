// Created and developed by Jai Singh
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { UserManagementService } from '../services/user-management.service'
import type {
  BulkActionData,
  CreateUserFormData,
  InviteUserFormData,
  PasswordResetFormData,
  StatusChangeData,
  UpdateUserFormData,
  UserActivity,
  UserFilters,
  UserPermission,
  UserProfile,
  UserRole,
  UserStatus,
  UserStatusHistory,
} from '../types'

// Debounce delay for search (ms)
const SEARCH_DEBOUNCE_MS = 300

export function useUserManagement() {
  const queryClient = useQueryClient()
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])

  // Separate search input state (immediate) from debounced search (for API)
  const [searchInput, setSearchInput] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [otherFilters, setOtherFilters] = useState<Omit<UserFilters, 'search'>>(
    {}
  )

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput)
    }, SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [searchInput])

  // Combine debounced search with other filters for API calls
  const filters = useMemo<UserFilters>(
    () => ({
      ...otherFilters,
      search: debouncedSearch || undefined,
    }),
    [otherFilters, debouncedSearch]
  )

  // Filters for UI display (includes immediate search input)
  const displayFilters = useMemo<UserFilters>(
    () => ({
      ...otherFilters,
      search: searchInput || undefined,
    }),
    [otherFilters, searchInput]
  )

  // Update filters handler - handles both search and other filters
  const setFilters = useCallback((newFilters: UserFilters) => {
    const { search, ...rest } = newFilters
    // Update search input immediately (will be debounced for API)
    setSearchInput(search || '')
    // Update other filters immediately
    setOtherFilters(rest)
  }, [])

  // Query keys
  const QUERY_KEYS = {
    users: ['users', filters] as const,
    user: (id: string) => ['user', id] as const,
    userStats: ['user-stats'] as const,
    userPermissions: (id: string) => ['user-permissions', id] as const,
    userActivity: (id: string) => ['user-activity', id] as const,
    userStatusHistory: (id: string) => ['user-status-history', id] as const,
  }

  // Fetch users with keepPreviousData for smooth UX during loading
  const {
    data: users = [],
    isLoading: loading,
    isFetching,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: [...QUERY_KEYS.users, filters],
    queryFn: () => UserManagementService.getUsers(filters),
    staleTime: 1000 * 60 * 5, // 5 minutes
    placeholderData: keepPreviousData, // Keep showing old data while fetching new
  })

  // Fetch user statistics
  const { data: stats } = useQuery({
    queryKey: QUERY_KEYS.userStats,
    queryFn: UserManagementService.getUserStats,
    staleTime: 1000 * 60 * 10, // 10 minutes
  })

  // Error handling
  const error = queryError ? (queryError as Error).message : null

  // Create user mutation
  const createUserMutation = useMutation({
    mutationFn: UserManagementService.createUser,
    onSuccess: (newUser) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.userStats })
      toast.success(`User ${newUser.email} created successfully`)
    },
    onError: (error: Error) => {
      toast.error(`Failed to create user: ${error.message}`)
    },
  })

  // Update user mutation
  const updateUserMutation = useMutation({
    mutationFn: ({
      userId,
      data,
    }: {
      userId: string
      data: UpdateUserFormData
    }) => UserManagementService.updateUser(userId, data),
    onSuccess: (updatedUser) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.setQueryData(QUERY_KEYS.user(updatedUser.id), updatedUser)
      toast.success(`User updated successfully`)
    },
    onError: (error: Error) => {
      toast.error(`Failed to update user: ${error.message}`)
    },
  })

  // Delete user mutation
  const deleteUserMutation = useMutation({
    mutationFn: UserManagementService.deleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.userStats })
      toast.success('User deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete user: ${error.message}`)
    },
  })

  // Restore user mutation - ADDED January 4, 2026
  const restoreUserMutation = useMutation({
    mutationFn: UserManagementService.restoreUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.userStats })
      toast.success(
        'User restored successfully. User is now inactive - please activate them if needed.'
      )
    },
    onError: (error: Error) => {
      toast.error(`Failed to restore user: ${error.message}`)
    },
  })

  // Permanently delete user mutation - ADDED January 4, 2026
  const permanentlyDeleteUserMutation = useMutation({
    mutationFn: UserManagementService.permanentlyDeleteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.userStats })
      toast.success('User permanently deleted from the database.')
    },
    onError: (error: Error) => {
      toast.error(`Failed to permanently delete user: ${error.message}`)
    },
  })

  // Invite user mutation
  const inviteUserMutation = useMutation({
    mutationFn: UserManagementService.inviteUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.userStats })
      toast.success('User invitation sent successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to send invitation: ${error.message}`)
    },
  })

  // Reset password mutation
  const resetPasswordMutation = useMutation({
    mutationFn: ({
      userId,
      data,
    }: {
      userId: string
      data: PasswordResetFormData
    }) => UserManagementService.resetPassword(userId, data),
    onSuccess: () => {
      toast.success('Password reset successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to reset password: ${error.message}`)
    },
  })

  // Update user role mutation
  const updateUserRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: UserRole }) =>
      UserManagementService.updateUserRole(userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User role updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update user role: ${error.message}`)
    },
  })

  // Update user status mutation (simple)
  const updateUserStatusMutation = useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: UserStatus }) =>
      UserManagementService.updateUserStatus(userId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.userStats })
      toast.success('User status updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update user status: ${error.message}`)
    },
  })

  // Update user status with reason mutation - ADDED January 4, 2026
  const updateUserStatusWithReasonMutation = useMutation({
    mutationFn: ({
      userId,
      data,
    }: {
      userId: string
      data: StatusChangeData
    }) => UserManagementService.updateUserStatusWithReason(userId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.userStats })
      toast.success('User status updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update user status: ${error.message}`)
    },
  })

  // Resend invitation mutation
  const resendInvitationMutation = useMutation({
    mutationFn: UserManagementService.resendInvitation,
    onSuccess: () => {
      toast.success('Invitation resent successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to resend invitation: ${error.message}`)
    },
  })

  // Bulk update mutation
  // IMPORTANT: wrap in an arrow so `this` inside `bulkUpdateUsers` keeps
  // pointing at the class. TanStack Query calls `options.mutationFn(vars)`
  // which would otherwise re-bind `this` to the mutation options object,
  // making `this.updateUserRole` (and every other dispatch in the switch)
  // resolve to `undefined` at runtime. See
  // memorybank/OmniFrame/Debug/Fix-Bulk-Action-This-Binding.md
  const bulkUpdateMutation = useMutation({
    mutationFn: (data: BulkActionData) =>
      UserManagementService.bulkUpdateUsers(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.userStats })
      setSelectedUsers([]) // Clear selection
      toast.success('Bulk action completed successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to complete bulk action: ${error.message}`)
    },
  })

  // Update user permissions mutation
  const updateUserPermissionsMutation = useMutation({
    mutationFn: ({
      userId,
      permissions,
    }: {
      userId: string
      permissions: UserPermission[]
    }) => UserManagementService.updateUserPermissions(userId, permissions),
    onSuccess: (_, { userId }) => {
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.userPermissions(userId),
      })
      toast.success('User permissions updated successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to update permissions: ${error.message}`)
    },
  })

  // Helper functions
  const getUserById = async (userId: string): Promise<UserProfile> => {
    const existingData = queryClient.getQueryData(QUERY_KEYS.user(userId))
    if (existingData) return existingData as UserProfile

    const user = await UserManagementService.getUserById(userId)
    queryClient.setQueryData(QUERY_KEYS.user(userId), user)
    return user
  }

  const getUserPermissions = async (
    userId: string
  ): Promise<UserPermission[]> => {
    const data = await queryClient.fetchQuery({
      queryKey: QUERY_KEYS.userPermissions(userId),
      queryFn: () => UserManagementService.getUserPermissions(userId),
      staleTime: 1000 * 60 * 5, // 5 minutes
    })
    return data || []
  }

  const getUserActivity = async (userId: string): Promise<UserActivity[]> => {
    const data = await queryClient.fetchQuery({
      queryKey: QUERY_KEYS.userActivity(userId),
      queryFn: () => UserManagementService.getUserActivity(userId),
      staleTime: 1000 * 60 * 2, // 2 minutes
    })
    return data || []
  }

  const getUserStatusHistory = async (
    userId: string
  ): Promise<UserStatusHistory[]> => {
    const data = await queryClient.fetchQuery({
      queryKey: QUERY_KEYS.userStatusHistory(userId),
      queryFn: () => UserManagementService.getUserStatusHistory(userId),
      staleTime: 1000 * 60 * 2, // 2 minutes
    })
    return data || []
  }

  // Export users function
  const exportUsers = (usersToExport?: UserProfile[]) => {
    const dataToExport = usersToExport || users
    const csv = UserManagementService.exportUsersToCSV(dataToExport)

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)

    link.setAttribute('href', url)
    link.setAttribute(
      'download',
      `users_export_${new Date().toISOString().split('T')[0]}.csv`
    )
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    toast.success(`Exported ${dataToExport.length} users to CSV`)
  }

  return {
    // Data
    users,
    loading,
    isFetching, // True when loading new data (including background refetches)
    error,
    stats,
    selectedUsers,
    filters: displayFilters, // Use display filters (immediate search input) for UI
    searchInput, // Expose for toolbar to show current typing
    setSearchInput, // Direct setter for search input (no debounce wrapper needed)

    // Actions
    setSelectedUsers,
    setFilters,
    refreshUsers: async () => {
      await refetch()
    },

    // User CRUD
    createUser: async (data: CreateUserFormData) => {
      return await createUserMutation.mutateAsync(data)
    },
    updateUser: async (userId: string, data: UpdateUserFormData) => {
      return await updateUserMutation.mutateAsync({ userId, data })
    },
    deleteUser: async (userId: string) => {
      await deleteUserMutation.mutateAsync(userId)
    },
    restoreUser: async (userId: string) => {
      await restoreUserMutation.mutateAsync(userId)
    },
    permanentlyDeleteUser: async (userId: string) => {
      await permanentlyDeleteUserMutation.mutateAsync(userId)
    },
    getUserById,

    // User Management
    inviteUser: async (data: InviteUserFormData) => {
      await inviteUserMutation.mutateAsync(data)
    },
    resetPassword: async (userId: string, data: PasswordResetFormData) => {
      await resetPasswordMutation.mutateAsync({ userId, data })
    },
    updateUserRole: async (userId: string, role: UserRole) => {
      await updateUserRoleMutation.mutateAsync({ userId, role })
    },
    updateUserStatus: async (userId: string, status: UserStatus) => {
      await updateUserStatusMutation.mutateAsync({ userId, status })
    },
    updateUserStatusWithReason: async (
      userId: string,
      data: StatusChangeData
    ) => {
      await updateUserStatusWithReasonMutation.mutateAsync({ userId, data })
    },
    resendInvitation: async (userId: string) => {
      await resendInvitationMutation.mutateAsync(userId)
    },

    // Bulk Actions
    bulkUpdateUsers: async (data: BulkActionData) => {
      await bulkUpdateMutation.mutateAsync(data)
    },

    // Permissions and Activity
    getUserPermissions,
    updateUserPermissions: async (
      userId: string,
      permissions: UserPermission[]
    ) => {
      await updateUserPermissionsMutation.mutateAsync({ userId, permissions })
    },
    getUserActivity,
    getUserStatusHistory,

    // Export
    exportUsers,

    // Loading states
    isCreating: createUserMutation.isPending,
    isUpdating: updateUserMutation.isPending,
    isDeleting: deleteUserMutation.isPending,
    isRestoring: restoreUserMutation.isPending,
    isPermanentlyDeleting: permanentlyDeleteUserMutation.isPending,
    isInviting: inviteUserMutation.isPending,
    isResettingPassword: resetPasswordMutation.isPending,
    isUpdatingRole: updateUserRoleMutation.isPending,
    isUpdatingStatus:
      updateUserStatusMutation.isPending ||
      updateUserStatusWithReasonMutation.isPending,
    isResendingInvitation: resendInvitationMutation.isPending,
    isBulkUpdating: bulkUpdateMutation.isPending,
    isUpdatingPermissions: updateUserPermissionsMutation.isPending,
  }
}

// Created and developed by Jai Singh
