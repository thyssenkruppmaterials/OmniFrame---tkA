// Created and developed by Jai Singh
//! Warehouse-related database queries
//!
//! Optimized queries for warehouse operations including:
//! - Inbound scans
//! - Transfer orders
//! - Drone scans
//! - Cycle counts
//! - Material master

use super::super::models::warehouse::*;
use sqlx::{PgPool, Row};
use uuid::Uuid;
use tracing::instrument;

/// Warehouse query service
pub struct WarehouseQueries {
    pool: PgPool,
}

impl WarehouseQueries {
    /// Create a new warehouse queries instance
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    // ========== INBOUND SCANS ==========

    /// Get inbound scans with pagination and optional filters
    #[instrument(skip(self))]
    pub async fn get_inbound_scans(
        &self,
        query: &InboundScanQuery,
    ) -> Result<Vec<InboundScan>, sqlx::Error> {
        let limit = query.limit.unwrap_or(100);
        let offset = query.offset.unwrap_or(0);

        sqlx::query_as::<_, InboundScan>(
            r#"
            SELECT
                id, created_at, updated_at, organization_id, scanned_by, scanned_at,
                material_number, tka_batch_number, tracking_number,
                so_line_rma_afa, quantity::float8 as quantity, scan_location, hot_truck,
                notes, barcode
            FROM rr_inbound_scans
            WHERE ($1::uuid IS NULL OR scanned_by = $1)
              AND ($2::timestamptz IS NULL OR scanned_at >= $2)
              AND ($3::timestamptz IS NULL OR scanned_at <= $3)
              AND ($4::text IS NULL OR material_number ILIKE '%' || $4 || '%')
              AND ($5::boolean IS NULL OR hot_truck = $5)
              AND ($6::uuid IS NULL OR organization_id = $6)
            ORDER BY scanned_at DESC NULLS LAST, created_at DESC
            LIMIT $7 OFFSET $8
            "#,
        )
        .bind(query.user_id)
        .bind(query.start_date)
        .bind(query.end_date)
        .bind(&query.material_number)
        .bind(query.hot_truck_only)
        .bind(query.organization_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
    }

    /// Get total count of inbound scans matching filters
    #[instrument(skip(self))]
    pub async fn count_inbound_scans(
        &self,
        query: &InboundScanQuery,
    ) -> Result<i64, sqlx::Error> {
        let row = sqlx::query(
            r#"
            SELECT COUNT(*) as count
            FROM rr_inbound_scans
            WHERE ($1::uuid IS NULL OR scanned_by = $1)
              AND ($2::timestamptz IS NULL OR scanned_at >= $2)
              AND ($3::timestamptz IS NULL OR scanned_at <= $3)
              AND ($4::text IS NULL OR material_number ILIKE '%' || $4 || '%')
              AND ($5::boolean IS NULL OR hot_truck = $5)
              AND ($6::uuid IS NULL OR organization_id = $6)
            "#,
        )
        .bind(query.user_id)
        .bind(query.start_date)
        .bind(query.end_date)
        .bind(&query.material_number)
        .bind(query.hot_truck_only)
        .bind(query.organization_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(row.get::<i64, _>("count"))
    }

    /// Get an inbound scan by barcode
    #[instrument(skip(self))]
    pub async fn get_inbound_scan_by_barcode(
        &self,
        barcode: &str,
        organization_id: Option<Uuid>,
    ) -> Result<Option<InboundScan>, sqlx::Error> {
        sqlx::query_as::<_, InboundScan>(
            r#"
            SELECT
                id, created_at, updated_at, organization_id, scanned_by, scanned_at,
                material_number, tka_batch_number, tracking_number,
                so_line_rma_afa, quantity::float8 as quantity, scan_location, hot_truck,
                notes, barcode
            FROM rr_inbound_scans
            WHERE barcode = $1
              AND ($2::uuid IS NULL OR organization_id = $2)
            ORDER BY scanned_at DESC NULLS LAST
            LIMIT 1
            "#,
        )
        .bind(barcode)
        .bind(organization_id)
        .fetch_optional(&self.pool)
        .await
    }

    /// Insert a new inbound scan
    #[instrument(skip(self, scan))]
    pub async fn insert_inbound_scan(
        &self,
        scan: &InboundScan,
    ) -> Result<InboundScan, sqlx::Error> {
        sqlx::query_as::<_, InboundScan>(
            r#"
            INSERT INTO rr_inbound_scans (
                organization_id, scanned_by, scanned_at, material_number,
                tka_batch_number, tracking_number, so_line_rma_afa,
                quantity, scan_location, hot_truck, notes, barcode
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING
                id, created_at, updated_at, organization_id, scanned_by, scanned_at,
                material_number, tka_batch_number, tracking_number,
                so_line_rma_afa, quantity::float8 as quantity, scan_location, hot_truck,
                notes, barcode
            "#,
        )
        .bind(scan.organization_id)
        .bind(scan.scanned_by)
        .bind(scan.scanned_at)
        .bind(&scan.material_number)
        .bind(&scan.tka_batch_number)
        .bind(&scan.tracking_number)
        .bind(&scan.so_line_rma_afa)
        .bind(scan.quantity)
        .bind(&scan.scan_location)
        .bind(scan.hot_truck)
        .bind(&scan.notes)
        .bind(&scan.barcode)
        .fetch_one(&self.pool)
        .await
    }

    /// Get inbound scan statistics
    #[instrument(skip(self))]
    pub async fn get_inbound_statistics(
        &self,
        organization_id: Option<Uuid>,
    ) -> Result<InboundScanStatistics, sqlx::Error> {
        let row = sqlx::query(
            r#"
            SELECT
                (SELECT COUNT(*) FROM rr_inbound_scans
                 WHERE ($1::uuid IS NULL OR organization_id = $1))::bigint as total_scans,
                (SELECT COUNT(*) FROM rr_inbound_scans 
                 WHERE scanned_at::date = CURRENT_DATE
                   AND ($1::uuid IS NULL OR organization_id = $1))::bigint as today_scans,
                (SELECT COUNT(DISTINCT material_number) FROM rr_inbound_scans 
                 WHERE material_number IS NOT NULL
                   AND ($1::uuid IS NULL OR organization_id = $1))::bigint as unique_materials,
                (SELECT COUNT(DISTINCT scan_location) FROM rr_inbound_scans 
                 WHERE scan_location IS NOT NULL
                   AND ($1::uuid IS NULL OR organization_id = $1))::bigint as unique_locations,
                (SELECT COUNT(*) FROM rr_inbound_scans 
                 WHERE hot_truck = true
                   AND ($1::uuid IS NULL OR organization_id = $1))::bigint as hot_truck_scans,
                (SELECT AVG(quantity)::float8 FROM rr_inbound_scans 
                 WHERE quantity IS NOT NULL
                   AND ($1::uuid IS NULL OR organization_id = $1)) as average_quantity,
                (SELECT COUNT(*) / GREATEST(7, 1) FROM rr_inbound_scans 
                 WHERE scanned_at >= CURRENT_DATE - INTERVAL '7 days'
                   AND ($1::uuid IS NULL OR organization_id = $1))::bigint as weekly_average
            "#
        )
        .bind(organization_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(InboundScanStatistics {
            total_scans: row.get::<i64, _>("total_scans"),
            today_scans: row.get::<i64, _>("today_scans"),
            unique_materials: row.get::<i64, _>("unique_materials"),
            unique_locations: row.get::<i64, _>("unique_locations"),
            hot_truck_scans: row.get::<i64, _>("hot_truck_scans"),
            average_quantity: row.get::<Option<f64>, _>("average_quantity"),
            weekly_average: row.get::<i64, _>("weekly_average"),
        })
    }

    // ========== TRANSFER ORDERS ==========

    /// Get transfer orders with pagination and optional filters
    #[instrument(skip(self))]
    pub async fn get_transfer_orders(
        &self,
        query: &TransferOrderQuery,
    ) -> Result<Vec<TransferOrder>, sqlx::Error> {
        let limit = query.limit.unwrap_or(100);
        let offset = query.offset.unwrap_or(0);

        sqlx::query_as::<_, TransferOrder>(
            r#"
            SELECT
                id, created_at, to_number, delivery_number, material_number,
                material_description, requested_quantity, picked_quantity,
                source_storage_type, source_storage_bin,
                destination_storage_type, destination_storage_bin,
                status, assigned_user, completed_at
            FROM outbound_transfer_orders
            WHERE ($1::text IS NULL OR status = $1)
              AND ($2::uuid IS NULL OR assigned_user = $2)
              AND ($3::text IS NULL OR material_number ILIKE '%' || $3 || '%')
            ORDER BY created_at DESC
            LIMIT $4 OFFSET $5
            "#,
        )
        .bind(&query.status)
        .bind(query.assigned_user)
        .bind(&query.material_number)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
    }

    /// Get a transfer order by TO number
    #[instrument(skip(self))]
    pub async fn get_transfer_order_by_number(
        &self,
        to_number: &str,
    ) -> Result<Option<TransferOrder>, sqlx::Error> {
        sqlx::query_as::<_, TransferOrder>(
            r#"
            SELECT
                id, created_at, to_number, delivery_number, material_number,
                material_description, requested_quantity, picked_quantity,
                source_storage_type, source_storage_bin,
                destination_storage_type, destination_storage_bin,
                status, assigned_user, completed_at
            FROM outbound_transfer_orders
            WHERE to_number = $1
            "#,
        )
        .bind(to_number)
        .fetch_optional(&self.pool)
        .await
    }

    /// Update transfer order status
    #[instrument(skip(self))]
    pub async fn update_transfer_order_status(
        &self,
        to_number: &str,
        status: &str,
        picked_quantity: Option<i32>,
    ) -> Result<TransferOrder, sqlx::Error> {
        sqlx::query_as::<_, TransferOrder>(
            r#"
            UPDATE outbound_transfer_orders
            SET status = $2,
                picked_quantity = COALESCE($3, picked_quantity),
                completed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE completed_at END
            WHERE to_number = $1
            RETURNING
                id, created_at, to_number, delivery_number, material_number,
                material_description, requested_quantity, picked_quantity,
                source_storage_type, source_storage_bin,
                destination_storage_type, destination_storage_bin,
                status, assigned_user, completed_at
            "#,
        )
        .bind(to_number)
        .bind(status)
        .bind(picked_quantity)
        .fetch_one(&self.pool)
        .await
    }

    // ========== DRONE SCANS ==========

    /// Get pending drone scans for processing
    #[instrument(skip(self))]
    pub async fn get_pending_drone_scans(&self) -> Result<Vec<DroneScan>, sqlx::Error> {
        sqlx::query_as::<_, DroneScan>(
            r#"
            SELECT
                id, created_at, scan_id, zone_id, image_url, status,
                ai_analysis, items_detected, damage_detected,
                processing_time_ms, error_message
            FROM drone_scans
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT 50
            "#
        )
        .fetch_all(&self.pool)
        .await
    }

    /// Update drone scan with AI analysis results
    #[instrument(skip(self))]
    pub async fn update_drone_scan_analysis(
        &self,
        scan_id: &str,
        analysis: serde_json::Value,
        items_detected: i32,
        damage_detected: bool,
        processing_time_ms: i32,
    ) -> Result<DroneScan, sqlx::Error> {
        sqlx::query_as::<_, DroneScan>(
            r#"
            UPDATE drone_scans
            SET status = 'completed',
                ai_analysis = $2,
                items_detected = $3,
                damage_detected = $4,
                processing_time_ms = $5
            WHERE scan_id = $1
            RETURNING
                id, created_at, scan_id, zone_id, image_url, status,
                ai_analysis, items_detected, damage_detected,
                processing_time_ms, error_message
            "#,
        )
        .bind(scan_id)
        .bind(analysis)
        .bind(items_detected)
        .bind(damage_detected)
        .bind(processing_time_ms)
        .fetch_one(&self.pool)
        .await
    }

    // ========== MATERIAL MASTER ==========

    /// Get material by material number
    #[instrument(skip(self))]
    pub async fn get_material(
        &self,
        material_number: &str,
    ) -> Result<Option<MaterialMaster>, sqlx::Error> {
        sqlx::query_as::<_, MaterialMaster>(
            r#"
            SELECT material_number, description, material_group,
                   base_uom, gross_weight, net_weight, volume
            FROM material_master_data
            WHERE material_number = $1
            "#,
        )
        .bind(material_number)
        .fetch_optional(&self.pool)
        .await
    }

    /// Search materials by number or description
    #[instrument(skip(self))]
    pub async fn search_materials(
        &self,
        search_term: &str,
        limit: i64,
    ) -> Result<Vec<MaterialMaster>, sqlx::Error> {
        let pattern = format!("%{}%", search_term);
        sqlx::query_as::<_, MaterialMaster>(
            r#"
            SELECT material_number, description, material_group,
                   base_uom, gross_weight, net_weight, volume
            FROM material_master_data
            WHERE material_number ILIKE $1
               OR description ILIKE $1
            ORDER BY material_number
            LIMIT $2
            "#,
        )
        .bind(&pattern)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    // ========== WAREHOUSE STATS ==========

    /// Get overall warehouse statistics
    /// Note: Only queries tables that are guaranteed to exist
    #[instrument(skip(self))]
    pub async fn get_warehouse_stats(
        &self,
        organization_id: Option<Uuid>,
    ) -> Result<WarehouseStats, sqlx::Error> {
        // Query only inbound_scans which we know exists
        // Other tables may not exist in all deployments
        let row = sqlx::query(
            r#"
            SELECT
                (SELECT COUNT(*) FROM rr_inbound_scans 
                 WHERE scanned_at::date = CURRENT_DATE
                   AND ($1::uuid IS NULL OR organization_id = $1)) as inbound_today
            "#
        )
        .bind(organization_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(WarehouseStats {
            inbound_today: row.get::<Option<i64>, _>("inbound_today"),
            // Return None for tables that may not exist
            pending_tos: None,
            completed_today: None,
            pending_scans: None,
            pending_counts: None,
        })
    }
}

// Created and developed by Jai Singh
