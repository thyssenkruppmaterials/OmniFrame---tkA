//! Warehouse-related database models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Inbound scan record (rr_inbound_scans table)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct InboundScan {
    pub id: Uuid,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub organization_id: Option<Uuid>,
    pub scanned_by: Option<Uuid>,
    pub scanned_at: Option<DateTime<Utc>>,
    pub material_number: Option<String>,
    pub tka_batch_number: Option<String>,
    pub tracking_number: Option<String>,
    pub so_line_rma_afa: Option<String>,
    pub quantity: Option<f64>,
    pub scan_location: Option<String>,
    pub hot_truck: Option<bool>,
    pub notes: Option<String>,
    pub barcode: Option<String>,
}

/// Inbound scan with user profile information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundScanWithUser {
    #[serde(flatten)]
    pub scan: InboundScan,
    pub scanned_by_name: Option<String>,
    pub scanned_by_email: Option<String>,
}

/// Transfer order (outbound_transfer_orders table)
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TransferOrder {
    pub id: Uuid,
    pub created_at: Option<DateTime<Utc>>,
    pub to_number: String,
    pub delivery_number: Option<String>,
    pub material_number: String,
    pub material_description: Option<String>,
    pub requested_quantity: i32,
    pub picked_quantity: Option<i32>,
    pub source_storage_type: Option<String>,
    pub source_storage_bin: Option<String>,
    pub destination_storage_type: Option<String>,
    pub destination_storage_bin: Option<String>,
    pub status: String,
    pub assigned_user: Option<Uuid>,
    pub completed_at: Option<DateTime<Utc>>,
}

/// Drone scan record
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DroneScan {
    pub id: Uuid,
    pub created_at: Option<DateTime<Utc>>,
    pub scan_id: String,
    pub zone_id: Option<String>,
    pub image_url: Option<String>,
    pub status: String,
    pub ai_analysis: Option<serde_json::Value>,
    pub items_detected: Option<i32>,
    pub damage_detected: Option<bool>,
    pub processing_time_ms: Option<i32>,
    pub error_message: Option<String>,
}

/// Cycle count record
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct CycleCount {
    pub id: Uuid,
    pub created_at: Option<DateTime<Utc>>,
    pub location: String,
    pub material_number: String,
    pub system_quantity: i32,
    pub counted_quantity: Option<i32>,
    pub variance: Option<i32>,
    pub status: String,
    pub counted_by: Option<Uuid>,
    pub counted_at: Option<DateTime<Utc>>,
}

/// Material master data
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MaterialMaster {
    pub material_number: String,
    pub description: Option<String>,
    pub material_group: Option<String>,
    pub base_uom: Option<String>,
    pub gross_weight: Option<f64>,
    pub net_weight: Option<f64>,
    pub volume: Option<f64>,
}

/// Putaway operation record
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PutawayOperation {
    pub id: Uuid,
    pub created_at: Option<DateTime<Utc>>,
    pub inbound_scan_id: Option<Uuid>,
    pub material_number: String,
    pub quantity: i32,
    pub source_location: Option<String>,
    pub target_location: String,
    pub status: String,
    pub assigned_user: Option<Uuid>,
    pub completed_at: Option<DateTime<Utc>>,
}

/// Warehouse statistics
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct WarehouseStats {
    pub inbound_today: Option<i64>,
    pub pending_tos: Option<i64>,
    pub completed_today: Option<i64>,
    pub pending_scans: Option<i64>,
    pub pending_counts: Option<i64>,
}

/// Inbound scan statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundScanStatistics {
    pub total_scans: i64,
    pub today_scans: i64,
    pub unique_materials: i64,
    pub unique_locations: i64,
    pub hot_truck_scans: i64,
    pub average_quantity: Option<f64>,
    pub weekly_average: i64,
}

/// Query parameters for inbound scans
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundScanQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub user_id: Option<Uuid>,
    pub start_date: Option<DateTime<Utc>>,
    pub end_date: Option<DateTime<Utc>>,
    pub material_number: Option<String>,
    pub hot_truck_only: Option<bool>,
    /// Organization ID for row-level security scoping.
    /// Set from authenticated user context (never from query params).
    /// None = no org filter (service-to-service / admin access).
    #[serde(skip_deserializing)]
    pub organization_id: Option<Uuid>,
}

impl Default for InboundScanQuery {
    fn default() -> Self {
        Self {
            limit: Some(100),
            offset: Some(0),
            user_id: None,
            start_date: None,
            end_date: None,
            material_number: None,
            hot_truck_only: None,
            organization_id: None,
        }
    }
}

/// Query parameters for transfer orders
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferOrderQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub status: Option<String>,
    pub assigned_user: Option<Uuid>,
    pub material_number: Option<String>,
}

impl Default for TransferOrderQuery {
    fn default() -> Self {
        Self {
            limit: Some(100),
            offset: Some(0),
            status: None,
            assigned_user: None,
            material_number: None,
        }
    }
}
