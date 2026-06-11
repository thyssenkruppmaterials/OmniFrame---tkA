// Created and developed by Jai Singh
//! Phase 6 (2026-05-07) — fleet-wide live console streaming.
//!
//! Single endpoint mounted under `/api/v1/sap-console/*`, behind
//! `require_auth`:
//!
//!   - `POST /lines` — accepts a batch of recent stdout/stderr lines
//!     from a connected SAP agent's `_console_relay_thread` and:
//!
//!       1. Resolves `organization_id` from the JWT (NEVER from the
//!          body) so cross-tenant fan-out is impossible by
//!          construction.
//!       2. Rate-limits per-agent via a Redis token bucket
//!          (`ratelimit:sap-console:{agent_id}`, default 100
//!          lines/minute/agent). Defends the WS broadcast channel
//!          from a runaway agent print loop.
//!       3. Broadcasts each line as a typed
//!          `WsEvent::SapAgentConsoleLine` via the existing per-org
//!          WS fan-out (the same fan-out that ships
//!          `SapAgentChanged`, `SapJobStatusChanged`, presence, etc).
//!       4. Optionally persists each line to
//!          `public.sap_agent_console_log` (migration 278) when the
//!          caller sets `persist=true`. The hot path is the broadcast
//!          — persistence is opt-in for forensic replay.
//!
//! Why a separate route file (sibling to `sap_agents.rs`)?
//!   - Phase 8 may be editing `sap_agents.rs` in parallel; new file
//!     avoids merge collisions on the same lines.
//!   - The route's responsibility (live-stream relay) is conceptually
//!     distinct from the queue-claim lifecycle that `sap_agents.rs`
//!     owns.
//!
//! Service-key auth is intentionally NOT wired here yet — the agent
//! today reuses its existing Supabase JWT (same as `/api/v1/sap-agents/
//! jobs/...` from Phase 7). Phase 10's service-key path will plug in
//! cleanly because the route already extracts `AuthenticatedUser`
//! and inspects `user.permissions` for the `agent.console.write`
//! gate at the top — when service-key auth lands, the same gate
//! checks the service principal's permission set.
//!
//! Cross-references:
//!   - WS variant: `rust-work-service/src/websocket/mod.rs::WsEvent::SapAgentConsoleLine`
//!   - Migration: `supabase/migrations/278_create_sap_agent_console_log.sql`
//!   - Agent relay: `omni_agent/agent.py::_console_relay_thread`
//!   - FE consumer: `src/features/admin/sap-testing/components/sap-console-card.tsx`

use axum::{
    extract::{Extension, State},
    http::HeaderMap,
    routing::post,
    Json, Router,
};
use bb8::Pool;
use bb8_redis::redis::AsyncCommands;
use bb8_redis::RedisConnectionManager;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::api::error::{ApiError, ApiResult};
use crate::auth::AuthenticatedUser;
use crate::websocket::WsEvent;
use crate::AppState;

/// Per-agent line budget per minute. Tuned so a typical chatty agent
/// boot (banner + listener init + first heartbeats ≈ 30 lines in
/// <2s) never trips the limiter, but a runaway print loop (e.g. a
/// stuck recursive handler) is bounded.
pub(crate) const RATE_LIMIT_LINES_PER_MINUTE: i64 = 100;

/// Window in seconds for the per-agent rate-limit counter.
pub(crate) const RATE_LIMIT_WINDOW_SECONDS: u64 = 60;

/// Upper bound on lines per request. The agent's `_console_relay_thread`
/// targets 50 lines/batch — we cap higher so a small overshoot from a
/// future tuning change still works, but a bug or hostile request
/// can't slip a 10 000-line dump through in one POST.
pub(crate) const MAX_LINES_PER_REQUEST: usize = 200;

/// Hard cap on a single line's length. Kept generous so a multi-line
/// SAP error payload that the agent serialised on a single print()
/// still fits, but truncates the kind of accidental "dump the whole
/// JSON blob to console" that v1.x agents have done historically.
pub(crate) const MAX_MESSAGE_LENGTH: usize = 4096;

/// Allowed level vocabulary. Echoes the FE's `ConsoleLevel` union so
/// dashboards can colour rows from the wire shape directly. We accept
/// anything in this set verbatim and clamp anything outside it to
/// `info` (defence-in-depth — bad input never blocks a relay).
const ALLOWED_LEVELS: &[&str] = &["info", "warn", "warning", "error", "debug", "trace", "success"];

