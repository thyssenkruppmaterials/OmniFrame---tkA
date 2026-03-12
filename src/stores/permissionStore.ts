import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { rbacCacheManager } from '@/lib/auth/cache-manager'
import { singletonAuthManager } from '@/lib/auth/singleton-auth-manager'
import type { UserPermission } from '@/lib/auth/types'
import { logger } from '@/lib/utils/logger'

// Types
interface PermissionCache {
  permissions: string[]
  userPermissions: UserPermission[]
  timestamp: number
}

interface TabPermissionCache {
  tabPermissions: TabPermission[]
  timestamp: number
}

interface TabPermission {
  id: string
  tab_definition_id: string
  page_resource: string
  tab_id: string
  tab_label: string
  description: string | null
  display_order: number | null
  granted: boolean
  source: 'role' | 'direct'
}

interface QuickPermissionCache {
  result: boolean
  timestamp: number
}

interface PermissionState {
  // State
  permissions: string[]
  userPermissions: UserPermission[]
  tabPermissions: TabPermission[]
  isLoading: boolean
  isTabLoading: boolean
  error: string | null
  currentUserId: string | null
  lastLoadTime: number
  lastTabLoadTime: number

  // Actions
  loadPermissions: (userId: string, useCache?: boolean) => Promise<void>
  loadTabPermissions: (
    userId: string,
    pageResource?: string,
    useCache?: boolean
  ) => Promise<void>
  clearPermissions: () => void
  clearTabPermissions: () => void
  hasPermission: (action: string, resource: string) => boolean
  hasTabPermission: (pageResource: string, tabId: string) => boolean
  checkPermission: (action: string, resource: string) => Promise<boolean>
  checkTabPermission: (pageResource: string, tabId: string) => Promise<boolean>
  refreshPermissions: () => Promise<void>
  refreshTabPermissions: (pageResource?: string) => Promise<void>
  setError: (error: string | null) => void
  setLoading: (loading: boolean) => void
  getAllowedTabs: (pageResource: string) => TabPermission[]
}

// Constants
const PERMISSION_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const TAB_PERMISSION_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const QUICK_CACHE_TTL = 2 * 60 * 1000 // 2 minutes
const LOAD_THROTTLE_TIME = 30 * 1000 // 30 seconds

// Global caches (outside of Zustand store to maintain across instances)
const permissionCache = new Map<string, PermissionCache>()
const tabPermissionCache = new Map<string, TabPermissionCache>()
const quickPermissionCache = new Map<string, QuickPermissionCache>()
const globalLoadingState = new Map<string, boolean>()

