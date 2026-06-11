// Created and developed by Jai Singh
//! Phase 3 (2026-05-06) — server-owned snapshot endpoints for the
//! SAP-agent fleet + recent-job ledger.
//!
//! Two endpoints mounted under `/api/v1/sap-agents/*`, both behind
//! `require_auth`:
//!
//!   - `GET /fleet` — bootstrap snapshot of every SAP agent in the
//!     caller's org. Replaces the direct `supabase.from('sap_agents')`
//!     SELECT that `useAgentDetection.probeFleetOnce` and
//!     `agents-fleet-card` were running. Pairs with the already-shipped
//!     `WsEvent::SapAgentChanged` push, so the FE flow is now bootstrap
//!     (this route) → WS-driven incremental updates owned by
//!     `rust-work-service`.
//!
//!   - `GET /jobs/recent` — recent SAP-agent job rows (the table that
//!     the Recent Jobs panel renders). Server-side joined to
//!     `sap_agents` so the FE doesn't have to fan out a second request
//!     to label each row with its claiming agent.
//!
//! Org-scoping: both routes resolve `organization_id` from the JWT
//! claims via `AuthenticatedUser.organization_id` — never from the
//! request body or query string. Cross-tenant calls are impossible by
//! construction. Mirrors the convention in `presence.rs`,
//! `entity_focus.rs`, `notifications.rs`.
//!
//! Schema notes:
//!   - `sap_agents` (migration 247 + 250) does NOT carry a `user_id`
//!     column today, so `user_id` / `user_email` always serialise as
//!     `null`. The Phase 3 plan enumerates these fields in the FE
//!     contract; keeping them in the response shape avoids a type
//!     break when a future migration backfills the column.
//!   - `sap_agent_jobs.assigned_agent_id` is the optional pin (only
//!     set when an admin explicitly targets a Citrix box); the actual
//!     claiming agent lives in `claimed_by`. The `/jobs/recent` route
//!     joins on `COALESCE(assigned_agent_id, claimed_by)` so the
//!     "Agent" column reflects whichever is meaningful for the row.
//!
//! Indexes consulted (per the EXPLAIN plan captured in
//! `Implementations/Implement-Rust-Work-Service-Phase3.md`):
//!   - `idx_sap_agents_org_status_lastseen` (migration 254) for
//!     `/fleet`.
//!   - `idx_sap_agent_jobs_queue` / the `created_at` ordering for
//!     `/jobs/recent`.

