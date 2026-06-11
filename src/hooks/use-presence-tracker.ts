// Created and developed by Jai Singh
/**
 * usePresenceTracker - App-level hook (mount once in AuthenticatedLayout)
 * Initializes the presence service, manages lifecycle, and provides
 * the presence context value.
 *
 * Three opt-out gates feed into `presenceService.initialize()`:
 *
 *   1. `kioskRoute` — RF interfaces, time-clock kiosks, and the
 *      unauthenticated customer-portal landing pages skip the channel.
 *      See `isPresenceKioskRoute()`. Snapshotted at mount so a user
 *      navigating from `/rf-*` into the regular app within the same
 *      provider doesn't keep presence permanently disabled.
 *   2. `presenceCandidate` — users with `presence:hidden` AND no
 *      `presence:view*` permission opt out of being on the channel
 *      entirely (Phase B2, 2026-05-06). Reactive: a permission flip
 *      re-runs the effect with a fresh init/destroy.
 *   3. `VITE_PRESENCE_DISABLED` — build-time fleet kill switch
 *      resolved inside the service.
 *
 * In all opt-out cases the provider stays mounted so consumer hooks
 * (`usePresence`, `usePresenceOptional`) keep returning a stable shape
 * — the SERVICE just no-ops the network work.
 */
import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { useLocation } from '@tanstack/react-router'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
// Import the singleton via the module facade so the env-var-driven
// implementation swap (`VITE_PRESENCE_MODE=rust`) takes effect without
// touching the hook. See `src/lib/presence/index.ts`.
import { isPresenceKioskRoute, presenceService } from '@/lib/presence'
import type {
  PresenceStatus,
  PresenceUser,
  OnlineUsersState,
  PresenceContextType,
} from '@/lib/presence/types'
import { useIsPresenceCandidate } from '@/hooks/use-presence-visibility'

