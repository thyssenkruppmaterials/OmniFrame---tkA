// Created and developed by Jai Singh
//! SmartSheet API endpoints
//!
//! High-performance SmartSheet operations with parallel processing
//! and Redis caching support.

use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use tracing::{info, instrument};

use crate::api::error::{ApiError, ApiResult};
use crate::api::smartsheet_client::{SmartsheetClient, SmartsheetError, DEFAULT_OUTBOUND_SHEET_ID};
use crate::db::models::smartsheet::{
    SmartsheetHealthResponse, SmartsheetApiSheetsResponse, SmartsheetApiSheetSummary,
    SheetListResponse, SheetSummary, SheetResponse, SheetData, SmartsheetApiSheet, SmartsheetApiCell,
    OutboundImportResponse, CellUpdate, UpdateCellsResponse, NewRowData, AddRowsResponse,
    DeleteRowsResponse, AttachmentsResponse, AttachmentResponse, DiscussionsResponse,
    DiscussionResponse, SmartsheetApiCurrentUser, SmartsheetDashboardStatsResponse,
    SmartsheetDashboardStatsData, DiscussionDetailResponse, CommentResponse, DeleteResponse,
    AttachmentDetailResponse,
};
use crate::AppState;

// ==================== QUERY PARAMETERS ====================

/// Sheet query parameters
#[derive(Debug, Deserialize)]
pub struct GetSheetParams {
    #[serde(default = "default_level")]
    pub level: i64,
    #[serde(default)]
    pub include: Option<String>,
    #[serde(default)]
    pub use_cache: Option<bool>,
    #[serde(default = "default_cache_ttl")]
    pub cache_ttl: u64,
}

fn default_level() -> i64 {
    2
}

fn default_cache_ttl() -> u64 {
    300 // 5 minutes
}

/// Sheet list query parameters
#[derive(Debug, Deserialize)]
pub struct ListSheetsParams {
    #[serde(default = "default_include_all")]
    pub include_all: bool,
    #[serde(default)]
    pub page_size: Option<i64>,
}

fn default_include_all() -> bool {
    true
}

/// Import query parameters
#[derive(Debug, Deserialize)]
pub struct ImportParams {
    #[serde(default)]
    pub sheet_id: Option<i64>,
    #[serde(default)]
    pub use_cache: Option<bool>,
    #[serde(default = "default_import_cache_ttl")]
    pub cache_ttl: u64,
}

fn default_import_cache_ttl() -> u64 {
    180 // 3 minutes for import data
}

// ==================== RESPONSE TYPES ====================

/// Generic API response
#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_time_ms: Option<u64>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T, message: Option<String>, execution_time_ms: Option<u64>) -> Self {
        Self {
            success: true,
            message,
            error: None,
            data: Some(data),
            execution_time_ms,
        }
    }
}

// ==================== ERROR HANDLING ====================

impl From<SmartsheetError> for ApiError {
    fn from(err: SmartsheetError) -> Self {
        match err {
            SmartsheetError::AuthenticationError(msg) => {
                ApiError::Unauthorized(msg)
            }
            SmartsheetError::RateLimitError => {
                ApiError::RateLimited("SmartSheet rate limit exceeded".to_string())
            }
            SmartsheetError::NotFoundError(msg) => {
                ApiError::NotFound(msg)
            }
            SmartsheetError::ConfigError(msg) => {
                ApiError::Internal(format!("Configuration error: {}", msg))
            }
            _ => {
                ApiError::Internal(err.to_string())
            }
        }
    }
}

// ==================== HELPER FUNCTIONS ====================

/// Get or create SmartSheet client
fn get_smartsheet_client() -> Result<SmartsheetClient, ApiError> {
    SmartsheetClient::from_env()
        .map_err(|e| ApiError::Internal(format!("Failed to create SmartSheet client: {}", e)))
}

// ==================== ROUTE HANDLERS ====================

/// Health check for SmartSheet connection
#[instrument(skip_all)]
pub async fn health_check(
    State(_state): State<AppState>,
) -> ApiResult<Json<SmartsheetHealthResponse>> {
    let client = get_smartsheet_client()?;
    
    let response: SmartsheetHealthResponse = client.health_check().await
        .map_err(|e: SmartsheetError| ApiError::Internal(e.to_string()))?;
    
    Ok(Json(response))
}

