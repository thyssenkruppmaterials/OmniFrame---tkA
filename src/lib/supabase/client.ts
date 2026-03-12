/**
 * Supabase Client - Singleton Pattern
 *
 * CRITICAL: This file now uses a TRUE singleton pattern to prevent multiple
 * GoTrueClient instances. All imports of `supabase` will receive the SAME
 * client instance across the entire application.
 *
 * @version 2.0.0 - October 29, 2025
 * @author Jai Singh
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/utils/logger'
import type { Database } from './database.types'

// HMR-resistant global state using window object
declare global {
  interface Window {
    __OMNIFRAME_SUPABASE_CLIENT__?: SupabaseClient<Database>
    __OMNIFRAME_SUPABASE_ADMIN__?: SupabaseClient<Database> | null
    __OMNIFRAME_CLIENT_INIT__?: boolean
  }
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Please check your .env.local file.'
  )
}

/**
 * Get or create the singleton Supabase client instance
 * This ensures only ONE GoTrueClient exists across the entire application
 */
function getSupabaseClient(): SupabaseClient<Database> {
  // Check if client already exists in window (HMR-resistant)
  if (typeof window !== 'undefined' && window.__OMNIFRAME_SUPABASE_CLIENT__) {
    return window.__OMNIFRAME_SUPABASE_CLIENT__
  }

  // Create new client only if it doesn't exist
  const client = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      storageKey: 'omniframe-auth-token',
      flowType: 'pkce',
      // Add debug flag in development
      debug: import.meta.env.MODE === 'development',
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
    global: {
      headers: {
        'x-application-name': 'omniframe',
        'x-client-info': 'omniframe-web@1.4.3',
      },
    },
    db: {
      schema: 'public',
    },
  })

  // Store in window for HMR resistance and singleton enforcement
  if (typeof window !== 'undefined') {
    window.__OMNIFRAME_SUPABASE_CLIENT__ = client

    if (!window.__OMNIFRAME_CLIENT_INIT__) {
      logger.log('✅ Supabase client initialized (singleton pattern)')
      window.__OMNIFRAME_CLIENT_INIT__ = true
    }
  }

  return client
}

/**
 * Get or create the singleton admin client instance
 * NOTE: Admin client should ONLY be used on the backend/server side
 * Using it in the browser defeats RLS security and creates multiple GoTrueClient instances
 */
function getSupabaseAdmin(): SupabaseClient<Database> | null {
  // Check if admin client decision has been made
  if (typeof window !== 'undefined' && '__OMNIFRAME_SUPABASE_ADMIN__' in window) {
    return window.__OMNIFRAME_SUPABASE_ADMIN__ || null
  }

  // CRITICAL: Do NOT create admin client in browser to avoid multiple GoTrueClient instances
  // Admin operations should be handled via backend API endpoints
  if (import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY) {
    // Log warning only once per session to avoid console spam
    const warnKey = '__OMNIFRAME_SERVICE_KEY_WARNED__'
    if (
      typeof window !== 'undefined' &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      !(window as any)[warnKey]
    ) {
      logger.warn(
        '⚠️ SECURITY WARNING: VITE_SUPABASE_SERVICE_ROLE_KEY is set in frontend environment.\n' +
          'This key is NOT used by the frontend (admin client returns null), but exposing it\n' +
          'in the browser environment is a security risk.\n\n' +
          'ACTION REQUIRED: Remove VITE_SUPABASE_SERVICE_ROLE_KEY from your .env.local file.\n' +
          'Admin operations are handled securely via the backend API at /api/admin/*'
      )
      ;(window as unknown as Record<string, unknown>)[warnKey] = true
    }
  }

  // Store null decision in window to prevent repeated checks
  if (typeof window !== 'undefined') {
    window.__OMNIFRAME_SUPABASE_ADMIN__ = null
  }

  return null
}

// Export singleton instances
export const supabase = getSupabaseClient()
export const supabaseAdmin = getSupabaseAdmin()

// Helper function to check if we have valid environment variables
export const isSupabaseConfigured = (): boolean => {
  return !!(supabaseUrl && supabaseAnonKey)
}

// Helper function to check if admin client is available
export const isSupabaseAdminConfigured = (): boolean => {
  return !!(supabaseAdmin && import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY)
}

// Helper function to get current session
export const getCurrentSession = async () => {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session
}

// Helper function to get current user
export const getCurrentUser = async () => {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}
// Developer and Creator: Jai Singh
