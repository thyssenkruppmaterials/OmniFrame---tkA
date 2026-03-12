//! LX03 (Warehouse Inventory) database models
//!
//! Models for the rr_lx03_data table containing SAP LX03 warehouse inventory data.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// LX03 inventory record (rr_lx03_data table)
/// Contains warehouse bin inventory data from SAP LX03 transaction
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct LX03Data {
    pub id: Uuid,
    pub organization_id: Option<Uuid>,
    pub storage_type: Option<String>,
    pub plant: Option<String>,
    pub storage_bin: String,
    pub storage_location: Option<String>,
    pub material: String,
    pub stock_category: Option<String>,
    pub special_stock: Option<String>,
    pub storage_type_2: Option<String>,
    pub total_stock: f64,
    pub available_stock: f64,
    pub stock_for_putaway: Option<f64>,
    pub pick_quantity: Option<f64>,
    pub last_movement: Option<String>,
    pub last_movement_2: Option<String>,
    pub last_inventory: Option<String>,
    pub special_stock_number: Option<String>,
    pub batch: Option<String>,
    pub inventory_active: Option<String>,
    pub stock_removal_block: Option<String>,
    pub putaway_block: Option<String>,
    pub delivery: Option<String>,
    pub inventory_record: Option<String>,
    pub inventory_record_2: Option<String>,
    pub warehouse: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// LX03 statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LX03Statistics {
    /// Total number of records
    pub total: i64,
    /// Records created today
    pub today_count: i64,
    /// Unique material numbers
    pub unique_materials: i64,
    /// Unique storage locations
    pub unique_locations: i64,
    /// Unique plants
    pub unique_plants: i64,
    /// Sum of total_stock across all records
    pub total_stock: f64,
    /// Sum of available_stock across all records
    pub total_available_stock: f64,
    /// Records where total_stock > 0
    pub records_with_stock: i64,
    /// Records where total_stock = 0 (empty locations)
    pub empty_locations: i64,
}

/// Query parameters for LX03 data
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LX03Query {
    /// Search query (searches across material, plant, storage_bin, etc.)
    pub search_query: Option<String>,
    /// Maximum number of records to return
    pub limit: Option<i64>,
    /// Offset for pagination
    pub offset: Option<i64>,
    /// Filter by plant
    pub plant: Option<String>,
    /// Filter by warehouse
    pub warehouse: Option<String>,
    /// Filter by storage location
    pub storage_location: Option<String>,
    /// Filter by material
    pub material: Option<String>,
    /// Organization ID for row-level security scoping.
    /// Set from authenticated user context (never from query params).
    /// None = no org filter (service-to-service / admin access).
    #[serde(skip_deserializing)]
    pub organization_id: Option<Uuid>,
}

impl LX03Query {
    pub fn new() -> Self {
        Self {
            limit: Some(1000),
            offset: Some(0),
            ..Default::default()
        }
    }

    pub fn with_search(search: &str) -> Self {
        Self {
            search_query: Some(search.to_string()),
            limit: Some(1000),
            offset: Some(0),
            ..Default::default()
        }
    }
}