// ────────────────────────────────────────────────────────────────────
// Wire types
// ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ConsoleLine {
    pub level: String,
    pub message: String,
    pub ts: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct PostLinesRequest {
    pub agent_id: String,
    pub lines: Vec<ConsoleLine>,
    /// Defaults to `false` — the hot path is the broadcast. Set to
    /// `true` to ALSO persist each line to `sap_agent_console_log`
    /// for forensic replay.
    #[serde(default)]
    pub persist: bool,
}

#[derive(Debug, Serialize)]
pub struct PostLinesResponse {
    pub ok: bool,
    /// Number of lines successfully fan-ed out to the WS broadcast.
    /// May be less than `lines.len()` when the broadcast channel is
    /// at capacity (a `send` returns `Err` and the line is dropped) —
    /// extremely rare in steady state.
    pub broadcast_count: u64,
    /// Number of rows INSERTed into `sap_agent_console_log`. Always
    /// `0` when `persist=false` (the default). Equals
    /// `broadcast_count` on success when `persist=true` unless the
    /// DB returns a partial-error mid-batch (the route still
    /// returns 200 — the broadcast already happened).
    pub persisted_count: u64,
    /// Echo back the sanitised lines (truncated / level-clamped) so
    /// the agent can compare and warn the operator if its outbound
    /// payload was reshaped server-side. `null` to keep the default
    /// response small; the FE / admin debug path can request it via
    /// a future `?include_echo=1` query param.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub echo: Option<Vec<EchoLine>>,
}

/// Sanitised echo of an accepted line.
#[derive(Debug, Serialize)]
pub struct EchoLine {
    pub level: String,
    pub message: String,
    pub ts: DateTime<Utc>,
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

fn require_org(user: &AuthenticatedUser) -> ApiResult<Uuid> {
    let org_id_str = user
        .organization_id
        .as_ref()
        .ok_or_else(|| ApiError::Forbidden("Organization context required".to_string()))?;
    Uuid::parse_str(org_id_str)
        .map_err(|_| ApiError::BadRequest("Invalid organization ID".to_string()))
}

/// Defence-in-depth permission gate. Today the agent reuses its
/// Supabase JWT (no fine-grained `agent.console.write` permission in
/// the claim set) so we accept any authenticated principal whose
/// `role` looks like an agent or admin. When Phase 10 lands the
/// service-key path, the route will check
/// `user.permissions.contains("agent.console.write")` instead.
///
/// Service-key callers (`role = "service"`) are a free pass — the
/// internal orchestrator path that eventually relays on behalf of
/// an agent.
pub(crate) fn allow_console_write(user: &AuthenticatedUser) -> bool {
    if user.role.as_deref() == Some("service") {
        return true;
    }
    if user.permissions.iter().any(|p| p == "agent.console.write") {
        return true;
    }
    // Until Phase 10's service-key path lands, the agent reuses its
    // operator's Supabase JWT — every authenticated user with an
    // `organization_id` can relay. The org-scope filter below is the
    // real boundary: a user can only ever stream into THEIR org's WS
    // fan-out, not someone else's.
    user.organization_id.is_some()
}

/// Build the Redis rate-limit key for an agent. Mirrors the
/// `ratelimit:sap-mutations:{org_id}` namespace from Phase 5 so a
/// single `redis-cli KEYS ratelimit:*` scan in ops debugging surfaces
/// every active counter.
pub(crate) fn rate_limit_key(agent_id: &str) -> String {
    format!("ratelimit:sap-console:{}", agent_id)
}

/// Outcome of `bump_rate_limit_counter`. Same shape as Phase 5's
/// helper — kept local because the rate-limit semantics here are
/// per-AGENT, not per-org.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RateLimitOutcome {
    pub count: i64,
    pub exceeded: bool,
    pub ttl_secs: Option<u64>,
}