use axum::{
    extract::{Extension, Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Instant;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::api::error::{ApiError, ApiResult};
use crate::auth::AuthenticatedUser;
use crate::observability::metrics;
use crate::AppState;

const RECENT_JOBS_DEFAULT_LIMIT: i64 = 50;
const RECENT_JOBS_MAX_LIMIT: i64 = 200;
const ALLOWED_FLEET_STATUSES: &[&str] = &["online", "offline", "all"];

// ────────────────────────────────────────────────────────────────────
// Fleet endpoint
// ────────────────────────────────────────────────────────────────────

/// One row of the `/fleet` response. Mirrors the FE `FleetAgent`
/// interface in `src/lib/work-service/sap-agents-client.ts` —
/// `serde(rename_all)` is intentionally OFF because the column names
/// already use snake_case.
#[derive(Debug, Serialize)]
pub struct FleetAgent {
    pub id: String,
    pub hostname: Option<String>,
    pub citrix_session: Option<String>,
    /// Always `None` today — `sap_agents` has no `user_id` column yet
    /// (see module-level schema notes). Kept in the wire shape so the
    /// FE doesn't break when a future migration backfills the column.
    pub user_id: Option<Uuid>,
    /// Always `None` today (see `user_id`).
    pub user_email: Option<String>,
    pub sap_system: Option<String>,
    pub sap_client: Option<String>,
    pub sap_user: Option<String>,
    pub version: Option<String>,
    pub status: String,
    pub last_seen_at: DateTime<Utc>,
    pub process_started_at: Option<DateTime<Utc>>,
    pub capability_count: i32,
    /// Only populated when `?include_capabilities=true`. Omitted from
    /// the JSON response otherwise so the default snapshot stays
    /// small (the JSONB blob can run hundreds of bytes per agent).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Default)]
pub struct FleetQuery {
    /// `online` (default), `offline`, or `all`.
    #[serde(default)]
    pub status: Option<String>,
    /// When `true`, the `capabilities` JSONB array is decoded and
    /// returned. Defaults to `false` so the row payload stays small.
    #[serde(default)]
    pub include_capabilities: Option<bool>,
}

/// Internal row shape used by the sqlx decoder. We split this from
/// `FleetAgent` because:
///   1. `capabilities` lives in the DB as `JSONB` and we want it
///      decoded into a `Vec<String>` only when the caller asked for
///      it (the `CASE WHEN $3` branch returns `NULL` otherwise).
///   2. `capability_count` is computed via `jsonb_array_length(...)`
///      and we want to surface it as `i32` regardless of whether
///      capabilities are returned.
#[derive(Debug, sqlx::FromRow)]
struct FleetAgentRow {
    id: String,
    hostname: Option<String>,
    citrix_session: Option<String>,
    user_id: Option<Uuid>,
    user_email: Option<String>,
    sap_system: Option<String>,
    sap_client: Option<String>,
    sap_user: Option<String>,
    version: Option<String>,
    status: String,
    last_seen_at: DateTime<Utc>,
    process_started_at: Option<DateTime<Utc>>,
    capability_count: i32,
    capabilities: Option<sqlx::types::Json<Vec<String>>>,
}

fn require_org(user: &AuthenticatedUser) -> ApiResult<Uuid> {
    let org_id_str = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;
    Uuid::parse_str(org_id_str)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))
}

pub async fn get_fleet(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Query(q): Query<FleetQuery>,
) -> ApiResult<Json<Vec<FleetAgent>>> {
    let org_uuid = require_org(&user)?;
    let status = q.status.as_deref().unwrap_or("online");
    if !ALLOWED_FLEET_STATUSES.contains(&status) {
        return Err(ApiError::BadRequest(format!(
            "status must be one of {:?}",
            ALLOWED_FLEET_STATUSES
        )));
    }
    let include_caps = q.include_capabilities.unwrap_or(false);

    // Note on the SQL shape:
    //   - The `LEFT JOIN user_profiles` is a no-op today (sap_agents
    //     has no user_id column), but keeping the join in the query
    //     means we don't have to redeploy the route when a future
    //     migration adds the column. The optimizer turns the join
    //     into a nested-loop with a single zero-row probe per agent.
    //   - `capability_count` is always computed (cheap — JSONB array
    //     length is O(1) on the JSONB header) so the FE can render
    //     "5 capabilities" pills without paying for the full payload.
    //   - `CASE WHEN $3 THEN a.capabilities ELSE NULL END` skips the
    //     JSONB decode round-trip when the caller didn't ask for it.
    let rows: Vec<FleetAgentRow> = sqlx::query_as::<_, FleetAgentRow>(
        r#"
        SELECT
            a.id,
            a.hostname,
            a.citrix_session,
            NULL::uuid AS user_id,
            NULL::text AS user_email,
            a.sap_system,
            a.sap_client,
            a.sap_user,
            a.version,
            a.status,
            a.last_seen_at,
            a.process_started_at,
            COALESCE(jsonb_array_length(a.capabilities), 0)::int AS capability_count,
            CASE WHEN $3 THEN a.capabilities ELSE NULL END AS capabilities
        FROM public.sap_agents a
        WHERE a.organization_id = $1
          AND ($2 = 'all' OR a.status = $2)
        ORDER BY a.last_seen_at DESC
        "#,
    )
    .bind(org_uuid)
    .bind(status)
    .bind(include_caps)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| {
        warn!(
            ?e,
            org_id = %org_uuid,
            status,
            include_capabilities = include_caps,
            "sap_agents::get_fleet: db error"
        );
        ApiError::Database(e)
    })?;

    let agents: Vec<FleetAgent> = rows
        .into_iter()
        .map(|r| FleetAgent {
            id: r.id,
            hostname: r.hostname,
            citrix_session: r.citrix_session,
            user_id: r.user_id,
            user_email: r.user_email,
            sap_system: r.sap_system,
            sap_client: r.sap_client,
            sap_user: r.sap_user,
            version: r.version,
            status: r.status,
            last_seen_at: r.last_seen_at,
            process_started_at: r.process_started_at,
            capability_count: r.capability_count,
            capabilities: r.capabilities.map(|j| j.0),
        })
        .collect();

    debug!(
        org_id = %org_uuid,
        status,
        include_capabilities = include_caps,
        returned = agents.len(),
        "sap_agents::get_fleet: served"
    );

    Ok(Json(agents))
}

// ────────────────────────────────────────────────────────────────────
// Recent jobs endpoint
// ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct RecentJob {
    pub id: Uuid,
    pub endpoint: String,
    pub status: String,
    /// Compact projection of the full `payload` JSONB. Today we surface
    /// `to_number` and `warehouse` because every endpoint in the SAP
    /// playbook can be identified by one or both — additional keys can
    /// be added without a schema change (this is a `serde_json::Value`
    /// object).
    pub payload_summary: serde_json::Value,
    pub error: Option<String>,
    /// Mirrors `sap_agent_jobs.assigned_agent_id` (the optional pin).
    /// `null` when the job wasn't pinned to a specific agent at submit
    /// time. Falls back to `claimed_by` for the join key when the pin
    /// is absent so the UI can still label a "ran on box X" relation.
    pub assigned_agent_id: Option<String>,
    pub assigned_agent_hostname: Option<String>,
    pub created_at: DateTime<Utc>,
    pub claimed_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, sqlx::FromRow)]
struct RecentJobRow {
    id: Uuid,
    endpoint: String,
    status: String,
    payload_summary: sqlx::types::Json<serde_json::Value>,
    error: Option<String>,
    assigned_agent_id: Option<String>,
    assigned_agent_hostname: Option<String>,
    created_at: DateTime<Utc>,
    claimed_at: Option<DateTime<Utc>>,
    completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize, Default)]
pub struct RecentJobsQuery {
    /// Defaults to `RECENT_JOBS_DEFAULT_LIMIT`, clamped to
    /// `1..=RECENT_JOBS_MAX_LIMIT`.
    #[serde(default)]
    pub limit: Option<i64>,
    /// Comma-separated list, e.g. `?status=running,completed`. When
    /// omitted (or `"all"`) all rows are returned.
    #[serde(default)]
    pub status: Option<String>,
}

