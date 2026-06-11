// Created and developed by Jai Singh
/**
 * Unified Authentication Store
 * Enterprise-grade authentication state management with Redis caching
 * Replaces supabaseAuthStore, permissionStore, and navigationStore
 * Designed for 100,000+ concurrent users with sub-second performance
 */
import type { User } from '@supabase/supabase-js'
import { create } from 'zustand'
import { persist, subscribeWithSelector } from 'zustand/middleware'
import { rbacCacheManager } from '@/lib/auth/cache-manager'
import { singletonAuthManager } from '@/lib/auth/singleton-auth-manager'
import { distributedCacheService } from '@/lib/cache/redis-cache-service'
import type { UserProfile } from '@/lib/supabase/types'
import { logger } from '@/lib/utils/logger'

// ===== TYPES =====

interface UnifiedAuthState {
  // Core Authentication State
  user: User | null
  session: any | null
  profile: UserProfile | null
  isLoading: boolean
  isAuthenticated: boolean
  isInitializing: boolean

  // Permission State
  permissions: string[]
  userPermissions: any[]
  isPermissionsLoading: boolean
  permissionsError: string | null
  permissionsLastLoadTime: number
  currentUserId: string | null

  // Navigation State
  navigationPermissions: NavigationPermission[]
  isNavigationLoading: boolean
  navigationError: string | null
  navigationLastLoadTime: number
  currentRole: string | null

  // Tab Permission State
  tabPermissions: TabPermission[]
  isTabPermissionsLoading: boolean
  tabPermissionsError: string | null
  tabPermissionsLastLoadTime: number

  // Cache Management
  cacheStats: CacheStats
  lastCacheRefresh: number

  // Session Management
  sessionExpiresAt: number | null
  lastSessionCheck: number

  // Last Visited Path (for post-login restoration)
  lastVisitedPath: string | null

  // Error Handling
  error: AuthError | null

  // Performance Metrics
  metrics: PerformanceMetrics

  // ===== AUTHENTICATION ACTIONS =====
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, metadata?: any) => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  updatePassword: (newPassword: string) => Promise<void>
  refreshSession: () => Promise<void>
  checkSession: () => Promise<void>
  setUser: (user: User | null) => void
  setSession: (session: any) => void
  setProfile: (profile: UserProfile | null) => void
  setLoading: (loading: boolean) => void
  fetchProfile: () => Promise<void>
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>

  // ===== PERMISSION ACTIONS =====
  loadPermissions: (userId: string, useCache?: boolean) => Promise<void>
  refreshPermissions: () => Promise<void>
  clearPermissions: () => void
  hasPermission: (action: string, resource: string) => boolean
  checkPermission: (action: string, resource: string) => Promise<boolean>
  hasAnyPermission: (permissions: string[]) => boolean
  hasAllPermissions: (permissions: string[]) => boolean
  invalidateUserPermissions: (userId: string) => Promise<void>

  // ===== NAVIGATION ACTIONS =====
  loadNavigationPermissions: (role: string, useCache?: boolean) => Promise<void>
  refreshNavigationPermissions: () => Promise<void>
  clearNavigationPermissions: () => void
  hasNavigationAccess: (itemName: string) => boolean
  hasNavigationAccessByUrl: (url: string) => boolean

  // ===== TAB PERMISSION ACTIONS =====
  loadTabPermissions: (
    userId: string,
    pageResource?: string,
    useCache?: boolean
  ) => Promise<void>
  refreshTabPermissions: (pageResource?: string) => Promise<void>
  clearTabPermissions: () => void
  hasTabPermission: (pageResource: string, tabId: string) => boolean
  checkTabPermission: (pageResource: string, tabId: string) => Promise<boolean>
  getAllowedTabs: (pageResource: string) => TabPermission[]

  // ===== CACHE MANAGEMENT ACTIONS =====
  warmCache: () => Promise<void>
  clearCache: () => Promise<void>
  getCacheStats: () => Promise<CacheStats>
  optimizeCache: () => Promise<void>

  // ===== ROUTE TRACKING ACTIONS =====
  setLastVisitedPath: (path: string) => void

  // ===== UTILITY ACTIONS =====
  initialize: () => Promise<void>
  destroy: () => Promise<void>
  healthCheck: () => Promise<HealthCheckResult>
  getMetrics: () => PerformanceMetrics
  setError: (error: AuthError | null) => void
}

interface NavigationPermission {
  navigationItemId: string
  name: string
  title: string
  url: string | null
  visible: boolean
}

