// Created and developed by Jai Singh
//! Phase 8 (2026-05-06) — server-owned dashboard snapshot endpoint
//! for the SAP Testing surface.
//!
//! `GET /api/v1/sap-testing/dashboard?include_audit=N&include_schedules=true`
//!
//! Consolidates the four-to-five round trips the FE used to fan out
//! across the SAP Testing tabs (`useAgentDetection().fleet`,
//! `useJobQueue.watchedJobs`, ad-hoc `sap_audit_log` queries,
//! `sap_agent_schedules` queries, plus the derived
//! `agent_id → capabilities` map) into a SINGLE request that runs all
//! four sub-queries against Postgres in parallel via
//! `tokio::try_join!` and ships back one document.
//!
//! Response shape (mirrored 1:1 in the FE
//! `src/lib/work-service/sap-testing-client.ts`):
//!
//! ```json
//! {
//!   "online_agents":       [{ ... FleetAgent ... }],
//!   "in_flight_jobs":      [{ ... RecentJob ... }],   // status ∈ running|claimed|queued
//!   "recent_audits":       [{ ... AuditLogRow ... }], // last N (default 50)
//!   "scheduled_jobs":      [{ ... ScheduledJob ... }],
//!   "fleet_capabilities":  { "<agent_id>": ["cap1", "cap2"] }
//! }
//! ```
//!
//! `online_agents` and `in_flight_jobs` re-use the `FleetAgent` /
//! `RecentJob` shapes already exported from
//! `crate::api::routes::sap_agents` (Phase 3) so the FE can share the
//! existing type imports without a parallel definition. The
//! `recent_audits` and `scheduled_jobs` shapes are new and live in
//! this module.
//!
//! Org-scoping: the route resolves `organization_id` from the JWT
//! claims via `AuthenticatedUser.organization_id` — never from the
//! request body or query string. Cross-tenant calls are impossible by
//! construction. Mirrors the convention in `presence.rs`,
//! `entity_focus.rs`, `notifications.rs`, `sap_agents.rs`.
//!
//! Schema notes:
//!   - `sap_audit_log` is the broad `(organization_id, transaction_code,
//!     action, status, payload, ...)` table; we surface the columns
//!     the FE renders and leave loose JSONB blobs as
//!     `serde_json::Value` so the route doesn't need to redeploy when
//!     the FE wants new fields.
//!   - `sap_agent_schedules` carries `enabled BOOLEAN` (NOT `active`)
//!     per the migration. The route filters `WHERE enabled = true`.
//!   - `in_flight_jobs` filters on `status IN ('running','claimed',
//!     'queued')`. `claimed` does not exist in the canonical status
//!     vocabulary today (status flips queued→running on claim) — it
//!     is included for forward-compat in case a future migration
//!     splits "lease-acquired but not yet started" into its own
//!     state.
//!
//! Phase 9 (NEXT, not running yet) will rewrite the trigger evaluator
//! on top of this dashboard endpoint. Phase 11 will delete the
//! per-hook fallbacks (see the FE hook's TODO markers).

use axum::{
    extract::{Extension, Query, State},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tracing::{debug, warn};
use uuid::Uuid;

use crate::api::error::{ApiError, ApiResult};
use crate::api::routes::sap_agents::{FleetAgent, RecentJob};
use crate::auth::AuthenticatedUser;
use crate::AppState;

/// Default `include_audit` value when the caller omits the query
/// param. Mirrors the FE hook's bootstrap call.
const DEFAULT_AUDIT_LIMIT: i32 = 50;
/// Hard ceiling on `include_audit` so a buggy/hostile caller can't
/// drag a 100k-row audit table over the wire in one request.
const MAX_AUDIT_LIMIT: i32 = 500;
/// Statuses surfaced under `in_flight_jobs`. `claimed` is included
/// for forward-compat (see module-level schema notes).
const IN_FLIGHT_STATUSES: &[&str] = &["running", "claimed", "queued"];

// ────────────────────────────────────────────────────────────────────
// Response types
// ────────────────────────────────────────────────────────────────────

/// One row of the `recent_audits` section. Mirrors
/// `src/lib/work-service/sap-testing-client.ts::AuditLogRow`. Loose
/// JSONB blobs (`payload`, `result`, `prev_state`) are passed through
/// as `serde_json::Value` so the FE can render whatever fields it
/// cares about without forcing a coordinated FE/BE deploy when the
/// audit blob shape evolves.
#[derive(Debug, Serialize)]
pub struct AuditLogRow {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub user_id: Option<Uuid>,
    pub transaction_code: String,
    pub action: String,
    pub status: String,
    pub step: Option<String>,
    pub payload: Option<serde_json::Value>,
    pub result: Option<serde_json::Value>,
    pub prev_state: Option<serde_json::Value>,
    pub sap_message: Option<String>,
    pub sap_message_type: Option<String>,
    pub agent_version: Option<String>,
    pub duration_ms: Option<i32>,
    pub job_id: Option<Uuid>,
    pub reverses_audit_id: Option<Uuid>,
    pub reversal_status: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, sqlx::FromRow)]
