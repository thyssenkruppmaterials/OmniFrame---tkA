//! Database query functions for work management
//!
//! Optimized queries for work queue operations using sqlx.

use super::models::{CycleCountTask, QueueStats, WorkerStatus};
use sqlx::{PgPool, Row};
use tracing::instrument;
use uuid::Uuid;

/// Get pending cycle counts for an organization
#[instrument(skip(pool))]
pub async fn get_pending_cycle_counts(
    pool: &PgPool,
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
            organization_id
        FROM rr_cyclecount_data
        WHERE organization_id = $1
          AND status = 'pending'
          AND (assigned_to IS NULL OR push_mode = 'push')
        ORDER BY 
            CASE priority::text 
                WHEN 'critical' THEN 1
                WHEN 'hot' THEN 2  
                WHEN 'normal' THEN 3
                WHEN 'low' THEN 4
                ELSE 5
            END ASC,
            created_at ASC
        LIMIT 100
        "#,
    )
    .bind(org_id)
    .fetch_all(pool)
    .await
}

/// Get queue statistics for an organization
#[instrument(skip(pool))]
pub async fn get_queue_stats(pool: &PgPool, org_id: Uuid) -> Result<QueueStats, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT
            (SELECT COUNT(*) FROM rr_cyclecount_data 
             WHERE organization_id = $1 AND status = 'pending')::bigint as pending,
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
    .fetch_one(pool)
    .await?;

    Ok(QueueStats {
        pending: row.get::<i64, _>("pending"),
        in_progress: row.get::<i64, _>("in_progress"),
        completed_today: row.get::<i64, _>("completed_today"),
        pushed_pending: row.get::<i64, _>("pushed_pending"),
        total_workers_online: row.get::<i64, _>("total_workers_online"),
    })
}

/// Atomically claim the next available cycle count using FOR UPDATE SKIP LOCKED
#[instrument(skip(pool))]
pub async fn claim_next_cycle_count(
    pool: &PgPool,
    user_id: Uuid,
    org_id: Uuid,
) -> Result<Option<CycleCountTask>, sqlx::Error> {
    // Use a transaction for atomic claim
    let mut tx = pool.begin().await?;

    // Find and lock the next available count
    let count = sqlx::query_as::<_, CycleCountTask>(
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
            organization_id
        FROM rr_cyclecount_data
        WHERE organization_id = $1
          AND status IN ('pending', 'recount')
          AND assigned_to IS NULL
        ORDER BY 
            CASE priority::text 
                WHEN 'critical' THEN 1
                WHEN 'hot' THEN 2  
                WHEN 'normal' THEN 3
                WHEN 'low' THEN 4
                ELSE 5
            END ASC,
            created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
        "#,
    )
    .bind(org_id)
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(ref task) = count {
        // Get user's name for the counter_name field
        let user_name: Option<String> = sqlx::query_scalar(
            "SELECT full_name FROM user_profiles WHERE id = $1"
        )
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await?
        .flatten();

        // Update to assign the count
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
            "#,
        )
        .bind(user_id)
        .bind(task.id)
        .bind(user_name.unwrap_or_else(|| "RF User".to_string()))
        .execute(&mut *tx)
        .await?;

        // Fetch the updated task
        let updated_task = sqlx::query_as::<_, CycleCountTask>(
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
            organization_id
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

    tx.commit().await?;
    Ok(None)
}

/// Push a cycle count to a specific user
#[instrument(skip(pool))]
pub async fn push_cycle_count(
    pool: &PgPool,
    count_id: Uuid,
    user_id: Uuid,
    pushed_by: Uuid,
) -> Result<Option<CycleCountTask>, sqlx::Error> {
    let mut tx = pool.begin().await?;

    // Lock the count
    let existing = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT id FROM rr_cyclecount_data
        WHERE id = $1 AND status = 'pending'
        FOR UPDATE SKIP LOCKED
        "#,
    )
    .bind(count_id)
    .fetch_optional(&mut *tx)
    .await?;

    if existing.is_none() {
        tx.rollback().await?;
        return Ok(None);
    }

    // Get target user's name
    let user_name: Option<String> = sqlx::query_scalar(
        "SELECT full_name FROM user_profiles WHERE id = $1"
    )
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?
    .flatten();

    // Push the count to the user
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
            updated_at = NOW()
        WHERE id = $3
        "#,
    )
    .bind(user_id)
    .bind(pushed_by)
    .bind(count_id)
    .bind(user_name.unwrap_or_else(|| "Assigned User".to_string()))
    .execute(&mut *tx)
    .await?;

    // Fetch the updated task
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
            organization_id
        FROM rr_cyclecount_data
        WHERE id = $1
        "#,
    )
    .bind(count_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(Some(task))
}

/// Start a cycle count (mark as in_progress)
#[instrument(skip(pool))]
pub async fn start_cycle_count(
    pool: &PgPool,
    count_id: Uuid,
    user_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE rr_cyclecount_data
        SET 
            status = 'in_progress',
            updated_at = NOW()
        WHERE id = $1 
          AND assigned_to = $2
          AND status = 'pending'
        "#,
    )
    .bind(count_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Complete a cycle count with the counted quantity
#[instrument(skip(pool))]
pub async fn complete_cycle_count(
    pool: &PgPool,
    count_id: Uuid,
    user_id: Uuid,
    counted_qty: f64,
    notes: Option<String>,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE rr_cyclecount_data
        SET 
            status = 'completed',
            counted_quantity = $3,
            variance_quantity = $3 - system_quantity,
            variance_percentage = CASE 
                WHEN system_quantity > 0 THEN ABS($3 - system_quantity) / system_quantity * 100
                ELSE 0
            END,
            notes = COALESCE($4, notes),
            count_date = CURRENT_DATE,
            count_time = CURRENT_TIME,
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = $1 
          AND assigned_to = $2
          AND status = 'in_progress'
        "#,
    )
    .bind(count_id)
    .bind(user_id)
    .bind(counted_qty)
    .bind(notes)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Release a cycle count back to the queue
#[instrument(skip(pool))]
pub async fn release_cycle_count(pool: &PgPool, count_id: Uuid) -> Result<bool, sqlx::Error> {
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
          AND status IN ('pending', 'in_progress')
        "#,
    )
    .bind(count_id)
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
          AND push_mode = 'push'
          AND push_acknowledged = FALSE
        "#,
    )
    .bind(count_id)
    .bind(user_id)
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
            organization_id
        FROM rr_cyclecount_data
        WHERE assigned_to = $1
          AND status IN ('pending', 'in_progress')
        ORDER BY 
            CASE priority::text 
                WHEN 'critical' THEN 1
                WHEN 'hot' THEN 2  
                WHEN 'normal' THEN 3
                WHEN 'low' THEN 4
                ELSE 5
            END ASC,
            pushed_at DESC NULLS LAST,
            assigned_at ASC
        "#,
    )
    .bind(user_id)
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
            organization_id
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
