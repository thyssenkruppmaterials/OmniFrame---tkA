//! Background job scheduler for rust-work-service
//!
//! Provides scheduled background jobs for:
//! - Abandonment detection: Releases tasks stuck in_progress for >30 minutes
//! - Queue stats broadcast: Sends queue statistics every 30 seconds
//! - Worker cleanup: Marks stale workers as offline

use sqlx::{PgPool, Row};
use tokio::sync::broadcast;
use tokio_cron_scheduler::{Job, JobScheduler};
use uuid::Uuid;

use crate::websocket::WsEvent;

/// Start the background scheduler with all jobs
pub async fn start_scheduler(
    pool: PgPool,
    ws_tx: broadcast::Sender<WsEvent>,
) -> anyhow::Result<()> {
    let scheduler = JobScheduler::new().await?;

    // Abandonment detection - every 5 minutes
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

    // Queue stats broadcast - every 30 seconds
    let pool_clone = pool.clone();
    let tx_clone = ws_tx.clone();
    scheduler
        .add(Job::new_async("*/30 * * * * *", move |_uuid, _lock| {
            let pool = pool_clone.clone();
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

    scheduler.start().await?;
    tracing::info!("Background scheduler started with 3 jobs: abandonment detection (5min), queue stats (30s), worker cleanup (1min)");

    Ok(())
}

/// Row type for abandoned count release results
struct ReleasedCount {
    id: Uuid,
    count_number: String,
}

/// Detect and release cycle counts that have been in_progress for > 30 minutes
async fn detect_and_release_abandoned(
    pool: &PgPool,
    tx: &broadcast::Sender<WsEvent>,
) -> anyhow::Result<()> {
    // Release counts that have been in_progress for > 30 minutes
    let rows = sqlx::query(
        r#"
        UPDATE rr_cyclecount_data
        SET 
            assigned_to = NULL,
            assigned_at = NULL,
            status = 'pending',
            notes = COALESCE(notes, '') || ' [Auto-released: abandoned after 30 minutes]',
            updated_at = NOW()
        WHERE status = 'in_progress'
          AND assigned_at < now() - INTERVAL '30 minutes'
        RETURNING id, count_number
        "#
    )
    .fetch_all(pool)
    .await?;

    let released: Vec<ReleasedCount> = rows
        .iter()
        .map(|row| ReleasedCount {
            id: row.get("id"),
            count_number: row.get("count_number"),
        })
        .collect();

    if !released.is_empty() {
        tracing::info!(
            "Released {} abandoned cycle counts back to queue",
            released.len()
        );

        for row in released {
            tracing::info!("Released abandoned count: {}", row.count_number);
            let _ = tx.send(WsEvent::TaskStatusChanged {
                task_id: row.id,
                old_status: "in_progress".to_string(),
                new_status: "pending".to_string(),
            });
        }
    }

    Ok(())
}

/// Broadcast global queue statistics
async fn broadcast_queue_stats(
    pool: &PgPool,
    tx: &broadcast::Sender<WsEvent>,
) -> anyhow::Result<()> {
    // Get queue stats and broadcast
    let row = sqlx::query(
        r#"
        SELECT 
            COUNT(*) FILTER (WHERE status = 'pending')::bigint as pending,
            COUNT(*) FILTER (WHERE status = 'in_progress')::bigint as in_progress,
            COUNT(*) FILTER (WHERE status = 'completed' AND completed_at >= CURRENT_DATE)::bigint as completed_today
        FROM rr_cyclecount_data
        "#
    )
    .fetch_one(pool)
    .await?;

    let pending: i64 = row.get("pending");
    let in_progress: i64 = row.get("in_progress");
    let completed_today: i64 = row.get("completed_today");

    let _ = tx.send(WsEvent::QueueStatsUpdated {
        pending,
        in_progress,
        completed_today,
    });

    tracing::debug!(
        "Broadcast queue stats: pending={}, in_progress={}, completed_today={}",
        pending,
        in_progress,
        completed_today
    );

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