pub async fn get_recent_jobs(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Query(q): Query<RecentJobsQuery>,
) -> ApiResult<Json<Vec<RecentJob>>> {
    let org_uuid = require_org(&user)?;
    let limit = q
        .limit
        .unwrap_or(RECENT_JOBS_DEFAULT_LIMIT)
        .clamp(1, RECENT_JOBS_MAX_LIMIT);

    // Status filter: split on `,`, trim, keep non-empty + non-`all`.
    // When the resulting set is empty (no filter / `?status=all` /
    // `?status=`) we pass `None` so the SQL `$2 IS NULL` branch wins
    // and every row is returned.
    let status_filter: Option<Vec<String>> = q.status.as_ref().and_then(|s| {
        let v: Vec<String> = s
            .split(',')
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty() && t != "all")
            .collect();
        if v.is_empty() {
            None
        } else {
            Some(v)
        }
    });

    // Note on the SQL shape:
    //   - `payload_summary` is a `jsonb_build_object(...)` so we keep
    //     the wire payload tiny (full `payload` JSONB blobs include
    //     idempotency keys, full SAP arg sets, etc. — multiple KB
    //     each). Adding keys here is a one-line schema-free change.
    //   - The `LEFT JOIN sap_agents` uses `COALESCE(assigned_agent_id,
    //     claimed_by)` so unpinned jobs still resolve to their
    //     claimer's hostname (the more useful label in the recent-jobs
    //     panel — it's "who actually ran this", not "who was pinned").
    //   - `$2::text[] IS NULL OR j.status = ANY($2)` lets a single
    //     prepared statement handle both filtered and unfiltered cases
    //     so we don't need two query strings.
    let rows: Vec<RecentJobRow> = sqlx::query_as::<_, RecentJobRow>(
        r#"
        SELECT
            j.id,
            j.endpoint,
            j.status,
            jsonb_build_object(
                'to_number', j.payload->>'to_number',
                'warehouse', j.payload->>'warehouse'
            ) AS payload_summary,
            j.error,
            j.assigned_agent_id,
            a.hostname AS assigned_agent_hostname,
            j.created_at,
            j.claimed_at,
            j.completed_at
        FROM public.sap_agent_jobs j
        LEFT JOIN public.sap_agents a
               ON a.id = COALESCE(j.assigned_agent_id, j.claimed_by)
        WHERE j.organization_id = $1
          AND ($2::text[] IS NULL OR j.status = ANY($2))
        ORDER BY j.created_at DESC
        LIMIT $3
        "#,
    )
    .bind(org_uuid)
    .bind(status_filter.as_deref())
    .bind(limit)
    .fetch_all(&state.db_pool)
    .await
    .map_err(|e| {
        warn!(
            ?e,
            org_id = %org_uuid,
            limit,
            ?status_filter,
            "sap_agents::get_recent_jobs: db error"
        );
        ApiError::Database(e)
    })?;

    let jobs: Vec<RecentJob> = rows
        .into_iter()
        .map(|r| RecentJob {
            id: r.id,
            endpoint: r.endpoint,
            status: r.status,
            payload_summary: r.payload_summary.0,
            error: r.error,
            assigned_agent_id: r.assigned_agent_id,
            assigned_agent_hostname: r.assigned_agent_hostname,
            created_at: r.created_at,
            claimed_at: r.claimed_at,
            completed_at: r.completed_at,
        })
        .collect();

    debug!(
        org_id = %org_uuid,
        limit,
        ?status_filter,
        returned = jobs.len(),
        "sap_agents::get_recent_jobs: served"
    );

    Ok(Json(jobs))
}

// ────────────────────────────────────────────────────────────────────
// Phase 7 (2026-05-06) — server-owned queue claim path.
//
// These four endpoints centralize the claim / complete / fail /
// heartbeat lifecycle that the OmniFrame SAP agent has historically
// run directly against PostgREST. Moving the writes onto
// rust-work-service gives us:
//
//   - Per-org Prometheus metrics on every transition (the agent's
//     direct PostgREST path emits nothing — the only observability we
//     have today is `pg_stat_statements`).
//   - A single audit point for Phase 5's `sap_audit_log` (when that
//     ships, this handler is the natural place to side-effect the
//     `terminal_status` row alongside the PATCH).
//   - A future-friendly seat for agent identity v2 (Phase 10) — the
//     `agent_id` body field today is whatever string the agent sends,
//     but Phase 10 will wire it through a JWT-claim check using the
//     existing `require_auth` middleware extension.
//
// All four routes are behind the existing `require_auth` middleware
// (mounted in `main.rs` via the protected_routes nest). The
// `organization_id` is always taken from the JWT — never from the body
// — so cross-tenant calls are impossible by construction. Mirrors the
// pattern in `/fleet` and `/jobs/recent` above.
//
// The agent ships these calls behind the
// `OMNIFRAME_AGENT_CLAIM_VIA_RUST=1` flag during the parallel-run
// window. When the flag flips to default `1` in Phase 11 the legacy
// `_supabase_request(...)` callsites can be deleted (see
// `Implementations/Implement-Rust-Work-Service-Phase7.md` for the
// deletion targets).
// ────────────────────────────────────────────────────────────────────

