// Created and developed by Jai Singh
//! Database query functions for work management
//!
//! Optimized queries for work queue operations using sqlx.

use super::models::{CycleCountTask, OccupiedAisle, PathRule, QueueStats, WorkerStatus};
use sqlx::{PgPool, Row};
use std::cmp::Ordering;
use std::collections::HashMap;
use tracing::instrument;
use uuid::Uuid;

fn priority_rank(priority: &str) -> i32 {
    match priority {
        "critical" => 1,
        "hot" => 2,
        "normal" => 3,
        "low" => 4,
        _ => 5,
    }
}

/// Sticky-aisle rank for the Phase-2 ranker: `0` when a candidate is in the
/// worker's current ("sticky") aisle, `1` otherwise. A `None` (or empty)
/// sticky aisle — sticky disabled, or the worker has no current aisle — ranks
/// every candidate equally so the global serpentine order is left untouched.
/// Pure so it can be unit-tested without a database (see `mod tests`).
fn sticky_rank(candidate_aisle: Option<&str>, sticky_aisle: Option<&str>) -> i32 {
    match (sticky_aisle, candidate_aisle) {
        (Some(sticky), Some(aisle)) if !sticky.is_empty() && aisle == sticky => 0,
        _ => 1,
    }
}

fn parse_aisle_bucket(value: Option<&str>) -> i64 {
    let digits: String = value
        .unwrap_or_default()
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect();
    digits.parse::<i64>().unwrap_or(0)
}

fn matches_filter(filter: Option<&str>, value: Option<&str>) -> bool {
    match filter {
        None => true,
        Some(filter_value) if filter_value.trim().is_empty() => true,
        Some(filter_value) => value
            .map(|candidate| candidate.eq_ignore_ascii_case(filter_value))
            .unwrap_or(false),
    }
}

/// Get pending cycle counts for an organization, scoped to a specific
/// operator's defer list.
///
/// Per-operator. The defer filter excludes only counts THIS operator
/// has actively deferred — counts deferred by other operators remain
/// visible (they're in OTHER operators' personal skip-lists, not a
/// global block-list).
///
/// 2026-05-01 (Fix-Critical-Hidden-By-Global-Defer-Filter): previously
/// this filter was global (no `user_id` scope), making any operator's
/// defer hide rows from every other operator. The Pull Next preview
/// surfaced a wrong "no critical work available" picture when other
/// operators had deferred all the criticals. Mirrors
/// `claim_next_cycle_count` Phase 2 scope so what the operator sees in
/// the queue list matches what they'd actually claim.
///
/// All current call sites (`/api/v1/work/queue`, `useWorkQueue` hook)
/// run inside an authenticated user context, so the per-operator scope
/// is the right semantic for every existing caller. If a future
/// admin-dashboard surface needs the org-global view, add a separate
/// `get_pending_cycle_counts_for_admin(pool, org_id)` rather than
/// relaxing the scope here.
#[instrument(skip(pool))]
pub async fn get_pending_cycle_counts(
    pool: &PgPool,
    org_id: Uuid,
    auth_user_id: Uuid,
) -> Result<Vec<CycleCountTask>, sqlx::Error> {
    sqlx::query_as::<_, CycleCountTask>(
        r#"
        SELECT
            id,
            count_number,
            material_number,
            material_description,
            location,
            warehouse,
            system_quantity::float8 as system_quantity,
            counted_quantity::float8 as counted_quantity,
            COALESCE(unit_of_measure, 'EA') as unit_of_measure,
            priority::text as priority,
            status::text as status,
            count_type::text as count_type,
            assigned_to,
            assigned_at,
            COALESCE(push_mode, 'pull') as push_mode,
            pushed_by,
            pushed_at,
            COALESCE(push_acknowledged, false) as push_acknowledged,
            organization_id,
            completed_at,
            recount_by,
            recount_date,
            COALESCE(recount_completed, false) as recount_completed,
            COALESCE(requires_recount, false) as requires_recount,
            counter_name,
            resolved_location_key, resolved_zone, resolved_aisle,
            resolved_sequence::float8 as resolved_sequence, resolution_source,
            workflow_config_id,
            workflow_config_version,
            COALESCE(workflow_snapshot, '{}'::jsonb) as workflow_snapshot,
            COALESCE(workflow_result, '{}'::jsonb) as workflow_result,
            evidence_photo_urls,
            review_threshold_pct::float8 as review_threshold_pct,
            review_threshold_abs::float8 as review_threshold_abs,
            scanned_material_number,
            location_reported_empty,
            part_variance,
            COALESCE(scanned_parts, '[]'::jsonb) as scanned_parts,
            transfer_destination_location,
            transfer_source_quantity::float8 as transfer_source_quantity
        FROM rr_cyclecount_data
        WHERE organization_id = $1
          AND status IN ('pending', 'recount')
          AND (assigned_to IS NULL OR push_mode = 'push')
          AND id NOT IN (
            SELECT count_id FROM cycle_count_operator_deferred_counts
            WHERE organization_id = $1
              AND is_active = true
              AND user_id = $2
          )
        ORDER BY 
            CASE priority::text 
                WHEN 'critical' THEN 1
                WHEN 'hot' THEN 2  
                WHEN 'normal' THEN 3
                WHEN 'low' THEN 4
                ELSE 5
            END ASC,
            CASE WHEN resolution_source = 'unresolved' OR resolution_source IS NULL THEN 1 ELSE 0 END ASC,
            resolved_zone ASC NULLS LAST,
            resolved_aisle ASC NULLS LAST,
            resolved_sequence ASC NULLS LAST,
            location ASC,
            created_at ASC
        LIMIT 100
        "#,
    )
    .bind(org_id)
    .bind(auth_user_id)
    .fetch_all(pool)
    .await
}

/// Get queue statistics for an organization, scoped to a specific
/// operator's defer list for the `pending` count.
///
/// Per-operator. The `pending` figure mirrors what
/// `claim_next_cycle_count` Phase 2 would consider eligible for THIS
/// operator — counts deferred by other operators are NOT subtracted
/// from this operator's queue total. `deferred_pending` is intentionally
/// kept global as an admin/observability signal showing how many rows
/// are currently in any operator's skip-list.
///
/// 2026-05-01 (Fix-Critical-Hidden-By-Global-Defer-Filter): previously
/// the `pending` subquery used a global `WHERE is_active = true`, so
/// operator A's defer dropped the dashboard `pending` for operator B
/// even though B could have claimed the same row. The scheduler's
/// `broadcast_queue_stats` (org-scoped WS payload) intentionally keeps
/// the global semantics — the WS broadcast is a single fan-out per org,
/// not a per-recipient computation. The Migration 253 review's
/// "REST and WS must match 1:1" goal is preserved AT THE ORG LEVEL —
/// this function adds a per-operator REST flavor that the WS broadcast
/// can't represent without per-recipient payloads.
#[instrument(skip(pool))]
pub async fn get_queue_stats(
    pool: &PgPool,
    org_id: Uuid,
    auth_user_id: Uuid,
) -> Result<QueueStats, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT
            (SELECT COUNT(*) FROM rr_cyclecount_data 
             WHERE organization_id = $1
               AND status IN ('pending', 'recount')
               AND assigned_to IS NULL
               AND id NOT IN (
                 SELECT count_id FROM cycle_count_operator_deferred_counts
                 WHERE organization_id = $1
                   AND is_active = true
                   AND user_id = $2
               ))::bigint as pending,
            (SELECT COUNT(*) FROM cycle_count_operator_deferred_counts
             WHERE organization_id = $1 AND is_active = true)::bigint as deferred_pending,
            (SELECT COUNT(*) FROM rr_cyclecount_data 
             WHERE organization_id = $1 AND status = 'in_progress')::bigint as in_progress,
            (SELECT COUNT(*) FROM rr_cyclecount_data 
             WHERE organization_id = $1 
               AND status IN ('completed', 'approved')
               AND updated_at::date = CURRENT_DATE)::bigint as completed_today,
            (SELECT COUNT(*) FROM rr_cyclecount_data 
             WHERE organization_id = $1 
               AND push_mode = 'push' 
               AND push_acknowledged = false
               AND status IN ('pending', 'in_progress'))::bigint as pushed_pending,
            (SELECT COUNT(*) FROM worker_heartbeats 
             WHERE organization_id = $1 
               AND last_heartbeat >= NOW() - INTERVAL '5 minutes')::bigint as total_workers_online
        "#,
    )
    .bind(org_id)
    .bind(auth_user_id)
    .fetch_one(pool)
    .await?;

    Ok(QueueStats {
        pending: row.get::<i64, _>("pending"),
        deferred_pending: row.get::<i64, _>("deferred_pending"),
        in_progress: row.get::<i64, _>("in_progress"),
        completed_today: row.get::<i64, _>("completed_today"),
        pushed_pending: row.get::<i64, _>("pushed_pending"),
        total_workers_online: row.get::<i64, _>("total_workers_online"),
    })
}

