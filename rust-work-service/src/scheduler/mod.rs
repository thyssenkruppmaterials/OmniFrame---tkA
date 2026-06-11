// Created and developed by Jai Singh
//! Background job scheduler for rust-work-service
//!
//! Provides four scheduled background jobs:
//! - Abandonment detection: Releases tasks stuck in_progress past the per-org
//!   `abandonment_minutes` (defaults to 30; see migration 311 / T-5).
//! - Queue stats broadcast: Sends queue statistics every 30 seconds.
//! - Worker cleanup: Marks stale workers as offline.
//! - Stale-reservation escalation: Hard-unassigns rows stuck pending+assigned
//!   past the per-org `reservation_escalation_minutes` (defaults to 60; see
//!   migration 311 / T-2). 311 also widens the heartbeat guard to treat
//!   idle/break/offline as inactive (B2 from
//!   ADR-Cycle-Count-Soft-Reservation-Cascade-Mitigation).

use sqlx::{PgPool, Row};
use tokio::sync::broadcast;
use tokio_cron_scheduler::{Job, JobScheduler};
use uuid::Uuid;

use crate::websocket::WsEvent;

/// Start the background scheduler with all jobs.
///
/// Takes two pools so read-only jobs can offload to the replica while the
/// reaper jobs (which call SECURITY DEFINER functions that perform writes)
/// stay on the primary. `read_pool` is a clone of `pool` when the operator
/// has not configured a separate replica URL, so call sites stay uniform.
pub async fn start_scheduler(
    pool: PgPool,
    read_pool: PgPool,
    ws_tx: broadcast::Sender<WsEvent>,
) -> anyhow::Result<()> {
    let scheduler = JobScheduler::new().await?;

    // Abandonment detection - every 5 minutes. WRITES (calls
    // release_stale_heartbeat_assignments + inline UPDATE) — primary only.
    let pool_clone = pool.clone();
    let tx_clone = ws_tx.clone();
    scheduler
        .add(Job::new_async("0 */5 * * * *", move |_uuid, _lock| {
            let pool = pool_clone.clone();
            let tx = tx_clone.clone();
            Box::pin(async move {
                if let Err(e) = detect_and_release_abandoned(&pool, &tx).await {
                    tracing::error!("Abandonment detection failed: {}", e);
                }
            })
        })?)
        .await?;

    // Queue stats broadcast - every 30 seconds. Pure aggregation, no writes
    // — routes through the read replica when configured.
    let read_pool_clone = read_pool.clone();
    let tx_clone = ws_tx.clone();
    scheduler
        .add(Job::new_async("*/30 * * * * *", move |_uuid, _lock| {
            let pool = read_pool_clone.clone();
            let tx = tx_clone.clone();
            Box::pin(async move {
                if let Err(e) = broadcast_queue_stats(&pool, &tx).await {
                    tracing::error!("Queue stats broadcast failed: {}", e);
                }
            })
        })?)
        .await?;

    // Worker status cleanup - every 1 minute
    let pool_clone = pool.clone();
    scheduler
        .add(Job::new_async("0 * * * * *", move |_uuid, _lock| {
            let pool = pool_clone.clone();
            Box::pin(async move {
                if let Err(e) = cleanup_stale_workers(&pool).await {
                    tracing::error!("Worker cleanup failed: {}", e);
                }
            })
        })?)
        .await?;

    // Stale-reservation escalation (migration 232) - every 5 minutes.
    // After an auto-release keeps `assigned_to` so the original assignee
    // retains priority, we eventually need to free the zone if the
    // operator doesn't come back. Threshold is 60 minutes.
    let pool_clone = pool.clone();
    let tx_clone = ws_tx.clone();
    scheduler
        .add(Job::new_async("30 */5 * * * *", move |_uuid, _lock| {
            let pool = pool_clone.clone();
            let tx = tx_clone.clone();
            Box::pin(async move {
                if let Err(e) = escalate_stale_reservations(&pool, &tx).await {
                    tracing::error!("Reservation escalation failed: {}", e);
                }
            })
        })?)
        .await?;

    scheduler.start().await?;
    tracing::info!("Background scheduler started with 4 jobs: abandonment detection (5min), queue stats (30s), worker cleanup (1min), reservation escalation (5min)");

    Ok(())
}

