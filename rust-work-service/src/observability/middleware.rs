// Created and developed by Jai Singh
//! Idempotency-Key middleware (Phase 1.5).
//!
//! Exposes a `lookup_or_record` helper that wraps a mutating route handler:
//!
//!   - Same `(organization_id, idempotency_key)` + same `request_hash` →
//!     return the recorded `(status, body)`.
//!   - Same key, different hash → return 409 `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD`.
//!   - No record → run the handler, persist the result on success.
//!
//! Pure GET requests are not idempotency-keyed; routes that don't mutate
//! should not call this helper.
//!
//! STATUS (2026-05-31): intentional Phase 1.5 foundation that is built,
//! tested (`tests/idempotency.rs`), migration-backed
//! (`work_request_idempotency`, supabase migration 256), and referenced by
//! the ops runbook (`docs/runbooks/work-engine/idempotency-replay-drift.md`
//! cites `observability::middleware::cleanup_expired` as the Rust cleanup
//! path). It is NOT yet wired into the mutating route handlers — the SAP
//! routes currently enforce idempotency inline via
//! `sap_agent_jobs.idempotency_key` — so the compiler reports these items
//! as "never used". We allow dead_code here rather than deleting documented,
//! migration-backed, runbook-referenced foundation. Remove this allow when
//! the generic middleware is wired into the mutating routes.
#![allow(dead_code)]

use serde_json::Value as Json;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum IdempotencyError {
    #[error("idempotency key reused with different payload")]
    KeyReusedDifferentPayload,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

#[derive(Debug, Clone)]
pub struct ReplayedResponse {
    pub status_code: i32,
    pub body: Json,
}

/// Canonicalize a JSON request body into a stable hash. Sort keys, drop
/// whitespace.
pub fn canonical_request_hash(body: &Json) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    let canonical = canonicalize(body);
    hasher.update(canonical.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn canonicalize(v: &Json) -> String {
    match v {
        Json::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let parts: Vec<String> = keys
                .iter()
                .map(|k| format!("{}:{}", canonicalize(&Json::String((*k).clone())), canonicalize(&map[*k])))
                .collect();
            format!("{{{}}}", parts.join(","))
        }
        Json::Array(arr) => format!("[{}]", arr.iter().map(canonicalize).collect::<Vec<_>>().join(",")),
        other => other.to_string(),
    }
}

/// Look up an idempotency record. Returns the recorded response if the same
/// key+hash exists, an error if the key was reused with a different hash,
/// or `None` to indicate the handler should proceed.
pub async fn lookup(
    pool: &PgPool,
    org_id: Uuid,
    key: &str,
    route: &str,
    request_hash: &str,
) -> Result<Option<ReplayedResponse>, IdempotencyError> {
    let row: Option<(String, Json, i32)> = sqlx::query_as(
        r#"SELECT request_hash, response_body, status_code
             FROM work_request_idempotency
            WHERE organization_id = $1 AND idempotency_key = $2 AND route = $3
              AND expires_at > now()"#,
    )
    .bind(org_id)
    .bind(key)
    .bind(route)
    .fetch_optional(pool)
    .await?;

    let Some((existing_hash, body, status)) = row else { return Ok(None) };
    if existing_hash != request_hash {
        return Err(IdempotencyError::KeyReusedDifferentPayload);
    }
    Ok(Some(ReplayedResponse { status_code: status, body }))
}

/// Persist the response after a successful mutation. MUST run in the same
/// transaction as the state change for at-most-once semantics.
pub async fn record(
    tx: &mut Transaction<'_, Postgres>,
    org_id: Uuid,
    key: &str,
    route: &str,
    request_hash: &str,
    status_code: i32,
    body: &Json,
) -> Result<(), IdempotencyError> {
    sqlx::query(
        r#"INSERT INTO work_request_idempotency
              (organization_id, idempotency_key, route, request_hash, response_body, status_code)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (organization_id, idempotency_key) DO NOTHING"#,
    )
    .bind(org_id)
    .bind(key)
    .bind(route)
    .bind(request_hash)
    .bind(body)
    .bind(status_code)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Run a TTL cleanup pass. Idempotent — safe to call from a 30-min ticker.
/// The plan offers two choices: pg_cron OR the Rust scheduler. This function
/// is the Rust path.
pub async fn cleanup_expired(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let r = sqlx::query("DELETE FROM work_request_idempotency WHERE expires_at < now()")
        .execute(pool)
        .await?;
    Ok(r.rows_affected())
}

// Created and developed by Jai Singh
