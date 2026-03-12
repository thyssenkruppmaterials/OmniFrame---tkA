/**
 * Presence Service
 * Core service managing Supabase Presence channel, idle detection,
 * and periodic DB heartbeat for last_seen updates.
 */
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase/client'
import { logger } from '@/lib/utils/logger'
import {
  DB_HEARTBEAT_INTERVAL,
  IDLE_TIMEOUT,
  TAB_HIDDEN_TIMEOUT,
  PRESENCE_CHANNEL_PREFIX,
  PRESENCE_SYNC_THROTTLE,
  STATUS_PREFERENCE_KEY,
  CUSTOM_STATUS_KEY,
} from './constants'
import { IdleDetector } from './idle-detector'
import type { PresencePayload, PresenceStatus, PresenceUser } from './types'

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

export class PresenceService {
  private channel: RealtimeChannel | null = null
  private idleDetector: IdleDetector | null = null
  private dbHeartbeatTimer: ReturnType<typeof setInterval> | null = null
  private syncThrottleTimer: ReturnType<typeof setTimeout> | null = null

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

  /** Whether currently connected to the presence channel */
  get isConnected(): boolean {
    return this._isConnected
  }

  /**
   * Initialize the presence service for a user
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

    // Build initial payload
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
      current_page: window.location.pathname,
      device_type: getDeviceType(),
      online_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
    }

    // 1. Join Supabase Presence channel
    await this.joinChannel()

    // 2. Start idle detection
    this.startIdleDetection()

    // 3. Start DB heartbeat (updates user_profiles.last_seen)
    this.startDbHeartbeat()
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
      await this.untrackPresence()
      return
    }

    // For 'online': set explicitly to 'online' (not null) so it overrides idle detection
    // when the user actively chose "Available"
    this.manualStatus = status
    this.saveStatusPreference(status)

    // If we were previously "Appear Offline", we need to re-track on the channel
    if (wasOffline) {
      await this.retrackPresence()
    } else {
      await this.updatePresence()
    }
  }

  /**
   * Set custom status text ("In a meeting", "Focused work", etc.)
   */
  setCustomStatusText(text: string | null): void {
    this.customStatusText = text
    this.saveCustomStatus(text)
    this.updatePresence()
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
   * Update the current page for context
   */
  updateCurrentPage(page: string): void {
    if (this.currentPayload) {
      this.currentPayload.current_page = page
      // Don't immediately broadcast page changes - batched in next sync
    }
  }

  /**
   * Clean up all resources
   */
  destroy(): void {
    this.destroyed = true

    // Stop idle detector
    if (this.idleDetector) {
      this.idleDetector.stop()
      this.idleDetector = null
    }

    // Stop DB heartbeat
    if (this.dbHeartbeatTimer) {
      clearInterval(this.dbHeartbeatTimer)
      this.dbHeartbeatTimer = null
    }

    // Clear throttle timer
    if (this.syncThrottleTimer) {
      clearTimeout(this.syncThrottleTimer)
      this.syncThrottleTimer = null
    }

    // Leave channel
    if (this.channel) {
      this.channel.untrack()
      supabase.removeChannel(this.channel)
      this.channel = null
    }

    this._isConnected = false
    this.currentPayload = null
  }

  // ---- Private methods ----

  private async joinChannel(): Promise<void> {
    if (this.destroyed || !this.organizationId) return

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

        // Only track if not "appear offline"
        if (this.manualStatus !== 'offline') {
          await this.channel?.track(this.currentPayload!)
        }
      } else if (status === 'CHANNEL_ERROR') {
        this._isConnected = false
        this.onConnectionChange?.(false, 'Channel error - will retry')
      } else if (status === 'TIMED_OUT') {
        this._isConnected = false
        this.onConnectionChange?.(false, 'Connection timed out - will retry')
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

  private async updatePresence(): Promise<void> {
    if (!this.channel || !this.currentPayload || this.destroyed) return

    const effectiveStatus = this.getEffectiveStatus()

    if (effectiveStatus === 'offline') {
      await this.untrackPresence()
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

  private async untrackPresence(): Promise<void> {
    if (!this.channel || this.destroyed) return
    try {
      await this.channel.untrack()
    } catch (err) {
      logger.warn('[Presence] Failed to untrack:', err)
    }
  }

  /**
   * Re-track after being untracked (e.g. coming back from "Appear Offline").
   * Rebuilds the payload and calls track() to rejoin the presence state.
   */
  private async retrackPresence(): Promise<void> {
    if (!this.channel || !this.currentPayload || this.destroyed) return

    const effectiveStatus = this.getEffectiveStatus()
    this.currentPayload.status = effectiveStatus
    this.currentPayload.custom_status_text = this.customStatusText
    this.currentPayload.last_active_at = new Date().toISOString()
    this.currentPayload.online_at = new Date().toISOString() // reset online_at since they're "coming back"

    try {
      await this.channel.track(this.currentPayload)
    } catch (err) {
      logger.warn('[Presence] Failed to re-track after offline:', err)
    }
  }

  private startIdleDetection(): void {
    this.idleDetector = new IdleDetector(
      (isIdle) => {
        this.isIdleState = isIdle
        this.updatePresence()
      },
      IDLE_TIMEOUT,
      TAB_HIDDEN_TIMEOUT
    )
    this.idleDetector.start()
  }

  private startDbHeartbeat(): void {
    // Update last_seen immediately
    this.updateLastSeen()

    // Then periodically
    this.dbHeartbeatTimer = setInterval(() => {
      if (!this.destroyed) {
        this.updateLastSeen()
      }
    }, DB_HEARTBEAT_INTERVAL)
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
// Developer and Creator: Jai Singh
