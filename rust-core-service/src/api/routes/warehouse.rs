//! Warehouse API endpoints

use axum::{
    extract::{Path, Query, State},
    Extension,
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::api::error::{ApiError, ApiResult};
use crate::api::middleware::AuthenticatedUser;
use crate::AppState;
use crate::db::models::warehouse::*;
use crate::db::queries::warehouse::WarehouseQueries;

/// Inbound scan query parameters
#[derive(Debug, Deserialize)]
pub struct InboundScanParams {
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
    pub user_id: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub material_number: Option<String>,
    pub hot_truck_only: Option<bool>,
}

fn default_limit() -> i64 {
    100
}

/// Get inbound scans with pagination
pub async fn get_inbound_scans(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthenticatedUser>,
    Query(params): Query<InboundScanParams>,
) -> ApiResult<Json<InboundScanResponse>> {
    let queries = WarehouseQueries::new(state.db_pool.clone());

    let user_id = params.user_id
        .as_ref()
        .and_then(|id| Uuid::parse_str(id).ok());

    let start_date = params.start_date
        .as_ref()
        .and_then(|d| chrono::DateTime::parse_from_rfc3339(d).ok())
        .map(|d| d.with_timezone(&chrono::Utc));

    let end_date = params.end_date
        .as_ref()
        .and_then(|d| chrono::DateTime::parse_from_rfc3339(d).ok())
        .map(|d| d.with_timezone(&chrono::Utc));

    // Force organization scoping from authenticated context.
    // Service-role callers get None (access to all orgs).
    let org_id = resolve_org_scope(&auth_user);

    let query = InboundScanQuery {
        limit: Some(params.limit),
        offset: Some(params.offset),
        user_id,
        start_date,
        end_date,
        material_number: params.material_number,
        hot_truck_only: params.hot_truck_only,
        organization_id: org_id,
    };

    let scans = queries.get_inbound_scans(&query)
        .await
        .map_err(|e| ApiError::Database(e))?;

    let total = queries.count_inbound_scans(&query)
        .await
        .map_err(|e| ApiError::Database(e))?;

    Ok(Json(InboundScanResponse {
        scans,
        total,
        limit: params.limit,
        offset: params.offset,
    }))
}

#[derive(Debug, Serialize)]
pub struct InboundScanResponse {
    pub scans: Vec<InboundScan>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

/// Get inbound scan by barcode
pub async fn get_inbound_scan_by_barcode(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthenticatedUser>,
    Path(barcode): Path<String>,
) -> ApiResult<Json<Option<InboundScan>>> {
    let queries = WarehouseQueries::new(state.db_pool.clone());
    let org_id = resolve_org_scope(&auth_user);

    let scan = queries.get_inbound_scan_by_barcode(&barcode, org_id)
        .await
        .map_err(|e| ApiError::Database(e))?;

    Ok(Json(scan))
}

/// Create inbound scan request
#[derive(Debug, Deserialize)]
pub struct CreateInboundScanRequest {
    pub organization_id: Option<String>,
    pub scanned_by: Option<String>,
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

/// Create a new inbound scan
pub async fn create_inbound_scan(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthenticatedUser>,
    Json(request): Json<CreateInboundScanRequest>,
) -> ApiResult<Json<InboundScan>> {
    let queries = WarehouseQueries::new(state.db_pool.clone());

    // Use the authenticated user's organization_id, falling back to the request body
    // for service-to-service calls where org might be explicitly provided.
    let org_id = auth_user.organization_id
        .or_else(|| request.organization_id.as_ref().and_then(|id| Uuid::parse_str(id).ok()));

    let scan = InboundScan {
        id: Uuid::new_v4(),
        created_at: Some(chrono::Utc::now()),
        updated_at: Some(chrono::Utc::now()),
        organization_id: org_id,
        scanned_by: request.scanned_by.and_then(|id| Uuid::parse_str(&id).ok()),
        scanned_at: Some(chrono::Utc::now()),
        material_number: request.material_number,
        tka_batch_number: request.tka_batch_number,
        tracking_number: request.tracking_number,
        so_line_rma_afa: request.so_line_rma_afa,
        quantity: request.quantity,
        scan_location: request.scan_location,
        hot_truck: request.hot_truck,
        notes: request.notes,
        barcode: request.barcode,
    };

    let created = queries.insert_inbound_scan(&scan)
        .await
        .map_err(|e| ApiError::Database(e))?;

    Ok(Json(created))
}

/// Transfer order query parameters
#[derive(Debug, Deserialize)]
pub struct TransferOrderParams {
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
    pub status: Option<String>,
    pub assigned_user: Option<String>,
    pub material_number: Option<String>,
}

/// Get transfer orders
pub async fn get_transfer_orders(
    State(state): State<AppState>,
    Query(params): Query<TransferOrderParams>,
) -> ApiResult<Json<TransferOrderResponse>> {
    let queries = WarehouseQueries::new(state.db_pool.clone());

    let query = TransferOrderQuery {
        limit: Some(params.limit),
        offset: Some(params.offset),
        status: params.status,
        assigned_user: params.assigned_user.and_then(|id| Uuid::parse_str(&id).ok()),
        material_number: params.material_number,
    };

    let orders = queries.get_transfer_orders(&query)
        .await
        .map_err(|e| ApiError::Database(e))?;

    Ok(Json(TransferOrderResponse {
        orders,
        limit: params.limit,
        offset: params.offset,
    }))
}

#[derive(Debug, Serialize)]
pub struct TransferOrderResponse {
    pub orders: Vec<TransferOrder>,
    pub limit: i64,
    pub offset: i64,
}

/// Get transfer order by TO number
pub async fn get_transfer_order(
    State(state): State<AppState>,
    Path(to_number): Path<String>,
) -> ApiResult<Json<Option<TransferOrder>>> {
    let queries = WarehouseQueries::new(state.db_pool.clone());

    let order = queries.get_transfer_order_by_number(&to_number)
        .await
        .map_err(|e| ApiError::Database(e))?;

    Ok(Json(order))
}

/// Update transfer order status request
#[derive(Debug, Deserialize)]
pub struct UpdateTOStatusRequest {
    pub status: String,
    pub picked_quantity: Option<i32>,
}

/// Update transfer order status
pub async fn update_transfer_order_status(
    State(state): State<AppState>,
    Path(to_number): Path<String>,
    Json(request): Json<UpdateTOStatusRequest>,
) -> ApiResult<Json<TransferOrder>> {
    let queries = WarehouseQueries::new(state.db_pool.clone());

    let updated = queries.update_transfer_order_status(
        &to_number,
        &request.status,
        request.picked_quantity,
    )
    .await
    .map_err(|e| ApiError::Database(e))?;

    Ok(Json(updated))
}

/// Get warehouse statistics
pub async fn get_warehouse_stats(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthenticatedUser>,
) -> ApiResult<Json<WarehouseStats>> {
    let queries = WarehouseQueries::new(state.db_pool.clone());
    let org_id = resolve_org_scope(&auth_user);

    let stats = queries.get_warehouse_stats(org_id)
        .await
        .map_err(|e| ApiError::Database(e))?;

    Ok(Json(stats))
}

/// Get pending drone scans
pub async fn get_pending_drone_scans(
    State(state): State<AppState>,
) -> ApiResult<Json<Vec<DroneScan>>> {
    let queries = WarehouseQueries::new(state.db_pool.clone());

    let scans = queries.get_pending_drone_scans()
        .await
        .map_err(|e| ApiError::Database(e))?;

    Ok(Json(scans))
}

/// Material search query parameters
#[derive(Debug, Deserialize)]
pub struct MaterialSearchParams {
    pub q: String,
    #[serde(default = "default_search_limit")]
    pub limit: i64,
}

fn default_search_limit() -> i64 {
    20
}

/// Search materials
pub async fn search_materials(
    State(state): State<AppState>,
    Query(params): Query<MaterialSearchParams>,
) -> ApiResult<Json<Vec<MaterialMaster>>> {
    let queries = WarehouseQueries::new(state.db_pool.clone());

    let materials = queries.search_materials(&params.q, params.limit)
        .await
        .map_err(|e| ApiError::Database(e))?;

    Ok(Json(materials))
}

// ========== HELPERS ==========

/// Resolve the organization scope from the authenticated user context.
///
/// - Service-role callers (e.g. service-to-service) get `None`, which means
///   no organization filter is applied (full cross-org access).
/// - Regular authenticated users get their `organization_id` applied as a
///   mandatory row-level filter so they can only see data belonging to their org.
fn resolve_org_scope(auth_user: &AuthenticatedUser) -> Option<Uuid> {
    if auth_user.role == "service" {
        None
    } else {
        auth_user.organization_id
    }
}
