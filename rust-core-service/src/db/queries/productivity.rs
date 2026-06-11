// Created and developed by Jai Singh
//! Productivity and labor management queries

use super::super::models::productivity::*;
use chrono::NaiveDate;
use sqlx::{PgPool, Row};
use uuid::Uuid;
use tracing::instrument;

/// Productivity query service
pub struct ProductivityQueries {
    pool: PgPool,
}

impl ProductivityQueries {
    /// Create a new productivity queries instance
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Get user productivity metrics for a date range
    #[instrument(skip(self))]
    pub async fn get_user_productivity(
        &self,
        user_id: Uuid,
        start_date: NaiveDate,
        end_date: NaiveDate,
    ) -> Result<Vec<UserProductivity>, sqlx::Error> {
        sqlx::query_as::<_, UserProductivity>(
            r#"
            WITH daily_stats AS (
                SELECT
                    scanned_by as user_id,
                    DATE(scanned_at) as shift_date,
                    COUNT(*) as total_scans,
                    0::bigint as total_picks,
                    0::bigint as total_putaways,
                    COALESCE(AVG(EXTRACT(EPOCH FROM (created_at - scanned_at))), 0) as avg_time
                FROM rr_inbound_scans
                WHERE scanned_by = $1
                  AND scanned_at::date BETWEEN $2 AND $3
                GROUP BY scanned_by, DATE(scanned_at)

                UNION ALL

                SELECT
                    assigned_user as user_id,
                    DATE(created_at) as shift_date,
                    0::bigint as total_scans,
                    COUNT(*) as total_picks,
                    0::bigint as total_putaways,
                    COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - created_at))), 0) as avg_time
                FROM outbound_transfer_orders
                WHERE assigned_user = $1
                  AND status = 'completed'
                  AND created_at::date BETWEEN $2 AND $3
                GROUP BY assigned_user, DATE(created_at)
            )
            SELECT
                ds.user_id as user_id,
                COALESCE(up.full_name, up.email, ds.user_id::text) as username,
                SUM(ds.total_scans)::bigint as total_scans,
                SUM(ds.total_picks)::bigint as total_picks,
                SUM(ds.total_putaways)::bigint as total_putaways,
                COALESCE(AVG(ds.avg_time), 0)::float8 as avg_time_per_task_seconds,
                ds.shift_date as shift_date
            FROM daily_stats ds
            LEFT JOIN user_profiles up ON up.id = ds.user_id
            WHERE ds.user_id IS NOT NULL
            GROUP BY ds.user_id, ds.shift_date, up.full_name, up.email
            ORDER BY ds.shift_date DESC
            "#,
        )
        .bind(user_id)
        .bind(start_date)
        .bind(end_date)
        .fetch_all(&self.pool)
        .await
    }

    /// Get real-time dashboard statistics
    #[instrument(skip(self))]
    pub async fn get_realtime_dashboard_stats(&self) -> Result<DashboardStats, sqlx::Error> {
        let row = sqlx::query(
            r#"
            SELECT
                (SELECT COUNT(*) FROM user_profiles 
                 WHERE last_seen_at > NOW() - INTERVAL '5 minutes') as active_users,
                (SELECT COUNT(*) FROM rr_inbound_scans 
                 WHERE scanned_at > NOW() - INTERVAL '1 hour') as scans_last_hour,
                (SELECT COUNT(*) FROM outbound_transfer_orders 
                 WHERE status = 'in_progress') as active_picks,
                (SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at)))
                 FROM outbound_transfer_orders
                 WHERE status = 'completed' 
                   AND completed_at > NOW() - INTERVAL '1 hour') as avg_pick_time_seconds,
                (SELECT COUNT(*) FROM drone_scans 
                 WHERE damage_detected = true 
                   AND created_at > NOW() - INTERVAL '24 hours') as damage_alerts_24h
            "#
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(DashboardStats {
            active_users: row.get::<Option<i64>, _>("active_users"),
            scans_last_hour: row.get::<Option<i64>, _>("scans_last_hour"),
            active_picks: row.get::<Option<i64>, _>("active_picks"),
            avg_pick_time_seconds: row.get::<Option<f64>, _>("avg_pick_time_seconds"),
            damage_alerts_24h: row.get::<Option<i64>, _>("damage_alerts_24h"),
        })
    }

    /// Get team performance metrics
    #[instrument(skip(self))]
    pub async fn get_team_performance(
        &self,
        department: &str,
        start_date: NaiveDate,
        end_date: NaiveDate,
    ) -> Result<Vec<TeamPerformance>, sqlx::Error> {
        sqlx::query_as::<_, TeamPerformance>(
            r#"
            WITH team_stats AS (
                SELECT
                    COALESCE(up.department, 'Unassigned') as team_name,
                    COUNT(DISTINCT oto.assigned_user) as member_count,
                    COUNT(*) as total_tasks,
                    COUNT(*) FILTER (WHERE oto.status = 'completed') as completed_tasks,
                    AVG(
                        CASE WHEN oto.status = 'completed' 
                        THEN EXTRACT(EPOCH FROM (oto.completed_at - oto.created_at))
                        END
                    ) as avg_response_time
                FROM outbound_transfer_orders oto
                LEFT JOIN user_profiles up ON up.id = oto.assigned_user
                WHERE oto.created_at::date BETWEEN $2 AND $3
                  AND ($1::text IS NULL OR up.department = $1)
                GROUP BY COALESCE(up.department, 'Unassigned')
            )
            SELECT
                team_name as team_name,
                member_count as member_count,
                total_tasks as total_tasks,
                completed_tasks as completed_tasks,
                CASE WHEN total_tasks > 0 
                     THEN (completed_tasks::float8 / total_tasks::float8 * 100)
                     ELSE 0 
                END as completion_rate,
                COALESCE(avg_response_time, 0)::float8 as avg_response_time_seconds
            FROM team_stats
            ORDER BY completed_tasks DESC
            "#,
        )
        .bind(department)
        .bind(start_date)
        .bind(end_date)
        .fetch_all(&self.pool)
        .await
    }

    /// Get activity summary for a user
    #[instrument(skip(self))]
    pub async fn get_activity_summary(
        &self,
        user_id: Uuid,
        start_date: NaiveDate,
        end_date: NaiveDate,
    ) -> Result<Vec<ActivitySummary>, sqlx::Error> {
        // For now, return aggregated activities from different tables
        // In a real implementation, this might query an activity_log table
        let scans = sqlx::query_as::<_, ActivitySummary>(
            r#"
            SELECT
                'inbound_scan' as activity_type,
                COUNT(*) as count,
                NULL::bigint as total_duration_minutes,
                MIN(scanned_at) as first_occurrence,
                MAX(scanned_at) as last_occurrence
            FROM rr_inbound_scans
            WHERE scanned_by = $1
              AND scanned_at::date BETWEEN $2 AND $3
            "#,
        )
        .bind(user_id)
        .bind(start_date)
        .bind(end_date)
        .fetch_one(&self.pool)
        .await?;

        let picks = sqlx::query_as::<_, ActivitySummary>(
            r#"
            SELECT
                'pick' as activity_type,
                COUNT(*) as count,
                SUM(
                    CASE WHEN status = 'completed' 
                    THEN EXTRACT(EPOCH FROM (completed_at - created_at)) / 60
                    END
                )::bigint as total_duration_minutes,
                MIN(created_at) as first_occurrence,
                MAX(COALESCE(completed_at, created_at)) as last_occurrence
            FROM outbound_transfer_orders
            WHERE assigned_user = $1
              AND created_at::date BETWEEN $2 AND $3
            "#,
        )
        .bind(user_id)
        .bind(start_date)
        .bind(end_date)
        .fetch_one(&self.pool)
        .await?;

        Ok(vec![scans, picks])
    }
}

// Created and developed by Jai Singh