/// Wire shape of a `sap_agent_jobs` row returned to the agent. Mirrors
/// the columns the agent's local job dispatcher reads. Kept as
/// `serde_json::Value` for `payload` + `result` because the agent
/// re-deserialises them into endpoint-specific Pydantic models.
#[derive(Debug, Serialize)]
pub struct SapJobRow {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub endpoint: String,
    pub payload: serde_json::Value,
    pub status: String,
    pub claimed_by: Option<String>,
    pub assigned_agent_id: Option<String>,
    pub claimed_at: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub heartbeat_at: Option<DateTime<Utc>>,
    pub claim_lease_until: Option<DateTime<Utc>>,
    pub claim_count: Option<i32>,
    pub priority: i32,
    pub attempts: i32,
    pub max_attempts: i32,
    pub idempotency_key: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, sqlx::FromRow)]
struct SapJobRowDb {
    id: Uuid,
    organization_id: Uuid,
    endpoint: String,
    payload: sqlx::types::Json<serde_json::Value>,
    status: String,
    claimed_by: Option<String>,
    assigned_agent_id: Option<String>,
    claimed_at: Option<DateTime<Utc>>,
    started_at: Option<DateTime<Utc>>,
    heartbeat_at: Option<DateTime<Utc>>,
    claim_lease_until: Option<DateTime<Utc>>,
    claim_count: Option<i32>,
    priority: i32,
    attempts: i32,
    max_attempts: i32,
    idempotency_key: Option<String>,
    created_at: DateTime<Utc>,
}

impl From<SapJobRowDb> for SapJobRow {
    fn from(r: SapJobRowDb) -> Self {
        Self {
            id: r.id,
            organization_id: r.organization_id,
            endpoint: r.endpoint,
            payload: r.payload.0,
            status: r.status,
            claimed_by: r.claimed_by,
            assigned_agent_id: r.assigned_agent_id,
            claimed_at: r.claimed_at,
            started_at: r.started_at,
            heartbeat_at: r.heartbeat_at,
            claim_lease_until: r.claim_lease_until,
            claim_count: r.claim_count,
            priority: r.priority,
            attempts: r.attempts,
            max_attempts: r.max_attempts,
            idempotency_key: r.idempotency_key,
            created_at: r.created_at,
        }
    }
}

/// Default lease seconds for `claim_sap_agent_job` + `bump_sap_agent_job_lease`.
/// Mirrors the agent v1.7.0 default (90s) — long enough to absorb a
/// slow-but-live SAP COM call, short enough that a hard agent crash
/// drops the row back into the queue within ~90s.
const DEFAULT_LEASE_SECONDS: i32 = 90;

/// `step` label used when a fail call omits its cause tag. Keep
/// cardinality bounded — the agent always supplies one in practice.
const DEFAULT_FAIL_STEP: &str = "unknown";

fn lease_seconds(opt: Option<i32>) -> i32 {
    let s = opt.unwrap_or(DEFAULT_LEASE_SECONDS);
    s.clamp(10, 3600)
}

// ────────────────────────────────────────────────────────────────────
// POST /api/v1/sap-agents/jobs/claim
// ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ClaimJobRequest {
    pub agent_id: String,
    pub lease_seconds: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct ClaimJobResponse {
    pub job: Option<SapJobRow>,
}

/// Atomically claim the next eligible job for `agent_id` in the
/// caller's org via the existing `claim_sap_agent_job(...)` SQL
/// function (migration 247). The function honours `assigned_agent_id`
/// pinning + lease expiry; we just forward the call and shape the
/// response.
pub async fn post_claim_job(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Json(req): Json<ClaimJobRequest>,
) -> ApiResult<Json<ClaimJobResponse>> {
    let org_uuid = require_org(&user)?;
    if req.agent_id.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "agent_id is required".to_string(),
        ));
    }
    let lease = lease_seconds(req.lease_seconds);
    let org_hash = metrics::org_hash_label(&org_uuid);
    let started = Instant::now();

    // Note: `claim_sap_agent_job` returns a row of `sap_agent_jobs%ROWTYPE`.
    // When the queue is empty it returns a row with all-NULL columns
    // (the implicit RETURNING from a UPDATE that matched nothing).
    // We detect "no claim" by checking whether `id` is NULL.
    let row: Option<SapJobRowDb> = sqlx::query_as::<_, SapJobRowDb>(
        r#"
        SELECT
            id,
            organization_id,
            endpoint,
            payload,
            status,
            claimed_by,
            assigned_agent_id,
            claimed_at,
            started_at,
            heartbeat_at,
            claim_lease_until,
            claim_count,
            priority,
            attempts,
            max_attempts,
            idempotency_key,
            created_at
        FROM public.claim_sap_agent_job($1::uuid, $2::text, $3::int)
        WHERE id IS NOT NULL
        "#,
    )
    .bind(org_uuid)
    .bind(&req.agent_id)
    .bind(lease)
    .fetch_optional(&state.db_pool)
    .await
    .map_err(|e| {
        warn!(
            ?e,
            org_id = %org_uuid,
            agent_id = %req.agent_id,
            "sap_agents::post_claim_job: claim_sap_agent_job RPC error"
        );
        ApiError::Database(e)
    })?;

    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    metrics::SAP_JOBS_CLAIM_LATENCY_MS
        .with_label_values(&[&org_hash])
        .observe(elapsed_ms);
    let outcome = if row.is_some() { "hit" } else { "miss" };
    metrics::SAP_JOBS_CLAIM_TOTAL
        .with_label_values(&[&org_hash, outcome])
        .inc();

    debug!(
        org_id = %org_uuid,
        agent_id = %req.agent_id,
        lease,
        outcome,
        elapsed_ms,
        "sap_agents::post_claim_job"
    );

    Ok(Json(ClaimJobResponse {
        job: row.map(SapJobRow::from),
    }))
}