/// Get current SmartSheet user
#[instrument(skip_all)]
pub async fn get_current_user(
    State(_state): State<AppState>,
) -> ApiResult<Json<ApiResponse<SmartsheetApiCurrentUser>>> {
    let client = get_smartsheet_client()?;
    let start = std::time::Instant::now();
    
    let user: SmartsheetApiCurrentUser = client.get_current_user().await
        .map_err(ApiError::from)?;
    
    let elapsed = start.elapsed().as_millis() as u64;
    
    Ok(Json(ApiResponse::success(
        user,
        Some("User retrieved successfully".to_string()),
        Some(elapsed),
    )))
}

/// List all accessible sheets
#[instrument(skip_all)]
pub async fn list_sheets(
    State(_state): State<AppState>,
    Query(params): Query<ListSheetsParams>,
) -> ApiResult<Json<SheetListResponse>> {
    let client = get_smartsheet_client()?;
    let start = std::time::Instant::now();
    
    info!(include_all = params.include_all, page_size = ?params.page_size, "Listing sheets");
    
    let response: SmartsheetApiSheetsResponse = client.list_sheets(params.include_all, params.page_size).await
        .map_err(ApiError::from)?;
    
    let elapsed = start.elapsed().as_millis() as u64;
    
    // Transform to our format
    let sheets: Vec<SheetSummary> = response.data
        .into_iter()
        .map(|s: SmartsheetApiSheetSummary| s.into_sheet_summary())
        .collect();
    
    info!(
        sheet_count = sheets.len(),
        elapsed_ms = elapsed,
        "Listed sheets successfully"
    );
    
    Ok(Json(SheetListResponse {
        success: true,
        message: Some(format!("Retrieved {} sheets in {}ms", sheets.len(), elapsed)),
        sheets,
        page_number: response.page_number,
        page_size: response.page_size,
        total_pages: response.total_pages,
        total_count: response.total_count,
    }))
}

/// Get sheet with full details
#[instrument(skip_all, fields(sheet_id))]
pub async fn get_sheet(
    State(state): State<AppState>,
    Path(sheet_id): Path<i64>,
    Query(params): Query<GetSheetParams>,
) -> ApiResult<Json<SheetResponse>> {
    let start = std::time::Instant::now();
    let use_cache = params.use_cache.unwrap_or(true);
    
    info!(
        sheet_id = sheet_id,
        level = params.level,
        use_cache = use_cache,
        "Fetching sheet"
    );
    
    let sheet_data: SheetData = if use_cache && state.cache_service.is_some() {
        // Try cache first
        let cache_key = format!("smartsheet:sheet:{}:{}", sheet_id, params.level);
        
        if let Some(ref cache) = state.cache_service {
            if let Ok(Some(cached)) = cache.get::<String>(&cache_key).await {
                info!(sheet_id = sheet_id, "Cache hit for sheet");
                if let Ok(data) = serde_json::from_str::<SheetData>(&cached) {
                    let elapsed = start.elapsed().as_millis() as u64;
                    return Ok(Json(SheetResponse {
                        success: true,
                        message: Some(format!("Retrieved from cache in {}ms", elapsed)),
                        sheet: data,
                    }));
                }
            }
        }
        
        // Cache miss - fetch from API
        let client = get_smartsheet_client()?;
        let data: SheetData = client.get_sheet_transformed(
            sheet_id,
            params.level,
            params.include.as_deref(),
        ).await.map_err(ApiError::from)?;
        
        // Store in cache
        if let Some(ref cache) = state.cache_service {
            if let Ok(json) = serde_json::to_string(&data) {
                let _ = cache.set_with_ttl(&cache_key, &json, params.cache_ttl).await;
            }
        }
        
        data
    } else {
        // No caching - direct fetch
        let client = get_smartsheet_client()?;
        client.get_sheet_transformed(
            sheet_id,
            params.level,
            params.include.as_deref(),
        ).await.map_err(ApiError::from)?
    };
    
    let elapsed = start.elapsed().as_millis() as u64;
    
    info!(
        sheet_id = sheet_id,
        rows = sheet_data.rows.len(),
        columns = sheet_data.columns.len(),
        elapsed_ms = elapsed,
        "Fetched sheet successfully"
    );
    
    Ok(Json(SheetResponse {
        success: true,
        message: Some(format!(
            "Retrieved sheet with {} rows in {}ms",
            sheet_data.rows.len(),
            elapsed
        )),
        sheet: sheet_data,
    }))
}

