// Created and developed by Jai Singh
//! Phase 9 — boot + hot-reload loader for [`crate::triggers`].
//!
//! On startup, [`run`] reads every enabled `agent_triggers` row into a
//! shared `Arc<RwLock<TriggerSet>>`. It then `LISTEN`s on
//! `agent_triggers_changed` (NOTIFY trigger from migration 281) and
//! re-loads on each change so admins can author / edit / delete
//! triggers without restarting the service.
//!
//! Bad rows are LOGGED + SKIPPED — a single mis-typed filter or a
//! non-allowlisted `target_endpoint` does not poison the entire rule
//! set, and the loader stays running. The route handler that ingests
//! the CRUD form is the strict-validation guard; the loader's role is
//! defence-in-depth so a row that slipped past the route (manual SQL
//! INSERT, schema drift, etc.) doesn't crash the evaluator.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgPool;
use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::pglistener::{self, NotifyFrame};
use crate::triggers::config::{is_allowed_source_table, is_allowed_target_endpoint};
use crate::triggers::dsl::{parse_filter, Filter};

/// LISTEN channel name. Centralised so the consolidated listener in
/// `main.rs` and the legacy single-channel [`run`] both reference
/// the same string.
pub const CHANNEL: &str = "agent_triggers_changed";

/// One enabled trigger, ready to evaluate.
#[derive(Debug, Clone)]
#[allow(dead_code)] // `name` / `source_table` / `updated_at` are used by tracing! and the
                    // future "trigger fired" audit log; sqlx round-trips them.
pub struct TriggerRecord {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub name: String,
    pub source_table: String,
    pub source_events: Vec<String>,
    pub target_endpoint: String,
    pub payload_template: Value,
    pub post_success_patch: Option<Value>,
    pub filter: Filter,
    pub updated_at: DateTime<Utc>,
}

/// Indexed rule set. Lookup-by-source-table is the hot path (every
/// row event walks this index), so we pre-bucket the rows.
#[derive(Debug, Default, Clone)]
#[allow(dead_code)] // `total` is used by tracing! / future /api/v1/triggers/stats endpoint.
pub struct TriggerSet {
    pub by_table: HashMap<String, Vec<TriggerRecord>>,
    pub total: usize,
}

impl TriggerSet {
    /// Cheap read accessor — the evaluator clones the inner Vec ref
    /// only when there's at least one rule for this table.
    pub fn for_table(&self, table: &str) -> Option<&[TriggerRecord]> {
        self.by_table.get(table).map(|v| v.as_slice())
    }
}

/// Hard cap on initial-reload attempts before the loader gives up
/// and falls back to the LISTEN-driven retry path. Sized so the
/// total backoff window (~15s of sleep) comfortably exceeds the
/// 10s `acquire_timeout` on the listener pool — one retry past
/// the timeout is enough to absorb a single boot-pool race.
pub(crate) const INITIAL_RELOAD_MAX_ATTEMPTS: u32 = 5;

