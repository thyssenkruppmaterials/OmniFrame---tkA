// Created and developed by Jai Singh
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

// What gets broadcast via the presence channel (Supabase Realtime in
// `'supabase'` mode, or `rust-work-service` over the existing `/ws`
// singleton in `'rust'` mode). The shape is identical for both modes
// because the Rust path stores the FE payload verbatim in Redis and
// fans it back out as `serde_json::Value` (see
// `rust-work-service/src/api/routes/presence.rs` and `WsEvent::PresenceJoined`).
//
// Field history note — `current_page`:
//   - Removed in Phase B3 (2026-05-06) for privacy + payload size;
//     broadcasting it leaked navigation activity to every other tab on
//     the org-wide channel.
//   - **Re-enabled 2026-05-07 with a strictly scoped consumer surface.**
//     Today the only renderer is `<LiveOperatorStatus>` inside the
//     Inventory Counts tab (Inventory Management > Inventory Counts),
//     which is RBAC-gated by the `view inventory_apps` resource
//     permission via `createStandardProtectedRoute('INVENTORY')`.
//     Supervisors looking at the panel see "Sarah Chen — RF: Cycle
//     Count" instead of just "online". See
//     `memorybank/OmniFrame/Decisions/ADR-Scoped-CurrentPage-In-ActiveOperators.md`.
//
// Hard rule for any future consumer: do NOT render `current_page`
// outside an RBAC-gated supervisor surface. The org-wide
// `<OnlineUsersPanel>`, the `<StatusSelector>` dropdown, and the
// `<PresenceAvatar>` tooltip MUST stay current_page-agnostic. Add a
// new ADR if you want a second consumer.
//
// Field history note — `rf_activity`:
//   - **Added 2026-05-07.** Granular RF workflow telemetry (current
//     workflow step, last scan, idle indicator, work task / zone)
//     for the `<LiveOperatorStatus>` supervisor panel. Scoped to
//     EXACTLY THE SAME consumer surface as `current_page` — i.e. the
//     `<LiveOperatorStatus>` panel inside the Inventory Counts tab,
//     RBAC-gated by `view inventory_apps`. See
//     `memorybank/OmniFrame/Decisions/ADR-RF-Activity-Telemetry.md`
//     before adding a second renderer. Do NOT surface `rf_activity`
//     in the org-wide `<OnlineUsersPanel>`, `<StatusSelector>`, or
//     `<PresenceAvatar>` — those MUST stay rf_activity-agnostic.
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
  device_type: 'desktop' | 'mobile' | 'tablet'
  // Raw `location.pathname` of the user's current tab. Updated through
  // the same `scheduleTrack`/`scheduleHeartbeat` debouncer as every
  // other payload mutation, so rapid navigation collapses into a
  // single broadcast per `TRACK_DEBOUNCE_MS`. `null` when the field
  // hasn't been seeded yet (very first heartbeat) or when the FE is
  // running in a context with no `window.location`.
  current_page: string | null
  // Granular RF workflow telemetry — see the privacy contract block
  // comment above. Optional/nullable: `null` for non-RF tabs and for
  // RF tabs that aren't currently inside an active workflow.
  rf_activity?: PresenceRfActivity | null
  online_at: string // ISO timestamp
  last_active_at: string // ISO timestamp
}

/**
 * Granular RF workflow telemetry for the supervisor's
 * `<LiveOperatorStatus>` panel. Carried on the presence payload
 * verbatim through Rust (Worker 1's `serde_json::Value` design in
 * `Implement-Presence-On-Rust-Option-2.md` — no Rust release required
 * for this addition).
 *
 * **Privacy contract.** This struct rides the same RBAC gate as
 * `PresencePayload.current_page`: it is broadcast for every
 * presence-candidate user, but only ONE UI surface is permitted to
 * read it — `<LiveOperatorStatus>` inside the Inventory Counts tab
 * (gated by the `view inventory_apps` resource permission via
 * `createStandardProtectedRoute('INVENTORY')`). Do NOT render
 * `rf_activity` on `<OnlineUsersPanel>`, `<StatusSelector>`,
 * `<PresenceAvatar>`, or any other surface. A second consumer
 * requires a new ADR linked from
 * `memorybank/OmniFrame/Decisions/ADR-RF-Activity-Telemetry.md`.
 */
export interface PresenceRfActivity {
  /**
   * Current workflow step. Free-form snake_case label; the panel
   * humanises it for display via a small lookup (with a fallback
   * that title-cases the raw string). Examples:
   *   - `'cycle_count'` — operator is inside a cycle-count workflow.
   *   - `'putaway'` — operator is running put-away.
   *   - `'picking'` — operator is running pick.
   *   - `'home'` / `'work_queue'` / `'claim_tasks'` — operator is on
   *     an RF screen but not yet inside a work-type workflow.
   * `null` when the operator isn't in any active workflow OR when the
   * activity hook hasn't surfaced one yet.
   */
  current_step: string | null
  /**
   * Most recent scan event. `type` is permissive — the parent-level
   * RF integration emits `'rf_scan'` (work-type-bucketed in the
   * label rather than typed at the source) since scans are processed
   * per-form rather than centrally; future per-form integrations
   * may emit `'material' | 'bin' | 'to_number' | 'serial'` for
   * tighter labels. The panel falls back gracefully on unknown types.
   */
  last_scan: {
    type: 'material' | 'bin' | 'to_number' | 'serial' | 'rf_scan' | string
    value: string
    /** ISO timestamp when the scan was processed. */
    at: string
  } | null
  /** Active work task ID (UUID) if the operator is on a claimed task. */
  work_task_id: string | null
  /** Active work zone, e.g. `'K3'` or `'K3-35'`. */
  work_zone: string | null
  /**
   * ISO timestamp of the last user input event observed on the RF
   * tab (key, scan, button tap, pointer-down). The panel renders an
   * "idle" badge when this is older than ~60s and a "live" pulse
   * when it's < 10s, giving supervisors a glanceable activity
   * indicator without surfacing every keystroke as a discrete
   * presence broadcast.
   */
  last_input_at: string | null
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
  device_type: 'desktop' | 'mobile' | 'tablet'
  // See `PresencePayload.current_page` for the privacy contract.
  current_page: string | null
  // See `PresenceRfActivity` doc-comment for the privacy contract.
  // Same RBAC gate as `current_page` — `<LiveOperatorStatus>` only.
  rf_activity?: PresenceRfActivity | null
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

// Created and developed by Jai Singh