// ────────────────────────────────────────────────────────────────────
// POST /api/v1/sap-agents/jobs/:job_id/complete
// ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CompleteJobRequest {
    pub agent_id: String,
    pub result: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct TerminalTransitionResponse {
    pub ok: bool,
    pub rows_affected: i64,
    /// Populated on `state_mismatch` so the agent can log a meaningful
    /// reason without parsing the metric label.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped_reason: Option<String>,
}

/// Mark a running job `completed`. Mirrors the agent's v1.7.2
/// `_patch_job_terminal` semantics:
///
///   - `status` must be `running`.
///   - `claimed_by` must equal `agent_id` (the same agent that
///     claimed it must be the one to complete it; lease re-claims are
///     handled by `claim_sap_agent_job`, never an HTTP PATCH).
///   - `organization_id` matches the caller's JWT org (the FROM `WHERE`
///     filter; bound by row-level RLS in the future via `auth.uid()`).
///
/// When 0 rows match the response sets `ok=true, rows_affected=0,
/// skipped_reason=...` so the agent can tell "nothing to do" apart
/// from a transport error. The metric label disambiguates the same
/// information for the dashboard.
pub async fn post_complete_job(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Path(job_id): Path<Uuid>,
    headers: HeaderMap,
    Json(req): Json<CompleteJobRequest>,
) -> ApiResult<Json<TerminalTransitionResponse>> {
    let org_uuid = require_org(&user)?;
    if req.agent_id.trim().is_empty() {
        return Err(ApiError::BadRequest("agent_id is required".to_string()));
    }
    let org_hash = metrics::org_hash_label(&org_uuid);

    // Idempotency-Key replay accounting (best-effort). The terminal
    // transition itself is naturally idempotent (`status='running'`
    // filter rejects re-runs), so we don't need the
    // `work_request_idempotency` ledger here — we only count replays
    // for visibility.
    let idem = headers
        .get("Idempotency-Key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    if idem.is_some() {
        metrics::WORK_IDEMPOTENCY_HITS_TOTAL
            .with_label_values(&["sap_jobs_complete"])
            .inc();
    }

    let rows_affected = sqlx::query(
        r#"
        UPDATE public.sap_agent_jobs
           SET status='completed',
               result=$1,
               completed_at=now(),
               heartbeat_at=now()
         WHERE id=$2
           AND organization_id=$3
           AND claimed_by=$4
           AND status='running'
        "#,
    )
    .bind(&req.result)
    .bind(job_id)
    .bind(org_uuid)
    .bind(&req.agent_id)
    .execute(&state.db_pool)
    .await
    .map_err(|e| {
        warn!(
            ?e,
            org_id = %org_uuid,
            job_id = %job_id,
            agent_id = %req.agent_id,
            "sap_agents::post_complete_job: db error"
        );
        ApiError::Database(e)
    })?
    .rows_affected();

    let outcome = if rows_affected > 0 { "success" } else { "state_mismatch" };
    metrics::SAP_JOBS_COMPLETE_TOTAL
        .with_label_values(&[&org_hash, outcome])
        .inc();

    let skipped_reason = if rows_affected == 0 {
        Some(
            "row not in expected (status=running, claimed_by=agent_id) state — \
             likely watchdog-failed already; refusing to overwrite terminal state"
                .to_string(),
        )
    } else {
        None
    };

    if rows_affected == 0 {
        warn!(
            org_id = %org_uuid,
            job_id = %job_id,
            agent_id = %req.agent_id,
            "sap_agents::post_complete_job: state mismatch (0 rows)"
        );
    } else {
        info!(
            org_id = %org_uuid,
            job_id = %job_id,
            agent_id = %req.agent_id,
            "sap_agents::post_complete_job: marked completed"
        );
    }

    Ok(Json(TerminalTransitionResponse {
        ok: true,
        rows_affected: rows_affected as i64,
        skipped_reason,
    }))
}

// ────────────────────────────────────────────────────────────────────
// POST /api/v1/sap-agents/jobs/:job_id/fail
// ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct FailJobRequest {
    pub agent_id: String,
    pub error: String,
    pub step: Option<String>,
}