/// Import outbound data from SmartSheet (high-performance)
#[instrument(skip_all)]
pub async fn import_outbound_data(
    State(state): State<AppState>,
    Query(params): Query<ImportParams>,
) -> ApiResult<Json<OutboundImportResponse>> {
    let start = std::time::Instant::now();
    let target_sheet_id = params.sheet_id.unwrap_or(DEFAULT_OUTBOUND_SHEET_ID);
    let use_cache = params.use_cache.unwrap_or(true);
    
    info!(
        sheet_id = target_sheet_id,
        use_cache = use_cache,
        "Starting outbound data import"
    );
    
    // Check cache first if enabled
    if use_cache && state.cache_service.is_some() {
        let cache_key = format!("smartsheet:import:{}", target_sheet_id);
        
        if let Some(ref cache) = state.cache_service {
            if let Ok(Some(cached)) = cache.get::<String>(&cache_key).await {
                info!(sheet_id = target_sheet_id, "Cache hit for import data");
                if let Ok(mut response) = serde_json::from_str::<OutboundImportResponse>(&cached) {
                    let elapsed = start.elapsed().as_millis() as u64;
                    response.message = format!(
                        "Retrieved {} rows from cache in {}ms",
                        response.data.total_rows,
                        elapsed
                    );
                    return Ok(Json(response));
                }
            }
        }
    }
    
    // Fetch from SmartSheet API
    let client = get_smartsheet_client()?;
    let response: OutboundImportResponse = client.import_outbound_data(params.sheet_id).await
        .map_err(ApiError::from)?;
    
    // Cache the result
    if use_cache {
        if let Some(ref cache) = state.cache_service {
            let cache_key = format!("smartsheet:import:{}", target_sheet_id);
            if let Ok(json) = serde_json::to_string(&response) {
                let _ = cache.set_with_ttl(&cache_key, &json, params.cache_ttl).await;
                info!(
                    sheet_id = target_sheet_id,
                    ttl = params.cache_ttl,
                    "Cached import data"
                );
            }
        }
    }
    
    let elapsed = start.elapsed().as_millis() as u64;
    
    info!(
        sheet_id = target_sheet_id,
        rows = response.data.total_rows,
        elapsed_ms = elapsed,
        "Completed outbound data import"
    );
    
    Ok(Json(response))
}

/// Clear SmartSheet cache (admin operation)
#[instrument(skip_all, fields(pattern))]
pub async fn clear_cache(
    State(state): State<AppState>,
    Path(pattern): Path<String>,
) -> ApiResult<Json<ApiResponse<()>>> {
    info!(pattern = %pattern, "Clearing SmartSheet cache");
    
    if let Some(ref cache) = state.cache_service {
        // Clear specific pattern
        let cache_key = format!("smartsheet:{}", pattern);
        let _ = cache.delete(&cache_key).await;
        
        Ok(Json(ApiResponse::success(
            (),
            Some(format!("Cache cleared for pattern: {}", pattern)),
            None,
        )))
    } else {
        Ok(Json(ApiResponse::success(
            (),
            Some("Cache not available".to_string()),
            None,
        )))
    }
}

/// Get SmartSheet statistics
#[instrument(skip_all, fields(sheet_id))]
pub async fn get_statistics(
    State(_state): State<AppState>,
    Path(sheet_id): Path<i64>,
) -> ApiResult<Json<ApiResponse<SheetStatistics>>> {
    let client = get_smartsheet_client()?;
    let start = std::time::Instant::now();
    
    // Get sheet with minimal data
    let sheet: SmartsheetApiSheet = client.get_sheet(sheet_id, 2, None).await
        .map_err(ApiError::from)?;
    
    let elapsed = start.elapsed().as_millis() as u64;
    
    // Calculate statistics
    let total_rows = sheet.rows.len();
    let total_columns = sheet.columns.len();
    
    // Count non-empty cells
    let non_empty_cells: usize = sheet.rows.iter()
        .flat_map(|r| &r.cells)
        .filter(|c: &&SmartsheetApiCell| {
            c.value.as_ref().map(|v: &serde_json::Value| !v.is_null()).unwrap_or(false) ||
            c.display_value.as_ref().map(|v: &String| !v.is_empty()).unwrap_or(false)
        })
        .count();
    
    let stats = SheetStatistics {
        sheet_id,
        sheet_name: sheet.name,
        total_rows,
        total_columns,
        non_empty_cells,
        last_modified: sheet.modified_at,
        version: sheet.version,
    };
    
    Ok(Json(ApiResponse::success(
        stats,
        Some(format!("Statistics calculated in {}ms", elapsed)),
        Some(elapsed),
    )))
}

