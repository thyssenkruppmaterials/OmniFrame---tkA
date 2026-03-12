/**
 * Version Checker Service - Enterprise Deployment Detection
 *
 * Singleton service that polls /build-info.json to detect new deployments.
 * When a version mismatch is found, it emits a custom DOM event that the
 * AutoUpdater and React UI can listen for.
 *
 * Features:
 * - Polls every 60 seconds in production (configurable)
 * - Uses Visibility API to check immediately when tab regains focus
 * - Pauses polling when tab is hidden (no wasted requests)
 * - Exponential backoff on network errors
 * - Disabled in development mode and on Capacitor native platforms
 *
 * @module version-checker
 */
import { Capacitor } from '@capacitor/core'
import { logger } from '@/lib/utils/logger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildInfo {
  version: string
  buildId: string
  buildTime: string
  commitHash?: string
  environment?: string
}

export interface VersionMismatchDetail {
  currentHash: string
  deployedHash: string
  buildInfo: BuildInfo
}

// ---------------------------------------------------------------------------
// Custom Events
// ---------------------------------------------------------------------------

/** Fired when a new deployment is detected */
export const VERSION_UPDATE_EVENT = 'app:update-available'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL_MS = 60_000 // 60 seconds
const MIN_BACKOFF_MS = 5_000
const MAX_BACKOFF_MS = 300_000 // 5 minutes
const BUILD_INFO_PATH = '/build-info.json'

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class VersionChecker {
  private static instance: VersionChecker | null = null

  private _isUpdateAvailable = false
  private _latestBuildInfo: BuildInfo | null = null
  private _currentHash: string

  private intervalId: ReturnType<typeof setInterval> | null = null
  private pollIntervalMs: number
  private currentBackoff: number = 0
  private consecutiveErrors = 0
  private isPollingActive = false
  private isChecking = false

  // Bound handlers for cleanup
  private boundVisibilityHandler: () => void
  private boundOnlineHandler: () => void

  private constructor(pollIntervalMs = DEFAULT_POLL_INTERVAL_MS) {
    this._currentHash =
      typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev'
    this.pollIntervalMs = pollIntervalMs
    this.boundVisibilityHandler = this.handleVisibilityChange.bind(this)
    this.boundOnlineHandler = this.handleOnline.bind(this)
  }

  // -------------------------------------------------------------------------
  // Singleton
  // -------------------------------------------------------------------------

  static getInstance(pollIntervalMs?: number): VersionChecker {
    if (!VersionChecker.instance) {
      VersionChecker.instance = new VersionChecker(pollIntervalMs)
    }
    return VersionChecker.instance
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Start the polling loop. No-op if already started or in dev/native. */
  start(): void {
    if (this.isPollingActive) return
    if (!this.shouldRun()) {
      logger.log('[VersionChecker] Skipping: dev mode or native platform')
      return
    }

    logger.log(
      `[VersionChecker] Starting (hash=${this._currentHash}, interval=${this.pollIntervalMs}ms)`
    )

    this.isPollingActive = true

    // Initial check after a short delay (let the app settle)
    setTimeout(() => this.checkNow(), 3_000)

    // Start interval
    this.scheduleNextPoll()

    // Listen for tab visibility changes
    document.addEventListener('visibilitychange', this.boundVisibilityHandler)

    // Listen for network reconnection
    window.addEventListener('online', this.boundOnlineHandler)
  }

  /** Stop polling and clean up all listeners. */
  stop(): void {
    this.isPollingActive = false
    this.clearScheduledPoll()
    document.removeEventListener(
      'visibilitychange',
      this.boundVisibilityHandler
    )
    window.removeEventListener('online', this.boundOnlineHandler)
    logger.log('[VersionChecker] Stopped')
  }

  /** Perform an immediate check (returns true if update available). */
  async checkNow(): Promise<boolean> {
    if (this.isChecking) return this._isUpdateAvailable
    this.isChecking = true

    try {
      const buildInfo = await this.fetchBuildInfo()
      if (!buildInfo) return this._isUpdateAvailable

      // Reset error backoff on success
      this.consecutiveErrors = 0
      this.currentBackoff = 0

      this._latestBuildInfo = buildInfo

      if (buildInfo.buildId !== this._currentHash) {
        if (!this._isUpdateAvailable) {
          logger.log(
            `[VersionChecker] Update detected: ${this._currentHash} → ${buildInfo.buildId}`
          )
          this._isUpdateAvailable = true

          const detail: VersionMismatchDetail = {
            currentHash: this._currentHash,
            deployedHash: buildInfo.buildId,
            buildInfo,
          }

          window.dispatchEvent(
            new CustomEvent(VERSION_UPDATE_EVENT, { detail })
          )
        }
      }

      return this._isUpdateAvailable
    } catch (error) {
      this.handleFetchError(error)
      return this._isUpdateAvailable
    } finally {
      this.isChecking = false
    }
  }

  // -------------------------------------------------------------------------
  // Read-only state
  // -------------------------------------------------------------------------

  get isUpdateAvailable(): boolean {
    return this._isUpdateAvailable
  }

  get currentHash(): string {
    return this._currentHash
  }

  get latestBuildInfo(): BuildInfo | null {
    return this._latestBuildInfo
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private shouldRun(): boolean {
    // Disable in development
    if (import.meta.env.DEV) return false

    // Disable on Capacitor native platforms (updates via app store)
    try {
      if (Capacitor.isNativePlatform()) return false
    } catch {
      // Capacitor not available, continue
    }

    // Disable in SSR / non-browser
    if (typeof window === 'undefined' || typeof document === 'undefined')
      return false

    return true
  }

  private async fetchBuildInfo(): Promise<BuildInfo | null> {
    // Cache-busting query param + no-store to bypass ALL cache layers
    const url = `${BUILD_INFO_PATH}?_cb=${Date.now()}`
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    })

    if (!response.ok) {
      // 404 means build-info.json doesn't exist yet (first deploy)
      if (response.status === 404) {
        logger.log('[VersionChecker] build-info.json not found (first deploy?)')
        return null
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    // May throw on network error or JSON parse failure
    const data = await response.json()

    // Validate the response has the expected shape
    if (!data || typeof data.buildId !== 'string') {
      logger.warn('[VersionChecker] Invalid build-info.json format:', data)
      return null
    }

    return data as BuildInfo
  }

  private handleFetchError(error: unknown): void {
    this.consecutiveErrors++
    this.currentBackoff = Math.min(
      MIN_BACKOFF_MS * Math.pow(2, this.consecutiveErrors - 1),
      MAX_BACKOFF_MS
    )

    if (this.consecutiveErrors <= 3) {
      logger.warn(
        `[VersionChecker] Fetch error (attempt ${this.consecutiveErrors}), ` +
          `backing off ${this.currentBackoff}ms:`,
        error
      )
    }
    // After 3 errors, go silent to avoid log spam
  }

  private scheduleNextPoll(): void {
    this.clearScheduledPoll()
    if (!this.isPollingActive) return

    const delay =
      this.currentBackoff > 0 ? this.currentBackoff : this.pollIntervalMs

    this.intervalId = setTimeout(() => {
      if (!this.isPollingActive) return
      // Only poll if the tab is visible
      if (document.visibilityState === 'visible') {
        this.checkNow().finally(() => this.scheduleNextPoll())
      } else {
        // Tab hidden - just reschedule without polling
        this.scheduleNextPoll()
      }
    }, delay)
  }

  private clearScheduledPoll(): void {
    if (this.intervalId !== null) {
      clearTimeout(this.intervalId)
      this.intervalId = null
    }
  }

  private handleVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      // Tab just became visible - check immediately
      // (user may have deployed while tab was hidden)
      logger.log('[VersionChecker] Tab visible - checking for updates')
      this.checkNow()
    }
  }

  private handleOnline(): void {
    // Network reconnected - check immediately
    logger.log('[VersionChecker] Network online - checking for updates')
    this.consecutiveErrors = 0
    this.currentBackoff = 0
    this.checkNow()
  }
}

// Export singleton accessor
export const versionChecker = VersionChecker.getInstance()