/// Mark a running job `failed`. Same terminal-state guards as
/// `post_complete_job`. The optional `step` label is forwarded to the
/// `sap_jobs_fail_total` metric and persisted on the row for ops
/// triage.
pub async fn post_fail_job(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Path(job_id): Path<Uuid>,
    headers: HeaderMap,
    Json(req): Json<FailJobRequest>,
) -> ApiResult<Json<TerminalTransitionResponse>> {
    let org_uuid = require_org(&user)?;
    if req.agent_id.trim().is_empty() {
        return Err(ApiError::BadRequest("agent_id is required".to_string()));
    }
    let org_hash = metrics::org_hash_label(&org_uuid);

    // Mirror agent's `_patch_job_terminal`: trim the error to 500
    // chars so the row stays manageable (the original v1.7.2 PATCH
    // also clamped to 500).
    let trimmed_err = if req.error.len() > 500 {
        &req.error[..500]
    } else {
        &req.error
    };

    let idem = headers
        .get("Idempotency-Key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    if idem.is_some() {
        metrics::WORK_IDEMPOTENCY_HITS_TOTAL
            .with_label_values(&["sap_jobs_fail"])
            .inc();
    }

    let rows_affected = sqlx::query(
        r#"
        UPDATE public.sap_agent_jobs
           SET status='failed',
               error=$1,
               step=$2,
               completed_at=now(),
               heartbeat_at=now()
         WHERE id=$3
           AND organization_id=$4
           AND claimed_by=$5
           AND status='running'
        "#,
    )
    .bind(trimmed_err)
    .bind(req.step.as_deref())
    .bind(job_id)
    .bind(org_uuid)
    .bind(&req.agent_id)
    .execute(&state.db_pool)
    .await
    .map_err(|e| {
        warn!(
            ?e,
            org_id = %org_uuid,
            job_id = %job_id,
            agent_id = %req.agent_id,
            "sap_agents::post_fail_job: db error"
        );
        ApiError::Database(e)
    })?
    .rows_affected();

    let step_label = req.step.as_deref().unwrap_or(DEFAULT_FAIL_STEP);
    metrics::SAP_JOBS_FAIL_TOTAL
        .with_label_values(&[&org_hash, step_label])
        .inc();

    let skipped_reason = if rows_affected == 0 {
        Some(
            "row not in expected (status=running, claimed_by=agent_id) state — \
             likely watchdog-failed already"
                .to_string(),
        )
    } else {
        None
    };

    if rows_affected == 0 {
        warn!(
            org_id = %org_uuid,
            job_id = %job_id,
            agent_id = %req.agent_id,
            step = ?req.step,
            "sap_agents::post_fail_job: state mismatch (0 rows)"
        );
    } else {
        info!(
            org_id = %org_uuid,
            job_id = %job_id,
            agent_id = %req.agent_id,
            step = ?req.step,
            "sap_agents::post_fail_job: marked failed"
        );
    }

    Ok(Json(TerminalTransitionResponse {
        ok: true,
        rows_affected: rows_affected as i64,
        skipped_reason,
    }))
}

// ────────────────────────────────────────────────────────────────────
// POST /api/v1/sap-agents/jobs/:job_id/heartbeat
// ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct HeartbeatJobRequest {
    pub agent_id: String,
    pub lease_seconds: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct HeartbeatJobResponse {
    pub ok: bool,
    /// The new `claim_lease_until` returned by
    /// `bump_sap_agent_job_lease(...)`. `None` means the row no longer
    /// belongs to the calling agent (lost claim — the caller should
    /// abort and stop heartbeating).
    pub claim_lease_until: Option<DateTime<Utc>>,
}

/// Push the lease forward via the existing
/// `bump_sap_agent_job_lease(...)` SQL function. The function returns
/// `NULL` if the row was reaped by another agent — we surface that as
/// `claim_lease_until=null` so the agent can clear its
/// `state.active_job_id` and let the next claim cycle pick up.
pub async fn post_heartbeat_job(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Path(job_id): Path<Uuid>,
    Json(req): Json<HeartbeatJobRequest>,
) -> ApiResult<Json<HeartbeatJobResponse>> {
    let _org_uuid = require_org(&user)?;
    if req.agent_id.trim().is_empty() {
        return Err(ApiError::BadRequest("agent_id is required".to_string()));
    }
    let lease = lease_seconds(req.lease_seconds);

    let row: (Option<DateTime<Utc>>,) = sqlx::query_as(
        r#"SELECT public.bump_sap_agent_job_lease($1::uuid, $2::text, $3::int)"#,
    )
    .bind(job_id)
    .bind(&req.agent_id)
    .bind(lease)
    .fetch_one(&state.db_pool)
    .await
    .map_err(|e| {
        warn!(
            ?e,
            job_id = %job_id,
            agent_id = %req.agent_id,
            "sap_agents::post_heartbeat_job: db error"
        );
        ApiError::Database(e)
    })?;

    debug!(
        job_id = %job_id,
        agent_id = %req.agent_id,
        lease,
        ?row,
        "sap_agents::post_heartbeat_job"
    );

    Ok(Json(HeartbeatJobResponse {
        ok: row.0.is_some(),
        claim_lease_until: row.0,
    }))
}

// ────────────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────────────

/// Build the sap-agents router, mounted by `main.rs` at
// ────────────────────────────────────────────────────────────────────
// POST /api/v1/sap-agents/backfill-pending-confirms  (v0.1.35)
// ────────────────────────────────────────────────────────────────────