struct AuditLogRowDb {
    id: Uuid,
    organization_id: Uuid,
    user_id: Option<Uuid>,
    transaction_code: String,
    action: String,
    status: String,
    step: Option<String>,
    payload: Option<sqlx::types::Json<serde_json::Value>>,
    result: Option<sqlx::types::Json<serde_json::Value>>,
    prev_state: Option<sqlx::types::Json<serde_json::Value>>,
    sap_message: Option<String>,
    sap_message_type: Option<String>,
    agent_version: Option<String>,
    duration_ms: Option<i32>,
    job_id: Option<Uuid>,
    reverses_audit_id: Option<Uuid>,
    reversal_status: Option<String>,
    created_at: DateTime<Utc>,
}

impl From<AuditLogRowDb> for AuditLogRow {
    fn from(r: AuditLogRowDb) -> Self {
        Self {
            id: r.id,
            organization_id: r.organization_id,
            user_id: r.user_id,
            transaction_code: r.transaction_code,
            action: r.action,
            status: r.status,
            step: r.step,
            payload: r.payload.map(|j| j.0),
            result: r.result.map(|j| j.0),
            prev_state: r.prev_state.map(|j| j.0),
            sap_message: r.sap_message,
            sap_message_type: r.sap_message_type,
            agent_version: r.agent_version,
            duration_ms: r.duration_ms,
            job_id: r.job_id,
            reverses_audit_id: r.reverses_audit_id,
            reversal_status: r.reversal_status,
            created_at: r.created_at,
        }
    }
}

/// One row of the `scheduled_jobs` section. Mirrors
/// `src/lib/work-service/sap-testing-client.ts::ScheduledJob`. The
/// `payload` blob is loose JSON for the same forward-compat reason
/// `AuditLogRow.payload` is loose.
#[derive(Debug, Serialize)]
pub struct ScheduledJob {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub enabled: bool,
    pub cron_expression: String,
    pub endpoint: String,
    pub payload: serde_json::Value,
    pub assigned_agent_id: Option<String>,
    pub max_attempts: i32,
    pub priority: i32,
    pub last_run_at: Option<DateTime<Utc>>,
    pub last_job_id: Option<Uuid>,
    pub last_error: Option<String>,
    pub next_run_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, sqlx::FromRow)]
