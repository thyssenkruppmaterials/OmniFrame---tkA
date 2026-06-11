// Created and developed by Jai Singh
//! WebSocket server implementation for rust-work-service
//!
//! Provides real-time event broadcasting for:
//! - Task assignments and status changes
//! - Worker status updates
//! - Queue statistics updates
//! - Pushed work notifications

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::StatusCode,
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::observability::metrics;
use crate::ws_token::{verify as verify_ws_token, WsTokenClaims};
use crate::AppState;

/// WebSocket events sent from server to clients.
///
/// Every variant carries an optional `organization_id` so the WebSocket
/// fan-out can filter per-org subscriber. Existing front-end deserializers
/// tolerate extra fields, so adding the column is wire-compatible.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsEvent {
    /// A task was assigned to a user
    TaskAssigned {
        task_id: Uuid,
        user_id: Uuid,
        priority: String,
        location: String,
        material: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        organization_id: Option<Uuid>,
    },
    /// A task's status changed
    TaskStatusChanged {
        task_id: Uuid,
        old_status: String,
        new_status: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        organization_id: Option<Uuid>,
    },
    /// A worker's status changed
    WorkerStatusChanged {
        user_id: Uuid,
        status: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        organization_id: Option<Uuid>,
    },
    /// Queue statistics were updated.
    ///
    /// Migration 253 review: payload now mirrors the REST `get_queue_stats`
    /// response 1:1 (same predicates, same fields). `pushed_pending` and
    /// `total_workers_online` were missing before, and the predicates for
    /// `pending` / `completed_today` diverged from REST. Existing clients
    /// that don't read the two new fields are unaffected because both
    /// carry `#[serde(default)]`.
    QueueStatsUpdated {
        pending: i64,
        deferred_pending: i64,
        in_progress: i64,
        completed_today: i64,
        #[serde(default)]
        pushed_pending: i64,
        #[serde(default)]
        total_workers_online: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        organization_id: Option<Uuid>,
    },
    /// Work was pushed to a user (supervisor push mode).
    ///
    /// Tier 2 #3 (2026-05-06) — extended with three OPTIONAL targeting
    /// fields that turn `PushedWork` into a richer dispatch primitive:
    ///
    /// - `target_zone`: broadcast to all operators currently in zone X
    ///   (resolved against `worker_heartbeats.current_zone`).
    /// - `target_role`: broadcast to all operators with role Y
    ///   (resolved against `user_profiles.role`).
    /// - `target_user_ids`: broadcast to an explicit user list.
    ///
    /// All three default to `None` so existing single-user pushes
    /// (claim_next, push_to_user, push_batch, push_top_n) keep their
    /// wire shape verbatim. When ANY of the three is set, FE consumers
    /// MUST match the current user against the targeting criteria
    /// before reacting (see `src/hooks/use-pushed-work.ts`).
    ///
    /// `user_id` stays REQUIRED — for single-user pushes it identifies
    /// the recipient; for broadcasts it carries the supervisor / pusher
    /// (so audit trails show "broadcast initiated by X"). Recipients
    /// MUST therefore branch on whether targeting fields are set
    /// instead of trusting `user_id` blindly.
    PushedWork {
        task_id: Uuid,
        user_id: Uuid,
        material: String,
        location: String,
        count_number: String,
        priority: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        organization_id: Option<Uuid>,
        /// Tier 2 #3 — optional zone-broadcast target. When `Some`,
        /// recipients filter on `worker_heartbeats.current_zone`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        target_zone: Option<String>,
        /// Tier 2 #3 — optional role-broadcast target. When `Some`,
        /// recipients filter on `user_profiles.role`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        target_role: Option<String>,
        /// Tier 2 #3 — optional explicit-user broadcast target. When
        /// `Some`, recipients filter on the list directly.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        target_user_ids: Option<Vec<Uuid>>,
        /// Tier 2 #3 — optional human-readable broadcast message.
        /// Only set on broadcast pushes (single-user pushes leave it
        /// `None`); FE renders this as the toast body if set.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        broadcast_message: Option<String>,
    },
    /// Heartbeat acknowledgment
    Heartbeat {
        user_id: Uuid,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        organization_id: Option<Uuid>,
    },
    /// A pending+assigned reservation was escalated to hard-unassign
    /// (migration 232 / 233). Distinct from a generic TaskStatusChanged
    /// no-op pending→pending transition so clients can refresh "reserved
    /// for X" UI elements specifically.
    ReservationEscalated {
        task_id: Uuid,
        previous_owner: Uuid,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        organization_id: Option<Uuid>,
    },
    /// T-3 (2026-05-18) — admin-only canary signal. Emitted by the
    /// `/api/v1/work/claim` route whenever `claim_next_task` returns
    /// None AND there's at least one unassigned-pending row in the
    /// org's cycle_count surface (real work exists, the candidate scan
    /// just filtered it all out — almost always the
    /// zone-mutual-exclusion cascade documented in
    /// `Decisions/ADR-Cycle-Count-Soft-Reservation-Cascade-Mitigation.md`).
    /// The admin shell renders a persistent ribbon on receipt and
    /// auto-dismisses when a subsequent claim succeeds or the
    /// `unassigned_pending` count drops to zero.
    ///
    /// `organization_id` is REQUIRED so the deny-by-default org-scope
    /// filter in `handle_socket`'s send loop covers it for free.
    ClaimBlockedByZone {
        organization_id: Uuid,
        user_id: Uuid,
        task_type: String,
        /// Snapshot of `count(*) WHERE status='pending' AND assigned_to IS NULL`
        /// for the org at emit time. >0 by construction (we never emit
        /// when the queue is genuinely empty).
        unassigned_pending: i64,
        /// Snapshot of `count(*) WHERE status='pending' AND assigned_to IS NOT NULL`
        /// — the soft-reservation surface. >0 indicates this is the
        /// cascade class; ==0 with `unassigned_pending`>0 suggests
        /// defer-list / capability / capacity mismatch instead.
        stuck_pending_assigned: i64,
    },
    /// A `public.sap_agents` row was inserted, updated, or deleted.
    ///
    /// Driven by the `sap_agent_changed` Postgres NOTIFY trigger
    /// (migration 270). Replaces the highest-fanout
    /// `supabase.channel(postgres_changes)` consumer in the app
    /// (`omniframe-agent-detection-fleet` + `sap-agents-fleet`). The
    /// `agent_id` is `TEXT` (mirrors `sap_agents.id` schema, which
    /// stores a self-minted `<COMPUTERNAME>-<SESSIONNAME>-<PID>`-shaped
    /// stable identifier — see migration 247).
    ///
    /// `organization_id` is REQUIRED (not `Option`-wrapped) because
    /// every `sap_agents` row carries one; making it `None` would
    /// silently bypass the deny-by-default org-scope filter in
    /// `handle_socket`'s send loop.
    SapAgentChanged {
        agent_id: String,
        organization_id: Uuid,
        status: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        last_seen_at: Option<chrono::DateTime<chrono::Utc>>,
        /// 'INSERT' | 'UPDATE' | 'DELETE' — emitted by the trigger.
        op: String,
    },
    /// A user JOINED the org's presence set.
    ///
    /// Emitted by `POST /api/v1/presence/heartbeat` the FIRST time we
    /// see a `user_id` in the per-org Redis HSET this session
    /// (determined by `HEXISTS` before the `HSET`). Replaces the
    /// `presence-org-{org_id}` Supabase Presence channel — see
    /// `memorybank/OmniFrame/Decisions/ADR-Presence-Architecture-Next-Steps.md`
    /// "Option 2".
    ///
    /// `organization_id` is REQUIRED (not `Option`-wrapped) so the
    /// deny-by-default org-scope filter in `handle_socket`'s send
    /// loop covers presence events for free. `payload` is the
    /// JSON-serialised `PresencePayload` from the FE — kept loose
    /// (`serde_json::Value`) so changes to the FE shape don't require
    /// a Rust release.
    PresenceJoined {
        user_id: String,
        organization_id: Uuid,
        payload: serde_json::Value,
    },
    /// A user's presence row was UPDATED (status flip, custom-status
    /// edit, idle re-entry, periodic heartbeat).
    ///
    /// Emitted by `POST /api/v1/presence/heartbeat` for the second
    /// and subsequent heartbeats from a `user_id` already in the
    /// per-org Redis HSET. Same wire shape as `PresenceJoined`; the
    /// distinction lets clients differentiate "new colleague online"
    /// (toast / sound) from "Sarah's status is now Busy" (silent).
    PresenceUpdated {
        user_id: String,
        organization_id: Uuid,
        payload: serde_json::Value,
    },
    /// A user LEFT the org's presence set.
    ///
    /// Two paths fire this:
    ///   1. `DELETE /api/v1/presence` — explicit "Appear Offline" /
    ///      sign-out. Broadcast immediately, before the evictor would
    ///      naturally observe the absent heartbeat.
    ///   2. The 30s `presence::evictor` task — when a `user_id`'s
    ///      `expires_at` (last_seen_at + 90s) is in the past, the
    ///      evictor removes the HSET row and broadcasts `PresenceLeft`
    ///      so connected tabs can drop the user from their UI.
    PresenceLeft {
        user_id: String,
        organization_id: Uuid,
    },
    /// Tier 2 #1 (2026-05-06) — soft-locking signal: a user is
    /// focused on (or just left) a specific row of a DataTable.
    ///
    /// Sibling pattern to `PresenceJoined / PresenceUpdated /
    /// PresenceLeft` but keyed on `(entity_kind, entity_id)` instead
    /// of `user_id` alone. Backed by a separate Redis schema
    /// (`presence:focus:{org_id}:{entity_kind}:{entity_id}` HSET +
    /// matching ZSET expirations) with a 30s TTL — half of presence's
    /// 90s because focus leases are short-lived (a user typically
    /// stops "focusing" the moment they navigate away).
    ///
    /// `action ∈ {"enter", "leave", "heartbeat"}`. FE handlers
    /// filter on `entity_kind + entity_id` so the same WS singleton
    /// can multiplex focus signals across many DataTables.
    /// `organization_id` is REQUIRED so the deny-by-default org
    /// filter in `handle_socket`'s send loop covers it for free.
    EntityFocus {
        entity_kind: String,
        entity_id: String,
        user_id: Uuid,
        organization_id: Uuid,
        /// `"enter"` — first heartbeat for this focus lease.
        /// `"heartbeat"` — subsequent refresh.
        /// `"leave"` — explicit DELETE or evictor expiry.
        action: String,
    },
    /// Tier 2 #2 (2026-05-06) — server-pushed user notification.
    ///
    /// Driven by the `notification_created` Postgres NOTIFY trigger
    /// (migration 271). FE recipients MUST defence-in-depth check
    /// `event.user_id === currentUserId` before reacting — the
    /// org-scope filter on the WS send loop guards cross-tenant
    /// leaks, but a notification is per-user (not per-org), so the
    /// per-user check is the FE's responsibility.
    ///
    /// `kind` is the event-class label (e.g. `"sap_job_complete"`,
    /// `"reservation_escalated"`, `"ticket_assigned"`); `severity`
    /// mirrors the existing `notification_type` enum
    /// (`info|warning|error|success`). `body`, `link`, `severity`
    /// are optional so simple notifications stay terse.
    Notification {
        notification_id: Uuid,
        user_id: Uuid,
        organization_id: Uuid,
        kind: String,
        title: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        body: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        link: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        severity: Option<String>,
    },
    /// A `public.sap_agent_jobs` row was inserted/updated/deleted.
    ///
    /// Driven by the `sap_agent_job_changed` Postgres NOTIFY trigger
    /// (migration 271). Replaces the per-job ephemeral
    /// `supabase.channel('sap-agent-job-{id}')` callsite in
    /// `src/features/admin/sap-testing/hooks/use-job-queue.ts`. The
    /// per-job channel churn was the wart this migration retires —
    /// every queued job used to spin up a short-lived Supabase Realtime
    /// channel, tear it down 250ms after terminal status. The single
    /// long-lived `WorkServiceWebSocket` singleton + a fan-out filter
    /// on `event.job_id === row.id` is more efficient at fleet scale.
    ///
    /// `organization_id` is REQUIRED — `sap_agent_jobs.organization_id`
    /// is `NOT NULL` (migration 245).
    SapJobStatusChanged {
        job_id: Uuid,
        organization_id: Uuid,
        status: String,
        /// Optional agent-reported step label (e.g. "Logging in",
        /// "Posting GR"). Only set on UPDATE; null otherwise.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        step: Option<String>,
        op: String,
    },
    /// A `public.sap_outbound_to_import_runs` row changed.
    ///
    /// Driven by the `sap_import_run_changed` Postgres NOTIFY trigger
    /// (migration 272). Replaces the per-run ephemeral
    /// `supabase.channel('lt22-import-run-{id}')` callsite in
    /// `src/features/outbound/components/import-lt22-dialog.tsx`. Same
    /// ephemeral-channel-churn pattern as `SapJobStatusChanged`.
    ///
    /// `organization_id` is REQUIRED — table column is `NOT NULL`.
    ImportRunStatusChanged {
        run_id: Uuid,
        organization_id: Uuid,
        status: String,
        /// Agent-reported imported-row count on completion. Null while
        /// queued/running.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        rows_imported: Option<i64>,
        op: String,
    },
    /// A `public.rr_cyclecount_data` row changed.
    ///
    /// Driven by the `cycle_count_data_changed` Postgres NOTIFY trigger
    /// (migration 273). Replaces the org-filtered
    /// `supabase.channel('cycle-count-changes-{orgId}')` callsite in
    /// `src/hooks/use-cycle-count-operations.ts`. The frontend handler
    /// invalidates the cycle-count + statistics TanStack queries on
    /// every change, so the payload only carries the row id + op.
    ///
    /// `organization_id` is REQUIRED — `rr_cyclecount_data.organization_id`
    /// is `NOT NULL`.
    CycleCountOperationChanged {
        row_id: Uuid,
        organization_id: Uuid,
        op: String,
    },
    /// A `public.rr_lx03_data` row changed.
    ///
    /// Driven by the `lx03_data_changed` Postgres NOTIFY trigger
    /// (migration 274). Replaces the unfiltered
    /// `supabase.channel('lx03-data-changes')` callsite in
    /// `src/hooks/use-lx03-data.ts`.
    ///
    /// `organization_id` is `Option<Uuid>` — the column is NULLABLE in
    /// the schema. NULL-org events are treated as "system-wide" by the
    /// per-socket send-loop and broadcast to every connected client,
    /// preserving the existing pre-migration behaviour of the
    /// unfiltered Supabase channel. The frontend defends-in-depth by
    /// ignoring events whose `organization_id` doesn't match the
    /// user's org.
    Lx03DataChanged {
        row_id: Uuid,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        organization_id: Option<Uuid>,
        op: String,
    },
    /// A `public.rf_putaway_operations` row was inserted or updated.
    ///
    /// Driven by the `rf_putaway_operation_changed` Postgres NOTIFY
    /// trigger (migration 276). Phase 4 of the rust-work-service
    /// integration plan — the OmniFrame on-prem agent consumes this
    /// variant via `omni_agent/work_service_ws.py` instead of the
    /// previous direct Supabase Realtime subscription on the same
    /// table. Replaces the largest remaining Realtime consumer left in
    /// the agent (the cycle that compounded the
    /// `Presence_shard*`-overload outage on 2026-05-06).
    ///
    /// `new` is `row_to_jsonb(NEW)` — the agent's
    /// `_on_rf_putaway_change` evaluator already only inspects the
    /// fields present in `NEW` (`to_status`, `is_mca_workflow`,
    /// `confirmed_source`, `to_number`, `warehouse`), so this matches
    /// the legacy Realtime `record` shape 1:1. Loose-typed
    /// (`serde_json::Value`) so the Rust crate doesn't have to mirror
    /// the on-disk schema — extending the row payload is a Postgres-
    /// only change.
    ///
    /// `organization_id` is REQUIRED — `rf_putaway_operations.organization_id`
    /// is `NOT NULL`. The deny-by-default org-scope filter in
    /// `handle_socket`'s send loop covers this for free.
    RfPutawayChanged {
        row_id: Uuid,
        organization_id: Uuid,
        /// `'INSERT'` | `'UPDATE'` per the trigger.
        op: String,
        /// `row_to_jsonb(NEW)` — full new row payload.
        new: serde_json::Value,
    },
    /// Phase 6 (2026-05-07) — fleet-wide live console streaming.
    ///
    /// Pushed by `POST /api/v1/sap-console/lines` whenever the OmniFrame
    /// SAP agent's `_console_relay_thread` flushes a batch of recent
    /// stdout/stderr lines (behind `OMNIFRAME_AGENT_CONSOLE_RELAY=1`).
    /// The Rust route fans out one event PER line, scoped to the
    /// agent's `organization_id`, and any FE socket subscribed to that
    /// org sees it in the SAP Console card in <100ms after the agent
    /// printed it.
    ///
    /// `agent_id` is the same `<COMPUTERNAME>-<SESSIONNAME>-<USERNAME>`
    /// stable id used in `sap_agents.id` (migration 247) so the FE can
    /// label or filter lines per-agent without an extra join.
    /// `level` is the agent-supplied severity tag (`info|warn|error|
    /// debug|trace`) — small fixed vocabulary so dashboards can colour
    /// rows; the route does NOT validate it (we want a future
    /// `notice|critical` rollout to be wire-compatible).
    /// `ts` is the agent-side wall-clock timestamp of the print, NOT
    /// the time the line was relayed — useful when a backlog drains
    /// after the agent reconnected.
    ///
    /// `organization_id` is REQUIRED so the deny-by-default org-scope
    /// filter in `handle_socket`'s send loop covers it for free.
    /// Cross-tenant leaks are impossible by construction.
    ///
    /// See `Implementations/Implement-Rust-Work-Service-Phase6.md` for
    /// the full pipeline (agent buffer ➜ batched POST ➜ Redis token
    /// bucket ➜ broadcast).
    SapAgentConsoleLine {
        agent_id: String,
        organization_id: Uuid,
        /// `"info" | "warn" | "error" | "debug" | "trace"` — agent's
        /// preferred level vocabulary; FE renders a colour from it.
        level: String,
        message: String,
        ts: chrono::DateTime<chrono::Utc>,
    },
    /// Phase 9 (2026-05-07) — server-side trigger DSL evaluator fired.
    ///
    /// Pushed by `crate::triggers::evaluator` whenever a row event
    /// matches an enabled `agent_triggers` rule, the loop-detection
    /// counter is under the cap, AND the `sap_agent_jobs` INSERT
    /// succeeded (i.e. the rule actually queued work — duplicate-
    /// idempotency hits do NOT broadcast).
    ///
    /// FE consumes this via the rewritten "Agent Triggers" admin tab
    /// (`agent-triggers-tab.tsx`) to render the live "trigger fire
    /// stream" — a real-time ticker showing every fire across the
    /// org. Replaces the in-memory `EventLogEntry` list that the
    /// browser-side `useAgentTriggerRuntime` hook used to maintain
    /// (the hook is deleted in this phase).
    ///
    /// Carries ONLY the metadata needed for FE display + future
    /// audit-log lookups. The FULL row payload (which the Rust
    /// evaluator inspects on the server side) is intentionally NOT
    /// in the WS payload — that would re-introduce the row-leak
    /// concern the original `ADR-WsEvent-Typed-vs-Envelope` raised
    /// against a generic envelope. See
    /// `memorybank/OmniFrame/Decisions/ADR-Trigger-DSL-Evaluator-Phase9.md`.
    ///
    /// `organization_id` is REQUIRED so the deny-by-default org-
    /// scope filter in `handle_socket`'s send loop covers it for
    /// free. Cross-tenant leaks are impossible by construction.
    TriggerFired {
        trigger_id: Uuid,
        source_row_id: Uuid,
        target_endpoint: String,
        job_id: Uuid,
        organization_id: Uuid,
    },
    /// P2 of OmniBelt MVP (2026-05-24) — admin config changed for an
    /// org. Fires when ANY row in `omnibelt_role_config` for the org
    /// is inserted, updated, or deleted (driven by the
    /// `omnibelt_role_config_notify` AFTER trigger from migration 327).
    /// The frontend `useOmnibeltConfigInvalidator` subscribes and
    /// invalidates the `['omnibelt', 'bootstrap']` TanStack Query so
    /// every connected user in the org pulls fresh config in <1s.
    ///
    /// `organization_id` is REQUIRED — `omnibelt_role_config.organization_id`
    /// is `NOT NULL`. Carrying it as a non-Option `Uuid` lets the
    /// deny-by-default org-scope filter in `handle_socket`'s send
    /// loop cover this variant for free.
    ///
    /// On receipt the PgListener ALSO DELs `omnibelt:bootstrap:{org_id}:*`
    /// keys from Redis so a cache miss on the next bootstrap fetch
    /// observes the new config (the FE invalidate alone would still
    /// see the stale Redis value via the rust-dashboard endpoint).
    OmnibeltConfigChanged {
        organization_id: Uuid,
    },
}

