// Created and developed by Jai Singh
//! Plan §13.4 / Item 12 — Phase 1 already-assigned regression test.
//!
//! Verifies that `claim_next_task('cycle_count', …)` returns a row that
//! is already assigned to the calling user (e.g. previously pushed by a
//! supervisor) BEFORE attempting a fresh claim. Mirrors the Phase 1
//! short-circuit in `db::queries::claim_next_cycle_count`.

mod common;

use rust_work_service::db;
use rust_work_service::strategies::{DispatchStrategyRegistry, ResolvedWorkTypeSettings};
use uuid::Uuid;

#[tokio::test]
async fn returns_already_assigned_row_first() {
    let Some(pool) = common::try_pool().await else { return };
    let Some((org, _admin, user_a, _user_b)) = common::pick_seed_org(&pool).await else {
        eprintln!("skipping: no seed org with >=3 users");
        return;
    };

    // ---- arrange: pre-assign a pending row to user_a ----
    let count_id = Uuid::new_v4();
    let setup = sqlx::query(
        r#"INSERT INTO rr_cyclecount_data
           (id, count_number, material_number, location, system_quantity,
            organization_id, status, priority, count_type, created_by,
            assigned_to, assigned_at, counter_name)
           VALUES
           ($1, $2, 'TEST-MAT-PHASE1', 'PHASE1-A1-001', 1, $3,
            'in_progress', 'normal', 'quantity_check', $4, $4, NOW(),
            'Phase1 user')"#,
    )
    .bind(count_id)
    .bind(format!("CC-PHASE1-{}", &count_id.to_string()[..8]))
    .bind(org)
    .bind(user_a)
    .execute(&pool)
    .await;

    if setup.is_err() {
        eprintln!("skipping: could not insert fixture row: {:?}", setup.err());
        return;
    }

    // ---- act ----
    let registry = DispatchStrategyRegistry::new();
    let strategy = registry.get("cycle_count").unwrap();
    let settings = ResolvedWorkTypeSettings::default();

    let result = db::claim_next_task(
        &pool,
        org,
        user_a,
        "cycle_count",
        strategy,
        settings,
        db::ClaimCapacity::default(),
    )
    .await;

    // ---- cleanup before assertions so failures don't leak fixtures ----
    let _ = sqlx::query("DELETE FROM rr_cyclecount_data WHERE id = $1")
        .bind(count_id)
        .execute(&pool)
        .await;

    // ---- assert ----
    let task = result.expect("claim_next_task returned Err").expect("Phase 1 should return the assigned row");
    assert_eq!(task.id, count_id, "expected Phase 1 to return the pre-assigned row");
    assert_eq!(task.assigned_to, Some(user_a));
    assert_eq!(task.status, "in_progress");
}

