import { logger } from '@/lib/utils/logger'

/**
 * TimeClock Kiosk PWA Manager
 * Handles PWA registration and iOS full-screen support for the /timeclockapp/ route.
 * Follows the same singleton + dynamic meta-tag pattern as RFPWAManager.
 */
export class TimeclockPWAManager {
  private static instance: TimeclockPWAManager | null = null
  private isTimeclockRoute = false
  private metaTagsAdded = false

  private constructor() {}

  public static getInstance(): TimeclockPWAManager {
    if (!TimeclockPWAManager.instance) {
      TimeclockPWAManager.instance = new TimeclockPWAManager()
    }
    return TimeclockPWAManager.instance
  }

  private checkIsTimeclockRoute(): boolean {
    if (typeof window === 'undefined') return false
    return window.location.pathname.startsWith('/timeclockapp')
  }

  /**
   * When launched as a standalone PWA and the user somehow navigates away
   * from /timeclockapp, redirect back.
   */
  public enforceTimeclockScope(): void {
    if (typeof window === 'undefined') return
    if (
      !this.checkIsTimeclockRoute() &&
      window.matchMedia?.('(display-mode: standalone)').matches &&
      sessionStorage.getItem('timeclock-pwa') === '1'
    ) {
      logger.log(
        '[TimeClock PWA] Enforcing scope - redirecting to /timeclockapp/'
      )
      window.location.href = '/timeclockapp/'
    }
  }

  private addPWAMetaTags(): void {
    if (this.metaTagsAdded || typeof document === 'undefined') return
    const head = document.head

    // The inline script in index.html already injects these tags synchronously
    // for iOS "Add to Home Screen" support. Only add if they're missing (e.g.
    // navigated to /timeclockapp from another route without a full page load).
    if (!head.querySelector('link[href="/timeclock-manifest.webmanifest"]')) {
      // Remove any RF manifest that might be present
      head.querySelector('link[rel="manifest"]')?.remove()

      const manifestLink = document.createElement('link')
      manifestLink.rel = 'manifest'
      manifestLink.href = '/timeclock-manifest.webmanifest'
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

    ensureMeta('theme-color', '#09090b')
    ensureMeta('mobile-web-app-capable', 'yes')
    ensureMeta('apple-mobile-web-app-capable', 'yes')
    ensureMeta('apple-mobile-web-app-status-bar-style', 'black-translucent')
    ensureMeta('apple-mobile-web-app-title', 'Time Clock')

    if (!head.querySelector('link[rel="apple-touch-icon"]')) {
      const touchIcon = document.createElement('link')
      touchIcon.rel = 'apple-touch-icon'
      touchIcon.href = '/images/favicon.svg'
      head.appendChild(touchIcon)
    }

    sessionStorage.setItem('timeclock-pwa', '1')
    this.metaTagsAdded = true
    logger.log('[TimeClock PWA] Meta tags ensured')
  }

  private removePWAMetaTags(): void {
    if (!this.metaTagsAdded || typeof document === 'undefined') return
    const head = document.head

    head.querySelector('link[href="/timeclock-manifest.webmanifest"]')?.remove()
    head.querySelector('meta[name="theme-color"][content="#09090b"]')?.remove()

    for (const name of [
      'mobile-web-app-capable',
      'apple-mobile-web-app-capable',
      'apple-mobile-web-app-status-bar-style',
      'apple-mobile-web-app-title',
    ]) {
      head.querySelector(`meta[name="${name}"]`)?.remove()
    }
    head.querySelector('link[rel="apple-touch-icon"]')?.remove()

    this.metaTagsAdded = false
    logger.log('[TimeClock PWA] Meta tags removed')
  }

  private async registerServiceWorker(): Promise<void> {
    try {
      if (!('serviceWorker' in navigator)) {
        logger.warn('[TimeClock PWA] Service workers not supported')
        return
      }
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/timeclockapp/',
      })
      registration.addEventListener('updatefound', () => {
        logger.log('[TimeClock PWA] New content available')
      })
      logger.log('[TimeClock PWA] Service worker registered', registration)
    } catch (err) {
      logger.warn('[TimeClock PWA] Service worker registration failed:', err)
    }
  }

  public async initialize(): Promise<void> {
    this.isTimeclockRoute = this.checkIsTimeclockRoute()
    if (this.isTimeclockRoute) {
      this.addPWAMetaTags()
      await this.registerServiceWorker()
      logger.log('[TimeClock PWA] Initialized')
    } else {
      this.cleanup()
    }
  }

  public cleanup(): void {
    if (this.metaTagsAdded) this.removePWAMetaTags()
    this.isTimeclockRoute = false
  }

  public handleRouteChange(): void {
    const was = this.isTimeclockRoute
    const now = this.checkIsTimeclockRoute()
    if (was && !now) this.cleanup()
    else if (!was && now) this.initialize()
    this.isTimeclockRoute = now
  }

  public isPWAActive(): boolean {
    return this.isTimeclockRoute && this.metaTagsAdded
  }
}

export const timeclockPWAManager = TimeclockPWAManager.getInstance()
// Developer and Creator: Jai Singh