/// Atomically claim the next available cycle count using FOR UPDATE SKIP LOCKED.
/// First checks if the user already has an assigned task (e.g. pushed by a supervisor
/// or from a previous session) and returns it before trying to claim a new one.
#[instrument(skip(pool))]
pub async fn claim_next_cycle_count(
    pool: &PgPool,
    user_id: Uuid,
    org_id: Uuid,
) -> Result<Option<CycleCountTask>, sqlx::Error> {
    let mut tx = pool.begin().await?;

    // ── Phase 1: Return any task already assigned to this user ──
    let existing = sqlx::query_as::<_, CycleCountTask>(
        r#"
        SELECT
            id, count_number, material_number, material_description,
            location, warehouse,
            system_quantity::float8 as system_quantity,
            counted_quantity::float8 as counted_quantity,
            COALESCE(unit_of_measure, 'EA') as unit_of_measure,
            priority::text as priority, status::text as status,
            count_type::text as count_type,
            assigned_to, assigned_at,
            COALESCE(push_mode, 'pull') as push_mode,
            pushed_by, pushed_at,
            COALESCE(push_acknowledged, false) as push_acknowledged,
            organization_id,
            completed_at,
            recount_by,
            recount_date,
            COALESCE(recount_completed, false) as recount_completed,
            COALESCE(requires_recount, false) as requires_recount,
            counter_name,
            resolved_location_key, resolved_zone, resolved_aisle,
            resolved_sequence::float8 as resolved_sequence, resolution_source,
            workflow_config_id,
            workflow_config_version,
            COALESCE(workflow_snapshot, '{}'::jsonb) as workflow_snapshot,
            COALESCE(workflow_result, '{}'::jsonb) as workflow_result,
            evidence_photo_urls,
            review_threshold_pct::float8 as review_threshold_pct,
            review_threshold_abs::float8 as review_threshold_abs,
            scanned_material_number,
            location_reported_empty,
            part_variance,
            COALESCE(scanned_parts, '[]'::jsonb) as scanned_parts,
            transfer_destination_location,
            transfer_source_quantity::float8 as transfer_source_quantity
        FROM rr_cyclecount_data rcc
        WHERE rcc.organization_id = $1
          AND rcc.assigned_to = $2
          AND rcc.status IN ('pending', 'in_progress', 'recount')
          -- Migration 253 review: a stale reservation must not deliver
          -- an operator into a zone now actively held by a DIFFERENT
          -- user. The trigger would block the eventual
          -- status=in_progress, but by then the operator has already
          -- walked there. Filter out rows whose zone has another user
          -- actively counting; they fall to Phase 2 / queue.
          --
          -- PATTERN-AWARE: mirror Phase 2's zone-of() logic so orgs
          -- with a custom `zone_pattern` configured see the same
          -- collision semantics in both phases. Previously this used
          -- the materialized `held.zone = rcc.zone` raw-segment column
          -- which diverged from the trigger when a regex pattern was
          -- in effect.
          AND NOT EXISTS (
            SELECT 1
            FROM cycle_count_zone_rules zr_p1
            WHERE zr_p1.organization_id = rcc.organization_id
              AND zr_p1.enabled = true
              AND zr_p1.policy = 'one_counter_per_zone'
              AND EXISTS (
                SELECT 1 FROM rr_cyclecount_data other
                WHERE other.organization_id = rcc.organization_id
                  AND COALESCE(public.cycle_count_zone_of(other.location, zr_p1.zone_pattern), other.zone)
                      = COALESCE(public.cycle_count_zone_of(rcc.location,   zr_p1.zone_pattern), rcc.zone)
                  AND other.assigned_to IS NOT NULL
                  AND other.assigned_to <> $2
                  AND other.status IN ('in_progress', 'recount')
                  AND other.id <> rcc.id
              )
          )
        ORDER BY
            -- Migration 252: PRIORITY first. Sticky-zone / heartbeat /
            -- status are tiebreakers within the same priority tier so
            -- critical-elsewhere always beats normal-here.
            CASE rcc.priority::text
                WHEN 'critical' THEN 1 WHEN 'hot' THEN 2
                WHEN 'normal' THEN 3   WHEN 'low' THEN 4
                ELSE 5
            END ASC,
            -- Sticky-zone preference within the priority tier: prefer
            -- rows in a zone the operator is already actively counting
            -- OR the zone the operator's heartbeat last reported.
            CASE
              WHEN rcc.zone IS NOT NULL AND EXISTS (
                SELECT 1 FROM rr_cyclecount_data held
                WHERE held.organization_id = rcc.organization_id
                  AND held.assigned_to = $2
                  AND held.zone = rcc.zone
                  AND held.status IN ('in_progress', 'recount')
                  AND held.id <> rcc.id
              ) THEN 0
              WHEN rcc.zone IS NOT NULL AND EXISTS (
                SELECT 1 FROM worker_heartbeats wh
                WHERE wh.user_id = $2
                  AND wh.organization_id = rcc.organization_id
                  AND wh.current_zone = rcc.zone
                  AND wh.last_heartbeat >= NOW() - INTERVAL '5 minutes'
              ) THEN 1
              ELSE 2
            END ASC,
            -- In-progress / recount before pending reservations.
            CASE rcc.status::text
              WHEN 'in_progress' THEN 0
              WHEN 'recount'     THEN 1
              ELSE 2
            END ASC,
            CASE WHEN rcc.resolution_source = 'unresolved' OR rcc.resolution_source IS NULL THEN 1 ELSE 0 END ASC,
            rcc.resolved_zone ASC NULLS LAST,
            rcc.resolved_aisle ASC NULLS LAST,
            rcc.resolved_sequence ASC NULLS LAST,
            rcc.location ASC,
            rcc.assigned_at ASC
        LIMIT 1
        "#,
    )
    .bind(org_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(task) = existing {
        tracing::info!(
            user_id = %user_id,
            count_id = %task.id,
            status = %task.status,
            push_mode = %task.push_mode,
            "Returning already-assigned task to user"
        );
        tx.commit().await?;
        return Ok(Some(task));
    }

    // ── Phase 2: Claim the next unassigned, non-deferred task ──
    // Excludes counts that are actively deferred by another operator.
    // Path rules and occupied-aisle limits are applied in Rust so the
    // effective ordering stays in sync with the configurable engine.
    //
    // IMPORTANT: occupancy / path-rule reads run INSIDE the transaction
    // so they see the same snapshot as the FOR UPDATE SKIP LOCKED candidate
    // scan. Previously these used `pool` directly, which could read a stale
    // pre-claim snapshot under contention.
    //
    // CONCURRENCY (Fix-Simultaneous-Claim-Aisle-Thrash 2026-05-29): serialize
    // candidate SELECTION per-org with a transaction-scoped advisory lock taken
    // BEFORE the occupancy read and the `FOR UPDATE SKIP LOCKED LIMIT 200`
    // candidate scan. Without it, two simultaneous claims race the 200-row
    // SKIP-LOCKED window: each gets a DISJOINT candidate set offset by up to
    // LIMIT rows, so the second claimer is displaced into a different aisle —
    // observed live as operators "swapping" aisles. Holding the lock means the
    // second claim runs AFTER the first commits, sees the first's now-assigned
    // row (via the zone pre-filter + occupancy below), and is routed to the
    // correct next aisle instead.
    //
    // LOCK ORDERING (deadlock-free): `cyclecount_claim:<org>` is the OUTERMOST
    // lock. The only other advisory lock in this path is the zone-exclusivity
    // trigger's `cyclecount_zone:<org>:<zone>`, acquired LATER inside the UPDATE
    // below — so the claim path always takes claim-lock → zone-lock, and NO
    // path takes them in the reverse order (the trigger never takes the claim
    // lock). Both are `pg_advisory_xact_lock` (auto-released on COMMIT/ROLLBACK),
    // so there is no cross-transaction leak and no lock-ordering cycle. Per-org
    // (not per-zone) because the target aisle isn't known until AFTER selection;
    // claims are short (sub-second to ~1 s) so per-org serialization at
    // warehouse-floor claim rates (~0.1–0.5 claims/s) is negligible queueing.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("cyclecount_claim:{}", org_id))
        .execute(&mut *tx)
        .await?;

    // Worker's current "sticky" aisle so the ranker keeps them progressing
    // linearly down it instead of yanking them to the globally-lowest aisle on
    // every claim. `None` when the org has `sticky_zone` disabled or the worker
    // has no recent aisle. This is a SOFT ordering preference (lag-tolerant);
    // the HARD don't-double-occupy guards (zone pre-filter + occupancy cap +
    // trigger) are all assignment-state based, below.
    let sticky_aisle = get_sticky_aisle_tx(&mut tx, org_id, user_id).await?;

    let occupied_aisles = get_occupied_aisles_tx(&mut tx, org_id, user_id).await?;
    let occupied_by_aisle: HashMap<String, i64> = occupied_aisles
        .into_iter()
        .map(|entry| (entry.resolved_aisle, entry.worker_count))
        .collect();

    let candidate_tasks = sqlx::query_as::<_, CycleCountTask>(
        r#"
        SELECT
            id, count_number, material_number, material_description,
            location, warehouse,
            system_quantity::float8 as system_quantity,
            counted_quantity::float8 as counted_quantity,
            COALESCE(unit_of_measure, 'EA') as unit_of_measure,
            priority::text as priority, status::text as status,
            count_type::text as count_type,
            assigned_to, assigned_at,
            COALESCE(push_mode, 'pull') as push_mode,
            pushed_by, pushed_at,
            COALESCE(push_acknowledged, false) as push_acknowledged,
            organization_id,
            completed_at,
            recount_by,
            recount_date,
            COALESCE(recount_completed, false) as recount_completed,
            COALESCE(requires_recount, false) as requires_recount,
            counter_name,
            resolved_location_key, resolved_zone, resolved_aisle,
            resolved_sequence::float8 as resolved_sequence, resolution_source,
            workflow_config_id,
            workflow_config_version,
            COALESCE(workflow_snapshot, '{}'::jsonb) as workflow_snapshot,
            COALESCE(workflow_result, '{}'::jsonb) as workflow_result,
            evidence_photo_urls,
            review_threshold_pct::float8 as review_threshold_pct,
            review_threshold_abs::float8 as review_threshold_abs,
            scanned_material_number,
            location_reported_empty,
            part_variance,
            COALESCE(scanned_parts, '[]'::jsonb) as scanned_parts,
            transfer_destination_location,
            transfer_source_quantity::float8 as transfer_source_quantity
        FROM rr_cyclecount_data rcc
        WHERE rcc.organization_id = $1
          AND rcc.status IN ('pending', 'recount')
          AND rcc.assigned_to IS NULL
          -- Exclude only counts THIS operator has actively deferred.
          --
          -- 2026-05-01 (Fix-Critical-Hidden-By-Global-Defer-Filter):
          -- this filter was previously global (`WHERE is_active = true`
          -- with no `user_id` scope), which made any operator's defer
          -- behave as a global block-list. With 4+ operators deferring
          -- the same critical/hot rows, every other operator's Pull
          -- Next saw an empty critical/hot pool and fell through to
          -- normal — hiding 5 critical + 21 hot counts from the entire
          -- floor for the whole session. The table is per-operator
          -- (has `user_id`); the read filter MUST mirror that scope.
          -- Phase 1 (`assigned_to = $2`) and Phase 3
          -- (`get_deferred_count_for_user` already on `d.user_id = $1`)
          -- are correctly scoped — only Phase 2 was global.
          AND rcc.id NOT IN (
            SELECT count_id FROM cycle_count_operator_deferred_counts
            WHERE is_active = true
              AND user_id = $2
          )
          -- Zone-mutual-exclusion pre-filter — indexed fast path
          -- (migrations 228 + 232 + 233). A zone is BUSY for the current
          -- operator when any other user has either:
          --   * an actively-counting row (in_progress / recount), OR
          --   * a soft-released reservation (pending + assigned_to set).
          -- The DB trigger is still the authoritative guard; this
          -- pre-filter just keeps Pull Next UX smooth. Pattern-aware so
          -- it tracks the trigger when org sets a custom zone_pattern.
          AND (
            rcc.zone IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM cycle_count_zone_rules zr
              WHERE zr.organization_id = rcc.organization_id
                AND zr.enabled = true
                AND zr.policy = 'one_counter_per_zone'
                AND EXISTS (
                  SELECT 1
                  FROM rr_cyclecount_data occupied
                  WHERE occupied.organization_id = rcc.organization_id
                    AND COALESCE(public.cycle_count_zone_of(occupied.location, zr.zone_pattern), occupied.zone)
                        = COALESCE(public.cycle_count_zone_of(rcc.location, zr.zone_pattern), rcc.zone)
                    AND occupied.assigned_to IS NOT NULL
                    AND occupied.assigned_to <> $2
                    AND occupied.status IN ('pending','in_progress','recount')
                )
            )
          )
          -- Zone-to-user assignment filter (migration 227 / 233). Skip
          -- zones explicitly assigned to a different user. Pattern-aware.
          AND (
            rcc.zone IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM cycle_count_zone_rules zr
              JOIN cycle_count_zone_assignments za
                ON za.organization_id = zr.organization_id
               AND za.zone = COALESCE(public.cycle_count_zone_of(rcc.location, zr.zone_pattern), rcc.zone)
              WHERE zr.organization_id = rcc.organization_id
                AND zr.enabled = true
                AND za.user_id <> $2
            )
          )
        ORDER BY
            -- Migration 252: PRIORITY first. Sticky / dedicated zones
            -- are tiebreakers within the same priority tier — critical
            -- elsewhere always beats normal-sticky / normal-dedicated.
            -- This was inverted in 233 and surfaced as the "critical
            -- not first" bug in the 2026-05-01 review.
            CASE rcc.priority::text
                WHEN 'critical' THEN 1 WHEN 'hot' THEN 2
                WHEN 'normal' THEN 3   WHEN 'low' THEN 4
                ELSE 5
            END ASC,
            -- Sticky aisle (Fix-Simultaneous-Claim-Aisle-Thrash 2026-05-29):
            -- keep the operator progressing down the aisle they're already in.
            -- `$3` is the worker's current resolved_aisle (NULL when the org
            -- has sticky_zone disabled or the worker has no recent aisle), so
            -- when set, rows in that aisle sort first WITHIN the priority tier.
            -- This floats the worker's own aisle into the locked candidate
            -- window; the Rust ranker applies the same tiebreaker to PICK it.
            -- Replaces the prior dead branch that keyed on a HELD in_progress
            -- row — which never exists in the between-counts claim gap, so it
            -- could never fire (and was gated off by sticky_zone=false anyway).
            CASE WHEN $3 IS NOT NULL AND rcc.resolved_aisle = $3 THEN 0 ELSE 1 END ASC,
            -- Dedicated zones: rows in zones explicitly assigned to the
            -- current operator come next within the priority tier.
            CASE
              WHEN rcc.zone IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM cycle_count_zone_rules zrm
                 JOIN cycle_count_zone_assignments zam
                   ON zam.organization_id = zrm.organization_id
                  AND zam.zone = COALESCE(public.cycle_count_zone_of(rcc.location, zrm.zone_pattern), rcc.zone)
                 WHERE zrm.organization_id = rcc.organization_id
                   AND zrm.enabled = true
                   AND zam.user_id = $2
               ) THEN 0
              ELSE 1
            END ASC,
            CASE WHEN rcc.resolution_source = 'unresolved' OR rcc.resolution_source IS NULL THEN 1 ELSE 0 END ASC,
            rcc.resolved_zone ASC NULLS LAST,
            rcc.resolved_aisle ASC NULLS LAST,
            rcc.resolved_sequence ASC NULLS LAST,
            rcc.location ASC,
            rcc.created_at ASC
        FOR UPDATE SKIP LOCKED
        -- Migration 252: bumped from 50 to 200 so a critical row that
        -- happens to sort late by location (e.g. unresolved + alphabetical
        -- tail) doesn't fall outside the candidate window. The supporting
        -- index is wide enough; cost is acceptable.
        LIMIT 200
        "#,
    )
    .bind(org_id)
    .bind(user_id)
    .bind(sticky_aisle.as_deref())
    .fetch_all(&mut *tx)
    .await?;

    // Batch-fetch all active path rules ONCE inside the same transaction
    // so ranking sees the same snapshot as the locked candidates.
    let all_rules = get_all_active_path_rules_tx(&mut tx, org_id).await?;

    let mut ranked_candidates: Vec<(usize, CycleCountTask, Option<PathRule>)> = Vec::new();

    for (original_index, task) in candidate_tasks.into_iter().enumerate() {
        let rule = find_matching_path_rule(
            &all_rules,
            task.warehouse.as_deref(),
            task.resolved_zone.as_deref(),
            task.resolved_aisle.as_deref(),
        )
        .cloned();

        let unresolved = task
            .resolution_source
            .as_deref()
            .unwrap_or("unresolved")
            == "unresolved";

        let blocked_by_fallback = rule
            .as_ref()
            .map(|rule_ref| rule_ref.fallback_behavior == "block_unmapped" && unresolved)
            .unwrap_or(false);

        // Migration 252: critical-priority counts bypass path-rule
        // occupancy entirely. A saturated aisle should NEVER hide a
        // critical-priority count from an operator. Lower priorities
        // still respect the limit.
        let is_critical = task.priority == "critical";
        let blocked_by_occupancy = if is_critical {
            false
        } else if let Some(rule_ref) = rule.as_ref() {
            if rule_ref.fallback_behavior != "ignore_path_rules" {
                task.resolved_aisle
                    .as_ref()
                    .and_then(|aisle| occupied_by_aisle.get(aisle))
                    .map(|count| *count >= i64::from(rule_ref.max_counters_per_aisle))
                    .unwrap_or(false)
            } else {
                false
            }
        } else {
            false
        };

        if blocked_by_fallback || blocked_by_occupancy {
            continue;
        }

        ranked_candidates.push((original_index, task, rule));
    }

    let user_bucket = i64::from(user_id.as_bytes()[0] % 2);
    let sticky_aisle_ref = sticky_aisle.as_deref();
    ranked_candidates.sort_by(|(a_index, a_task, a_rule), (b_index, b_task, b_rule)| {
        let priority_cmp = priority_rank(&a_task.priority).cmp(&priority_rank(&b_task.priority));
        if priority_cmp != Ordering::Equal {
            return priority_cmp;
        }

        // Sticky-aisle tiebreaker — mirrors the SQL ORDER BY. The SQL sticky
        // CASE only floats the worker's aisle into the LOCKED window; this Rust
        // re-sort is the source of truth for the FINAL pick, so the same
        // tiebreaker MUST be applied here or the global `resolved_zone`/
        // `resolved_aisle` sort below would override stickiness and pull the
        // worker back to the lowest aisle. No-op when `sticky_aisle_ref` is None.
        let sticky_cmp = sticky_rank(a_task.resolved_aisle.as_deref(), sticky_aisle_ref)
            .cmp(&sticky_rank(b_task.resolved_aisle.as_deref(), sticky_aisle_ref));
        if sticky_cmp != Ordering::Equal {
            return sticky_cmp;
        }

        let a_unresolved =
            a_task.resolution_source.as_deref().unwrap_or("unresolved") == "unresolved";
        let b_unresolved =
            b_task.resolution_source.as_deref().unwrap_or("unresolved") == "unresolved";
        let unresolved_cmp = a_unresolved.cmp(&b_unresolved);
        if unresolved_cmp != Ordering::Equal {
            return unresolved_cmp;
        }

        let a_bucket_pref = match a_rule.as_ref().map(|r| r.strategy.as_str()) {
            Some("alternating_aisles") => {
                let bucket = parse_aisle_bucket(a_task.resolved_aisle.as_deref()) % 2;
                if bucket == user_bucket {
                    0
                } else {
                    1
                }
            }
            _ => 0,
        };
        let b_bucket_pref = match b_rule.as_ref().map(|r| r.strategy.as_str()) {
            Some("alternating_aisles") => {
                let bucket = parse_aisle_bucket(b_task.resolved_aisle.as_deref()) % 2;
                if bucket == user_bucket {
                    0
                } else {
                    1
                }
            }
            _ => 0,
        };
        let bucket_cmp = a_bucket_pref.cmp(&b_bucket_pref);
        if bucket_cmp != Ordering::Equal {
            return bucket_cmp;
        }

        let zone_cmp = a_task
            .resolved_zone
            .as_deref()
            .unwrap_or("unresolved")
            .cmp(b_task.resolved_zone.as_deref().unwrap_or("unresolved"));
        if zone_cmp != Ordering::Equal {
            return zone_cmp;
        }

        let aisle_cmp = a_task
            .resolved_aisle
            .as_deref()
            .unwrap_or("unresolved")
            .cmp(b_task.resolved_aisle.as_deref().unwrap_or("unresolved"));
        if aisle_cmp != Ordering::Equal {
            return aisle_cmp;
        }

        let a_seq = a_task.resolved_sequence.unwrap_or(0.0);
        let b_seq = b_task.resolved_sequence.unwrap_or(0.0);
        let a_desc = a_rule
            .as_ref()
            .map(|rule| rule.strategy == "directional" && rule.direction == "descending")
            .unwrap_or(false);
        let b_desc = b_rule
            .as_ref()
            .map(|rule| rule.strategy == "directional" && rule.direction == "descending")
            .unwrap_or(false);

        let sequence_cmp = if a_desc && b_desc {
            b_seq.partial_cmp(&a_seq).unwrap_or(Ordering::Equal)
        } else {
            a_seq.partial_cmp(&b_seq).unwrap_or(Ordering::Equal)
        };
        if sequence_cmp != Ordering::Equal {
            return sequence_cmp;
        }

        let location_cmp = a_task.location.cmp(&b_task.location);
        if location_cmp != Ordering::Equal {
            return location_cmp;
        }

        a_index.cmp(b_index)
    });

    if let Some((_, task, _)) = ranked_candidates.first() {
        let user_name: Option<String> = sqlx::query_scalar(
            "SELECT full_name FROM user_profiles WHERE id = $1",
        )
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await?
        .flatten();

        sqlx::query(
            r#"
            UPDATE rr_cyclecount_data
            SET
                assigned_to = $1,
                assigned_at = NOW(),
                status = 'in_progress',
                counter_name = $3,
                updated_at = NOW()
            WHERE id = $2
              AND assigned_to IS NULL
            "#,
        )
        .bind(user_id)
        .bind(task.id)
        .bind(user_name.unwrap_or_else(|| "RF User".to_string()))
        .execute(&mut *tx)
        .await?;

        let updated_task = sqlx::query_as::<_, CycleCountTask>(
            r#"
            SELECT
                id, count_number, material_number, material_description,
                location, warehouse,
                system_quantity::float8 as system_quantity,
                counted_quantity::float8 as counted_quantity,
                COALESCE(unit_of_measure, 'EA') as unit_of_measure,
                priority::text as priority, status::text as status,
                count_type::text as count_type,
                assigned_to, assigned_at,
                COALESCE(push_mode, 'pull') as push_mode,
                pushed_by, pushed_at,
            COALESCE(push_acknowledged, false) as push_acknowledged,
            organization_id,
            completed_at,
            recount_by,
            recount_date,
            COALESCE(recount_completed, false) as recount_completed,
            COALESCE(requires_recount, false) as requires_recount,
            counter_name,
            resolved_location_key, resolved_zone, resolved_aisle,
            resolved_sequence::float8 as resolved_sequence, resolution_source,
            workflow_config_id,
            workflow_config_version,
            COALESCE(workflow_snapshot, '{}'::jsonb) as workflow_snapshot,
            COALESCE(workflow_result, '{}'::jsonb) as workflow_result,
            evidence_photo_urls,
            review_threshold_pct::float8 as review_threshold_pct,
            review_threshold_abs::float8 as review_threshold_abs,
            scanned_material_number,
            location_reported_empty,
            part_variance,
            COALESCE(scanned_parts, '[]'::jsonb) as scanned_parts,
            transfer_destination_location,
            transfer_source_quantity::float8 as transfer_source_quantity
            FROM rr_cyclecount_data
            WHERE id = $1
            "#,
        )
        .bind(task.id)
        .fetch_one(&mut *tx)
        .await?;

        tx.commit().await?;
        return Ok(Some(updated_task));
    }

    // ── Phase 3: Reclaim oldest deferred task for this operator ──
    // Only reached if no regular work is available.
    tx.commit().await?;

    let deferred = get_deferred_count_for_user(pool, user_id, org_id).await?;
    if let Some(task) = deferred {
        let mut tx2 = pool.begin().await?;

        let user_name: Option<String> = sqlx::query_scalar(
            "SELECT full_name FROM user_profiles WHERE id = $1",
        )
        .bind(user_id)
        .fetch_optional(&mut *tx2)
        .await?
        .flatten();

        sqlx::query(
            r#"
            UPDATE rr_cyclecount_data
            SET assigned_to = $1, assigned_at = NOW(),
                status = 'in_progress', counter_name = $3, updated_at = NOW()
            WHERE id = $2
            "#,
        )
        .bind(user_id)
        .bind(task.id)
        .bind(user_name.unwrap_or_else(|| "RF User".to_string()))
        .execute(&mut *tx2)
        .await?;

        // Clear the defer record since we're reclaiming
        sqlx::query(
            r#"
            UPDATE cycle_count_operator_deferred_counts
            SET is_active = false, reactivated_at = NOW(), updated_at = NOW()
            WHERE count_id = $1 AND user_id = $2 AND is_active = true
            "#,
        )
        .bind(task.id)
        .bind(user_id)
        .execute(&mut *tx2)
        .await?;

        tx2.commit().await?;

        let reclaimed = get_cycle_count_by_id(pool, task.id, org_id).await?;
        return Ok(reclaimed);
    }

    Ok(None)
}

