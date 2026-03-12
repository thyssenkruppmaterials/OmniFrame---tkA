//! LX03 (Warehouse Inventory) database queries
//!
//! High-performance queries for LX03 warehouse inventory data.
//! Provides optimized access to the rr_lx03_data table.

use crate::db::models::lx03::{LX03Data, LX03Query, LX03Statistics};
use sqlx::{PgPool, Row};
use uuid::Uuid;
use tracing::instrument;

/// LX03 query service
pub struct LX03Queries {
    pool: PgPool,
}

impl LX03Queries {
    /// Create a new LX03 queries instance
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Get LX03 data with optional search and pagination
    /// 
    /// Searches across: material, plant, storage_bin, storage_location,
    /// delivery, batch, stock_category, warehouse
    #[instrument(skip(self))]
    pub async fn get_lx03_data(
        &self,
        query: &LX03Query,
    ) -> Result<Vec<LX03Data>, sqlx::Error> {
        let limit = query.limit.unwrap_or(1000);
        let offset = query.offset.unwrap_or(0);
        let search_pattern = query.search_query.as_ref()
            .map(|s| format!("%{}%", s.to_lowercase()));

        sqlx::query_as::<_, LX03Data>(
            r#"
            SELECT
                id,
                organization_id,
                storage_type,
                plant,
                storage_bin,
                storage_location,
                material,
                stock_category,
                special_stock,
                storage_type_2,
                COALESCE(total_stock, 0)::float8 as total_stock,
                COALESCE(available_stock, 0)::float8 as available_stock,
                stock_for_putaway::float8 as stock_for_putaway,
                pick_quantity::float8 as pick_quantity,
                last_movement,
                last_movement_2,
                last_inventory,
                special_stock_number,
                batch,
                inventory_active,
                stock_removal_block,
                putaway_block,
                delivery,
                inventory_record,
                inventory_record_2,
                warehouse,
                created_at,
                updated_at
            FROM rr_lx03_data
            WHERE (
                $1::text IS NULL 
                OR LOWER(material) LIKE $1
                OR LOWER(plant) LIKE $1
                OR LOWER(storage_bin) LIKE $1
                OR LOWER(storage_location) LIKE $1
                OR LOWER(delivery) LIKE $1
                OR LOWER(batch) LIKE $1
                OR LOWER(stock_category) LIKE $1
                OR LOWER(warehouse) LIKE $1
            )
            AND ($2::text IS NULL OR plant = $2)
            AND ($3::text IS NULL OR warehouse = $3)
            AND ($4::text IS NULL OR storage_location = $4)
            AND ($5::text IS NULL OR material ILIKE '%' || $5 || '%')
            AND ($6::uuid IS NULL OR organization_id = $6)
            ORDER BY created_at DESC NULLS LAST
            LIMIT $7 OFFSET $8
            "#,
        )
        .bind(&search_pattern)
        .bind(&query.plant)
        .bind(&query.warehouse)
        .bind(&query.storage_location)
        .bind(&query.material)
        .bind(query.organization_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
    }

    /// Get LX03 statistics
    /// 
    /// Returns aggregate statistics from the rr_lx03_data table, scoped by organization.
    #[instrument(skip(self))]
    pub async fn get_lx03_statistics(
        &self,
        organization_id: Option<Uuid>,
    ) -> Result<LX03Statistics, sqlx::Error> {
        let row = sqlx::query(
            r#"
            SELECT
                (SELECT COUNT(*) FROM rr_lx03_data
                 WHERE ($1::uuid IS NULL OR organization_id = $1))::bigint as total,
                (SELECT COUNT(*) FROM rr_lx03_data 
                 WHERE created_at::date = CURRENT_DATE
                   AND ($1::uuid IS NULL OR organization_id = $1))::bigint as today_count,
                (SELECT COUNT(DISTINCT material) FROM rr_lx03_data 
                 WHERE material IS NOT NULL AND material != ''
                   AND ($1::uuid IS NULL OR organization_id = $1))::bigint as unique_materials,
                (SELECT COUNT(DISTINCT storage_location) FROM rr_lx03_data 
                 WHERE storage_location IS NOT NULL
                   AND ($1::uuid IS NULL OR organization_id = $1))::bigint as unique_locations,
                (SELECT COUNT(DISTINCT plant) FROM rr_lx03_data 
                 WHERE plant IS NOT NULL
                   AND ($1::uuid IS NULL OR organization_id = $1))::bigint as unique_plants,
                COALESCE((SELECT SUM(total_stock) FROM rr_lx03_data
                 WHERE ($1::uuid IS NULL OR organization_id = $1)), 0)::float8 as total_stock,
                COALESCE((SELECT SUM(available_stock) FROM rr_lx03_data
                 WHERE ($1::uuid IS NULL OR organization_id = $1)), 0)::float8 as total_available_stock,
                (SELECT COUNT(*) FROM rr_lx03_data 
                 WHERE total_stock > 0
                   AND ($1::uuid IS NULL OR organization_id = $1))::bigint as records_with_stock,
                (SELECT COUNT(*) FROM rr_lx03_data 
                 WHERE (total_stock = 0 OR total_stock IS NULL)
                   AND ($1::uuid IS NULL OR organization_id = $1))::bigint as empty_locations
            "#
        )
        .bind(organization_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(LX03Statistics {
            total: row.get::<i64, _>("total"),
            today_count: row.get::<i64, _>("today_count"),
            unique_materials: row.get::<i64, _>("unique_materials"),
            unique_locations: row.get::<i64, _>("unique_locations"),
            unique_plants: row.get::<i64, _>("unique_plants"),
            total_stock: row.get::<f64, _>("total_stock"),
            total_available_stock: row.get::<f64, _>("total_available_stock"),
            records_with_stock: row.get::<i64, _>("records_with_stock"),
            empty_locations: row.get::<i64, _>("empty_locations"),
        })
    }

    /// Count total LX03 records matching query
    #[instrument(skip(self))]
    pub async fn count_lx03_data(
        &self,
        query: &LX03Query,
    ) -> Result<i64, sqlx::Error> {
        let search_pattern = query.search_query.as_ref()
            .map(|s| format!("%{}%", s.to_lowercase()));

        let row = sqlx::query(
            r#"
            SELECT COUNT(*)::bigint as count
            FROM rr_lx03_data
            WHERE (
                $1::text IS NULL 
                OR LOWER(material) LIKE $1
                OR LOWER(plant) LIKE $1
                OR LOWER(storage_bin) LIKE $1
                OR LOWER(storage_location) LIKE $1
                OR LOWER(delivery) LIKE $1
                OR LOWER(batch) LIKE $1
                OR LOWER(stock_category) LIKE $1
                OR LOWER(warehouse) LIKE $1
            )
            AND ($2::text IS NULL OR plant = $2)
            AND ($3::text IS NULL OR warehouse = $3)
            AND ($4::text IS NULL OR storage_location = $4)
            AND ($5::text IS NULL OR material ILIKE '%' || $5 || '%')
            AND ($6::uuid IS NULL OR organization_id = $6)
            "#,
        )
        .bind(&search_pattern)
        .bind(&query.plant)
        .bind(&query.warehouse)
        .bind(&query.storage_location)
        .bind(&query.material)
        .bind(query.organization_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(row.get::<i64, _>("count"))
    }

    /// Get unique warehouses for filtering
    #[instrument(skip(self))]
    pub async fn get_warehouses(&self) -> Result<Vec<String>, sqlx::Error> {
        let rows = sqlx::query_scalar::<_, String>(
            r#"
            SELECT DISTINCT warehouse
            FROM rr_lx03_data
            WHERE warehouse IS NOT NULL AND warehouse != ''
            ORDER BY warehouse
            "#
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    /// Get unique plants for filtering
    #[instrument(skip(self))]
    pub async fn get_plants(&self) -> Result<Vec<String>, sqlx::Error> {
        let rows = sqlx::query_scalar::<_, String>(
            r#"
            SELECT DISTINCT plant
            FROM rr_lx03_data
            WHERE plant IS NOT NULL AND plant != ''
            ORDER BY plant
            "#
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }

    /// Get unique storage locations for filtering
    #[instrument(skip(self))]
    pub async fn get_storage_locations(&self) -> Result<Vec<String>, sqlx::Error> {
        let rows = sqlx::query_scalar::<_, String>(
            r#"
            SELECT DISTINCT storage_location
            FROM rr_lx03_data
            WHERE storage_location IS NOT NULL AND storage_location != ''
            ORDER BY storage_location
            "#
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows)
    }
}