/// Per-org tunables fetched once per scheduler tick. Each row drives all
/// three reapers for that org. Orgs without a `work_type_settings` row for
/// `cycle_count` fall back to the legacy defaults (60/30/10) via COALESCE.
struct OrgReaperSettings {
    org_id: Uuid,
    reservation_escalation_minutes: i32,
    abandonment_minutes: i32,
    heartbeat_release_minutes: i32,
}

/// Fetch every org with cycle-count data, joined to its per-org tunables
/// (or defaults if no row in `work_type_settings`). T-2 / T-5: closes F18,
/// F20, F21 from ADR-Work-Distribution-Pipeline-Architecture-Review.
async fn fetch_org_reaper_settings(
    pool: &PgPool,
) -> Result<Vec<OrgReaperSettings>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        SELECT DISTINCT
          rcc.organization_id                              AS org_id,
          COALESCE(wts.reservation_escalation_minutes, 60) AS esc_min,
          COALESCE(wts.abandonment_minutes, 30)            AS abandon_min,
          COALESCE(wts.heartbeat_release_minutes, 10)      AS hb_min
        FROM rr_cyclecount_data rcc
        LEFT JOIN work_type_settings wts
          ON wts.organization_id = rcc.organization_id
         AND wts.task_type = 'cycle_count'
        WHERE rcc.organization_id IS NOT NULL
        "#,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| OrgReaperSettings {
            org_id: r.get("org_id"),
            reservation_escalation_minutes: r.get("esc_min"),
            abandonment_minutes: r.get("abandon_min"),
            heartbeat_release_minutes: r.get("hb_min"),
        })
        .collect())
}

/// Hard-unassign rows that have been sitting in `pending + assigned_to` for
/// longer than the per-org threshold. Keeps zones from being indefinitely
/// reserved by an operator who isn't coming back (migration 232 + 233; 311
/// added per-org filter + idle-status-aware heartbeat guard).
async fn escalate_stale_reservations(
    pool: &PgPool,
    tx: &broadcast::Sender<WsEvent>,
) -> anyhow::Result<()> {
    let orgs = fetch_org_reaper_settings(pool).await?;

    if orgs.is_empty() {
        // No CC data in the system right now — call with NULL org filter
        // + legacy 60-min default to preserve historical behavior. The
        // migration-311 function handles NULL p_organization_id by
        // running across all orgs.
        run_escalator_once(pool, tx, None, 60).await?;
        return Ok(());
    }

    for s in orgs {
        run_escalator_once(
            pool,
            tx,
            Some(s.org_id),
            s.reservation_escalation_minutes,
        )
        .await?;
    }

    Ok(())
}

/// Single per-org escalator invocation. Pulled out so the call-side can
/// stay readable. Threshold + org_id are wired through to migration 311's
/// two-arg function signature.
async fn run_escalator_once(
    pool: &PgPool,
    tx: &broadcast::Sender<WsEvent>,
    org_id: Option<Uuid>,
    threshold_min: i32,
) -> anyhow::Result<()> {
    let rows = sqlx::query(
        r#"
        SELECT out_count_id AS id,
               out_count_number AS count_number,
               out_previous_owner AS previous_owner
        FROM public.escalate_stale_zone_reservations($1, $2)
        "#,
    )
    .bind(threshold_min)
    .bind(org_id)
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        return Ok(());
    }

    tracing::info!(
        "Escalated {} stale zone reservations to hard-unassign (org={:?}, threshold={}m)",
        rows.len(),
        org_id,
        threshold_min,
    );

    for row in &rows {
        let id: Uuid = row.get("id");
        let count_number: String = row.get("count_number");
        let previous_owner: Uuid = row.get("previous_owner");

        // When the org filter was set we already know the org; otherwise
        // (legacy NULL path) look it up so the WS event stays org-scoped.
        let org: Option<Uuid> = match org_id {
            Some(o) => Some(o),
            None => sqlx::query_scalar(
                "SELECT organization_id FROM rr_cyclecount_data WHERE id = $1",
            )
            .bind(id)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten(),
        };

        tracing::info!(
            "Escalated reservation: {} ({}) → general queue (org={:?}, threshold={}m)",
            count_number, id, org, threshold_min
        );
        let _ = crate::websocket::broadcast_event(
            tx,
            WsEvent::ReservationEscalated {
                task_id: id,
                previous_owner,
                organization_id: org,
            },
        );
    }

    Ok(())
}

/// Row type for abandoned count release results
struct ReleasedCount {
    id: Uuid,
    count_number: String,
    organization_id: Option<Uuid>,
}