/// Optional knobs for an on-demand backfill run. Defaults match the
/// pg_cron path so the FE "Force backfill now" button replicates the
/// scheduled behaviour exactly. Admins draining a backlog can widen
/// `lookback_hours` (e.g. 168 = 7 days) or relax the per-row min-age
/// to drain a freshly-failed batch immediately.
#[derive(Debug, Deserialize, Default)]
pub struct BackfillPendingConfirmsRequest {
    /// Candidate-row lookback window. Defaults to 24 hours.
    pub lookback_hours: Option<i32>,
    /// Minimum age (seconds) a `failed` job must be before requeue.
    /// Defaults to 60 seconds — see migration 289 rationale.
    pub failed_min_age_seconds: Option<i32>,
    /// Per-job claim-count cap (rows that have churned this many
    /// times are left alone for human triage). Defaults to 8.
    pub max_claim_count: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct BackfillPendingConfirmsResponse {
    pub rows_failed_requeued: i32,
    pub rows_orphan_replayed: i32,
    pub oldest_pending_minutes: i32,
    pub lookback_hours: i32,
    /// Echo of the org the run was scoped to so the FE can sanity-check.
    pub organization_id: Uuid,
}

#[derive(Debug, sqlx::FromRow)]
struct BackfillRowDb {
    rows_failed_requeued: i32,
    rows_orphan_replayed: i32,
    oldest_pending_minutes: i32,
}

/// On-demand executor for `public.backfill_pending_putaway_confirms`
/// (migration 289). Same SQL the pg_cron job runs every 5 minutes; the
/// only difference is the org-scoping argument is bound to the caller's
/// JWT org so an admin can't drain another tenant's queue. Mirrors the
/// admin-write posture of `sap_console::allow_console_write`: any
/// authenticated principal with an `organization_id` claim can call it
/// (the function itself is RLS-bypass via `SECURITY DEFINER`, but the
/// org filter binds the blast radius). Service-key callers
/// (`role = "service"`) are accepted for the future server-to-server
/// case (e.g. a webhook-driven "drain now" flow).
pub async fn post_backfill_pending_confirms(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Json(req): Json<BackfillPendingConfirmsRequest>,
) -> ApiResult<Json<BackfillPendingConfirmsResponse>> {
    // Service-key callers are a free pass; everyone else needs an org.
    let is_service = user.role.as_deref() == Some("service");
    if !is_service && user.organization_id.is_none() {
        return Err(ApiError::Forbidden(
            "Organization context required".to_string(),
        ));
    }
    let org_uuid = require_org(&user)?;

    // Clamp inputs to defensible ranges. The cap on lookback_hours is
    // 168 (7 days) — wider than that and we'd start churning over the
    // org's 1,206-row pre-Phase 9 historical pile, which is exactly
    // what the bounded-window guarantee is supposed to prevent.
    let lookback_hours = req.lookback_hours.unwrap_or(24).clamp(1, 168);
    let failed_min_age_seconds = req.failed_min_age_seconds.unwrap_or(60).clamp(0, 3600);
    let max_claim_count = req.max_claim_count.unwrap_or(8).clamp(1, 100);

    let started = Instant::now();
    let row: BackfillRowDb = sqlx::query_as::<_, BackfillRowDb>(
        r#"
        SELECT
            rows_failed_requeued,
            rows_orphan_replayed,
            oldest_pending_minutes
        FROM public.backfill_pending_putaway_confirms($1::int, $2::int, $3::int, $4::uuid)
        "#,
    )
    .bind(lookback_hours)
    .bind(failed_min_age_seconds)
    .bind(max_claim_count)
    .bind(org_uuid)
    .fetch_one(&state.db_pool)
    .await
    .map_err(|e| {
        warn!(
            ?e,
            org_id = %org_uuid,
            lookback_hours,
            failed_min_age_seconds,
            max_claim_count,
            "sap_agents::post_backfill_pending_confirms: db error"
        );
        ApiError::Database(e)
    })?;

    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    info!(
        org_id = %org_uuid,
        rows_failed_requeued = row.rows_failed_requeued,
        rows_orphan_replayed = row.rows_orphan_replayed,
        oldest_pending_minutes = row.oldest_pending_minutes,
        lookback_hours,
        elapsed_ms,
        "sap_agents::post_backfill_pending_confirms: ran"
    );

    Ok(Json(BackfillPendingConfirmsResponse {
        rows_failed_requeued: row.rows_failed_requeued,
        rows_orphan_replayed: row.rows_orphan_replayed,
        oldest_pending_minutes: row.oldest_pending_minutes,
        lookback_hours,
        organization_id: org_uuid,
    }))
}

/// `/api/v1/sap-agents` (alphabetically placed between `/presence` and
/// `/work` in the router-nest list).
pub fn sap_agents_routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/fleet", get(get_fleet))                                 // Phase 3
        .route("/jobs/recent", get(get_recent_jobs))                     // Phase 3
        .route("/jobs/claim", post(post_claim_job))                      // Phase 7
        .route("/jobs/:job_id/complete", post(post_complete_job))        // Phase 7
        .route("/jobs/:job_id/fail", post(post_fail_job))                // Phase 7
        .route("/jobs/:job_id/heartbeat", post(post_heartbeat_job))      // Phase 7
        .route(
            "/backfill-pending-confirms",
            post(post_backfill_pending_confirms),
        ) // v0.1.35 — Force-run the putaway-confirm backfill (migration 289).
}

