// Created and developed by Jai Singh
/**
 * Entity-Focus Hook — Tier 2 #1 (2026-05-06).
 *
 * Tracks "who is editing this row right now" for soft-locking on
 * DataTables. Built on top of the Option 2 Rust WS singleton — see
 * `memorybank/OmniFrame/Decisions/Roadmap-Rust-WS-Unlocks.md` Tier 2.1.
 *
 * Lifecycle:
 *   1. On mount with non-null `entityId`:
 *      - Bootstrap the focus list via `GET /api/v1/entity-focus/users`.
 *      - POST `/heartbeat` immediately to register this user's lease.
 *      - Schedule a 15s repeat heartbeat (half of the 30s server TTL).
 *      - Subscribe to `WsEvent::EntityFocus` and merge enter / leave
 *        events into local state, filtered by matching
 *        `entity_kind + entity_id` AND `organization_id` (defence in
 *        depth on top of the WS send-loop's deny-by-default filter).
 *   2. On unmount (or `entityId` change to null):
 *      - DELETE `/api/v1/entity-focus` to release the lease early.
 *        Best-effort — failure is fine, the 30s TTL evicts naturally.
 *      - Clear the heartbeat timer + WS handler.
 *   3. On tab-close / pagehide:
 *      - Use `navigator.sendBeacon` for the DELETE so the browser
 *        ships it before tearing down. Authorization isn't carried
 *        on beacons, so the server-side TTL is the authoritative
 *        cleanup — the beacon is only an optimisation.
 *
 * Returns the list of users currently focused on the entity, joined
 * with the existing presence state (`usePresence`) so the UI can
 * show real names + avatars without a second round-trip. Users
 * currently focused but NOT yet in the presence channel (e.g. a tab
 * that connected through a slow link) are surfaced as a stub
 * `PresenceUser` with their user_id; the UI shows "User …abc" until
 * the presence sync catches up.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import type { PresenceUser } from '@/lib/presence/types'
import { logger } from '@/lib/utils/logger'
import {
  listFocusUsers,
  heartbeatFocus,
  untrackFocus,
  type FocusUserPublic,
} from '@/lib/work-service/entity-focus.client'
import type { WsEvent } from '@/lib/work-service/types'
import { workServiceWs } from '@/lib/work-service/websocket'
import { usePresence } from '@/context/presence-context'

/**
 * 15s heartbeat cadence. Half of the server-side 30s TTL — same
 * safety-margin pattern presence uses (60s heartbeat / 90s TTL).
 */
export const ENTITY_FOCUS_HEARTBEAT_MS = 15_000

interface UseEntityFocusOptions {
  /** Entity-class label, e.g. `'ticket'`, `'work_task'`. */
  entityKind: string
  /**
   * Identifier of the focused row. Pass `null | undefined` to disable
   * the hook (e.g. when no row is selected).
   */
  entityId: string | number | null | undefined
  /**
   * When `false`, the hook is a no-op. Defaults to `true`. Useful for
   * tests / kiosk surfaces that should never participate in soft-locking.
   */
  enabled?: boolean
}

interface UseEntityFocusReturn {
  /**
   * Users currently focused on the entity (excluding the calling
   * user — they're who you'd be the indicator FOR, not against).
   * Joined against the active presence state for display name + avatar.
   * Falls back to a stub `PresenceUser` when the user isn't in the
   * presence channel right now.
   */
  focusedUsers: PresenceUser[]
  /** Whether the bootstrap fetch finished and the hook is steady-state. */
  isLoading: boolean
}

/** Build a stub `PresenceUser` when a focused user isn't in the presence channel. */
function fallbackUser(userId: string): PresenceUser {
  const short = userId.slice(0, 6)
  return {
    user_id: userId,
    email: '',
    full_name: null,
    first_name: null,
    avatar_url: null,
    role_name: null,
    role_id: null,
    status: 'online',
    custom_status_text: null,
    device_type: 'desktop',
    // Fallback users (those not in the presence channel) have no
    // navigation context to render. Consumers gate `current_page`
    // rendering on its own non-nullness, so `null` is safe.
    current_page: null,
    online_at: new Date().toISOString(),
    last_active_at: new Date().toISOString(),
    initials: short.slice(0, 2).toUpperCase(),
    display_name: `User ${short}`,
  }
}

