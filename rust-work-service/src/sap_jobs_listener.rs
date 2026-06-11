// Created and developed by Jai Singh
//! `LISTEN sap_agent_job_changed` consumer.
//!
//! Spawned once at boot. On each Postgres NOTIFY (emitted by the
//! trigger added in migration 271), parses the JSON payload, builds a
//! `WsEvent::SapJobStatusChanged`, and broadcasts it via the existing
//! `broadcast::Sender<WsEvent>` so all connected WS clients with a
//! matching org subscription receive it.
//!
//! Replaces the per-job ephemeral
//! `supabase.channel('sap-agent-job-{id}')` callsite in
//! `src/features/admin/sap-testing/hooks/use-job-queue.ts`. See
//! `memorybank/OmniFrame/Implementations/Migrate-Tier1-Deferred-Channels-To-Rust-WS.md`.
//!
//! Logging is intentionally `tracing::debug!` rather than `info!`
//! because `sap_agent_jobs` UPDATEs once per agent
//! heartbeat-while-running (~5s cadence) — at fleet scale this is high
//! cardinality.
//!
//! Phase 5 (2026-05-06) — added `patch_audit_row_on_terminal()` side
//! effect. The Phase 5 `/api/v1/sap-mutations/material-master` route
//! INSERTs a paired `sap_audit_log` row at `status='pending'` and
//! links its `job_id` to the new `sap_agent_jobs` row before it
//! returns. When the agent later completes / fails / cancels the
//! job, this listener flips the matching audit row to the terminal
//! status.
//!
//! 2026-05-07 — switched from a hand-rolled `PgListener` reconnect
//! loop to [`crate::pglistener::run`] so the listener can survive a
//! silent TCP drop. See
//! `memorybank/OmniFrame/Implementations/Implement-Resilient-PgListener.md`.

use serde::Deserialize;
use sqlx::PgPool;
use tokio::sync::broadcast;
use tracing::{debug, warn};
use uuid::Uuid;

use crate::pglistener::{self, NotifyFrame};
use crate::websocket::WsEvent;

/// LISTEN channel name. Centralised so the consolidated multi-
/// channel listener in `main.rs` and the legacy single-channel
/// [`run`] both reference the same string.
pub const CHANNEL: &str = "sap_agent_job_changed";

/// Wire shape produced by `notify_sap_agent_job_changed()` (migration 271).
#[derive(Debug, Deserialize)]
struct Notification {
    job_id: Uuid,
    organization_id: Uuid,
    status: String,
    #[serde(default)]
    step: Option<String>,
    op: String,
}

/// Statuses considered terminal for the audit-row patch.
///
/// Mirrors `sap_agent_jobs_status_check`'s `'completed' | 'failed' |
/// 'canceled'` triplet (note: SQL spelling is `canceled`, single-l).
fn is_terminal_status(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "canceled")
}

/// Patch the paired `sap_audit_log` row when a `sap_agent_jobs` row
/// reaches a terminal status.
async fn patch_audit_row_on_terminal(pool: &PgPool, n: &Notification) {
    if !is_terminal_status(&n.status) {
        return;
    }
    if n.op != "UPDATE" {
        return;
    }
    let result = sqlx::query(
        r#"
        UPDATE public.sap_audit_log
           SET status = $1
         WHERE job_id = $2
           AND status = 'pending'
        "#,
    )
    .bind(&n.status)
    .bind(n.job_id)
    .execute(pool)
    .await;
    match result {
        Ok(r) if r.rows_affected() > 0 => {
            debug!(
                job_id = %n.job_id,
                org_id = %n.organization_id,
                status = %n.status,
                rows = r.rows_affected(),
                "sap_jobs_listener: audit row patched to terminal status"
            );
        }
        Ok(_) => {
            debug!(
                job_id = %n.job_id,
                status = %n.status,
                "sap_jobs_listener: no pending audit row to patch (legacy job or already terminal)"
            );
        }
        Err(e) => {
            warn!(
                ?e,
                job_id = %n.job_id,
                status = %n.status,
                "sap_jobs_listener: audit row patch failed (skipped)"
            );
        }
    }
}

/// Per-frame handler. Safe to call from the consolidated multi-
/// channel dispatcher in `main.rs`.
pub async fn handle(
    frame: &NotifyFrame,
    pool: &PgPool,
    ws_tx: &broadcast::Sender<WsEvent>,
) {
    match serde_json::from_str::<Notification>(&frame.payload) {
        Ok(n) => {
            // Phase 5 — patch the paired audit row when the job
            // reaches a terminal status. Side-effect of the
            // WS broadcast; await BEFORE the broadcast so a
            // single listener tick is serial.
            patch_audit_row_on_terminal(pool, &n).await;

            let event = WsEvent::SapJobStatusChanged {
                job_id: n.job_id,
                organization_id: n.organization_id,
                status: n.status,
                step: n.step,
                op: n.op,
            };
            if let Err(e) = crate::websocket::broadcast_event(ws_tx, event) {
                debug!(?e, "sap_jobs_listener: no WS subscribers (ignored)");
            }
        }
        Err(e) => {
            warn!(
                ?e,
                payload = %frame.payload,
                "sap_jobs_listener: bad payload (skipped)"
            );
        }
    }
}

#[allow(dead_code)]
pub async fn run(pool: PgPool, ws_tx: broadcast::Sender<WsEvent>) {
    let pool_for_callback = pool.clone();
    pglistener::run(pool, CHANNEL, move |frame| {
        let pool = pool_for_callback.clone();
        let ws_tx = ws_tx.clone();
        async move {
            handle(&frame, &pool, &ws_tx).await;
        }
    })
    .await;
}

// ────────────────────────────────────────────────────────────────────
// Tests — pure-logic unit tests for the terminal-status filter.
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_filter_accepts_canonical_terminal_states() {
        assert!(is_terminal_status("completed"));
        assert!(is_terminal_status("failed"));
        assert!(is_terminal_status("canceled"));
    }

    #[test]
    fn terminal_filter_rejects_non_terminal_states() {
        assert!(!is_terminal_status("queued"));
        assert!(!is_terminal_status("running"));
        // Common typo defence — sap_agent_jobs uses single-l.
        assert!(!is_terminal_status("cancelled"));
        // Defensive case-sensitivity.
        assert!(!is_terminal_status("Completed"));
        assert!(!is_terminal_status(""));
    }
}

// Created and developed by Jai Singh