struct ScheduledJobDb {
    id: Uuid,
    organization_id: Uuid,
    name: String,
    description: Option<String>,
    enabled: bool,
    cron_expression: String,
    endpoint: String,
    payload: sqlx::types::Json<serde_json::Value>,
    assigned_agent_id: Option<String>,
    max_attempts: i32,
    priority: i32,
    last_run_at: Option<DateTime<Utc>>,
    last_job_id: Option<Uuid>,
    last_error: Option<String>,
    next_run_at: DateTime<Utc>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<ScheduledJobDb> for ScheduledJob {
    fn from(r: ScheduledJobDb) -> Self {
        Self {
            id: r.id,
            organization_id: r.organization_id,
            name: r.name,
            description: r.description,
            enabled: r.enabled,
            cron_expression: r.cron_expression,
            endpoint: r.endpoint,
            payload: r.payload.0,
            assigned_agent_id: r.assigned_agent_id,
            max_attempts: r.max_attempts,
            priority: r.priority,
            last_run_at: r.last_run_at,
            last_job_id: r.last_job_id,
            last_error: r.last_error,
            next_run_at: r.next_run_at,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

/// Aggregated dashboard payload returned by `/dashboard`.
#[derive(Debug, Serialize)]
pub struct DashboardResponse {
    pub online_agents: Vec<FleetAgent>,
    pub in_flight_jobs: Vec<RecentJob>,
    pub recent_audits: Vec<AuditLogRow>,
    pub scheduled_jobs: Vec<ScheduledJob>,
    pub fleet_capabilities: HashMap<String, Vec<String>>,
    /// Phase 10 — work-service-level capabilities (NOT per-agent).
    /// Surfaced so the FE can light up "Agent X is on Identity v2"
    /// badges (per-agent advertisement comes through the existing
    /// `fleet_capabilities` map; this field reflects what the
    /// service itself supports, regardless of which agents have
    /// migrated). Always populated; the FE never has to special-case
    /// a missing field.
    pub service_capabilities: Vec<String>,
}

/// Static const for the service-level capability set. Surfaced via
/// the dashboard's `service_capabilities` field. Phase 10 ships
/// `agent-identity-v2`; future phases append.
pub const SERVICE_CAPABILITIES: &[&str] = &[
    // Phase 10 (rust-work-service integration plan, 2026-05-07) —
    // service-key-derived agent JWTs (kind: "agent" claim, signed
    // locally by `WORK_SERVICE_AGENT_JWT_SECRET`, 15-min TTL,
    // verified by the middleware's local-verify path with a 60 s
    // revocation cache).
    "agent-identity-v2",
];

#[derive(Debug, Deserialize, Default)]
pub struct DashboardQuery {
    /// Number of audit rows to return. Default `DEFAULT_AUDIT_LIMIT`,
    /// clamped to `0..=MAX_AUDIT_LIMIT`. Pass `0` to skip the audit
    /// query entirely (tiny optimisation when the FE knows the audit
    /// panel is collapsed; today's hook always asks for 50).
    #[serde(default)]
    pub include_audit: Option<i32>,
    /// When `false`, skip the `sap_agent_schedules` query and return
    /// `scheduled_jobs: []`. Defaults to `true`. Today's hook always
    /// passes `true`; reserved for surfaces that don't render the
    /// schedules section.
    #[serde(default)]
    pub include_schedules: Option<bool>,
}

// ────────────────────────────────────────────────────────────────────
// Helpers — one per sub-query, each returns a Result so they slot
// into the tokio::try_join! shape below.
// ────────────────────────────────────────────────────────────────────

fn require_org(user: &AuthenticatedUser) -> ApiResult<Uuid> {
    let org_id_str = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;
    Uuid::parse_str(org_id_str)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))
}

#[derive(Debug, sqlx::FromRow)]
struct FleetAgentRowDb {
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

/// Fetch online agents with capabilities. Mirrors the Phase 3
/// `/fleet?status=online&include_capabilities=true` SQL — the
/// dashboard endpoint always returns capabilities (the
/// `fleet_capabilities` derived field needs them; payload size is
/// dominated by the `recent_audits` section anyway).
async fn fetch_online_agents(
    pool: &sqlx::PgPool,
    org_id: Uuid,
) -> ApiResult<Vec<FleetAgent>> {
    let rows: Vec<FleetAgentRowDb> = sqlx::query_as::<_, FleetAgentRowDb>(
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
            a.capabilities AS capabilities
        FROM public.sap_agents a
        WHERE a.organization_id = $1
          AND a.status = 'online'
        ORDER BY a.last_seen_at DESC
        "#,
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        warn!(?e, %org_id, "sap_testing::fetch_online_agents: db error");
        ApiError::Database(e)
    })?;

    Ok(rows
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
        .collect())
}

#[derive(Debug, sqlx::FromRow)]
struct RecentJobRowDb {
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

/// Fetch in-flight jobs (queued/running/claimed). Mirrors the Phase 3
/// `/jobs/recent?status=...` SQL but with a fixed status filter — the
/// dashboard surface only renders "what's currently moving", terminal
/// rows belong on the separate `RecentJobsCard` (Phase 3) which keeps
/// its own pagination knobs.
async fn fetch_in_flight_jobs(
    pool: &sqlx::PgPool,
    org_id: Uuid,
) -> ApiResult<Vec<RecentJob>> {
    let statuses: Vec<String> = IN_FLIGHT_STATUSES.iter().map(|s| s.to_string()).collect();
    let rows: Vec<RecentJobRowDb> = sqlx::query_as::<_, RecentJobRowDb>(
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
          AND j.status = ANY($2)
        ORDER BY j.created_at DESC
        LIMIT 200
        "#,
    )
    .bind(org_id)
    .bind(&statuses)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        warn!(?e, %org_id, "sap_testing::fetch_in_flight_jobs: db error");
        ApiError::Database(e)
    })?;

    Ok(rows
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
        .collect())
}

/// Fetch the last `limit` audit rows for the org, newest first.
async fn fetch_recent_audits(
    pool: &sqlx::PgPool,
    org_id: Uuid,
    limit: i32,
) -> ApiResult<Vec<AuditLogRow>> {
    let rows: Vec<AuditLogRowDb> = sqlx::query_as::<_, AuditLogRowDb>(
        r#"
        SELECT
            id,
            organization_id,
            user_id,
            transaction_code,
            action,
            status,
            step,
            payload,
            result,
            prev_state,
            sap_message,
            sap_message_type,
            agent_version,
            duration_ms,
            job_id,
            reverses_audit_id,
            reversal_status,
            created_at
        FROM public.sap_audit_log
        WHERE organization_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        "#,
    )
    .bind(org_id)
    .bind(limit as i64)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        warn!(?e, %org_id, limit, "sap_testing::fetch_recent_audits: db error");
        ApiError::Database(e)
    })?;

    Ok(rows.into_iter().map(AuditLogRow::from).collect())
}

