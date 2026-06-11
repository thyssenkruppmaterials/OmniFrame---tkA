// Created and developed by Jai Singh
/**
 * Work Service Types
 * TypeScript interfaces matching Rust work-service models
 * For use with the Rust work service at Port 8030
 */

// Priority levels for cycle counts (matching database enum)
export type CycleCountPriority = 'critical' | 'hot' | 'normal' | 'low'

// Push mode for task assignment
export type PushMode = 'pull' | 'push'

// Worker status states
export type WorkerStatusType = 'online' | 'offline' | 'busy' | 'idle' | 'break'

/**
 * Workflow snapshot shape embedded on a task (mirrors the JSONB stamped by
 * migration 218's `trigger_stamp_workflow`). Lets the RF UI render the
 * admin's configured step sequence without a secondary Supabase query.
 */
export interface TaskWorkflowSnapshot {
  config_id?: string | null
  config_version?: number | null
  count_type?: string | null
  steps?: Array<{
    id: string
    type: string
    label: string
    required: boolean
    order: number
    config: Record<string, unknown>
  }>
}

/**
 * Per-step results accumulated during counting (serial numbers, condition,
 * barcode scans, etc.). Written by the RF UI onto
 * `rr_cyclecount_data.workflow_result` for audit.
 */
export type TaskWorkflowResult = Record<string, unknown>

/**
 * Cycle Count Task from the work queue
 * Matches Rust CycleCountTask model
 */
export interface CycleCountTask {
  id: string
  count_number: string
  material_number: string
  material_description: string | null
  location: string
  warehouse: string | null
  system_quantity: number
  counted_quantity: number | null
  unit_of_measure: string
  priority: CycleCountPriority
  status: string
  count_type: string | null
  assigned_to: string | null
  assigned_at: string | null
  push_mode: PushMode
  pushed_by: string | null
  pushed_at: string | null
  push_acknowledged: boolean
  organization_id: string
  completed_at: string | null
  recount_by: string | null
  recount_date: string | null
  recount_completed: boolean
  requires_recount: boolean
  counter_name: string | null
  resolved_location_key: string | null
  resolved_zone: string | null
  resolved_aisle: string | null
  resolved_sequence: number | null
  resolution_source: string | null
  // Workflow snapshot stamped by migration 218's trigger. Always present on
  // newly-created tasks; older rows may have an empty object.
  workflow_config_id: string | null
  workflow_config_version: number | null
  workflow_snapshot: TaskWorkflowSnapshot | Record<string, never>
  workflow_result: TaskWorkflowResult
  evidence_photo_urls: string[] | null
  review_threshold_pct: number | null
  review_threshold_abs: number | null
  // Part number verification (migration 219 + 220)
  scanned_material_number: string | null
  location_reported_empty: boolean | null
  part_variance: boolean | null
  scanned_parts: ScannedPart[]
  // Found Part Transfer (migration 222 + 223)
  // `location` is the source (A) the operator picks from; this is where
  // they deliver (destination B).
  transfer_destination_location: string | null
  // Actual qty picked from `location` (A) to deliver to B.
  transfer_source_quantity: number | null
}

/** Entry in `rr_cyclecount_data.scanned_parts` (migration 220). */
export interface ScannedPart {
  part_number: string
  quantity: number
  method: 'scan' | 'manual'
  captured_at: string
}

/**
 * Worker status from the work service
 * Tracks real-time worker presence and activity
 */
export interface WorkerStatus {
  user_id: string
  full_name: string | null
  email: string | null
  status: WorkerStatusType
  current_task_id: string | null
  current_task_type: string | null
  current_zone: string | null
  current_location: string | null
  last_heartbeat: string
}

/**
 * Queue statistics from the work service
 * Real-time metrics for work queue monitoring
 */
export interface QueueStats {
  pending: number
  deferred_pending: number
  in_progress: number
  completed_today: number
  pushed_pending: number
  total_workers_online: number
}

/**
 * Heartbeat data sent by workers to maintain presence
 */
