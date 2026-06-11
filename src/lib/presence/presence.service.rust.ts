// Created and developed by Jai Singh
/**
 * Presence Service — Rust backend (Option 2)
 *
 * Drop-in replacement for `PresenceService` (the Supabase-Realtime
 * implementation in `presence.service.ts`) that talks to
 * `rust-work-service` instead. The two classes have IDENTICAL public
 * surfaces (`initialize`, `setStatus`, `setCustomStatusText`,
 * `getEffectiveStatus`, `getManualStatus`, `destroy`, `isConnected`,
 * `isDisabled`, `disabledReasonValue`) so `PresenceContext` and
 * `usePresenceTracker` can swap implementations under the
 * `PRESENCE_MODE` env-var without any consumer change.
 *
 * Architecture (full ADR in
 * `memorybank/OmniFrame/Decisions/ADR-Presence-Architecture-Next-Steps.md`):
 *
 *   1. Bootstrap: `GET /api/v1/presence/online` once at init to seed
 *      the org's "who's online" snapshot (so the panel is populated
 *      before the WS catches up).
 *   2. Heartbeats: `POST /api/v1/presence/heartbeat` every 30s
 *      (foreground) / 5min (hidden) / off (Appear Offline). Same
 *      visibility-aware cadence as Phase A's DB heartbeat.
 *   3. Real-time deltas: subscribe to the existing
 *      `WorkServiceWebSocket` singleton for
 *      `Presence{Joined,Updated,Left}` events, filter by
 *      `event.organization_id === this.organizationId` (defence in
 *      depth — the Rust send-loop already deny-by-default org-filters
 *      these), and update the local `users` map.
 *   4. Untrack: `DELETE /api/v1/presence` on user-set "Appear Offline"
 *      / explicit destroy. The Rust handler broadcasts `PresenceLeft`
 *      immediately so other tabs don't wait the 30s evictor pass.
 *   5. Resilience: same Phase A circuit breaker (counts heartbeat-POST
 *      failures + WS-disconnect periods, trips on threshold, cooldown
 *      grows exponentially). Same TRACK_DEBOUNCE_MS coalescing on the
 *      heartbeat POST so a status flip + custom-text edit + idle
 *      re-entry within the same second collapses to one network call.
 *
 * Six-layer defence pattern preserved (`Patterns/Realtime-Presence-Browser-Hardening`):
 *   - Layer 1 (coalesce outbound) — `scheduleHeartbeat` debouncer.
 *   - Layer 2 (channel-error breaker) — failure counter on POST + WS.
 *   - Layer 3 (visibility-aware writes) — heartbeat cadence.
 *   - Layer 4 (route-class opt-out) — same `kioskRoute` gate.
 *   - Layer 5 (build-time kill switch) — `PRESENCE_DISABLED_ENV`.
 *   - Layer 6 (permission gate) — same `presenceCandidate` gate.
 *   - Layer 7 (NEW) — server-side presence via dedicated Rust WS
 *     bus. The org-wide Supabase Presence channel is no longer in
 *     the critical path for any tab on this build.
 */
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import type { WsEvent } from '@/lib/work-service/types'
import { workServiceWs } from '@/lib/work-service/websocket'
import type {
  ConnectionState,
  WsEventHandler,
} from '@/lib/work-service/websocket'
import {
  CHANNEL_BREAK_INITIAL_COOLDOWN_MS,
  CHANNEL_BREAK_MAX_COOLDOWN_MS,
  CHANNEL_ERROR_THRESHOLD,
  CHANNEL_ERROR_WINDOW_MS,
  CHANNEL_STABLE_CONNECTION_MS,
  CUSTOM_STATUS_KEY,
  DB_HEARTBEAT_INTERVAL,
  DB_HEARTBEAT_INTERVAL_HIDDEN,
  IDLE_TIMEOUT,
  PRESENCE_DISABLED_ENV,
  PRESENCE_SYNC_THROTTLE,
  STATUS_PREFERENCE_KEY,
  TAB_HIDDEN_TIMEOUT,
  TRACK_DEBOUNCE_MS,
} from './constants'
import { IdleDetector } from './idle-detector'
import type {
  PresencePayload,
  PresenceRfActivity,
  PresenceStatus,
  PresenceUser,
} from './types'