/// Sheet statistics response
#[derive(Debug, Serialize)]
pub struct SheetStatistics {
    pub sheet_id: i64,
    pub sheet_name: String,
    pub total_rows: usize,
    pub total_columns: usize,
    pub non_empty_cells: usize,
    pub last_modified: Option<String>,
    pub version: Option<i64>,
}

// ==================== WRITE OPERATION HANDLERS ====================

/// Request body for cell updates
#[derive(Debug, Deserialize)]
pub struct UpdateCellsRequest {
    pub cell_updates: Vec<CellUpdate>,
}

/// Update cells in a row
#[instrument(skip_all, fields(sheet_id, row_id))]
pub async fn update_cells(
    State(state): State<AppState>,
    Path((sheet_id, row_id)): Path<(i64, i64)>,
    Json(request): Json<UpdateCellsRequest>,
) -> ApiResult<Json<UpdateCellsResponse>> {
    let client = get_smartsheet_client()?;
    let start = std::time::Instant::now();
    
    info!(
        sheet_id = sheet_id,
        row_id = row_id,
        cells_count = request.cell_updates.len(),
        "Updating cells"
    );
    
    let response = client.update_cells(sheet_id, row_id, request.cell_updates).await
        .map_err(ApiError::from)?;
    
    // Clear cache for this sheet after update
    if let Some(ref cache) = state.cache_service {
        let cache_key = format!("smartsheet:sheet:{}:*", sheet_id);
        let _ = cache.delete(&cache_key).await;
        info!(sheet_id = sheet_id, "Cleared sheet cache after cell update");
    }
    
    let elapsed = start.elapsed().as_millis() as u64;
    info!(
        sheet_id = sheet_id,
        row_id = row_id,
        elapsed_ms = elapsed,
        "Cells updated successfully"
    );
    
    Ok(Json(response))
}

/// Request body for adding rows
#[derive(Debug, Deserialize)]
pub struct AddRowsRequest {
    pub rows_data: Vec<NewRowData>,
    #[serde(default)]
    pub location: Option<String>,
}

/// Add rows to a sheet
#[instrument(skip_all, fields(sheet_id))]
pub async fn add_rows(
    State(state): State<AppState>,
    Path(sheet_id): Path<i64>,
    Json(request): Json<AddRowsRequest>,
) -> ApiResult<Json<AddRowsResponse>> {
    let client = get_smartsheet_client()?;
    let start = std::time::Instant::now();
    
    info!(
        sheet_id = sheet_id,
        rows_count = request.rows_data.len(),
        location = ?request.location,
        "Adding rows"
    );
    
    let response = client.add_rows(
        sheet_id,
        request.rows_data,
        request.location.as_deref(),
    ).await.map_err(ApiError::from)?;
    
    // Clear cache for this sheet after adding rows
    if let Some(ref cache) = state.cache_service {
        let cache_key = format!("smartsheet:sheet:{}:*", sheet_id);
        let _ = cache.delete(&cache_key).await;
        info!(sheet_id = sheet_id, "Cleared sheet cache after adding rows");
    }
    
    let elapsed = start.elapsed().as_millis() as u64;
    info!(
        sheet_id = sheet_id,
        elapsed_ms = elapsed,
        "Rows added successfully"
    );
    
    Ok(Json(response))
}

/// Request body for deleting rows
#[derive(Debug, Deserialize)]
pub struct DeleteRowsRequest {
    pub row_ids: Vec<i64>,
    #[serde(default)]
    pub ignore_not_found: Option<bool>,
}

