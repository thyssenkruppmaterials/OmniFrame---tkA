// Created and developed by Jai Singh
/**
 * usePresenceVisibility — Strictly permission-based presence visibility
 *
 * Determines what level of presence information the current user can see
 * based EXCLUSIVELY on assigned permissions. No role-name fallbacks.
 *
 * Permission mapping (`role_permissions` rows; literal strings, see also
 * `@/lib/presence/constants`):
 *
 * - `presence:view_details` → full visibility (users + custom status + any
 *   future detail fields). Treated as a strict superset of `presence:view`.
 * - `presence:view`         → basic visibility (users + status). Identical
 *   payload to `view_details` since `current_page` was dropped from the
 *   broadcast in Phase B3 (2026-05-06) — kept as a separate level so
 *   future detail fields can be re-introduced without another permission
 *   migration.
 * - Neither permission      → completely hidden (no panel, no badge,
 *   nothing).
 * - `presence:hidden`       → opt-OUT of the channel entirely. Used by
 *   `useIsPresenceCandidate()` (NOT this hook) to decide whether to even
 *   subscribe. A user with ONLY `presence:hidden` (no `view*`) skips the
 *   org-wide channel join and DB heartbeat. Default behaviour for orgs
 *   that don't define this permission is unchanged. Added in Phase B2
 *   (2026-05-06) — see `Implementations/Harden-Presence-Service-Tenant-Overload.md`.
 *
 * Manage via Admin > Roles > Role Permissions dialog.
 */
import { useMemo } from 'react'
import { usePermissionStore } from '@/stores/permissionStore'
import {
  PRESENCE_PERMISSION_HIDDEN,
  PRESENCE_PERMISSION_VIEW,
  PRESENCE_PERMISSION_VIEW_DETAILS,
} from '@/lib/presence/constants'
import type { PresenceVisibility, OnlineUsersState } from '@/lib/presence/types'
import { usePresenceOptional } from '@/context/presence-context'

export function usePresenceVisibility(): {
  visibility: PresenceVisibility
  canViewPresence: boolean
  canViewDetails: boolean
  canViewCurrentPage: boolean
  // Filtered data respecting visibility
  filteredOnlineState: OnlineUsersState | null
} {
  const { permissions } = usePermissionStore()
  const presence = usePresenceOptional()

  const visibility = useMemo<PresenceVisibility>(() => {
    // Strictly permission-based: only explicit grants allow access
    const hasViewDetails = permissions?.includes(
      PRESENCE_PERMISSION_VIEW_DETAILS
    )
    const hasView = permissions?.includes(PRESENCE_PERMISSION_VIEW)

    if (hasViewDetails) return 'full'
    if (hasView) return 'basic'

    // No permission = no access at all
    return 'none'
  }, [permissions])

  const canViewPresence = visibility !== 'none'
  const canViewDetails = visibility === 'full'
  // Vestigial after Phase B3 — `current_page` was removed from the
  // broadcast payload entirely (privacy + 30–50 byte payload-size win
  // per member). Kept on the return type so consumer call sites
  // (`optimized-app-sidebar.tsx` etc.) compile without a churn-only edit.
  const canViewCurrentPage = visibility === 'full'

  // Filter user data based on visibility level. With Phase B3 there is
  // no longer a `current_page` field on `PresenceUser`, so `basic` and
  // `full` produce the same payload — `basic` falls through to
  // `state` rather than performing a no-op `.map()`.
  const filteredOnlineState = useMemo<OnlineUsersState | null>(() => {
    if (!presence || visibility === 'none') return null

    const state = presence.onlineUsersState

    if (visibility === 'count_only') {
      // Return counts only, empty user arrays
      return {
        onlineUsers: [],
        awayUsers: [],
        busyUsers: [],
        allPresent: [],
        totalOnline: state.totalOnline,
        totalAway: state.totalAway,
        totalBusy: state.totalBusy,
        totalPresent: state.totalPresent,
        isLoading: state.isLoading,
        error: state.error,
      }
    }

    // 'basic' and 'full' currently surface identical data — no detail
    // fields exist that need stripping. If new detail-only fields are
    // added later, do the strip here.
    return state
  }, [presence, visibility])

  return {
    visibility,
    canViewPresence,
    canViewDetails,
    canViewCurrentPage,
    filteredOnlineState,
  }
}

/**
 * Whether the current user should be a "presence candidate" — i.e.
 * whether the org-wide Realtime channel + DB heartbeat should run for
 * this session at all. A user is a candidate if EITHER:
 *
 * 1. They have `presence:view` or `presence:view_details` (so they want
 *    to SEE other users), OR
 * 2. They lack the view permission AND DO NOT have `presence:hidden`
 *    (so they want to BE SEEN by colleagues who DO have view
 *    permission — the default).
 *
 * The "be seen" check uses Strategy A from Phase B2 — opt-out via the
 * `presence:hidden` permission rather than an org-policy roundtrip at
 * sign-in. Default behaviour is unchanged for orgs that don't define
 * `presence:hidden` (everyone stays a candidate, just like before).
 *
 * Returns a boolean. `true` is the safe default (preserves visibility);
 * `false` means the service should skip the channel entirely (sets
 * `disabledReason='permission'`).
 *
 * Decoupled from `usePresenceVisibility()` because this hook is
 * consumed by `usePresenceTracker()` BEFORE the presence context is
 * created — touching the context here would deadlock the provider.
 */
export function useIsPresenceCandidate(): boolean {
  const { permissions } = usePermissionStore()

  return useMemo(() => {
    const hasView = permissions?.includes(PRESENCE_PERMISSION_VIEW) ?? false
    const hasViewDetails =
      permissions?.includes(PRESENCE_PERMISSION_VIEW_DETAILS) ?? false
    const hasHidden = permissions?.includes(PRESENCE_PERMISSION_HIDDEN) ?? false

    // (1) View permission ⇒ always a candidate (they SEE others).
    if (hasView || hasViewDetails) return true

    // (2) No view perm + explicit `presence:hidden` ⇒ skip the channel.
    if (hasHidden) return false

    // (3) No view perm + no `presence:hidden` ⇒ default to candidate
    // (be seen by colleagues with view perm, unchanged from pre-B2).
    return true
  }, [permissions])
}

// Created and developed by Jai Singh
