// Created and developed by Jai Singh
//! Prometheus metrics for the work-service (Phase 12.1, Item 14).
//!
//! All metrics are registered against a process-global `prometheus::Registry`
//! and exposed via `GET /metrics`. The `org_hash_label()` helper bounds
//! org-id label cardinality (4 hex chars) so Prometheus storage stays
//! finite no matter how many tenants we onboard.
//!
//! Instrumentation rule (Item 14): emit at the route boundary, never inside
//! the strategy trait methods. The 18 SQL invariants from §2.1 of the plan
//! must remain unperturbed.
//!
//! When this module is referenced by a code path the `prometheus` crate is
//! NOT yet able to compile in (e.g. cross-compilation environments without
//! the `process` feature), the static metric handles still compile because
//! `lazy_static!` defers their construction until first dereference.

use lazy_static::lazy_static;
use prometheus::{
    register_counter_vec_with_registry, register_gauge_vec_with_registry,
    register_histogram_vec_with_registry, register_int_counter_vec_with_registry,
    register_int_counter_with_registry, register_int_gauge_vec_with_registry, CounterVec, Encoder,
    GaugeVec, HistogramVec, IntCounter, IntCounterVec, IntGaugeVec, Registry, TextEncoder,
};

/// Metric names emitted by this service. Keep in sync with
/// `docs/work-engine/phase-12-observability.md`. Some constants are
/// referenced only via `tracing::warn!(metric = ...)` log fields, hence the
/// blanket `dead_code` allow.
#[allow(dead_code)]
pub mod names {
    pub const WORK_CLAIM_DURATION_SECONDS: &str = "work_claim_duration_seconds";
    pub const WORK_CLAIM_TOTAL: &str = "work_claim_total";
    pub const WORK_PUSH_DURATION_SECONDS: &str = "work_push_duration_seconds";
    pub const WORK_PUSH_FAILURE_TOTAL: &str = "work_push_failure_total";
    pub const WORK_COMPLETE_DURATION_SECONDS: &str = "work_complete_duration_seconds";
    pub const WORK_RELEASE_TOTAL: &str = "work_release_total";
    pub const WORK_QUEUE_DEPTH: &str = "work_queue_depth";
    pub const WORK_RESERVATION_AGE_SECONDS: &str = "work_reservation_age_seconds";
    pub const WORK_DISPATCHER_FAIRNESS: &str = "work_dispatcher_fairness";
    pub const WORK_WS_SUBSCRIBERS: &str = "work_websocket_subscribers";
    pub const WORK_WS_MESSAGES_TOTAL: &str = "work_websocket_messages_total";
    pub const WORK_IDEMPOTENCY_HITS_TOTAL: &str = "work_idempotency_hits_total";
    pub const WORK_PAYLOAD_VALIDATION_FAILURES_TOTAL: &str =
        "work_payload_validation_failures_total";
    pub const WORK_CAPABILITY_FALLBACK_TOTAL: &str = "work_capability_fallback_total";
    pub const WORK_STARVATION_TOTAL: &str = "work_starvation_total";
    pub const WORK_SETTINGS_REFRESH_TOTAL: &str = "work_settings_refresh_total";
    pub const WORK_WS_AUTH_FAILURE_TOTAL: &str = "work_ws_auth_failure_total";
    pub const WORK_IDEMPOTENCY_CLEANUP_TOTAL: &str = "work_idempotency_cleanup_total";
    /// Counter for `tokio::sync::broadcast::RecvError::Lagged` events on
    /// the per-socket WS receiver. Non-zero means a slow consumer fell
    /// behind the `broadcast::channel(1000)` buffer and silently lost
    /// events. Tier 1 multiplies event volume; we need to know NOW.
    /// RUNBOOK: docs/runbooks/work-engine/ws-lagged-events.md
    pub const WORK_WS_LAGGED_EVENTS_TOTAL: &str = "work_ws_lagged_events_total";
    /// Phase 2 telemetry foundation (2026-05-06) — broadcast-channel
    /// buffer headroom (% remaining) per-receiver. Sampled inside the WS
    /// send loop on each successful `rx.recv()`. Complements
    /// `WORK_WS_LAGGED_EVENTS_TOTAL`: the lagged counter is the
    /// after-the-fact count of dropped events, this gauge is the
    /// leading indicator that tells SREs how close we are to the cliff.
    /// 100 ⇒ healthy (no lag); 0 ⇒ at capacity, next event will lag.
    /// RUNBOOK: docs/runbooks/work-engine/ws-lagged-events.md
    pub const WORK_WS_BROADCAST_BUFFER_PCT: &str = "work_ws_broadcast_buffer_pct";
    /// Phase 2 telemetry foundation (2026-05-06) — total HTTP requests
    /// served, labelled by `route`, `method`, and `status`. Backs the
    /// `WorkServiceHealthFailing` alert (5xx rate) and per-route
    /// dashboards. Cardinality is bounded by axum's `MatchedPath`
    /// (template-form, e.g. `/api/v1/work/tasks/:id/complete`) instead
    /// of the raw URL.
    /// RUNBOOK: docs/runbooks/work-engine/service-health-failing.md
    pub const WORK_HTTP_REQUESTS_TOTAL: &str = "work_http_requests_total";
    /// Currently-tracked presence rows per org (sum of HSET cardinality).
    /// Sampled by the presence evictor every 30s. Bounded `org_hash` label.
    pub const WORK_PRESENCE_ACTIVE_USERS: &str = "work_presence_active_users";
    /// Counter of presence operations bucketed by `op = track | untrack | evict`.
    /// `track` covers both first-time JOIN and subsequent UPDATE heartbeats.
    pub const WORK_PRESENCE_TRACK_TOTAL: &str = "work_presence_track_total";
    /// Counter of Redis errors observed while reading/writing presence
    /// state. Non-zero ⇒ the presence subsystem is degraded; clients
    /// fall back to the safety-net interval the FE breaker enforces.
    pub const WORK_PRESENCE_REDIS_ERRORS_TOTAL: &str = "work_presence_redis_errors_total";
    /// Tier 2 #1 — currently-active entity focus leases per org
    /// (cardinality of `presence:focus:{org_id}:expirations` ZSET).
    /// Sampled by the entity_focus evictor every 30s.
    pub const WORK_ENTITY_FOCUS_ACTIVE: &str = "work_entity_focus_active";
    /// Tier 2 #1 — counter of focus operations bucketed by
    /// `op = track | untrack | evict`. `track` covers both first-time
    /// ENTER and subsequent HEARTBEAT refreshes (FE distinguishes via
    /// `WsEvent::EntityFocus.action`).
    pub const WORK_ENTITY_FOCUS_TOTAL: &str = "work_entity_focus_total";
    /// Tier 2 #1 — Redis errors observed by the entity_focus
    /// subsystem. Non-zero ⇒ soft-locking is degraded; the 30s TTL
    /// + FE 15s heartbeat cadence absorbs short outages naturally.
    pub const WORK_ENTITY_FOCUS_REDIS_ERRORS_TOTAL: &str =
        "work_entity_focus_redis_errors_total";
    /// Tier 2 #2 — counter of notification operations bucketed by
    /// `op = enqueue | mark_read | mark_all_read`. Bumped by the
    /// REST handlers; `enqueue` is bumped by the listener as a
    /// proxy for "events delivered to WS".
    pub const WORK_NOTIFICATIONS_TOTAL: &str = "work_notifications_total";
    /// Tier 2 #3 — counter of dispatch broadcasts by target type.
    /// Labels: `target_type = zone | role | users`.
    pub const WORK_DISPATCH_BROADCAST_TOTAL: &str = "work_dispatch_broadcast_total";
    /// Phase 7 (2026-05-06) — `claim_sap_agent_job` RPC outcomes per
    /// org. `outcome=hit` ⇒ a queued row was returned to the caller;
    /// `outcome=miss` ⇒ the queue was empty (or only had pinned rows
    /// targeting other agents). Backs the "agent draining" panel in
    /// the SAP agents dashboard. RUNBOOK: docs/runbooks/work-engine/.
    pub const SAP_JOBS_CLAIM_TOTAL: &str = "sap_jobs_claim_total";
    /// Phase 7 — claim-RPC end-to-end latency (ms). Histogram with
    /// buckets [10, 50, 100, 250, 500, 1000, 2500, 5000]. P95 should
    /// stay under 100ms in steady state; the 1000ms+ buckets fire on
    /// `FOR UPDATE SKIP LOCKED` contention with many agents in the
    /// org or cold-start CPU.
    pub const SAP_JOBS_CLAIM_LATENCY_MS: &str = "sap_jobs_claim_latency_ms";
    /// Phase 7 — terminal-state transition outcomes for the
    /// /jobs/:id/complete handler. `outcome=success` ⇒ exactly 1 row
    /// PATCHed; `outcome=state_mismatch` ⇒ 0 rows (watchdog already
    /// failed it, or another agent claimed the lease). Mirrors the
    /// agent-side `terminal-state-guards` v1.7.2 capability.
    pub const SAP_JOBS_COMPLETE_TOTAL: &str = "sap_jobs_complete_total";
    /// Phase 7 — failure transitions partitioned by `step` (the
    /// optional substring the agent supplies, e.g. `watchdog`,
    /// `dispatch`, `sap-com-hung`). Cardinality is bounded by the
    /// agent's literal step values — keep the agent-side step set
    /// small.
    pub const SAP_JOBS_FAIL_TOTAL: &str = "sap_jobs_fail_total";
    /// Resilient PgListener wrapper (2026-05-07 PgListener wedge fix) —
    /// gauge per LISTEN channel. `1` = connection is up and the recv
    /// loop is draining frames; `0` = the wrapper is reconnecting (or
    /// has not yet reached its first successful subscribe). Pairs with
    /// `WORK_PGLISTENER_LAST_MESSAGE_AGE_SECONDS` for alerting on
    /// silent socket death. RUNBOOK:
    /// `memorybank/OmniFrame/Implementations/Implement-Resilient-PgListener.md`.
    pub const WORK_PGLISTENER_STATUS: &str = "work_pglistener_status";
    /// Resilient PgListener wrapper — counter incremented every time
    /// the wrapper trips and rebuilds the underlying `PgListener`
    /// (TCP RST, watchdog timeout, sqlx `recv()` error, etc.). Steady-
    /// state should be ~0; a non-zero rate is the leading indicator
    /// the upstream (Railway / pgbouncer / Supabase NAT) is
    /// idle-killing connections.
    pub const WORK_PGLISTENER_RECONNECTS_TOTAL: &str =
        "work_pglistener_reconnects_total";
    /// Resilient PgListener wrapper — seconds since the channel last
    /// received any frame (real NOTIFY OR our own keepalive echo).
    /// Refreshed on every keepalive tick. The watchdog inside the
    /// drive loop force-reconnects when this gauge crosses the
    /// configured timeout (default 90s).
    pub const WORK_PGLISTENER_LAST_MESSAGE_AGE_SECONDS: &str =
        "work_pglistener_last_message_age_seconds";
    /// Resilient PgListener wrapper — counter of keepalive NOTIFYs
    /// emitted by THIS listener via `pg_notify('rust_work_service_keepalive', '<channel>')`.
    /// Each listener publishes its own keepalive on the configured
    /// cadence (default 30s). Steady-state should be a smooth
    /// 2-per-minute per channel.
    pub const WORK_PGLISTENER_KEEPALIVE_SENT_TOTAL: &str =
        "work_pglistener_keepalive_sent_total";
    /// Resilient PgListener wrapper — counter of keepalive NOTIFYs
    /// observed by THIS listener's PgListener task. Includes echoes
    /// of its own keepalive AND keepalives sent by sibling listeners
    /// (every resilient listener subscribes to the shared keepalive
    /// channel). Receiving any keepalive proves the dedicated TCP
    /// socket is alive; missing keepalives for >90s trips the
    /// watchdog.
    pub const WORK_PGLISTENER_KEEPALIVE_RECEIVED_TOTAL: &str =
        "work_pglistener_keepalive_received_total";
    /// Item 7a (post-audit, 2026-05-07) — per-`WsEvent`-variant
    /// counter incremented every time a `WsEvent` is broadcast
    /// through `crate::websocket::broadcast_event`. Pairs the
    /// existing direction/message_type cut with a stable variant
    /// label so dashboards can chart per-variant fan-out volume
    /// (`SapAgentChanged`, `RfPutawayChanged`, `TriggerFired`, …).
    /// All known variants are zero-initialised at registry
    /// creation so every series exists from boot.
    pub const WORK_WS_MESSAGES_SENT_TOTAL: &str = "work_ws_messages_sent_total";
    /// In-process auth cache (2026-05-31) — counter of
    /// `AuthClient::validate_token` cache lookups bucketed by
    /// `outcome = hit | miss`. A `hit` served the cached
    /// `validate-with-profile` result without an inter-service HTTP
    /// round-trip to rust-core-service; a `miss` fell through to the
    /// upstream call (and, on success, populated the cache). The
    /// hit-rate (`hit / (hit + miss)`) is the direct measure of how
    /// much auth load this L1 cache removes from rust-core. Bounded
    /// 2-value label.
    pub const WORK_AUTH_CACHE_TOTAL: &str = "work_auth_cache_total";
}