/// Delete rows from a sheet
#[instrument(skip_all, fields(sheet_id))]
pub async fn delete_rows(
    State(state): State<AppState>,
    Path(sheet_id): Path<i64>,
    Json(request): Json<DeleteRowsRequest>,
) -> ApiResult<Json<DeleteRowsResponse>> {
    let client = get_smartsheet_client()?;
    let start = std::time::Instant::now();
    
    info!(
        sheet_id = sheet_id,
        rows_count = request.row_ids.len(),
        "Deleting rows"
    );
    
    let response = client.delete_rows(
        sheet_id,
        request.row_ids,
        request.ignore_not_found.unwrap_or(false),
    ).await.map_err(ApiError::from)?;
    
    // Clear cache for this sheet after deleting rows
    if let Some(ref cache) = state.cache_service {
        let cache_key = format!("smartsheet:sheet:{}:*", sheet_id);
        let _ = cache.delete(&cache_key).await;
        info!(sheet_id = sheet_id, "Cleared sheet cache after deleting rows");
    }
    
    let elapsed = start.elapsed().as_millis() as u64;
    info!(
        sheet_id = sheet_id,
        elapsed_ms = elapsed,
        "Rows deleted successfully"
    );
    
    Ok(Json(response))
}

// ==================== ATTACHMENT HANDLERS ====================

/// List row attachments
#[instrument(skip_all, fields(sheet_id, row_id))]
pub async fn list_row_attachments(
    State(_state): State<AppState>,
    Path((sheet_id, row_id)): Path<(i64, i64)>,
) -> ApiResult<Json<ApiResponse<AttachmentsResponse>>> {
    let client = get_smartsheet_client()?;
    let start = std::time::Instant::now();
    
    info!(sheet_id = sheet_id, row_id = row_id, "Listing row attachments");
    
    let response = client.list_row_attachments(sheet_id, row_id).await
        .map_err(ApiError::from)?;
    
    let elapsed = start.elapsed().as_millis() as u64;
    
    Ok(Json(ApiResponse::success(
        response,
        Some(format!("Retrieved attachments in {}ms", elapsed)),
        Some(elapsed),
    )))
}

/// Request body for attaching URL
#[derive(Debug, Deserialize)]
pub struct AttachUrlRequest {
    pub url: String,
    pub name: String,
}

/// Attach URL to row
#[instrument(skip_all, fields(sheet_id, row_id))]
pub async fn attach_url_to_row(
    State(_state): State<AppState>,
    Path((sheet_id, row_id)): Path<(i64, i64)>,
    Json(request): Json<AttachUrlRequest>,
) -> ApiResult<Json<ApiResponse<AttachmentResponse>>> {
    let client = get_smartsheet_client()?;
    let start = std::time::Instant::now();
    
    info!(sheet_id = sheet_id, row_id = row_id, "Attaching URL to row");
    
    let response = client.attach_url_to_row(sheet_id, row_id, &request.url, &request.name).await
        .map_err(ApiError::from)?;
    
    let elapsed = start.elapsed().as_millis() as u64;
    
    Ok(Json(ApiResponse::success(
        response,
        Some("URL attached successfully".to_string()),
        Some(elapsed),
    )))
}

// ==================== DISCUSSION HANDLERS ====================

/// List row discussions
#[instrument(skip_all, fields(sheet_id, row_id))]
pub async fn list_row_discussions(
    State(_state): State<AppState>,
    Path((sheet_id, row_id)): Path<(i64, i64)>,
) -> ApiResult<Json<ApiResponse<DiscussionsResponse>>> {
    let client = get_smartsheet_client()?;
    let start = std::time::Instant::now();
    
    info!(sheet_id = sheet_id, row_id = row_id, "Listing row discussions");
    
    let response = client.list_row_discussions(sheet_id, row_id).await
        .map_err(ApiError::from)?;
    
    let elapsed = start.elapsed().as_millis() as u64;
    
    Ok(Json(ApiResponse::success(
        response,
        Some(format!("Retrieved discussions in {}ms", elapsed)),
        Some(elapsed),
    )))
}

/// Request body for creating discussion
#[derive(Debug, Deserialize)]
pub struct CreateDiscussionRequest {
    pub comment: String,
}

/// Create row discussion
#[instrument(skip_all, fields(sheet_id, row_id))]
pub async fn create_row_discussion(
    State(_state): State<AppState>,
    Path((sheet_id, row_id)): Path<(i64, i64)>,
    Json(request): Json<CreateDiscussionRequest>,
) -> ApiResult<Json<ApiResponse<DiscussionResponse>>> {
    let client = get_smartsheet_client()?;
    let start = std::time::Instant::now();
    
    info!(sheet_id = sheet_id, row_id = row_id, "Creating row discussion");
    
    let response = client.create_row_discussion(sheet_id, row_id, &request.comment).await
        .map_err(ApiError::from)?;
    
    let elapsed = start.elapsed().as_millis() as u64;
    
    Ok(Json(ApiResponse::success(
        response,
        Some("Discussion created successfully".to_string()),
        Some(elapsed),
    )))
}