impl WsEvent {
    /// Stable, allocation-free variant name suitable for a Prometheus
    /// label. Item 7a (post-audit, 2026-05-07) — used by
    /// [`broadcast_event`] to bump
    /// `work_ws_messages_sent_total{variant=...}` exactly once per
    /// broadcast publication. The string MUST exactly match the
    /// matching entry in `metrics::KNOWN_WS_EVENT_VARIANTS`; a CI
    /// test in this module enforces the symmetry.
    pub fn variant_name(&self) -> &'static str {
        match self {
            WsEvent::TaskAssigned { .. } => "TaskAssigned",
            WsEvent::TaskStatusChanged { .. } => "TaskStatusChanged",
            WsEvent::WorkerStatusChanged { .. } => "WorkerStatusChanged",
            WsEvent::QueueStatsUpdated { .. } => "QueueStatsUpdated",
            WsEvent::PushedWork { .. } => "PushedWork",
            WsEvent::Heartbeat { .. } => "Heartbeat",
            WsEvent::ReservationEscalated { .. } => "ReservationEscalated",
            WsEvent::ClaimBlockedByZone { .. } => "ClaimBlockedByZone",
            WsEvent::SapAgentChanged { .. } => "SapAgentChanged",
            WsEvent::PresenceJoined { .. } => "PresenceJoined",
            WsEvent::PresenceUpdated { .. } => "PresenceUpdated",
            WsEvent::PresenceLeft { .. } => "PresenceLeft",
            WsEvent::EntityFocus { .. } => "EntityFocus",
            WsEvent::Notification { .. } => "Notification",
            WsEvent::SapJobStatusChanged { .. } => "SapJobStatusChanged",
            WsEvent::ImportRunStatusChanged { .. } => "ImportRunStatusChanged",
            WsEvent::CycleCountOperationChanged { .. } => "CycleCountOperationChanged",
            WsEvent::Lx03DataChanged { .. } => "Lx03DataChanged",
            WsEvent::RfPutawayChanged { .. } => "RfPutawayChanged",
            WsEvent::SapAgentConsoleLine { .. } => "SapAgentConsoleLine",
            WsEvent::TriggerFired { .. } => "TriggerFired",
            WsEvent::OmnibeltConfigChanged { .. } => "OmnibeltConfigChanged",
        }
    }

    /// Returns the organization scope for this event, when set, so the
    /// fan-out can filter by per-client subscription.
    pub fn organization_id(&self) -> Option<Uuid> {
        match self {
            WsEvent::TaskAssigned { organization_id, .. } => *organization_id,
            WsEvent::TaskStatusChanged { organization_id, .. } => *organization_id,
            WsEvent::WorkerStatusChanged { organization_id, .. } => *organization_id,
            WsEvent::QueueStatsUpdated { organization_id, .. } => *organization_id,
            WsEvent::PushedWork { organization_id, .. } => *organization_id,
            WsEvent::Heartbeat { organization_id, .. } => *organization_id,
            WsEvent::ReservationEscalated { organization_id, .. } => *organization_id,
            // T-3 (2026-05-18) ClaimBlockedByZone carries a required
            // (non-Option) Uuid so the deny-by-default send-loop filter
            // covers it without needing a fallback.
            WsEvent::ClaimBlockedByZone { organization_id, .. } => Some(*organization_id),
            // SapAgentChanged carries a non-Option organization_id —
            // wrap it so the existing send-loop filter can compare it
            // against the per-socket subscription. Migration 270's
            // trigger guarantees the field is present for every row.
            WsEvent::SapAgentChanged { organization_id, .. } => Some(*organization_id),
            // Presence variants (Option 2 — server-side presence in
            // rust-work-service). Each carries a required `Uuid` so the
            // org-filter in `handle_socket`'s send loop covers them.
            WsEvent::PresenceJoined { organization_id, .. } => Some(*organization_id),
            WsEvent::PresenceUpdated { organization_id, .. } => Some(*organization_id),
            WsEvent::PresenceLeft { organization_id, .. } => Some(*organization_id),
            // Tier 2 (2026-05-06) — entity_focus + notifications.
            // Both carry a required `Uuid` `organization_id`; the
            // send-loop's deny-by-default filter covers them for free.
            WsEvent::EntityFocus { organization_id, .. } => Some(*organization_id),
            WsEvent::Notification { organization_id, .. } => Some(*organization_id),
            // Tier 1 deferred-channel migrations (2026-05-06 sprint —
            // see Migrate-Tier1-Deferred-Channels-To-Rust-WS.md).
            //
            // SAP variants carry a required Uuid; cycle-count mirrors
            // the underlying schema's NOT NULL org_id. `Lx03DataChanged`
            // is the sole NULLABLE org_id in this batch — see the
            // variant doc-comment for why (preserves the pre-migration
            // unfiltered Supabase channel behaviour).
            WsEvent::SapJobStatusChanged { organization_id, .. } => Some(*organization_id),
            WsEvent::ImportRunStatusChanged { organization_id, .. } => {
                Some(*organization_id)
            }
            WsEvent::CycleCountOperationChanged { organization_id, .. } => {
                Some(*organization_id)
            }
            WsEvent::Lx03DataChanged { organization_id, .. } => *organization_id,
            // Phase 4 (2026-05-06) — RfPutawayChanged carries a
            // required Uuid (table column is NOT NULL); wrap it so the
            // send-loop's deny-by-default org filter covers it.
            WsEvent::RfPutawayChanged { organization_id, .. } => Some(*organization_id),
            // Phase 6 (2026-05-07) — fleet-wide live console streaming.
            // `organization_id` is required (the route resolves it from
            // the caller's JWT; nothing on the wire is trusted) so the
            // deny-by-default org filter covers it for free.
            WsEvent::SapAgentConsoleLine { organization_id, .. } => Some(*organization_id),
            // Phase 9 (2026-05-07) — server-side trigger DSL evaluator
            // fired. `organization_id` is required (the evaluator
            // sources it from `agent_triggers.organization_id`, NOT
            // from any client input) so the deny-by-default org
            // filter covers it for free.
            WsEvent::TriggerFired { organization_id, .. } => Some(*organization_id),
            // P2 of OmniBelt MVP (2026-05-24) — `organization_id` is
            // required (the trigger payload always carries it) so the
            // deny-by-default org-scope filter covers this variant.
            WsEvent::OmnibeltConfigChanged { organization_id } => Some(*organization_id),
        }
    }
}