/// Stable bucket set for claim/complete/push latency histograms.
/// 5ms .. 10s — covers fast hits and slow path-rule cold loads.
pub const LATENCY_BUCKETS_SECONDS: &[f64] = &[
    0.005, 0.010, 0.025, 0.050, 0.100, 0.250, 0.500, 1.0, 2.5, 5.0, 10.0,
];

lazy_static! {
    /// Process-global Prometheus registry. We deliberately do NOT use the
    /// `prometheus::default_registry()` so test isolation stays clean.
    pub static ref REGISTRY: Registry = Registry::new();

    pub static ref WORK_CLAIM_DURATION: HistogramVec = register_histogram_vec_with_registry!(
        prometheus::HistogramOpts::new(
            names::WORK_CLAIM_DURATION_SECONDS,
            "Wall-clock duration of /work/claim (strategy resolve + claim_next_task).",
        )
        .buckets(LATENCY_BUCKETS_SECONDS.to_vec()),
        &["task_type", "strategy_phase", "outcome"],
        REGISTRY
    )
    .expect("register work_claim_duration_seconds");

    pub static ref WORK_CLAIM_TOTAL: IntCounterVec = register_int_counter_vec_with_registry!(
        names::WORK_CLAIM_TOTAL,
        "Total claim attempts and outcome (hit / miss / error).",
        &["task_type", "priority", "outcome"],
        REGISTRY
    )
    .expect("register work_claim_total");

    pub static ref WORK_PUSH_DURATION: HistogramVec = register_histogram_vec_with_registry!(
        prometheus::HistogramOpts::new(
            names::WORK_PUSH_DURATION_SECONDS,
            "Wall-clock duration of /work/push and /work/push_batch handlers.",
        )
        .buckets(LATENCY_BUCKETS_SECONDS.to_vec()),
        &["task_type", "mode"],
        REGISTRY
    )
    .expect("register work_push_duration_seconds");

    pub static ref WORK_PUSH_FAILURE_TOTAL: IntCounterVec = register_int_counter_vec_with_registry!(
        names::WORK_PUSH_FAILURE_TOTAL,
        "Push failures bucketed by reason. Non-zero in steady state = bug or churn.",
        &["task_type", "reason"],
        REGISTRY
    )
    .expect("register work_push_failure_total");

    pub static ref WORK_COMPLETE_DURATION: HistogramVec = register_histogram_vec_with_registry!(
        prometheus::HistogramOpts::new(
            names::WORK_COMPLETE_DURATION_SECONDS,
            "Wall-clock duration of /work/tasks/:id/complete.",
        )
        .buckets(LATENCY_BUCKETS_SECONDS.to_vec()),
        &["task_type", "has_supervisor_signoff"],
        REGISTRY
    )
    .expect("register work_complete_duration_seconds");

    pub static ref WORK_RELEASE_TOTAL: IntCounterVec = register_int_counter_vec_with_registry!(
        names::WORK_RELEASE_TOTAL,
        "Release events by kind (voluntary, abandonment_soft, escalation_hard, heartbeat_stale).",
        &["task_type", "kind"],
        REGISTRY
    )
    .expect("register work_release_total");

    pub static ref WORK_WS_SUBSCRIBERS: IntGaugeVec = register_int_gauge_vec_with_registry!(
        names::WORK_WS_SUBSCRIBERS,
        "Currently-connected WebSocket clients (org_hash bounded label).",
        &["org_hash", "task_type"],
        REGISTRY
    )
    .expect("register work_websocket_subscribers");

    pub static ref WORK_IDEMPOTENCY_HITS_TOTAL: IntCounterVec = register_int_counter_vec_with_registry!(
        names::WORK_IDEMPOTENCY_HITS_TOTAL,
        "Idempotency-Key replay hits per route. Non-zero ⇒ retries reaching us.",
        &["route"],
        REGISTRY
    )
    .expect("register work_idempotency_hits_total");

    pub static ref WORK_CAPABILITY_FALLBACK_TOTAL: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::WORK_CAPABILITY_FALLBACK_TOTAL,
            "Strategy resolved without the requested capability (require_capability=false).",
            &["task_type"],
            REGISTRY
        )
        .expect("register work_capability_fallback_total");

    pub static ref WORK_SETTINGS_REFRESH_TOTAL: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::WORK_SETTINGS_REFRESH_TOTAL,
            "LISTEN consumer cache invalidations. outcome=success|error.",
            &["outcome"],
            REGISTRY
        )
        .expect("register work_settings_refresh_total");

    pub static ref WORK_WS_AUTH_FAILURE_TOTAL: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::WORK_WS_AUTH_FAILURE_TOTAL,
            "WS upgrade / Subscribe rejections. reason=org_mismatch|expired|bad_sig|missing_token.",
            &["reason"],
            REGISTRY
        )
        .expect("register work_ws_auth_failure_total");

    /// Counter alongside the histogram for `work_payload_validation_failures_total`.
    /// Reserved for future schema-version drift detection (Phase 12.6).
    pub static ref WORK_PAYLOAD_VALIDATION_FAILURES: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::WORK_PAYLOAD_VALIDATION_FAILURES_TOTAL,
            "Payload schema validation failures (deploy version drift signal).",
            &["task_type", "payload_version"],
            REGISTRY
        )
        .expect("register work_payload_validation_failures_total");

    /// Bytes-counter alongside settings refresh to track NOTIFY pipe health.
    pub static ref WORK_STARVATION_TOTAL: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::WORK_STARVATION_TOTAL,
            "Tasks starved past their (priority, task_type) freshness budget.",
            &["task_type", "priority"],
            REGISTRY
        )
        .expect("register work_starvation_total");

    /// Counter for WS client message volume (in/out, by message type).
    pub static ref WORK_WS_MESSAGES_TOTAL: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::WORK_WS_MESSAGES_TOTAL,
            "Total WebSocket messages, labelled direction={in,out} and message_type.",
            &["direction", "message_type"],
            REGISTRY
        )
        .expect("register work_websocket_messages_total");

    /// Idempotency cleanup counter (rows removed per pass).
    pub static ref WORK_IDEMPOTENCY_CLEANUP_TOTAL: CounterVec =
        register_counter_vec_with_registry!(
            names::WORK_IDEMPOTENCY_CLEANUP_TOTAL,
            "Rows deleted by the idempotency TTL sweeper.",
            &[],
            REGISTRY
        )
        .expect("register work_idempotency_cleanup_total");

    /// `broadcast::RecvError::Lagged` counter. Each increment value is
    /// the number of dropped events the receiver was told about; we
    /// surface that as a separate gauge would lose the cumulative
    /// signal, so we increment by `n` per Lagged tick. The `org_hash`
    /// label reuses the cardinality-bounded helper (`org_hash_label`)
    /// so we can correlate with other WS metrics without unbounded
    /// label growth. `unbound` is the bucket for sockets that lagged
    /// before sending a `Subscribe` (unlikely but kept honest).
    /// RUNBOOK: docs/runbooks/work-engine/ws-lagged-events.md
    pub static ref WORK_WS_LAGGED_EVENTS_TOTAL: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::WORK_WS_LAGGED_EVENTS_TOTAL,
            "broadcast::RecvError::Lagged events on WS receivers (sum of dropped events). \
             Non-zero ⇒ a slow consumer fell behind the broadcast buffer.",
            &["org_hash"],
            REGISTRY
        )
        .expect("register work_ws_lagged_events_total");

    /// Server-side presence — currently-tracked users per org. Sampled
    /// by the presence evictor every 30s after running its eviction
    /// pass, so the gauge naturally trails the truth by one window.
    /// Reuses `org_hash_label()` so cardinality stays bounded.
    pub static ref WORK_PRESENCE_ACTIVE_USERS: IntGaugeVec =
        register_int_gauge_vec_with_registry!(
            names::WORK_PRESENCE_ACTIVE_USERS,
            "Server-side presence — currently-tracked users per org \
             (sum of `presence:org:{org_id}` HSET cardinality, sampled \
             by the evictor on every 30s pass).",
            &["org_hash"],
            REGISTRY
        )
        .expect("register work_presence_active_users");

    /// Server-side presence — total track / untrack / evict ops. The
    /// `track` bucket covers BOTH first-time JOIN and subsequent
    /// UPDATE heartbeats (FE distinguishes them via `WsEvent::type`,
    /// but a single per-op counter is enough for ops dashboards).
    pub static ref WORK_PRESENCE_TRACK_TOTAL: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::WORK_PRESENCE_TRACK_TOTAL,
            "Server-side presence operations (op = track | untrack | evict).",
            &["op"],
            REGISTRY
        )
        .expect("register work_presence_track_total");

    /// Server-side presence — Redis errors counter. Non-zero ⇒
    /// presence is degraded; the FE breaker + safety-net interval is
    /// expected to absorb the gap.
    pub static ref WORK_PRESENCE_REDIS_ERRORS_TOTAL: IntCounter =
        register_int_counter_with_registry!(
            names::WORK_PRESENCE_REDIS_ERRORS_TOTAL,
            "Redis errors observed by the presence subsystem (track / \
             untrack / get_org_presence / evict). Non-zero ⇒ presence \
             is degraded for at least one client.",
            REGISTRY
        )
        .expect("register work_presence_redis_errors_total");

    /// Tier 2 #1 — currently-active focus leases per org (sampled
    /// by the entity_focus evictor every 30s after running its sweep).
    /// Sibling of `WORK_PRESENCE_ACTIVE_USERS`.
    pub static ref WORK_ENTITY_FOCUS_ACTIVE: IntGaugeVec =
        register_int_gauge_vec_with_registry!(
            names::WORK_ENTITY_FOCUS_ACTIVE,
            "Tier 2 #1 — active entity focus leases per org (cardinality \
             of `presence:focus:{org_id}:expirations` ZSET, sampled by \
             the evictor every 30s).",
            &["org_hash"],
            REGISTRY
        )
        .expect("register work_entity_focus_active");

    /// Tier 2 #1 — counter of entity_focus operations bucketed by
    /// `op = track | untrack | evict`. Sibling of
    /// `WORK_PRESENCE_TRACK_TOTAL`.
    pub static ref WORK_ENTITY_FOCUS_TOTAL: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::WORK_ENTITY_FOCUS_TOTAL,
            "Tier 2 #1 — entity_focus operations (op = track | untrack | evict).",
            &["op"],
            REGISTRY
        )
        .expect("register work_entity_focus_total");

    /// Tier 2 #1 — Redis errors counter for the entity_focus
    /// subsystem.
    pub static ref WORK_ENTITY_FOCUS_REDIS_ERRORS_TOTAL: IntCounter =
        register_int_counter_with_registry!(
            names::WORK_ENTITY_FOCUS_REDIS_ERRORS_TOTAL,
            "Redis errors observed by the entity_focus subsystem. \
             Non-zero ⇒ soft-locking is degraded for at least one client.",
            REGISTRY
        )
        .expect("register work_entity_focus_redis_errors_total");

    /// Tier 2 #2 — counter of notification ops by `op = enqueue |
    /// mark_read | mark_all_read | bootstrap`.
    pub static ref WORK_NOTIFICATIONS_TOTAL: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::WORK_NOTIFICATIONS_TOTAL,
            "Tier 2 #2 — server-pushed notification ops \
             (op = enqueue | mark_read | mark_all_read | bootstrap).",
            &["op"],
            REGISTRY
        )
        .expect("register work_notifications_total");

    /// Tier 2 #3 — counter of dispatch broadcasts by target.
    pub static ref WORK_DISPATCH_BROADCAST_TOTAL: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::WORK_DISPATCH_BROADCAST_TOTAL,
            "Tier 2 #3 — supervisor dispatch broadcasts \
             (target_type = zone | role | users).",
            &["target_type"],
            REGISTRY
        )
        .expect("register work_dispatch_broadcast_total");

    /// Phase 2 (2026-05-06) — broadcast-channel buffer headroom gauge,
    /// per-receiver. Last-write-wins per `org_hash` is fine — the gauge
    /// is meant as a leading-indicator sample, not a per-socket truth.
    /// Computed as `(channel_capacity - rx.len()) / channel_capacity *
    /// 100` immediately after `rx.recv()` returns Ok. 100 ⇒ healthy;
    /// 0 ⇒ at capacity (next event will trip the Lagged counter). The
    /// `org_hash` label is the same 4-hex bound used elsewhere; sockets
    /// that haven't sent a Subscribe yet land in the `unbound` bucket.
    pub static ref WORK_WS_BROADCAST_BUFFER_PCT: GaugeVec =
        register_gauge_vec_with_registry!(
            names::WORK_WS_BROADCAST_BUFFER_PCT,
            "Broadcast-channel buffer headroom (% remaining) sampled by \
             each WS send loop on every successful recv. Pairs with \
             `work_ws_lagged_events_total` — this gauge is the leading \
             indicator (how close to the cliff), the counter is the \
             after-the-fact drop count.",
            &["org_hash"],
            REGISTRY
        )
        .expect("register work_ws_broadcast_buffer_pct");

    /// Phase 2 (2026-05-06) — HTTP request counter, labelled by
    /// `route` (axum `MatchedPath` template, NOT the raw URL — keeps
    /// cardinality bounded), `method`, and `status` (3-digit string).
    /// Backs the `WorkServiceHealthFailing` Prometheus alert and the
    /// per-route latency / volume panels in the Grafana dashboard.
    pub static ref WORK_HTTP_REQUESTS_TOTAL: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::WORK_HTTP_REQUESTS_TOTAL,
            "Total HTTP requests served. Labels: route (matched path \
             template), method, status (3-digit). Used by the \
             WorkServiceHealthFailing alert and per-route dashboards.",
            &["route", "method", "status"],
            REGISTRY
        )
        .expect("register work_http_requests_total");

    /// Phase 7 (2026-05-06) — `claim_sap_agent_job` RPC outcomes per
    /// org. The `org_hash` label is bounded via `org_hash_label()` to
    /// keep label cardinality finite at scale; `outcome` is one of
    /// `hit` (job returned) or `miss` (queue empty / pinned to other
    /// agent). Pairs with the latency histogram below.
    pub static ref SAP_JOBS_CLAIM_TOTAL: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::SAP_JOBS_CLAIM_TOTAL,
            "Phase 7 — `claim_sap_agent_job` RPC outcomes \
             (outcome = hit | miss).",
            &["org_hash", "outcome"],
            REGISTRY
        )
        .expect("register sap_jobs_claim_total");

    /// Phase 7 — claim RPC end-to-end latency in milliseconds. Buckets
    /// chosen for the 10ms..5s range we expect: most claims should
    /// land under 100ms, anything over 1s usually means the org has a
    /// hot-spot of agents racing on `FOR UPDATE SKIP LOCKED`.
    pub static ref SAP_JOBS_CLAIM_LATENCY_MS: HistogramVec =
        register_histogram_vec_with_registry!(
            prometheus::HistogramOpts::new(
                names::SAP_JOBS_CLAIM_LATENCY_MS,
                "Phase 7 — `claim_sap_agent_job` RPC end-to-end latency (ms).",
            )
            .buckets(vec![10.0, 50.0, 100.0, 250.0, 500.0, 1000.0, 2500.0, 5000.0]),
            &["org_hash"],
            REGISTRY
        )
        .expect("register sap_jobs_claim_latency_ms");

    /// Phase 7 — terminal-state transition outcomes for /complete.
    /// `outcome=success` is the happy path; `outcome=state_mismatch`
    /// signals the row was already terminal (watchdog beat us / lease
    /// re-claim happened) — paired with v1.7.2 agent-side guards.
    pub static ref SAP_JOBS_COMPLETE_TOTAL: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::SAP_JOBS_COMPLETE_TOTAL,
            "Phase 7 — /jobs/:id/complete terminal-state outcomes \
             (outcome = success | state_mismatch).",
            &["org_hash", "outcome"],
            REGISTRY
        )
        .expect("register sap_jobs_complete_total");

    /// Phase 7 — failure transitions per (org, step). The `step`
    /// label is the agent-provided cause tag (`watchdog`, `dispatch`,
    /// `sap-com-hung`, …) — agents must keep this set small to bound
    /// cardinality. `step=unknown` is the fallback when the agent
    /// omits it.
    pub static ref SAP_JOBS_FAIL_TOTAL: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::SAP_JOBS_FAIL_TOTAL,
            "Phase 7 — /jobs/:id/fail counts partitioned by step \
             (cardinality bounded by agent step taxonomy).",
            &["org_hash", "step"],
            REGISTRY
        )
        .expect("register sap_jobs_fail_total");

    // ── Resilient PgListener (2026-05-07 wedge fix) ─────────────────
    //
    // Each LISTEN channel that uses `crate::pglistener::run` updates
    // these gauges/counters on every state transition. Cardinality
    // is bounded by the number of distinct channel names declared in
    // `main.rs` + per-table evaluator subscriptions (~11 today).

    pub static ref WORK_PGLISTENER_STATUS: IntGaugeVec =
        register_int_gauge_vec_with_registry!(
            names::WORK_PGLISTENER_STATUS,
            "Resilient PgListener health gauge \
             (1 = subscribed and draining, 0 = reconnecting). One \
             series per LISTEN channel.",
            &["channel"],
            REGISTRY
        )
        .expect("register work_pglistener_status");

    pub static ref WORK_PGLISTENER_RECONNECTS_TOTAL: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::WORK_PGLISTENER_RECONNECTS_TOTAL,
            "Resilient PgListener reconnect attempts (TCP RST, \
             watchdog timeout, sqlx recv() error, etc.). Steady- \
             state ≈ 0; non-zero = upstream is idle-killing sockets.",
            &["channel"],
            REGISTRY
        )
        .expect("register work_pglistener_reconnects_total");

    pub static ref WORK_PGLISTENER_LAST_MESSAGE_AGE: GaugeVec =
        register_gauge_vec_with_registry!(
            names::WORK_PGLISTENER_LAST_MESSAGE_AGE_SECONDS,
            "Seconds since the channel's PgListener received any \
             frame (real NOTIFY or keepalive echo). Refreshed each \
             keepalive tick. Watchdog reconnects when this exceeds \
             the configured timeout (default 90s).",
            &["channel"],
            REGISTRY
        )
        .expect("register work_pglistener_last_message_age_seconds");

    pub static ref WORK_PGLISTENER_KEEPALIVE_SENT_TOTAL: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::WORK_PGLISTENER_KEEPALIVE_SENT_TOTAL,
            "Keepalive NOTIFYs published by this listener on \
             `rust_work_service_keepalive` (one per keepalive tick).",
            &["channel"],
            REGISTRY
        )
        .expect("register work_pglistener_keepalive_sent_total");

    pub static ref WORK_PGLISTENER_KEEPALIVE_RECEIVED_TOTAL: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::WORK_PGLISTENER_KEEPALIVE_RECEIVED_TOTAL,
            "Keepalive NOTIFYs observed on this listener's dedicated \
             PgListener socket. Includes own + sibling keepalives. \
             Non-zero = dedicated TCP is alive.",
            &["channel"],
            REGISTRY
        )
        .expect("register work_pglistener_keepalive_received_total");

    /// Item 7a (post-audit, 2026-05-07) — per-`WsEvent` variant
    /// broadcast counter. Incremented exactly once per call to
    /// `crate::websocket::broadcast_event`, regardless of how many
    /// receivers consumed the event. Pre-seeded with one zero
    /// sample per known variant by `init_zero_value_series` so
    /// `/metrics` exposes every series from boot — operational
    /// dashboards can rely on stable label sets without waiting
    /// for the first event of each variant to bring the series
    /// into existence.
    pub static ref WORK_WS_MESSAGES_SENT_TOTAL: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::WORK_WS_MESSAGES_SENT_TOTAL,
            "Total WsEvent broadcasts emitted on the per-process WS \
             fan-out, labelled by variant. Increment site is \
             `crate::websocket::broadcast_event` — wraps every \
             `broadcast::Sender::send(WsEvent)` callsite. Counts \
             broadcast publications, NOT per-client deliveries.",
            &["variant"],
            REGISTRY
        )
        .expect("register work_ws_messages_sent_total");

    /// In-process auth cache hit/miss counter (2026-05-31). `outcome`
    /// is `hit` (cached `validate-with-profile` result reused, no
    /// rust-core round-trip) or `miss` (fell through to the upstream
    /// HTTP call). Both series are zero-seeded at boot by
    /// `init_zero_value_series` so dashboards can chart hit-rate from
    /// the first scrape. Bounded 2-value label.
    pub static ref WORK_AUTH_CACHE_TOTAL: IntCounterVec =
        register_int_counter_vec_with_registry!(
            names::WORK_AUTH_CACHE_TOTAL,
            "In-process auth-cache lookups (outcome = hit | miss). \
             hit ⇒ served the cached rust-core validate-with-profile \
             result with no inter-service round-trip.",
            &["outcome"],
            REGISTRY
        )
        .expect("register work_auth_cache_total");
}

