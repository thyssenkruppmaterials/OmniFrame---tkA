/**
 * Auto-Updater Service - Enterprise Smart Reload Coordinator
 *
 * Coordinates the reload strategy when a new deployment is detected by the
 * VersionChecker. Tracks user activity, detects navigation, and performs
 * safety checks before triggering a reload.
 *
 * Strategy:
 * 1. User idle for 5 min + update available + safe → auto-reload
 * 2. User active + update available → show banner via DOM event
 * 3. User navigates + update available → full page reload at new URL
 *
 * Safety checks before auto-reload:
 * - No open Radix UI dialogs/sheets ([data-state="open"])
 * - No focused input/textarea/select (user typing)
 *
 * IMPORTANT: Does NOT monkey-patch pushState/replaceState. Uses pathname
 * polling to detect navigation (avoids conflict with main.tsx PWA patches).
 *
 * @module auto-updater
 */
import { Capacitor } from '@capacitor/core'
import { logger } from '@/lib/utils/logger'
import {
  VERSION_UPDATE_EVENT,
  type VersionMismatchDetail,
} from './version-checker'

// ---------------------------------------------------------------------------
// Custom Events
// ---------------------------------------------------------------------------

/** Fired when the banner should be shown to the user */
export const SHOW_UPDATE_BANNER_EVENT = 'app:show-update-banner'