/// Messages sent from clients to server
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum WsClientMessage {
    /// Subscribe to organization events
    Subscribe {
        organization_id: Uuid,
    },
    /// Worker heartbeat with optional task info
    Heartbeat {
        task_id: Option<Uuid>,
        #[allow(dead_code)] // Deserialized from client messages; not yet processed server-side
        task_type: Option<String>,
        #[allow(dead_code)] // Deserialized from client messages; not yet processed server-side
        zone: Option<String>,
        #[allow(dead_code)] // Deserialized from client messages; not yet processed server-side
        location: Option<String>,
        status: String,
    },
    /// Unsubscribe from events
    Unsubscribe,
}

/// WS subscribe-token query (Phase 2.0 v1 decision — Item 16).
///
/// `?token=<v1.payload.sig>` is the canonical channel; clients on
/// platforms that can't set query params can fall back to the
/// `Sec-WebSocket-Protocol: ws-subscribe-token,<token>` subprotocol
/// (parsed from headers below).
#[derive(Debug, Deserialize, Default)]
pub struct WsUpgradeQuery {
    /// `WS-Subscribe-Token` from `POST /api/v1/work/ws-token`.
    #[serde(default)]
    pub token: Option<String>,
}

/// Whether the upgrade handler MUST reject token-less connections.
///
/// `WORK_WS_REQUIRE_TOKEN=1|true|on|yes` → strict mode (401 on missing /
/// invalid token). Default `false` so legacy clients can connect during
/// the cutover; the org-mismatch check on the Subscribe message still
/// runs in either mode.
fn require_token() -> bool {
    matches!(
        std::env::var("WORK_WS_REQUIRE_TOKEN")
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "on" | "yes"
    )
}