export function usePresenceTracker(): PresenceContextType {
  const { authState } = useUnifiedAuth()
  const { user, profile, isAuthenticated } = authState
  const location = useLocation()

  // State - initialize from service's saved preference so UI is in sync on load
  const [myStatus, setMyStatusState] = useState<PresenceStatus>(() =>
    presenceService.getManualStatus()
  )
  const [customStatusText, setCustomStatusTextState] = useState<string | null>(
    null
  )
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [channelError, setChannelError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const initializedRef = useRef(false)
  const orgIdRef = useRef<string | null>(null)
  // Track the value `presenceCandidate` was initialised with so a
  // permission-store flip (e.g. permissions hydrating from cache after
  // mount) re-runs the effect cleanly instead of staying stuck on the
  // pre-flip decision.
  const candidateRef = useRef<boolean | null>(null)

  // Decide kiosk-route opt-out at the *initial* mount path. Captured
  // once so a user navigating from /rf-* into the regular app within
  // the same provider doesn't keep presence permanently disabled — the
  // route-change effect below handles that case via re-initialise.
  const initialKioskRoute = useMemo(
    () => isPresenceKioskRoute(location.pathname),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // B2: permission-gated subscription. Reactive — a permission-store
  // hydration after initial mount re-runs the init effect (the deps
  // array below includes `presenceCandidate`).
  const presenceCandidate = useIsPresenceCandidate()

  // Initialize presence service when authenticated
  useEffect(() => {
    if (
      !isAuthenticated ||
      !user?.id ||
      !profile?.organization_id ||
      !profile?.email
    ) {
      return
    }

    // Don't re-initialize for same org + same candidate decision.
    if (
      initializedRef.current &&
      orgIdRef.current === profile.organization_id &&
      candidateRef.current === presenceCandidate
    ) {
      return
    }

    initializedRef.current = true
    orgIdRef.current = profile.organization_id
    candidateRef.current = presenceCandidate

    const roleName = profile?.role || null

    presenceService.initialize({
      userId: user.id,
      email: profile.email,
      fullName: profile.full_name,
      firstName: profile.first_name,
      avatarUrl: profile.avatar_url,
      roleName,
      roleId: profile.role_id || null,
      organizationId: profile.organization_id,
      kioskRoute: initialKioskRoute,
      presenceCandidate,
      onPresenceSync: (users) => {
        setPresenceUsers(users)
        setIsLoading(false)
      },
      onConnectionChange: (connected, error) => {
        setIsConnected(connected)
        setChannelError(error || null)
        if (connected) setIsLoading(false)
      },
    })

    // Sync React state with whatever the service loaded from localStorage
    setMyStatusState(presenceService.getManualStatus())

    return () => {
      presenceService.destroy()
      initializedRef.current = false
      orgIdRef.current = null
      candidateRef.current = null
    }
  }, [
    isAuthenticated,
    user?.id,
    profile?.organization_id,
    profile?.email,
    profile?.full_name,
    profile?.first_name,
    profile?.avatar_url,
    profile?.role_id,
    profile?.role,
    initialKioskRoute,
    presenceCandidate,
  ])

  // Track `current_page` updates on every navigation. Re-enabled
  // 2026-05-07 as a SCOPED restoration of the field dropped in Phase
  // B3 — see `ADR-Scoped-CurrentPage-In-ActiveOperators`. The single
  // consumer is `<LiveOperatorStatus>` inside the Inventory Counts
  // tab, which is RBAC-gated by `view inventory_apps`.
  //
  // Coalescing: `presenceService.updateCurrentPage()` writes to the
  // local payload then routes through `scheduleTrack()` /
  // `scheduleHeartbeat()`, both of which debounce on
  // `TRACK_DEBOUNCE_MS` (1500ms). A burst of nav events
  // (`/foo → /foo/bar → /foo/bar/baz` within a few hundred ms)
  // collapses into one broadcast carrying the latest pathname.
  // Idempotence: `updateCurrentPage` no-ops when the value is
  // unchanged, so identical-pathname re-renders stay free.
  //
  // Skipped while the service is disabled (kiosk / env / permission)
  // — the service's own getters short-circuit but we also gate on
  // `initializedRef` to avoid mutating a `currentPayload === null`
  // pre-init state.
  useEffect(() => {
    if (!initializedRef.current) return
    presenceService.updateCurrentPage(location.pathname)
  }, [location.pathname])

  // Set status handler
  const setMyStatus = useCallback((status: PresenceStatus) => {
    setMyStatusState(status)
    presenceService.setStatus(status)
  }, [])

  // Set custom status text handler
  const setCustomStatusText = useCallback((text: string | null) => {
    setCustomStatusTextState(text)
    presenceService.setCustomStatusText(text)
  }, [])

  // Compute grouped users
  const onlineUsersState = useMemo<OnlineUsersState>(() => {
    const onlineUsers = presenceUsers.filter((u) => u.status === 'online')
    const awayUsers = presenceUsers.filter((u) => u.status === 'away')
    const busyUsers = presenceUsers.filter(
      (u) => u.status === 'busy' || u.status === 'do_not_disturb'
    )

    return {
      onlineUsers,
      awayUsers,
      busyUsers,
      allPresent: presenceUsers,
      totalOnline: onlineUsers.length,
      totalAway: awayUsers.length,
      totalBusy: busyUsers.length,
      totalPresent: presenceUsers.length,
      isLoading,
      error: channelError,
    }
  }, [presenceUsers, isLoading, channelError])

  // Single user lookup
  const getUserPresence = useCallback(
    (userId: string): PresenceUser | null => {
      return presenceUsers.find((u) => u.user_id === userId) || null
    },
    [presenceUsers]
  )

  const isUserOnline = useCallback(
    (userId: string): boolean => {
      return presenceUsers.some(
        (u) => u.user_id === userId && u.status !== 'offline'
      )
    },
    [presenceUsers]
  )

  return {
    myStatus,
    setMyStatus,
    setCustomStatusText,
    customStatusText,
    onlineUsersState,
    getUserPresence,
    isUserOnline,
    isConnected,
    channelError,
  }
}

// Created and developed by Jai Singh