/// Long-running tokio task. Resilient PgListener handles connection
/// errors + watchdog reconnects; this fn owns the bounded-retry
/// initial-load + per-NOTIFY reload side effect.
///
/// 2026-05-07 — switched from a hand-rolled reconnect loop to
/// [`crate::pglistener::run`] so a silent TCP drop on the
/// `agent_triggers_changed` channel can no longer wedge the
/// hot-reload path. See
/// `memorybank/OmniFrame/Implementations/Implement-Resilient-PgListener.md`.
///
/// 2026-05-14 (v0.1.42) — wrapped the initial `reload(...)` call in
/// [`retry_initial_load`] so a transient `PoolTimedOut` at boot can
/// no longer leave the evaluator running against an empty
/// `TriggerSet` for the lifetime of the container. The original
/// v0.1.41 single-attempt branch logged a single `WARN` on
/// `PoolTimedOut` then silently proceeded; every subsequent
/// `rf_putaway_operation_changed` NOTIFY was dropped on the floor
/// because the evaluator's `set.read().await.for_table(...)` saw
/// `TriggerSet::default()` (no rules → no fires → no
/// `sap_agent_jobs` rows). Production was unwedged manually via an
/// admin `UPDATE agent_triggers ... RETURNING ...` (which fired a
/// fresh `agent_triggers_changed` NOTIFY and forced a reload), but
/// the underlying race remained. See
/// [[Debug/Fix-Trigger-Evaluator-Empty-After-v041-Restart]] for
/// the incident timeline.
#[allow(dead_code)]
pub async fn run(pool: PgPool, set: Arc<RwLock<TriggerSet>>) {
    initial_load(pool.clone(), set.clone()).await;

    let pool_for_callback = pool.clone();
    pglistener::run(pool, CHANNEL, move |frame| {
        let pool = pool_for_callback.clone();
        let set = set.clone();
        async move {
            handle(&frame, &pool, &set).await;
        }
    })
    .await;
}

/// Boot-time initial reload with the bounded retry policy
/// documented above. Pulled out of `run` so the consolidated
/// listener in `main.rs` can call it once at startup before
/// spawning the shared multi-channel LISTEN task.
pub async fn initial_load(pool: PgPool, set: Arc<RwLock<TriggerSet>>) {
    retry_initial_load(|| {
        let pool = pool.clone();
        let set = set.clone();
        async move { reload(&pool, &set).await }
    })
    .await;
}

/// Per-frame handler for the `agent_triggers_changed` NOTIFY.
/// Pure side-effect (full rule-set reload + error log). Safe to
/// call from the consolidated multi-channel dispatcher in
/// `main.rs`.
pub async fn handle(frame: &NotifyFrame, pool: &PgPool, set: &Arc<RwLock<TriggerSet>>) {
    debug!(payload = %frame.payload, "trigger_loader: NOTIFY received");
    if let Err(e) = reload(pool, set).await {
        error!(?e, "trigger_loader: reload after NOTIFY failed");
    }
}

/// Production backoff schedule. `attempt` is 1-indexed. Returns the
/// duration to sleep AFTER attempt N fails, before attempt N+1.
///
/// Bounded ~15s of sleep across 5 attempts (4 sleeps of 1s, 2s, 4s,
/// 8s; the 5th failure is the giveup step and never sleeps because
/// the LISTEN-driven retry path is the safety net — a wasted
/// trailing sleep would only delay recovery).
fn production_backoff(attempt: u32) -> Duration {
    Duration::from_secs(1u64 << (attempt - 1))
}

/// Bounded retry wrapper around the initial `reload(...)` call. Logs
/// at `info!` on success, `warn!` per intermediate failure (with
/// the next backoff), and `error!` once when the budget is
/// exhausted. Never panics; the caller's LISTEN-driven reload path
/// is the safety net so an admin can recover by bumping any
/// `agent_triggers.updated_at` to fire a fresh
/// `agent_triggers_changed` NOTIFY.
///
/// Backoff schedule (production):
///
/// - attempt 1 fails → sleep  1s, retry
/// - attempt 2 fails → sleep  2s, retry
/// - attempt 3 fails → sleep  4s, retry
/// - attempt 4 fails → sleep  8s, retry
/// - attempt 5 fails → log `error!`, return immediately (no
///   trailing 16s sleep — the LISTEN safety net picks up from
///   here, so a wasted final sleep would only delay recovery).
///
/// Total real-world wait depends on per-call `acquire_timeout`,
/// typically ~10s on `PoolTimedOut`.
///
/// The closure is invoked once per attempt and is allowed to
/// return any `sqlx::Error`. The most common production failure
/// is `PoolTimedOut` against an over-saturated pool, but the
/// retry policy is uniform across error classes — a row-shape
/// drift would also benefit from the retry, since the LISTEN
/// reload path will eventually fire on the next admin edit.
async fn retry_initial_load<F, Fut>(do_load: F)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<(), sqlx::Error>>,
{
    retry_initial_load_with_backoff(do_load, production_backoff).await
}