/// WebSocket upgrade handler.
///
/// Item 16 — Phase 2.0 v1 decision:
///   1. If `?token=…` is present (or the `Sec-WebSocket-Protocol`
///      subprotocol carries `ws-subscribe-token,<token>`), verify it
///      via `crate::ws_token::verify`. A valid token's claims are
///      attached to the socket so the `Subscribe` message handler can
///      enforce `organization_id` match.
///   2. If no token is supplied AND `WORK_WS_REQUIRE_TOKEN=true`,
///      reject the upgrade with HTTP 401. Otherwise continue (legacy
///      bypass — documented behind the env gate).
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    Query(q): Query<WsUpgradeQuery>,
    headers: axum::http::HeaderMap,
) -> impl IntoResponse {
    tracing::info!("WebSocket connection request received");

    // Token discovery: query param first (canonical), then subprotocol
    // header for browser-fetch fallback.
    let token = q.token.clone().or_else(|| {
        headers
            .get("Sec-WebSocket-Protocol")
            .and_then(|v| v.to_str().ok())
            .and_then(|raw| {
                // Subprotocol values are CSV. Match
                //   `ws-subscribe-token, <token>`
                let mut parts = raw.split(',').map(str::trim);
                if parts.next()? == "ws-subscribe-token" {
                    parts.next().map(String::from)
                } else {
                    None
                }
            })
    });

    let claims = match token.as_deref() {
        Some(t) => match verify_ws_token(t) {
            Ok(c) => Some(c),
            Err(e) => {
                metrics::WORK_WS_AUTH_FAILURE_TOTAL
                    .with_label_values(&["bad_sig"])
                    .inc();
                tracing::warn!(?e, "ws upgrade rejected: invalid WS-Subscribe-Token");
                return (
                    StatusCode::UNAUTHORIZED,
                    "invalid WS-Subscribe-Token",
                )
                    .into_response();
            }
        },
        None if require_token() => {
            metrics::WORK_WS_AUTH_FAILURE_TOTAL
                .with_label_values(&["missing_token"])
                .inc();
            tracing::warn!("ws upgrade rejected: missing WS-Subscribe-Token (strict mode)");
            return (
                StatusCode::UNAUTHORIZED,
                "missing WS-Subscribe-Token",
            )
                .into_response();
        }
        None => None,
    };

    ws.on_upgrade(move |socket| handle_socket(socket, state, claims))
        .into_response()
}

