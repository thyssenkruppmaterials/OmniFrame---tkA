// Created and developed by Jai Singh
import { logger } from '@/lib/utils/logger'

/**
 * Comprehensive Cache Management Utility for OmniFrame
 * Handles PWA cache clearing, service worker updates, and browser storage cleanup
 */

export interface CacheClearResult {
  success: boolean
  clearedItems: string[]
  errors: string[]
  recommendations: string[]
}

export class CacheManager {
  private static instance: CacheManager | null = null

  private constructor() {}

  public static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager()
    }
    return CacheManager.instance
  }

  /**
   * Clear all application caches and force refresh
   */
  public async clearAllCaches(): Promise<CacheClearResult> {
    const result: CacheClearResult = {
      success: true,
      clearedItems: [],
      errors: [],
      recommendations: [],
    }

    try {
      // 1. Clear localStorage (excluding auth tokens temporarily)
      const localStorageCleared = await this.clearLocalStorage()
      if (localStorageCleared.length > 0) {
        result.clearedItems.push(
          `localStorage (${localStorageCleared.length} items)`
        )
      }

      // 2. Clear sessionStorage
      const sessionStorageCleared = await this.clearSessionStorage()
      if (sessionStorageCleared.length > 0) {
        result.clearedItems.push(
          `sessionStorage (${sessionStorageCleared.length} items)`
        )
      }

      // 3. Clear IndexedDB databases
      const indexedDBCleared = await this.clearIndexedDB()
      if (indexedDBCleared.length > 0) {
        result.clearedItems.push(
          `IndexedDB (${indexedDBCleared.length} databases)`
        )
      }

      // 4. Clear service worker caches
      const swCacheCleared = await this.clearServiceWorkerCaches()
      if (swCacheCleared) {
        result.clearedItems.push('Service Worker Caches')
      }

      // 5. Unregister and re-register service worker
      const swUpdated = await this.updateServiceWorker()
      if (swUpdated) {
        result.clearedItems.push('Service Worker Updated')
      }

      // 6. Clear browser cache for current site
      const browserCacheCleared = await this.clearBrowserCache()
      if (browserCacheCleared) {
        result.clearedItems.push('Browser Cache')
      }

      // Add recommendations
      result.recommendations = [
        'Hard refresh the page (Ctrl+F5 or Cmd+Shift+R)',
        'Clear browser history and cache if issues persist',
        'Try in an incognito/private window to test',
        'Check for browser updates if problems continue',
      ]
    } catch (error) {
      result.success = false
      result.errors.push(`Cache clearing failed: ${error}`)
      logger.error('Cache clearing error:', error)
    }

    return result
  }

  /**
   * Clear localStorage while preserving essential auth data
   */
  private async clearLocalStorage(): Promise<string[]> {
    const clearedKeys: string[] = []
    const preserveKeys = ['supabase.auth.token', 'auth-session', 'theme']

    try {
      const keys = Object.keys(localStorage)

      for (const key of keys) {
        if (!preserveKeys.some((preserveKey) => key.includes(preserveKey))) {
          localStorage.removeItem(key)
          clearedKeys.push(key)
        }
      }

      logger.log('🧹 Cleared localStorage items:', clearedKeys)
    } catch (error) {
      logger.warn('Failed to clear localStorage:', error)
    }

    return clearedKeys
  }

  /**
   * Clear sessionStorage
   */
  private async clearSessionStorage(): Promise<string[]> {
    const clearedKeys: string[] = []

    try {
      const keys = Object.keys(sessionStorage)

      for (const key of keys) {
        sessionStorage.removeItem(key)
        clearedKeys.push(key)
      }

      logger.log('🧹 Cleared sessionStorage items:', clearedKeys)
    } catch (error) {
      logger.warn('Failed to clear sessionStorage:', error)
    }

    return clearedKeys
  }

  /**
   * Clear IndexedDB databases
   */
  private async clearIndexedDB(): Promise<string[]> {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        resolve([])
        return
      }

      // Get all databases
      if ('databases' in indexedDB) {
        ;(
          indexedDB as unknown as {
            databases: () => Promise<Array<{ name: string }>>
          }
        )
          .databases()
          .then((databases: Array<{ name: string }>) => {
            const clearPromises = databases.map((db) =>
              this.clearDatabase(db.name)
            )
            Promise.all(clearPromises).then((results) => {
              const successfulClears = results.filter(
                (result) => result !== null
              ) as string[]
              logger.log('🧹 Cleared IndexedDB databases:', successfulClears)
              resolve(successfulClears)
            })
          })
          .catch(() => resolve([]))
      } else {
        // Fallback for older browsers
        const knownDBs = ['workbox-cache', 'OneBoxAI', 'OmniFrame', 'cache-api']
        const clearPromises = knownDBs.map((db) => this.clearDatabase(db))
        Promise.all(clearPromises).then((results) => {
          const successfulClears = results.filter(
            (result) => result !== null
          ) as string[]
          logger.log(
            '🧹 Cleared IndexedDB databases (fallback):',
            successfulClears
          )
          resolve(successfulClears)
        })
      }
    })
  }

  /**
   * Clear a specific IndexedDB database
   */
  private async clearDatabase(dbName: string): Promise<string | null> {
    return new Promise((resolve) => {
      const deleteRequest = indexedDB.deleteDatabase(dbName)

      deleteRequest.onsuccess = () => {
        logger.log(`🗑️ Deleted IndexedDB database: ${dbName}`)
        resolve(dbName)
      }

      deleteRequest.onerror = () => {
        logger.warn(`Failed to delete IndexedDB database: ${dbName}`)
        resolve(null)
      }

      deleteRequest.onblocked = () => {
        logger.warn(`IndexedDB delete blocked for: ${dbName}`)
        resolve(null)
      }
    })
  }

  /**
   * Clear service worker caches
   */
  private async clearServiceWorkerCaches(): Promise<boolean> {
    try {
      if ('caches' in window) {
        const cacheNames = await caches.keys()

        await Promise.all(
          cacheNames.map(async (cacheName) => {
            logger.log(`🗑️ Deleting cache: ${cacheName}`)
            return caches.delete(cacheName)
          })
        )

        logger.log('🧹 Cleared all service worker caches')
        return true
      }
    } catch (error) {
      logger.warn('Failed to clear service worker caches:', error)
    }

    return false
  }

  /**
   * Update service worker to latest version
   */
  private async updateServiceWorker(): Promise<boolean> {
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration()

        if (registration) {
          // Unregister current service worker
          await registration.unregister()
          logger.log('🗑️ Unregistered old service worker')

          // Register new service worker
          const newRegistration =
            await navigator.serviceWorker.register('/sw.js')
          logger.log('✅ Registered new service worker:', newRegistration)

          // Force activation
          if (newRegistration.waiting) {
            newRegistration.waiting.postMessage({ type: 'SKIP_WAITING' })
          }

          return true
        }
      }
    } catch (error) {
      logger.warn('Failed to update service worker:', error)
    }

    return false
  }

  /**
   * Clear browser cache for current site
   */
  private async clearBrowserCache(): Promise<boolean> {
    try {
      // Force reload of all resources
      if ('location' in window) {
        // This will force a hard refresh
        window.location.reload()
        return true
      }
    } catch (error) {
      logger.warn('Failed to clear browser cache:', error)
    }

    return false
  }

  /**
   * Get cache status information
   */
  public async getCacheStatus(): Promise<{
    localStorage: number
    sessionStorage: number
    indexedDB: number
    caches: number
    serviceWorker: boolean
  }> {
    const status = {
      localStorage: 0,
      sessionStorage: 0,
      indexedDB: 0,
      caches: 0,
      serviceWorker: false,
    }

    try {
      // Count localStorage items
      status.localStorage = localStorage.length

      // Count sessionStorage items
      status.sessionStorage = sessionStorage.length

      // Count IndexedDB databases
      if (window.indexedDB && 'databases' in indexedDB) {
        const databases = await (
          indexedDB as unknown as {
            databases: () => Promise<Array<{ name: string }>>
          }
        ).databases()
        status.indexedDB = databases.length
      }

      // Count cache storages
      if ('caches' in window) {
        const cacheNames = await caches.keys()
        status.caches = cacheNames.length
      }

      // Check service worker
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration()
        status.serviceWorker = !!registration
      }
    } catch (error) {
      logger.warn('Failed to get cache status:', error)
    }

    return status
  }

  /**
   * Force a complete page reload with cache clearing
   */
  public forceReload(): void {
    // Clear all caches first
    this.clearAllCaches()
      .then(() => {
        // Force hard reload after a short delay
        setTimeout(() => {
          window.location.reload()
        }, 1000)
      })
      .catch(() => {
        // Fallback to immediate reload
        window.location.reload()
      })
  }

  /**
   * Check if PWA is installed and needs update
   */
  public async checkForPWAUpdate(): Promise<boolean> {
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration()

        if (registration) {
          // Check if there's a waiting service worker (new version available)
          if (registration.waiting) {
            logger.log('🔄 New PWA version available')
            return true
          }

          // Listen for updates
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (
                  newWorker.state === 'installed' &&
                  navigator.serviceWorker.controller
                ) {
                  logger.log('🔄 New PWA version installed')
                  return true
                }
              })
            }
          })
        }
      }
    } catch (error) {
      logger.warn('Failed to check for PWA updates:', error)
    }

    return false
  }
}

// Export singleton instance
export const cacheManager = CacheManager.getInstance()

// Export utility functions for direct use
export const clearAllCaches = () => cacheManager.clearAllCaches()
export const getCacheStatus = () => cacheManager.getCacheStatus()
export const forceReload = () => cacheManager.forceReload()
export const checkForPWAUpdate = () => cacheManager.checkForPWAUpdate()

// Created and developed by Jai Singh
