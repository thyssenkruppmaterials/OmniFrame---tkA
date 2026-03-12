/**
 * Presence System Constants
 */

// How often to send heartbeat to update last_seen in DB (ms)
export const DB_HEARTBEAT_INTERVAL = 60_000 // 60 seconds

// How long before user is considered "away" due to inactivity (ms)
export const IDLE_TIMEOUT = 5 * 60_000 // 5 minutes

// How long a hidden tab waits before setting away (ms)
export const TAB_HIDDEN_TIMEOUT = 2 * 60_000 // 2 minutes

// Supabase Presence channel name prefix
export const PRESENCE_CHANNEL_PREFIX = 'presence-org'

// Throttle interval for presence state sync events (ms)
export const PRESENCE_SYNC_THROTTLE = 500

// Maximum toast notifications for join/leave per minute
export const PRESENCE_TOAST_THROTTLE = 5_000 // 5 seconds per user

// Local storage key for manual status preference
export const STATUS_PREFERENCE_KEY = 'omniframe-presence-status'

// Local storage key for custom status text
export const CUSTOM_STATUS_KEY = 'omniframe-custom-status'
// Developer and Creator: Jai Singh
