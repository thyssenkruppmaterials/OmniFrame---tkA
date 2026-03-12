//! Productivity and labor management models

use chrono::{DateTime, Utc, NaiveDate};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// User productivity metrics
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct UserProductivity {
    pub user_id: Uuid,
    pub username: String,
    pub total_scans: i64,
    pub total_picks: i64,
    pub total_putaways: i64,
    pub avg_time_per_task_seconds: f64,
    pub shift_date: NaiveDate,
}

/// Team performance metrics
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TeamPerformance {
    pub team_name: String,
    pub member_count: i64,
    pub total_tasks: i64,
    pub completed_tasks: i64,
    pub completion_rate: f64,
    pub avg_response_time_seconds: f64,
}

/// Dashboard statistics
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DashboardStats {
    pub active_users: Option<i64>,
    pub scans_last_hour: Option<i64>,
    pub active_picks: Option<i64>,
    pub avg_pick_time_seconds: Option<f64>,
    pub damage_alerts_24h: Option<i64>,
}

/// Labor time entry
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct LaborTimeEntry {
    pub id: Uuid,
    pub user_id: Uuid,
    pub activity_type: String,
    pub start_time: DateTime<Utc>,
    pub end_time: Option<DateTime<Utc>>,
    pub duration_minutes: Option<i32>,
    pub area: Option<String>,
    pub notes: Option<String>,
}

/// Overtime record
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct OvertimeRecord {
    pub id: Uuid,
    pub user_id: Uuid,
    pub date: NaiveDate,
    pub regular_hours: f64,
    pub overtime_hours: f64,
    pub double_time_hours: Option<f64>,
    pub approved: Option<bool>,
    pub approved_by: Option<Uuid>,
}

/// Activity summary for timeline
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ActivitySummary {
    pub activity_type: String,
    pub count: i64,
    pub total_duration_minutes: Option<i64>,
    pub first_occurrence: Option<DateTime<Utc>>,
    pub last_occurrence: Option<DateTime<Utc>>,
}

/// Productivity query parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductivityQuery {
    pub user_id: Option<Uuid>,
    pub start_date: NaiveDate,
    pub end_date: NaiveDate,
    pub department: Option<String>,
    pub team: Option<String>,
}