/// Push a cycle count to a specific user, operating on an already-open
/// transaction so callers (e.g. `push_batch`) can wrap many pushes inside
/// per-task savepoints and either commit or roll back atomically.
///
/// Returns `Ok(None)` if the target user doesn't exist in the org or the
/// count is not in a pushable state. Caller is responsible for committing
/// or rolling back the surrounding transaction (or savepoint).
pub async fn push_cycle_count_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    count_id: Uuid,
    user_id: Uuid,
    pushed_by: Uuid,
    org_id: Uuid,
) -> Result<Option<CycleCountTask>, sqlx::Error> {
    let target_user_exists = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)
        FROM user_profiles
        WHERE id = $1
          AND organization_id = $2
        "#,
    )
    .bind(user_id)
    .bind(org_id)
    .fetch_one(&mut **tx)
    .await?;

    if target_user_exists == 0 {
        return Ok(None);
    }

    let existing = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT id FROM rr_cyclecount_data
        WHERE id = $1
          AND organization_id = $2
          AND status IN ('pending', 'recount')
        FOR UPDATE SKIP LOCKED
        "#,
    )
    .bind(count_id)
    .bind(org_id)
    .fetch_optional(&mut **tx)
    .await?;

    if existing.is_none() {
        return Ok(None);
    }

    let user_name: Option<String> = sqlx::query_scalar(
        "SELECT full_name FROM user_profiles WHERE id = $1"
    )
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await?
    .flatten();

    // Push the count to the user.
    //
    // Migration 253 review: ALSO stamp supervisor_assigned_at /
    // supervisor_assigned_by here. The dashboard SQL RPC
    // `assign_cycle_count_to_user` stamps these so
    // `escalate_stale_zone_reservations` honors supervisor intent
    // through the protection window. The Rust push path bypassed those
    // columns, so a pushed-but-not-acknowledged row was unprotected and
    // got hard-unassigned by the escalator after the threshold — the
    // exact "silent unassign of supervisor intent" bug 252 fixed for the
    // SQL path. Stamping here closes that gap for the Rust path too.
    //
    // NOTE: re-stamps with the CURRENT pusher and NOW() even if a prior
    // supervisor stamp existed — the latest push expresses the latest
    // supervisor intent.
    sqlx::query(
        r#"
        UPDATE rr_cyclecount_data
        SET 
            assigned_to = $1,
            assigned_at = NOW(),
            counter_name = $4,
            push_mode = 'push',
            pushed_by = $2,
            pushed_at = NOW(),
            push_acknowledged = FALSE,
            supervisor_assigned_at = NOW(),
            supervisor_assigned_by = $2,
            updated_at = NOW()
        WHERE id = $3
        "#,
    )
    .bind(user_id)
    .bind(pushed_by)
    .bind(count_id)
    .bind(user_name.unwrap_or_else(|| "Assigned User".to_string()))
    .execute(&mut **tx)
    .await?;

    let task = sqlx::query_as::<_, CycleCountTask>(
        r#"
        SELECT
            id,
            count_number,
            material_number,
            material_description,
            location,
            warehouse,
            system_quantity::float8 as system_quantity,
            counted_quantity::float8 as counted_quantity,
            COALESCE(unit_of_measure, 'EA') as unit_of_measure,
            priority::text as priority,
            status::text as status,
            count_type::text as count_type,
            assigned_to,
            assigned_at,
            COALESCE(push_mode, 'pull') as push_mode,
            pushed_by,
            pushed_at,
            COALESCE(push_acknowledged, false) as push_acknowledged,
            organization_id,
            completed_at,
            recount_by,
            recount_date,
            COALESCE(recount_completed, false) as recount_completed,
            COALESCE(requires_recount, false) as requires_recount,
            counter_name,
            resolved_location_key, resolved_zone, resolved_aisle,
            resolved_sequence::float8 as resolved_sequence, resolution_source,
            workflow_config_id,
            workflow_config_version,
            COALESCE(workflow_snapshot, '{}'::jsonb) as workflow_snapshot,
            COALESCE(workflow_result, '{}'::jsonb) as workflow_result,
            evidence_photo_urls,
            review_threshold_pct::float8 as review_threshold_pct,
            review_threshold_abs::float8 as review_threshold_abs,
            scanned_material_number,
            location_reported_empty,
            part_variance,
            COALESCE(scanned_parts, '[]'::jsonb) as scanned_parts,
            transfer_destination_location,
            transfer_source_quantity::float8 as transfer_source_quantity
        FROM rr_cyclecount_data
        WHERE id = $1
        "#,
    )
    .bind(count_id)
    .fetch_one(&mut **tx)
    .await?;

    Ok(Some(task))
}