/// Regression test for the 2026-05-14 production incident:
///
/// David Simmons signed in to the RF cycle-count screen, found himself
/// stuck on "waiting for next count" forever because:
///   1. He already had one in-flight `rr_cyclecount_data` row in status
///      `in_progress`, with a mirroring `work_tasks` projection row.
///   2. `work_type_settings.capacity_per_worker = 1` for cycle_count on
///      his org.
///   3. `resolve_effective_capacity` therefore computed
///      `per_type_remaining = 0` and `claim_next_task` short-circuited
///      with `Ok(None)` BEFORE `claim_next_cycle_count`'s Phase 1 ever
///      ran. The operator could neither resume his existing count nor
///      claim a new one — every Pull Next returned "No tasks available"
///      even though 2,000+ pending counts existed.
///
/// The Phase 0 short-circuit in `claim_next_task` (`queries.rs`) makes
/// the already-assigned read run BEFORE the capacity gate, so the
/// operator is always routed back to their in-flight count regardless
/// of `capacity_per_worker`. This test seeds the exact production
/// state (a cycle_count `rr_cyclecount_data` row AND a mirroring
/// `work_tasks` row, both `in_progress`, both assigned) and asserts
/// the call resolves to the seeded row instead of `None`.
///
/// Documented in:
///   memorybank/OmniFrame/Debug/Fix-RF-Cycle-Count-Stuck-Waiting.md
///   memorybank/OmniFrame/Debug/Investigate-Work-Tasks-Capacity-Gate-Returning-Existing-Task.md
#[tokio::test]
async fn phase0_bypasses_capacity_gate_for_already_assigned_row() {
    let Some(pool) = common::try_pool().await else { return };
    let Some((org, _admin, user_a, _user_b)) = common::pick_seed_org(&pool).await else {
        eprintln!("skipping: no seed org with >=3 users");
        return;
    };

    // ---- arrange ----
    // 1) rr_cyclecount_data row in_progress, assigned to user_a.
    let count_id = Uuid::new_v4();
    let cc_setup = sqlx::query(
        r#"INSERT INTO rr_cyclecount_data
           (id, count_number, material_number, location, system_quantity,
            organization_id, status, priority, count_type, created_by,
            assigned_to, assigned_at, counter_name)
           VALUES
           ($1, $2, 'TEST-MAT-PHASE0', 'PHASE0-A1-001', 1, $3,
            'in_progress', 'normal', 'quantity_check', $4, $4, NOW(),
            'Phase0 user')"#,
    )
    .bind(count_id)
    .bind(format!("CC-PHASE0-{}", &count_id.to_string()[..8]))
    .bind(org)
    .bind(user_a)
    .execute(&pool)
    .await;

    if cc_setup.is_err() {
        eprintln!("skipping: could not insert rr_cyclecount_data fixture row: {:?}", cc_setup.err());
        return;
    }

    // 2) work_tasks projection row that drives the capacity gate.
    //    Mirrors what the migration-265 trigger would write when
    //    work_tasks_shadow_write=true. We seed it manually so the test
    //    doesn't depend on the shadow-write flag being toggled.
    let wt_setup = sqlx::query(
        r#"INSERT INTO work_tasks
             (id, organization_id, task_type, source_table, source_id,
              subject_material, primary_location, priority, status,
              assigned_to, assigned_at, push_mode,
              created_at, updated_at)
           VALUES
             ($1, $2, 'cycle_count', 'rr_cyclecount_data', $1,
              'TEST-MAT-PHASE0', 'PHASE0-A1-001', 'normal', 'in_progress',
              $3, NOW(), 'pull',
              NOW(), NOW())
           ON CONFLICT (id) DO NOTHING"#,
    )
    .bind(count_id)
    .bind(org)
    .bind(user_a)
    .execute(&pool)
    .await;

    let wt_seeded = wt_setup.is_ok();
    if !wt_seeded {
        eprintln!(
            "note: could not seed work_tasks projection ({:?}); test will still \
             pass through Phase 0 because rr_cyclecount_data is the source of truth",
            wt_setup.err()
        );
    }

    // ---- act ----
    let registry = DispatchStrategyRegistry::new();
    let strategy = registry.get("cycle_count").unwrap();
    // Default ResolvedWorkTypeSettings has capacity_per_worker = 1 — the
    // exact org-level setting that triggers the production bug.
    let settings = ResolvedWorkTypeSettings::default();
    assert_eq!(
        settings.capacity_per_worker, 1,
        "test guards on capacity_per_worker=1 — the bug condition"
    );

    let result = db::claim_next_task(
        &pool,
        org,
        user_a,
        "cycle_count",
        strategy,
        settings,
        db::ClaimCapacity::default(),
    )
    .await;

    // ---- cleanup before assertions ----
    if wt_seeded {
        let _ = sqlx::query("DELETE FROM work_tasks WHERE id = $1")
            .bind(count_id)
            .execute(&pool)
            .await;
    }
    let _ = sqlx::query("DELETE FROM rr_cyclecount_data WHERE id = $1")
        .bind(count_id)
        .execute(&pool)
        .await;

    // ---- assert ----
    let task = result
        .expect("claim_next_task returned Err")
        .expect(
            "Phase 0 should return the already-assigned row even though \
             work_tasks shows the user at capacity (1/1)",
        );
    assert_eq!(
        task.id, count_id,
        "expected Phase 0 to return the already-assigned in_progress row, \
         not silently swallow the capacity gate"
    );
    assert_eq!(task.assigned_to, Some(user_a));
    assert_eq!(task.status, "in_progress");
}