/// Get a specific discussion with all comments
#[instrument(skip_all, fields(sheet_id, discussion_id))]
pub async fn get_discussion(
    State(_state): State<AppState>,
    Path((sheet_id, discussion_id)): Path<(i64, i64)>,
) -> ApiResult<Json<ApiResponse<DiscussionDetailResponse>>> {
    let client = get_smartsheet_client()?;
    let start = std::time::Instant::now();
    
    info!(sheet_id = sheet_id, discussion_id = discussion_id, "Getting discussion");
    
    let response = client.get_discussion(sheet_id, discussion_id).await
        .map_err(ApiError::from)?;
    
    let elapsed = start.elapsed().as_millis() as u64;
    
    Ok(Json(ApiResponse::success(
        response,
        Some(format!("Retrieved discussion in {}ms", elapsed)),
        Some(elapsed),
    )))
}

/// Request body for adding comment
#[derive(Debug, Deserialize)]
pub struct AddCommentRequest {
    pub text: String,
}

/// Add comment to discussion
#[instrument(skip_all, fields(sheet_id, discussion_id))]
pub async fn add_comment_to_discussion(
    State(_state): State<AppState>,
    Path((sheet_id, discussion_id)): Path<(i64, i64)>,
    Json(request): Json<AddCommentRequest>,
) -> ApiResult<Json<ApiResponse<CommentResponse>>> {
    let client = get_smartsheet_client()?;
    let start = std::time::Instant::now();
    
    info!(sheet_id = sheet_id, discussion_id = discussion_id, "Adding comment to discussion");
    
    let response = client.add_comment_to_discussion(sheet_id, discussion_id, &request.text).await
        .map_err(ApiError::from)?;
    
    let elapsed = start.elapsed().as_millis() as u64;
    
    Ok(Json(ApiResponse::success(
        response,
        Some("Comment added successfully".to_string()),
        Some(elapsed),
    )))
}

/// Update comment
#[instrument(skip_all, fields(sheet_id, comment_id))]
pub async fn update_comment(
    State(_state): State<AppState>,
    Path((sheet_id, comment_id)): Path<(i64, i64)>,
    Json(request): Json<AddCommentRequest>,
) -> ApiResult<Json<ApiResponse<CommentResponse>>> {
    let client = get_smartsheet_client()?;
    let start = std::time::Instant::now();
    
    info!(sheet_id = sheet_id, comment_id = comment_id, "Updating comment");
    
    let response = client.update_comment(sheet_id, comment_id, &request.text).await
        .map_err(ApiError::from)?;
    
    let elapsed = start.elapsed().as_millis() as u64;
    
    Ok(Json(ApiResponse::success(
        response,
        Some("Comment updated successfully".to_string()),
        Some(elapsed),
    )))
}

/// Delete comment
#[instrument(skip_all, fields(sheet_id, comment_id))]
pub async fn delete_comment(
    State(_state): State<AppState>,
    Path((sheet_id, comment_id)): Path<(i64, i64)>,
) -> ApiResult<Json<ApiResponse<DeleteResponse>>> {
    let client = get_smartsheet_client()?;
    let start = std::time::Instant::now();
    
    info!(sheet_id = sheet_id, comment_id = comment_id, "Deleting comment");
    
    let response = client.delete_comment(sheet_id, comment_id).await
        .map_err(ApiError::from)?;
    
    let elapsed = start.elapsed().as_millis() as u64;
    
    Ok(Json(ApiResponse::success(
        response,
        Some("Comment deleted successfully".to_string()),
        Some(elapsed),
    )))
}