/// Fetch enabled (`enabled = true`) `sap_agent_schedules` rows, ordered
/// alphabetically by `name` so the FE picker is stable across reloads.
async fn fetch_scheduled_jobs(
    pool: &sqlx::PgPool,
    org_id: Uuid,
) -> ApiResult<Vec<ScheduledJob>> {
    let rows: Vec<ScheduledJobDb> = sqlx::query_as::<_, ScheduledJobDb>(
        r#"
        SELECT
            id,
            organization_id,
            name,
            description,
            enabled,
            cron_expression,
            endpoint,
            payload,
            assigned_agent_id,
            max_attempts,
            priority,
            last_run_at,
            last_job_id,
            last_error,
            next_run_at,
            created_at,
            updated_at
        FROM public.sap_agent_schedules
        WHERE organization_id = $1
          AND enabled = true
        ORDER BY name ASC
        "#,
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        warn!(?e, %org_id, "sap_testing::fetch_scheduled_jobs: db error");
        ApiError::Database(e)
    })?;

    Ok(rows.into_iter().map(ScheduledJob::from).collect())
}

/// Build the `agent_id → capabilities` map from the already-fetched
/// fleet snapshot. No extra DB round-trip — pure derivation. Empty
/// capability vectors are still inserted so the FE doesn't have to
/// special-case "agent exists, capabilities unknown" (the value is
/// always a `Vec<String>` even when zero-length).
fn derive_fleet_capabilities(agents: &[FleetAgent]) -> HashMap<String, Vec<String>> {
    agents
        .iter()
        .map(|a| {
            let caps = a.capabilities.clone().unwrap_or_default();
            (a.id.clone(), caps)
        })
        .collect()
}

// ────────────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────────────