interface NavigationItemWithPermission {
  id: string
  name: string
  title: string
  url: string | null
  role_navigation_permissions: {
    visible: boolean | null
    role_id: string
  }[]
}

interface TabPermission {
  tab_definition_id: string
  page_resource: string
  tab_id: string
  tab_label: string
  granted: boolean
  source: 'role' | 'direct'
}

interface CacheStats {
  hits: number
  misses: number
  evictions: number
  totalRequests: number
  averageAccessTime: number
  memoryUsage: number
  entriesCount: number
  hitRate: number
}

interface AuthError {
  message: string
  timestamp: number
  code?: string
  context?: any
}

interface PerformanceMetrics {
  permissionCheckCount: number
  averagePermissionCheckTime: number
  cacheHitRate: number
  authOperationCount: number
  averageAuthOperationTime: number
  errorCount: number
  lastMetricsReset: number
}

interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'critical'
  message: string
  checks: Record<string, unknown>
  timestamp: number
}

// ===== CONSTANTS =====
const PERMISSION_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const NAVIGATION_CACHE_TTL = 10 * 60 * 1000 // 10 minutes
const TAB_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const SESSION_CHECK_INTERVAL = 30 * 1000 // 30 seconds
const CACHE_WARM_INTERVAL = 15 * 60 * 1000 // 15 minutes
const METRICS_RESET_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours

