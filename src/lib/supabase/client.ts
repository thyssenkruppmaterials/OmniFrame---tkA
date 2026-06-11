// Created and developed by Jai Singh
/**
 * Supabase Client - Singleton Pattern
 *
 * CRITICAL: This file now uses a TRUE singleton pattern to prevent multiple
 * GoTrueClient instances. All imports of `supabase` will receive the SAME
 * client instance across the entire application.
 *
 * @version 2.0.0 - October 29, 2025
 * @author OmniFrame Team
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/utils/logger'
import type { Database } from './database.types'

// HMR-resistant global state using window object
declare global {
  interface Window {
    __ONEBOX_SUPABASE_CLIENT__?: SupabaseClient<Database>
    __ONEBOX_SUPABASE_READ_CLIENT__?: SupabaseClient<Database>
    __ONEBOX_SUPABASE_ADMIN__?: SupabaseClient<Database> | null
    __ONEBOX_CLIENT_INIT__?: boolean
    __ONEBOX_READ_CLIENT_INIT__?: boolean
  }
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
// Optional Supabase read-replica routing URL (Supabase load-balanced endpoint,
// e.g. `https://<ref>-all.supabase.co`). When set, the `supabaseRead` client
// routes SELECTs to it. PostgREST inside the load balancer sends writes to the
// primary and reads to replicas, so writes accidentally issued via this client
// still succeed — but by convention we keep mutations on `supabase`.
const supabaseReadUrl =
  (import.meta.env.VITE_SUPABASE_READ_URL as string | undefined) || supabaseUrl

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
  if (typeof window !== 'undefined' && window.__ONEBOX_SUPABASE_CLIENT__) {
    return window.__ONEBOX_SUPABASE_CLIENT__
  }

  // Create new client only if it doesn't exist
  const client = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      storageKey: 'onebox-auth-token',
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
        'x-application-name': 'onebox-ai',
        'x-client-info': 'onebox-web@1.4.3',
      },
    },
    db: {
      schema: 'public',
    },
  })

  // Store in window for HMR resistance and singleton enforcement
  if (typeof window !== 'undefined') {
    window.__ONEBOX_SUPABASE_CLIENT__ = client

    if (!window.__ONEBOX_CLIENT_INIT__) {
      logger.log('✅ Supabase client initialized (singleton pattern)')
      window.__ONEBOX_CLIENT_INIT__ = true
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
  if (typeof window !== 'undefined' && '__ONEBOX_SUPABASE_ADMIN__' in window) {
    return window.__ONEBOX_SUPABASE_ADMIN__ || null
  }

  // CRITICAL: Do NOT create admin client in browser to avoid multiple GoTrueClient instances
  // Admin operations should be handled via backend API endpoints
  if (import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY) {
    // Log warning only once per session to avoid console spam
    const warnKey = '__ONEBOX_SERVICE_KEY_WARNED__'
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
    window.__ONEBOX_SUPABASE_ADMIN__ = null
  }

  return null
}

/**
 * Get or create the singleton READ client instance, pointed at the Supabase
 * load-balanced URL so SELECTs distribute across primary + read replicas.
 *
 * Implementation notes:
 *  - We deliberately disable this client's own auth machinery (`persistSession`,
 *    `autoRefreshToken`, distinct `storageKey`) so it doesn't double-init
 *    GoTrueClient. The primary `supabase` client remains the single source of
 *    truth for auth state.
 *  - On every request we inject the *primary* client's current access token
 *    via a custom `fetch` so RLS policies evaluate `auth.uid()` correctly on
 *    the replica.
 *  - If `VITE_SUPABASE_READ_URL` is unset (or equal to the primary URL), this
 *    function returns the primary client itself — call sites stay identical
 *    and dev environments without a replica keep working.
 *  - Realtime is intentionally not used here; the primary client owns Realtime.
 */
function getSupabaseReadClient(): SupabaseClient<Database> {
  // Transparent fallback when no read URL is configured (dev, or env not yet set)
  if (!supabaseReadUrl || supabaseReadUrl === supabaseUrl) {
    return getSupabaseClient()
  }

  if (typeof window !== 'undefined' && window.__ONEBOX_SUPABASE_READ_CLIENT__) {
    return window.__ONEBOX_SUPABASE_READ_CLIENT__
  }

  const primary = getSupabaseClient()

  const readClient = createClient<Database>(supabaseReadUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      // Distinct storage key prevents the "Multiple GoTrueClient instances detected"
      // warning from supabase-js — the read client never writes here but the key
      // still has to differ from the primary.
      storageKey: 'onebox-auth-token-read',
    },
    global: {
      headers: {
        'x-application-name': 'onebox-ai-read',
        'x-client-info': 'onebox-web-read@1.4.3',
      },
      // Forward the primary client's current JWT on every request so RLS
      // policies (which call auth.uid()) work the same way on the replica.
      fetch: async (input, init) => {
        const session = await primary.auth.getSession()
        const token = session.data.session?.access_token ?? supabaseAnonKey
        const headers = new Headers(init?.headers)
        headers.set('Authorization', `Bearer ${token}`)
        headers.set('apikey', supabaseAnonKey)
        return fetch(input, { ...init, headers })
      },
    },
    db: { schema: 'public' },
  })

  if (typeof window !== 'undefined') {
    window.__ONEBOX_SUPABASE_READ_CLIENT__ = readClient
    if (!window.__ONEBOX_READ_CLIENT_INIT__) {
      logger.log(
        `✅ Supabase READ client initialized (singleton) → ${supabaseReadUrl}`
      )
      window.__ONEBOX_READ_CLIENT_INIT__ = true
    }
  }

  return readClient
}

// Export singleton instances
export const supabase = getSupabaseClient()
// Routes read queries to the Supabase load-balanced endpoint (primary + replicas).
// Falls back to `supabase` when VITE_SUPABASE_READ_URL is not set.
// Use for: heavy SELECTs, statistics, list/grid loads, reports.
// Do NOT use for: mutations, RPCs with side effects, or read-your-own-writes
// flows where the user expects to see their just-committed change immediately.
export const supabaseRead = getSupabaseReadClient()
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

// Created and developed by Jai Singh
