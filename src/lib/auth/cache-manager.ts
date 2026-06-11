// Created and developed by Jai Singh
/**
 * Unified RBAC Cache Manager
 *
 * Provides a single function to invalidate ALL permission and navigation
 * caches across the application. This ensures consistency when roles,
 * permissions, or navigation access changes.
 *
 * Cache layers registered here:
 *   - 'rbac-service'             → authCache (in-memory LRU from auth-cache.ts)
 *   - 'permission-store'         → module-level Maps in permissionStore.ts
 *   - 'navigation-store'         → module-level Maps in navigationStore.ts
 *   - 'unified-auth-permissions' → permission state in unifiedAuthStore.ts
 *   - 'unified-auth-navigation'  → navigation state in unifiedAuthStore.ts
 *
 * @date 2026-02-05
 */
import { logger } from '@/lib/utils/logger'
import { authBroadcast } from './broadcast-channel'

type CacheInvalidationCallback = () => void | Promise<void>

class RBACCacheManager {
  private invalidationCallbacks: Map<string, CacheInvalidationCallback> =
    new Map()

  /**
   * Register a cache layer for invalidation.
   * Each cache layer provides a callback that clears its cache.
   */
  registerCacheLayer(name: string, callback: CacheInvalidationCallback) {
    this.invalidationCallbacks.set(name, callback)
  }

  /**
   * Unregister a cache layer.
   */
  unregisterCacheLayer(name: string) {
    this.invalidationCallbacks.delete(name)
  }

  /**
   * Invalidate ALL registered caches. Call this on:
   * - Role changes
   * - Permission updates
   * - Sign-out
   * - Navigation permission changes
   */
  async invalidateAll(options?: {
    broadcastToTabs?: boolean
    userId?: string
  }) {
    const errors: string[] = []

    for (const [name, callback] of this.invalidationCallbacks) {
      try {
        await callback()
      } catch (error) {
        errors.push(`Cache '${name}' invalidation failed: ${error}`)
        logger.warn(`[CacheManager] Failed to invalidate '${name}':`, error)
      }
    }

    // Broadcast to other tabs if requested
    if (options?.broadcastToTabs && options?.userId) {
      authBroadcast.broadcast({
        type: 'PERMISSIONS_UPDATED',
        userId: options.userId,
      })
    }

    if (errors.length > 0) {
      logger.warn(
        `[CacheManager] ${errors.length} cache(s) failed to invalidate`
      )
    }
  }

  /**
   * Invalidate only permission-related caches.
   */
  async invalidatePermissions() {
    const permissionCaches = [
      'rbac-service',
      'permission-store',
      'unified-auth-permissions',
    ]
    for (const name of permissionCaches) {
      const callback = this.invalidationCallbacks.get(name)
      if (callback) {
        try {
          await callback()
        } catch (error) {
          logger.warn(`[CacheManager] Failed to invalidate '${name}':`, error)
        }
      }
    }
  }

  /**
   * Invalidate only navigation-related caches.
   */
  async invalidateNavigation() {
    const navCaches = ['navigation-store', 'unified-auth-navigation']
    for (const name of navCaches) {
      const callback = this.invalidationCallbacks.get(name)
      if (callback) {
        try {
          await callback()
        } catch (error) {
          logger.warn(`[CacheManager] Failed to invalidate '${name}':`, error)
        }
      }
    }
  }

  /**
   * Get list of registered cache layer names (useful for debugging).
   */
  getRegisteredLayers(): string[] {
    return Array.from(this.invalidationCallbacks.keys())
  }
}

export const rbacCacheManager = new RBACCacheManager()

// Created and developed by Jai Singh