// ===== STORE IMPLEMENTATION =====
export const useUnifiedAuth = create<UnifiedAuthState>()(
  subscribeWithSelector(
    persist(
      (set, get) =>
        ({
          // ===== INITIAL STATE =====
          user: null,
          session: null,
          profile: null,
          isLoading: true,
          isAuthenticated: false,
          isInitializing: true,

          permissions: [],
          userPermissions: [],
          isPermissionsLoading: false,
          permissionsError: null,
          permissionsLastLoadTime: 0,
          currentUserId: null,

          navigationPermissions: [],
          isNavigationLoading: false,
          navigationError: null,
          navigationLastLoadTime: 0,
          currentRole: null,

          tabPermissions: [],
          isTabPermissionsLoading: false,
          tabPermissionsError: null,
          tabPermissionsLastLoadTime: 0,

          cacheStats: {
            hits: 0,
            misses: 0,
            evictions: 0,
            totalRequests: 0,
            averageAccessTime: 0,
            memoryUsage: 0,
            entriesCount: 0,
            hitRate: 0,
          },
          lastCacheRefresh: 0,

          sessionExpiresAt: null,
          lastSessionCheck: 0,
          lastVisitedPath: null,
          error: null,

          metrics: {
            permissionCheckCount: 0,
            averagePermissionCheckTime: 0,
            cacheHitRate: 0,
            authOperationCount: 0,
            averageAuthOperationTime: 0,
            errorCount: 0,
            lastMetricsReset: Date.now(),
          },

          // ===== AUTHENTICATION ACTIONS =====
          signIn: async (email: string, password: string) => {
            set({ isLoading: true, error: null })

            try {
              const { user, error } = await singletonAuthManager.signIn(
                email,
                password
              )

              if (error) throw error

              // Get current session from singleton manager
              const session = singletonAuthManager.getCurrentSession()

              set({
                user: user,
                session: session,
                isAuthenticated: true,
              })

              await get().fetchProfile()

              // Load permissions and navigation data
              // CRITICAL FIX (Jan 6, 2026): Use currentRole from profile (set by fetchProfile)
              // instead of session.user.role which may be incorrect for custom roles
              if (user?.id) {
                const { currentRole } = get() // Get actual role name after fetchProfile
                await Promise.all([
                  get().loadPermissions(user.id),
                  currentRole && get().loadNavigationPermissions(currentRole),
                  get().loadTabPermissions(user.id),
                ])
              }

              // Update metrics
              // get().updateMetrics('auth', Date.now() - startTime)
            } catch (err) {
              const error = {
                message: err instanceof Error ? err.message : 'Sign in failed',
                timestamp: Date.now(),
                context: { email },
              }
              set({ error })
              // get().updateMetrics('error')
              throw err
            } finally {
              set({ isLoading: false })
            }
          },

          signUp: async (email: string, password: string, metadata = {}) => {
            // const startTime = Date.now()
            set({ isLoading: true, error: null })

            try {
              const { getAppUrl } = await import('@/lib/utils/app-url')
              const { data, error } = await singletonAuthManager
                .getSupabaseClient()
                .auth.signUp({
                  email,
                  password,
                  options: {
                    data: metadata,
                    emailRedirectTo: `${getAppUrl()}/auth/callback`,
                  },
                })

              if (error) throw error

              set({
                user: data.user,
                session: data.session,
                isAuthenticated: !!data.session,
              })

              if (data.session) {
                await get().fetchProfile()

                // Load initial permissions
                if (data.user?.id) {
                  await get().loadPermissions(data.user.id)
                }
              }

              // get().updateMetrics('auth', Date.now() - startTime)
            } catch (err) {
              const error = {
                message: err instanceof Error ? err.message : 'Sign up failed',
                timestamp: Date.now(),
                context: { email },
              }
              set({ error })
              // get().updateMetrics('error')
              throw err
            } finally {
              set({ isLoading: false })
            }
          },

          signOut: async () => {
            // const startTime = Date.now()
            set({ isLoading: true })

            try {
              const { currentUserId } = get()

              // Clear session using singleton manager
              await singletonAuthManager.signOut()

              // Clear Redis cache for this user
              if (currentUserId) {
                await distributedCacheService.invalidateUserPermissions(
                  currentUserId
                )
              }

              // Invalidate all registered caches via unified cache manager (Step 14)
              await rbacCacheManager.invalidateAll({
                broadcastToTabs: true,
                userId: currentUserId || undefined,
              })

              // Clear all state
              set({
                user: null,
                session: null,
                profile: null,
                isAuthenticated: false,
                permissions: [],
                userPermissions: [],
                navigationPermissions: [],
                tabPermissions: [],
                currentUserId: null,
                currentRole: null,
                error: null,
                isLoading: false,
              })

              // Clear localStorage
              localStorage.removeItem('unified-auth-store')

              // get().updateMetrics('auth', Date.now() - startTime)
              logger.log(
                '✅ User successfully signed out with unified cache cleanup'
              )
            } catch (error) {
              logger.error('Sign out error:', error)
              // Force clear state even on error
              set({
                user: null,
                session: null,
                profile: null,
                isAuthenticated: false,
                permissions: [],
                userPermissions: [],
                navigationPermissions: [],
                tabPermissions: [],
                currentUserId: null,
                currentRole: null,
                isLoading: false,
              })
              // Also try to invalidate caches on error
              try {
                await rbacCacheManager.invalidateAll()
              } catch {
                /* swallow */
              }
              // get().updateMetrics('error')
            }
          },

          resetPassword: async (email: string) => {
            const { getAppUrl } = await import('@/lib/utils/app-url')
            const { error } = await singletonAuthManager
              .getSupabaseClient()
              .auth.resetPasswordForEmail(email, {
                redirectTo: `${getAppUrl()}/auth/reset-password`,
              })
            if (error) throw error
          },

          updatePassword: async (newPassword: string) => {
            const { error } = await singletonAuthManager
              .getSupabaseClient()
              .auth.updateUser({
                password: newPassword,
              })
            if (error) throw error
          },

          refreshSession: async () => {
            const { data, error } = await singletonAuthManager
              .getSupabaseClient()
              .auth.refreshSession()
            if (!error && data.session) {
              set({ session: data.session })
            }
          },

          checkSession: async () => {
            set({ isLoading: true })
            try {
              const {
                data: { session },
              } = await singletonAuthManager
                .getSupabaseClient()
                .auth.getSession()

              if (session) {
                set({
                  user: session.user,
                  session,
                  isAuthenticated: true,
                })
                await get().fetchProfile()

                // Refresh permissions if needed
                if (session.user?.id) {
                  const { permissionsLastLoadTime } = get()
                  const now = Date.now()
                  if (now - permissionsLastLoadTime > PERMISSION_CACHE_TTL) {
                    await get().loadPermissions(session.user.id)
                  }
                }
              } else {
                set({
                  user: null,
                  session: null,
                  profile: null,
                  isAuthenticated: false,
                  permissions: [],
                  navigationPermissions: [],
                  tabPermissions: [],
                })
              }

              set({ lastSessionCheck: Date.now() })
            } catch (error) {
              logger.error('Session check error:', error)
              set({
                user: null,
                session: null,
                profile: null,
                isAuthenticated: false,
              })
              // get().updateMetrics('error')
            } finally {
              set({ isLoading: false })
            }
          },

          setUser: (user) => set({ user, isAuthenticated: !!user }),
          setSession: (session) => set({ session }),
          setProfile: (profile) => set({ profile }),
          setLoading: (isLoading) => set({ isLoading }),

          fetchProfile: async () => {
            const { user } = get()
            if (!user) return

            try {
              let retryCount = 0
              let profile = null
              let actualRoleName: string | null = null

              while (retryCount < 3) {
                // CRITICAL FIX (Jan 6, 2026): Join with roles table to get actual role name
                // This fixes custom roles like "TKA supervisor" not showing correct navigation
                const { data, error } = await singletonAuthManager.executeRead(
                  async (client) =>
                    await client
                      .from('user_profiles')
                      .select(
                        `
                    *,
                    role_info:roles!user_profiles_role_id_fkey(id, name, display_name)
                  `
                      )
                      .eq('id', user.id)
                      .single()
                )

                if (!error && data) {
                  // Extract role info and remove it from profile object
                  const { role_info, ...profileData } = data as any
                  profile = profileData as UserProfile

                  // Use actual role name from roles table via role_id join
                  actualRoleName = role_info?.name || 'viewer'

                  logger.log('Profile loaded with role:', {
                    actualRoleName,
                    roleId: profile.role_id,
                    roleDisplayName: role_info?.display_name,
                  })
                  break
                } else if (error?.code === 'PGRST116') {
                  await new Promise((resolve) => setTimeout(resolve, 500))
                  retryCount++
                } else {
                  throw error
                }
              }

              if (profile) {
                // CRITICAL: Use actualRoleName (from roles table via role_id) instead of legacy role enum
                // This ensures custom roles get their correct navigation permissions
                set({
                  profile,
                  currentUserId: profile.id,
                  currentRole: actualRoleName,
                })
              } else {
                throw new Error('Profile not found after retries')
              }
            } catch (error) {
              logger.error('Profile fetch error:', error)
              // get().updateMetrics('error')
              throw error
            }
          },

          updateProfile: async (updates) => {
            const { user } = get()
            if (!user) throw new Error('No user logged in')

            const { data, error } = await singletonAuthManager.executeWrite(
              async (client) =>
                await client
                  .from('user_profiles')
                  .update(updates)
                  .eq('id', user.id)
                  .select()
                  .single()
            )

            if (error) throw error
            if (data) {
              set({ profile: data as UserProfile })
            }
          },

          // ===== PERMISSION ACTIONS =====
          loadPermissions: async (userId: string, useCache = true) => {
            // const startTime = Date.now()
            const now = Date.now()

            // Throttling check
            const { permissionsLastLoadTime, isPermissionsLoading } = get()
            if (isPermissionsLoading) return
            if (useCache && now - permissionsLastLoadTime < 30000) return // 30 second throttle

            set({ isPermissionsLoading: true, permissionsError: null })

            try {
              // Try Redis cache first
              let permissions: string[] | null = null
              if (useCache) {
                permissions =
                  await distributedCacheService.getPermissions(userId)
              }

              if (!permissions) {
                // Fallback to database with optimized query
                const { data: result, error } =
                  await singletonAuthManager.executeRead(
                    async (client) =>
                      await (client as any).rpc(
                        'get_user_permissions_optimized',
                        {
                          p_user_id: userId,
                        }
                      )
                  )

                if (error) throw error
                permissions =
                  (Array.isArray(result) ? result : [])?.map(
                    (p: any) => `${p.resource}:${p.action}`
                  ) || []

                // Cache the results in Redis
                await distributedCacheService.setPermissions(
                  userId,
                  permissions || [],
                  PERMISSION_CACHE_TTL / 1000, // Redis expects seconds
                  [`user:${userId}`, 'permissions']
                )
              }

              set({
                permissions: permissions || [],
                currentUserId: userId,
                permissionsLastLoadTime: now,
                isPermissionsLoading: false,
              })

              // Update cache stats
              const cacheStats = await get().getCacheStats()
              set({ cacheStats })

              // get().updateMetrics('permission', Date.now() - startTime)
              logger.log(
                `✅ Loaded ${permissions?.length || 0} permissions for user ${userId}`
              )
            } catch (error) {
              logger.error('Error loading permissions:', error)
              set({
                permissionsError:
                  error instanceof Error
                    ? error.message
                    : 'Failed to load permissions',
                isPermissionsLoading: false,
              })
              // get().updateMetrics('error')
            }
          },

          refreshPermissions: async () => {
            const { currentUserId } = get()
            if (!currentUserId) return
            await get().loadPermissions(currentUserId, false)
          },

          clearPermissions: () => {
            set({
              permissions: [],
              userPermissions: [],
              currentUserId: null,
              permissionsLastLoadTime: 0,
              permissionsError: null,
            })
          },

          hasPermission: (action: string, resource: string) => {
            // const startTime = Date.now()
            const { permissions, currentUserId } = get()

            if (!currentUserId || !permissions.length) {
              // get().updateMetrics('permission', Date.now() - startTime)
              return false
            }

            const permString = `${resource}:${action}`
            const hasAccess =
              permissions.includes(permString) ||
              permissions.includes(`${resource}:*`) ||
              permissions.includes(`*:${action}`) ||
              permissions.includes(`*:*`)

            // get().updateMetrics('permission', Date.now() - startTime)
            return hasAccess
          },

          checkPermission: async (action: string, resource: string) => {
            // const startTime = Date.now()
            const { currentUserId } = get()
            if (!currentUserId) return false

            try {
              // Try fast check first
              const fastResult = get().hasPermission(action, resource)
              if (fastResult) {
                // get().updateMetrics('permission', Date.now() - startTime)
                return true
              }

              // Fallback to database check
              const result = await singletonAuthManager.executeRead(
                async (client) => {
                  const { data, error } = await (client as any).rpc(
                    'check_user_permission_fast',
                    {
                      p_user_id: currentUserId,
                      p_resource: resource,
                      p_action: action,
                    }
                  )
                  if (error) throw error
                  return data
                }
              )

              // get().updateMetrics('permission', Date.now() - startTime)
              return result || false
            } catch (error) {
              logger.error('Error checking permission:', error)
              // get().updateMetrics('error')
              return false
            }
          },

          hasAnyPermission: (permissions: string[]) => {
            return permissions.some((perm) => {
              const [resource, action] = perm.split(':')
              return get().hasPermission(action, resource)
            })
          },

          hasAllPermissions: (permissions: string[]) => {
            return permissions.every((perm) => {
              const [resource, action] = perm.split(':')
              return get().hasPermission(action, resource)
            })
          },

          invalidateUserPermissions: async (userId: string) => {
            await distributedCacheService.invalidateUserPermissions(userId)
            if (get().currentUserId === userId) {
              await get().loadPermissions(userId, false)
            }
          },

          // ===== NAVIGATION ACTIONS =====
          loadNavigationPermissions: async (role: string, useCache = true) => {
            const now = Date.now()
            const {
              navigationLastLoadTime,
              isNavigationLoading,
              currentUserId,
            } = get()

            if (isNavigationLoading) return
            if (useCache && now - navigationLastLoadTime < NAVIGATION_CACHE_TTL)
              return

            set({ isNavigationLoading: true, navigationError: null })

            try {
              // CRITICAL FIX (Jan 6, 2026): Handle both role name and role_id (UUID)
              // This fixes custom roles not loading correct navigation permissions
              const isUUID =
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                  role
                )
              let roleId = role
              let roleName = role

              // If role is a name, look up the role_id first
              if (!isUUID) {
                const { data: roleData, error: roleError } =
                  (await singletonAuthManager.executeRead(
                    async (client) =>
                      await client
                        .from('roles')
                        .select('id, name')
                        .eq('name', role)
                        .single()
                  )) as {
                    data: { id?: string; name?: string } | null
                    error: any
                  }

                if (roleError || !roleData?.id) {
                  logger.error('Error looking up role by name:', roleError)
                  throw roleError || new Error(`Role not found: ${role}`)
                }
                roleId = roleData.id
                roleName = roleData.name || role
                logger.log('Resolved role name to ID:', { roleName, roleId })
              } else {
                // If role is a UUID, look up the role name for display
                const { data: roleData } =
                  (await singletonAuthManager.executeRead(
                    async (client) =>
                      await client
                        .from('roles')
                        .select('id, name')
                        .eq('id', role)
                        .single()
                  )) as {
                    data: { id?: string; name?: string } | null
                    error: any
                  }

                if (roleData?.name) {
                  roleName = roleData.name
                }
              }

              // Try Redis cache first
              let permissions: any[] | null = null
              if (useCache && currentUserId) {
                permissions =
                  await distributedCacheService.getNavigationPermissions(
                    currentUserId,
                    roleId
                  )
              }

              if (!permissions) {
                // Fallback to database - use roleId (UUID) for query
                const { data, error } = await singletonAuthManager.executeRead(
                  async (client) =>
                    await client
                      .from('navigation_items')
                      .select(
                        `
                    id,
                    name,
                    title,
                    url,
                    role_navigation_permissions!inner(
                      visible,
                      role_id
                    )
                  `
                      )
                      .eq('role_navigation_permissions.role_id', roleId)
                )

                if (error) throw error

                permissions =
                  data?.map((item: NavigationItemWithPermission) => ({
                    navigationItemId: item.id,
                    name: item.name,
                    title: item.title,
                    url: item.url,
                    visible:
                      item.role_navigation_permissions?.[0]?.visible ?? true,
                  })) || []

                // Cache in Redis
                if (currentUserId) {
                  await distributedCacheService.setNavigationPermissions(
                    currentUserId,
                    roleId,
                    permissions || [],
                    NAVIGATION_CACHE_TTL / 1000
                  )
                }
              }

              set({
                navigationPermissions: permissions || [],
                currentRole: roleName, // Store the actual role name
                navigationLastLoadTime: now,
                isNavigationLoading: false,
              })

              logger.log(
                `✅ Loaded ${permissions?.length || 0} navigation permissions for role ${roleName} (id: ${roleId})`
              )
            } catch (error) {
              logger.error('Error loading navigation permissions:', error)
              set({
                navigationError:
                  error instanceof Error
                    ? error.message
                    : 'Failed to load navigation permissions',
                isNavigationLoading: false,
              })
              // get().updateMetrics('error')
            }
          },

          refreshNavigationPermissions: async () => {
            const { currentRole } = get()
            if (!currentRole) return
            await get().loadNavigationPermissions(currentRole, false)
          },

          clearNavigationPermissions: () => {
            set({
              navigationPermissions: [],
              currentRole: null,
              navigationLastLoadTime: 0,
              navigationError: null,
            })
          },

          hasNavigationAccess: (itemName: string) => {
            const { navigationPermissions } = get()
            const permission = navigationPermissions.find(
              (p) => p.name === itemName
            )
            return permission?.visible ?? false
          },

          hasNavigationAccessByUrl: (url: string) => {
            const { navigationPermissions } = get()
            const permission = navigationPermissions.find((p) => p.url === url)
            return permission?.visible ?? false
          },

          // ===== TAB PERMISSION ACTIONS =====
          loadTabPermissions: async (
            userId: string,
            pageResource?: string,
            useCache = true
          ) => {
            const now = Date.now()
            const { tabPermissionsLastLoadTime, isTabPermissionsLoading } =
              get()

            if (isTabPermissionsLoading) return
            if (useCache && now - tabPermissionsLastLoadTime < TAB_CACHE_TTL)
              return

            set({ isTabPermissionsLoading: true, tabPermissionsError: null })

            try {
              // Try Redis cache first
              let permissions: any[] | null = null
              if (useCache) {
                permissions = await distributedCacheService.getTabPermissions(
                  userId,
                  pageResource
                )
              }

              if (!permissions) {
                // Fallback to optimized database function
                const { data: result, error } =
                  await singletonAuthManager.executeRead(
                    async (client) =>
                      await (client as any).rpc(
                        'get_user_tab_permissions_optimized',
                        {
                          p_user_id: userId,
                          p_page_resource: pageResource || null,
                        }
                      )
                  )

                if (error) throw error
                permissions = (Array.isArray(result) ? result : []) || []

                // Cache in Redis
                await distributedCacheService.setTabPermissions(
                  userId,
                  pageResource || 'all',
                  permissions || [],
                  TAB_CACHE_TTL / 1000
                )
              }

              set({
                tabPermissions: permissions || [],
                tabPermissionsLastLoadTime: now,
                isTabPermissionsLoading: false,
              })

              logger.log(
                `✅ Loaded ${permissions?.length || 0} tab permissions for user ${userId}`
              )
            } catch (error) {
              logger.error('Error loading tab permissions:', error)
              set({
                tabPermissionsError:
                  error instanceof Error
                    ? error.message
                    : 'Failed to load tab permissions',
                isTabPermissionsLoading: false,
              })
              // get().updateMetrics('error')
            }
          },

          refreshTabPermissions: async (pageResource?: string) => {
            const { currentUserId } = get()
            if (!currentUserId) return
            await get().loadTabPermissions(currentUserId, pageResource, false)
          },

          clearTabPermissions: () => {
            set({
              tabPermissions: [],
              tabPermissionsLastLoadTime: 0,
              tabPermissionsError: null,
            })
          },

          hasTabPermission: (pageResource: string, tabId: string) => {
            const { tabPermissions } = get()
            return tabPermissions.some(
              (tp) =>
                tp.page_resource === pageResource &&
                tp.tab_id === tabId &&
                tp.granted
            )
          },

          checkTabPermission: async (pageResource: string, tabId: string) => {
            const { currentUserId } = get()
            if (!currentUserId) return false

            try {
              const result = await singletonAuthManager.executeRead(
                async (client) => {
                  const { data, error } = await (client as any).rpc(
                    'check_user_tab_permission_fast',
                    {
                      p_user_id: currentUserId,
                      p_page_resource: pageResource,
                      p_tab_id: tabId,
                    }
                  )
                  if (error) throw error
                  return data
                }
              )

              return result || false
            } catch (error) {
              logger.error('Error checking tab permission:', error)
              return false
            }
          },

          getAllowedTabs: (pageResource: string) => {
            const { tabPermissions } = get()
            return tabPermissions
              .filter((tp) => tp.page_resource === pageResource && tp.granted)
              .sort((a, b) => a.tab_label.localeCompare(b.tab_label))
          },

          // ===== CACHE MANAGEMENT ACTIONS =====
          warmCache: async () => {
            const { currentUserId, currentRole } = get()
            if (!currentUserId) return

            try {
              await Promise.all(
                [
                  get().loadPermissions(currentUserId, false),
                  currentRole &&
                    get().loadNavigationPermissions(currentRole, false),
                  // 🔧 PERFORMANCE FIX: Removed bulk tab permission loading from cache warming
                  // Tab permissions will be loaded on-demand when specific pages are accessed
                ].filter(Boolean)
              )
              logger.log(
                '✅ Cache warmed successfully (permissions + navigation only)'
              )
            } catch (error) {
              logger.error('Cache warming error:', error)
            }
          },

          clearCache: async () => {
            const { currentUserId } = get()
            if (currentUserId) {
              await distributedCacheService.invalidateUserPermissions(
                currentUserId
              )
            }
            get().clearPermissions()
            get().clearNavigationPermissions()
            get().clearTabPermissions()
            set({ lastCacheRefresh: Date.now() })
          },

          getCacheStats: async () => {
            try {
              return await distributedCacheService.getStats()
            } catch (error) {
              logger.error('Error getting cache stats:', error)
              return get().cacheStats
            }
          },

          optimizeCache: async () => {
            // Implement cache optimization logic
            const { currentUserId } = get()
            if (currentUserId) {
              await get().warmCache()
            }
          },

          // ===== ROUTE TRACKING ACTIONS =====
          setLastVisitedPath: (path: string) => {
            // Only store non-auth paths to avoid restoring to login/error pages
            const authPaths = [
              '/sign-in',
              '/sign-up',
              '/forgot-password',
              '/500',
              '/403',
            ]
            if (!authPaths.some((p) => path.startsWith(p))) {
              set({ lastVisitedPath: path })
            }
          },

          // ===== UTILITY ACTIONS =====
          initialize: async () => {
            set({ isInitializing: true })

            try {
              // Initialize Redis cache service
              await distributedCacheService.initialize()

              // Initialize database connection pool (now using SingletonAuthManager)
              // Database connection pool initialization handled by SingletonAuthManager
              logger.log(
                '🔗 UnifiedAuthStore connected to SingletonAuthManager'
              )

              // Check current session
              await get().checkSession()

              // Start periodic session checks
              setInterval(() => {
                get().checkSession()
              }, SESSION_CHECK_INTERVAL)

              // Start cache warming
              setInterval(() => {
                get().warmCache()
              }, CACHE_WARM_INTERVAL)

              // Start metrics reset
              setInterval(() => {
                set({
                  metrics: {
                    ...get().metrics,
                    permissionCheckCount: 0,
                    averagePermissionCheckTime: 0,
                    authOperationCount: 0,
                    averageAuthOperationTime: 0,
                    errorCount: 0,
                    lastMetricsReset: Date.now(),
                  },
                })
              }, METRICS_RESET_INTERVAL)

              logger.log('✅ Unified auth store initialized successfully')
            } catch (error) {
              logger.error('Failed to initialize unified auth store:', error)
              set({
                error: {
                  message: 'Initialization failed',
                  timestamp: Date.now(),
                  context: { error },
                },
              })
            } finally {
              set({ isInitializing: false })
            }
          },

          destroy: async () => {
            await distributedCacheService.shutdown()
            // Database connection pool shutdown handled by SingletonAuthManager
          },

          healthCheck: async () => {
            const checks: Record<string, unknown> = {}
            let overallStatus: 'healthy' | 'degraded' | 'critical' = 'healthy'

            try {
              // Check Redis cache
              const cacheHealth = await distributedCacheService.healthCheck()
              checks.cache = cacheHealth
              if (cacheHealth.status !== 'healthy') overallStatus = 'degraded'

              // Check database pool
              const dbHealth = await singletonAuthManager.getHealthStatus()
              checks.database = dbHealth
              if (dbHealth.status === 'critical') overallStatus = 'critical'

              // Check auth state
              const { isAuthenticated, user, error } = get()
              checks.auth = {
                isAuthenticated,
                hasUser: !!user,
                hasError: !!error,
                status: error ? 'degraded' : 'healthy',
              }

              return {
                status: overallStatus,
                message: `Unified auth store is ${overallStatus}`,
                checks,
                timestamp: Date.now(),
              }
            } catch (error) {
              return {
                status: 'critical',
                message: 'Health check failed',
                checks: {
                  error:
                    error instanceof Error ? error.message : 'Unknown error',
                },
                timestamp: Date.now(),
              }
            }
          },

          getMetrics: () => get().metrics,

          setError: (error) => set({ error }),

          // Helper method to update metrics
          updateMetrics: (
            type: 'auth' | 'permission' | 'error',
            duration?: number
          ) => {
            const { metrics } = get()

            if (type === 'auth') {
              set({
                metrics: {
                  ...metrics,
                  authOperationCount: metrics.authOperationCount + 1,
                  averageAuthOperationTime: duration
                    ? (metrics.averageAuthOperationTime + duration) / 2
                    : metrics.averageAuthOperationTime,
                },
              })
            } else if (type === 'permission') {
              set({
                metrics: {
                  ...metrics,
                  permissionCheckCount: metrics.permissionCheckCount + 1,
                  averagePermissionCheckTime: duration
                    ? (metrics.averagePermissionCheckTime + duration) / 2
                    : metrics.averagePermissionCheckTime,
                },
              })
            } else if (type === 'error') {
              set({
                metrics: {
                  ...metrics,
                  errorCount: metrics.errorCount + 1,
                },
              })
            }
          },
        }) as UnifiedAuthState,
      {
        name: 'unified-auth-store',
        partialize: (state) => ({
          // Only persist non-sensitive state
          sessionExpiresAt: state.sessionExpiresAt,
          lastSessionCheck: state.lastSessionCheck,
          currentUserId: state.currentUserId,
          currentRole: state.currentRole,
          lastVisitedPath: state.lastVisitedPath,
          // Don't persist sensitive data like tokens or permissions
        }),
      }
    )
  )
)