/// Inner retry loop with an injectable backoff function so tests can
/// stub it to `Duration::ZERO` and avoid 15s of real-time sleep.
/// Production callers go through [`retry_initial_load`] which wires
/// in [`production_backoff`].
async fn retry_initial_load_with_backoff<F, Fut, B>(mut do_load: F, backoff_fn: B)
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<(), sqlx::Error>>,
    B: Fn(u32) -> Duration,
{
    for attempt in 1u32..=INITIAL_RELOAD_MAX_ATTEMPTS {
        match do_load().await {
            Ok(()) => {
                info!(attempt, "trigger_loader: initial load succeeded");
                return;
            }
            Err(e) if attempt < INITIAL_RELOAD_MAX_ATTEMPTS => {
                let backoff = backoff_fn(attempt);
                warn!(
                    ?e,
                    attempt,
                    max_attempts = INITIAL_RELOAD_MAX_ATTEMPTS,
                    backoff_secs = backoff.as_secs(),
                    "trigger_loader: initial load failed; retrying after backoff"
                );
                tokio::time::sleep(backoff).await;
            }
            Err(e) => {
                error!(
                    ?e,
                    attempt,
                    max_attempts = INITIAL_RELOAD_MAX_ATTEMPTS,
                    "trigger_loader: initial load FAILED after {} retries; \
                     falling back to LISTEN-driven reload only",
                    INITIAL_RELOAD_MAX_ATTEMPTS
                );
            }
        }
    }
}

/// Read-and-replace the rule set. Bad rows are logged and skipped.
pub async fn reload(pool: &PgPool, set: &Arc<RwLock<TriggerSet>>) -> Result<(), sqlx::Error> {
    let rows: Vec<DbRow> = sqlx::query_as::<_, DbRow>(
        r#"
        SELECT
            id,
            organization_id,
            name,
            source_table,
            source_events,
            target_endpoint,
            match_filter,
            payload_template,
            post_success_patch,
            updated_at
        FROM public.agent_triggers
        WHERE enabled = true
        ORDER BY organization_id, created_at
        "#,
    )
    .fetch_all(pool)
    .await?;

    let total_db_rows = rows.len();
    let mut by_table: HashMap<String, Vec<TriggerRecord>> = HashMap::new();
    let mut accepted: usize = 0;
    let mut rejected: usize = 0;

    for row in rows {
        let id = row.id;
        let org = row.organization_id;
        let table = row.source_table.clone();
        let endpoint = row.target_endpoint.clone();

        if !is_allowed_source_table(&table) {
            warn!(
                trigger_id = %id,
                organization_id = %org,
                source_table = %table,
                "trigger_loader: rejecting row — source_table not allowlisted"
            );
            rejected += 1;
            continue;
        }
        if !is_allowed_target_endpoint(&endpoint) {
            warn!(
                trigger_id = %id,
                organization_id = %org,
                target_endpoint = %endpoint,
                "trigger_loader: rejecting row — target_endpoint not allowlisted"
            );
            rejected += 1;
            continue;
        }
        if row.source_events.is_empty() {
            warn!(
                trigger_id = %id,
                organization_id = %org,
                "trigger_loader: rejecting row — source_events array is empty"
            );
            rejected += 1;
            continue;
        }
        // Defence-in-depth — even though the evaluator only looks up
        // by `source_events.contains(&op)`, weed out anything that's
        // not the strict {INSERT, UPDATE, DELETE} set so a future
        // typo doesn't silently shadow a typo'd op.
        for op in &row.source_events {
            if !matches!(op.as_str(), "INSERT" | "UPDATE" | "DELETE") {
                warn!(
                    trigger_id = %id,
                    organization_id = %org,
                    op = %op,
                    "trigger_loader: rejecting row — source_events contains \
                     non-standard op"
                );
                rejected += 1;
                continue;
            }
        }
        let filter = match parse_filter(&row.match_filter) {
            Ok(f) => f,
            Err(e) => {
                warn!(
                    trigger_id = %id,
                    organization_id = %org,
                    pointer = %e.pointer,
                    error = %e.message,
                    "trigger_loader: rejecting row — match_filter failed DSL \
                     parse"
                );
                rejected += 1;
                continue;
            }
        };

        let rec = TriggerRecord {
            id,
            organization_id: org,
            name: row.name,
            source_table: row.source_table,
            source_events: row.source_events,
            target_endpoint: row.target_endpoint,
            payload_template: row.payload_template,
            post_success_patch: row.post_success_patch,
            filter,
            updated_at: row.updated_at,
        };

        by_table.entry(table).or_default().push(rec);
        accepted += 1;
    }

    let next = TriggerSet {
        total: accepted,
        by_table,
    };
    *set.write().await = next;

    info!(
        total_db_rows,
        accepted,
        rejected,
        "trigger_loader: rule set reloaded"
    );
    Ok(())
}