type PresenceEventCallback = (users: PresenceUser[]) => void
type ConnectionCallback = (connected: boolean, error?: string) => void
type DisabledReason = 'env' | 'kiosk' | 'permission' | null

const WORK_SERVICE_URL =
  import.meta.env.VITE_WORK_SERVICE_URL || 'http://localhost:8030'

const PRESENCE_HEARTBEAT_PATH = '/api/v1/presence/heartbeat'
const PRESENCE_ONLINE_PATH = '/api/v1/presence/online'
const PRESENCE_UNTRACK_PATH = '/api/v1/presence'

function getDeviceType(): 'desktop' | 'mobile' | 'tablet' {
  const ua = navigator.userAgent.toLowerCase()
  if (/tablet|ipad/i.test(ua)) return 'tablet'
  if (/mobile|iphone|android/i.test(ua)) return 'mobile'
  return 'desktop'
}

function getInitials(
  fullName: string | null,
  firstName: string | null,
  email: string
): string {
  if (fullName) {
    const parts = fullName.trim().split(/\s+/)
    if (parts.length >= 2)
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return parts[0].substring(0, 2).toUpperCase()
  }
  if (firstName) return firstName.substring(0, 2).toUpperCase()
  return email.substring(0, 2).toUpperCase()
}

function getDisplayName(
  fullName: string | null,
  firstName: string | null,
  email: string
): string {
  return fullName || firstName || email.split('@')[0]
}

function presencePayloadToUser(payload: PresencePayload): PresenceUser {
  return {
    ...payload,
    initials: getInitials(payload.full_name, payload.first_name, payload.email),
    display_name: getDisplayName(
      payload.full_name,
      payload.first_name,
      payload.email
    ),
  }
}

/**
 * Mirror of `rfActivityShapeEqual` in `presence.service.ts`. See
 * that file's doc-comment for rationale. Kept duplicated rather
 * than extracted because both services intentionally have no
 * shared private helpers — the two classes are siblings.
 */
function rfActivityShapeEqual(
  a: PresenceRfActivity | null,
  b: PresenceRfActivity | null
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.current_step !== b.current_step) return false
  if (a.work_task_id !== b.work_task_id) return false
  if (a.work_zone !== b.work_zone) return false
  const sa = a.last_scan
  const sb = b.last_scan
  if (sa === sb) return true
  if (!sa || !sb) return false
  return sa.type === sb.type && sa.value === sb.value && sa.at === sb.at
}

interface OnlineSnapshotEntry {
  user_id: string
  payload: Partial<PresencePayload> & Record<string, unknown>
}

interface OnlineSnapshotResponse {
  users: OnlineSnapshotEntry[]
}

/**
 * Server-side presence service. Public surface is identical to
 * `PresenceService` (the Supabase implementation) — see the file-level
 * doc-comment for the design summary.
 */
export class PresenceServiceRust {
  // Local map of user_id → PresenceUser. Reflects the org's HSET in
  // Redis as we know it via bootstrap + WS deltas.
  private users: Map<string, PresenceUser> = new Map()

  private idleDetector: IdleDetector | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private syncThrottleTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatDebounceTimer: ReturnType<typeof setTimeout> | null = null

  private wsHandler: WsEventHandler | null = null
  private wsStateUnsubscribe: (() => void) | null = null

  // Channel-error breaker state (failures on POST or WS disconnect).
  private failureTimestamps: number[] = []
  private circuitTrippedUntil = 0
  private consecutiveTrips = 0
  private stableConnectionTimer: ReturnType<typeof setTimeout> | null = null

  // Visibility-aware heartbeat
  private boundHandleVisibility: (() => void) | null = null

  private currentUserId: string | null = null
  private organizationId: string | null = null
  private currentPayload: PresencePayload | null = null

  private manualStatus: PresenceStatus | null = null
  private customStatusText: string | null = null
  private isIdleState = false

  private onPresenceSync: PresenceEventCallback | null = null
  private onConnectionChange: ConnectionCallback | null = null

