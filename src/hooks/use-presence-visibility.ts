/**
 * usePresenceVisibility - Strictly permission-based presence visibility
 *
 * Determines what level of presence information the current user can see
 * based EXCLUSIVELY on assigned permissions. No role-name fallbacks.
 *
 * Permission mapping:
 * - `presence:view_details` → full visibility (users, current page, custom status)
 * - `presence:view`         → basic visibility (users + status, no current page)
 * - Neither permission      → completely hidden (no panel, no badge, nothing)
 *
 * Manage via Admin > Roles > Role Permissions dialog.
 */
import { useMemo } from 'react'
import { usePermissionStore } from '@/stores/permissionStore'
import type {
  PresenceVisibility,
  PresenceUser,
  OnlineUsersState,
} from '@/lib/presence/types'
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
    const hasViewDetails = permissions?.includes('presence:view_details')
    const hasView = permissions?.includes('presence:view')

    if (hasViewDetails) return 'full'
    if (hasView) return 'basic'

    // No permission = no access at all
    return 'none'
  }, [permissions])

  const canViewPresence = visibility !== 'none'
  const canViewDetails = visibility === 'full'
  const canViewCurrentPage = visibility === 'full'

  // Filter user data based on visibility
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

    if (visibility === 'basic') {
      // Strip sensitive fields (current_page) - keep custom_status_text as user-set
      const stripDetails = (user: PresenceUser): PresenceUser => ({
        ...user,
        current_page: null,
      })

      return {
        onlineUsers: state.onlineUsers.map(stripDetails),
        awayUsers: state.awayUsers.map(stripDetails),
        busyUsers: state.busyUsers.map(stripDetails),
        allPresent: state.allPresent.map(stripDetails),
        totalOnline: state.totalOnline,
        totalAway: state.totalAway,
        totalBusy: state.totalBusy,
        totalPresent: state.totalPresent,
        isLoading: state.isLoading,
        error: state.error,
      }
    }

    // Full visibility - return as-is
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