pub async fn get_dashboard(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    Query(q): Query<DashboardQuery>,
) -> ApiResult<Json<DashboardResponse>> {
    let org_uuid = require_org(&user)?;
    let include_audit = q
        .include_audit
        .unwrap_or(DEFAULT_AUDIT_LIMIT)
        .clamp(0, MAX_AUDIT_LIMIT);
    let include_schedules = q.include_schedules.unwrap_or(true);
    let started = Instant::now();

    // Run the four DB queries concurrently. `tokio::try_join!` fails
    // fast on the first error — a bad org_id surfaces as a Postgres
    // error on whichever query the planner picks first, but every
    // path returns the same `ApiError::Database` so the response shape
    // is consistent.
    //
    // The two optional sub-queries (`audits` + `schedules`) short-
    // circuit to `Ok(vec![])` when the caller opted out, so the
    // try_join! arms always have the same Future-Output type:
    // `ApiResult<Vec<_>>`.
    let agents_pool = &state.db_pool;
    let jobs_pool = &state.db_pool;
    let audits_pool = &state.db_pool;
    let schedules_pool = &state.db_pool;

    let agents_fut = fetch_online_agents(agents_pool, org_uuid);
    let jobs_fut = fetch_in_flight_jobs(jobs_pool, org_uuid);
    // `Box::pin` because the two arms have different concrete types
    // (real fetch future vs. ready future). This makes them
    // type-erased to `Pin<Box<dyn Future<Output = ApiResult<...>>>>`.
    let audits_fut: std::pin::Pin<
        Box<dyn std::future::Future<Output = ApiResult<Vec<AuditLogRow>>> + Send>,
    > = if include_audit > 0 {
        Box::pin(fetch_recent_audits(audits_pool, org_uuid, include_audit))
    } else {
        Box::pin(std::future::ready(Ok(Vec::new())))
    };
    let schedules_fut: std::pin::Pin<
        Box<dyn std::future::Future<Output = ApiResult<Vec<ScheduledJob>>> + Send>,
    > = if include_schedules {
        Box::pin(fetch_scheduled_jobs(schedules_pool, org_uuid))
    } else {
        Box::pin(std::future::ready(Ok(Vec::new())))
    };

    let (online_agents, in_flight_jobs, recent_audits, scheduled_jobs) =
        tokio::try_join!(agents_fut, jobs_fut, audits_fut, schedules_fut)?;

    let fleet_capabilities = derive_fleet_capabilities(&online_agents);

    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    debug!(
        org_id = %org_uuid,
        include_audit,
        include_schedules,
        agents = online_agents.len(),
        in_flight = in_flight_jobs.len(),
        audits = recent_audits.len(),
        schedules = scheduled_jobs.len(),
        elapsed_ms,
        "sap_testing::get_dashboard: served"
    );

    Ok(Json(DashboardResponse {
        online_agents,
        in_flight_jobs,
        recent_audits,
        scheduled_jobs,
        fleet_capabilities,
        service_capabilities: SERVICE_CAPABILITIES
            .iter()
            .map(|s| s.to_string())
            .collect(),
    }))
}

// ────────────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────────────