/// Item 7b (post-audit, 2026-05-07) — eagerly create every known
/// counter series at zero so `/metrics` exposes the full label set
/// from the moment the service comes up.
///
/// Without this, `IntCounterVec` series only materialise on the
/// first `inc()` for a given label combination; downstream
/// dashboards (Grafana panels, alert rules, recording rules) that
/// assume a label exists then break for newly-deployed instances
/// until traffic happens to drive every variant. The pattern is
/// cheap (one allocation per series, runs once at boot) and is the
/// idiomatic answer recommended by the Prometheus client docs.
///
/// Called from `main.rs` immediately after the metrics registry
/// is referenced for the first time so the series exist BEFORE
/// the first scrape.
pub fn init_zero_value_series() {
    // Resilient PgListener — every channel registered in the
    // boot inventory. Includes the per-table evaluator listeners
    // even though those resolve channel names at runtime; the
    // bounded set below tracks the known production channels.
    for channel in KNOWN_PGLISTENER_CHANNELS {
        WORK_PGLISTENER_RECONNECTS_TOTAL
            .with_label_values(&[channel])
            .inc_by(0);
        WORK_PGLISTENER_KEEPALIVE_SENT_TOTAL
            .with_label_values(&[channel])
            .inc_by(0);
        WORK_PGLISTENER_KEEPALIVE_RECEIVED_TOTAL
            .with_label_values(&[channel])
            .inc_by(0);
    }

    // WS broadcast — initialise the per-variant message-sent
    // counter and the lagged-events counter for the `unbound`
    // bucket (sockets that lagged before sending Subscribe).
    // `org_hash` cardinality is unbounded over the lifetime of
    // the process, so we only seed `unbound`; once a Subscribe
    // arrives, the WS send loop creates the per-org series
    // naturally.
    for variant in KNOWN_WS_EVENT_VARIANTS {
        WORK_WS_MESSAGES_SENT_TOTAL
            .with_label_values(&[variant])
            .inc_by(0);
    }
    WORK_WS_LAGGED_EVENTS_TOTAL
        .with_label_values(&["unbound"])
        .inc_by(0);

    // Auth cache — seed both outcome buckets so the hit-rate panel
    // renders from the first scrape on a freshly-deployed instance.
    for outcome in ["hit", "miss"] {
        WORK_AUTH_CACHE_TOTAL.with_label_values(&[outcome]).inc_by(0);
    }
}