/// Handle individual WebSocket connection.
///
/// Per-org filtering: clients send a `Subscribe { organization_id }` after
/// connecting; the send loop only forwards events whose `organization_id`
/// is None (system-wide) or matches the subscription.
///
/// Migration 253 review (deny-by-default): before a Subscribe arrives,
/// `subscribed_org` is None. Previously the filter only triggered when
/// BOTH sides were Some, so org-scoped events broadcast freely to every
/// pre-Subscribe socket — a cross-tenant leak in the connect → first-
/// Subscribe window. We now drop ANY org-scoped event when the socket
/// has no subscription yet. Truly system-wide events
/// (`organization_id = None`) still pass through.
///
/// Item 16 (Phase 2.0 v1): when a `WS-Subscribe-Token` was presented at
/// upgrade, the verified claims are pinned to this socket. Subscribe
/// messages whose `organization_id` doesn't match `claims.organization_id`
/// close the socket and emit
/// `work_ws_auth_failure_total{reason="org_mismatch"}` (metric name
/// stable; counter only fires when the prometheus dep is enabled).
async fn handle_socket(
    socket: WebSocket,
    state: Arc<AppState>,
    token_claims: Option<WsTokenClaims>,
) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.ws_broadcast.subscribe();

    tracing::info!(
        bound_org = ?token_claims.as_ref().map(|c| c.organization_id),
        "WebSocket client connected"
    );

    // Item 14 — IntGauge inc on connect, dec on drop. Pre-Subscribe the
    // org_hash is "unbound"; once a Subscribe message lands we rebind to
    // the operator's org. Drop is RAII so abnormal exits stay balanced.
    let initial_org_hash = token_claims
        .as_ref()
        .map(|c| metrics::org_hash_label(&c.organization_id))
        .unwrap_or_else(|| "unbound".to_string());
    let mut subscriber_guard = metrics::WsSubscriberGuard::new(initial_org_hash, "all");

    // Subscription state shared between the send loop and the receive loop.
    let subscribed_org = Arc::new(tokio::sync::RwLock::new(None::<Uuid>));
    let subscribed_org_send = subscribed_org.clone();

    // Spawn task to forward broadcast events to this client (filtered per org).
    //
    // 2026-05-06 — switched from `while let Ok(event) = rx.recv().await`
    // to an explicit `match` so `broadcast::RecvError::Lagged(n)` is
    // observable. Previously a slow consumer (or a flood of events
    // larger than the 1000-slot buffer) silently lost events; we now
    // emit a `tracing::warn!` + increment
    // `work_service_ws_lagged_events_total{org_hash=...}` per
    // Lagged tick so the SRE can correlate. We KEEP receiving (the
    // receiver auto-resyncs) — disconnecting on Lagged would punish
    // the client for the server's queue pressure.
    //
    // 2026-05-06 (Phase 2 telemetry foundation) — additionally sample
    // the broadcast-buffer headroom gauge on every successful recv so
    // SREs see the leading indicator (how close are we to the cliff)
    // alongside the after-the-fact `work_ws_lagged_events_total`.
    // RUNBOOK: docs/runbooks/work-engine/ws-lagged-events.md
    let send_task = tokio::spawn(async move {
        loop {
            let event = match rx.recv().await {
                Ok(event) => {
                    // Phase 2 — broadcast-buffer headroom sample.
                    // `rx.len()` is the per-receiver lag (how many events
                    // queued for THIS receiver but not yet delivered).
                    // 100% ⇒ caught up; 0% ⇒ at capacity (the next event
                    // will trip the Lagged counter). Last-write-wins per
                    // org_hash bucket is fine — the gauge is a sample,
                    // not a per-socket truth.
                    let lag = rx.len();
                    let cap = BROADCAST_CHANNEL_CAPACITY;
                    let pct = if cap == 0 {
                        100.0
                    } else {
                        let headroom = cap.saturating_sub(lag) as f64;
                        (headroom / cap as f64) * 100.0
                    };
                    let current_org = *subscribed_org_send.read().await;
                    let org_hash = current_org
                        .as_ref()
                        .map(metrics::org_hash_label)
                        .unwrap_or_else(|| "unbound".to_string());
                    metrics::WORK_WS_BROADCAST_BUFFER_PCT
                        .with_label_values(&[&org_hash])
                        .set(pct);
                    event
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    let current_org = *subscribed_org_send.read().await;
                    let org_hash = current_org
                        .as_ref()
                        .map(metrics::org_hash_label)
                        .unwrap_or_else(|| "unbound".to_string());
                    metrics::WORK_WS_LAGGED_EVENTS_TOTAL
                        .with_label_values(&[&org_hash])
                        .inc_by(n);
                    // The buffer is by definition AT capacity at this
                    // point — record 0% headroom so the gauge reflects
                    // the cliff, not the post-resync recovery.
                    metrics::WORK_WS_BROADCAST_BUFFER_PCT
                        .with_label_values(&[&org_hash])
                        .set(0.0);
                    tracing::warn!(
                        lagged = n,
                        organization_id = ?current_org,
                        metric = metrics::names::WORK_WS_LAGGED_EVENTS_TOTAL,
                        "ws send loop lagged — dropped {} broadcast events; receiver resynced",
                        n
                    );
                    continue;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    tracing::debug!("ws broadcast channel closed; ending send loop");
                    break;
                }
            };

            let sub = *subscribed_org_send.read().await;
            let event_org = event.organization_id();

            match (sub, event_org) {
                // Both sides scoped — match on org. Mismatch drops.
                (Some(client_org), Some(ev_org)) if client_org != ev_org => continue,
                // Org-scoped event with NO subscription on this socket =>
                // deny by default. This closes the cross-tenant leak in
                // the connect → first-Subscribe window.
                (None, Some(_)) => continue,
                // System-wide events (event_org None) always pass.
                // Subscribed client receiving its own org's event passes.
                _ => {}
            }

            let json = match serde_json::to_string(&event) {
                Ok(j) => j,
                Err(e) => {
                    tracing::error!("Failed to serialize WebSocket event: {}", e);
                    continue;
                }
            };
            if sender.send(Message::Text(json)).await.is_err() {
                tracing::debug!("WebSocket send failed, client likely disconnected");
                break;
            }
        }
    });

    // Handle incoming messages from client
    while let Some(Ok(msg)) = receiver.next().await {
        match msg {
            Message::Text(text) => {
                match serde_json::from_str::<WsClientMessage>(&text) {
                    Ok(WsClientMessage::Heartbeat {
                        task_id,
                        task_type,
                        zone,
                        location,
                        status,
                    }) => {
                        // Persist WS heartbeats so Active Operators stays
                        // accurate when the frontend prefers WS over HTTP.
                        // Requires user_id from the session — not yet wired
                        // through the upgrade handshake, so we fall back to
                        // the HTTP path if user_id is missing.
                        tracing::debug!(
                            "WebSocket heartbeat: task_id={:?}, status={}",
                            task_id,
                            status
                        );
                        // Persistence is intentionally NOT done here until
                        // auth-on-upgrade lands. The frontend's
                        // useWorkerHeartbeat falls back to HTTP for
                        // stateful heartbeats — see
                        // src/hooks/use-pushed-work.ts comment block.
                        let _ = (task_type, zone, location);
                        let org_for_event = *subscribed_org.read().await;
                        let _ = broadcast_event(
                            &state.ws_broadcast,
                            WsEvent::Heartbeat {
                                user_id: uuid::Uuid::nil(),
                                organization_id: org_for_event,
                            },
                        );
                    }
                    Ok(WsClientMessage::Subscribe { organization_id }) => {
                        // Item 16 — when a token was presented at upgrade,
                        // require the Subscribe org to match the token's
                        // org. Mismatch = close the socket and emit the
                        // org_mismatch counter (Item 14).
                        if let Some(claims) = token_claims.as_ref() {
                            if claims.organization_id != organization_id {
                                metrics::WORK_WS_AUTH_FAILURE_TOTAL
                                    .with_label_values(&["org_mismatch"])
                                    .inc();
                                tracing::warn!(
                                    token_org = %claims.organization_id,
                                    requested_org = %organization_id,
                                    metric = metrics::names::WORK_WS_AUTH_FAILURE_TOTAL,
                                    reason = "org_mismatch",
                                    "ws subscribe org mismatch — closing socket"
                                );
                                break;
                            }
                        }
                        tracing::info!(
                            "Client subscribed to organization: {}",
                            organization_id
                        );
                        // Rebind the subscriber gauge to the operator's
                        // org now that we know it.
                        subscriber_guard
                            .rebind_org(metrics::org_hash_label(&organization_id));
                        *subscribed_org.write().await = Some(organization_id);
                    }
                    Ok(WsClientMessage::Unsubscribe) => {
                        tracing::debug!("Client unsubscribed from events");
                        *subscribed_org.write().await = None;
                    }
                    Err(e) => {
                        tracing::warn!("Failed to parse WebSocket message: {} - raw: {}", e, text);
                    }
                }
            }
            Message::Ping(_) => {
                tracing::trace!("Received WebSocket ping");
                // Axum handles pong automatically
            }
            Message::Close(_) => {
                tracing::info!("Client closed WebSocket connection");
                break;
            }
            _ => {}
        }
    }

    // Clean up: abort the send task. The subscriber_guard's Drop impl
    // decrements the WS subscribers gauge.
    send_task.abort();
    drop(subscriber_guard);
    tracing::info!("WebSocket client disconnected");
}