/// Push a cycle count to a specific user.
///
/// Thin pool-level wrapper around `push_cycle_count_in_tx` that opens its
/// own transaction so single-task callers don't need to manage one. For
/// atomic multi-task pushes, prefer `push_cycle_count_in_tx` from inside
/// a transaction with per-task SAVEPOINTs (see `routes::work::push_batch`).
#[instrument(skip(pool))]
pub async fn push_cycle_count(
    pool: &PgPool,
    count_id: Uuid,
    user_id: Uuid,
    pushed_by: Uuid,
    org_id: Uuid,
) -> Result<Option<CycleCountTask>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let res = push_cycle_count_in_tx(&mut tx, count_id, user_id, pushed_by, org_id).await;
    match res {
        Ok(Some(task)) => {
            tx.commit().await?;
            Ok(Some(task))
        }
        Ok(None) => {
            tx.rollback().await?;
            Ok(None)
        }
        Err(e) => {
            // Best-effort rollback; surface the original error.
            let _ = tx.rollback().await;
            Err(e)
        }
    }
}

/// Start a cycle count (mark as in_progress).
/// Idempotent: succeeds if the task is already in_progress for this user.
#[instrument(skip(pool))]
pub async fn start_cycle_count(
    pool: &PgPool,
    count_id: Uuid,
    user_id: Uuid,
    org_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE rr_cyclecount_data
        SET
            status = 'in_progress',
            updated_at = NOW()
        WHERE id = $1
          AND assigned_to = $2
          AND organization_id = $3
          AND status IN ('pending', 'in_progress', 'recount')
        "#,
    )
    .bind(count_id)
    .bind(user_id)
    .bind(org_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Complete a cycle count with the counted quantity.
/// Only sets `counted_quantity`; the DB trigger `auto_calculate_cycle_count_variance`
/// derives `variance_quantity`, `variance_percentage`, `requires_recount`, and may
/// upgrade the status to 'variance_review' based on per-row thresholds.
/// Returns the final persisted status so callers can broadcast accurately.
/// Accepts pending/in_progress/recount so a count can be completed even if the
/// intermediate start step was skipped or failed transiently.
#[instrument(skip(pool))]
pub async fn complete_cycle_count(
    pool: &PgPool,
    count_id: Uuid,
    user_id: Uuid,
    org_id: Uuid,
    counted_qty: f64,
    notes: Option<String>,
) -> Result<Option<String>, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE rr_cyclecount_data
        SET 
            status = 'completed',
            counted_quantity = $4,
            notes = COALESCE($5, notes),
            count_date = (NOW() AT TIME ZONE 'America/New_York')::date,
            count_time = (NOW() AT TIME ZONE 'America/New_York')::time,
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = $1 
          AND assigned_to = $2
          AND organization_id = $3
          AND status IN ('pending', 'in_progress', 'recount')
        "#,
    )
    .bind(count_id)    // $1
    .bind(user_id)     // $2
    .bind(org_id)      // $3
    .bind(counted_qty) // $4
    .bind(notes)       // $5
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Ok(None);
    }

    // Clear any active defer records — the count is done
    sqlx::query(
        r#"
        UPDATE cycle_count_operator_deferred_counts
        SET is_active = false, cleared_at = NOW(), updated_at = NOW()
        WHERE count_id = $1 AND is_active = true
        "#,
    )
    .bind(count_id)
    .execute(pool)
    .await?;

    let final_status: String = sqlx::query_scalar(
        "SELECT status::text FROM rr_cyclecount_data WHERE id = $1",
    )
    .bind(count_id)
    .fetch_one(pool)
    .await?;

    Ok(Some(final_status))
}