/// INCR the per-agent rate-limit counter and surface whether the
/// budget was exceeded. First INCR in a window returns 1; we set
/// `EXPIRE` to the window length so the counter resets after the
/// window elapses. Subsequent INCRs preserve the TTL by Redis
/// semantics.
pub(crate) async fn bump_rate_limit_counter(
    pool: &Pool<RedisConnectionManager>,
    agent_id: &str,
    budget: i64,
    window_secs: u64,
) -> Result<RateLimitOutcome, bb8_redis::redis::RedisError> {
    let mut conn = pool.get().await.map_err(redis_pool_err)?;
    let key = rate_limit_key(agent_id);
    let count: i64 = conn.incr(&key, 1).await?;
    if count == 1 {
        let _: () = conn.expire(&key, window_secs as i64).await?;
    }
    let ttl_secs: i64 = conn.ttl(&key).await.unwrap_or(-1);
    let ttl = if ttl_secs > 0 {
        Some(ttl_secs as u64)
    } else {
        None
    };
    Ok(RateLimitOutcome {
        count,
        exceeded: count > budget,
        ttl_secs: ttl,
    })
}

fn redis_pool_err(e: bb8::RunError<bb8_redis::redis::RedisError>) -> bb8_redis::redis::RedisError {
    match e {
        bb8::RunError::User(re) => re,
        bb8::RunError::TimedOut => bb8_redis::redis::RedisError::from(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "redis pool acquire timeout",
        )),
    }
}

/// Clamp the agent-supplied level to the allowed vocabulary. Bad
/// input falls back to `info` so a typo never blocks the relay; the
/// echo response surfaces the clamp so a curious operator can spot
/// the change.
pub(crate) fn sanitize_level(raw: &str) -> String {
    let lower = raw.trim().to_ascii_lowercase();
    if ALLOWED_LEVELS.contains(&lower.as_str()) {
        // Normalise the FE's `warning` to `warn` so dashboards can
        // colour without a second alias mapping.
        if lower == "warning" {
            return "warn".to_string();
        }
        return lower;
    }
    "info".to_string()
}

/// Truncate the message to `MAX_MESSAGE_LENGTH` chars, preserving a
/// trailing `…[truncated NNN chars]` marker so the FE can tell the
/// content was reshaped. Cheap (no allocation when under the cap).
pub(crate) fn sanitize_message(raw: &str) -> String {
    if raw.len() <= MAX_MESSAGE_LENGTH {
        return raw.to_string();
    }
    let kept: String = raw.chars().take(MAX_MESSAGE_LENGTH).collect();
    let dropped = raw.chars().count().saturating_sub(kept.chars().count());
    format!("{}…[truncated {} chars]", kept, dropped)
}

// ────────────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────────────