/// Detect and release cycle counts that have been in_progress longer than
/// the per-org `abandonment_minutes` (default 30 — migration 230 / 231) OR
/// whose owner hasn't pinged the heartbeats table for longer than the
/// per-org `heartbeat_release_minutes` (default 10 — migration 230 / 233 /
/// 311). T-5: closes F20 + F21 from the architecture review by reading
/// per-org tunables from `work_type_settings` instead of hardcoded 30/10.
async fn detect_and_release_abandoned(
    pool: &PgPool,
    tx: &broadcast::Sender<WsEvent>,
) -> anyhow::Result<()> {
    let orgs = fetch_org_reaper_settings(pool).await?;

    if orgs.is_empty() {
        // No CC data in the system → preserve legacy whole-org behavior
        // with default thresholds.
        run_abandonment_once(pool, tx, None, 30, 10).await?;
        return Ok(());
    }

    for s in orgs {
        run_abandonment_once(
            pool,
            tx,
            Some(s.org_id),
            s.abandonment_minutes,
            s.heartbeat_release_minutes,
        )
        .await?;
    }

    Ok(())
}

/// Single per-org abandonment + heartbeat-release invocation. Path 1 (stale
/// `assigned_at`) stays inline SQL; Path 2 (stale heartbeat) calls
/// migration-311's two-arg function with per-org args.
async fn run_abandonment_once(
    pool: &PgPool,
    tx: &broadcast::Sender<WsEvent>,
    org_id: Option<Uuid>,
    abandon_min: i32,
    hb_min: i32,
) -> anyhow::Result<()> {
    // Path 1: stale updated_at — soft release in_progress > abandon_min.
    // Keeps `assigned_to` so the original assignee retains priority on
    // their next Pull Next (migration 231).
    let stale_rows = sqlx::query(
        r#"
        UPDATE rr_cyclecount_data
        SET
            status = 'pending',
            push_mode = 'pull',
            pushed_by = NULL,
            pushed_at = NULL,
            push_acknowledged = false,
            notes = COALESCE(notes, '') ||
                    ' [Auto-released: abandoned after ' || $1::text ||
                    ' minutes — reserved for assignee]',
            updated_at = NOW()
        WHERE status = 'in_progress'
          AND assigned_at < now() - make_interval(mins => $1)
          AND ($2::uuid IS NULL OR organization_id = $2)
        RETURNING id, count_number, organization_id
        "#,
    )
    .bind(abandon_min)
    .bind(org_id)
    .fetch_all(pool)
    .await?;

    // Path 2: stale heartbeat (migration 230 + 233 + 311). The SECURITY
    // DEFINER function bypasses the zone trigger, so releases don't trip
    // our own exclusivity enforcement. Migration 311 added per-org filter.
    let stale_hb_rows = sqlx::query(
        r#"
        SELECT r.out_count_id AS id,
               r.out_count_number AS count_number,
               cc.organization_id AS organization_id
        FROM public.release_stale_heartbeat_assignments($1, $2) r
        JOIN rr_cyclecount_data cc ON cc.id = r.out_count_id
        "#,
    )
    .bind(hb_min)
    .bind(org_id)
    .fetch_all(pool)
    .await?;

    let released: Vec<ReleasedCount> = stale_rows
        .iter()
        .chain(stale_hb_rows.iter())
        .map(|row| ReleasedCount {
            id: row.get("id"),
            count_number: row.get("count_number"),
            organization_id: row.get::<Option<Uuid>, _>("organization_id"),
        })
        .collect();

    if released.is_empty() {
        return Ok(());
    }

    tracing::info!(
        "Released {} abandoned cycle counts back to queue (org={:?}, abandon={}m, hb={}m): {} stale updated_at, {} stale heartbeat",
        released.len(),
        org_id,
        abandon_min,
        hb_min,
        stale_rows.len(),
        stale_hb_rows.len(),
    );

    for row in released {
        tracing::info!("Released abandoned count: {}", row.count_number);
        let _ = crate::websocket::broadcast_event(
            tx,
            WsEvent::TaskStatusChanged {
                task_id: row.id,
                old_status: "in_progress".to_string(),
                new_status: "pending".to_string(),
                reason: Some("auto_release".to_string()),
                organization_id: row.organization_id,
            },
        );
    }

    Ok(())
}