/// Build the sap-testing router, mounted by `main.rs` at
/// `/api/v1/sap-testing` (alphabetically placed between
/// `/sap-mutations` and `/work` in the router-nest list).
pub fn sap_testing_routes() -> Router<Arc<AppState>> {
    Router::new().route("/dashboard", get(get_dashboard))
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────
//
// Pure-logic coverage (no live Postgres needed). Live SQL execution
// is exercised via the broader `tests/integration/**` Vitest harness
// when the route is hit by the FE hook. The two tests here cover:
//
//   1. The optional `include_audit` / `include_schedules` flags route
//      correctly through the clamp + branch logic.
//   2. The `derive_fleet_capabilities` aggregation is correct for
//      mixed-capability fleets and tolerates `None`-capabilities
//      agents (which serialise as empty arrays on the wire).

#[cfg(test)]
mod tests {
    use super::*;

    fn fleet_agent_with(id: &str, caps: Option<Vec<String>>) -> FleetAgent {
        FleetAgent {
            id: id.to_string(),
            hostname: None,
            citrix_session: None,
            user_id: None,
            user_email: None,
            sap_system: None,
            sap_client: None,
            sap_user: None,
            version: None,
            status: "online".to_string(),
            last_seen_at: Utc::now(),
            process_started_at: None,
            capability_count: caps.as_ref().map(|c| c.len() as i32).unwrap_or(0),
            capabilities: caps,
        }
    }

    /// Phase 8 — the `derive_fleet_capabilities` step is what unblocks
    /// Phase 9's trigger evaluator routing decisions. It must:
    ///   - Produce one entry per fleet agent (even with no caps).
    ///   - Preserve the agent's capability vector verbatim.
    ///   - Tolerate `None` capabilities (FE serialises as `[]` not
    ///     `null` for forward-compat, and the FE's
    ///     `fleetHasCapability(...)` check is `.includes(cap)` on the
    ///     same vector).
    #[test]
    fn fleet_capabilities_aggregates_per_agent_and_handles_missing_caps() {
        let agents = vec![
            fleet_agent_with(
                "host-a",
                Some(vec![
                    "agent-side-triggers".to_string(),
                    "outbound-lt22-import".to_string(),
                ]),
            ),
            fleet_agent_with("host-b", Some(vec!["agent-token-check".to_string()])),
            fleet_agent_with("host-c", None),
            fleet_agent_with("host-d", Some(vec![])),
        ];

        let map = derive_fleet_capabilities(&agents);

        assert_eq!(map.len(), 4, "one entry per fleet agent");
        assert_eq!(
            map.get("host-a").unwrap(),
            &vec![
                "agent-side-triggers".to_string(),
                "outbound-lt22-import".to_string()
            ]
        );
        assert_eq!(
            map.get("host-b").unwrap(),
            &vec!["agent-token-check".to_string()]
        );
        // Both `None` and `Some(vec![])` collapse to the empty vector
        // on the wire so the FE doesn't have to special-case them.
        assert!(map.get("host-c").unwrap().is_empty());
        assert!(map.get("host-d").unwrap().is_empty());
    }

    /// Phase 8 — the parallel-aggregation contract:
    ///   - `include_audit=None` ⇒ default 50.
    ///   - `include_audit=Some(0)`    ⇒ skip the audit query (no rows).
    ///   - `include_audit > MAX_AUDIT_LIMIT` ⇒ clamped to MAX.
    ///   - Negative values are clamped to 0 (i.e. "skip").
    ///   - `include_schedules=None`  ⇒ default true.
    ///   - `include_schedules=Some(false)` ⇒ schedules section empty.
    ///
    /// The branch logic lives inside `get_dashboard`; this test
    /// exercises the clamp + default helpers and the serde
    /// Deserialize path through `serde_json` (functionally equivalent
    /// to the URL-encoded extractor for `Option<i32>` / `Option<bool>`
    /// fields — both go through serde's standard
    /// `Deserialize` impls, just with different surface syntax).
    #[test]
    fn dashboard_query_optional_flags_round_trip_and_clamp() {
        // Default-everything path. Empty JSON object exercises the
        // `#[serde(default)]` attribute on both fields.
        let q1: DashboardQuery = serde_json::from_str("{}").expect("empty parse");
        assert_eq!(q1.include_audit, None);
        assert_eq!(q1.include_schedules, None);
        assert_eq!(
            q1.include_audit.unwrap_or(DEFAULT_AUDIT_LIMIT).clamp(0, MAX_AUDIT_LIMIT),
            DEFAULT_AUDIT_LIMIT
        );
        assert!(q1.include_schedules.unwrap_or(true));

        // Explicit zero — caller asked to skip the audit query.
        let q2: DashboardQuery = serde_json::from_str(
            r#"{"include_audit": 0, "include_schedules": false}"#,
        )
        .expect("explicit parse");
        assert_eq!(q2.include_audit, Some(0));
        assert_eq!(q2.include_schedules, Some(false));
        assert_eq!(
            q2.include_audit.unwrap_or(DEFAULT_AUDIT_LIMIT).clamp(0, MAX_AUDIT_LIMIT),
            0
        );
        assert!(!q2.include_schedules.unwrap_or(true));

        // Above-ceiling — clamp to MAX_AUDIT_LIMIT so a hostile caller
        // can't drag the entire audit table over the wire.
        let q3: DashboardQuery =
            serde_json::from_str(r#"{"include_audit": 99999}"#).expect("oversize parse");
        assert_eq!(q3.include_audit, Some(99_999));
        assert_eq!(
            q3.include_audit.unwrap_or(DEFAULT_AUDIT_LIMIT).clamp(0, MAX_AUDIT_LIMIT),
            MAX_AUDIT_LIMIT
        );

        // Below-zero — clamp to 0 so a buggy caller can't break the
        // SQL `LIMIT $2` placeholder semantics.
        let q4: DashboardQuery =
            serde_json::from_str(r#"{"include_audit": -5}"#).expect("negative parse");
        assert_eq!(q4.include_audit, Some(-5));
        assert_eq!(
            q4.include_audit.unwrap_or(DEFAULT_AUDIT_LIMIT).clamp(0, MAX_AUDIT_LIMIT),
            0
        );

        // The IN_FLIGHT_STATUSES vocabulary is contract — dashboards/
        // alerts may key on it. Re-pin so a typo regression fails.
        assert_eq!(IN_FLIGHT_STATUSES, &["running", "claimed", "queued"]);
    }
}

// Created and developed by Jai Singh
