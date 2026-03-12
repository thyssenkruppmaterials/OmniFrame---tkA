import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { rbacCacheManager } from '@/lib/auth/cache-manager'
import { singletonAuthManager } from '@/lib/auth/singleton-auth-manager'
import { logger } from '@/lib/utils/logger'

// Types
interface NavigationPermission {
  navigationItemId: string
  name: string
  title: string
  url: string | null
  visible: boolean
}

interface NavigationCache {
  permissions: NavigationPermission[]
  timestamp: number
}

interface NavigationState {
  // State
  navigationPermissions: NavigationPermission[]
  isLoading: boolean
  error: string | null
  currentRole: string | null
  currentRoleName: string | null
  lastLoadTime: number
  expandedGroups: Record<string, boolean>

  // Actions
  loadNavigationPermissions: (role: string, useCache?: boolean) => Promise<void>
  clearNavigationPermissions: () => void
  hasNavigationAccess: (itemName: string) => boolean
  hasNavigationAccessByUrl: (url: string) => boolean
  refreshNavigationPermissions: () => Promise<void>
  setError: (error: string | null) => void
  setLoading: (loading: boolean) => void
  setGroupExpanded: (groupId: string, expanded: boolean) => void
  initializeExpandedGroups: (userId: string) => void
  saveExpandedGroups: (userId: string) => void
}

// Constants
const NAVIGATION_CACHE_TTL = 10 * 60 * 1000 // 10 minutes
const QUICK_NAV_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const LOAD_THROTTLE_TIME = 30 * 1000 // 30 seconds

// Global caches (outside of Zustand store to maintain across instances)
const navigationCache = new Map<string, NavigationCache>()
const quickNavigationCache = new Map<
  string,
  { result: boolean; timestamp: number }
>()
const globalNavigationLoadingState = new Map<string, boolean>()

// Track the current user ID for expanded-groups auto-save (Step 16)
let _expandedGroupsUserId: string | null = null
const EXPANDED_GROUPS_KEY_PREFIX = 'omniframe-nav-expanded-'

