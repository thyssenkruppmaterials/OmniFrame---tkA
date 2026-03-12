//! Database models for work management
//!
//! Rust structs mapped to database tables for cycle counts and worker tracking.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Cycle count task from rr_cyclecount_data table
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct CycleCountTask {
    pub id: Uuid,
    pub count_number: String,
    pub material_number: String,
    pub material_description: Option<String>,
    pub location: String,
    pub warehouse: Option<String>,
    pub system_quantity: f64,
    pub counted_quantity: Option<f64>,
    pub unit_of_measure: String,
    pub priority: String,
    pub status: String,
    pub count_type: Option<String>,
    pub assigned_to: Option<Uuid>,
    pub assigned_at: Option<DateTime<Utc>>,
    pub push_mode: String,
    pub pushed_by: Option<Uuid>,
    pub pushed_at: Option<DateTime<Utc>>,
    pub push_acknowledged: bool,
    pub organization_id: Uuid,
}

/// Worker status with user profile information
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct WorkerStatus {
    pub user_id: Uuid,
    pub full_name: Option<String>,
    pub email: Option<String>,
    pub status: String,
    pub current_task_id: Option<Uuid>,
    pub current_task_type: Option<String>,
    pub current_zone: Option<String>,
    pub current_location: Option<String>,
    pub last_heartbeat: DateTime<Utc>,
}

/// Queue statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueStats {
    pub pending: i64,
    pub in_progress: i64,
    pub completed_today: i64,
    pub pushed_pending: i64,
    pub total_workers_online: i64,
}

/// Request to push a cycle count to a user
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PushCycleCountRequest {
    pub count_id: Uuid,
    pub user_id: Uuid,
}

/// Request to complete a cycle count
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompleteCycleCountRequest {
    pub counted_quantity: f64,
    pub notes: Option<String>,
}

/// Request to send a heartbeat
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatRequest {
    pub task_id: Option<Uuid>,
    pub task_type: Option<String>,
    pub zone: Option<String>,
    pub location: Option<String>,
    pub status: Option<String>,
}

/// Response for claiming a task
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimTaskResponse {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task: Option<CycleCountTask>,
}

/// Response for task operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskOperationResponse {
    pub success: bool,
    pub message: String,
}

/// Response for heartbeat
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatResponse {
    pub success: bool,
    pub message: String,
    pub timestamp: DateTime<Utc>,
}