/// Internal sqlx mapper. The `serde_json::Value` columns are JSONB on
/// the wire — sqlx handles the conversion via its `json` feature.
#[derive(sqlx::FromRow)]
struct DbRow {
    id: Uuid,
    organization_id: Uuid,
    name: String,
    source_table: String,
    source_events: Vec<String>,
    target_endpoint: String,
    match_filter: Value,
    payload_template: Value,
    post_success_patch: Option<Value>,
    updated_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU32, Ordering};

    fn rec(table: &str, endpoint: &str) -> TriggerRecord {
        TriggerRecord {
            id: Uuid::nil(),
            organization_id: Uuid::nil(),
            name: "t".into(),
            source_table: table.into(),
            source_events: vec!["INSERT".into()],
            target_endpoint: endpoint.into(),
            payload_template: json!({}),
            post_success_patch: None,
            filter: Filter::Always,
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn trigger_set_indexes_by_table() {
        let mut by_table: HashMap<String, Vec<TriggerRecord>> = HashMap::new();
        by_table
            .entry("rf_putaway_operations".into())
            .or_default()
            .push(rec("rf_putaway_operations", "/sap/confirm-to"));
        by_table
            .entry("work_tasks".into())
            .or_default()
            .push(rec("work_tasks", "/sap/lt12"));

        let set = TriggerSet { by_table, total: 2 };
        assert_eq!(set.for_table("rf_putaway_operations").unwrap().len(), 1);
        assert_eq!(set.for_table("work_tasks").unwrap().len(), 1);
        assert!(set.for_table("unrelated_table").is_none());
    }

    /// Test backoff fn — instant retries so unit tests don't pay
    /// 15s of real-time sleep. Production goes through
    /// [`production_backoff`] (1s, 2s, 4s, 8s for attempts 1-4).
    fn instant_backoff(_attempt: u32) -> Duration {
        Duration::ZERO
    }

    /// 2026-05-14 (v0.1.42) — regression test for the bounded
    /// initial-reload retry loop. The v0.1.41 boot sequence got
    /// `PoolTimedOut` on its first reload, logged a single `WARN`,
    /// and silently proceeded with an empty `TriggerSet` — every
    /// subsequent `rf_putaway_operation_changed` NOTIFY was then
    /// dropped on the floor for the lifetime of the container.
    /// Production was unwedged manually via an admin
    /// `UPDATE agent_triggers ... RETURNING ...` (which fired a
    /// fresh `agent_triggers_changed` NOTIFY and forced the LISTEN
    /// path to reload), but the underlying race remained.
    ///
    /// This test asserts that `retry_initial_load_with_backoff`
    /// keeps calling the load closure until it succeeds. See
    /// [[Debug/Fix-Trigger-Evaluator-Empty-After-v041-Restart]].
    #[tokio::test]
    async fn retry_initial_load_recovers_after_transient_failures() {
        let calls = Arc::new(AtomicU32::new(0));
        let calls_ref = calls.clone();

        retry_initial_load_with_backoff(
            move || {
                let calls = calls_ref.clone();
                async move {
                    let n = calls.fetch_add(1, Ordering::SeqCst) + 1;
                    if n < 3 {
                        Err(sqlx::Error::PoolTimedOut)
                    } else {
                        Ok(())
                    }
                }
            },
            instant_backoff,
        )
        .await;

        assert_eq!(
            calls.load(Ordering::SeqCst),
            3,
            "retry loop must keep calling reload until it succeeds \
             (got {} calls; expected 2 failures + 1 success)",
            calls.load(Ordering::SeqCst)
        );
    }

    /// Once the bounded retry budget is exhausted, the loop logs
    /// `error!` and returns cleanly (it does NOT panic). The
    /// caller then falls through to the LISTEN-driven reload path,
    /// so the next `agent_triggers_changed` NOTIFY can still
    /// recover the evaluator. This locks in
    /// [`INITIAL_RELOAD_MAX_ATTEMPTS`] so a future tweak to a
    /// different cap is a deliberate, reviewed change.
    #[tokio::test]
    async fn retry_initial_load_gives_up_after_max_attempts() {
        let calls = Arc::new(AtomicU32::new(0));
        let calls_ref = calls.clone();

        retry_initial_load_with_backoff(
            move || {
                let calls = calls_ref.clone();
                async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    Err::<(), _>(sqlx::Error::PoolTimedOut)
                }
            },
            instant_backoff,
        )
        .await;

        assert_eq!(
            calls.load(Ordering::SeqCst),
            INITIAL_RELOAD_MAX_ATTEMPTS,
            "retry loop must stop after exactly INITIAL_RELOAD_MAX_ATTEMPTS \
             ({}) failed attempts (got {})",
            INITIAL_RELOAD_MAX_ATTEMPTS,
            calls.load(Ordering::SeqCst)
        );
    }

    /// First attempt succeeds → no retry, no sleep, single call.
    /// Guards against a future refactor that accidentally treats
    /// the success path as a retry.
    #[tokio::test]
    async fn retry_initial_load_does_not_retry_on_first_success() {
        let calls = Arc::new(AtomicU32::new(0));
        let calls_ref = calls.clone();

        retry_initial_load_with_backoff(
            move || {
                let calls = calls_ref.clone();
                async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    Ok(())
                }
            },
            instant_backoff,
        )
        .await;

        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "first-attempt success must not trigger a retry"
        );
    }

    /// Locks in [`production_backoff`] schedule (1s, 2s, 4s, 8s,
    /// 16s for attempts 1-5) so a future tweak is reviewed. The
    /// loop never invokes the 5th-attempt backoff in practice
    /// (giveup branch returns before sleeping), but the function
    /// is still exposed publicly for diagnostics.
    #[test]
    fn production_backoff_schedule_is_bounded() {
        assert_eq!(production_backoff(1), Duration::from_secs(1));
        assert_eq!(production_backoff(2), Duration::from_secs(2));
        assert_eq!(production_backoff(3), Duration::from_secs(4));
        assert_eq!(production_backoff(4), Duration::from_secs(8));
        // 5th attempt is the giveup step and the inner loop never
        // sleeps for it (see `retry_initial_load_with_backoff` —
        // the 5th-failure branch logs `error!` and returns), but
        // the function is total so a future change can rely on it.
        assert_eq!(production_backoff(5), Duration::from_secs(16));
        // Total sleep before the giveup attempt = 1+2+4+8 = 15s.
        let total: u64 = (1..INITIAL_RELOAD_MAX_ATTEMPTS)
            .map(|a| production_backoff(a).as_secs())
            .sum();
        assert_eq!(total, 15);
    }
}

// Created and developed by Jai Singh
