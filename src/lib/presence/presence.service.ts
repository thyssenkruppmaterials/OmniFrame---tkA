// Created and developed by Jai Singh
/**
 * Presence Service
 * Core service managing the org-wide Supabase Presence channel, idle
 * detection, and the periodic DB heartbeat for `user_profiles.last_seen`.
 *
 * Hardened against tenant-side Realtime overload (see
 * `Debug/Fix-Realtime-Tenant-Overload.md` and follow-up
 * `Debug/Fix-CustomerPortal-Presence-Tenant-Overload.md`):
 *
 *   1. `scheduleTrack()` debouncer/coalescer — at most one
 *      `channel.track()` RPC per `TRACK_DEBOUNCE_MS` window. Reconnect
 *      storms, idle flapping, and rapid status changes all collapse
 *      into a single track call instead of hammering the shard.
 *   2. Channel-error circuit breaker — counts CHANNEL_ERROR / TIMED_OUT
 *      events; trips after `CHANNEL_ERROR_THRESHOLD` in
 *      `CHANNEL_ERROR_WINDOW_MS`; cooldown grows exponentially up to
 *      `CHANNEL_BREAK_MAX_COOLDOWN_MS`. Connection that survives
 *      `CHANNEL_STABLE_CONNECTION_MS` clears the trip ladder.
 *   3. Visibility-aware DB heartbeat — switches between
 *      `DB_HEARTBEAT_INTERVAL` (foreground) and
 *      `DB_HEARTBEAT_INTERVAL_HIDDEN` (tab hidden) live, and stops
 *      entirely when the user picks "Appear Offline".
 *   4. `VITE_PRESENCE_DISABLED` kill switch + `kioskRoute` opt-out +
 *      `presenceCandidate: false` permission opt-out — all checked in
 *      `initialize()` (in that resolution order); service goes
 *      straight to polling-only mode (no channel, no track, no
 *      heartbeat). The permission opt-out (Phase B2) keeps users with
 *      `presence:hidden` AND no `presence:view*` off the channel
 *      entirely so they stop consuming a Realtime worker slot per tab.
 */
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
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
  PRESENCE_CHANNEL_PREFIX,
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
 * Equality check for the "shape" of `PresenceRfActivity`. Returns
 * true when two values are equivalent for broadcast purposes —
 * i.e. nothing a supervisor would notice has changed. Deliberately
 * ignores `last_input_at` (typing-rate field; would defeat the
 * `TRACK_DEBOUNCE_MS` coalescer if it triggered re-broadcasts).
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

/**
 * Reasons the service may decline to join the Realtime channel.
 *
 * - `env`        — `VITE_PRESENCE_DISABLED=true` at build time. Fleet-wide
 *                  bleed-off; mirrors the agent's `OMNIFRAME_DISABLE_REALTIME`.
 * - `kiosk`      — RF terminal / time-clock / unauth customer-portal route.
 *                  Snapshotted at provider mount.
 * - `permission` — User has no `presence:view*` permission AND has the
 *                  opt-out `presence:hidden` permission. They neither see
 *                  others nor want to be seen, so we skip the channel
 *                  entirely (saves a Realtime worker slot + `.track()` RPC).
 *                  See Phase B2 in `Implementations/Harden-Presence-Service-Tenant-Overload.md`.
 *
 * Resolution order in `initialize()` is `env` → `kiosk` → `permission`.
 * A kiosk route always wins over a permission opt-out so logs and
 * connection-banner reasons stay accurate (a kiosk-mounted user is
 * disabled-by-route, not disabled-by-policy).
 */
type DisabledReason = 'env' | 'kiosk' | 'permission' | null

export class PresenceService {
  private channel: RealtimeChannel | null = null
  private idleDetector: IdleDetector | null = null
  private dbHeartbeatTimer: ReturnType<typeof setInterval> | null = null
  private syncThrottleTimer: ReturnType<typeof setTimeout> | null = null

  // Track-coalescer state — see `scheduleTrack()`.
  private trackDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private pendingTrackUntrack = false

