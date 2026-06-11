// Created and developed by Jai Singh
//! Plan §13.4 — Critical priority bypass regression test (mig 252 contract).
//!
//! Asserts that a critical-priority cycle count is returned to an
//! operator EVEN WHEN another row in the same zone is actively held by a
//! different user. This is the contract migration 252 reinstated after
//! the 2026-05-01 "critical not first" review surfaced the issue.
//!
//! Mechanism in the new dispatcher: the `enforce_work_task_zone_exclusivity`
//! trigger short-circuits on `priority='critical'` (Item 11 / mig 266),
//! and the legacy `claim_next_cycle_count` SQL ranker sorts critical
//! first within the priority tier.

mod common;

use rust_work_service::db;
use rust_work_service::strategies::{DispatchStrategyRegistry, ResolvedWorkTypeSettings};
use uuid::Uuid;

#[tokio::test]
async fn critical_returned_despite_zone_busy() {
    let Some(pool) = common::try_pool().await else { return };
    let Some((org, _admin, user_a, user_b)) = common::pick_seed_org(&pool).await else {
        eprintln!("skipping: no seed org with >=3 users");
        return;
    };
    if let Err(e) = common::ensure_zone_rules_enabled(&pool, org).await {
        eprintln!("skipping: ensure_zone_rules_enabled failed: {e}");
        return;
    }

    let active_id = Uuid::new_v4();
    let critical_id = Uuid::new_v4();

    // ---- arrange: user_a actively holds CRIT-A1-001 (zone CRIT). ----
    let _ = sqlx::query(
        r#"INSERT INTO rr_cyclecount_data
           (id, count_number, material_number, location, system_quantity,
            organization_id, status, priority, count_type, created_by,
            assigned_to, assigned_at, counter_name)
           VALUES
           ($1, $2, 'TEST-MAT-CRIT-ACTIVE', 'CRIT-A1-001', 1, $3,
            'in_progress', 'normal', 'quantity_check', $4, $4, NOW(),
            'User A')"#,
    )
    .bind(active_id)
    .bind(format!("CC-CRIT-A-{}", &active_id.to_string()[..8]))
    .bind(org)
    .bind(user_a)
    .execute(&pool)
    .await;

    // user_b will Pull-Next; critical row in a DIFFERENT zone exists
    // pending+unassigned. Per contract, critical wins regardless of
    // zone-elsewhere occupancy.
    let _ = sqlx::query(
        r#"INSERT INTO rr_cyclecount_data
           (id, count_number, material_number, location, system_quantity,
            organization_id, status, priority, count_type, created_by)
           VALUES
           ($1, $2, 'TEST-MAT-CRIT', 'CRIT-X9-099', 1, $3,
            'pending', 'critical', 'quantity_check', $4)"#,
    )
    .bind(critical_id)
    .bind(format!("CC-CRIT-{}", &critical_id.to_string()[..8]))
    .bind(org)
    .bind(user_a)
    .execute(&pool)
    .await;

    // ---- act ----
    let registry = DispatchStrategyRegistry::new();
    let strategy = registry.get("cycle_count").unwrap();
    let settings = ResolvedWorkTypeSettings::default();

    let claim = db::claim_next_task(
        &pool,
        org,
        user_b,
        "cycle_count",
        strategy,
        settings,
        db::ClaimCapacity::default(),
    )
    .await;

    // ---- cleanup ----
    let _ = sqlx::query(
        "DELETE FROM rr_cyclecount_data WHERE id IN ($1,$2)",
    )
    .bind(active_id)
    .bind(critical_id)
    .execute(&pool)
    .await;

    // ---- assert ----
    let task = claim
        .expect("claim_next_task returned Err")
        .expect("expected critical row to be returned");
    assert_eq!(task.priority, "critical", "expected critical row");
    assert_eq!(task.id, critical_id, "expected the critical row id");
}

// Created and developed by Jai Singh
