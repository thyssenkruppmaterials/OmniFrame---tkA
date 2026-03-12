//! Generic query execution endpoint

use axum::{
    extract::State,
    Extension,
    Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

use crate::api::error::{ApiError, ApiResult};
use crate::api::middleware::AuthenticatedUser;
use crate::AppState;

/// Query execution request
#[derive(Debug, Deserialize)]
pub struct QueryRequest {
    /// Name of the query to execute
    pub query_name: String,
    /// Parameters for the query
    #[serde(default)]
    pub parameters: HashMap<String, serde_json::Value>,
}

/// Query execution response
#[derive(Debug, Serialize)]
pub struct QueryResponse {
    /// Query name
    pub query_name: String,
    /// Result data as JSON
    pub data: serde_json::Value,
    /// Number of rows returned
    pub row_count: i64,
    /// Execution time in milliseconds
    pub execution_time_ms: u64,
}

/// Execute a named query
///
/// Supported queries:
/// - warehouse_stats: Get warehouse statistics
/// - inbound_statistics: Get inbound scan statistics
/// - dashboard_stats: Get real-time dashboard statistics
/// - material_search: Search materials (requires: q, limit)
/// - lx03_data: Get LX03 warehouse inventory data (optional: search_query, limit)
/// - lx03_statistics: Get LX03 aggregate statistics
/// - user_permissions: Get user permissions (requires: user_id)
pub async fn execute_query(
    State(state): State<AppState>,
    Extension(auth_user): Extension<AuthenticatedUser>,
    Json(request): Json<QueryRequest>,
) -> ApiResult<Json<QueryResponse>> {
    let start = std::time::Instant::now();

    // Resolve organization scope from auth context.
    // Service-role callers get None (cross-org access); regular users are scoped.
    let org_id = resolve_org_scope(&auth_user);

    let (data, row_count) = match request.query_name.as_str() {
        "warehouse_stats" => {
            let queries = crate::db::queries::warehouse::WarehouseQueries::new(state.db_pool.clone());
            let stats = queries.get_warehouse_stats(org_id)
                .await
                .map_err(|e| ApiError::Database(e))?;
            (serde_json::to_value(stats).unwrap(), 1)
        }

        "inbound_statistics" => {
            let queries = crate::db::queries::warehouse::WarehouseQueries::new(state.db_pool.clone());
            let stats = queries.get_inbound_statistics(org_id)
                .await
                .map_err(|e| ApiError::Database(e))?;
            (serde_json::to_value(stats).unwrap(), 1)
        }

        "dashboard_stats" => {
            let queries = crate::db::queries::productivity::ProductivityQueries::new(state.db_pool.clone());
            let stats = queries.get_realtime_dashboard_stats()
                .await
                .map_err(|e| ApiError::Database(e))?;
            (serde_json::to_value(stats).unwrap(), 1)
        }

        "material_search" => {
            let q = request.parameters.get("q")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ApiError::BadRequest("Missing required parameter: q".to_string()))?;
            
            let limit = request.parameters.get("limit")
                .and_then(|v| v.as_i64())
                .unwrap_or(20);

            let queries = crate::db::queries::warehouse::WarehouseQueries::new(state.db_pool.clone());
            let materials = queries.search_materials(q, limit)
                .await
                .map_err(|e| ApiError::Database(e))?;
            
            let count = materials.len() as i64;
            (serde_json::to_value(materials).unwrap(), count)
        }

        "lx03_data" => {
            let search_query = request.parameters.get("search_query")
                .and_then(|v| v.as_str())
                .map(String::from);
            
            let limit = request.parameters.get("limit")
                .and_then(|v| v.as_i64())
                .unwrap_or(1000);

            let query = crate::db::models::lx03::LX03Query {
                search_query,
                limit: Some(limit),
                offset: Some(0),
                organization_id: org_id,
                ..Default::default()
            };

            let queries = crate::db::queries::lx03::LX03Queries::new(state.db_pool.clone());
            let lx03_records = queries.get_lx03_data(&query)
                .await
                .map_err(|e| ApiError::Database(e))?;
            
            let count = lx03_records.len() as i64;
            tracing::info!("🦀 LX03 query returned {} records", count);
            (serde_json::to_value(lx03_records).unwrap(), count)
        }

        "lx03_statistics" => {
            let queries = crate::db::queries::lx03::LX03Queries::new(state.db_pool.clone());
            let stats = queries.get_lx03_statistics(org_id)
                .await
                .map_err(|e| ApiError::Database(e))?;
            
            tracing::info!("🦀 LX03 statistics: {} total records, {} materials", stats.total, stats.unique_materials);
            (serde_json::to_value(stats).unwrap(), 1)
        }

        "user_permissions" => {
            let user_id = request.parameters.get("user_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ApiError::BadRequest("Missing required parameter: user_id".to_string()))?;

            // Authorization: only self-access or service/admin
            if auth_user.user_id != user_id
                && auth_user.role != "service"
                && !auth_user.permissions.iter().any(|p| p == "admin:*" || p == "users:manage")
            {
                return Err(ApiError::Forbidden(
                    "You can only access your own permissions".to_string(),
                ));
            }

            let permissions = state.rbac_service
                .get_user_permissions(user_id)
                .await
                .map_err(|e| ApiError::Database(e))?;
            
            let count = permissions.len() as i64;
            let perms_vec: Vec<String> = permissions.into_iter().collect();
            (serde_json::to_value(perms_vec).unwrap(), count)
        }

        _ => {
            return Err(ApiError::BadRequest(format!(
                "Unknown query: {}. Supported queries: warehouse_stats, inbound_statistics, dashboard_stats, material_search, lx03_data, lx03_statistics, user_permissions",
                request.query_name
            )));
        }
    };

    let execution_time_ms = start.elapsed().as_millis() as u64;

    // Record metrics
    metrics::histogram!(
        "query.execution_time_ms",
        "query" => request.query_name.clone()
    ).record(execution_time_ms as f64);

    Ok(Json(QueryResponse {
        query_name: request.query_name,
        data,
        row_count,
        execution_time_ms,
    }))
}

/// Resolve the organization scope from the authenticated user context.
///
/// - Service-role callers get `None` (cross-org access).
/// - Regular authenticated users get their `organization_id` applied as a filter.
fn resolve_org_scope(auth_user: &AuthenticatedUser) -> Option<Uuid> {
    if auth_user.role == "service" {
        None
    } else {
        auth_user.organization_id
    }
}
