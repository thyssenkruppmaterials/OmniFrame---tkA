// Created and developed by Jai Singh
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
    pub completed_at: Option<DateTime<Utc>>,
    pub recount_by: Option<String>,
    pub recount_date: Option<chrono::NaiveDate>,
    pub recount_completed: bool,
    pub requires_recount: bool,
    pub counter_name: Option<String>,
    pub resolved_location_key: Option<String>,
    pub resolved_zone: Option<String>,
    pub resolved_aisle: Option<String>,
    pub resolved_sequence: Option<f64>,
    pub resolution_source: Option<String>,
    // Workflow snapshot — stamped by the `trigger_stamp_workflow` DB trigger
    // on INSERT (migration 218). Lets the RF UI render exactly the step
    // sequence the admin configured, pinned to the config version that was
    // active when the count was created.
    pub workflow_config_id: Option<Uuid>,
    pub workflow_config_version: Option<i32>,
    pub workflow_snapshot: serde_json::Value,
    pub workflow_result: serde_json::Value,
    pub evidence_photo_urls: Option<Vec<String>>,
    pub review_threshold_pct: Option<f64>,
    pub review_threshold_abs: Option<f64>,
    // Part number verification (migration 219)
    pub scanned_material_number: Option<String>,
    pub location_reported_empty: Option<bool>,
    pub part_variance: Option<bool>,
    // Multi-part capture list (migration 220). Defaults to `[]`.
    pub scanned_parts: serde_json::Value,
    // Found part transfer (migration 222 + 223)
    // `location` on the row is the SOURCE (A) the operator picks from;
    // `transfer_destination_location` is where they deliver it (B).
    // `transfer_source_quantity` is the actual qty picked from A.
    pub transfer_destination_location: Option<String>,
    pub transfer_source_quantity: Option<f64>,
}

/// Active path rule from cycle_count_path_rules
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PathRule {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub warehouse_code: Option<String>,
    pub zone_filter: Option<String>,
    pub aisle_filter: Option<String>,
    pub strategy: String,
    pub direction: String,
    pub max_counters_per_aisle: i32,
    pub fallback_behavior: String,
    pub priority: i32,
}

/// Occupied aisle derived from active cycle-count assignments
#[derive(Debug, Clone, FromRow)]
pub struct OccupiedAisle {
    pub resolved_aisle: String,
    pub worker_count: i64,
}

/// Request to skip/defer a cycle count
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkipTaskRequest {
    pub reason: Option<String>,
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
    pub deferred_pending: i64,
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

// Created and developed by Jai Singh