export interface HeartbeatData {
  task_id?: string
  task_type?: string
  zone?: string
  location?: string
  status: string
}

/**
 * Task completion result
 */
export interface TaskResult {
  counted_quantity: number
  notes?: string
}

export interface SkipTaskRequest {
  reason?: string
}

/**
 * Push work request payload
 * Note: Uses count_id to match Rust backend PushCycleCountRequest
 */
export interface PushWorkRequest {
  count_id: string
  user_id: string
}

/**
 * WebSocket event types from the work service.
 *
 * Mirror of `WsEvent` in `rust-work-service/src/websocket/mod.rs`. Adding a
 * variant here is wire-compatible — the Rust enum is the source of truth
 * and all variants serialize with `#[serde(tag = "type")]`. Frontend
 * deserialisers tolerate unknown variants (they fall through the switch
 * statements that consume them).
 */
export type WsEventType =
  | 'TaskAssigned'
  | 'TaskStatusChanged'
  | 'WorkerStatusChanged'
  | 'QueueStatsUpdated'
  | 'PushedWork'
  | 'Heartbeat'
  // Migrations 232 / 233: a pending+assigned reservation was escalated
  // to hard-unassign by the scheduler. Distinct from a generic
  // `TaskStatusChanged` no-op pending→pending transition so consumers
  // can refresh "reserved for X" affordances specifically.
  | 'ReservationEscalated'
  // T-3 (2026-05-18) — admin-only canary for the
  // zone-mutual-exclusion cascade documented in
  // `Decisions/ADR-Cycle-Count-Soft-Reservation-Cascade-Mitigation.md`.
  // Emitted by `claim_next_task` when the claim returns None AND
  // there's at least one unassigned-pending cycle_count row in the
  // org (real work exists but the candidate scan filtered it all
  // out — almost always because of stuck soft-reservations occupying
  // the candidate zones). The admin shell subscribes to this variant
  // and renders a persistent ribbon at the top of the page while the
  // condition persists; it auto-clears when a subsequent claim
  // succeeds or `QueueStatsUpdated` shows healthy throughput.
  | 'ClaimBlockedByZone'
  // Migration 270 (2026-05-06): a `public.sap_agents` row changed.
  // Driven by the `sap_agent_changed` Postgres NOTIFY trigger and
  // forwarded by `rust-work-service::sap_agents_listener`. Replaces
  // the highest-fanout `supabase.channel(postgres_changes)` consumer
  // pair in the app — `omniframe-agent-detection-fleet` (in
  // `use-agent-detection.ts`) and `sap-agents-fleet` (in
  // `agents-fleet-card.tsx`).
  | 'SapAgentChanged'
  // Option 2 (2026-05-06) — server-side presence in
  // `rust-work-service`. See
  // `memorybank/OmniFrame/Decisions/ADR-Presence-Architecture-Next-Steps.md`
  // and the Implementation note `Implement-Presence-On-Rust-Option-2`.
  // `PresenceJoined`  — first heartbeat from this user this session.
  // `PresenceUpdated` — subsequent heartbeats (status flip, custom-text
  //                     change, idle re-entry, periodic 30s tick).
  // `PresenceLeft`    — explicit "Appear Offline" / sign-out OR the
  //                     30s server-side evictor swept an expired row.
  | 'PresenceJoined'
  | 'PresenceUpdated'
  | 'PresenceLeft'
  // Tier 1 deferred-channel migrations (2026-05-06 sprint — see
  // `memorybank/OmniFrame/Implementations/Migrate-Tier1-Deferred-
  // Channels-To-Rust-WS.md`). Each retires one or more
  // `supabase.channel(postgres_changes)` callsites from the FE,
  // replacing them with a typed Rust `WsEvent` variant + Postgres
  // NOTIFY trigger.
  //
  //   migration 271 → SapJobStatusChanged    (sap_agent_jobs)
  //   migration 272 → ImportRunStatusChanged (sap_outbound_to_import_runs)
  //   migration 273 → CycleCountOperationChanged (rr_cyclecount_data)
  //   migration 274 → Lx03DataChanged        (rr_lx03_data — NULLABLE org_id)
  | 'SapJobStatusChanged'
  | 'ImportRunStatusChanged'
  | 'CycleCountOperationChanged'
  | 'Lx03DataChanged'
  // Tier 2 (2026-05-06) — three new product surfaces shipped on
  // top of Option 2. See `Roadmap-Rust-WS-Unlocks.md` Tier 2.
  //
  //   #1 `EntityFocus`  — soft-locking / "Sarah is editing this row"
  //                       pill on DataTables. Backed by Redis HSET
  //                       on a sibling `presence:focus:*` schema
  //                       with a 30s TTL (half of presence's 90s).
  //   #2 `Notification` — server-pushed bell-icon notifications.
  //                       Driven by migration 275's NOTIFY trigger
  //                       on `public.notifications`.
  //   #3 (no new variant — `PushedWork` was extended in place with
  //      `target_zone` / `target_role` / `target_user_ids` /
  //      `broadcast_message` optional fields.)
  | 'EntityFocus'
  | 'Notification'
  // Phase 4 (2026-05-06) of the rust-work-service integration plan.
  // `RfPutawayChanged` is the migration target for the OmniFrame
  // on-prem agent's last-remaining direct Supabase Realtime
  // subscription (`rf_putaway_operations`). The agent (v1.9.0+) is
  // the only consumer today — frontend code does NOT subscribe to
  // this variant. Migration 276 ships the trigger;
  // `rust-work-service::rf_putaway_listener` forwards it. See
  // `Implementations/Implement-Rust-Work-Service-Phase4.md`.
  | 'RfPutawayChanged'
  // Phase 6 (2026-05-07) — fleet-wide live console streaming. Driven
  // by `POST /api/v1/sap-console/lines` which the OmniFrame agent's
  // `_console_relay_thread` calls in batches behind the
  // `OMNIFRAME_AGENT_CONSOLE_RELAY=1` flag. The route fans out one
  // event per line, scoped to the agent's organization. The SAP
  // Console card subscribes to this variant (with optional
  // `agent_id` filter dropdown) so admins see live agent output
  // without polling the agent's local /console endpoint.
  // See `Implementations/Implement-Rust-Work-Service-Phase6.md`.
  | 'SapAgentConsoleLine'
  // Phase 9 (2026-05-07) — server-side trigger DSL evaluator fired.
  // Pushed when an `agent_triggers` rule matches a row event AND
  // `sap_agent_jobs` INSERT succeeds (idempotency hits do NOT
  // broadcast). The rewritten "Agent Triggers" CRUD tab subscribes
  // to render the live "trigger fire stream" — replaces the deleted
  // browser-side `useAgentTriggerRuntime` hook's in-memory
  // `EventLogEntry` list. Carries ONLY metadata (trigger_id,
  // source_row_id, target_endpoint, job_id, organization_id) — the
  // full row payload is intentionally NOT in the WS event so we
  // don't re-introduce the row-leak concern from
  // `ADR-WsEvent-Typed-vs-Envelope`. See
  // `Implementations/Implement-Rust-Work-Service-Phase9.md` and
  // `Decisions/ADR-Trigger-DSL-Evaluator-Phase9.md`.
  | 'TriggerFired'
  // P2 of OmniBelt MVP (2026-05-24) — admin config changed for an
  // org. Driven by the `omnibelt_role_config_notify` Postgres trigger
  // (migration 327) and the `omnibelt_listener` consumer in
  // `rust-work-service`. The frontend hook
  // `useOmnibeltConfigInvalidator` subscribes via the existing
  // `workServiceWs` singleton and invalidates the
  // `['omnibelt', 'bootstrap']` TanStack Query, so every connected
  // user in the org pulls fresh config in <1s. Carries only
  // `organization_id` — the full bootstrap payload comes back via
  // the next Rust dashboard fetch. Note: the variant name follows
  // the existing PascalCase convention shared by every other entry
  // here (Rust serialises with `#[serde(tag = "type")]` without
  // `rename_all`, so the wire shape is the variant name verbatim).
  | 'OmnibeltConfigChanged'