/// Capacity of the per-process WS broadcast channel.
///
/// Sized empirically at the 2026-05-06 sprint; doubling has the
/// memory cost discussed in the broadcast-channel sizing ADR.
/// Exposed publicly so the Phase 2 broadcast-buffer gauge sampler
/// can compute headroom percentage WITHOUT having to reach back
/// into the `Sender` (Tokio doesn't expose `capacity()` on broadcast).
pub const BROADCAST_CHANNEL_CAPACITY: usize = 1000;

/// Create a broadcast channel for WebSocket events
///
/// Returns a tuple of (sender, receiver) where sender is cloned into AppState
/// and receiver can be used for testing or monitoring.
pub fn create_broadcast_channel() -> (broadcast::Sender<WsEvent>, broadcast::Receiver<WsEvent>) {
    broadcast::channel(BROADCAST_CHANNEL_CAPACITY)
}

/// Item 7a (post-audit, 2026-05-07) — single instrumentation point
/// for every `WsEvent` broadcast.
///
/// Increments `work_ws_messages_sent_total{variant=...}` BEFORE
/// delegating to `tx.send`. The pre-`send` ordering guarantees the
/// counter advances even when there are zero subscribers (the
/// broadcast channel returns `Err(SendError(_))` in that case but
/// the metric still represents "the service tried to publish this
/// event"). This matches the operator mental model — "did we
/// publish anything?" — and pairs with `WORK_WS_LAGGED_EVENTS_TOTAL`
/// + `WORK_WS_BROADCAST_BUFFER_PCT` for the receive-side picture.
///
/// Production callsites SHOULD prefer this helper over
/// `tx.send(event)` directly. The handful of test-only callsites
/// (e.g. the `sap_console.rs` unit tests) are exempt — they rely
/// on direct sender/receiver round-trips and don't need the
/// metric to be incremented.
///
/// The return type intentionally mirrors `broadcast::Sender::send`
/// verbatim so callsites can do a drop-in textual rewrite of
/// `tx.send(event)` → `broadcast_event(&tx, event)`. clippy's
/// `result_large_err` lint flags the ~248-byte `Err` variant as
/// large (the inner `WsEvent` is the biggest enum variant), but
/// boxing the error would force every callsite to change its
/// error-handling shape, which defeats the drop-in goal. Keep
/// the return shape stable.
#[allow(clippy::result_large_err)]
pub fn broadcast_event(
    tx: &broadcast::Sender<WsEvent>,
    event: WsEvent,
) -> Result<usize, broadcast::error::SendError<WsEvent>> {
    crate::observability::metrics::WORK_WS_MESSAGES_SENT_TOTAL
        .with_label_values(&[event.variant_name()])
        .inc();
    tx.send(event)
}