// ===== CONVENIENCE HOOKS =====

export const useAuth = () => {
  const {
    user,
    profile,
    isAuthenticated,
    isLoading,
    signIn,
    signUp,
    signOut,
    error,
    checkSession,
  } = useUnifiedAuth()

  return {
    user,
    profile,
    isAuthenticated,
    isLoading,
    signIn,
    signUp,
    signOut,
    error,
    checkSession,
  }
}

export const usePermissions = () => {
  const {
    permissions,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    checkPermission,
    isPermissionsLoading,
    permissionsError,
    refreshPermissions,
  } = useUnifiedAuth()

  return {
    permissions,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    checkPermission,
    isLoading: isPermissionsLoading,
    error: permissionsError,
    refresh: refreshPermissions,
  }
}

export const useNavigation = () => {
  const {
    navigationPermissions,
    hasNavigationAccess,
    hasNavigationAccessByUrl,
    isNavigationLoading,
    navigationError,
    refreshNavigationPermissions,
  } = useUnifiedAuth()

  return {
    navigationPermissions,
    hasNavigationAccess,
    hasNavigationAccessByUrl,
    isLoading: isNavigationLoading,
    error: navigationError,
    refresh: refreshNavigationPermissions,
  }
}

export const useTabPermissions = () => {
  const {
    tabPermissions,
    hasTabPermission,
    checkTabPermission,
    getAllowedTabs,
    isTabPermissionsLoading,
    tabPermissionsError,
    refreshTabPermissions,
  } = useUnifiedAuth()

  return {
    tabPermissions,
    hasTabPermission,
    checkTabPermission,
    getAllowedTabs,
    isLoading: isTabPermissionsLoading,
    error: tabPermissionsError,
    refresh: refreshTabPermissions,
  }
}

// Register unified auth store caches with unified cache manager (Step 14)
rbacCacheManager.registerCacheLayer('unified-auth-permissions', () => {
  useUnifiedAuth.getState().clearPermissions()
})
rbacCacheManager.registerCacheLayer('unified-auth-navigation', () => {
  useUnifiedAuth.getState().clearNavigationPermissions()
})

// Export the store instance for direct access if needed
export default useUnifiedAuth

// Created and developed by Jai Singh