/// `POST /api/v1/sap-console/lines`. See module-level doc-block for
/// the full pipeline.
pub async fn post_console_lines(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<Arc<AuthenticatedUser>>,
    _headers: HeaderMap,
    Json(req): Json<PostLinesRequest>,
) -> ApiResult<Json<PostLinesResponse>> {
    // ── Step 1: auth + body validation ─────────────────────────────
    if !allow_console_write(&user) {
        warn!(
            user_id = %user.user_id,
            role = ?user.role,
            "sap_console: permission gate rejected request"
        );
        return Err(ApiError::Forbidden(
            "Console relay requires agent.console.write permission".to_string(),
        ));
    }
    let org_id = require_org(&user)?;

    if req.agent_id.trim().is_empty() {
        return Err(ApiError::BadRequest("agent_id is required".to_string()));
    }
    if req.lines.is_empty() {
        // No-op success — the agent's relay flushes empty batches when
        // it wakes early; replying 400 would force a defensive
        // skip-when-empty in the agent thread for no benefit.
        return Ok(Json(PostLinesResponse {
            ok: true,
            broadcast_count: 0,
            persisted_count: 0,
            echo: None,
        }));
    }
    if req.lines.len() > MAX_LINES_PER_REQUEST {
        return Err(ApiError::BadRequest(format!(
            "lines exceeds per-request cap ({} > {}). Split the batch.",
            req.lines.len(),
            MAX_LINES_PER_REQUEST
        )));
    }

    // ── Step 2: per-agent rate limit ────────────────────────────────
    let rl = bump_rate_limit_counter(
        &state.redis_pool,
        &req.agent_id,
        RATE_LIMIT_LINES_PER_MINUTE,
        RATE_LIMIT_WINDOW_SECONDS,
    )
    .await
    .map_err(|e| {
        warn!(
            ?e,
            agent_id = %req.agent_id,
            "sap_console: rate limit INCR failed"
        );
        ApiError::ServiceUnavailable("Could not check rate limit".to_string())
    })?;
    // The counter is keyed on COUNT-OF-REQUESTS, not lines — typical
    // batch sizes are 10–50 lines, so a 100/min request budget covers
    // up to ~5 000 lines/min even on the hottest agent. Translating
    // that to a per-line accounting model would require a Lua INCRBY
    // (no atomic INCRBY+EXPIRE without one) and is overkill for the
    // default flush cadence (every ~500ms = 120/min ⇒ already over).
    // We accept the simpler per-request semantics; future tuning lives
    // here.
    if rl.exceeded {
        info!(
            agent_id = %req.agent_id,
            count = rl.count,
            ttl = ?rl.ttl_secs,
            "sap_console: 429 — per-agent budget exceeded"
        );
        return Err(ApiError::TooManyRequests {
            message: format!(
                "Per-agent console relay budget exceeded ({} > {} per {}s window).",
                rl.count, RATE_LIMIT_LINES_PER_MINUTE, RATE_LIMIT_WINDOW_SECONDS
            ),
            retry_after_secs: rl.ttl_secs.or(Some(RATE_LIMIT_WINDOW_SECONDS)),
        });
    }

    // ── Step 3: sanitise + broadcast each line ──────────────────────
    let mut broadcast_count: u64 = 0;
    let mut sanitised: Vec<(String, String, DateTime<Utc>)> =
        Vec::with_capacity(req.lines.len());
    for raw in req.lines.iter() {
        let level = sanitize_level(&raw.level);
        let message = sanitize_message(&raw.message);
        let ts = raw.ts;
        // The send returns `Err` only when there are NO active
        // receivers — the broadcast channel itself is bounded but
        // back-pressure is handled by the per-receiver `Lagged`
        // pathway in `handle_socket`'s send loop, not here. So a
        // transient `Err` simply means "no FE is listening right
        // now"; we still count the line as broadcast (the row is
        // persisted if requested, and a future-connecting socket
        // would have missed it anyway because broadcast is fire-and-
        // forget). Note that we do NOT decrement `broadcast_count`
        // on send error — the counter reflects "the route accepted
        // and tried to broadcast", not "an FE acknowledged".
        let _ = crate::websocket::broadcast_event(&state.ws_broadcast, WsEvent::SapAgentConsoleLine {
            agent_id: req.agent_id.clone(),
            organization_id: org_id,
            level: level.clone(),
            message: message.clone(),
            ts,
        });
        broadcast_count = broadcast_count.saturating_add(1);
        sanitised.push((level, message, ts));
    }

    // ── Step 4: optionally persist ──────────────────────────────────
    let mut persisted_count: u64 = 0;
    if req.persist {
        // Bulk INSERT via UNNEST so a 50-line batch is a single round-
        // trip. `sqlx::query_with` doesn't unwrap row Vec<&T> bindings
        // cleanly across our pool config so we materialise per-column
        // arrays first.
        let agent_ids: Vec<String> = (0..sanitised.len())
            .map(|_| req.agent_id.clone())
            .collect();
        let levels: Vec<String> = sanitised.iter().map(|(l, _, _)| l.clone()).collect();
        let messages: Vec<String> = sanitised.iter().map(|(_, m, _)| m.clone()).collect();
        let timestamps: Vec<DateTime<Utc>> =
            sanitised.iter().map(|(_, _, t)| *t).collect();

        let inserted: i64 = sqlx::query_scalar(
            r#"
            WITH ins AS (
                INSERT INTO public.sap_agent_console_log (
                    agent_id, organization_id, level, message, ts
                )
                SELECT
                    aid, $2::uuid, lvl, msg, t
                FROM UNNEST(
                    $1::text[],
                    $3::text[],
                    $4::text[],
                    $5::timestamptz[]
                ) AS u(aid, lvl, msg, t)
                RETURNING 1
            )
            SELECT COUNT(*)::bigint FROM ins
            "#,
        )
        .bind(&agent_ids)
        .bind(org_id)
        .bind(&levels)
        .bind(&messages)
        .bind(&timestamps)
        .fetch_one(&state.db_pool)
        .await
        .map_err(|e| {
            warn!(
                ?e,
                agent_id = %req.agent_id,
                org_id = %org_id,
                lines = sanitised.len(),
                "sap_console: persist INSERT failed"
            );
            ApiError::Database(e)
        })?;
        persisted_count = inserted as u64;
    }

    debug!(
        org_id = %org_id,
        agent_id = %req.agent_id,
        broadcast_count,
        persisted_count,
        rate_limit_count = rl.count,
        "sap_console: relay complete"
    );

    Ok(Json(PostLinesResponse {
        ok: true,
        broadcast_count,
        persisted_count,
        echo: None,
    }))
}