  private _isConnected = false
  private destroyed = false
  private disabledReason: DisabledReason = null

  get isConnected(): boolean {
    return this._isConnected
  }

  get isDisabled(): boolean {
    return this.disabledReason !== null
  }

  get disabledReasonValue(): DisabledReason {
    return this.disabledReason
  }

  /**
   * Mirror of `PresenceService.initialize()`. Same gating order
   * (env → kiosk → permission), same returned-state semantics. The
   * disabled fast paths still build `currentPayload` so other
   * consumers calling `getEffectiveStatus()` keep working.
   */
  async initialize(config: {
    userId: string
    email: string
    fullName: string | null
    firstName: string | null
    avatarUrl: string | null
    roleName: string | null
    roleId: string | null
    organizationId: string
    kioskRoute?: boolean
    presenceCandidate?: boolean
    onPresenceSync: PresenceEventCallback
    onConnectionChange: ConnectionCallback
  }): Promise<void> {
    this.destroy()
    this.destroyed = false

    this.currentUserId = config.userId
    this.organizationId = config.organizationId
    this.onPresenceSync = config.onPresenceSync
    this.onConnectionChange = config.onConnectionChange

    this.manualStatus = this.loadStatusPreference()
    this.customStatusText = this.loadCustomStatus()

    this.currentPayload = {
      user_id: config.userId,
      email: config.email,
      full_name: config.fullName,
      first_name: config.firstName,
      avatar_url: config.avatarUrl,
      role_name: config.roleName,
      role_id: config.roleId,
      status: this.getEffectiveStatus(),
      custom_status_text: this.customStatusText,
      device_type: getDeviceType(),
      // Seed with the boot-time pathname; `usePresenceTracker` updates
      // it on every navigation through `updateCurrentPage()`. The Rust
      // route accepts this field via `serde(flatten)` and stores it
      // verbatim in Redis, so no Rust release was required for this
      // re-enablement (see ADR-Scoped-CurrentPage-In-ActiveOperators).
      current_page:
        typeof window !== 'undefined' && window.location
          ? window.location.pathname
          : null,
      // RF activity telemetry — `null` until the RF activity hook
      // calls `updateRfActivity(...)`. Same `serde_json::Value`
      // pass-through as `current_page` (no Rust release required —
      // Worker 1's loose-payload design is what carries this field).
      rf_activity: null,
      online_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
    }

    if (PRESENCE_DISABLED_ENV) {
      this.disabledReason = 'env'
      logger.log(
        '[PresenceRust] Disabled via VITE_PRESENCE_DISABLED — skipping heartbeat + WS subscription.'
      )
      this.onConnectionChange?.(false, 'Disabled via env var')
      return
    }
    if (config.kioskRoute) {
      this.disabledReason = 'kiosk'
      logger.log(
        '[PresenceRust] Skipped on kiosk/RF route — no heartbeat, no WS subscription.'
      )
      this.onConnectionChange?.(false, 'Disabled on kiosk route')
      return
    }
    if (config.presenceCandidate === false) {
      this.disabledReason = 'permission'
      logger.log(
        '[PresenceRust] Skipped — user has presence:hidden and no presence:view* permission.'
      )
      this.onConnectionChange?.(false, 'Disabled by permission policy')
      return
    }
    this.disabledReason = null

    // Bootstrap: snapshot the current org-wide presence map BEFORE
    // wiring up the WS handler so the first sync reflects existing
    // members, not a half-empty post-subscribe view.
    await this.bootstrapSnapshot()

    this.subscribeToWs()
    this.startIdleDetection()
    this.startHeartbeat()
    this.startVisibilityWatcher()

    // Push the first heartbeat immediately so this tab's presence
    // appears to others within ~one network round-trip rather than
    // waiting the heartbeat-timer's first tick.
    this.scheduleHeartbeat()
  }