export const usePermissionStore = create<PermissionState>()(
  persist(
    (set, get) => ({
      // Initial state
      permissions: [],
      userPermissions: [],
      tabPermissions: [],
      isLoading: false,
      isTabLoading: false,
      error: null,
      currentUserId: null,
      lastLoadTime: 0,
      lastTabLoadTime: 0,

      // Load permissions for a user
      loadPermissions: async (userId: string, useCache = true) => {
        const now = Date.now()
        const loadingKey = `permissions:${userId}`

        // Prevent multiple simultaneous loads
        if (globalLoadingState.get(loadingKey)) {
          logger.log('Permission loading already in progress for user:', userId)
          return
        }

        // Check cache first if requested
        if (useCache) {
          const cached = permissionCache.get(userId)
          if (cached && now - cached.timestamp < PERMISSION_CACHE_TTL) {
            logger.log('Using cached permissions for user:', userId)
            set({
              permissions: cached.permissions,
              userPermissions: cached.userPermissions,
              currentUserId: userId,
              lastLoadTime: cached.timestamp,
              isLoading: false,
              error: null,
            })
            return
          }
        }

        // Throttle database calls - but bypass throttling if permissions are empty (refresh scenario)
        const { lastLoadTime, permissions } = get()
        const timeSinceLastLoad = now - lastLoadTime
        const hasEmptyPermissions = permissions.length === 0

        if (
          lastLoadTime > 0 &&
          timeSinceLastLoad < LOAD_THROTTLE_TIME &&
          !hasEmptyPermissions
        ) {
          logger.log(
            'Permission loading throttled - last load was',
            timeSinceLastLoad,
            'ms ago'
          )
          return
        }

        if (hasEmptyPermissions) {
          logger.log(
            'Permission throttle bypassed for refresh/idle recovery - empty permissions detected'
          )
        }

        // Set loading state and prevent concurrent loads
        globalLoadingState.set(loadingKey, true)
        set({ isLoading: true, error: null, lastLoadTime: now })

        try {
          logger.log('Loading permissions from database for user:', userId)

          // ✅ HARD REFRESH FIX: Add retry logic with exponential backoff
          let userData = null
          let retryCount = 0
          const maxRetries = 3

          while (retryCount <= maxRetries && !userData) {
            try {
              // Use direct database queries (same approach as working route protection)
              // Get user profile role_id
              const userProfileResult = (await singletonAuthManager.executeRead(
                async (client) =>
                  await client
                    .from('user_profiles')
                    .select('role_id')
                    .eq('id', userId)
                    .single()
              )) as { data: { role_id?: string } | null; error: any }

              if (userProfileResult.error || !userProfileResult.data?.role_id) {
                throw new Error(
                  `User profile not found: ${userProfileResult.error?.message || 'Unknown error'}`
                )
              }

              // Get role permissions using role_id (same as route protection)
              const rolePermsResult = await singletonAuthManager.executeRead(
                async (client) =>
                  await client
                    .from('role_permissions')
                    .select(
                      `
                    permission:permissions(resource, action)
                  `
                    )
                    .eq('role_id', userProfileResult.data?.role_id || '')
              )

              if (!rolePermsResult.error && rolePermsResult.data) {
                // Convert to expected format for compatibility
                userData = {
                  role_permissions: rolePermsResult.data.map((rp: any) => ({
                    permission: rp.permission,
                  })),
                  user_permissions: [], // Simplified for now
                }
                break
              }
            } catch (fetchError: unknown) {
              logger.warn(
                `⚠️ Permission fetch attempt ${retryCount + 1} failed:`,
                fetchError
              )
              retryCount++

              if (retryCount <= maxRetries) {
                // Exponential backoff: 500ms, 1s, 2s
                const delay = 500 * Math.pow(2, retryCount - 1)
                logger.log(`🔄 Retrying permission fetch in ${delay}ms...`)
                await new Promise((resolve) => setTimeout(resolve, delay))
              }
            }
          }

          if (userData) {
            const rolePerms =
              userData.role_permissions
                ?.map((rp: any) => rp.permission)
                .filter(Boolean) || []

            const userPerms = userData.user_permissions || []

            // Convert permission objects to string format for compatibility with auth provider
            const permissionStrings = rolePerms.map((perm: any) =>
              typeof perm === 'string'
                ? perm
                : `${perm.resource}:${perm.action}`
            )

            // Update state and force React re-renders
            set({
              permissions: permissionStrings as string[],
              userPermissions: [], // Simplified for now
              currentUserId: userId,
              isLoading: false,
              error: null,
            })

            // Force React components to re-render by clearing permission cache
            quickPermissionCache.clear()

            // Trigger a small delay and additional state update to ensure all components re-render
            setTimeout(() => {
              logger.log(
                '🔄 Forcing permission store refresh to trigger re-renders'
              )
              set((state) => ({
                ...state,
                lastLoadTime: Date.now(), // This change will trigger dependent useMemo recalculations
              }))
            }, 50)

            // Cache the results
            permissionCache.set(userId, {
              permissions: permissionStrings as string[],
              userPermissions: [], // Simplified for now
              timestamp: now,
            })

            logger.log('Permissions loaded and cached:', {
              rolePerms: rolePerms.length,
              userPerms: userPerms.length,
            })
          } else {
            // ✅ HARD REFRESH FIX: Enhanced fallback with cache recovery
            logger.log(
              '❌ User profile not found or network error, attempting cache recovery'
            )

            // Try to recover from cache if available
            const cached = permissionCache.get(userId)
            if (cached && now - cached.timestamp < PERMISSION_CACHE_TTL) {
              logger.log(
                '🔄 Recovering permissions from cache during hard refresh'
              )
              set({
                permissions: cached.permissions,
                userPermissions: cached.userPermissions,
                currentUserId: userId,
                isLoading: false,
                error: null,
              })
            } else {
              // SECURITY FIX: Fail-closed — do NOT grant any permissions on network failure.
              // The UI will show a degraded/no-access state, which is the correct security posture.
              logger.log(
                '⚠️ Permission load failed and no cache available — denying all access (fail-closed)'
              )
              set({
                permissions: [],
                userPermissions: [],
                currentUserId: userId,
                isLoading: false,
                error:
                  'Network error during permission loading - access denied until permissions can be loaded',
              })
            }
          }
        } catch (err) {
          logger.error('Error loading permissions:', err)
          const errorMessage =
            err instanceof Error ? err.message : 'Failed to load permissions'

          set({
            error: errorMessage,
            isLoading: false,
          })

          // Use any existing cached data as fallback
          const cached = permissionCache.get(userId)
          if (cached) {
            logger.log('Using stale cached permissions due to error')
            set({
              permissions: cached.permissions,
              userPermissions: cached.userPermissions,
              currentUserId: userId,
            })
          }
        } finally {
          // ✅ CRITICAL FIX: Always clear loading state and global lock
          logger.log('🔓 Permission loading completed for user:', userId)
          globalLoadingState.delete(loadingKey)

          // Ensure loading state is always cleared, even if something went wrong
          set((state) => ({
            ...state,
            isLoading: false,
          }))
        }
      },

      // Clear all permission data
      clearPermissions: () => {
        set({
          permissions: [],
          userPermissions: [],
          tabPermissions: [],
          currentUserId: null,
          isLoading: false,
          isTabLoading: false,
          error: null,
          lastLoadTime: 0,
          lastTabLoadTime: 0,
        })
        permissionCache.clear()
        tabPermissionCache.clear()
        quickPermissionCache.clear()
        globalLoadingState.clear()
      },

      // Clear tab permission data only
      clearTabPermissions: () => {
        set({
          tabPermissions: [],
          lastTabLoadTime: 0,
        })
        tabPermissionCache.clear()
      },

      // Quick permission check (synchronous)
      hasPermission: (action: string, resource: string) => {
        const { currentUserId, permissions, isLoading } = get()
        if (!currentUserId) return false

        const cacheKey = `${currentUserId}:${action}:${resource}:sync`
        const now = Date.now()

        // Check quick cache first
        const quickCached = quickPermissionCache.get(cacheKey)
        if (quickCached && now - quickCached.timestamp < QUICK_CACHE_TTL) {
          return quickCached.result
        }

        // Fail-closed: deny access while permissions are still loading
        if (isLoading) {
          return false
        }

        // If permissions are empty and not loading, trigger a reload (idle recovery)
        // Do NOT grant access while waiting - fail-closed
        if (permissions.length === 0 && !isLoading && currentUserId) {
          logger.log(
            'PermissionStore: Detected empty permissions for authenticated user - triggering reload'
          )
          // Trigger async reload without blocking
          setTimeout(() => {
            get().loadPermissions(currentUserId, false)
          }, 100)
        }

        // ✅ CRITICAL FIX: Enhanced idle recovery for tab permissions
        // 🔧 PERFORMANCE FIX: Only trigger tab reload during specific empty tab detection scenarios
        // Removed automatic bulk tab loading to prevent race conditions
        const { tabPermissions } = get()
        if (
          tabPermissions.length === 0 &&
          permissions.length > 0 &&
          !isLoading &&
          currentUserId
        ) {
          logger.log(
            'PermissionStore: Detected empty tab permissions but regular permissions exist - triggering tab reload'
          )
          // Note: Tab permissions will be loaded on-demand when specific pages are accessed
        }

        // Check role permissions (string format: "resource:action")
        const hasRolePermission = permissions.some((p) => {
          const [permResource, permAction] = p.split(':')
          return (
            (permAction === action || permAction === '*') &&
            (permResource === resource || permResource === '*')
          )
        })

        if (hasRolePermission) {
          quickPermissionCache.set(cacheKey, { result: true, timestamp: now })
          return true
        }

        // SECURITY FIX: Removed window.__AUTH_STATE__ fallback.
        // Stale/unvalidated auth state from window must never grant access.
        // If permissions are empty, the async reload (lines above) will
        // repopulate them; until then, deny access (fail-closed).

        quickPermissionCache.set(cacheKey, { result: false, timestamp: now })
        return false
      },

      // Async permission check
      checkPermission: async (action: string, resource: string) => {
        const { currentUserId } = get()
        if (!currentUserId) return false

        const cacheKey = `${currentUserId}:${action}:${resource}:async`
        const now = Date.now()

        // Check if we have a recent async check cached
        const quickCached = quickPermissionCache.get(cacheKey)
        if (quickCached && now - quickCached.timestamp < QUICK_CACHE_TTL) {
          return quickCached.result
        }

        try {
          const permission = `${resource}:${action}`
          const result = await singletonAuthManager.checkPermission(
            permission,
            currentUserId
          )
          quickPermissionCache.set(cacheKey, { result, timestamp: now })
          return result
        } catch (err) {
          logger.error('Error checking permission:', err)
          return false
        }
      },

      // Refresh permissions for current user
      refreshPermissions: async () => {
        const { currentUserId } = get()
        if (!currentUserId) return

        await get().loadPermissions(currentUserId, false) // Force refresh
      },

      // Set error state
      setError: (error: string | null) => set({ error }),

      // Set loading state
      setLoading: (isLoading: boolean) => set({ isLoading }),

      // === TAB PERMISSION METHODS ===

      // Load tab permissions for a user
      loadTabPermissions: async (
        userId: string,
        pageResource?: string,
        useCache = true
      ) => {
        const now = Date.now()
        const cacheKey = `tab_permissions:${userId}:${pageResource || 'all'}`
        const loadingKey = `tab_permissions:${userId}:${pageResource || 'all'}`

        // Prevent multiple simultaneous loads for the SAME pageResource
        if (globalLoadingState.get(loadingKey)) {
          logger.log(
            'Tab permission loading already in progress for user:',
            userId,
            'pageResource:',
            pageResource
          )
          return
        }

        // Check cache first if requested
        if (useCache) {
          const cached = tabPermissionCache.get(cacheKey)
          if (cached && now - cached.timestamp < TAB_PERMISSION_CACHE_TTL) {
            logger.log('Using cached tab permissions for user:', userId)
            set({
              tabPermissions: cached.tabPermissions,
              lastTabLoadTime: cached.timestamp,
              error: null,
            })
            return
          }
        }

        // 🔧 ENHANCED THROTTLE: Only throttle if using cache AND within throttle time
        const { lastTabLoadTime } = get()
        const timeSinceLastLoad = now - lastTabLoadTime
        if (
          useCache !== false &&
          lastTabLoadTime > 0 &&
          timeSinceLastLoad < LOAD_THROTTLE_TIME
        ) {
          logger.log(
            'Tab permission loading throttled - last load was',
            timeSinceLastLoad,
            'ms ago'
          )
          return
        } else if (
          lastTabLoadTime > 0 &&
          timeSinceLastLoad < LOAD_THROTTLE_TIME
        ) {
          logger.log(
            '⚠️ FORCE LOADING: Bypassing throttle due to cache bypass - last load was',
            timeSinceLastLoad,
            'ms ago'
          )
        }

        // Set loading state and prevent concurrent loads
        globalLoadingState.set(loadingKey, true)
        set({ lastTabLoadTime: now, isTabLoading: true })

        try {
          logger.log(
            'Loading tab permissions from database for user:',
            userId,
            'pageResource:',
            pageResource
          )

          // 🔧 CRITICAL FIX: Actually load tab permissions from database instead of returning empty array
          // First get the user's role_id from their profile
          const { data: userProfile, error: profileError } =
            (await singletonAuthManager.executeRead(
              async (client) =>
                await client
                  .from('user_profiles')
                  .select('role_id')
                  .eq('id', userId)
                  .single()
            )) as { data: { role_id?: string } | null; error: any }

          if (profileError || !userProfile?.role_id) {
            logger.error(
              'Error fetching user profile for tab permissions:',
              profileError
            )
            // 🔧 ENHANCED ERROR HANDLING: Don't throw, gracefully degrade with empty permissions
            logger.warn(
              '🔄 Graceful degradation: Using empty tab permissions due to profile error'
            )
            set({
              tabPermissions: [],
              isTabLoading: false,
              error: profileError?.message || 'Profile not found',
            })
            return
          }

          logger.log(
            'Loading tab permissions for role_id:',
            userProfile.role_id
          )

          // Use the database function for getting tab permissions - much simpler and more reliable
          const { data: roleTabPermissions, error: tabError } =
            (await singletonAuthManager.executeRead(
              async (client) =>
                await client.rpc('get_user_tab_permissions', {
                  p_user_id: userId,
                  p_page_resource: pageResource || undefined,
                })
            )) as { data: any[] | null; error: any }

          if (tabError) {
            logger.error('Error fetching tab permissions via RPC:', tabError)
            // 🔧 ENHANCED ERROR HANDLING: Graceful degradation instead of throwing
            logger.warn(
              '🔄 Graceful degradation: Using empty tab permissions due to RPC error'
            )
            set({
              tabPermissions: [],
              isTabLoading: false,
              error: tabError?.message || 'RPC call failed',
            })
            return
          }

          // Transform to the expected format
          const tabPermissions = (roleTabPermissions || []).map((tp: any) => ({
            id: tp.tab_definition_id, // Use tab_definition_id as the id
            tab_definition_id: tp.tab_definition_id,
            page_resource: tp.page_resource,
            tab_id: tp.tab_id,
            tab_label: tp.tab_label,
            description: tp.description,
            display_order: tp.display_order,
            granted: tp.granted,
            source: 'role' as const,
          }))

          logger.log(
            'Raw tab permissions from database:',
            roleTabPermissions?.length || 0,
            'items'
          )
          logger.log(
            'Processed tab permissions:',
            tabPermissions.length,
            'items'
          )
          if (tabPermissions.length > 0) {
            logger.log('Sample tab permissions:', tabPermissions.slice(0, 3))
          }

          // Update state
          set({
            tabPermissions,
            isTabLoading: false,
            error: null,
          })

          // Cache the results
          tabPermissionCache.set(cacheKey, {
            tabPermissions,
            timestamp: now,
          })

          logger.log(
            'Tab permissions loaded and cached:',
            tabPermissions.length
          )
        } catch (err) {
          logger.error('Error loading tab permissions:', err)
          const errorMessage =
            err instanceof Error
              ? err.message
              : 'Failed to load tab permissions'

          set({
            error: errorMessage,
            isTabLoading: false,
          })

          // Use any existing cached data as fallback
          const cached = tabPermissionCache.get(cacheKey)
          if (cached) {
            logger.log('Using stale cached tab permissions due to error')
            set({
              tabPermissions: cached.tabPermissions,
            })
          }
        } finally {
          // Clear global loading state
          globalLoadingState.delete(loadingKey)
        }
      },

      // Quick tab permission check (synchronous)
      hasTabPermission: (pageResource: string, tabId: string) => {
        const { currentUserId, tabPermissions, isLoading } = get()
        if (!currentUserId) return false

        const cacheKey = `${currentUserId}:${pageResource}:${tabId}:tab_sync`
        const now = Date.now()

        // Check quick cache first
        const quickCached = quickPermissionCache.get(cacheKey)
        if (quickCached && now - quickCached.timestamp < QUICK_CACHE_TTL) {
          return quickCached.result
        }

        // 🔧 PERFORMANCE FIX: Removed bulk tab permission loading for idle recovery
        // Tab permissions will be loaded on-demand when specific pages are accessed
        if (tabPermissions.length === 0 && !isLoading && currentUserId) {
          logger.log(
            'PermissionStore: Empty tab permissions detected - will load on-demand per page'
          )
          // Note: Individual pages will trigger their own tab permission loading when accessed
        }

        // Check tab permissions
        const hasTabAccess = tabPermissions.some(
          (tp) =>
            tp.page_resource === pageResource &&
            tp.tab_id === tabId &&
            tp.granted
        )

        if (hasTabAccess) {
          quickPermissionCache.set(cacheKey, { result: true, timestamp: now })
          return true
        }

        // Enhanced fallback system - use auth state when stores are empty
        if (tabPermissions.length === 0 && currentUserId) {
          const authStateRaw =
            typeof window !== 'undefined'
              ? (window as unknown as Record<string, unknown>).__AUTH_STATE__
              : null
          const authState = authStateRaw as {
            profile?: { roles?: { name?: string } }
            permissions?: string[]
          } | null
          const tabRoleName =
            authState?.profile?.roles?.name ||
            (typeof authStateRaw === 'function'
              ? (authStateRaw() as { profile?: { roles?: { name?: string } } })
                  ?.profile?.roles?.name
              : null)
          if (
            tabRoleName === 'superadmin' ||
            authState?.permissions?.includes('*:*')
          ) {
            logger.log(
              '🔄 Using auth state fallback for tab',
              pageResource + ':' + tabId
            )
            quickPermissionCache.set(cacheKey, { result: true, timestamp: now })
            return true
          }
        }

        quickPermissionCache.set(cacheKey, { result: false, timestamp: now })
        return false
      },

      // Async tab permission check
      checkTabPermission: async (pageResource: string, tabId: string) => {
        const { currentUserId } = get()
        if (!currentUserId) return false

        const cacheKey = `${currentUserId}:${pageResource}:${tabId}:tab_async`
        const now = Date.now()

        // Check if we have a recent async check cached
        const quickCached = quickPermissionCache.get(cacheKey)
        if (quickCached && now - quickCached.timestamp < QUICK_CACHE_TTL) {
          return quickCached.result
        }

        try {
          const tabPermission = `${pageResource}:${tabId}` // Format: "inventory_apps:overview"
          const result = await singletonAuthManager.checkPermission(
            tabPermission,
            currentUserId
          )
          quickPermissionCache.set(cacheKey, { result, timestamp: now })
          return result
        } catch (err) {
          logger.error('Error checking tab permission:', err)
          return false
        }
      },

      // Refresh tab permissions for current user
      refreshTabPermissions: async (pageResource?: string) => {
        const { currentUserId } = get()
        if (!currentUserId) return

        await get().loadTabPermissions(currentUserId, pageResource, false) // Force refresh
      },

      // Get allowed tabs for a page resource
      getAllowedTabs: (pageResource: string) => {
        const { tabPermissions } = get()
        return tabPermissions
          .filter((tp) => tp.page_resource === pageResource && tp.granted)
          .sort((a, b) => a.tab_label.localeCompare(b.tab_label))
      },
    }),
    {
      name: 'permission-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Only persist non-sensitive cached data
        // Don't persist permissions directly for security
        lastLoadTime: state.lastLoadTime,
        lastTabLoadTime: state.lastTabLoadTime,
        currentUserId: state.currentUserId,
      }),
    }
  )
)

