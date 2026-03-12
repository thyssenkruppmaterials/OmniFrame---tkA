/**
 * Typed utility interfaces for Supabase RPC responses.
 * Eliminates repeated `any` in auth/security modules.
 */
import type { PostgrestError } from '@supabase/supabase-js'

/** Generic Supabase query result */
export interface SupabaseResult<T> {
  data: T | null
  error: PostgrestError | null
}

/** Supabase single-row result */
export interface SupabaseSingleResult<T> {
  data: T | null
  error: PostgrestError | null
}

/** Supabase list result */
export interface SupabaseListResult<T> {
  data: T[] | null
  error: PostgrestError | null
}

/** Common permission from role_permissions join */
export interface PermissionJoinRow {
  permission: {
    resource: string
    action: string
  } | null
}

/** Role permission with permission details */
export interface RolePermissionRow {
  permission: {
    id: string
    resource: string
    action: string
    description?: string
  } | null
}

/** User profile row from Supabase */
export interface UserProfileRow {
  id: string
  email: string
  role_id?: string
  organization_id?: string
  role?: string
  full_name?: string
  first_name?: string | null
  last_name?: string | null
  username?: string | null
  phone_number?: string | null
  avatar_url?: string | null
  status?: string
  preferences?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  outbound_column_order?: Record<string, unknown> | null
  created_at?: string | null
  updated_at?: string | null
}