  async setStatus(status: PresenceStatus): Promise<void> {
    const wasOffline = this.manualStatus === 'offline'

    if (status === 'offline') {
      this.manualStatus = 'offline'
      this.saveStatusPreference('offline')
      // Server-side untrack — broadcasts PresenceLeft immediately so
      // colleagues see "offline" without waiting the 30s evictor.
      void this.fireUntrack()
      this.stopHeartbeat()
      return
    }

    this.manualStatus = status
    this.saveStatusPreference(status)

    if (wasOffline) {
      // Coming back from "Appear Offline": refresh online_at so
      // consumers display "Online just now".
      if (this.currentPayload) {
        this.currentPayload.online_at = new Date().toISOString()
      }
      this.startHeartbeat()
      this.scheduleHeartbeat()
    } else {
      this.scheduleHeartbeat()
    }
  }

  setCustomStatusText(text: string | null): void {
    this.customStatusText = text
    this.saveCustomStatus(text)
    this.scheduleHeartbeat()
  }

  /**
   * Update the user's `current_page` pathname for the next heartbeat.
   *
   * Mirrors `PresenceService.updateCurrentPage()` (Supabase mode) so
   * `usePresenceTracker` can call this method on the active singleton
   * regardless of which backend is wired. Same idempotence + same
   * `TRACK_DEBOUNCE_MS` coalescing through `scheduleHeartbeat()`.
   *
   * The field flows transparently to Rust because the heartbeat
   * handler accepts unknown fields via `#[serde(flatten)]` and the
   * Redis HSET stores the payload as `serde_json::Value`. No Rust
   * release was required for this re-enablement.
   */
  updateCurrentPage(page: string): void {
    if (this.destroyed) return
    if (!this.currentPayload) return
    if (this.currentPayload.current_page === page) return
    this.currentPayload.current_page = page
    this.scheduleHeartbeat()
  }

  /**
   * Update the user's `rf_activity` block for the next heartbeat.
   *
   * Mirrors `PresenceService.updateRfActivity()` (Supabase mode) so
   * the activity hook can call this method on the active singleton
   * regardless of which backend is wired. Same idempotence on
   * `current_step` + `work_task_id` + `work_zone` + `last_scan`,
   * and same deliberate skip-on-`last_input_at`-only change so a
   * typing burst doesn't blow past the `TRACK_DEBOUNCE_MS`
   * coalescer.
   *
   * The field flows transparently to Rust because the heartbeat
   * handler accepts unknown fields via `#[serde(flatten)]` and the
   * Redis HSET stores the payload as `serde_json::Value` (Worker
   * 1's design — see `Implement-Presence-On-Rust-Option-2.md`). No
   * Rust release was required for this addition.
   */
  updateRfActivity(activity: PresenceRfActivity | null): void {
    if (this.destroyed) return
    if (!this.currentPayload) return
    const prev = this.currentPayload.rf_activity ?? null
    if (rfActivityShapeEqual(prev, activity)) {
      if (activity && this.currentPayload.rf_activity) {
        this.currentPayload.rf_activity.last_input_at = activity.last_input_at
      }
      return
    }
    this.currentPayload.rf_activity = activity
    this.scheduleHeartbeat()
  }

  getEffectiveStatus(): PresenceStatus {
    if (this.manualStatus === 'offline') return 'offline'
    if (this.manualStatus) return this.manualStatus
    return this.isIdleState ? 'away' : 'online'
  }

  getManualStatus(): PresenceStatus {
    return this.manualStatus || 'online'
  }

  destroy(): void {
    this.destroyed = true

    if (this.idleDetector) {
      this.idleDetector.stop()
      this.idleDetector = null
    }

    this.stopHeartbeat()

    if (this.syncThrottleTimer) {
      clearTimeout(this.syncThrottleTimer)
      this.syncThrottleTimer = null
    }
    if (this.heartbeatDebounceTimer) {
      clearTimeout(this.heartbeatDebounceTimer)
      this.heartbeatDebounceTimer = null
    }
    if (this.stableConnectionTimer) {
      clearTimeout(this.stableConnectionTimer)
      this.stableConnectionTimer = null
    }

    this.stopVisibilityWatcher()
    this.unsubscribeFromWs()

    // Best-effort untrack — ignore failures; the server-side evictor
    // will sweep the row within 90s anyway.
    if (this.disabledReason === null && this.currentUserId) {
      void this.fireUntrack().catch(() => {
        /* ignore */
      })
    }

    this._isConnected = false
    this.users.clear()
    this.currentPayload = null
    this.disabledReason = null
    this.failureTimestamps = []
    this.circuitTrippedUntil = 0
    this.consecutiveTrips = 0
  }

