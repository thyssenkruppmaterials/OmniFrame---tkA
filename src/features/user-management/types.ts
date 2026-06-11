// Created and developed by Jai Singh
import { z } from 'zod'

// User Roles - Updated to support both system and custom roles (December 20, 2025)
// Changed from enum to string to support custom roles created dynamically
export const userRoleSchema = z.string().min(1, 'Role is required')
export type UserRole = string

// Predefined system roles for reference
export const SYSTEM_ROLES = [
  'superadmin',
  'admin',
  'manager',
  'cashier',
  'viewer',
  'tka_associate',
  'inventory_specialist',
  'logistics_coordinator',
  'quality_specialist',
] as const

// User Status - Extended January 4, 2026 for full HR workflow
export const userStatusSchema = z.enum([
  'active',
  'inactive',
  'invited',
  'suspended',
  'terminated',
  'on_leave',
])
export type UserStatus = z.infer<typeof userStatusSchema>

// User Status Display Configuration
export const USER_STATUS_CONFIG: Record<
  UserStatus,
  {
    label: string
    description: string
    color: string
    icon: string
    canTransitionTo: UserStatus[]
  }
> = {
  active: {
    label: 'Active',
    description: 'User has full access to the system',
    color:
      'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300',
    icon: 'UserCheck',
    canTransitionTo: ['inactive', 'suspended', 'on_leave', 'terminated'],
  },
  inactive: {
    label: 'Inactive',
    description: 'User account is deactivated',
    color: 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-300',
    icon: 'UserMinus',
    canTransitionTo: ['active', 'terminated'],
  },
  invited: {
    label: 'Invited',
    description: 'User has been invited but not yet activated',
    color:
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300',
    icon: 'Mail',
    canTransitionTo: ['active', 'terminated'],
  },
  suspended: {
    label: 'Suspended',
    description: 'User account is temporarily suspended',
    color: 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-300',
    icon: 'Ban',
    canTransitionTo: ['active', 'terminated'],
  },
  terminated: {
    label: 'Terminated',
    description: 'User has been permanently terminated',
    color: 'bg-red-200 text-red-900 dark:bg-red-950/40 dark:text-red-200',
    icon: 'UserX',
    canTransitionTo: [], // Cannot transition from terminated
  },
  on_leave: {
    label: 'On Leave',
    description: 'User is temporarily on leave',
    color:
      'bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-300',
    icon: 'Clock',
    canTransitionTo: ['active', 'terminated'],
  },
}

// User Profile Schema - Extended with status tracking fields
export const userProfileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  username: z.string().min(3).max(100).nullable(),
  first_name: z.string().min(1).max(100).nullable(),
  last_name: z.string().min(1).max(100).nullable(),
  full_name: z.string().nullable(),
  avatar_url: z.string().url().nullable(),
  phone_number: z.string().max(50).nullable(),
  role: userRoleSchema.nullable(),
  // ADDED Feb 5, 2026: UUID reference to roles table (canonical role identifier)
  role_id: z.string().uuid().nullable().optional(),
  // ADDED Dec 20, 2025: Display name from roles table for custom roles
  role_display_name: z.string().nullable().optional(),
  status: userStatusSchema.nullable().default('active'),
  email_verified: z.boolean().nullable().default(false),
  two_factor_enabled: z.boolean().nullable().default(false),
  last_seen: z.string().datetime().nullable(),
  organization_id: z.string().uuid().nullable(),
  preferences: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable(),
  // ADDED Jan 4, 2026: Status tracking fields
  termination_date: z.string().datetime().nullable().optional(),
  termination_reason: z.string().nullable().optional(),
  status_change_reason: z.string().nullable().optional(),
  status_changed_at: z.string().datetime().nullable().optional(),
  status_changed_by: z.string().uuid().nullable().optional(),
  leave_start_date: z.string().nullable().optional(),
  leave_return_date: z.string().nullable().optional(),
})

export type UserProfile = z.infer<typeof userProfileSchema>

// Status Change Schema - For tracking status changes with reasons
export const statusChangeSchema = z.object({
  new_status: userStatusSchema,
  reason: z.string().min(1, 'Reason is required').max(500),
  notes: z.string().max(1000).optional(),
  effective_date: z.string().datetime().optional(),
  leave_return_date: z.string().optional(), // For on_leave status
})

export type StatusChangeData = z.infer<typeof statusChangeSchema>