/// LISTEN channels enumerated at boot via `tokio::spawn` blocks
/// in `main.rs`. Keep this list aligned with those spawn calls;
/// adding a new listener WITHOUT extending this array means the
/// new channel's `work_pglistener_*` series only materialise on
/// the first reconnect (instead of from boot at zero).
///
/// Per-table evaluator listeners (`triggers/evaluator.rs`) derive
/// channel names from `triggers::config::ALLOWED_SOURCE_TABLES`,
/// so they're listed here once the table-to-channel mapping is
/// expanded inline.
pub const KNOWN_PGLISTENER_CHANNELS: &[&str] = &[
    // Direct listener consumers (one tokio::spawn each).
    "work_engine_settings_changed",
    "sap_agent_changed",
    "sap_agent_job_changed",
    "sap_import_run_changed",
    "cycle_count_data_changed",
    "lx03_data_changed",
    "rf_putaway_operation_changed",
    "notification_created",
    "agent_triggers_changed",
    // P2 of OmniBelt MVP (2026-05-24) — `omnibelt_role_config_notify`
    // trigger fires `pg_notify('omnibelt_config_changed', …)` on every
    // INSERT/UPDATE/DELETE; consumed by `omnibelt_listener` →
    // broadcasts `WsEvent::OmnibeltConfigChanged` + DELs the matching
    // `omnibelt:bootstrap:{org_id}:*` cache keys in Redis.
    "omnibelt_config_changed",
    // Per-table trigger evaluator listeners — these mirror the
    // `channel_for_table` mapping in `triggers/evaluator.rs`.
    // `work_tasks_changed` and `shipment_queue_changed` are
    // listed here as well even though their NOTIFY triggers are
    // not yet installed (the evaluator logs and skips); seeding
    // the series at zero is harmless and keeps the dashboards
    // forward-compatible.
    "work_tasks_changed",
    "shipment_queue_changed",
];

