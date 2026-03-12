/**
 * User Presence System - Type Definitions
 * Teams-style presence tracking for OmniFrame
 */

// Presence status for real-time online tracking (separate from account status)
export type PresenceStatus =
  | 'online'
  | 'away'
  | 'busy'
  | 'do_not_disturb'
  | 'offline'

// Labels and colors for each status
export const PRESENCE_STATUS_CONFIG: Record<
  PresenceStatus,
  {
    label: string
    color: string
    dotClass: string
    bgClass: string
    description: string
  }
> = {
  online: {
    label: 'Available',
    color: '#22c55e',
    dotClass: 'bg-green-500',
    bgClass: 'bg-green-500/10 text-green-700 dark:text-green-400',
    description: 'Active and available',
  },
  away: {
    label: 'Away',
    color: '#eab308',
    dotClass: 'bg-yellow-500',
    bgClass: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
    description: 'Idle or stepped away',
  },
  busy: {
    label: 'Busy',
    color: '#ef4444',
    dotClass: 'bg-red-500',
    bgClass: 'bg-red-500/10 text-red-700 dark:text-red-400',
    description: 'Busy, limited availability',
  },
  do_not_disturb: {
    label: 'Do Not Disturb',
    color: '#ef4444',
    dotClass: 'bg-red-600',
    bgClass: 'bg-red-600/10 text-red-700 dark:text-red-400',
    description: 'Do not disturb',
  },
  offline: {
    label: 'Offline',
    color: '#6b7280',
    dotClass: 'bg-gray-400',
    bgClass: 'bg-gray-400/10 text-gray-600 dark:text-gray-400',
    description: 'Offline or unavailable',
  },
}

// What gets broadcast via Supabase Presence channel
export interface PresencePayload {
  user_id: string
  email: string
  full_name: string | null
  first_name: string | null
  avatar_url: string | null
  role_name: string | null
  role_id: string | null
  status: PresenceStatus
  custom_status_text: string | null
  current_page: string | null
  device_type: 'desktop' | 'mobile' | 'tablet'
  online_at: string // ISO timestamp
  last_active_at: string // ISO timestamp
}

// Enriched presence user (from the channel state)
export interface PresenceUser {
  user_id: string
  email: string
  full_name: string | null
  first_name: string | null
  avatar_url: string | null
  role_name: string | null
  role_id: string | null
  status: PresenceStatus
  custom_status_text: string | null
  current_page: string | null
  device_type: 'desktop' | 'mobile' | 'tablet'
  online_at: string
  last_active_at: string
  // Derived display helpers
  initials: string
  display_name: string
}

// What the consumer hooks return
export interface OnlineUsersState {
  onlineUsers: PresenceUser[]
  awayUsers: PresenceUser[]
  busyUsers: PresenceUser[]
  allPresent: PresenceUser[] // everyone not offline
  totalOnline: number
  totalAway: number
  totalBusy: number
  totalPresent: number
  isLoading: boolean
  error: string | null
}

export interface PresenceContextType {
  // Current user's presence
  myStatus: PresenceStatus
  setMyStatus: (status: PresenceStatus) => void
  setCustomStatusText: (text: string | null) => void
  customStatusText: string | null

  // Online users data
  onlineUsersState: OnlineUsersState

  // Single user lookup
  getUserPresence: (userId: string) => PresenceUser | null
  isUserOnline: (userId: string) => boolean

  // Connection state
  isConnected: boolean
  channelError: string | null
}

// RBAC: which roles can see which presence details
export type PresenceVisibility = 'full' | 'basic' | 'count_only' | 'none'
// Developer and Creator: Jai Singh