/// Release a cycle count back to the queue
#[instrument(skip(pool))]
pub async fn release_cycle_count(
    pool: &PgPool,
    count_id: Uuid,
    org_id: Uuid,
    actor_id: Uuid,
    allow_override: bool,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE rr_cyclecount_data
        SET 
            assigned_to = NULL,
            assigned_at = NULL,
            counter_name = NULL,
            status = 'pending',
            push_mode = 'pull',
            pushed_by = NULL,
            pushed_at = NULL,
            push_acknowledged = FALSE,
            updated_at = NOW()
        WHERE id = $1
          AND organization_id = $2
          AND ($3 OR assigned_to = $4)
          AND status IN ('pending', 'in_progress', 'recount')
        "#,
    )
    .bind(count_id)
    .bind(org_id)
    .bind(allow_override)
    .bind(actor_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Acknowledge a pushed cycle count
#[instrument(skip(pool))]
pub async fn acknowledge_pushed_count(
    pool: &PgPool,
    count_id: Uuid,
    user_id: Uuid,
    org_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE rr_cyclecount_data
        SET 
            push_acknowledged = TRUE,
            push_acknowledged_at = NOW(),
            status = CASE 
                WHEN status = 'pending' THEN 'in_progress'::cycle_count_status
                ELSE status
            END,
            updated_at = NOW()
        WHERE id = $1 
          AND assigned_to = $2
          AND organization_id = $3
          AND push_mode = 'push'
          AND push_acknowledged = FALSE
        "#,
    )
    .bind(count_id)
    .bind(user_id)
    .bind(org_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Get active workers (heartbeat within last 5 minutes)
#[instrument(skip(pool))]
pub async fn get_active_workers(
    pool: &PgPool,
    org_id: Uuid,
) -> Result<Vec<WorkerStatus>, sqlx::Error> {
    sqlx::query_as::<_, WorkerStatus>(
        r#"
        SELECT
            wh.user_id,
            up.full_name,
            up.email,
            wh.status,
            wh.current_task_id,
            wh.current_task_type,
            wh.current_zone,
            wh.current_location,
            wh.last_heartbeat
        FROM worker_heartbeats wh
        JOIN user_profiles up ON wh.user_id = up.id
        WHERE wh.organization_id = $1
          AND wh.last_heartbeat >= NOW() - INTERVAL '5 minutes'
        ORDER BY 
            CASE wh.status 
                WHEN 'busy' THEN 1 
                WHEN 'online' THEN 2 
                WHEN 'idle' THEN 3 
                WHEN 'break' THEN 4 
                WHEN 'offline' THEN 5 
            END,
            wh.last_heartbeat DESC
        "#,
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
}

/// Get tasks assigned to a specific worker
#[instrument(skip(pool))]
pub async fn get_worker_tasks(
    pool: &PgPool,
    user_id: Uuid,
    org_id: Uuid,
) -> Result<Vec<CycleCountTask>, sqlx::Error> {
    sqlx::query_as::<_, CycleCountTask>(
        r#"
        SELECT
            id,
            count_number,
            material_number,
            material_description,
            location,
            warehouse,
            system_quantity::float8 as system_quantity,
            counted_quantity::float8 as counted_quantity,
            COALESCE(unit_of_measure, 'EA') as unit_of_measure,
            priority::text as priority,
            status::text as status,
            count_type::text as count_type,
            assigned_to,
            assigned_at,
            COALESCE(push_mode, 'pull') as push_mode,
            pushed_by,
            pushed_at,
            COALESCE(push_acknowledged, false) as push_acknowledged,
            organization_id,
            completed_at,
            recount_by,
            recount_date,
            COALESCE(recount_completed, false) as recount_completed,
            COALESCE(requires_recount, false) as requires_recount,
            counter_name,
            resolved_location_key, resolved_zone, resolved_aisle,
            resolved_sequence::float8 as resolved_sequence, resolution_source,
            workflow_config_id,
            workflow_config_version,
            COALESCE(workflow_snapshot, '{}'::jsonb) as workflow_snapshot,
            COALESCE(workflow_result, '{}'::jsonb) as workflow_result,
            evidence_photo_urls,
            review_threshold_pct::float8 as review_threshold_pct,
            review_threshold_abs::float8 as review_threshold_abs,
            scanned_material_number,
            location_reported_empty,
            part_variance,
            COALESCE(scanned_parts, '[]'::jsonb) as scanned_parts,
            transfer_destination_location,
            transfer_source_quantity::float8 as transfer_source_quantity
        FROM rr_cyclecount_data
        WHERE assigned_to = $1
          AND organization_id = $2
          AND status IN ('pending', 'in_progress', 'recount')
        ORDER BY 
            CASE priority::text 
                WHEN 'critical' THEN 1
                WHEN 'hot' THEN 2  
                WHEN 'normal' THEN 3
                WHEN 'low' THEN 4
                ELSE 5
            END ASC,
            pushed_at DESC NULLS LAST,
            CASE WHEN resolution_source = 'unresolved' OR resolution_source IS NULL THEN 1 ELSE 0 END ASC,
            resolved_zone ASC NULLS LAST,
            resolved_aisle ASC NULLS LAST,
            resolved_sequence ASC NULLS LAST,
            location ASC,
            assigned_at ASC
        "#,
    )
    .bind(user_id)
    .bind(org_id)
    .fetch_all(pool)
    .await
}

/// Get a single cycle count task by ID
#[instrument(skip(pool))]
pub async fn get_cycle_count_by_id(
    pool: &PgPool,
    count_id: Uuid,
    org_id: Uuid,
) -> Result<Option<CycleCountTask>, sqlx::Error> {
    sqlx::query_as::<_, CycleCountTask>(
        r#"
        SELECT
            id,
            count_number,
            material_number,
            material_description,
            location,
            warehouse,
            system_quantity::float8 as system_quantity,
            counted_quantity::float8 as counted_quantity,
            COALESCE(unit_of_measure, 'EA') as unit_of_measure,
            priority::text as priority,
            status::text as status,
            count_type::text as count_type,
            assigned_to,
            assigned_at,
            COALESCE(push_mode, 'pull') as push_mode,
            pushed_by,
            pushed_at,
            COALESCE(push_acknowledged, false) as push_acknowledged,
            organization_id,
            completed_at,
            recount_by,
            recount_date,
            COALESCE(recount_completed, false) as recount_completed,
            COALESCE(requires_recount, false) as requires_recount,
            counter_name,
            resolved_location_key, resolved_zone, resolved_aisle,
            resolved_sequence::float8 as resolved_sequence, resolution_source,
            workflow_config_id,
            workflow_config_version,
            COALESCE(workflow_snapshot, '{}'::jsonb) as workflow_snapshot,
            COALESCE(workflow_result, '{}'::jsonb) as workflow_result,
            evidence_photo_urls,
            review_threshold_pct::float8 as review_threshold_pct,
            review_threshold_abs::float8 as review_threshold_abs,
            scanned_material_number,
            location_reported_empty,
            part_variance,
            COALESCE(scanned_parts, '[]'::jsonb) as scanned_parts,
            transfer_destination_location,
            transfer_source_quantity::float8 as transfer_source_quantity
        FROM rr_cyclecount_data
        WHERE id = $1
          AND organization_id = $2
        "#,
    )
    .bind(count_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
}

/// Upsert worker heartbeat
#[instrument(skip(pool))]
pub async fn upsert_heartbeat(
    pool: &PgPool,
    user_id: Uuid,
    org_id: Uuid,
    task_id: Option<Uuid>,
    task_type: Option<String>,
    zone: Option<String>,
    location: Option<String>,
    status: String,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        INSERT INTO worker_heartbeats (
            user_id,
            organization_id,
            last_heartbeat,
            current_task_id,
            current_task_type,
            current_zone,
            current_location,
            status,
            created_at,
            updated_at
        ) VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, NOW(), NOW())
        ON CONFLICT (user_id) DO UPDATE SET
            last_heartbeat = NOW(),
            current_task_id = EXCLUDED.current_task_id,
            current_task_type = EXCLUDED.current_task_type,
            current_zone = EXCLUDED.current_zone,
            current_location = EXCLUDED.current_location,
            status = EXCLUDED.status,
            updated_at = NOW()
        "#,
    )
    .bind(user_id)
    .bind(org_id)
    .bind(task_id)
    .bind(task_type)
    .bind(zone)
    .bind(location)
    .bind(status)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Get the highest-priority active path rule for a warehouse.
/// Kept for callers outside the pull-next ranker; prefer
/// `get_all_active_path_rules` + `find_matching_path_rule` when a batch is
/// being processed to avoid N DB roundtrips.
#[allow(dead_code)]
#[instrument(skip(pool))]
pub async fn get_path_rule(
    pool: &PgPool,
    org_id: Uuid,
    warehouse_code: Option<&str>,
    zone: Option<&str>,
    aisle: Option<&str>,
) -> Result<Option<PathRule>, sqlx::Error> {
    let rules = get_all_active_path_rules(pool, org_id).await?;
    Ok(find_matching_path_rule(&rules, warehouse_code, zone, aisle).cloned())
}

/// Fetch every active path rule for an org in a single roundtrip,
/// priority-sorted. Pool-based variant kept for non-tx callers
/// (e.g. `get_path_rule` shim).
#[allow(dead_code)]
#[instrument(skip(pool))]
pub async fn get_all_active_path_rules(
    pool: &PgPool,
    org_id: Uuid,
) -> Result<Vec<PathRule>, sqlx::Error> {
    sqlx::query_as::<_, PathRule>(ALL_ACTIVE_PATH_RULES_SQL)
        .bind(org_id)
        .fetch_all(pool)
        .await
}

/// Transaction-scoped variant — used inside `claim_next_cycle_count` so
/// rule reads share a snapshot with the locked candidate set (review fix
/// 2026-04-24).
#[instrument(skip(tx))]
pub async fn get_all_active_path_rules_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    org_id: Uuid,
) -> Result<Vec<PathRule>, sqlx::Error> {
    sqlx::query_as::<_, PathRule>(ALL_ACTIVE_PATH_RULES_SQL)
        .bind(org_id)
        .fetch_all(&mut **tx)
        .await
}

const ALL_ACTIVE_PATH_RULES_SQL: &str = r#"
    SELECT
        id, organization_id, warehouse_code, zone_filter, aisle_filter,
        strategy::text as strategy, direction::text as direction,
        max_counters_per_aisle, fallback_behavior::text as fallback_behavior,
        priority
    FROM cycle_count_path_rules
    WHERE organization_id = $1
      AND is_active = true
    ORDER BY priority DESC
"#;

/// Rust-side variant of the rule-matching logic in `get_path_rule`.
/// Works against a pre-fetched list so callers can avoid N database
/// roundtrips.
pub fn find_matching_path_rule<'a>(
    rules: &'a [PathRule],
    warehouse_code: Option<&str>,
    zone: Option<&str>,
    aisle: Option<&str>,
) -> Option<&'a PathRule> {
    rules.iter().find(|rule| {
        // Match warehouse_code (NULL in rule means "all warehouses").
        let warehouse_match = match rule.warehouse_code.as_deref() {
            None => true,
            Some(w) if w.trim().is_empty() => true,
            Some(w) => warehouse_code
                .map(|candidate| candidate.eq_ignore_ascii_case(w))
                .unwrap_or(false),
        };
        warehouse_match
            && matches_filter(rule.zone_filter.as_deref(), zone)
            && matches_filter(rule.aisle_filter.as_deref(), aisle)
    })
}