#[cfg(test)]
mod ws_event_tests {
    use super::*;
    use crate::observability::metrics::KNOWN_WS_EVENT_VARIANTS;
    use std::collections::HashSet;

    fn sample_events() -> Vec<WsEvent> {
        // One sample per variant — keep in sync with `WsEvent`.
        // `variant_name` is exhaustive on the enum, so adding a
        // variant breaks the match if this list isn't updated;
        // the test below catches any silent skip.
        let nil = uuid::Uuid::nil();
        vec![
            WsEvent::TaskAssigned {
                task_id: nil,
                user_id: nil,
                priority: "normal".into(),
                location: "L".into(),
                material: "M".into(),
                organization_id: None,
            },
            WsEvent::TaskStatusChanged {
                task_id: nil,
                old_status: "pending".into(),
                new_status: "in_progress".into(),
                reason: None,
                organization_id: None,
            },
            WsEvent::WorkerStatusChanged {
                user_id: nil,
                status: "online".into(),
                organization_id: None,
            },
            WsEvent::QueueStatsUpdated {
                pending: 0,
                deferred_pending: 0,
                in_progress: 0,
                completed_today: 0,
                pushed_pending: 0,
                total_workers_online: 0,
                organization_id: None,
            },
            WsEvent::PushedWork {
                task_id: nil,
                user_id: nil,
                material: "M".into(),
                location: "L".into(),
                count_number: "1".into(),
                priority: "normal".into(),
                organization_id: None,
                target_zone: None,
                target_role: None,
                target_user_ids: None,
                broadcast_message: None,
            },
            WsEvent::Heartbeat {
                user_id: nil,
                organization_id: None,
            },
            WsEvent::ReservationEscalated {
                task_id: nil,
                previous_owner: nil,
                organization_id: None,
            },
            WsEvent::ClaimBlockedByZone {
                organization_id: nil,
                user_id: nil,
                task_type: "cycle_count".into(),
                unassigned_pending: 1,
                stuck_pending_assigned: 1,
            },
            WsEvent::SapAgentChanged {
                agent_id: "a".into(),
                organization_id: nil,
                status: "online".into(),
                last_seen_at: None,
                op: "UPDATE".into(),
            },
            WsEvent::PresenceJoined {
                user_id: "u".into(),
                organization_id: nil,
                payload: serde_json::json!({}),
            },
            WsEvent::PresenceUpdated {
                user_id: "u".into(),
                organization_id: nil,
                payload: serde_json::json!({}),
            },
            WsEvent::PresenceLeft {
                user_id: "u".into(),
                organization_id: nil,
            },
            WsEvent::EntityFocus {
                entity_kind: "row".into(),
                entity_id: "1".into(),
                user_id: nil,
                organization_id: nil,
                action: "enter".into(),
            },
            WsEvent::Notification {
                notification_id: nil,
                user_id: nil,
                organization_id: nil,
                kind: "info".into(),
                title: "t".into(),
                body: None,
                link: None,
                severity: None,
            },
            WsEvent::SapJobStatusChanged {
                job_id: nil,
                organization_id: nil,
                status: "queued".into(),
                step: None,
                op: "UPDATE".into(),
            },
            WsEvent::ImportRunStatusChanged {
                run_id: nil,
                organization_id: nil,
                status: "queued".into(),
                rows_imported: None,
                op: "UPDATE".into(),
            },
            WsEvent::CycleCountOperationChanged {
                row_id: nil,
                organization_id: nil,
                op: "UPDATE".into(),
            },
            WsEvent::Lx03DataChanged {
                row_id: nil,
                organization_id: None,
                op: "UPDATE".into(),
            },
            WsEvent::RfPutawayChanged {
                row_id: nil,
                organization_id: nil,
                op: "UPDATE".into(),
                new: serde_json::json!({}),
            },
            WsEvent::SapAgentConsoleLine {
                agent_id: "a".into(),
                organization_id: nil,
                level: "info".into(),
                message: "m".into(),
                ts: chrono::Utc::now(),
            },
            WsEvent::TriggerFired {
                trigger_id: nil,
                source_row_id: nil,
                target_endpoint: "/sap/confirm-to".into(),
                job_id: nil,
                organization_id: nil,
            },
            WsEvent::OmnibeltConfigChanged {
                organization_id: nil,
            },
        ]
    }