/// Delete discussion
#[instrument(skip_all, fields(sheet_id, discussion_id))]
pub async fn delete_discussion(
    State(_state): State<AppState>,
    Path((sheet_id, discussion_id)): Path<(i64, i64)>,
) -> ApiResult<Json<ApiResponse<DeleteResponse>>> {
    let client = get_smartsheet_client()?;
    let start = std::time::Instant::now();
    
    info!(sheet_id = sheet_id, discussion_id = discussion_id, "Deleting discussion");
    
    let response = client.delete_discussion(sheet_id, discussion_id).await
        .map_err(ApiError::from)?;
    
    let elapsed = start.elapsed().as_millis() as u64;
    
    Ok(Json(ApiResponse::success(
        response,
        Some("Discussion deleted successfully".to_string()),
        Some(elapsed),
    )))
}

// ==================== ATTACHMENT EXTENDED HANDLERS ====================

/// Get attachment details (includes download URL)
#[instrument(skip_all, fields(sheet_id, attachment_id))]
pub async fn get_attachment(
    State(_state): State<AppState>,
    Path((sheet_id, attachment_id)): Path<(i64, i64)>,
) -> ApiResult<Json<ApiResponse<AttachmentDetailResponse>>> {
    let client = get_smartsheet_client()?;
    let start = std::time::Instant::now();
    
    info!(sheet_id = sheet_id, attachment_id = attachment_id, "Getting attachment");
    
    let response = client.get_attachment(sheet_id, attachment_id).await
        .map_err(ApiError::from)?;
    
    let elapsed = start.elapsed().as_millis() as u64;
    
    Ok(Json(ApiResponse::success(
        response,
        Some(format!("Retrieved attachment in {}ms", elapsed)),
        Some(elapsed),
    )))
}

/// Delete attachment
#[instrument(skip_all, fields(sheet_id, attachment_id))]
pub async fn delete_attachment(
    State(_state): State<AppState>,
    Path((sheet_id, attachment_id)): Path<(i64, i64)>,
) -> ApiResult<Json<ApiResponse<DeleteResponse>>> {
    let client = get_smartsheet_client()?;
    let start = std::time::Instant::now();
    
    info!(sheet_id = sheet_id, attachment_id = attachment_id, "Deleting attachment");
    
    let response = client.delete_attachment(sheet_id, attachment_id).await
        .map_err(ApiError::from)?;
    
    let elapsed = start.elapsed().as_millis() as u64;
    
    Ok(Json(ApiResponse::success(
        response,
        Some("Attachment deleted successfully".to_string()),
        Some(elapsed),
    )))
}

/// List sheet attachments
#[instrument(skip_all, fields(sheet_id))]
pub async fn list_sheet_attachments(
    State(_state): State<AppState>,
    Path(sheet_id): Path<i64>,
) -> ApiResult<Json<ApiResponse<AttachmentsResponse>>> {
    let client = get_smartsheet_client()?;
    let start = std::time::Instant::now();
    
    info!(sheet_id = sheet_id, "Listing sheet attachments");
    
    let response = client.list_sheet_attachments(sheet_id).await
        .map_err(ApiError::from)?;
    
    let elapsed = start.elapsed().as_millis() as u64;
    
    Ok(Json(ApiResponse::success(
        response,
        Some(format!("Retrieved attachments in {}ms", elapsed)),
        Some(elapsed),
    )))
}

// ==================== DASHBOARD STATS HANDLER ====================

/// Get dashboard statistics
#[instrument(skip_all)]
pub async fn get_dashboard_stats(
    State(_state): State<AppState>,
) -> ApiResult<Json<SmartsheetDashboardStatsResponse>> {
    let client = get_smartsheet_client()?;
    let start = std::time::Instant::now();
    
    info!("Fetching dashboard statistics");
    
    // Get sheets to calculate statistics
    let sheets_response = client.list_sheets(true, None).await
        .map_err(ApiError::from)?;
    
    let elapsed = start.elapsed().as_millis() as u64;
    
    // Calculate basic statistics
    let stats = SmartsheetDashboardStatsData {
        total_activities: 0, // Would need activity tracking
        successful_activities: 0,
        unique_sheets_accessed: sheets_response.data.len() as i64,
        active_connections: 1, // We have one configured connection
        recent_sync_jobs: 0, // Would need job tracking
    };
    
    info!(
        sheets_count = sheets_response.data.len(),
        elapsed_ms = elapsed,
        "Dashboard stats calculated"
    );
    
    Ok(Json(SmartsheetDashboardStatsResponse {
        success: true,
        message: Some(format!("Statistics retrieved in {}ms", elapsed)),
        data: stats,
    }))
}

// Created and developed by Jai Singh