// User Status History
export interface UserStatusHistory {
  id: string
  user_id: string
  previous_status: UserStatus | null
  new_status: UserStatus
  reason: string | null
  effective_date: string
  changed_by: string | null
  notes: string | null
  metadata: Record<string, unknown>
  created_at: string
}

// Final Create User Schema - handles invitation flow properly
export const createUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  username: z.string().optional(),
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  phone_number: z.string().optional(),
  role: userRoleSchema,
  password: z.string().optional(),
  confirm_password: z.string().optional(),
  send_invite: z.boolean(),
})

export type CreateUserFormData = z.infer<typeof createUserSchema>

// Update User Schema
export const updateUserSchema = z.object({
  username: z
    .string()
    .max(100)
    .optional()
    .refine((val) => !val || val.length >= 3, {
      message: 'Username must be at least 3 characters if provided',
    }),
  first_name: z
    .string()
    .max(100)
    .optional()
    .refine((val) => !val || val.length >= 1, {
      message: 'First name must be at least 1 character if provided',
    }),
  last_name: z
    .string()
    .max(100)
    .optional()
    .refine((val) => !val || val.length >= 1, {
      message: 'Last name must be at least 1 character if provided',
    }),
  phone_number: z.string().max(50).optional(),
  role: userRoleSchema.optional(),
  status: userStatusSchema.optional(),
  email_verified: z.boolean().optional(),
  two_factor_enabled: z.boolean().optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type UpdateUserFormData = z.infer<typeof updateUserSchema>

// User Invite Schema
export const inviteUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: userRoleSchema,
  first_name: z.string().min(1, 'First name is required').max(100),
  last_name: z.string().min(1, 'Last name is required').max(100),
  message: z.string().max(500).optional(),
})

export type InviteUserFormData = z.infer<typeof inviteUserSchema>

// Password Reset Schema
export const passwordResetSchema = z
  .object({
    new_password: z.string().min(8, 'Password must be at least 8 characters'),
    confirm_password: z.string(),
    send_email: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (data.new_password !== data.confirm_password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passwords don't match",
        path: ['confirm_password'],
      })
    }
  })

export type PasswordResetFormData = z.infer<typeof passwordResetSchema>

// Bulk Actions - Extended January 4, 2026
export const bulkActionSchema = z.enum([
  'activate',
  'deactivate',
  'suspend',
  'terminate',
  'set_on_leave',
  'delete',
  'change_role',
  'send_invitation',
  'export',
])
export type BulkAction = z.infer<typeof bulkActionSchema>

export const bulkActionDataSchema = z.object({
  action: bulkActionSchema,
  user_ids: z.array(z.string().uuid()),
  role: userRoleSchema.optional(),
  reason: z.string().max(500).optional(),
  leave_return_date: z.string().optional(),
})

export type BulkActionData = z.infer<typeof bulkActionDataSchema>

// Bulk Action Configuration
export const BULK_ACTION_CONFIG: Record<
  BulkAction,
  {
    label: string
    description: string
    icon: string
    variant: 'default' | 'destructive' | 'secondary' | 'outline'
    requiresReason: boolean
    requiresConfirmation: boolean
  }
> = {
  activate: {
    label: 'Activate',
    description: 'Activate selected users',
    icon: 'UserCheck',
    variant: 'default',
    requiresReason: false,
    requiresConfirmation: true,
  },
  deactivate: {
    label: 'Deactivate',
    description: 'Deactivate selected users',
    icon: 'UserMinus',
    variant: 'secondary',
    requiresReason: true,
    requiresConfirmation: true,
  },
  suspend: {
    label: 'Suspend',
    description: 'Suspend selected users',
    icon: 'Ban',
    variant: 'destructive',
    requiresReason: true,
    requiresConfirmation: true,
  },
  terminate: {
    label: 'Terminate',
    description: 'Permanently terminate selected users',
    icon: 'UserX',
    variant: 'destructive',
    requiresReason: true,
    requiresConfirmation: true,
  },
  set_on_leave: {
    label: 'Set On Leave',
    description: 'Set selected users on leave',
    icon: 'Clock',
    variant: 'secondary',
    requiresReason: true,
    requiresConfirmation: true,
  },
  delete: {
    label: 'Delete',
    description: 'Delete selected users',
    icon: 'Trash2',
    variant: 'destructive',
    requiresReason: false,
    requiresConfirmation: true,
  },
  change_role: {
    label: 'Change Role',
    description: 'Change role for selected users',
    icon: 'Shield',
    variant: 'outline',
    requiresReason: false,
    requiresConfirmation: true,
  },
  send_invitation: {
    label: 'Send Invitation',
    description: 'Resend invitation to selected users',
    icon: 'Mail',
    variant: 'outline',
    requiresReason: false,
    requiresConfirmation: false,
  },
  export: {
    label: 'Export',
    description: 'Export selected users to CSV',
    icon: 'Download',
    variant: 'outline',
    requiresReason: false,
    requiresConfirmation: false,
  },
}

