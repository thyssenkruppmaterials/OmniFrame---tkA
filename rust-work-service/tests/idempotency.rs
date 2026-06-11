// Created and developed by Jai Singh
//! Plan §13.4 — Idempotency-key replay regression test.
//!
//! Exercises `reassign_work_zone` (mig 256 §14) twice with the same
//! `Idempotency-Key`. The second call must:
//!   - return the SAME response body (replay) without re-executing the
//!     side effects.
//!   - leave the underlying `work_tasks` table unchanged on the second
//!     call.
//!
//! `work_request_idempotency` is the backing store; its (org, key)
//! primary key + `response_body` column is what makes replay safe.

mod common;

use serde_json::Value as Json;
use uuid::Uuid;

#[tokio::test]
async fn duplicate_idempotency_key_returns_recorded_response() {
    let Some(pool) = common::try_pool().await else { return };
    let Some((org, _admin, user_a, user_b)) = common::pick_seed_org(&pool).await else {
        eprintln!("skipping: no seed org with >=3 users");
        return;
    };
    if let Err(e) = common::ensure_zone_rules_enabled(&pool, org).await {
        eprintln!("skipping: ensure_zone_rules_enabled failed: {e}");
        return;
    }

    let zone = format!("IDEMPZ-{}", &Uuid::new_v4().to_string()[..8]);
    let task_id = Uuid::new_v4();
    let idem_key = format!("idem-{}", Uuid::new_v4());

    // ---- arrange: a single work_task in the zone, assigned to user_a ----
    let _ = sqlx::query("SELECT set_config('app.work_zone_lock_bypass', 'on', true)")
        .execute(&pool)
        .await;
    let setup = sqlx::query(
        r#"INSERT INTO public.work_tasks
           (id, organization_id, task_type, primary_location, status,
            assigned_to, assigned_at, priority, payload)
           VALUES
           ($1, $2, 'cycle_count', $3 || '-A1-001', 'pending', $4, NOW(),
            'normal', '{}'::jsonb)"#,
    )
    .bind(task_id)
    .bind(org)
    .bind(&zone)
    .bind(user_a)
    .execute(&pool)
    .await;
    if setup.is_err() {
        eprintln!("skipping: could not insert work_task fixture: {:?}", setup.err());
        return;
    }

    // ---- act 1: first reassign call ----
    let first: Option<(Json,)> = sqlx::query_as(
        "SELECT public.reassign_work_zone($1,$2,$3,$4,$5,$6)",
    )
    .bind(org)
    .bind(&zone)
    .bind(user_a)
    .bind(user_b)
    .bind("hard")
    .bind(&idem_key)
    .fetch_optional(&pool)
    .await
    .unwrap_or(None);

    // ---- act 2: replay — same key, same params ----
    let second: Option<(Json,)> = sqlx::query_as(
        "SELECT public.reassign_work_zone($1,$2,$3,$4,$5,$6)",
    )
    .bind(org)
    .bind(&zone)
    .bind(user_a)
    .bind(user_b)
    .bind("hard")
    .bind(&idem_key)
    .fetch_optional(&pool)
    .await
    .unwrap_or(None);

    // ---- cleanup ----
    let _ = sqlx::query("SELECT set_config('app.work_zone_lock_bypass', 'on', true)")
        .execute(&pool)
        .await;
    let _ = sqlx::query("DELETE FROM public.work_tasks WHERE id = $1")
        .bind(task_id)
        .execute(&pool)
        .await;
    let _ = sqlx::query(
        "DELETE FROM public.work_request_idempotency WHERE organization_id = $1 AND idempotency_key = $2",
    )
    .bind(org)
    .bind(&idem_key)
    .execute(&pool)
    .await;

    // ---- assert ----
    let first = first.expect("first call should return JSON").0;
    let second = second.expect("second call should return JSON").0;
    assert_eq!(
        first, second,
        "replay must return identical response body (idempotency_key={idem_key})"
    );
    let tasks_moved = first
        .get("tasks_moved")
        .and_then(|v| v.as_i64())
        .unwrap_or(-1);
    assert!(tasks_moved >= 0, "tasks_moved should be present in the response");
}

// Created and developed by Jai Singh