export function useEntityFocus(
  options: UseEntityFocusOptions
): UseEntityFocusReturn {
  const { entityKind, entityId, enabled = true } = options

  const { authState } = useUnifiedAuth()
  const userId = authState.user?.id ?? null
  const organizationId = authState.profile?.organization_id ?? null

  const { onlineUsersState } = usePresence()
  const presenceById = useMemo(() => {
    const m = new Map<string, PresenceUser>()
    onlineUsersState.allPresent.forEach((u) => m.set(u.user_id, u))
    return m
  }, [onlineUsersState.allPresent])

  // Local set of user_ids currently focused. We hold raw user_ids
  // so the join with presence is reactive without re-fetching.
  const [focusedUserIds, setFocusedUserIds] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState<boolean>(true)

  // Stable string key for entityId (numbers and strings are both
  // accepted). We never start the hook with `null` / `undefined`.
  const entityIdKey =
    entityId == null
      ? null
      : typeof entityId === 'number'
        ? String(entityId)
        : entityId

  // Refs so the WS handler / heartbeat tick can read current values
  // without re-binding on every render.
  const userIdRef = useRef(userId)
  userIdRef.current = userId
  const orgIdRef = useRef(organizationId)
  orgIdRef.current = organizationId
  const entityKindRef = useRef(entityKind)
  entityKindRef.current = entityKind
  const entityIdRef = useRef(entityIdKey)
  entityIdRef.current = entityIdKey

  // -------------------------------------------------------------
  // Bootstrap + heartbeat + DELETE-on-unmount
  // -------------------------------------------------------------
  useEffect(() => {
    if (!enabled || !entityIdKey || !organizationId || !userId) {
      setFocusedUserIds(new Set())
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)

    const body = { entity_kind: entityKind, entity_id: entityIdKey }

    // Bootstrap snapshot — get the current user list before the WS
    // catches up.
    listFocusUsers(body)
      .then((users: FocusUserPublic[]) => {
        if (cancelled) return
        const ids = new Set<string>()
        users.forEach((u) => {
          if (u.user_id !== userIdRef.current) {
            ids.add(u.user_id)
          }
        })
        setFocusedUserIds(ids)
        setIsLoading(false)
      })
      .catch((err) => {
        logger.warn('[useEntityFocus] bootstrap failed:', err)
        if (!cancelled) setIsLoading(false)
      })

    // Initial heartbeat — register our own lease so other tabs see
    // an `enter` event for this user.
    heartbeatFocus(body).catch((err) => {
      logger.warn('[useEntityFocus] initial heartbeat failed:', err)
    })

    // Repeat heartbeat every 15s. The server TTL is 30s, so missing
    // ONE heartbeat is recoverable; missing two flips the lease to
    // expired and the evictor broadcasts a `leave`.
    const tickHandle = setInterval(() => {
      heartbeatFocus(body).catch((err) => {
        logger.debug('[useEntityFocus] heartbeat tick failed:', err)
      })
    }, ENTITY_FOCUS_HEARTBEAT_MS)

    // Best-effort DELETE on tab close. We register a pagehide listener
    // alongside the regular unmount path so the lease drops as soon
    // as the user navigates away.
    const onPageHide = () => {
      void untrackFocus(body, { useBeacon: true })
    }
    window.addEventListener('pagehide', onPageHide)

    return () => {
      cancelled = true
      clearInterval(tickHandle)
      window.removeEventListener('pagehide', onPageHide)
      // Regular unmount path — fire-and-forget DELETE without a
      // beacon so the Authorization header rides with it. The 30s
      // TTL is the authoritative fallback if this fails.
      untrackFocus(body).catch((err) => {
        logger.debug('[useEntityFocus] untrack on unmount failed:', err)
      })
    }
  }, [enabled, entityKind, entityIdKey, organizationId, userId])

  // -------------------------------------------------------------
  // WS subscription — merge enter / leave events into the local set.
  // -------------------------------------------------------------
  const handleWsEvent = useCallback((event: WsEvent) => {
    if (event.type !== 'EntityFocus') return
    // Defence-in-depth org filter (the Rust send loop already drops
    // cross-org events via the deny-by-default match — we re-check
    // anyway in case a future code path bypasses it).
    if (
      event.organization_id &&
      orgIdRef.current &&
      event.organization_id !== orgIdRef.current
    ) {
      return
    }
    if (
      event.entity_kind !== entityKindRef.current ||
      event.entity_id !== entityIdRef.current
    ) {
      return
    }
    const focusedId = event.user_id
    if (!focusedId) return
    // Exclude ourselves — we're the indicator's audience, not its content.
    if (focusedId === userIdRef.current) return

    setFocusedUserIds((prev) => {
      const next = new Set(prev)
      if (event.action === 'leave') {
        next.delete(focusedId)
      } else {
        // 'enter' or 'heartbeat' — both add the user. Sets are
        // idempotent so a duplicate add is a no-op.
        next.add(focusedId)
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!enabled || !entityIdKey || !organizationId) return
    workServiceWs.connect(organizationId, handleWsEvent)
    return () => {
      workServiceWs.removeHandler(handleWsEvent)
    }
  }, [enabled, entityIdKey, organizationId, handleWsEvent])

  // -------------------------------------------------------------
  // Join focused user_ids against presence state for display.
  // -------------------------------------------------------------
  const focusedUsers = useMemo<PresenceUser[]>(() => {
    return Array.from(focusedUserIds).map(
      (uid) => presenceById.get(uid) ?? fallbackUser(uid)
    )
  }, [focusedUserIds, presenceById])

  return { focusedUsers, isLoading }
}

// Created and developed by Jai Singh