/**
 * WebSocket event payload
 * Union type for all possible event data
 */
export interface WsEvent {
  type: WsEventType
  task_id?: string
  user_id?: string
  priority?: string
  location?: string
  material?: string
  count_number?: string
  old_status?: string
  new_status?: string
  status?: string
  pending?: number
  deferred_pending?: number
  in_progress?: number
  completed_today?: number
  /**
   * `WsEvent::ReservationEscalated.previous_owner` from
   * `rust-work-service/src/websocket/mod.rs`. Optional because no other
   * variant carries it.
   */
  previous_owner?: string
  /**
   * `WsEvent::SapAgentChanged` fields. Always present when
   * `type === 'SapAgentChanged'`; omitted otherwise. Consumers MUST
   * narrow on `type` before reading these — the same way the worker /
   * task variants gate their reads on `event.type`.
   *
   * `agent_id` mirrors `sap_agents.id` (TEXT, not UUID — see migration
   * 247). `op` is `'INSERT' | 'UPDATE' | 'DELETE'` per the trigger in
   * migration 270. `last_seen_at` is ISO 8601; nullable on DELETE.
   */
  agent_id?: string
  organization_id?: string
  last_seen_at?: string | null
  op?: string
  /**
   * `WsEvent::Presence{Joined,Updated,Left}` payload (Option 2 — server-side
   * presence on `rust-work-service`). Always present when
   * `type === 'PresenceJoined' | 'PresenceUpdated'`; `payload` is omitted on
   * `PresenceLeft` (the row is gone — only the `user_id` matters). Consumers
   * MUST narrow on `type` before reading these.
   *
   * `payload` is loosely-typed (`Record<string, unknown>`) so that adding
   * fields to the FE-side `PresencePayload` does not require a downstream
   * cascade through this types file. Consumers that want a typed view should
   * cast to `PresencePayload` from `@/lib/presence/types` after the type
   * narrow.
   */
  payload?: Record<string, unknown>
  /**
   * Tier 1 deferred-channel migrations (2026-05-06). Always present when
   * `type === 'SapJobStatusChanged' | 'ImportRunStatusChanged' |
   * 'CycleCountOperationChanged' | 'Lx03DataChanged'`; omitted otherwise.
   * Consumers MUST narrow on `type` before reading these — keeping the
   * shape flat-optional preserves wire-compat with the existing flat
   * `WsEvent` interface (see Migrate-Tier1-Deferred-Channels-To-Rust-WS.md
   * for why we did NOT split this into a discriminated union).
   *
   *   - `job_id`         — `WsEvent::SapJobStatusChanged.job_id` (UUID).
   *   - `run_id`         — `WsEvent::ImportRunStatusChanged.run_id` (UUID).
   *   - `row_id`         — `WsEvent::CycleCountOperationChanged.row_id` /
   *                        `WsEvent::Lx03DataChanged.row_id` (UUID).
   *   - `step`           — `WsEvent::SapJobStatusChanged.step` — agent-
   *                        reported progress label, optional on UPDATE.
   *   - `rows_imported`  — `WsEvent::ImportRunStatusChanged.rows_imported`
   *                        — agent-reported row count on terminal status.
   *
   * `status`, `op`, `organization_id` (declared above) are reused by
   * these variants — no new fields needed for them.
   */
  job_id?: string
  run_id?: string
  row_id?: string
  step?: string | null
  rows_imported?: number | null
  /**
   * Phase 4 (2026-05-06) — `WsEvent::RfPutawayChanged.new`. Always
   * present when `type === 'RfPutawayChanged'`; omitted otherwise.
   * Carries `row_to_jsonb(NEW)` from the `rf_putaway_operations`
   * trigger (migration 276) — the full new row, loosely typed
   * because the on-prem agent (`omni_agent/work_service_ws.py`) is
   * the only consumer today and only inspects a handful of fields
   * (`to_status`, `is_mca_workflow`, `confirmed_source`,
   * `to_number`, `warehouse`). Reuses `row_id`, `op`,
   * `organization_id` declared above. Frontend code does NOT
   * subscribe to this variant — it's agent-only.
   */
  new?: Record<string, unknown>
  /**
   * Tier 2 #1 — `WsEvent::EntityFocus` payload (soft-locking).
   * Always present when `type === 'EntityFocus'`; omitted otherwise.
   * Consumers MUST narrow on `type` before reading these.
   *
   *   - `entity_kind` — free-form entity-class label, e.g.
   *                     `'ticket'`, `'work_task'`, `'rr_lx03_data'`.
   *   - `entity_id`   — opaque identifier for the row being focused
   *                     (UUIDs, integers-as-strings, business keys
   *                     all welcome).
   *   - `action`      — `'enter' | 'heartbeat' | 'leave'`.
   *   - `user_id`     — already declared above; reused for the
   *                     focused user's id.
   */
  entity_kind?: string
  entity_id?: string
  action?: string
  /**
   * Tier 2 #2 — `WsEvent::Notification` payload (server-pushed).
   * Always present when `type === 'Notification'`; omitted otherwise.
   * Consumers MUST narrow on `type` before reading these AND match
   * `event.user_id === currentUserId` for per-user delivery (the
   * org-scope filter on the WS send loop guards cross-tenant leaks,
   * but a notification is per-user, not per-org).
   *
   *   - `notification_id` — UUID, matches `public.notifications.id`.
   *   - `kind`            — free-form event-class label, e.g.
   *                         `'sap_job_complete'`,
   *                         `'reservation_escalated'`.
   *   - `title`           — short, plain-text bell-row heading.
   *   - `body`            — optional longer-form text (renders below
   *                         the title in the panel).
   *   - `link`            — optional deep-link path, e.g.
   *                         `/admin/work-queue?task=…`.
   *   - `severity`        — `'info' | 'warning' | 'error' | 'success'`
   *                         (mirrors the existing `notification_type`
   *                         enum). Drives the bell-row icon colour.
   */
  notification_id?: string
  kind?: string
  title?: string
  body?: string | null
  link?: string | null
  severity?: string | null
  /**
   * Tier 2 #3 — `WsEvent::PushedWork` extensions for richer dispatch
   * broadcasts. All four fields are optional; existing single-user
   * pushes (`POST /api/v1/work/push`, `push_batch`, `push_top_n`)
   * leave them undefined. New broadcasts (`POST /api/v1/dispatch/
   * broadcast`) set ONE of `target_zone`, `target_role`,
   * `target_user_ids`, plus `broadcast_message`.
   *
   * The FE consumer (`use-pushed-work.ts`) MUST check whether ANY
   * targeting field is set; when set, match the current user against
   * the targeting criteria instead of trusting `user_id` blindly
   * (broadcasts encode the *supervisor / pusher* in `user_id`, not
   * the recipient).
   */
  target_zone?: string | null
  target_role?: string | null
  target_user_ids?: string[] | null
  broadcast_message?: string | null
  /**
   * Phase 6 (2026-05-07) — `WsEvent::SapAgentConsoleLine` payload.
   * Always present when `type === 'SapAgentConsoleLine'`; omitted
   * otherwise. Consumers MUST narrow on `type` before reading these.
   *
   *   - `agent_id` — already declared above; reused here as the
   *                  source agent's stable id (mirrors
   *                  `sap_agents.id`).
   *   - `level`    — `'info' | 'warn' | 'error' | 'debug' | 'trace'
   *                  | 'success'`. The Rust route clamps unknown
   *                  values to `'info'` and normalises `'warning'` →
   *                  `'warn'` so dashboards can colour rows from
   *                  this field directly.
   *   - `message`  — the agent-side print body. Truncated to 4096
   *                  chars by the route; truncation is marked with
   *                  `…[truncated NNN chars]` so the FE can warn
   *                  the operator.
   *   - `ts`       — agent-side wall-clock at the moment the line
   *                  was printed (ISO 8601), NOT the relay time. A
   *                  large gap between `ts` and `Date.now()` means
   *                  the agent reconnected after an offline window
   *                  and drained its buffer in a single batch.
   */
  level?: string
  message?: string
  ts?: string
  /**
   * Phase 9 (2026-05-07) — `WsEvent::TriggerFired` payload. Always
   * present when `type === 'TriggerFired'`; omitted otherwise.
   * Consumers MUST narrow on `type` before reading these.
   *
   *   - `trigger_id`      — UUID, matches `agent_triggers.id`. The
   *                         FE uses this to count fires per trigger
   *                         in the dashboard's "Recent fires" panel.
   *   - `source_row_id`   — UUID of the row that triggered the
   *                         evaluation (already declared above as
   *                         `row_id`; reused).
   *   - `target_endpoint` — agent endpoint the resulting
   *                         `sap_agent_jobs` row will hit, e.g.
   *                         `/sap/confirm-to`. Renders as the
   *                         arrow-target chip in the live stream.
   *   - `job_id`          — already declared above; reused as the
   *                         id of the `sap_agent_jobs` row inserted
   *                         on this fire (NEVER nil — duplicate
   *                         idempotency hits do NOT broadcast).
   */
  trigger_id?: string
  target_endpoint?: string
  /**
   * T-3 (2026-05-18) — `WsEvent::ClaimBlockedByZone` payload. Always
   * present when `type === 'ClaimBlockedByZone'`; omitted otherwise.
   * Consumers MUST narrow on `type` before reading these.
   *
   *   - `task_type`              — the task_type that returned empty.
   *                                Today only `'cycle_count'` emits.
   *   - `unassigned_pending`     — count of rows ready to claim but
   *                                blocked. >0 by construction.
   *   - `stuck_pending_assigned` — count of soft-reserved rows. >0
   *                                indicates the cascade class.
   *
   * `organization_id` and `user_id` declared above; reused here as the
   * org-scope and the operator who got the empty response.
   */
  task_type?: string
  unassigned_pending?: number
  stuck_pending_assigned?: number
}