/// Variant names mirrored from `WsEvent` enum in
/// `crate::websocket::mod`. Keep aligned with the enum — adding a
/// variant WITHOUT extending this list means its
/// `work_ws_messages_sent_total{variant=...}` series only
/// materialises on the first broadcast.
///
/// `WsEvent::variant_name` is the runtime mirror; the
/// `ws_event_variant_names_match_known_set` test in
/// `websocket/mod.rs` keeps the two in sync.
pub const KNOWN_WS_EVENT_VARIANTS: &[&str] = &[
    "TaskAssigned",
    "TaskStatusChanged",
    "WorkerStatusChanged",
    "QueueStatsUpdated",
    "PushedWork",
    "Heartbeat",
    "ReservationEscalated",
    "ClaimBlockedByZone",
    "SapAgentChanged",
    "PresenceJoined",
    "PresenceUpdated",
    "PresenceLeft",
    "EntityFocus",
    "Notification",
    "SapJobStatusChanged",
    "ImportRunStatusChanged",
    "CycleCountOperationChanged",
    "Lx03DataChanged",
    "RfPutawayChanged",
    "SapAgentConsoleLine",
    "TriggerFired",
    "OmnibeltConfigChanged",
];

/// Hash an org id to a bounded, non-reversible label value (4 hex chars).
/// Plan §12.1 — never expose raw UUIDs or customer names in Prometheus labels.
pub fn org_hash_label(org_id: &uuid::Uuid) -> String {
    let bytes = org_id.as_bytes();
    let h: u32 = bytes
        .iter()
        .fold(0u32, |a, b| a.wrapping_mul(31).wrapping_add(*b as u32));
    format!("{:04x}", (h ^ (h >> 16)) & 0xFFFF)
}