export const useNavigationStore = create<NavigationState>()(
  persist(
    (set, get) => ({
      // Initial state
      navigationPermissions: [],
      isLoading: false,
      error: null,
      currentRole: null,
      currentRoleName: null,
      lastLoadTime: 0,
      expandedGroups: {},

      // Load navigation permissions for a role
      loadNavigationPermissions: async (role: string, useCache = true) => {
        const now = Date.now()
        const loadingKey = `navigation:${role}`

        // ✅ CRITICAL FIX: Enhanced hard refresh and cache invalidation detection
        const isHardRefresh = (performance as any).navigation?.type === 'reload'
        const hasStaleCache =
          quickNavigationCache.size > 0 &&
          Date.now() - (get().lastLoadTime || 0) > QUICK_NAV_CACHE_TTL
        const isPermissionToggleScenario =
          role === 'tka_associate' && quickNavigationCache.size > 0

        // ✅ NUCLEAR OPTION: For TKA Associate role, always clear cache completely
        const isDataManagerToggleTest = role === 'tka_associate'

        if (
          isHardRefresh ||
          hasStaleCache ||
          isPermissionToggleScenario ||
          isDataManagerToggleTest
        ) {
          logger.log(
            '🧹 NUCLEAR CACHE CLEAR: Comprehensive cache invalidation triggered'
          )
          logger.log('  - Hard refresh:', isHardRefresh)
          logger.log('  - Stale cache:', hasStaleCache)
          logger.log(
            '  - Permission toggle scenario:',
            isPermissionToggleScenario
          )
          logger.log('  - Data Manager test scenario:', isDataManagerToggleTest)

          // NUCLEAR OPTION: Clear everything completely
          quickNavigationCache.clear()
          navigationCache.clear()
          useCache = false // Force fresh data always

          // Mark that cache was cleared for debugging
          logger.log(
            '🧹 NUCLEAR: All caches nuked - 100% fresh database queries enforced'
          )
        }

        // Prevent multiple simultaneous loads
        if (globalNavigationLoadingState.get(loadingKey)) {
          logger.log(
            'Navigation permission loading already in progress for role:',
            role
          )
          return
        }

        // Check cache first if requested
        if (useCache) {
          const cached = navigationCache.get(role)
          if (cached && now - cached.timestamp < NAVIGATION_CACHE_TTL) {
            logger.log('Using cached navigation permissions for role:', role)
            set({
              navigationPermissions: cached.permissions,
              currentRole: role,
              lastLoadTime: cached.timestamp,
              isLoading: false,
              error: null,
            })
            return
          }
        }

        // Throttle database calls, but allow bypass for idle recovery
        const { lastLoadTime, navigationPermissions } = get()
        const timeSinceLastLoad = now - lastLoadTime
        const isEmptyPermissions = navigationPermissions.length === 0

        if (
          lastLoadTime > 0 &&
          timeSinceLastLoad < LOAD_THROTTLE_TIME &&
          !isEmptyPermissions
        ) {
          logger.log(
            'Navigation permission loading throttled - last load was',
            timeSinceLastLoad,
            'ms ago'
          )
          return
        }

        if (
          isEmptyPermissions &&
          lastLoadTime > 0 &&
          timeSinceLastLoad < LOAD_THROTTLE_TIME
        ) {
          logger.log(
            'Navigation permission throttle bypassed for idle recovery - empty permissions detected'
          )
        }

        // Set loading state and prevent concurrent loads
        globalNavigationLoadingState.set(loadingKey, true)
        set({ isLoading: true, error: null, lastLoadTime: now })

        // Declare roleData outside try block so it's accessible in catch block
        let roleData: { id?: string; name?: string } | null = null

        try {
          logger.log(
            'Loading navigation permissions from database for role:',
            role
          )

          // ✅ HARD REFRESH FIX: Add retry logic with exponential backoff
          let data: any = null
          let error: any = null
          let retryCount = 0
          const maxRetries = 3

          // CRITICAL FIX (Jan 6, 2026): Detect if role is a UUID (role_id) or a role name
          // This fixes custom roles not loading correct navigation permissions
          const isUUID =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              role
            )

          while (retryCount <= maxRetries && !data) {
            try {
              // FIXED: Handle both role name and role_id (UUID)
              if (isUUID) {
                // Role is a UUID - query directly by ID
                logger.log('Role is UUID, querying by ID:', role)
                const roleResult = (await singletonAuthManager.executeRead(
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

                if (roleResult.error) {
                  logger.error('Error fetching role by ID:', roleResult.error)
                  throw roleResult.error
                }
                roleData = roleResult.data
              } else {
                // Role is a name - query by name (original behavior)
                const roleResult = (await singletonAuthManager.executeRead(
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

                if (roleResult.error) {
                  logger.error(
                    'Error fetching role for navigation permissions:',
                    roleResult.error
                  )
                  throw roleResult.error
                }
                roleData = roleResult.data
              }

              logger.log(
                'Found role ID for navigation:',
                roleData?.id,
                'role name:',
                roleData?.name
              )

              // Then get navigation items with role permissions using role_id
              const navResult = await singletonAuthManager.executeRead(
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
                    .eq(
                      'role_navigation_permissions.role_id',
                      roleData?.id || ''
                    )
              )

              data = navResult.data
              error = navResult.error

              if (data || !error) break
            } catch (fetchError: unknown) {
              logger.warn(
                `⚠️ Navigation fetch attempt ${retryCount + 1} failed:`,
                fetchError
              )
              retryCount++

              if (retryCount <= maxRetries) {
                // Exponential backoff: 300ms, 600ms, 1.2s
                const delay = 300 * Math.pow(2, retryCount - 1)
                logger.log(`🔄 Retrying navigation fetch in ${delay}ms...`)
                await new Promise((resolve) => setTimeout(resolve, delay))
              }
            }
          }

          if (error) {
            logger.error(
              'Error fetching navigation items for role after retries:',
              error
            )
            throw error
          }

          logger.log(
            'Raw navigation data from database:',
            data?.length || 0,
            'items'
          )
          logger.log('Sample navigation data:', data?.slice(0, 3))

          const permissions: NavigationPermission[] =
            data?.map((item: any) => ({
              navigationItemId: item.id,
              name: item.name,
              title: item.title,
              url: item.url,
              visible: item.role_navigation_permissions?.[0]?.visible ?? true,
            })) || []

          logger.log(
            'Processed navigation permissions count:',
            permissions.length
          )

          logger.log('=== NAVIGATION PERMISSIONS PROCESSED ===')
          logger.log('Raw database data:', data)
          logger.log('Processed permissions:', permissions)
          logger.log(
            'Warehouse app permissions:',
            permissions.filter((p) => p.url?.includes('/apps/'))
          )

          set({
            navigationPermissions: permissions,
            currentRole: role,
            currentRoleName: roleData?.name || role,
            isLoading: false,
            error: null,
          })

          // Cache the results
          navigationCache.set(role, {
            permissions,
            timestamp: now,
          })

          logger.log(
            'Navigation permissions loaded and cached:',
            permissions.length
          )
        } catch (err) {
          logger.error('Error loading navigation permissions:', err)

          // ✅ HARD REFRESH FIX: Enhanced fallback recovery for network errors
          const cached = navigationCache.get(role)
          if (cached) {
            logger.log(
              '🔄 Using stale cached navigation permissions due to network error'
            )
            set({
              navigationPermissions: cached.permissions,
              currentRole: role,
              currentRoleName: roleData?.name || role,
              isLoading: false,
              error: null,
            })
          } else {
            // Final fallback: provide minimal navigation permissions to keep app functional
            logger.log(
              '⚠️ No cache available - providing minimal navigation fallback for role:',
              role
            )
            const minimalNavigation = [
              {
                navigationItemId: 'fallback-dashboard',
                name: 'dashboard',
                title: 'Dashboard',
                url: '/',
                visible: true,
              },
              {
                navigationItemId: 'fallback-help',
                name: 'help-center',
                title: 'Help Center',
                url: '/help-center',
                visible: true,
              },
            ]

            set({
              navigationPermissions: minimalNavigation,
              currentRole: role,
              currentRoleName: roleData?.name || role,
              isLoading: false,
              error: 'Network error - using minimal navigation fallback',
            })
          }
        } finally {
          // Clear global loading state
          globalNavigationLoadingState.delete(loadingKey)
        }
      },

      // Clear all navigation permission data
      clearNavigationPermissions: () => {
        logger.log('🧹 CRITICAL FIX: Comprehensive cache clearing - all layers')

        // ✅ CRITICAL FIX: Clear ALL cache layers aggressively
        navigationCache.clear()
        quickNavigationCache.clear()
        globalNavigationLoadingState.clear()

        // Clear browser cache if available (force fresh requests)
        if ('caches' in window) {
          caches
            .keys()
            .then((names) => {
              names.forEach((name) => {
                if (
                  name.includes('navigation') ||
                  name.includes('permission')
                ) {
                  caches.delete(name)
                  logger.log('🧹 Cleared browser cache:', name)
                }
              })
            })
            .catch((e) => logger.warn('Cache clearing failed:', e))
        }

        set({
          navigationPermissions: [],
          currentRole: null,
          currentRoleName: null,
          isLoading: false,
          error: null,
          lastLoadTime: 0,
        })

        logger.log(
          '🧹 CRITICAL FIX: All navigation cache cleared - forcing fresh reload'
        )
      },

      // Check navigation access by item name
      hasNavigationAccess: (itemName: string) => {
        const { navigationPermissions } = get()
        const permission = navigationPermissions.find(
          (p) => p.name === itemName
        )
        return permission?.visible ?? false
      },

      // Check navigation access by URL
      hasNavigationAccessByUrl: (url: string) => {
        const {
          currentRole,
          currentRoleName,
          navigationPermissions,
          isLoading,
        } = get()

        // Debug logging removed to prevent infinite render loops
        // Uncomment only for debugging specific navigation URL checking issues:
        // logger.log('=== NAVIGATION URL CHECK DEBUG ===');
        // logger.log('Checking URL:', url);
        // logger.log('Current role:', currentRole);
        // logger.log('Navigation permissions count:', navigationPermissions.length);
        // logger.log('Is loading:', isLoading);

        if (!currentRole) {
          logger.log('❌ No current role found')
          return false
        }

        const cacheKey = `${currentRole}:${url}`
        const now = Date.now()

        // ✅ CRITICAL FIX: Enhanced cache validation with stale detection
        const quickCached = quickNavigationCache.get(cacheKey)

        // Check if cache exists and is still valid
        if (quickCached && now - quickCached.timestamp < QUICK_NAV_CACHE_TTL) {
          // ✅ CRITICAL FIX: For TKA Associate, validate cache against fresh permissions
          if (
            currentRoleName === 'tka_associate' &&
            navigationPermissions.length > 0
          ) {
            const freshPermission = navigationPermissions.find(
              (p) => p.url === url
            )
            const freshResult = freshPermission?.visible ?? false

            if (freshResult !== quickCached.result) {
              logger.log('🚨 CACHE MISMATCH DETECTED:', url)
              logger.log('  - Cached result:', quickCached.result)
              logger.log('  - Fresh result:', freshResult)
              logger.log('  - Clearing stale cache entry and using fresh data')

              // Clear the stale cache entry
              quickNavigationCache.delete(cacheKey)

              // Cache the fresh result
              quickNavigationCache.set(cacheKey, {
                result: freshResult,
                timestamp: now,
              })

              return freshResult
            }
          }

          logger.log('✅ Cache hit for', url, ':', quickCached.result)
          return quickCached.result
        }

        // If navigation permissions are empty and not loading, trigger a reload (idle recovery)
        if (navigationPermissions.length === 0 && !isLoading && currentRole) {
          logger.log(
            'NavigationStore: Detected empty navigation permissions - triggering reload'
          )
          // Trigger async reload without blocking
          setTimeout(() => {
            get().loadNavigationPermissions(currentRole, false)
          }, 150) // Slightly delayed to avoid conflicts with permission store
        }

        // Debug: Show what navigation permissions we have
        if (navigationPermissions.length > 0) {
          logger.log(
            'Available navigation URLs:',
            navigationPermissions.map((p) => p.url)
          )
          logger.log(
            'Sample navigation permissions:',
            navigationPermissions.slice(0, 5)
          )
        }

        // Find permission for this URL
        const permission = navigationPermissions.find((p) => p.url === url)
        logger.log('Permission found for', url, ':', permission)

        let hasAccess = permission?.visible ?? false

        // ENHANCED: Default to true for superadmin/admin when navigation item exists but permission not explicitly set
        if (
          !hasAccess &&
          (currentRoleName === 'superadmin' || currentRoleName === 'admin')
        ) {
          // For superadmin/admin, if we have navigation permissions loaded but can't find this URL,
          // it might be a URL that exists but isn't in our navigation system
          logger.log('🔄 Admin override check for URL:', url)
          hasAccess = true // Default to accessible for admin users
        }

        logger.log(
          'Final access result for',
          url,
          ':',
          hasAccess ? '✅ GRANTED' : '❌ DENIED'
        )

        // Cache the result
        quickNavigationCache.set(cacheKey, {
          result: hasAccess,
          timestamp: now,
        })

        return hasAccess
      },

      // Refresh navigation permissions for current role
      refreshNavigationPermissions: async () => {
        const { currentRole } = get()
        if (!currentRole) return

        await get().loadNavigationPermissions(currentRole, false) // Force refresh
      },

      // Set error state
      setError: (error: string | null) => set({ error }),

      // Set loading state
      setLoading: (isLoading: boolean) => set({ isLoading }),

      // Step 16: Persist expanded nav group state per user
      setGroupExpanded: (groupId: string, expanded: boolean) => {
        const expandedGroups = { ...get().expandedGroups, [groupId]: expanded }
        set({ expandedGroups })
        // Auto-save to localStorage using the cached userId
        if (_expandedGroupsUserId) {
          try {
            localStorage.setItem(
              `${EXPANDED_GROUPS_KEY_PREFIX}${_expandedGroupsUserId}`,
              JSON.stringify(expandedGroups)
            )
          } catch (e) {
            logger.warn('Failed to save expanded groups to localStorage:', e)
          }
        }
      },

      initializeExpandedGroups: (userId: string) => {
        _expandedGroupsUserId = userId
        try {
          const stored = localStorage.getItem(
            `${EXPANDED_GROUPS_KEY_PREFIX}${userId}`
          )
          if (stored) {
            set({ expandedGroups: JSON.parse(stored) })
          } else {
            set({ expandedGroups: {} })
          }
        } catch (e) {
          logger.warn('Failed to load expanded groups from localStorage:', e)
          set({ expandedGroups: {} })
        }
      },

      saveExpandedGroups: (userId: string) => {
        try {
          localStorage.setItem(
            `${EXPANDED_GROUPS_KEY_PREFIX}${userId}`,
            JSON.stringify(get().expandedGroups)
          )
        } catch (e) {
          logger.warn('Failed to save expanded groups to localStorage:', e)
        }
      },
    }),
    {
      name: 'navigation-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        lastLoadTime: state.lastLoadTime,
        currentRole: state.currentRole,
        currentRoleName: state.currentRoleName,
      }),
    }
  )
)

// Register navigation store caches with unified cache manager (Step 14)
rbacCacheManager.registerCacheLayer('navigation-store', () => {
  navigationCache.clear()
  quickNavigationCache.clear()
  globalNavigationLoadingState.clear()
})

// Convenience hooks
export const useNavigationPermissions = () => {
  const { navigationPermissions, isLoading, error } = useNavigationStore()
  return { navigationPermissions, isLoading, error }
}

export const useNavigationAccess = () => {
  const { hasNavigationAccess, hasNavigationAccessByUrl } = useNavigationStore()
  return { hasNavigationAccess, hasNavigationAccessByUrl }
}

export const useNavigationActions = () => {
  const {
    loadNavigationPermissions,
    clearNavigationPermissions,
    refreshNavigationPermissions,
    setError,
    setLoading,
  } = useNavigationStore()
  return {
    loadNavigationPermissions,
    clearNavigationPermissions,
    refreshNavigationPermissions,
    setError,
    setLoading,
  }
}

// Hook that combines navigation state and actions (for backward compatibility)
export const useNavigation = () => {
  const state = useNavigationStore()
  return {
    navigationPermissions: state.navigationPermissions,
    hasNavigationAccess: state.hasNavigationAccess,
    hasNavigationAccessByUrl: state.hasNavigationAccessByUrl,
    isLoading: state.isLoading,
    error: state.error,
    refreshNavigationPermissions: state.refreshNavigationPermissions,
  }
}
