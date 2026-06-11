// Created and developed by Jai Singh
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

/**
 * Number of consecutive `fetch()` failures before the poller self-disables
 * for the rest of the session. Tuned to absorb transient blips (one or two
 * lost requests on a flaky LTE link) while shutting down quickly when the
 * failure mode is structural — most commonly a corporate Secure Web Gateway
 * (Zscaler / Symantec WSS) intercepting the redirect and stripping CORS
 * headers, which the browser surfaces as `TypeError: Failed to fetch` on
 * every poll. See `Debug/Fix-Version-Checker-Corporate-Proxy-Noise.md` for
 * the warehouse-RF incident that motivated this gate.
 */
const FAILURE_SUPPRESSION_THRESHOLD = 3

/**
 * Route patterns where `VersionChecker` MUST NOT poll. RF terminals and
 * timeclock kiosks are dedicated devices on which IT controls the refresh
 * cadence (manual reboot / IT-pushed reload), so per-device polling adds
 * no benefit, and it's exactly these devices that sit on the warehouse
 * Zscaler-protected network where the polls get intercepted and flood the
 * console.
 *
 * Deliberately NARROWER than `PRESENCE_KIOSK_ROUTE_PATTERNS`:
 *
 * - `/^\/rf-/`                           — included (warehouse RF handhelds)
 * - `/^\/timeclock(app)?(\/|$)/`         — included (back-of-house kiosks)
 * - `/^\/customer-portal(\/|$)/`         — DELIBERATELY EXCLUDED. Customer
 *   portal pages are public-internet, customer-facing, and the refresh
 *   cadence matters for users picking up new builds. Presence opts out
 *   because a 1:N "who's online" channel is not useful there; auto-version
 *   pickup IS useful.
 *
 * Co-located with `version-checker.ts` rather than `presence/constants.ts`
 * because the patterns are different (customer-portal exclusion) and
 * pulling a presence import into the version subsystem would create
 * cross-domain coupling for a 3-line constant.
 */
export const VERSION_CHECK_KIOSK_ROUTE_PATTERNS: readonly RegExp[] = [
  /^\/rf-/,
  /^\/timeclock(app)?(\/|$)/,
] as const

export function isVersionCheckKioskRoute(pathname: string): boolean {
  return VERSION_CHECK_KIOSK_ROUTE_PATTERNS.some((re) => re.test(pathname))
}

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

  /**
   * Counts consecutive `fetchBuildInfo()` failures since the last success.
   * Resets to 0 in `checkNow()` after a 200 OK with a valid payload. Used
   * by `handleFetchError()` to gate the log-level ladder + the
   * self-suppression trip below.
   */
  private _consecutiveFailures = 0

  /**
   * One-shot latch. Once set to `true` (when `_consecutiveFailures` crosses
   * `FAILURE_SUPPRESSION_THRESHOLD`), the poller stops scheduling itself
   * for the rest of the page session. The auto-updater simply stops
   * receiving `VERSION_UPDATE_EVENT`s; manual page refresh remains the
   * recovery path. Only `start()` clears this — and `start()` no-ops
   * when already active, so a refresh is required in practice.
   */
  private _suppressedAfterFailures = false

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

    // Kiosk-route opt-out: warehouse RF terminals and timeclock kiosks live
    // on Zscaler-protected networks where /build-info.json polls trigger a
    // CORS-blocked redirect every ~5 min and flood the device console. IT
    // owns the refresh cadence on these devices anyway — see
    // Debug/Fix-Version-Checker-Corporate-Proxy-Noise.md.
    if (
      typeof window !== 'undefined' &&
      isVersionCheckKioskRoute(window.location.pathname)
    ) {
      logger.info(
        '[VersionChecker] Skipped on kiosk/RF route — manual refresh controls cadence'
      )
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

      // Reset error backoff + failure counters on success.
      // Self-healing for transient blips: one good fetch clears the slate
      // so a flaky LTE link doesn't permanently disable the poller.
      this.consecutiveErrors = 0
      this.currentBackoff = 0
      this._consecutiveFailures = 0

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
    this._consecutiveFailures++
    this.currentBackoff = Math.min(
      MIN_BACKOFF_MS * Math.pow(2, this.consecutiveErrors - 1),
      MAX_BACKOFF_MS
    )

    // Log-level ladder. The dominant failure mode in production is a
    // corporate Secure Web Gateway (Zscaler / Symantec WSS) intercepting
    // /build-info.json with a CORS-blocked redirect. We can't read the
    // response so we can't distinguish proxy-block from generic network
    // failure — but we DO see N consecutive same-shape errors, which the
    // ladder + suppression latch handle without console-flooding.
    //
    //   1st failure  → warn   (one visible signal that the check is degraded)
    //   2nd / 3rd    → debug  (suppressed in prod by logger minLevel='warn')
    //   ≥ threshold  → info ONCE, then stop the polling timer entirely
    if (this._consecutiveFailures === 1) {
      logger.warn(
        `[VersionChecker] Fetch error (attempt ${this._consecutiveFailures}), ` +
          `backing off ${this.currentBackoff}ms:`,
        error
      )
    } else if (this._consecutiveFailures < FAILURE_SUPPRESSION_THRESHOLD) {
      logger.debug(
        `[VersionChecker] Fetch error (attempt ${this._consecutiveFailures}), ` +
          `backing off ${this.currentBackoff}ms:`,
        error
      )
    } else if (
      this._consecutiveFailures >= FAILURE_SUPPRESSION_THRESHOLD &&
      !this._suppressedAfterFailures
    ) {
      // Trip the latch ONCE. Subsequent failures (if any slipped through
      // before the timer cancelled) won't re-log.
      this._suppressedAfterFailures = true
      logger.info(
        '[VersionChecker] Disabling auto-poll — repeated fetch failures ' +
          '(likely corporate proxy or offline). Manual refresh will pick up new builds.'
      )

      // Cancel the next scheduled poll and tear down listeners. Polling
      // is idempotently disabled until the page is refreshed.
      this.isPollingActive = false
      this.clearScheduledPoll()
      try {
        document.removeEventListener(
          'visibilitychange',
          this.boundVisibilityHandler
        )
        window.removeEventListener('online', this.boundOnlineHandler)
      } catch {
        // SSR / non-browser: nothing to remove. Fall through.
      }
    }
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

// Created and developed by Jai Singh
