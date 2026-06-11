// Created and developed by Jai Singh
/**
 * Notifications Hook — Tier 2 #2 (2026-05-06).
 *
 * Bell-icon backing data. Bootstraps from
 * `GET /api/v1/notifications`, then subscribes to
 * `WsEvent::Notification` filtered by `event.user_id === currentUserId`.
 * On a new event the hook prepends to the local feed and bumps
 * `unreadCount`.
 *
 * Works on top of the Option 2 Rust WS singleton — see
 * `Roadmap-Rust-WS-Unlocks.md` Tier 2.2 and the matching
 * Implementation note `Implement-Notifications-Panel-Tier2-2.md`.
 *
 * The hook deliberately does NOT use TanStack Query so the in-memory
 * feed stays the single source of truth — no risk of a refetch
 * clobbering an optimistic mark-read. The bootstrap is one HTTP
 * call on mount + a 5-min safety-net refetch when the WS isn't
 * connected (mirrors the `use-pushed-work` shape).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { logger } from '@/lib/utils/logger'
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from '@/lib/work-service/notifications.client'
import type { WsEvent } from '@/lib/work-service/types'
import { workServiceWs } from '@/lib/work-service/websocket'

/** 5-min safety-net refetch when the WS isn't connected. */
const NOTIFICATIONS_SAFETY_NET_MS = 5 * 60_000

/** Default bootstrap limit — covers a typical bell-popover view. */
const NOTIFICATIONS_BOOTSTRAP_LIMIT = 50

interface UseNotificationsReturn {
  notifications: NotificationRow[]
  unreadCount: number
  /** Bootstrap fetch in flight. */
  isLoading: boolean
  /** Optimistically mark a single notification as read. */
  markRead: (id: string) => void
  /** Optimistically mark all unread notifications as read. */
  markAllRead: () => void
  /** Force a fresh bootstrap fetch (e.g. on manual refresh). */
  refresh: () => Promise<void>
}

/**
 * Convert a WsEvent into a `NotificationRow` so the WS-pushed event
 * can be prepended to the local feed without a round-trip.
 */
function eventToRow(event: WsEvent): NotificationRow | null {
  if (event.type !== 'Notification') return null
  if (!event.notification_id || !event.user_id || !event.organization_id) {
    return null
  }
  return {
    id: event.notification_id,
    user_id: event.user_id,
    organization_id: event.organization_id,
    severity: event.severity ?? 'info',
    kind: event.kind ?? null,
    title: event.title ?? '',
    body: event.body ?? null,
    link: event.link ?? null,
    read: false,
    read_at: null,
    created_at: new Date().toISOString(),
  }
}

export function useNotifications(): UseNotificationsReturn {
  const { authState } = useUnifiedAuth()
  const userId = authState.user?.id ?? null
  const organizationId = authState.profile?.organization_id ?? null

  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [unreadCount, setUnreadCount] = useState<number>(0)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [wsConnected, setWsConnected] = useState<boolean>(false)

  const userIdRef = useRef(userId)
  userIdRef.current = userId
  const orgIdRef = useRef(organizationId)
  orgIdRef.current = organizationId

  const refresh = useCallback(async () => {
    if (!organizationId || !userId) return
    setIsLoading(true)
    try {
      const res = await listNotifications({
        unreadOnly: false,
        limit: NOTIFICATIONS_BOOTSTRAP_LIMIT,
      })
      setNotifications(res.notifications)
      setUnreadCount(res.unread_count)
    } catch (err) {
      // 2026-05-10 — downgraded from `warn` to `debug`. The most common
      // bootstrap failure modes (404 = route not yet deployed; 5xx =
      // transient regional outage) are absorbed by the client and
      // never reach this catch — the surviving cases are 401 (token
      // refresh in flight; harmless) and network blips (resolved by
      // the 5-min safety-net refetch). None warrant a console.warn
      // that the user sees on every page load while the auth layer
      // is mid-handshake.
      logger.debug('[useNotifications] bootstrap deferred:', err)
    } finally {
      setIsLoading(false)
    }
  }, [organizationId, userId])

  // ----- Bootstrap on mount + 5-min safety-net while WS disconnected ----- //
  useEffect(() => {
    if (!organizationId || !userId) return
    void refresh()
  }, [organizationId, userId, refresh])

  useEffect(() => {
    if (wsConnected || !organizationId || !userId) return
    const handle = setInterval(() => {
      void refresh()
    }, NOTIFICATIONS_SAFETY_NET_MS)
    return () => clearInterval(handle)
  }, [wsConnected, organizationId, userId, refresh])

  // ----- WS subscription — prepend on new event ----- //
  const handleWsEvent = useCallback((event: WsEvent) => {
    if (event.type !== 'Notification') return
    // Per-user filter (defence-in-depth on top of org-scope).
    if (!event.user_id || event.user_id !== userIdRef.current) return
    // Org filter — paranoia.
    if (
      event.organization_id &&
      orgIdRef.current &&
      event.organization_id !== orgIdRef.current
    ) {
      return
    }
    const row = eventToRow(event)
    if (!row) return
    setNotifications((prev) => {
      // Avoid duplicates if a refresh and a WS event race.
      if (prev.some((n) => n.id === row.id)) return prev
      return [row, ...prev]
    })
    setUnreadCount((c) => c + 1)
  }, [])

  useEffect(() => {
    if (!organizationId) return
    workServiceWs.connect(organizationId, handleWsEvent)
    const unsubscribe = workServiceWs.onStateChange((state) => {
      setWsConnected(state === 'connected')
    })
    setWsConnected(workServiceWs.isConnected())
    return () => {
      workServiceWs.removeHandler(handleWsEvent)
      unsubscribe()
    }
  }, [organizationId, handleWsEvent])

  // ----- Optimistic mutations ----- //
  const markRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const next = prev.map((n) =>
        n.id === id && !n.read
          ? { ...n, read: true, read_at: new Date().toISOString() }
          : n
      )
      // Decrement unread count only if we actually flipped a row.
      const flipped = prev.find((n) => n.id === id && !n.read)
      if (flipped) {
        setUnreadCount((c) => Math.max(0, c - 1))
      }
      return next
    })
    markNotificationRead(id).catch((err) => {
      logger.warn('[useNotifications] mark-read server call failed:', err)
      // We don't roll back the optimistic update — the next refresh
      // will re-sync if the server disagreed.
    })
  }, [])

  const markAllRead = useCallback(() => {
    setNotifications((prev) =>
      prev.map((n) =>
        n.read ? n : { ...n, read: true, read_at: new Date().toISOString() }
      )
    )
    setUnreadCount(0)
    markAllNotificationsRead().catch((err) => {
      logger.warn('[useNotifications] mark-all-read failed:', err)
    })
  }, [])

  return {
    notifications,
    unreadCount,
    isLoading,
    markRead,
    markAllRead,
    refresh,
  }
}

// Created and developed by Jai Singh
