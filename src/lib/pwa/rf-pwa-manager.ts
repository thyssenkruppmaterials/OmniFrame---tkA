// Created and developed by Jai Singh
import { logger } from '@/lib/utils/logger'

/**
 * RF Interface PWA Manager
 * Handles conditional PWA registration and meta tag management for RF Terminal Interface only
 */

export class RFPWAManager {
  private static instance: RFPWAManager | null = null
  private isRFRoute: boolean = false
  private metaTagsAdded: boolean = false

  private constructor() {
    // Private constructor for singleton pattern
  }

  public static getInstance(): RFPWAManager {
    if (!RFPWAManager.instance) {
      RFPWAManager.instance = new RFPWAManager()
    }
    return RFPWAManager.instance
  }

  /**
   * Check if current route is RF Interface related
   */
  private checkIsRFRoute(): boolean {
    if (typeof window === 'undefined') return false

    const path = window.location.pathname
    return (
      path.startsWith('/rf-interface') ||
      path === '/rf-signin' ||
      path.startsWith('/rf-signin')
    )
  }

  /**
   * Redirect to RF sign-in if not in RF scope (for PWA isolation)
   */
  public enforceRFScope(): void {
    if (typeof window === 'undefined') return

    const isRFRoute = this.checkIsRFRoute()

    // If we're in PWA context but not on RF routes, redirect to RF sign-in
    if (
      !isRFRoute &&
      window.matchMedia &&
      window.matchMedia('(display-mode: standalone)').matches
    ) {
      logger.log(
        '[RF PWA] Enforcing RF scope isolation - redirecting to RF sign-in'
      )
      window.location.href = '/rf-signin'
    }
  }

  /**
   * Add PWA meta tags dynamically for RF Interface
   */
  private addPWAMetaTags(): void {
    if (this.metaTagsAdded || typeof document === 'undefined') return

    const head = document.head

    // The inline script in index.html already injects these tags synchronously
    // for iOS "Add to Home Screen". Only add if missing (SPA navigation case).
    if (!head.querySelector('link[href="/manifest.webmanifest"]')) {
      head.querySelector('link[rel="manifest"]')?.remove()

      const manifestLink = document.createElement('link')
      manifestLink.rel = 'manifest'
      manifestLink.href = '/manifest.webmanifest'
      head.appendChild(manifestLink)
    }

    const ensureMeta = (name: string, content: string) => {
      if (!head.querySelector(`meta[name="${name}"]`)) {
        const el = document.createElement('meta')
        el.name = name
        el.content = content
        head.appendChild(el)
      }
    }

    ensureMeta('theme-color', '#ffffff')
    ensureMeta('mobile-web-app-capable', 'yes')
    ensureMeta('apple-mobile-web-app-capable', 'yes')
    ensureMeta('apple-mobile-web-app-status-bar-style', 'default')
    ensureMeta('apple-mobile-web-app-title', 'OmniFrame RF')

    if (!head.querySelector('link[rel="apple-touch-icon"]')) {
      const appleTouchIcon = document.createElement('link')
      appleTouchIcon.rel = 'apple-touch-icon'
      appleTouchIcon.href = '/images/OneBoxLogoX.png'
      head.appendChild(appleTouchIcon)
    }

    this.metaTagsAdded = true
    logger.log('[RF PWA] Meta tags ensured for RF Interface')
  }

  /**
   * Remove PWA meta tags when leaving RF Interface
   */
  private removePWAMetaTags(): void {
    if (!this.metaTagsAdded || typeof document === 'undefined') return

    const head = document.head

    // Remove manifest link
    const manifestLink = head.querySelector('link[rel="manifest"]')
    if (manifestLink) head.removeChild(manifestLink)

    // Remove theme color
    const themeColorMeta = head.querySelector('meta[name="theme-color"]')
    if (themeColorMeta) head.removeChild(themeColorMeta)

    // Remove Apple PWA meta tags
    const appleMetaTags = [
      'mobile-web-app-capable',
      'apple-mobile-web-app-capable',
      'apple-mobile-web-app-status-bar-style',
      'apple-mobile-web-app-title',
    ]

    appleMetaTags.forEach((name) => {
      const meta = head.querySelector(`meta[name="${name}"]`)
      if (meta) head.removeChild(meta)
    })

    // Remove Apple touch icon
    const appleTouchIcon = head.querySelector('link[rel="apple-touch-icon"]')
    if (appleTouchIcon) head.removeChild(appleTouchIcon)

    this.metaTagsAdded = false
    logger.log('[RF PWA] Meta tags removed from main application')
  }

  /**
   * Register service worker for RF Interface
   */
  private async registerServiceWorker(): Promise<void> {
    try {
      if ('serviceWorker' in navigator) {
        // Register service worker with RF-specific scope
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/rf-interface/',
        })

        // Listen for service worker updates
        registration.addEventListener('updatefound', () => {
          logger.log('[RF PWA] New content available, refresh to update')
        })

        // Check if already controlled by service worker
        if (navigator.serviceWorker.controller) {
          logger.log('[RF PWA] App ready to work offline')
        }

        logger.log(
          '[RF PWA] Service worker registered for RF Interface:',
          registration
        )
      } else {
        logger.warn('[RF PWA] Service workers not supported')
      }
    } catch (error) {
      logger.warn('[RF PWA] Service worker registration failed:', error)
    }
  }

  /**
   * Initialize PWA for RF Interface routes
   */
  public async initializeRFPWA(): Promise<void> {
    this.isRFRoute = this.checkIsRFRoute()

    if (this.isRFRoute) {
      this.addPWAMetaTags()
      await this.registerServiceWorker()
      logger.log('[RF PWA] PWA initialized for RF Interface')
    } else {
      this.cleanup()
    }
  }

  /**
   * Clean up PWA features when leaving RF routes
   */
  public cleanup(): void {
    if (this.metaTagsAdded) {
      this.removePWAMetaTags()
    }
    this.isRFRoute = false
    logger.log('[RF PWA] PWA features cleaned up')
  }

  /**
   * Handle route changes
   */
  public handleRouteChange(): void {
    const wasRFRoute = this.isRFRoute
    const isNowRFRoute = this.checkIsRFRoute()

    if (wasRFRoute && !isNowRFRoute) {
      // Left RF route
      this.cleanup()
    } else if (!wasRFRoute && isNowRFRoute) {
      // Entered RF route
      this.initializeRFPWA()
    }

    this.isRFRoute = isNowRFRoute
  }

  /**
   * Check if PWA is currently active
   */
  public isPWAActive(): boolean {
    return this.isRFRoute && this.metaTagsAdded
  }
}

// Export singleton instance
export const rfPWAManager = RFPWAManager.getInstance()

// Created and developed by Jai Singh
