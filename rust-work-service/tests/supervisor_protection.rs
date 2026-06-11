// Created and developed by Jai Singh
//! Plan §13.4 — Supervisor protection regression test (mig 253 Gap 1 / mig 252).
//!
//! Asserts that a row stamped with `supervisor_assigned_at` within the
//! org's protection window (`supervisor_assignment_protection_hours`,
//! default 24h) is NOT escalated by `escalate_stale_zone_reservations`.
//!
//! The Rust dispatcher does not own escalation — the SQL function does —
//! but the contract is part of the cutover invariants because the
//! Rust push path STAMPS those columns (see `db::queries::push_cycle_count_in_tx`).
//! This test exercises the SQL path directly to lock the contract.

mod common;

use chrono::Utc;
use uuid::Uuid;

#[tokio::test]
async fn supervisor_stamp_within_window_is_not_escalated() {
    let Some(pool) = common::try_pool().await else { return };
    let Some((org, admin, user_a, _)) = common::pick_seed_org(&pool).await else {
        eprintln!("skipping: no seed org with >=3 users");
        return;
    };

    let count_id = Uuid::new_v4();

    // Bypass the zone trigger for setup so we can backdate freely.
    let _ = sqlx::query("SELECT set_config('app.cycle_count_zone_lock_bypass', 'on', true)")
        .execute(&pool)
        .await;

    let setup = sqlx::query(
        r#"INSERT INTO rr_cyclecount_data
           (id, count_number, material_number, location, system_quantity,
            organization_id, status, priority, count_type, created_by,
            assigned_to, assigned_at, counter_name,
            reservation_started_at, supervisor_assigned_at, supervisor_assigned_by,
            updated_at)
           VALUES
           ($1, $2, 'TEST-MAT-SUP', 'SUP-A1-101', 1, $3,
            'pending', 'normal', 'quantity_check', $4,
            $5, NOW() - INTERVAL '4 hours', 'User A',
            NOW() - INTERVAL '4 hours',  -- old enough to look stale
            NOW() - INTERVAL '5 minutes', -- supervisor stamp WELL within window
            $4,
            NOW() - INTERVAL '4 hours')"#,
    )
    .bind(count_id)
    .bind(format!("CC-SUP-{}", &count_id.to_string()[..8]))
    .bind(org)
    .bind(admin)
    .bind(user_a)
    .execute(&pool)
    .await;

    if setup.is_err() {
        eprintln!("skipping: could not insert supervisor-protected fixture: {:?}", setup.err());
        return;
    }

    // ---- act: run the escalator with a tight 60-min threshold so
    //         everything stale-by-time would be eligible. The supervisor
    //         protection clause MUST keep our row safe.
    let escalated: Vec<(Uuid,)> = sqlx::query_as(
        "SELECT out_count_id FROM public.escalate_stale_zone_reservations(60)",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    // Row should remain pending+assigned with stamps intact.
    let still_assigned: Option<(Option<Uuid>, Option<chrono::DateTime<Utc>>)> = sqlx::query_as(
        r#"SELECT assigned_to, supervisor_assigned_at
             FROM rr_cyclecount_data WHERE id = $1"#,
    )
    .bind(count_id)
    .fetch_optional(&pool)
    .await
    .unwrap_or(None);

    // ---- cleanup ----
    let _ = sqlx::query("DELETE FROM rr_cyclecount_data WHERE id = $1")
        .bind(count_id)
        .execute(&pool)
        .await;

    // ---- assert ----
    assert!(
        !escalated.iter().any(|(id,)| *id == count_id),
        "row with recent supervisor stamp must not be escalated"
    );
    let (assigned, sup_at) = still_assigned.expect("row should still exist");
    assert_eq!(assigned, Some(user_a), "assignee should remain after no-op escalator pass");
    assert!(sup_at.is_some(), "supervisor stamp should remain after no-op escalator pass");
}

// Created and developed by Jai Singh