/** Fired just before a reload is triggered (for logging/analytics) */
export const BEFORE_RELOAD_EVENT = 'app:before-reload'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IDLE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes
const NAV_POLL_INTERVAL_MS = 200 // 200ms (only active when update pending)
const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'scroll',
  'click',
  'touchstart',
  'touchmove',
] as const

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AutoUpdater {
  private static instance: AutoUpdater | null = null

  // State
  private _pendingUpdate = false
  private _mismatchDetail: VersionMismatchDetail | null = null
  private _userIsIdle = false
  private _bannerShown = false
  private _reloading = false

  // Timers
  private idleTimerId: ReturnType<typeof setTimeout> | null = null
  private navPollId: ReturnType<typeof setInterval> | null = null
  private lastPathname: string = ''

  // Bound handlers for cleanup
  private boundOnUpdateAvailable: (e: Event) => void
  private boundOnActivity: () => void

  private constructor() {
    this.boundOnUpdateAvailable = this.handleUpdateAvailable.bind(this)
    this.boundOnActivity = this.handleActivity.bind(this)
  }

  // -------------------------------------------------------------------------
  // Singleton
  // -------------------------------------------------------------------------

  static getInstance(): AutoUpdater {
    if (!AutoUpdater.instance) {
      AutoUpdater.instance = new AutoUpdater()
    }
    return AutoUpdater.instance
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Start listening for update events and user activity. */
  start(): void {
    if (!this.shouldRun()) return

    this.lastPathname = window.location.pathname

    // Listen for version mismatch events from VersionChecker
    window.addEventListener(VERSION_UPDATE_EVENT, this.boundOnUpdateAvailable)

    // Start tracking user activity
    this.startActivityTracking()

    logger.log('[AutoUpdater] Started')
  }

  /** Stop all listeners and timers. */
  stop(): void {
    window.removeEventListener(
      VERSION_UPDATE_EVENT,
      this.boundOnUpdateAvailable
    )
    this.stopActivityTracking()
    this.stopNavPolling()
    this.clearIdleTimer()
    logger.log('[AutoUpdater] Stopped')
  }

  /** Trigger a graceful reload immediately (called from UI "Update Now" button). */
  async performGracefulReload(): Promise<void> {
    if (this._reloading) return
    this._reloading = true

    logger.log('[AutoUpdater] Performing graceful reload...')
    window.dispatchEvent(new CustomEvent(BEFORE_RELOAD_EVENT))

    await this.clearServiceWorkers()
    await this.clearCacheStorage()

    // Wait for service worker unregistration to fully propagate.
    // Without this delay, the browser may still use the old service worker
    // for the reload request, serving stale cached index.html.
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Use href assignment instead of reload() to force a full navigation
    // that bypasses any remaining service worker interception.
    // eslint-disable-next-line no-self-assign
    window.location.href = window.location.href
  }

  // -------------------------------------------------------------------------
  // Read-only state
  // -------------------------------------------------------------------------

  get pendingUpdate(): boolean {
    return this._pendingUpdate
  }

  get userIsIdle(): boolean {
    return this._userIsIdle
  }

  get mismatchDetail(): VersionMismatchDetail | null {
    return this._mismatchDetail
  }

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  private handleUpdateAvailable(e: Event): void {
    const detail = (e as CustomEvent<VersionMismatchDetail>).detail
    this._pendingUpdate = true
    this._mismatchDetail = detail

    logger.log(
      `[AutoUpdater] Update available: ${detail.currentHash} → ${detail.deployedHash}`
    )

    // Start navigation polling (only runs when update is pending)
    this.startNavPolling()

    // Decide what to do based on current user state
    if (this._userIsIdle && this.isSafeToReload()) {
      logger.log('[AutoUpdater] User idle + safe to reload → auto-reloading')
      this.performGracefulReload()
    } else {
      // Show the banner
      this.showBanner()
    }
  }

  private handleActivity(): void {
    this._userIsIdle = false
    this.resetIdleTimer()
  }

  // -------------------------------------------------------------------------
  // Idle detection
  // -------------------------------------------------------------------------

  private startActivityTracking(): void {
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, this.boundOnActivity, { passive: true })
    }
    this.resetIdleTimer()
  }

  private stopActivityTracking(): void {
    for (const event of ACTIVITY_EVENTS) {
      window.removeEventListener(event, this.boundOnActivity)
    }
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer()
    this.idleTimerId = setTimeout(() => {
      this._userIsIdle = true
      logger.log('[AutoUpdater] User idle')

      // If we have a pending update and it's safe, auto-reload
      if (this._pendingUpdate && this.isSafeToReload()) {
        logger.log(
          '[AutoUpdater] Idle + pending update + safe → auto-reloading'
        )
        this.performGracefulReload()
      }
    }, IDLE_THRESHOLD_MS)
  }

  private clearIdleTimer(): void {
    if (this.idleTimerId !== null) {
      clearTimeout(this.idleTimerId)
      this.idleTimerId = null
    }
  }

  // -------------------------------------------------------------------------
  // Navigation detection (pathname polling - NO pushState monkey-patching)
  // -------------------------------------------------------------------------

  private startNavPolling(): void {
    if (this.navPollId !== null) return

    this.lastPathname = window.location.pathname
    this.navPollId = setInterval(() => {
      const currentPathname = window.location.pathname
      if (currentPathname !== this.lastPathname) {
        this.lastPathname = currentPathname
        this.handleNavigationDetected()
      }
    }, NAV_POLL_INTERVAL_MS)
  }

  private stopNavPolling(): void {
    if (this.navPollId !== null) {
      clearInterval(this.navPollId)
      this.navPollId = null
    }
  }

  private handleNavigationDetected(): void {
    if (!this._pendingUpdate || this._reloading) return

    logger.log(
      '[AutoUpdater] Navigation detected with pending update → reloading'
    )
    // The URL has already changed (client-side nav happened).
    // Reload at the NEW URL so the user ends up where they intended.
    this.performGracefulReload()
  }

  // -------------------------------------------------------------------------
  // Safety checks
  // -------------------------------------------------------------------------

  /**
   * Returns true if it's safe to auto-reload without risking data loss.
   *
   * Checks:
   * 1. No open Radix UI dialogs/sheets (data-state="open")
   * 2. No actively focused input/textarea/select
   */
  private isSafeToReload(): boolean {
    // Check for open Radix UI overlays
    const openOverlays = document.querySelectorAll(
      '[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"]'
    )
    if (openOverlays.length > 0) {
      logger.log('[AutoUpdater] Unsafe: open dialog/sheet detected')
      return false
    }

    // Check for focused input elements
    const activeEl = document.activeElement
    if (activeEl) {
      const tag = activeEl.tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        logger.log('[AutoUpdater] Unsafe: user has focused input')
        return false
      }
      // Check for contenteditable
      if (activeEl.getAttribute('contenteditable') === 'true') {
        logger.log('[AutoUpdater] Unsafe: user editing contenteditable')
        return false
      }
    }

    return true
  }

  // -------------------------------------------------------------------------
  // Banner
  // -------------------------------------------------------------------------

  private showBanner(): void {
    if (this._bannerShown) return
    this._bannerShown = true

    window.dispatchEvent(
      new CustomEvent(SHOW_UPDATE_BANNER_EVENT, {
        detail: this._mismatchDetail,
      })
    )
  }

  // -------------------------------------------------------------------------
  // Cache cleanup
  // -------------------------------------------------------------------------

  private async clearServiceWorkers(): Promise<void> {
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map((r) => r.unregister()))
        logger.log(
          `[AutoUpdater] Unregistered ${registrations.length} service worker(s)`
        )
      }
    } catch (error) {
      logger.warn('[AutoUpdater] Failed to unregister service workers:', error)
    }
  }

  private async clearCacheStorage(): Promise<void> {
    try {
      if ('caches' in window) {
        const names = await caches.keys()
        await Promise.all(names.map((name) => caches.delete(name)))
        logger.log(`[AutoUpdater] Cleared ${names.length} cache(s)`)
      }
    } catch (error) {
      logger.warn('[AutoUpdater] Failed to clear cache storage:', error)
    }
  }

  // -------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------

  private shouldRun(): boolean {
    if (import.meta.env.DEV) return false
    try {
      if (Capacitor.isNativePlatform()) return false
    } catch {
      // Capacitor not available
    }
    if (typeof window === 'undefined') return false
    return true
  }
}

// Export singleton accessor
export const autoUpdater = AutoUpdater.getInstance()