  // ---- Private methods ------------------------------------------------------

  private async bootstrapSnapshot(): Promise<void> {
    try {
      const headers = await this.authHeaders()
      const res = await fetch(`${WORK_SERVICE_URL}${PRESENCE_ONLINE_PATH}`, {
        method: 'GET',
        headers,
      })
      if (!res.ok) {
        logger.warn(
          `[PresenceRust] Bootstrap snapshot failed: HTTP ${res.status}`
        )
        this.recordFailure()
        return
      }
      const json = (await res.json()) as OnlineSnapshotResponse
      this.users.clear()
      for (const entry of json.users || []) {
        // Skip self — `PresenceService` (Supabase) historically did.
        if (entry.user_id === this.currentUserId) continue
        const payload = entry.payload as PresencePayload | undefined
        if (!payload || !payload.email) continue
        this.users.set(entry.user_id, presencePayloadToUser(payload))
      }
      this.throttledSync()
      this._isConnected = true
      this.onConnectionChange?.(true)
      this.scheduleStableConnectionReset()
    } catch (err) {
      logger.warn('[PresenceRust] Bootstrap snapshot threw:', err)
      this.recordFailure()
    }
  }

  private subscribeToWs(): void {
    if (!this.organizationId) return
    if (this.wsHandler) this.unsubscribeFromWs()

    const handler: WsEventHandler = (event: WsEvent) => {
      if (this.destroyed) return
      // Defence-in-depth: deny-by-default the Rust send loop already
      // filters by org, but if the deserialiser ever drifts we don't
      // want a cross-tenant leak in the FE.
      if (
        event.organization_id &&
        event.organization_id !== this.organizationId
      ) {
        return
      }
      switch (event.type) {
        case 'PresenceJoined':
        case 'PresenceUpdated':
          this.applyPresenceUpsert(event)
          break
        case 'PresenceLeft':
          this.applyPresenceLeft(event)
          break
        default:
          break
      }
    }

    this.wsHandler = handler
    workServiceWs.connect(this.organizationId, handler)

    // Mirror the WS connection state into our local `_isConnected` +
    // breaker. A disconnect is treated as a soft failure for breaker
    // purposes; the WS singleton has its own reconnect storm logic
    // we don't want to fight.
    const wsStateCallback = (state: ConnectionState) => {
      if (this.destroyed) return
      if (state === 'connected') {
        this._isConnected = true
        this.onConnectionChange?.(true)
        this.scheduleStableConnectionReset()
        // Re-snapshot to recover state we may have missed during the
        // disconnect window.
        void this.bootstrapSnapshot()
        // Push a fresh heartbeat so the Rust side reflects this tab.
        this.scheduleHeartbeat()
      } else if (state === 'disconnected' || state === 'unavailable') {
        this._isConnected = false
        this.onConnectionChange?.(
          false,
          state === 'unavailable' ? 'Work service unavailable' : 'Disconnected'
        )
        this.recordFailure()
      } else if (state === 'reconnecting' || state === 'connecting') {
        // Don't flap the connection-banner on every reconnect tick.
        this._isConnected = false
      }
    }
    this.wsStateUnsubscribe = workServiceWs.onStateChange(wsStateCallback)
  }

  private unsubscribeFromWs(): void {
    if (this.wsStateUnsubscribe) {
      this.wsStateUnsubscribe()
      this.wsStateUnsubscribe = null
    }
    if (this.wsHandler) {
      workServiceWs.removeHandler(this.wsHandler)
      this.wsHandler = null
    }
  }

  private applyPresenceUpsert(event: WsEvent): void {
    const userId = event.user_id
    if (!userId) return
    if (userId === this.currentUserId) return
    const raw = event.payload as PresencePayload | undefined
    if (!raw || !raw.email) return
    this.users.set(userId, presencePayloadToUser(raw))
    this.throttledSync()
  }