  // Channel-error circuit-breaker state.
  private channelErrorTimestamps: number[] = []
  private circuitTrippedUntil = 0
  private consecutiveTrips = 0
  private stableConnectionTimer: ReturnType<typeof setTimeout> | null = null

  // Visibility-aware heartbeat
  private boundHandleVisibility: (() => void) | null = null

  private currentUserId: string | null = null
  private organizationId: string | null = null
  private currentPayload: PresencePayload | null = null

  // Manual status override (user-set status like "busy", "dnd")
  private manualStatus: PresenceStatus | null = null
  private customStatusText: string | null = null
  private isIdleState = false

  // Callbacks
  private onPresenceSync: PresenceEventCallback | null = null
  private onConnectionChange: ConnectionCallback | null = null

  // State
  private _isConnected = false
  private destroyed = false
  private disabledReason: DisabledReason = null

  /** Whether currently connected to the presence channel */
  get isConnected(): boolean {
    return this._isConnected
  }

  /** True if presence is intentionally disabled for this session. */
  get isDisabled(): boolean {
    return this.disabledReason !== null
  }

  /** Human-readable reason the service is disabled, or `null`. */
  get disabledReasonValue(): DisabledReason {
    return this.disabledReason
  }

  /**
   * Initialize the presence service for a user.
   *
   * If any of the following are true, the service stores the user
   * identity (so callers like the SAP testing tabs can still ask "who
   * am I") but skips the channel join and the DB heartbeat — no
   * Realtime traffic is generated:
   *
   *   - `VITE_PRESENCE_DISABLED` env var is set (`disabledReason='env'`).
   *   - `config.kioskRoute === true` (`disabledReason='kiosk'`).
   *   - `config.presenceCandidate === false` (`disabledReason='permission'`).
   *
   * Resolution order is `env` → `kiosk` → `permission`. The kiosk
   * branch wins over the permission branch deliberately: a `/rf-*`
   * route should report itself as disabled-by-route, not disabled-by-
   * policy, so log lines + the connection-state banner reflect WHY the
   * service is offline accurately.
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
    /**
     * `false` means: this user has no `presence:view*` permission AND
     * has the `presence:hidden` opt-out permission, so they neither
     * need to see others nor need to be seen. Skip the channel + the
     * heartbeat. Default `true` preserves behaviour for orgs that
     * don't define `presence:hidden` (every user stays visible to
     * colleagues with view permission, as before Phase B2).
     */
    presenceCandidate?: boolean
    onPresenceSync: PresenceEventCallback
    onConnectionChange: ConnectionCallback
  }): Promise<void> {
    // Clean up any previous state
    this.destroy()
    this.destroyed = false

    this.currentUserId = config.userId
    this.organizationId = config.organizationId
    this.onPresenceSync = config.onPresenceSync
    this.onConnectionChange = config.onConnectionChange

    // Restore saved status preference
    this.manualStatus = this.loadStatusPreference()
    this.customStatusText = this.loadCustomStatus()

    // Build initial payload — kept even when disabled so other consumers
    // that read `currentPayload`/`getEffectiveStatus()` keep working.
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
      // Seed with the boot-time pathname so the first heartbeat already
      // carries it. `usePresenceTracker` keeps it fresh thereafter via
      // `updateCurrentPage()` on every navigation. Falls back to `null`
      // in non-browser test environments.
      current_page:
        typeof window !== 'undefined' && window.location
          ? window.location.pathname
          : null,
      // RF activity telemetry — `null` until the RF activity hook
      // calls `updateRfActivity(...)`. Non-RF tabs never set this
      // field so it stays `null` for the lifetime of the session.
      rf_activity: null,
      online_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
    }

    // Resolve kill switches before doing any Realtime work. Order:
    // env → kiosk → permission (so a kiosk-mounted user with no view
    // permission still reports `disabledReason='kiosk'`, not 'permission').
    if (PRESENCE_DISABLED_ENV) {
      this.disabledReason = 'env'
      logger.log(
        '[Presence] Disabled via VITE_PRESENCE_DISABLED — skipping channel join + DB heartbeat.'
      )
      this.onConnectionChange?.(false, 'Disabled via env var')
      return
    }
    if (config.kioskRoute) {
      this.disabledReason = 'kiosk'
      logger.log(
        '[Presence] Skipped on kiosk/RF route — no channel join, no heartbeat.'
      )
      this.onConnectionChange?.(false, 'Disabled on kiosk route')
      return
    }
    if (config.presenceCandidate === false) {
      this.disabledReason = 'permission'
      logger.log(
        '[Presence] Skipped — user has presence:hidden and no presence:view* permission. No channel join, no heartbeat.'
      )
      this.onConnectionChange?.(false, 'Disabled by permission policy')
      return
    }
    this.disabledReason = null

    await this.joinChannel()
    this.startIdleDetection()
    this.startDbHeartbeat()
    this.startVisibilityWatcher()
  }

  /**
   * Update the user's manual status
   */
  async setStatus(status: PresenceStatus): Promise<void> {
    const wasOffline = this.manualStatus === 'offline'

    if (status === 'offline') {
      // "Appear Offline" - untrack from channel
      this.manualStatus = 'offline'
      this.saveStatusPreference('offline')
      this.scheduleUntrack()
      // Stop the DB heartbeat — they're "offline", writing last_seen
      // would lie and burn a connection.
      this.stopDbHeartbeat()
      return
    }

    // For 'online': set explicitly to 'online' (not null) so it overrides idle detection
    // when the user actively chose "Available"
    this.manualStatus = status
    this.saveStatusPreference(status)

    // If we were previously "Appear Offline", we need to re-track on the channel
    if (wasOffline) {
      // Restart the heartbeat — we're back on the grid.
      this.startDbHeartbeat()
      this.scheduleRetrack()
    } else {
      this.scheduleTrack()
    }
  }

  /**
   * Set custom status text ("In a meeting", "Focused work", etc.)
   */
  setCustomStatusText(text: string | null): void {
    this.customStatusText = text
    this.saveCustomStatus(text)
    this.scheduleTrack()
  }

  /**
   * Update the user's `current_page` pathname for the next broadcast.
   *
   * Re-introduced 2026-05-07 as a scoped re-enablement of the field
   * dropped in Phase B3. Today's only consumer surface is the
   * `<LiveOperatorStatus>` panel inside the Inventory Counts tab —
   * which is RBAC-gated by `view inventory_apps`. See
   * `memorybank/OmniFrame/Decisions/ADR-Scoped-CurrentPage-In-ActiveOperators.md`
   * before adding a second renderer; the field is intentionally not
   * exposed on the org-wide `<OnlineUsersPanel>` / `<StatusSelector>` /
   * `<PresenceAvatar>` surfaces.
   *
   * Idempotent: a no-op if the value matches what's already in the
   * payload (e.g. a sub-route navigation that resolves to the same
   * pathname). Otherwise routes through `scheduleTrack()` so a burst
   * of navigations within `TRACK_DEBOUNCE_MS` (1500ms) collapses into
   * a single broadcast — same coalescer as every other payload mutation.
   */
  updateCurrentPage(page: string): void {
    if (this.destroyed) return
    if (!this.currentPayload) return
    if (this.currentPayload.current_page === page) return
    this.currentPayload.current_page = page
    this.scheduleTrack()
  }

  /**
   * Update the user's `rf_activity` block for the next broadcast.
   *
   * Added 2026-05-07 alongside `updateCurrentPage` as part of the
   * granular RF telemetry sprint — see
   * `memorybank/OmniFrame/Decisions/ADR-RF-Activity-Telemetry.md`.
   * The single consumer surface today is `<LiveOperatorStatus>`
   * inside the Inventory Counts tab; do not surface this field
   * elsewhere without filing a follow-on ADR.
   *
   * Idempotent on the "shape" fields (`current_step`,
   * `work_task_id`, `work_zone`, `last_scan.value` /
   * `last_scan.type`) — those are the inputs that justify a fresh
   * broadcast. `last_input_at` deliberately does NOT trigger a
   * re-broadcast on every change because the activity hook updates
   * it on every keystroke; otherwise a typing burst would defeat
   * the `TRACK_DEBOUNCE_MS` coalescer. The value still rides every
   * heartbeat that DOES go out, so the panel's idle/live indicator
   * still gets current data within the debounce window.
   *
   * Pass `null` to clear (workflow exit, task complete, RF screen
   * change to a non-workflow surface). Clearing IS a shape change
   * and triggers a broadcast.
   */
  updateRfActivity(activity: PresenceRfActivity | null): void {
    if (this.destroyed) return
    if (!this.currentPayload) return
    const prev = this.currentPayload.rf_activity ?? null
    if (rfActivityShapeEqual(prev, activity)) {
      // Shape unchanged. Update last_input_at in place so the next
      // heartbeat (whatever triggers it) carries the freshest stamp,
      // but skip the broadcast.
      if (activity && this.currentPayload.rf_activity) {
        this.currentPayload.rf_activity.last_input_at = activity.last_input_at
      }
      return
    }
    this.currentPayload.rf_activity = activity
    this.scheduleTrack()
  }

  /**
   * Get the current effective status
   */
  getEffectiveStatus(): PresenceStatus {
    // Manual override takes priority
    if (this.manualStatus === 'offline') return 'offline'

    // If user explicitly set a status (busy, dnd, away, or even online), honor it
    if (this.manualStatus) return this.manualStatus

    // No manual status (null) = auto-detect: idle -> away, otherwise online
    return this.isIdleState ? 'away' : 'online'
  }

  /**
   * Get the current manual status (for syncing React state on init)
   */
  getManualStatus(): PresenceStatus {
    return this.manualStatus || 'online'
  }

  /**
   * Clean up all resources
   */
  destroy(): void {
    this.destroyed = true

    if (this.idleDetector) {
      this.idleDetector.stop()
      this.idleDetector = null
    }

    this.stopDbHeartbeat()

    if (this.syncThrottleTimer) {
      clearTimeout(this.syncThrottleTimer)
      this.syncThrottleTimer = null
    }

    if (this.trackDebounceTimer) {
      clearTimeout(this.trackDebounceTimer)
      this.trackDebounceTimer = null
    }
    this.pendingTrackUntrack = false

    if (this.stableConnectionTimer) {
      clearTimeout(this.stableConnectionTimer)
      this.stableConnectionTimer = null
    }

    this.stopVisibilityWatcher()

    if (this.channel) {
      // Best-effort untrack — fire-and-forget, the channel removal
      // below will tear it down regardless.
      try {
        void this.channel.untrack()
      } catch {
        /* ignore */
      }
      supabase.removeChannel(this.channel)
      this.channel = null
    }

    this._isConnected = false
    this.currentPayload = null
    this.disabledReason = null
    this.channelErrorTimestamps = []
    this.circuitTrippedUntil = 0
    this.consecutiveTrips = 0
  }

  // ---- Private methods ----

  private async joinChannel(): Promise<void> {
    if (this.destroyed || !this.organizationId) return

    // Respect the circuit breaker — if we tripped, don't even try to
    // open a new channel until the cooldown expires.
    if (this.isCircuitTripped()) {
      const remainingMs = this.circuitTrippedUntil - Date.now()
      logger.warn(
        `[Presence] Circuit tripped — skipping channel join for ${Math.round(remainingMs / 1000)}s`
      )
      return
    }

    const channelName = `${PRESENCE_CHANNEL_PREFIX}-${this.organizationId}`

    this.channel = supabase.channel(channelName, {
      config: { presence: { key: this.currentUserId! } },
    })

    // Presence sync - fires whenever the full state updates
    this.channel.on('presence', { event: 'sync' }, () => {
      if (this.destroyed) return
      this.throttledSync()
    })

    // Subscribe and track
    this.channel.subscribe(async (status) => {
      if (this.destroyed) return

      if (status === 'SUBSCRIBED') {
        this._isConnected = true
        this.onConnectionChange?.(true)

        // Schedule the stable-connection timer; if we stay subscribed
        // for `CHANNEL_STABLE_CONNECTION_MS` without a CHANNEL_ERROR /
        // TIMED_OUT, the consecutive_trips counter resets to 0.
        if (this.stableConnectionTimer) {
          clearTimeout(this.stableConnectionTimer)
        }
        this.stableConnectionTimer = setTimeout(() => {
          if (this.destroyed) return
          if (this.consecutiveTrips > 0) {
            logger.debug(
              '[Presence] Stable connection — resetting circuit breaker trip counter.'
            )
            this.consecutiveTrips = 0
          }
        }, CHANNEL_STABLE_CONNECTION_MS)

        // Only track if not "appear offline". Coalesced — back-to-back
        // SUBSCRIBED events (reconnect storms) collapse into one RPC.
        if (this.manualStatus !== 'offline') {
          this.scheduleTrack()
        }
      } else if (status === 'CHANNEL_ERROR') {
        this._isConnected = false
        this.onConnectionChange?.(false, 'Channel error - will retry')
        this.recordChannelError()
      } else if (status === 'TIMED_OUT') {
        this._isConnected = false
        this.onConnectionChange?.(false, 'Connection timed out - will retry')
        this.recordChannelError()
      }
    })
  }

  private throttledSync(): void {
    if (this.syncThrottleTimer) return

    this.syncThrottleTimer = setTimeout(() => {
      this.syncThrottleTimer = null
      this.handlePresenceSync()
    }, PRESENCE_SYNC_THROTTLE)
  }

  private handlePresenceSync(): void {
    if (!this.channel || this.destroyed) return

    const state = this.channel.presenceState<PresencePayload>()
    const users: PresenceUser[] = []

    for (const key in state) {
      const presences = state[key]
      if (presences && presences.length > 0) {
        // Take the most recent presence for each user
        const latest = presences[presences.length - 1]
        // Don't include ourselves in the list
        if (latest.user_id !== this.currentUserId) {
          users.push(presencePayloadToUser(latest))
        }
      }
    }

    this.onPresenceSync?.(users)
  }

  // ---- Track coalescer ------------------------------------------------------
  //
  // Why: every `channel.track()` is an RPC to the org's Realtime worker.
  // Without coalescing, a status flip + custom-text edit + an idle
  // re-entry within the same second → 3 RPCs. On a reconnect storm
  // (network blip, JWT refresh) supabase-js fires SUBSCRIBED repeatedly
  // and the old code fired one track per SUBSCRIBED. The debouncer
  // collapses all of these into one RPC per `TRACK_DEBOUNCE_MS` window
  // and always sends the LATEST payload.

  private scheduleTrack(): void {
    if (this.destroyed) return
    this.pendingTrackUntrack = false
    if (this.trackDebounceTimer) return
    this.trackDebounceTimer = setTimeout(() => {
      this.trackDebounceTimer = null
      void this.flushTrack()
    }, TRACK_DEBOUNCE_MS)
  }

  private scheduleUntrack(): void {
    if (this.destroyed) return
    this.pendingTrackUntrack = true
    if (this.trackDebounceTimer) return
    this.trackDebounceTimer = setTimeout(() => {
      this.trackDebounceTimer = null
      void this.flushTrack()
    }, TRACK_DEBOUNCE_MS)
  }

  /**
   * Re-track after being untracked (e.g. coming back from "Appear
   * Offline"). Refreshes `online_at` so consumers re-display "Online
   * just now". Also coalesced through the debouncer.
   */
  private scheduleRetrack(): void {
    if (this.currentPayload) {
      this.currentPayload.online_at = new Date().toISOString()
    }
    this.scheduleTrack()
  }

  private async flushTrack(): Promise<void> {
    if (this.destroyed || !this.channel || !this.currentPayload) return

    if (this.pendingTrackUntrack) {
      try {
        await this.channel.untrack()
      } catch (err) {
        logger.warn('[Presence] Failed to untrack:', err)
      }
      return
    }

    const effectiveStatus = this.getEffectiveStatus()
    if (effectiveStatus === 'offline') {
      // The local state went offline between the schedule and the flush.
      // Honour it — fire untrack instead.
      try {
        await this.channel.untrack()
      } catch (err) {
        logger.warn('[Presence] Failed to untrack:', err)
      }
      return
    }

    this.currentPayload.status = effectiveStatus
    this.currentPayload.custom_status_text = this.customStatusText
    this.currentPayload.last_active_at = new Date().toISOString()

    try {
      await this.channel.track(this.currentPayload)
    } catch (err) {
      logger.warn('[Presence] Failed to update presence:', err)
    }
  }

  // ---- Channel-error circuit breaker ----------------------------------------

  private recordChannelError(): void {
    const now = Date.now()
    const cutoff = now - CHANNEL_ERROR_WINDOW_MS
    this.channelErrorTimestamps = this.channelErrorTimestamps.filter(
      (t) => t >= cutoff
    )
    this.channelErrorTimestamps.push(now)

    if (this.channelErrorTimestamps.length < CHANNEL_ERROR_THRESHOLD) return

    // Trip — exponential cooldown ladder: 5min, 10min, 20min, capped
    // at `CHANNEL_BREAK_MAX_COOLDOWN_MS`.
    this.consecutiveTrips += 1
    const cooldownMs = Math.min(
      CHANNEL_BREAK_INITIAL_COOLDOWN_MS *
        Math.pow(2, Math.max(0, this.consecutiveTrips - 1)),
      CHANNEL_BREAK_MAX_COOLDOWN_MS
    )
    this.circuitTrippedUntil = now + cooldownMs
    this.channelErrorTimestamps = []

    logger.warn(
      `[Presence] Channel error breaker TRIPPED (#${this.consecutiveTrips}). ` +
        `Removing channel; cooldown ${Math.round(cooldownMs / 60_000)}min.`
    )

    // Tear down the channel so we stop hammering the wedged shard. The
    // service stays "alive" — the next status change / page navigation
    // that calls `joinChannel()` after the cooldown will re-establish.
    if (this.channel) {
      try {
        void this.channel.untrack()
      } catch {
        /* ignore */
      }
      try {
        supabase.removeChannel(this.channel)
      } catch {
        /* ignore */
      }
      this.channel = null
      this._isConnected = false
    }

    // Schedule an automatic re-join attempt after the cooldown.
    setTimeout(
      () => {
        if (this.destroyed) return
        if (this.disabledReason !== null) return
        logger.log('[Presence] Cooldown elapsed — attempting channel re-join.')
        void this.joinChannel()
      },
      cooldownMs + 250 // small jitter so multiple tabs don't sync up
    )
  }

  private isCircuitTripped(): boolean {
    return Date.now() < this.circuitTrippedUntil
  }

  // ---- Idle detection -------------------------------------------------------

  private startIdleDetection(): void {
    this.idleDetector = new IdleDetector(
      (isIdle) => {
        this.isIdleState = isIdle
        this.scheduleTrack()
      },
      IDLE_TIMEOUT,
      TAB_HIDDEN_TIMEOUT
    )
    this.idleDetector.start()
  }

  // ---- DB heartbeat ---------------------------------------------------------

  private startDbHeartbeat(): void {
    if (this.disabledReason !== null) return
    if (this.manualStatus === 'offline') return

    this.stopDbHeartbeat()

    // Update last_seen immediately when we (re)start.
    void this.updateLastSeen()

    const interval = this.currentHeartbeatInterval()
    this.dbHeartbeatTimer = setInterval(() => {
      if (this.destroyed) return
      void this.updateLastSeen()
    }, interval)
  }

  private stopDbHeartbeat(): void {
    if (this.dbHeartbeatTimer) {
      clearInterval(this.dbHeartbeatTimer)
      this.dbHeartbeatTimer = null
    }
  }

  /** Pick the heartbeat cadence based on current visibility. */
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
      if (this.destroyed || !this.dbHeartbeatTimer) return
      // Tear the timer down and rebuild at the new cadence.
      this.startDbHeartbeat()
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

  private async updateLastSeen(): Promise<void> {
    if (!this.currentUserId || this.destroyed) return

    try {
      await supabase
        .from('user_profiles')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', this.currentUserId)
    } catch (err) {
      // Silent fail - non-critical
      logger.debug('[Presence] Failed to update last_seen:', err)
    }
  }

  // ---- Status persistence ---------------------------------------------------

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

// Singleton instance
export const presenceService = new PresenceService()

// Created and developed by Jai Singh