/// Resolve the worker's current "sticky" aisle for Phase-2 ranking, or `None`
/// when stickiness shouldn't apply. Returns `Some(aisle)` only when the org has
/// `cycle_count_zone_rules.sticky_zone = true`; the aisle is the worker's
/// most-recent (≤30 min) assigned/completed row's `resolved_aisle`, falling
/// back to their live `worker_heartbeats.current_zone`. Heartbeat lag is
/// acceptable here because this feeds a SOFT ordering preference, not a
/// correctness guard. Transaction-scoped so it shares the claim's snapshot
/// (and runs under the per-org claim advisory lock).
#[instrument(skip(tx))]
pub async fn get_sticky_aisle_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    org_id: Uuid,
    user_id: Uuid,
) -> Result<Option<String>, sqlx::Error> {
    let aisle: Option<String> = sqlx::query_scalar(
        r#"
        SELECT CASE
          WHEN EXISTS (
            SELECT 1 FROM cycle_count_zone_rules
            WHERE organization_id = $1 AND enabled = true AND sticky_zone = true
          )
          THEN COALESCE(
            (
              SELECT cc.resolved_aisle
              FROM rr_cyclecount_data cc
              WHERE cc.organization_id = $1
                AND cc.assigned_to = $2
                AND cc.resolved_aisle IS NOT NULL
                AND cc.resolved_aisle <> 'unresolved'
                AND COALESCE(cc.completed_at, cc.assigned_at) >= NOW() - INTERVAL '30 minutes'
              ORDER BY COALESCE(cc.completed_at, cc.assigned_at) DESC
              LIMIT 1
            ),
            (
              SELECT NULLIF(wh.current_zone, '')
              FROM worker_heartbeats wh
              WHERE wh.user_id = $2
                AND wh.organization_id = $1
                AND wh.last_heartbeat >= NOW() - INTERVAL '5 minutes'
              LIMIT 1
            )
          )
          ELSE NULL
        END
        "#,
    )
    .bind(org_id)
    .bind(user_id)
    .fetch_one(&mut **tx)
    .await?;
    Ok(aisle)
}

/// Get occupied aisles from active cycle-count assignments. Pool-based variant
/// kept for non-tx external callers.
#[allow(dead_code)]
#[instrument(skip(pool))]
pub async fn get_occupied_aisles(
    pool: &PgPool,
    org_id: Uuid,
    exclude_user_id: Uuid,
) -> Result<Vec<OccupiedAisle>, sqlx::Error> {
    sqlx::query_as::<_, OccupiedAisle>(OCCUPIED_AISLES_SQL)
        .bind(org_id)
        .bind(exclude_user_id)
        .fetch_all(pool)
        .await
}

/// Transaction-scoped variant for `claim_next_cycle_count` ranking.
#[instrument(skip(tx))]
pub async fn get_occupied_aisles_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    org_id: Uuid,
    exclude_user_id: Uuid,
) -> Result<Vec<OccupiedAisle>, sqlx::Error> {
    sqlx::query_as::<_, OccupiedAisle>(OCCUPIED_AISLES_SQL)
        .bind(org_id)
        .bind(exclude_user_id)
        .fetch_all(&mut **tx)
        .await
}

// Fix-Simultaneous-Claim-Aisle-Thrash (2026-05-29): occupancy is derived from
// committed ASSIGNMENT STATE, not from `worker_heartbeats` freshness. The prior
// version joined `worker_heartbeats` and gated on `last_heartbeat >= NOW() -
// 5 min`, so a just-claimed aisle stayed invisible to the per-aisle cap until
// the next heartbeat landed (3–30 s later) — long enough for a second
// simultaneous claimer to pile into the same aisle. Counting DISTINCT other
// operators with an active (`in_progress`/`recount`) assignment per aisle makes
// a just-claimed aisle visible IMMEDIATELY (the claim sets status='in_progress'
// and, under the Phase-2 claim advisory lock, commits before the next claim
// runs). It also makes the cap CONSISTENT with the zone pre-filter and the
// zone-exclusivity trigger, which already key off assignment state with no
// heartbeat dependency. Abandoned in_progress rows from offline workers are
// reclaimed by the escalation/abandonment job (assigned_to nulled), so they do
// not pin an aisle indefinitely.
const OCCUPIED_AISLES_SQL: &str = r#"
    SELECT
        cc.resolved_aisle AS resolved_aisle,
        COUNT(DISTINCT cc.assigned_to)::bigint AS worker_count
    FROM rr_cyclecount_data cc
    WHERE cc.organization_id = $1
      AND cc.assigned_to IS NOT NULL
      AND cc.assigned_to != $2
      AND cc.status IN ('in_progress', 'recount')
      AND cc.resolved_aisle IS NOT NULL
      AND cc.resolved_aisle != 'unresolved'
    GROUP BY cc.resolved_aisle
"#;

/// Skip/defer a cycle count for an operator
#[instrument(skip(pool))]
pub async fn skip_cycle_count(
    pool: &PgPool,
    count_id: Uuid,
    user_id: Uuid,
    reason: Option<String>,
) -> Result<bool, sqlx::Error> {
    let owns_task = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)
        FROM rr_cyclecount_data
        WHERE id = $1
          AND assigned_to = $2
          AND status IN ('pending', 'in_progress', 'recount')
        "#,
    )
    .bind(count_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    if owns_task == 0 {
        return Ok(false);
    }

    let result = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT skip_cycle_count_for_operator($1, $2, $3)",
    )
    .bind(count_id)
    .bind(user_id)
    .bind(reason)
    .fetch_one(pool)
    .await?;

    let success = result
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    Ok(success)
}

/// Get oldest active deferred count for an operator (Phase 3 of claim)
#[instrument(skip(pool))]
pub async fn get_deferred_count_for_user(
    pool: &PgPool,
    user_id: Uuid,
    org_id: Uuid,
) -> Result<Option<CycleCountTask>, sqlx::Error> {
    sqlx::query_as::<_, CycleCountTask>(
        r#"
        SELECT
            cc.id, cc.count_number, cc.material_number, cc.material_description,
            cc.location, cc.warehouse,
            cc.system_quantity::float8 as system_quantity,
            cc.counted_quantity::float8 as counted_quantity,
            COALESCE(cc.unit_of_measure, 'EA') as unit_of_measure,
            cc.priority::text as priority, cc.status::text as status,
            cc.count_type::text as count_type,
            cc.assigned_to, cc.assigned_at,
            COALESCE(cc.push_mode, 'pull') as push_mode,
            cc.pushed_by, cc.pushed_at,
            COALESCE(cc.push_acknowledged, false) as push_acknowledged,
            cc.organization_id,
            cc.completed_at,
            cc.recount_by, cc.recount_date,
            COALESCE(cc.recount_completed, false) as recount_completed,
            COALESCE(cc.requires_recount, false) as requires_recount,
            cc.counter_name,
            cc.resolved_location_key, cc.resolved_zone, cc.resolved_aisle,
            cc.resolved_sequence::float8 as resolved_sequence, cc.resolution_source,
            cc.workflow_config_id,
            cc.workflow_config_version,
            COALESCE(cc.workflow_snapshot, '{}'::jsonb) as workflow_snapshot,
            COALESCE(cc.workflow_result, '{}'::jsonb) as workflow_result,
            cc.evidence_photo_urls,
            cc.review_threshold_pct::float8 as review_threshold_pct,
            cc.review_threshold_abs::float8 as review_threshold_abs,
            cc.scanned_material_number,
            cc.location_reported_empty,
            cc.part_variance,
            COALESCE(cc.scanned_parts, '[]'::jsonb) as scanned_parts,
            cc.transfer_destination_location,
            cc.transfer_source_quantity::float8 as transfer_source_quantity
        FROM cycle_count_operator_deferred_counts d
        JOIN rr_cyclecount_data cc ON cc.id = d.count_id
        WHERE d.user_id = $1
          AND d.organization_id = $2
          AND d.is_active = true
          AND cc.status IN ('pending', 'recount')
          AND cc.assigned_to IS NULL
        ORDER BY
            CASE cc.priority::text
                WHEN 'critical' THEN 1 WHEN 'hot' THEN 2
                WHEN 'normal' THEN 3   WHEN 'low' THEN 4
                ELSE 5
            END ASC,
            CASE WHEN cc.resolution_source = 'unresolved' OR cc.resolution_source IS NULL THEN 1 ELSE 0 END ASC,
            cc.resolved_zone ASC NULLS LAST,
            cc.resolved_aisle ASC NULLS LAST,
            cc.resolved_sequence ASC NULLS LAST,
            cc.location ASC,
            d.deferred_at ASC
        LIMIT 1
        "#,
    )
    .bind(user_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await
}

// ============================================================================
//  Generic dispatcher entry point (Item 12 — plan §2.1 + §2.5 + §2.6).
//
// `claim_next_task` is the single front door for every WorkType. The
// implementation policy:
//
//   * For `task_type = 'cycle_count'` it MUST call `claim_next_cycle_count`
//     verbatim — same FOR UPDATE SKIP LOCKED LIMIT 200, same Phase 1
//     already-assigned, same advisory locks via the migration-225
//     trigger, same path-rule + occupancy ranking. The strategy's
//     `filter_candidate` runs as a LATE filter on the returned task.
//     This preserves the 18 invariants from plan §2.1 byte-for-byte.
//
//   * For other task types (`zone_audit`, `pick`, future) it composes the
//     strategy's `static_sql().order_clause` against `work_tasks` filtered
//     to that task type. The base SELECT keeps zone-mutual-exclusion in
//     line with migration 266 (pre-filter; the trigger is the
//     authoritative guard).
//
// The capacity check enforced here is the SERVER's source of truth; any
// client-supplied capacity is clamped to it.
// ============================================================================

use crate::strategies::{
    CandidateDecision, DispatchStrategy, ResolvedWorkTypeSettings, StrategySqlFragments,
};
use std::sync::Arc;

/// Capacity envelope passed into `claim_next_task`. The server clamps
/// `requested_capacity` to BOTH the per-worker total cap from
/// `worker_profiles.max_concurrent_tasks` AND the per-type cap from
/// `work_type_settings.capacity_per_worker`.
#[derive(Clone, Copy, Debug, Default)]
pub struct ClaimCapacity {
    /// Optional client request — None means "use server defaults".
    pub requested_capacity: Option<u32>,
}

/// Resolve the effective capacity ceiling for (user, task_type). Returns the
/// LESSER of total-cap and per-type-cap so the client can never exceed
/// either bound.
async fn resolve_effective_capacity(
    pool: &PgPool,
    org_id: Uuid,
    user_id: Uuid,
    task_type: &str,
    settings_cap: u32,
    client_cap: Option<u32>,
) -> Result<u32, sqlx::Error> {
    // worker_profiles.max_concurrent_tasks default to 3 if missing per plan.
    let total_cap: i32 = sqlx::query_scalar(
        r#"SELECT COALESCE(max_concurrent_tasks, 3)
             FROM public.worker_profiles
            WHERE user_id = $1
            LIMIT 1"#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .unwrap_or(3);

    // Open work counts (the server's authoritative load measurement).
    let open_total: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)::bigint
             FROM public.work_tasks
            WHERE organization_id = $1
              AND assigned_to     = $2
              AND status IN ('claimed','in_progress')"#,
    )
    .bind(org_id)
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    let open_per_type: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)::bigint
             FROM public.work_tasks
            WHERE organization_id = $1
              AND assigned_to     = $2
              AND task_type       = $3
              AND status IN ('claimed','in_progress')"#,
    )
    .bind(org_id)
    .bind(user_id)
    .bind(task_type)
    .fetch_one(pool)
    .await?;

    let total_remaining = (total_cap as i64 - open_total).max(0) as u32;
    let per_type_remaining = (settings_cap as i64 - open_per_type).max(0) as u32;

    let server_remaining = total_remaining.min(per_type_remaining);
    let effective = client_cap
        .map(|c| c.min(server_remaining))
        .unwrap_or(server_remaining);
    Ok(effective)
}