/// Render the current metrics registry as Prometheus text exposition.
/// Returns `Some(body)` on success and `None` only if encoding itself fails
/// (which would be an invariant violation).
pub fn render_text() -> Option<String> {
    let metric_families = REGISTRY.gather();
    let encoder = TextEncoder::new();
    let mut buf = Vec::new();
    encoder.encode(&metric_families, &mut buf).ok()?;
    String::from_utf8(buf).ok()
}

/// Convenience helper for the WS connection guard pattern: increment on
/// connect, decrement on drop. Keeps the `IntGauge` honest even when the
/// handler panics or the socket is dropped via the `Stream` early-return
/// path.
pub struct WsSubscriberGuard {
    org_hash: String,
    task_type: &'static str,
}

impl WsSubscriberGuard {
    pub fn new(org_hash: String, task_type: &'static str) -> Self {
        WORK_WS_SUBSCRIBERS
            .with_label_values(&[&org_hash, task_type])
            .inc();
        Self { org_hash, task_type }
    }

    /// Update the guard when a Subscribe message rebinds the connection's
    /// org. Decrements the prior `org_hash` gauge and increments the new
    /// one so the snapshot stays balanced across the connection lifecycle.
    pub fn rebind_org(&mut self, new_org_hash: String) {
        if new_org_hash == self.org_hash {
            return;
        }
        WORK_WS_SUBSCRIBERS
            .with_label_values(&[&self.org_hash, self.task_type])
            .dec();
        WORK_WS_SUBSCRIBERS
            .with_label_values(&[&new_org_hash, self.task_type])
            .inc();
        self.org_hash = new_org_hash;
    }
}