    #[test]
    fn variant_name_is_stable_for_every_variant() {
        // Smoke — `variant_name` returns a non-empty literal for
        // every enum variant. Catches a future no-arg variant
        // accidentally being added without a name mapping.
        for ev in sample_events() {
            let n = ev.variant_name();
            assert!(!n.is_empty(), "variant_name returned empty for {:?}", ev);
        }
    }

    #[test]
    fn ws_event_variant_names_match_known_set() {
        // Item 7b (post-audit, 2026-05-07) — `WsEvent::variant_name`
        // and `metrics::KNOWN_WS_EVENT_VARIANTS` MUST agree. If a
        // new variant is added to the enum without extending the
        // metrics constant, `init_zero_value_series` would silently
        // skip the new variant and the dashboard would miss the
        // series until the first event fires.
        let from_enum: HashSet<&str> =
            sample_events().iter().map(|e| e.variant_name()).collect();
        let from_metrics: HashSet<&str> = KNOWN_WS_EVENT_VARIANTS.iter().copied().collect();
        assert_eq!(
            from_enum, from_metrics,
            "WsEvent::variant_name and metrics::KNOWN_WS_EVENT_VARIANTS \
             diverged — extend the matching list when adding a variant. \
             Only-in-enum: {:?}; only-in-metrics: {:?}",
            from_enum.difference(&from_metrics).collect::<Vec<_>>(),
            from_metrics.difference(&from_enum).collect::<Vec<_>>(),
        );
    }

    #[tokio::test]
    async fn broadcast_event_increments_per_variant_counter() {
        // Item 7a — the helper increments the counter regardless of
        // whether any receiver consumes the event. We construct a
        // standalone broadcast channel so the global registry's
        // pre-existing counts stay isolated; the assertion compares
        // before/after delta.
        let (tx, _rx) = create_broadcast_channel();
        let counter = crate::observability::metrics::WORK_WS_MESSAGES_SENT_TOTAL
            .with_label_values(&["Heartbeat"]);
        let before = counter.get();
        let _ = broadcast_event(
            &tx,
            WsEvent::Heartbeat {
                user_id: uuid::Uuid::nil(),
                organization_id: None,
            },
        );
        assert_eq!(counter.get(), before + 1);
    }
}

// Created and developed by Jai Singh