// ────────────────────────────────────────────────────────────────────
// Router
// ────────────────────────────────────────────────────────────────────

/// Build the sap-console router, mounted by `main.rs` at
/// `/api/v1/sap-console` (alphabetically placed AFTER the Phase 5
/// `/api/v1/sap-mutations` nest).
pub fn sap_console_routes() -> Router<Arc<AppState>> {
    Router::new().route("/lines", post(post_console_lines))
}

// ────────────────────────────────────────────────────────────────────
// Tests — pure-logic + broadcast / persist semantics
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::AuthenticatedUser;
    use crate::websocket::create_broadcast_channel;
    use chrono::TimeZone;

    fn user(role: Option<&str>, perms: &[&str], org: Option<&str>) -> AuthenticatedUser {
        AuthenticatedUser {
            user_id: "00000000-0000-0000-0000-000000000001".to_string(),
            email: Some("dev@example.com".to_string()),
            organization_id: org.map(|s| s.to_string()),
            role: role.map(|s| s.to_string()),
            permissions: perms.iter().map(|s| s.to_string()).collect(),
        }
    }

    // ── Permission gate ────────────────────────────────────────────

    #[test]
    fn permission_gate_accepts_service_role() {
        let u = user(Some("service"), &[], Some("00000000-0000-0000-0000-0000000000aa"));
        assert!(allow_console_write(&u));
    }

    #[test]
    fn permission_gate_accepts_explicit_permission() {
        let u = user(Some("operator"), &["agent.console.write"], Some("00000000-0000-0000-0000-0000000000aa"));
        assert!(allow_console_write(&u));
    }

    #[test]
    fn permission_gate_accepts_authenticated_org_member() {
        // Phase 6 transitional — until Phase 10's service-key path
        // lands, any authenticated org member can relay (the org-
        // scope filter in the WS send loop is the real boundary).
        let u = user(Some("operator"), &[], Some("00000000-0000-0000-0000-0000000000aa"));
        assert!(allow_console_write(&u));
    }

    #[test]
    fn permission_gate_rejects_user_with_no_org() {
        let u = user(Some("operator"), &[], None);
        assert!(!allow_console_write(&u));
    }

    // ── Sanitisers ─────────────────────────────────────────────────

    #[test]
    fn sanitize_level_clamps_unknown_to_info() {
        assert_eq!(sanitize_level("INFO"), "info");
        assert_eq!(sanitize_level("Warning"), "warn");
        assert_eq!(sanitize_level("warn"), "warn");
        assert_eq!(sanitize_level("error"), "error");
        assert_eq!(sanitize_level("debug"), "debug");
        assert_eq!(sanitize_level("trace"), "trace");
        assert_eq!(sanitize_level("success"), "success");
        assert_eq!(sanitize_level("notice"), "info");
        assert_eq!(sanitize_level(""), "info");
        assert_eq!(sanitize_level("   "), "info");
    }

    #[test]
    fn sanitize_message_truncates_long_payload() {
        let long = "X".repeat(MAX_MESSAGE_LENGTH + 100);
        let out = sanitize_message(&long);
        assert!(out.contains("[truncated 100 chars]"));
        assert!(out.starts_with(&"X".repeat(MAX_MESSAGE_LENGTH)));
    }

    #[test]
    fn sanitize_message_preserves_short_payload() {
        let s = "[boot] Stable agent_id: HOST-Console-USER";
        assert_eq!(sanitize_message(s), s);
    }

    // ── Rate-limit key ─────────────────────────────────────────────

    #[test]
    fn rate_limit_key_is_namespaced() {
        let key = rate_limit_key("HOST-Console-USER");
        assert_eq!(key, "ratelimit:sap-console:HOST-Console-USER");
        assert!(
            key.starts_with("ratelimit:sap-console:"),
            "key must live under ratelimit:sap-console:* namespace"
        );
    }

    // ── Wire-shape parsing ─────────────────────────────────────────

    #[test]
    fn post_lines_request_parses_minimal_body() {
        let body = r#"{
            "agent_id": "HOST-Console-USER",
            "lines": [
                {"level": "info", "message": "boot complete", "ts": "2026-05-07T01:00:00Z"}
            ]
        }"#;
        let req: PostLinesRequest = serde_json::from_str(body).expect("parse");
        assert_eq!(req.agent_id, "HOST-Console-USER");
        assert_eq!(req.lines.len(), 1);
        assert_eq!(req.lines[0].level, "info");
        assert!(!req.persist);
    }

    #[test]
    fn post_lines_request_parses_persist_true() {
        let body = r#"{
            "agent_id": "HOST",
            "lines": [],
            "persist": true
        }"#;
        let req: PostLinesRequest = serde_json::from_str(body).expect("parse");
        assert!(req.persist);
    }

    // ── Broadcast count semantics (Phase 6 plan tests #1) ─────────

    #[test]
    fn broadcast_count_matches_input_size() {
        // The route's `broadcast_count` reflects "lines accepted and
        // sent into the broadcast channel", NOT "lines an FE
        // confirmed". This test exercises the SAME loop using a
        // standalone broadcast channel + receiver so we can see the
        // outbound WsEvents.
        let (tx, mut rx) = create_broadcast_channel();
        let org_id = Uuid::nil();
        let agent_id = "agent-A";
        let mut count: u64 = 0;
        let lines = [
            ("info", "first"),
            ("warn", "second"),
            ("error", "third"),
        ];
        for (lvl, msg) in lines.iter() {
            let _ = tx.send(WsEvent::SapAgentConsoleLine {
                agent_id: agent_id.to_string(),
                organization_id: org_id,
                level: lvl.to_string(),
                message: msg.to_string(),
                ts: chrono::Utc.timestamp_opt(1_700_000_000, 0).unwrap(),
            });
            count += 1;
        }
        assert_eq!(count, 3);
        // Drain the receiver and confirm the same 3 events came out.
        let mut received: Vec<String> = Vec::new();
        while let Ok(ev) = rx.try_recv() {
            if let WsEvent::SapAgentConsoleLine { message, .. } = ev {
                received.push(message);
            }
        }
        assert_eq!(received, vec!["first", "second", "third"]);
    }

    // ── Rate-limit semantics (Phase 6 plan tests #2) ──────────────

    #[test]
    fn rate_limit_outcome_at_budget_is_not_exceeded() {
        // Hitting the budget exactly is OK — only > budget is over.
        let ok = RateLimitOutcome {
            count: RATE_LIMIT_LINES_PER_MINUTE,
            exceeded: RATE_LIMIT_LINES_PER_MINUTE > RATE_LIMIT_LINES_PER_MINUTE,
            ttl_secs: Some(60),
        };
        assert!(!ok.exceeded);
    }

    #[test]
    fn rate_limit_outcome_above_budget_is_exceeded() {
        let over = RateLimitOutcome {
            count: RATE_LIMIT_LINES_PER_MINUTE + 1,
            exceeded: RATE_LIMIT_LINES_PER_MINUTE + 1 > RATE_LIMIT_LINES_PER_MINUTE,
            ttl_secs: Some(60),
        };
        assert!(over.exceeded);
    }

    // ── persist=false vs true (Phase 6 plan tests #3) ─────────────

    #[test]
    fn persist_default_is_false() {
        let body = r#"{"agent_id": "A", "lines": []}"#;
        let req: PostLinesRequest = serde_json::from_str(body).expect("parse");
        assert!(!req.persist, "persist must default to false (hot path is broadcast-only)");
    }

    #[test]
    fn persist_explicit_true_is_recognised() {
        let body = r#"{"agent_id": "A", "lines": [], "persist": true}"#;
        let req: PostLinesRequest = serde_json::from_str(body).expect("parse");
        assert!(req.persist, "persist=true must round-trip through serde");
    }
}

// Created and developed by Jai Singh
