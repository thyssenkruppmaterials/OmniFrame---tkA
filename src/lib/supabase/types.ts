// Re-export database types for easier imports
// Supabase specific types
import type { User, Session, AuthError } from '@supabase/supabase-js'
import type {
  Database,
  UserProfile,
  UserRole,
  Organization,
} from './database.types'

export type { Database, UserProfile, UserRole, Organization }

// Type definitions for convenience
export type UserStatus = Database['public']['Enums']['user_status']
export type TaskStatus = Database['public']['Enums']['task_status']
export type TaskPriority = Database['public']['Enums']['task_priority']
export type NotificationType = Database['public']['Enums']['notification_type']
export type Application = Database['public']['Tables']['applications']['Row']
export type Chat = Database['public']['Tables']['chats']['Row']
export type Message = Database['public']['Tables']['messages']['Row']
export type Notification = Database['public']['Tables']['notifications']['Row']
export type Task = Database['public']['Tables']['tasks']['Row']

export type { User, Session, AuthError }

// Auth state types
export interface AuthUser {
  id: string
  email: string
  role: UserRole[]
  exp: number
  profile?: UserProfile
}

export interface AuthState {
  user: User | null
  session: Session | null
  profile: UserProfile | null
  isLoading: boolean
  isAuthenticated: boolean

  // Actions
  setUser: (user: User | null) => void
  setSession: (session: Session | null) => void
  setProfile: (profile: UserProfile | null) => void
  setLoading: (loading: boolean) => void

  // Auth methods
  signIn: (email: string, password: string) => Promise<void>
  signUp: (
    email: string,
    password: string,
    metadata?: Record<string, unknown>
  ) => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  updatePassword: (newPassword: string) => Promise<void>

  // OAuth
  signInWithProvider: (
    provider: 'google' | 'github' | 'discord'
  ) => Promise<void>

  // Profile methods
  fetchProfile: () => Promise<void>
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>

  // Session management
  refreshSession: () => Promise<void>
  checkSession: () => Promise<void>

  // Legacy compatibility (for existing codebase)
  auth: {
    user: AuthUser | null
    setUser: (user: AuthUser | null) => void
    accessToken: string
    setAccessToken: (accessToken: string) => void
    resetAccessToken: () => void
    reset: () => void
  }
}