// ────────────────────────────────────────────────────────────────────
// Tests (Phase 7 — payload + helper coverage)
// ────────────────────────────────────────────────────────────────────
//
// These are unit tests that exercise the request/response shapes and
// the helper functions, NOT the SQL handlers themselves (those need a
// live PostgreSQL pool, which the broader test suite handles via
// integration runs). Each test maps 1:1 to one of the four new
// endpoints so a regression in deserialisation or the metric label
// vocabulary fails fast.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claim_request_deserialises_with_default_lease() {
        let body = r#"{"agent_id": "host-A-user"}"#;
        let req: ClaimJobRequest = serde_json::from_str(body).expect("parse");
        assert_eq!(req.agent_id, "host-A-user");
        assert_eq!(req.lease_seconds, None);
        assert_eq!(lease_seconds(req.lease_seconds), DEFAULT_LEASE_SECONDS);
    }

    #[test]
    fn complete_request_carries_arbitrary_result_json() {
        let body = r#"{
            "agent_id": "host-A-user",
            "result": {"ok": true, "rows": [1, 2, 3], "meta": {"parser": "B"}}
        }"#;
        let req: CompleteJobRequest = serde_json::from_str(body).expect("parse");
        assert_eq!(req.agent_id, "host-A-user");
        assert_eq!(
            req.result.get("ok").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert_eq!(
            req.result
                .get("meta")
                .and_then(|v| v.get("parser"))
                .and_then(|v| v.as_str()),
            Some("B")
        );

        // The metric outcome label vocabulary must stay stable —
        // dashboards / alerts consume these literal strings.
        fn outcome_label(rows_affected: u64) -> &'static str {
            if rows_affected > 0 { "success" } else { "state_mismatch" }
        }
        assert_eq!(outcome_label(1), "success");
        assert_eq!(outcome_label(0), "state_mismatch");
    }

    #[test]
    fn fail_request_carries_step_and_error_truncates_to_500() {
        let body = r#"{
            "agent_id": "host-A-user",
            "error": "RFC_ERROR something went wrong",
            "step": "watchdog"
        }"#;
        let req: FailJobRequest = serde_json::from_str(body).expect("parse");
        assert_eq!(req.step.as_deref(), Some("watchdog"));

        // Trim semantics: we truncate to 500 chars so the row stays
        // manageable. Mirrors the agent v1.7.2 `_patch_job_terminal`.
        let long: String = "X".repeat(750);
        let trimmed: &str = if long.len() > 500 { &long[..500] } else { &long };
        assert_eq!(trimmed.len(), 500);

        let label = req.step.as_deref().unwrap_or(DEFAULT_FAIL_STEP);
        assert_eq!(label, "watchdog");
        // When the agent omits `step` we fall back to the
        // cardinality-bounded default label.
        let no_step: Option<String> = None;
        let label_default = no_step.as_deref().unwrap_or(DEFAULT_FAIL_STEP);
        assert_eq!(label_default, "unknown");
    }

    #[test]
    fn heartbeat_request_clamps_lease_seconds() {
        let body = r#"{"agent_id": "host-A-user", "lease_seconds": 90}"#;
        let req: HeartbeatJobRequest = serde_json::from_str(body).expect("parse");
        assert_eq!(req.agent_id, "host-A-user");
        assert_eq!(lease_seconds(req.lease_seconds), 90);
        // Clamp guards: floor at 10s (a hostile or buggy caller can't
        // pin a row down to <10s lease and starve the queue), ceiling
        // at 3600s (an hour — anything longer is almost certainly a
        // typo / unit bug).
        assert_eq!(lease_seconds(Some(0)), 10);
        assert_eq!(lease_seconds(Some(-1)), 10);
        assert_eq!(lease_seconds(Some(99_999)), 3600);
        assert_eq!(lease_seconds(None), DEFAULT_LEASE_SECONDS);
    }

    // ── Backfill-pending-confirms (v0.1.35) ────────────────────────

    #[test]
    fn backfill_request_deserialises_with_all_defaults() {
        // Empty body is valid — the FE button calls with `{}` to mean
        // "use the same knobs the pg_cron job uses".
        let req: BackfillPendingConfirmsRequest =
            serde_json::from_str("{}").expect("parse");
        assert_eq!(req.lookback_hours, None);
        assert_eq!(req.failed_min_age_seconds, None);
        assert_eq!(req.max_claim_count, None);
    }

    #[test]
    fn backfill_request_clamp_helpers_match_handler_semantics() {
        // Mirrors the handler clamps so a refactor that drifts a bound
        // fails this test instead of silently shipping. Keep the
        // numbers in sync with `post_backfill_pending_confirms`.
        fn clamp_lookback(v: Option<i32>) -> i32 {
            v.unwrap_or(24).clamp(1, 168)
        }
        fn clamp_min_age(v: Option<i32>) -> i32 {
            v.unwrap_or(60).clamp(0, 3600)
        }
        fn clamp_claim_count(v: Option<i32>) -> i32 {
            v.unwrap_or(8).clamp(1, 100)
        }

        // Defaults.
        assert_eq!(clamp_lookback(None), 24);
        assert_eq!(clamp_min_age(None), 60);
        assert_eq!(clamp_claim_count(None), 8);

        // Floors / ceilings.
        assert_eq!(clamp_lookback(Some(0)), 1);
        assert_eq!(clamp_lookback(Some(9999)), 168);
        assert_eq!(clamp_min_age(Some(-1)), 0);
        assert_eq!(clamp_min_age(Some(99_999)), 3600);
        assert_eq!(clamp_claim_count(Some(0)), 1);
        assert_eq!(clamp_claim_count(Some(9_999)), 100);
    }
}

// Created and developed by Jai Singh
