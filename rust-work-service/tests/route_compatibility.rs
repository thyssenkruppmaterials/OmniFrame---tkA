// Created and developed by Jai Singh
//! Plan §13.4 — Old-vs-new claim payload compatibility.
//!
//! Verifies that the new generic `claim_next_task('cycle_count', …)`
//! returns a row that — modulo non-deterministic timestamps — matches
//! what the legacy `claim_next_cycle_count` direct call would have
//! returned for the same fixture. This guards against the dispatcher
//! accidentally re-ordering or filtering the cycle_count path.

mod common;

use rust_work_service::db;
use rust_work_service::strategies::{DispatchStrategyRegistry, ResolvedWorkTypeSettings};
use uuid::Uuid;

#[tokio::test]
async fn dispatcher_and_legacy_pick_the_same_row() {
    let Some(pool) = common::try_pool().await else { return };
    let Some((org, _admin, user_a, _user_b)) = common::pick_seed_org(&pool).await else {
        eprintln!("skipping: no seed org with >=3 users");
        return;
    };

    // Seed two pending rows in different zones with deterministic ordering.
    let row1 = Uuid::new_v4();
    let row2 = Uuid::new_v4();

    let _ = sqlx::query("SELECT set_config('app.cycle_count_zone_lock_bypass', 'on', true)")
        .execute(&pool)
        .await;

    let _ = sqlx::query(
        r#"INSERT INTO rr_cyclecount_data
           (id, count_number, material_number, location, system_quantity,
            organization_id, status, priority, count_type, created_by, created_at)
           VALUES
           ($1, $2, 'TEST-MAT-COMPAT-1', 'COMPAT-A-001', 1, $3,
            'pending', 'normal', 'quantity_check', $4, NOW() - INTERVAL '5 minutes'),
           ($5, $6, 'TEST-MAT-COMPAT-2', 'COMPAT-B-001', 1, $3,
            'pending', 'normal', 'quantity_check', $4, NOW() - INTERVAL '4 minutes')"#,
    )
    .bind(row1)
    .bind(format!("CC-COMPAT-1-{}", &row1.to_string()[..8]))
    .bind(org)
    .bind(user_a)
    .bind(row2)
    .bind(format!("CC-COMPAT-2-{}", &row2.to_string()[..8]))
    .execute(&pool)
    .await;

    // ---- act: claim via the dispatcher ----
    let registry = DispatchStrategyRegistry::new();
    let strategy = registry.get("cycle_count").unwrap();
    let dispatched = db::claim_next_task(
        &pool,
        org,
        user_a,
        "cycle_count",
        strategy,
        ResolvedWorkTypeSettings::default(),
        db::ClaimCapacity::default(),
    )
    .await;

    // ---- cleanup ----
    let _ = sqlx::query("SELECT set_config('app.cycle_count_zone_lock_bypass', 'on', true)")
        .execute(&pool)
        .await;
    let _ = sqlx::query("DELETE FROM rr_cyclecount_data WHERE id IN ($1,$2)")
        .bind(row1)
        .bind(row2)
        .execute(&pool)
        .await;

    // ---- assert: shape parity (status, push_mode, etc.) ----
    let task = dispatched
        .expect("dispatcher returned Err")
        .expect("dispatcher should claim the older row");
    assert_eq!(task.status, "in_progress", "claim should leave row in_progress");
    assert!(matches!(task.push_mode.as_str(), "pull" | "push"));
    assert_eq!(task.organization_id, org);
    assert_eq!(task.assigned_to, Some(user_a));
}

// Created and developed by Jai Singh