/**
 * P2 of OmniBelt MVP (2026-05-24) — typed view of the
 * `OmnibeltConfigChanged` payload. The base `WsEvent` interface uses
 * flat-optional fields (existing convention); this alias narrows the
 * shape for consumers that prefer a per-variant interface. Use it
 * via `event.type === 'OmnibeltConfigChanged'` narrow + cast.
 */
export type OmnibeltConfigChangedPayload = {
  type: 'OmnibeltConfigChanged'
  organization_id: string
}

/**
 * WebSocket subscription message
 */
export interface WsSubscribeMessage {
  type: 'Subscribe'
  organization_id: string
}

/**
 * WebSocket unsubscribe message
 */
export interface WsUnsubscribeMessage {
  type: 'Unsubscribe'
}

/**
 * WebSocket heartbeat message
 */
export interface WsHeartbeatMessage extends HeartbeatData {
  type: 'Heartbeat'
}

/**
 * Union type for all outgoing WebSocket messages
 */
export type WsOutgoingMessage =
  | WsSubscribeMessage
  | WsUnsubscribeMessage
  | WsHeartbeatMessage

/**
 * API Error response from work service
 */
export interface WorkServiceError {
  error: string
  code?: string
}

/**
 * Claim response from the work service
 * Matches Rust ClaimTaskResponse model
 */
export interface ClaimResponse {
  success: boolean
  message: string
  task?: CycleCountTask | null
}

/**
 * Worker with their assigned tasks
 */
export interface WorkerWithTasks extends WorkerStatus {
  tasks: CycleCountTask[]
}

// Created and developed by Jai Singh