  private applyPresenceLeft(event: WsEvent): void {
    const userId = event.user_id
    if (!userId) return
    if (this.users.delete(userId)) {
      this.throttledSync()
    }
  }

  private throttledSync(): void {
    if (this.syncThrottleTimer) return
    this.syncThrottleTimer = setTimeout(() => {
      this.syncThrottleTimer = null
      this.handlePresenceSync()
    }, PRESENCE_SYNC_THROTTLE)
  }

  private handlePresenceSync(): void {
    if (this.destroyed) return
    const out: PresenceUser[] = []
    for (const u of this.users.values()) {
      out.push(u)
    }
    this.onPresenceSync?.(out)
  }

  // ---- Heartbeat coalescer + cadence ----------------------------------------

  private scheduleHeartbeat(): void {
    if (this.destroyed) return
    if (this.disabledReason !== null) return
    if (this.manualStatus === 'offline') return
    if (this.heartbeatDebounceTimer) return
    this.heartbeatDebounceTimer = setTimeout(() => {
      this.heartbeatDebounceTimer = null
      void this.flushHeartbeat()
    }, TRACK_DEBOUNCE_MS)
  }

  private async flushHeartbeat(): Promise<void> {
    if (this.destroyed || !this.currentPayload || !this.currentUserId) return
    if (this.disabledReason !== null) return
    if (this.isCircuitTripped()) return

    const effectiveStatus = this.getEffectiveStatus()
    if (effectiveStatus === 'offline') {
      // The local state went offline between schedule + flush. Honour
      // it — fire the untrack instead of a heartbeat.
      void this.fireUntrack()
      return
    }

    this.currentPayload.status = effectiveStatus
    this.currentPayload.custom_status_text = this.customStatusText
    this.currentPayload.last_active_at = new Date().toISOString()

    try {
      const headers = await this.authHeaders(true)
      const res = await fetch(`${WORK_SERVICE_URL}${PRESENCE_HEARTBEAT_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(this.currentPayload),
      })
      if (!res.ok) {
        logger.warn(`[PresenceRust] Heartbeat POST failed: HTTP ${res.status}`)
        this.recordFailure()
      }
    } catch (err) {
      logger.warn('[PresenceRust] Heartbeat POST threw:', err)
      this.recordFailure()
    }
  }

  private startHeartbeat(): void {
    if (this.disabledReason !== null) return
    if (this.manualStatus === 'offline') return
    this.stopHeartbeat()
    const interval = this.currentHeartbeatInterval()
    this.heartbeatTimer = setInterval(() => {
      if (this.destroyed) return
      this.scheduleHeartbeat()
    }, interval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private currentHeartbeatInterval(): number {
    if (typeof document !== 'undefined' && document.hidden) {
      return DB_HEARTBEAT_INTERVAL_HIDDEN
    }
    return DB_HEARTBEAT_INTERVAL
  }

  private startVisibilityWatcher(): void {
    if (typeof document === 'undefined') return
    if (this.disabledReason !== null) return
    this.stopVisibilityWatcher()
    this.boundHandleVisibility = () => {
      if (this.destroyed || !this.heartbeatTimer) return
      this.startHeartbeat()
    }
    document.addEventListener('visibilitychange', this.boundHandleVisibility)
  }

  private stopVisibilityWatcher(): void {
    if (typeof document === 'undefined') return
    if (this.boundHandleVisibility) {
      document.removeEventListener(
        'visibilitychange',
        this.boundHandleVisibility
      )
      this.boundHandleVisibility = null
    }
  }

  private startIdleDetection(): void {
    this.idleDetector = new IdleDetector(
      (isIdle) => {
        this.isIdleState = isIdle
        this.scheduleHeartbeat()
      },
      IDLE_TIMEOUT,
      TAB_HIDDEN_TIMEOUT
    )
    this.idleDetector.start()
  }

  // ---- Untrack --------------------------------------------------------------

  private async fireUntrack(): Promise<void> {
    if (!this.currentUserId) return
    try {
      const headers = await this.authHeaders()
      const res = await fetch(`${WORK_SERVICE_URL}${PRESENCE_UNTRACK_PATH}`, {
        method: 'DELETE',
        headers,
      })
      if (!res.ok) {
        logger.warn(`[PresenceRust] Untrack DELETE failed: HTTP ${res.status}`)
      }
    } catch (err) {
      logger.warn('[PresenceRust] Untrack DELETE threw:', err)
    }
  }

  // ---- Channel-error breaker ------------------------------------------------

  private recordFailure(): void {
    const now = Date.now()
    const cutoff = now - CHANNEL_ERROR_WINDOW_MS
    this.failureTimestamps = this.failureTimestamps.filter((t) => t >= cutoff)
    this.failureTimestamps.push(now)

    if (this.failureTimestamps.length < CHANNEL_ERROR_THRESHOLD) return

    this.consecutiveTrips += 1
    const cooldownMs = Math.min(
      CHANNEL_BREAK_INITIAL_COOLDOWN_MS *
        Math.pow(2, Math.max(0, this.consecutiveTrips - 1)),
      CHANNEL_BREAK_MAX_COOLDOWN_MS
    )
    this.circuitTrippedUntil = now + cooldownMs
    this.failureTimestamps = []

    logger.warn(
      `[PresenceRust] Failure breaker TRIPPED (#${this.consecutiveTrips}). ` +
        `Skipping heartbeats for ${Math.round(cooldownMs / 60_000)}min.`
    )

    setTimeout(() => {
      if (this.destroyed) return
      if (this.disabledReason !== null) return
      logger.log('[PresenceRust] Cooldown elapsed — resuming heartbeats.')
      // Force a fresh snapshot + push a heartbeat.
      void this.bootstrapSnapshot().then(() => this.scheduleHeartbeat())
    }, cooldownMs + 250)
  }

  private isCircuitTripped(): boolean {
    return Date.now() < this.circuitTrippedUntil
  }

  private scheduleStableConnectionReset(): void {
    if (this.stableConnectionTimer) clearTimeout(this.stableConnectionTimer)
    this.stableConnectionTimer = setTimeout(() => {
      if (this.destroyed) return
      if (this.consecutiveTrips > 0) {
        logger.debug(
          '[PresenceRust] Stable connection — resetting circuit breaker trip counter.'
        )
        this.consecutiveTrips = 0
      }
    }, CHANNEL_STABLE_CONNECTION_MS)
  }

  // ---- Auth headers ---------------------------------------------------------

  private async authHeaders(
    includeContentType = false
  ): Promise<Record<string, string>> {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session?.access_token) {
      throw new Error('No active session')
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${session.access_token}`,
    }
    if (this.organizationId) {
      headers['X-Organization-ID'] = this.organizationId
    }
    if (includeContentType) {
      headers['Content-Type'] = 'application/json'
    }
    return headers
  }

  // ---- Status persistence (mirror of `PresenceService`) ---------------------

  private loadStatusPreference(): PresenceStatus | null {
    try {
      const saved = localStorage.getItem(STATUS_PREFERENCE_KEY)
      if (
        saved &&
        ['online', 'away', 'busy', 'do_not_disturb', 'offline'].includes(saved)
      ) {
        return saved as PresenceStatus
      }
    } catch {
      /* ignore */
    }
    return null
  }

  private saveStatusPreference(status: PresenceStatus | null): void {
    try {
      if (status) {
        localStorage.setItem(STATUS_PREFERENCE_KEY, status)
      } else {
        localStorage.removeItem(STATUS_PREFERENCE_KEY)
      }
    } catch {
      /* ignore */
    }
  }

  private loadCustomStatus(): string | null {
    try {
      return localStorage.getItem(CUSTOM_STATUS_KEY)
    } catch {
      /* ignore */
    }
    return null
  }

  private saveCustomStatus(text: string | null): void {
    try {
      if (text) {
        localStorage.setItem(CUSTOM_STATUS_KEY, text)
      } else {
        localStorage.removeItem(CUSTOM_STATUS_KEY)
      }
    } catch {
      /* ignore */
    }
  }
}

// Singleton — sibling of the `presenceService` export from
// `presence.service.ts`. The facade in `index.ts` selects between the
// two at module load.
export const presenceServiceRust = new PresenceServiceRust()

// Created and developed by Jai Singh