/// Phase 0 helper for `claim_next_task` — read-only "return already-assigned"
/// cycle-count row for `(org, user)`. Mirrors Phase 1 of
/// `claim_next_cycle_count` (same SELECT, same `('pending','in_progress','recount')`
/// status set, same zone-collision filter, same priority/sticky-zone ORDER BY)
/// but runs on the pool instead of inside a transaction because it does NOT
/// mutate — the row is already assigned to this user. No advisory lock, no
/// FOR UPDATE, no UPDATE.
///
/// Used to bypass the capacity gate when the operator is resuming an in-flight
/// count after a refresh / re-open / session reconnect. See the long-form
/// rationale in `claim_next_task`'s "Phase 0" comment block.
async fn phase0_already_assigned_cycle_count(
    pool: &PgPool,
    org_id: Uuid,
    user_id: Uuid,
) -> Result<Option<CycleCountTask>, sqlx::Error> {
    sqlx::query_as::<_, CycleCountTask>(
        r#"
        SELECT
            id, count_number, material_number, material_description,
            location, warehouse,
            system_quantity::float8 as system_quantity,
            counted_quantity::float8 as counted_quantity,
            COALESCE(unit_of_measure, 'EA') as unit_of_measure,
            priority::text as priority, status::text as status,
            count_type::text as count_type,
            assigned_to, assigned_at,
            COALESCE(push_mode, 'pull') as push_mode,
            pushed_by, pushed_at,
            COALESCE(push_acknowledged, false) as push_acknowledged,
            organization_id,
            completed_at,
            recount_by,
            recount_date,
            COALESCE(recount_completed, false) as recount_completed,
            COALESCE(requires_recount, false) as requires_recount,
            counter_name,
            resolved_location_key, resolved_zone, resolved_aisle,
            resolved_sequence::float8 as resolved_sequence, resolution_source,
            workflow_config_id,
            workflow_config_version,
            COALESCE(workflow_snapshot, '{}'::jsonb) as workflow_snapshot,
            COALESCE(workflow_result, '{}'::jsonb) as workflow_result,
            evidence_photo_urls,
            review_threshold_pct::float8 as review_threshold_pct,
            review_threshold_abs::float8 as review_threshold_abs,
            scanned_material_number,
            location_reported_empty,
            part_variance,
            COALESCE(scanned_parts, '[]'::jsonb) as scanned_parts,
            transfer_destination_location,
            transfer_source_quantity::float8 as transfer_source_quantity
        FROM rr_cyclecount_data rcc
        WHERE rcc.organization_id = $1
          AND rcc.assigned_to = $2
          AND rcc.status IN ('pending', 'in_progress', 'recount')
          -- Same pattern-aware zone-collision filter as
          -- `claim_next_cycle_count` Phase 1 — never resume an operator
          -- into a zone now actively held by a DIFFERENT user. The
          -- migration-266 trigger is still the authoritative guard; this
          -- filter just avoids a wasted trip.
          AND NOT EXISTS (
            SELECT 1
            FROM cycle_count_zone_rules zr_p0
            WHERE zr_p0.organization_id = rcc.organization_id
              AND zr_p0.enabled = true
              AND zr_p0.policy = 'one_counter_per_zone'
              AND EXISTS (
                SELECT 1 FROM rr_cyclecount_data other
                WHERE other.organization_id = rcc.organization_id
                  AND COALESCE(public.cycle_count_zone_of(other.location, zr_p0.zone_pattern), other.zone)
                      = COALESCE(public.cycle_count_zone_of(rcc.location,   zr_p0.zone_pattern), rcc.zone)
                  AND other.assigned_to IS NOT NULL
                  AND other.assigned_to <> $2
                  AND other.status IN ('in_progress', 'recount')
                  AND other.id <> rcc.id
              )
          )
        ORDER BY
            CASE rcc.priority::text
                WHEN 'critical' THEN 1 WHEN 'hot' THEN 2
                WHEN 'normal' THEN 3   WHEN 'low' THEN 4
                ELSE 5
            END ASC,
            CASE rcc.status::text
              WHEN 'in_progress' THEN 0
              WHEN 'recount'     THEN 1
              ELSE 2
            END ASC,
            rcc.assigned_at ASC
        LIMIT 1
        "#,
    )
    .bind(org_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

/// Phase 0 helper for `claim_next_task` — read-only "return already-assigned"
/// row for non-cycle_count task types that live in `public.work_tasks`
/// (zone_audit, replenish, kit_pick, and any future capacity-gated generic
/// type). Mirrors the column projection of `generic_claim_against_work_tasks`'s
/// RETURNING clause exactly so callers receive the same `CycleCountTask`
/// shape they'd get from a fresh claim — only difference is no UPDATE / no
/// FOR UPDATE.
///
/// Scope of the status filter (`('claimed','in_progress')`) is intentionally
/// identical to `resolve_effective_capacity`'s count predicate so that:
/// every row that contributes to the capacity counter is also resumable via
/// Phase 0, and no row that contributes is silently locked.
///
/// Used to bypass the capacity gate when the operator is resuming an
/// in-flight task after a refresh / re-open / session reconnect — same
/// rationale as the cycle_count Phase 0. The migration-266 zone-exclusivity
/// trigger is the primary write-time guard; T-4 (2026-05-18) adds a
/// defense-in-depth zone-collision check at READ time so that an
/// administrative re-zoning post-claim (mig-266 is bypassable via the
/// `cycle_count_zone_lock_bypass` GUC) cannot resume an operator into a
/// dispatch_zone now actively held by a different user. If the operator's
/// own row's zone is contested, we return None and let the regular claim
/// path route them to a fresh candidate (which will run the full Phase 2
/// zone filter).
async fn phase0_already_assigned_generic(
    pool: &PgPool,
    org_id: Uuid,
    user_id: Uuid,
    task_type: &str,
) -> Result<Option<CycleCountTask>, sqlx::Error> {
    sqlx::query_as::<_, CycleCountTask>(
        r#"
        SELECT
          id,
          COALESCE(task_number, id::text) AS count_number,
          COALESCE(subject_material, '')  AS material_number,
          subject_description             AS material_description,
          COALESCE(primary_location, '')  AS location,
          warehouse,
          0::float8 AS system_quantity,
          NULL::float8 AS counted_quantity,
          COALESCE(unit_of_measure, 'EA') AS unit_of_measure,
          priority,
          status,
          task_type AS count_type,
          assigned_to,
          assigned_at,
          push_mode,
          pushed_by,
          pushed_at,
          push_acknowledged,
          organization_id,
          completed_at,
          NULL::text AS recount_by,
          NULL::date AS recount_date,
          false AS recount_completed,
          false AS requires_recount,
          NULL::text AS counter_name,
          NULL::text AS resolved_location_key,
          resolved_zone,
          resolved_aisle,
          resolved_sequence::float8 AS resolved_sequence,
          resolution_source,
          workflow_config_id,
          workflow_config_version,
          COALESCE(workflow_snapshot, '{}'::jsonb) AS workflow_snapshot,
          COALESCE(result_payload,    '{}'::jsonb) AS workflow_result,
          NULL::text[] AS evidence_photo_urls,
          NULL::float8 AS review_threshold_pct,
          NULL::float8 AS review_threshold_abs,
          NULL::text   AS scanned_material_number,
          NULL::boolean AS location_reported_empty,
          NULL::float8  AS part_variance,
          '[]'::jsonb   AS scanned_parts,
          NULL::text    AS transfer_destination_location,
          NULL::float8  AS transfer_source_quantity
        FROM public.work_tasks wt
        WHERE organization_id = $1
          AND assigned_to     = $2
          AND task_type       = $3
          AND status IN ('claimed', 'in_progress')
          AND deleted_at IS NULL
          -- T-4 (2026-05-18) defense-in-depth: don't resume into a
          -- dispatch_zone currently held by an ACTIVE claim from a
          -- different operator. Returning None here causes claim_next_task
          -- to fall through to the regular claim path, which runs the
          -- strategy's full zone filter against fresh candidates. NULL
          -- dispatch_zone rows are not contested (no zone to collide).
          -- Status set ('claimed','in_progress') intentionally excludes
          -- 'pending' soft-reservations so a stuck reservation doesn't
          -- block an operator's own resume — that's the F38/B2 territory.
          AND (
            wt.dispatch_zone IS NULL
            OR NOT EXISTS (
              SELECT 1
              FROM public.work_tasks held
              WHERE held.organization_id = wt.organization_id
                AND held.task_type       = wt.task_type
                AND held.dispatch_zone   = wt.dispatch_zone
                AND held.assigned_to IS NOT NULL
                AND held.assigned_to    <> $2
                AND held.status IN ('claimed', 'in_progress')
                AND held.deleted_at IS NULL
            )
          )
        ORDER BY
          CASE status
            WHEN 'in_progress' THEN 0
            WHEN 'claimed'     THEN 1
            ELSE 2
          END ASC,
          CASE priority
            WHEN 'critical' THEN 1
            WHEN 'hot'      THEN 2
            WHEN 'normal'   THEN 3
            WHEN 'low'      THEN 4
            ELSE 5
          END ASC,
          assigned_at ASC
        LIMIT 1
        "#,
    )
    .bind(org_id)
    .bind(user_id)
    .bind(task_type)
    .fetch_optional(pool)
    .await
}

/// Generic claim entry point. See module docs above for the policy.
///
/// Returns `Ok(None)` when:
///   - capacity is exhausted AND the operator has no already-assigned row, OR
///   - no eligible row exists, OR
///   - the strategy filters all returned candidates.
///
/// Errors propagate from sqlx as-is.
#[instrument(skip(pool, strategy))]
pub async fn claim_next_task(
    pool: &PgPool,
    org_id: Uuid,
    user_id: Uuid,
    task_type: &str,
    strategy: Arc<dyn DispatchStrategy>,
    settings: ResolvedWorkTypeSettings,
    capacity: ClaimCapacity,
) -> Result<Option<CycleCountTask>, sqlx::Error> {
    // ── Phase 0: return-already-assigned (no capacity gate) ──
    //
    // Resuming a row the operator already owns is a READ of state they
    // already hold, not a new CLAIM. It must run BEFORE the capacity gate
    // so that an operator who currently holds one in-flight task (and
    // therefore has `per_type_remaining = 0` against `capacity_per_worker = 1`)
    // can still be routed back to their own row after a refresh / re-open /
    // session reconnect.
    //
    // Dispatches per `task_type`:
    //   * `cycle_count` → `phase0_already_assigned_cycle_count` reads
    //     `rr_cyclecount_data` and mirrors Phase 1 of
    //     `claim_next_cycle_count` (same status set, same pattern-aware
    //     zone-collision filter).
    //   * everything else → `phase0_already_assigned_generic` reads
    //     `public.work_tasks` directly using the same status set as
    //     `resolve_effective_capacity` (`('claimed','in_progress')`) so the
    //     capacity gate and the resume path are always symmetric.
    //
    // Documented root cause:
    //   `memorybank/OmniFrame/Debug/Investigate-Work-Tasks-Capacity-Gate-Returning-Existing-Task.md` (2026-05-07)
    //   `memorybank/OmniFrame/Debug/Fix-RF-Cycle-Count-Stuck-Waiting.md` (2026-05-14)
    let phase0 = match task_type {
        "cycle_count" => phase0_already_assigned_cycle_count(pool, org_id, user_id).await?,
        _ => phase0_already_assigned_generic(pool, org_id, user_id, task_type).await?,
    };
    if let Some(existing) = phase0 {
        tracing::info!(
            user_id = %user_id,
            task_type = %task_type,
            count_id = %existing.id,
            status = %existing.status,
            push_mode = %existing.push_mode,
            "claim_next_task: Phase 0 returning already-assigned row (bypasses capacity gate)"
        );
        return Ok(Some(existing));
    }

    let effective_cap = resolve_effective_capacity(
        pool,
        org_id,
        user_id,
        task_type,
        settings.capacity_per_worker,
        capacity.requested_capacity,
    )
    .await?;

    if effective_cap == 0 {
        tracing::info!(
            user_id = %user_id,
            task_type = %task_type,
            "claim_next_task: capacity exhausted; returning None"
        );
        return Ok(None);
    }

    match task_type {
        "cycle_count" => {
            // Preserve all 18 invariants from §2.1 — call the existing
            // SQL path verbatim, then run the strategy's late filter.
            // Phase 0 above already covered the already-assigned branch,
            // so this call now operates as a pure new-claim path (Phase 2).
            let task = claim_next_cycle_count(pool, user_id, org_id).await?;
            if let Some(t) = task {
                // Build a minimal context for the strategy's filter — it only
                // needs settings + caps for the cycle_count gating logic.
                let ctx = crate::strategies::StrategyContext {
                    org_id,
                    user_id,
                    capabilities: vec![],
                    blocked: vec![],
                    zones: vec![],
                    settings,
                };
                match strategy.filter_candidate(&t, &ctx) {
                    CandidateDecision::Take => Ok(Some(t)),
                    CandidateDecision::Skip => {
                        tracing::info!(
                            user_id = %user_id,
                            task_type = %task_type,
                            count_id = %t.id,
                            "strategy filtered claimed cycle_count candidate post-claim"
                        );
                        // The legacy SQL already updated assigned_to. We
                        // intentionally don't auto-release here — the
                        // operator UI will surface "no work" and the
                        // scheduler's abandonment job will reclaim.
                        Ok(None)
                    }
                }
            } else {
                Ok(None)
            }
        }
        _ => generic_claim_against_work_tasks(pool, org_id, user_id, task_type, strategy).await,
    }
}

/// Generic claim path for non-cycle_count task types. Wraps a
/// FOR UPDATE SKIP LOCKED candidate scan with the strategy's static SQL
/// fragments. Returns `Ok(None)` when no eligible row exists.
///
/// The Cycle-Count path uses `rr_cyclecount_data`; everything else lives in
/// `work_tasks` directly.
async fn generic_claim_against_work_tasks(
    pool: &PgPool,
    org_id: Uuid,
    user_id: Uuid,
    task_type: &str,
    strategy: Arc<dyn DispatchStrategy>,
) -> Result<Option<CycleCountTask>, sqlx::Error> {
    // The strategy SQL fragments live in `static_sql()`. extra_where /
    // order_clause are STATIC strings owned by the strategy code; they are
    // NEVER user-supplied. Plan §2.5 / §2.6 contract.
    let StrategySqlFragments {
        extra_where,
        order_clause,
    } = strategy.static_sql();

    let extra_where_sql = if extra_where.trim().is_empty() {
        String::new()
    } else {
        format!(" AND {}", extra_where)
    };
    let order_clause_sql = if order_clause.trim().is_empty() {
        String::new()
    } else {
        format!(", {}", order_clause)
    };

    // Compose a placeholder-only candidate query. Parameters: $1 = org_id,
    // $2 = task_type, $3 = user_id (used by the zone-occupancy NOT EXISTS).
    //
    // Fields selected mirror `CycleCountTask` for now so the response
    // envelope stays uniform across task types until the typed
    // task-payload work in plan §2.7 lands. NULLs for cycle_count-only
    // columns are explicit so the FromRow decoder doesn't reject the row.
    let sql = format!(
        r#"
        WITH candidate AS (
          SELECT id
            FROM public.work_tasks
           WHERE organization_id = $1
             AND task_type       = $2
             AND status          = 'pending'
             AND assigned_to IS NULL
             AND deleted_at IS NULL
             -- Zone occupancy pre-filter (mig 266 trigger is the
             -- authoritative guard; this just keeps Pull-Next fast).
             AND (
               dispatch_zone IS NULL
               OR NOT EXISTS (
                 SELECT 1 FROM public.work_tasks held
                  WHERE held.organization_id = work_tasks.organization_id
                    AND held.dispatch_zone   = work_tasks.dispatch_zone
                    AND held.assigned_to IS NOT NULL
                    AND held.assigned_to <> $3
                    AND held.status IN ('claimed','in_progress')
               )
             )
             {extra_where}
           ORDER BY
             CASE priority
               WHEN 'critical' THEN 1
               WHEN 'hot'      THEN 2
               WHEN 'normal'   THEN 3
               WHEN 'low'      THEN 4
               ELSE 5
             END ASC{order_clause},
             created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 200
        )
        UPDATE public.work_tasks
           SET assigned_to = $3,
               assigned_at = NOW(),
               status      = 'claimed',
               claimed_at  = NOW(),
               updated_at  = NOW()
         WHERE id = (SELECT id FROM candidate LIMIT 1)
        RETURNING
          id,
          COALESCE(task_number, id::text) AS count_number,
          COALESCE(subject_material, '')  AS material_number,
          subject_description             AS material_description,
          COALESCE(primary_location, '')  AS location,
          warehouse,
          0::float8 AS system_quantity,
          NULL::float8 AS counted_quantity,
          COALESCE(unit_of_measure, 'EA') AS unit_of_measure,
          priority,
          status,
          task_type AS count_type,
          assigned_to,
          assigned_at,
          push_mode,
          pushed_by,
          pushed_at,
          push_acknowledged,
          organization_id,
          completed_at,
          NULL::text AS recount_by,
          NULL::date AS recount_date,
          false AS recount_completed,
          false AS requires_recount,
          NULL::text AS counter_name,
          NULL::text AS resolved_location_key,
          resolved_zone,
          resolved_aisle,
          resolved_sequence::float8 AS resolved_sequence,
          resolution_source,
          workflow_config_id,
          workflow_config_version,
          COALESCE(workflow_snapshot, '{{}}'::jsonb) AS workflow_snapshot,
          COALESCE(result_payload,    '{{}}'::jsonb) AS workflow_result,
          NULL::text[] AS evidence_photo_urls,
          NULL::float8 AS review_threshold_pct,
          NULL::float8 AS review_threshold_abs,
          NULL::text   AS scanned_material_number,
          NULL::boolean AS location_reported_empty,
          NULL::float8  AS part_variance,
          '[]'::jsonb   AS scanned_parts,
          NULL::text    AS transfer_destination_location,
          NULL::float8  AS transfer_source_quantity
        "#,
        extra_where = extra_where_sql,
        order_clause = order_clause_sql,
    );

    sqlx::query_as::<_, CycleCountTask>(&sql)
        .bind(org_id)
        .bind(task_type)
        .bind(user_id)
        .fetch_optional(pool)
        .await
}

/// T-3 (2026-05-18) — for an org's cycle_count surface, return:
///   (unassigned_pending, stuck_pending_assigned)
///   = (rows ready to claim, rows occupying a zone via stale soft-reservation)
///
/// Used by `routes::work::claim_next` to decide whether to emit a
/// `WsEvent::ClaimBlockedByZone` canary when the claim path returns None.
/// We only care about the cycle_count surface today because that's where
/// the cascade has been observed; generic types live in `work_tasks` and
/// have a different surface (see F5 in
/// `ADR-Work-Distribution-Pipeline-Architecture-Review-2026-05-18`).
pub async fn count_unassigned_and_stuck_pending(
    pool: &PgPool,
    org_id: Uuid,
) -> Result<(i64, i64), sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT
          (SELECT count(*) FROM rr_cyclecount_data
            WHERE organization_id = $1
              AND status = 'pending'
              AND assigned_to IS NULL)::bigint AS unassigned,
          (SELECT count(*) FROM rr_cyclecount_data
            WHERE organization_id = $1
              AND status = 'pending'
              AND assigned_to IS NOT NULL)::bigint AS stuck
        "#,
    )
    .bind(org_id)
    .fetch_one(pool)
    .await?;

    Ok((row.get::<i64, _>("unassigned"), row.get::<i64, _>("stuck")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn priority_rank_orders_buckets() {
        assert!(priority_rank("critical") < priority_rank("hot"));
        assert!(priority_rank("hot") < priority_rank("normal"));
        assert!(priority_rank("normal") < priority_rank("low"));
        assert!(priority_rank("low") < priority_rank("unknown"));
    }

    #[test]
    fn sticky_rank_prefers_worker_current_aisle() {
        // A candidate in the worker's sticky aisle ranks ahead (0) of one that
        // is not (1) — this is what keeps a worker linear down their aisle.
        assert_eq!(sticky_rank(Some("SM"), Some("SM")), 0);
        assert_eq!(sticky_rank(Some("SH"), Some("SM")), 1);
    }

    #[test]
    fn sticky_rank_is_noop_without_sticky_aisle() {
        // sticky disabled / unknown current aisle => every candidate ranks
        // equally, so the global serpentine order is untouched.
        assert_eq!(sticky_rank(Some("SM"), None), 1);
        assert_eq!(sticky_rank(None, None), 1);
        assert_eq!(sticky_rank(None, Some("SM")), 1);
        // an empty sticky aisle must never match (guards against blank zones).
        assert_eq!(sticky_rank(Some(""), Some("")), 1);
    }

    #[test]
    fn sticky_rank_sorts_worker_aisle_first() {
        // Among equal-priority candidates, the worker's aisle sorts to the top.
        let sticky = Some("SM");
        let mut aisles = vec!["SH", "SM", "SN"];
        aisles.sort_by(|a, b| {
            sticky_rank(Some(a), sticky).cmp(&sticky_rank(Some(b), sticky))
        });
        assert_eq!(aisles[0], "SM");
    }
}

// Created and developed by Jai Singh