// Register permission store caches with unified cache manager (Step 14)
rbacCacheManager.registerCacheLayer('permission-store', () => {
  permissionCache.clear()
  tabPermissionCache.clear()
  quickPermissionCache.clear()
  globalLoadingState.clear()
})

// Convenience hooks
export const usePermissions = () => {
  const { permissions, userPermissions, isLoading, error } =
    usePermissionStore()
  return { permissions, userPermissions, isLoading, error }
}

export const useTabPermissions = () => {
  const { tabPermissions, isLoading, error } = usePermissionStore()
  return { tabPermissions, isLoading, error }
}

export const useHasPermission = () => {
  const hasPermission = usePermissionStore((state) => state.hasPermission)
  return hasPermission
}

export const useHasTabPermission = () => {
  const hasTabPermission = usePermissionStore((state) => state.hasTabPermission)
  return hasTabPermission
}

export const useCheckPermission = () => {
  const checkPermission = usePermissionStore((state) => state.checkPermission)
  return checkPermission
}

export const useCheckTabPermission = () => {
  const checkTabPermission = usePermissionStore(
    (state) => state.checkTabPermission
  )
  return checkTabPermission
}

export const usePermissionActions = () => {
  const {
    loadPermissions,
    clearPermissions,
    refreshPermissions,
    setError,
    setLoading,
  } = usePermissionStore()
  return {
    loadPermissions,
    clearPermissions,
    refreshPermissions,
    setError,
    setLoading,
  }
}

export const useTabPermissionActions = () => {
  const {
    loadTabPermissions,
    clearTabPermissions,
    refreshTabPermissions,
    getAllowedTabs,
  } = usePermissionStore()
  return {
    loadTabPermissions,
    clearTabPermissions,
    refreshTabPermissions,
    getAllowedTabs,
  }
}

// Hook that combines permission state and actions (for backward compatibility)
export const useRBAC = () => {
  const state = usePermissionStore()
  return {
    permissions: state.permissions,
    userPermissions: state.userPermissions,
    tabPermissions: state.tabPermissions,
    hasPermission: state.hasPermission,
    hasTabPermission: state.hasTabPermission,
    checkPermission: state.checkPermission,
    checkTabPermission: state.checkTabPermission,
    isLoading: state.isLoading,
    error: state.error,
    refreshPermissions: state.refreshPermissions,
    refreshTabPermissions: state.refreshTabPermissions,
    getAllowedTabs: state.getAllowedTabs,
  }
}