// User Statistics - Extended January 4, 2026
export interface UserStats {
  total: number
  active: number
  inactive: number
  invited: number
  suspended: number
  terminated: number
  on_leave: number
  pending: number
  admins: number
  newThisMonth: number
  activePercentage: number
  deleted: number // Soft-deleted users count
}

// User Filters - Updated January 4, 2026: Added include_deleted option
export interface UserFilters {
  search?: string
  role?: UserRole[]
  status?: UserStatus[]
  organization_id?: string
  email_verified?: boolean
  two_factor_enabled?: boolean
  created_after?: string
  created_before?: string
  include_deleted?: boolean // Show soft-deleted users
}

// User Permissions
export interface UserPermission {
  id: string
  name: string
  resource: string
  action: string
  description?: string
  granted: boolean
  expires_at?: string
}

// Activity Log
export interface UserActivity {
  id: string
  user_id: string
  action: string
  resource: string
  details: Record<string, unknown>
  ip_address?: string
  user_agent?: string
  created_at: string
}

// User Management Context Type - Extended January 4, 2026
export interface UserManagementContextType {
  users: UserProfile[]
  loading: boolean
  error: string | null
  stats: UserStats | null
  selectedUsers: string[]
  currentUser: UserProfile | null
  filters: UserFilters

  // Dialog states
  isViewDialogOpen: boolean
  setIsViewDialogOpen: (open: boolean) => void
  isEditDialogOpen: boolean
  setIsEditDialogOpen: (open: boolean) => void
  isPermissionsDialogOpen: boolean
  setIsPermissionsDialogOpen: (open: boolean) => void
  isPasswordResetDialogOpen: boolean
  setIsPasswordResetDialogOpen: (open: boolean) => void
  isChangeRoleDialogOpen: boolean
  setIsChangeRoleDialogOpen: (open: boolean) => void
  isStatusChangeDialogOpen: boolean
  setIsStatusChangeDialogOpen: (open: boolean) => void
  isBulkActionsDialogOpen: boolean
  setIsBulkActionsDialogOpen: (open: boolean) => void

  // Actions
  setSelectedUsers: (userIds: string[]) => void
  setCurrentUser: (user: UserProfile | null) => void
  setFilters: (filters: UserFilters) => void
  clearError: () => void
  refreshUsers: () => Promise<void>

  // User CRUD
  createUser: (data: CreateUserFormData) => Promise<UserProfile>
  updateUser: (userId: string, data: UpdateUserFormData) => Promise<UserProfile>
  deleteUser: (userId: string) => Promise<void>
  restoreUser: (userId: string) => Promise<void>
  permanentlyDeleteUser: (userId: string) => Promise<void>
  getUserById: (userId: string) => Promise<UserProfile>

  // User Management
  inviteUser: (data: InviteUserFormData) => Promise<void>
  resetPassword: (userId: string, data: PasswordResetFormData) => Promise<void>
  updateUserRole: (userId: string, role: UserRole) => Promise<void>
  updateUserStatus: (userId: string, status: UserStatus) => Promise<void>
  updateUserStatusWithReason: (
    userId: string,
    data: StatusChangeData
  ) => Promise<void>
  resendInvitation: (userId: string) => Promise<void>

  // Bulk Actions
  bulkUpdateUsers: (data: BulkActionData) => Promise<void>

  // Permissions
  getUserPermissions: (userId: string) => Promise<UserPermission[]>
  updateUserPermissions: (
    userId: string,
    permissions: UserPermission[]
  ) => Promise<void>

  // Activity
  getUserActivity: (userId: string) => Promise<UserActivity[]>
  getUserStatusHistory: (userId: string) => Promise<UserStatusHistory[]>
}

// Created and developed by Jai Singh