/// Broadcast queue statistics, ORG-SCOPED.
///
/// Migration 253 review: previously the scheduler used its own SQL whose
/// predicates diverged from the REST `get_queue_stats` endpoint —
/// scheduler counted `pending` as ALL pending rows (including reserved
/// with assignee), REST counted only `assigned_to IS NULL` pending;
/// scheduler counted `completed_today` by `status='completed' AND
/// completed_at >= CURRENT_DATE`, REST counted `status IN
/// ('completed','approved') AND updated_at::date = CURRENT_DATE`; and
/// the WS event was missing `pushed_pending` + `total_workers_online`
/// entirely. Same numbers must come out of REST and the WS event.
///
/// The single per-org aggregate below mirrors `get_queue_stats` 1:1.
async fn broadcast_queue_stats(
    pool: &PgPool,
    tx: &broadcast::Sender<WsEvent>,
) -> anyhow::Result<()> {
    let rows = sqlx::query(
        r#"
        WITH orgs AS (
            -- Cover every org with cycle-count data OR an active worker;
            -- otherwise an org with no CC rows but online workers
            -- silently disappears from the broadcast.
            SELECT organization_id FROM rr_cyclecount_data
            UNION
            SELECT organization_id FROM worker_heartbeats
              WHERE last_heartbeat >= NOW() - INTERVAL '5 minutes'
        )
        SELECT
            o.organization_id AS organization_id,
            (SELECT COUNT(*) FROM rr_cyclecount_data
             WHERE organization_id = o.organization_id
               AND status IN ('pending','recount')
               AND assigned_to IS NULL
               AND id NOT IN (
                 SELECT count_id FROM cycle_count_operator_deferred_counts
                 WHERE organization_id = o.organization_id AND is_active = true
               ))::bigint AS pending,
            (SELECT COUNT(*) FROM cycle_count_operator_deferred_counts
             WHERE organization_id = o.organization_id AND is_active = true)::bigint AS deferred_pending,
            (SELECT COUNT(*) FROM rr_cyclecount_data
             WHERE organization_id = o.organization_id
               AND status = 'in_progress')::bigint AS in_progress,
            (SELECT COUNT(*) FROM rr_cyclecount_data
             WHERE organization_id = o.organization_id
               AND status IN ('completed','approved')
               AND updated_at::date = CURRENT_DATE)::bigint AS completed_today,
            (SELECT COUNT(*) FROM rr_cyclecount_data
             WHERE organization_id = o.organization_id
               AND push_mode = 'push'
               AND push_acknowledged = false
               AND status IN ('pending','in_progress'))::bigint AS pushed_pending,
            (SELECT COUNT(*) FROM worker_heartbeats
             WHERE organization_id = o.organization_id
               AND last_heartbeat >= NOW() - INTERVAL '5 minutes')::bigint AS total_workers_online
        FROM orgs o
        WHERE o.organization_id IS NOT NULL
        "#,
    )
    .fetch_all(pool)
    .await?;

    for row in rows {
        let organization_id: Option<Uuid> = row.get::<Option<Uuid>, _>("organization_id");
        let pending: i64 = row.get("pending");
        let deferred_pending: i64 = row.get("deferred_pending");
        let in_progress: i64 = row.get("in_progress");
        let completed_today: i64 = row.get("completed_today");
        let pushed_pending: i64 = row.get("pushed_pending");
        let total_workers_online: i64 = row.get("total_workers_online");

        let _ = crate::websocket::broadcast_event(
            tx,
            WsEvent::QueueStatsUpdated {
                pending,
                deferred_pending,
                in_progress,
                completed_today,
                pushed_pending,
                total_workers_online,
                organization_id,
            },
        );

        tracing::debug!(
            "Broadcast queue stats org={:?}: pending={}, deferred_pending={}, in_progress={}, completed_today={}, pushed_pending={}, total_workers_online={}",
            organization_id,
            pending,
            deferred_pending,
            in_progress,
            completed_today,
            pushed_pending,
            total_workers_online,
        );
    }

    Ok(())
}

/// Cleanup stale workers by marking them as offline
async fn cleanup_stale_workers(pool: &PgPool) -> anyhow::Result<()> {
    // Mark workers as offline if no heartbeat in 5 minutes
    let result = sqlx::query(
        r#"
        UPDATE worker_heartbeats
        SET status = 'offline',
            updated_at = NOW()
        WHERE last_heartbeat < now() - INTERVAL '5 minutes'
          AND status != 'offline'
        "#
    )
    .execute(pool)
    .await?;

    if result.rows_affected() > 0 {
        tracing::info!(
            "Marked {} stale workers as offline",
            result.rows_affected()
        );
    }

    Ok(())
}

// Created and developed by Jai Singh