/// Regression test for the 2026-05-14 Phase 0 extension: covers the
/// non-cycle_count generic path. zone_audit is the canonical generic
/// capacity-1 type (per `work_type_settings` for tenant `c9d89a74` today)
/// and flows through `generic_claim_against_work_tasks` rather than
/// `claim_next_cycle_count`. Before this fix the generic path had NO
/// Phase 1 "return-already-assigned" branch — so when a worker already
/// held a `work_tasks` row in `in_progress` and tried to Pull Next a
/// `zone_audit`, `resolve_effective_capacity` blocked them and they
/// were silently locked out exactly the same way David was on
/// `cycle_count`.
///
/// Same shape as `phase0_bypasses_capacity_gate_for_already_assigned_row`
/// but seeds the work_tasks row directly as task_type='zone_audit'
/// (no `rr_cyclecount_data` source row required — that table is
/// cycle_count-only).
///
/// `replenish` / `kit_pick` are listed in `work_type_settings` but have
/// no `DispatchStrategy` registered yet (see
/// `rust-work-service/src/strategies/mod.rs::DispatchStrategyRegistry::new`),
/// so they 400 at the route dispatcher before reaching `claim_next_task`
/// today. The generic Phase 0 covers them automatically the moment a
/// strategy is registered — no further test wiring needed.
#[tokio::test]
async fn phase0_bypasses_capacity_gate_for_generic_zone_audit_row() {
    let Some(pool) = common::try_pool().await else { return };
    let Some((org, _admin, user_a, _user_b)) = common::pick_seed_org(&pool).await else {
        eprintln!("skipping: no seed org with >=3 users");
        return;
    };

    // ---- arrange ----
    // Seed a work_tasks row directly: task_type='zone_audit',
    // in_progress, assigned to user_a. This is the exact state that
    // would otherwise drive `resolve_effective_capacity` to compute
    // `per_type_remaining = 0` against `capacity_per_worker = 1`.
    let task_id = Uuid::new_v4();
    let wt_setup = sqlx::query(
        r#"INSERT INTO work_tasks
             (id, organization_id, task_type, task_number,
              subject_material, primary_location, priority, status,
              assigned_to, assigned_at, push_mode,
              created_at, updated_at)
           VALUES
             ($1, $2, 'zone_audit', $3,
              'TEST-MAT-PHASE0-GEN', 'PHASE0G-A1-001', 'normal', 'in_progress',
              $4, NOW(), 'pull',
              NOW(), NOW())"#,
    )
    .bind(task_id)
    .bind(org)
    .bind(format!("ZA-PHASE0-{}", &task_id.to_string()[..8]))
    .bind(user_a)
    .execute(&pool)
    .await;

    if wt_setup.is_err() {
        eprintln!(
            "skipping: could not seed work_tasks zone_audit fixture row: {:?}",
            wt_setup.err()
        );
        return;
    }

    // ---- act ----
    let registry = DispatchStrategyRegistry::new();
    let strategy = registry
        .get("zone_audit")
        .expect("ZoneAuditStrategy must be registered in DispatchStrategyRegistry");
    let settings = ResolvedWorkTypeSettings::default();
    assert_eq!(
        settings.capacity_per_worker, 1,
        "test guards on capacity_per_worker=1 — the bug condition"
    );

    let result = db::claim_next_task(
        &pool,
        org,
        user_a,
        "zone_audit",
        strategy,
        settings,
        db::ClaimCapacity::default(),
    )
    .await;

    // ---- cleanup before assertions so failures don't leak fixtures ----
    let _ = sqlx::query("DELETE FROM work_tasks WHERE id = $1")
        .bind(task_id)
        .execute(&pool)
        .await;

    // ---- assert ----
    let task = result
        .expect("claim_next_task returned Err")
        .expect(
            "Phase 0 (generic) should return the already-assigned \
             zone_audit row instead of being silently blocked by the \
             capacity gate",
        );
    assert_eq!(
        task.id, task_id,
        "expected generic Phase 0 to return the already-assigned \
         zone_audit work_tasks row"
    );
    assert_eq!(task.assigned_to, Some(user_a));
    assert_eq!(task.status, "in_progress");
    assert_eq!(
        task.count_type.as_deref(),
        Some("zone_audit"),
        "generic Phase 0 must project task_type as count_type so the \
         response envelope matches generic_claim_against_work_tasks"
    );
}

// Created and developed by Jai Singh