impl Drop for WsSubscriberGuard {
    fn drop(&mut self) {
        WORK_WS_SUBSCRIBERS
            .with_label_values(&[&self.org_hash, self.task_type])
            .dec();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_text_returns_text() {
        WORK_CLAIM_TOTAL
            .with_label_values(&["cycle_count", "normal", "miss"])
            .inc();
        let body = render_text().expect("text encoded");
        assert!(body.contains("work_claim_total"));
    }

    #[test]
    fn org_hash_is_bounded() {
        let uuid = uuid::Uuid::nil();
        let h = org_hash_label(&uuid);
        assert_eq!(h.len(), 4);
    }

    #[test]
    fn ws_guard_balances_inc_and_dec() {
        let g = WORK_WS_SUBSCRIBERS.with_label_values(&["abcd", "all"]);
        let before = g.get();
        {
            let _guard = WsSubscriberGuard::new("abcd".to_string(), "all");
            assert_eq!(g.get(), before + 1);
        }
        assert_eq!(g.get(), before);
    }

    #[test]
    fn broadcast_buffer_pct_gauge_writes() {
        // Phase 2 — verify the gauge accepts a sample and renders into
        // the /metrics output. Last-write-wins per org_hash bucket is
        // intentional for this leading-indicator gauge.
        WORK_WS_BROADCAST_BUFFER_PCT
            .with_label_values(&["abcd"])
            .set(42.0);
        let body = render_text().expect("text encoded");
        assert!(body.contains("work_ws_broadcast_buffer_pct"));
        assert!(body.contains("org_hash=\"abcd\""));
    }

    #[test]
    fn http_requests_counter_writes() {
        WORK_HTTP_REQUESTS_TOTAL
            .with_label_values(&["/health", "GET", "200"])
            .inc();
        let body = render_text().expect("text encoded");
        assert!(body.contains("work_http_requests_total"));
        assert!(body.contains("route=\"/health\""));
    }

    #[test]
    fn init_zero_value_series_exposes_per_variant_message_counter() {
        // Item 7a + 7b — verify `init_zero_value_series` materialises
        // the `work_ws_messages_sent_total` series for at least one
        // representative variant. After this runs, `/metrics`
        // exposes the counter at zero so dashboards don't break
        // until the first event of that variant happens to fire.
        init_zero_value_series();
        let body = render_text().expect("text encoded");
        assert!(
            body.contains("work_ws_messages_sent_total"),
            "metric name absent from /metrics body"
        );
        // Spot-check three high-volume variants — `SapAgentChanged`
        // (heartbeat fan-out, ~30 s cadence per agent),
        // `RfPutawayChanged` (Phase 4 putaway pipeline),
        // `TriggerFired` (Phase 9 evaluator). All three MUST exist
        // at zero from boot for the SAP-agents fleet dashboard to
        // render correctly on a freshly-deployed instance.
        for variant in ["SapAgentChanged", "RfPutawayChanged", "TriggerFired"] {
            let line = format!("variant=\"{variant}\"");
            assert!(
                body.contains(&line),
                "expected zero-init series for {variant}, body did not include {line}"
            );
        }
    }

    #[test]
    fn init_zero_value_series_exposes_per_channel_pglistener_counters() {
        // Item 7b — every known PgListener channel gets a zeroed
        // reconnects + keepalive counter at boot so the
        // `WorkServiceListenerSilent` style alerts can use
        // `rate(work_pglistener_reconnects_total[5m]) > 0` from
        // the moment the service starts.
        init_zero_value_series();
        let body = render_text().expect("text encoded");
        for channel in [
            "sap_agent_changed",
            "rf_putaway_operation_changed",
            "agent_triggers_changed",
        ] {
            let recon = format!(
                "work_pglistener_reconnects_total{{channel=\"{channel}\"}}"
            );
            assert!(
                body.contains(&recon),
                "expected zero-init reconnect series for channel={channel}, \
                 body missing line `{recon}`"
            );
        }
    }

    #[test]
    fn known_ws_event_variants_is_non_empty_and_alphabetised_by_phase() {
        // Defence-in-depth — if a refactor accidentally truncates
        // the variant list to empty, `init_zero_value_series` would
        // silently no-op for `work_ws_messages_sent_total`. This
        // sanity check + the matching `ws_event_variant_names_match_known_set`
        // test in `websocket/mod.rs` keep the lists in lockstep.
        assert!(!KNOWN_WS_EVENT_VARIANTS.is_empty());
        assert!(KNOWN_WS_EVENT_VARIANTS.contains(&"SapAgentChanged"));
        assert!(KNOWN_WS_EVENT_VARIANTS.contains(&"TriggerFired"));
    }
}

// Created and developed by Jai Singh
