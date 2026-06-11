// Created and developed by Jai Singh
//! SmartSheet-related models
//!
//! Models for SmartSheet API integration and data transformation.
//! Designed for high-performance parallel processing.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ==================== SMARTSHEET API MODELS ====================

/// SmartSheet API response for a sheet
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartsheetApiSheet {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub access_level: Option<String>,
    pub columns: Vec<SmartsheetApiColumn>,
    #[serde(default)]
    pub rows: Vec<SmartsheetApiRow>,
    #[serde(default)]
    pub total_row_count: Option<i64>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub modified_at: Option<String>,
    #[serde(default)]
    pub permalink: Option<String>,
    #[serde(default)]
    pub version: Option<i64>,
}

/// SmartSheet column from API
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartsheetApiColumn {
    pub id: i64,
    #[serde(default)]
    pub index: Option<i64>,
    pub title: String,
    #[serde(rename = "type", default)]
    pub column_type: Option<String>,
    #[serde(default)]
    pub primary: Option<bool>,
    #[serde(default)]
    pub validation: Option<bool>,
    #[serde(default)]
    pub width: Option<i64>,
    #[serde(default)]
    pub locked: Option<bool>,
    #[serde(default)]
    pub locked_for_user: Option<bool>,
}

/// SmartSheet row from API
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartsheetApiRow {
    pub id: i64,
    #[serde(default)]
    pub row_number: Option<i64>,
    #[serde(default)]
    pub parent_id: Option<i64>,
    #[serde(default)]
    pub sibling_id: Option<i64>,
    #[serde(default)]
    pub cells: Vec<SmartsheetApiCell>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub created_by: Option<SmartsheetApiUser>,
    #[serde(default)]
    pub modified_at: Option<String>,
    #[serde(default)]
    pub modified_by: Option<SmartsheetApiUser>,
}

/// SmartSheet cell from API
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartsheetApiCell {
    pub column_id: i64,
    #[serde(default)]
    pub value: Option<serde_json::Value>,
    #[serde(default)]
    pub display_value: Option<String>,
    #[serde(default)]
    pub hyperlink: Option<serde_json::Value>,
    #[serde(default)]
    pub link_in_from_cell: Option<serde_json::Value>,
}

/// SmartSheet user info
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartsheetApiUser {
    #[serde(default)]
    pub id: Option<i64>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

/// SmartSheet current user response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartsheetApiCurrentUser {
    pub id: i64,
    pub email: String,
    #[serde(default)]
    pub first_name: Option<String>,
    #[serde(default)]
    pub last_name: Option<String>,
    #[serde(default)]
    pub locale: Option<String>,
    #[serde(default)]
    pub time_zone: Option<String>,
}

/// SmartSheet sheets list response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartsheetApiSheetsResponse {
    pub data: Vec<SmartsheetApiSheetSummary>,
    #[serde(default)]
    pub page_number: Option<i64>,
    #[serde(default)]
    pub page_size: Option<i64>,
    #[serde(default)]
    pub total_pages: Option<i64>,
    #[serde(default)]
    pub total_count: Option<i64>,
}

/// SmartSheet sheet summary (list response)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartsheetApiSheetSummary {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub access_level: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub modified_at: Option<String>,
    #[serde(default)]
    pub permalink: Option<String>,
    #[serde(default)]
    pub version: Option<i64>,
    #[serde(default)]
    pub total_row_count: Option<i64>,
}

// ==================== TRANSFORMED RESPONSE MODELS ====================

/// Transformed sheet response (our format)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SheetResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub sheet: SheetData,
}

/// Sheet data with columns and rows
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SheetData {
    pub id: i64,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_level: Option<String>,
    pub columns: Vec<ColumnData>,
    pub rows: Vec<RowData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_row_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permalink: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
}

/// Column data (our format)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnData {
    pub id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<i64>,
    pub title: String,
    #[serde(rename = "type")]
    pub column_type: String,
    #[serde(default)]
    pub primary: bool,
    #[serde(default)]
    pub validation: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<i64>,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub locked_for_user: bool,
}

/// Row data (our format)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RowData {
    pub id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row_number: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sibling_id: Option<i64>,
    pub cells: Vec<CellData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_by: Option<UserData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_by: Option<UserData>,
}

/// Cell data (our format)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellData {
    pub column_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hyperlink: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_in_from_cell: Option<serde_json::Value>,
}

/// User data (our format)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

// ==================== OUTBOUND IMPORT MODELS ====================

/// Outbound data import response (clipboard-compatible format)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutboundImportResponse {
    pub success: bool,
    pub message: String,
    pub data: OutboundImportData,
}

/// Outbound import data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutboundImportData {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub sheet_id: i64,
    pub sheet_name: String,
    pub total_rows: usize,
    pub columns_count: usize,
}

/// Sheet list response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SheetListResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub sheets: Vec<SheetSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_number: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_size: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_pages: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_count: Option<i64>,
}

/// Sheet summary (our format)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SheetSummary {
    pub id: i64,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_level: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permalink: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_row_count: Option<i64>,
}

/// Health check response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartsheetHealthResponse {
    pub success: bool,
    pub connection_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ==================== WRITE OPERATION MODELS ====================

/// Cell update request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellUpdate {
    pub column_id: i64,
    pub value: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hyperlink: Option<HyperlinkData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clear_hyperlink: Option<bool>,
}

/// Hyperlink data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HyperlinkData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sheet_id: Option<i64>,
}

/// Update cells response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCellsResponse {
    pub success: bool,
    pub message: String,
    pub updated_cells: usize,
    pub row_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
}

/// New row data for adding rows
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewRowData {
    pub cells: Vec<NewCellData>,
}

/// New cell data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewCellData {
    pub column_id: i64,
    pub value: serde_json::Value,
}

/// Add rows response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddRowsResponse {
    pub success: bool,
    pub message: String,
    pub rows_added: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
}

/// Delete rows response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteRowsResponse {
    pub success: bool,
    pub message: String,
    pub rows_deleted: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
}

// ==================== ATTACHMENT MODELS ====================

/// Attachments list response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentsResponse {
    #[serde(default)]
    pub data: Vec<AttachmentData>,
    #[serde(default)]
    pub page_number: Option<i64>,
    #[serde(default)]
    pub page_size: Option<i64>,
    #[serde(default)]
    pub total_pages: Option<i64>,
    #[serde(default)]
    pub total_count: Option<i64>,
}

/// Single attachment response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttachmentResponse {
    pub result: AttachmentData,
}

/// Attachment data
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentData {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub attachment_type: Option<String>,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub size_in_kb: Option<i64>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub created_by: Option<SmartsheetApiUser>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub url_expires_in_millis: Option<i64>,
}

// ==================== DISCUSSION MODELS ====================

/// Discussions list response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscussionsResponse {
    #[serde(default)]
    pub data: Vec<DiscussionData>,
    #[serde(default)]
    pub page_number: Option<i64>,
    #[serde(default)]
    pub page_size: Option<i64>,
    #[serde(default)]
    pub total_pages: Option<i64>,
    #[serde(default)]
    pub total_count: Option<i64>,
}

/// Single discussion response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscussionResponse {
    pub result: DiscussionData,
}

/// Discussion data
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionData {
    pub id: i64,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub created_by: Option<SmartsheetApiUser>,
    #[serde(default)]
    pub modified_at: Option<String>,
    #[serde(default)]
    pub comment_count: Option<i64>,
    #[serde(default)]
    pub comments: Vec<CommentData>,
}

/// Comment data
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentData {
    pub id: i64,
    pub text: String,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub created_by: Option<SmartsheetApiUser>,
    #[serde(default)]
    pub modified_at: Option<String>,
}

/// Single discussion detail response (direct from API)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscussionDetailResponse {
    pub id: i64,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub created_by: Option<SmartsheetApiUser>,
    #[serde(default)]
    pub modified_at: Option<String>,
    #[serde(default)]
    pub comment_count: Option<i64>,
    #[serde(default)]
    pub comments: Vec<CommentData>,
    #[serde(default)]
    pub parent_id: Option<i64>,
    #[serde(default)]
    pub parent_type: Option<String>,
}

/// Single comment response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommentResponse {
    pub result: CommentData,
}

/// Generic delete response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteResponse {
    pub message: String,
    #[serde(default)]
    pub result_code: i32,
}

/// Attachment detail response (includes download URL)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentDetailResponse {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub attachment_type: Option<String>,
    #[serde(default)]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub size_in_kb: Option<i64>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub created_by: Option<SmartsheetApiUser>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub url_expires_in_millis: Option<i64>,
}

// ==================== DASHBOARD STATS MODELS ====================

/// Dashboard statistics response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartsheetDashboardStatsResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub data: SmartsheetDashboardStatsData,
}

/// Dashboard statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartsheetDashboardStatsData {
    pub total_activities: i64,
    pub successful_activities: i64,
    pub unique_sheets_accessed: i64,
    pub active_connections: i64,
    pub recent_sync_jobs: i64,
}

// ==================== QUERY PARAMETERS ====================

/// Sheet query parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SheetQueryParams {
    #[serde(default = "default_level")]
    pub level: i64,
    #[serde(default)]
    pub include: Option<String>,
}

fn default_level() -> i64 {
    2
}

/// Import query parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportQueryParams {
    #[serde(default)]
    pub sheet_id: Option<i64>,
}

// ==================== TRANSFORMATION HELPERS ====================

impl SmartsheetApiSheet {
    /// Transform API sheet to our format with parallel processing
    pub fn into_sheet_data(self) -> SheetData {
        let columns: Vec<ColumnData> = self.columns
            .into_iter()
            .map(|c| c.into_column_data())
            .collect();
        
        // Create column ID map for cell processing
        let _column_ids: std::collections::HashSet<i64> = columns
            .iter()
            .map(|c| c.id)
            .collect();
        
        let rows: Vec<RowData> = self.rows
            .into_iter()
            .map(|r| r.into_row_data())
            .collect();
        
        SheetData {
            id: self.id,
            name: self.name,
            access_level: self.access_level,
            columns,
            rows,
            total_row_count: self.total_row_count,
            created_at: self.created_at,
            modified_at: self.modified_at,
            permalink: self.permalink,
            version: self.version,
        }
    }
    
    /// Transform to outbound import format with parallel processing
    pub fn into_outbound_import(self) -> OutboundImportData {
        let headers: Vec<String> = self.columns
            .iter()
            .map(|c| c.title.clone())
            .collect();
        
        // Build column order map
        let column_order: HashMap<i64, usize> = self.columns
            .iter()
            .enumerate()
            .map(|(i, c)| (c.id, i))
            .collect();
        
        let num_columns = self.columns.len();
        
        // Process rows - this can be parallelized with rayon
        let rows: Vec<Vec<String>> = self.rows
            .into_iter()
            .map(|row| transform_row_to_values(&row, &column_order, num_columns))
            .collect();
        
        OutboundImportData {
            total_rows: rows.len(),
            columns_count: headers.len(),
            headers,
            rows,
            sheet_id: self.id,
            sheet_name: self.name,
        }
    }
}

impl SmartsheetApiColumn {
    pub fn into_column_data(self) -> ColumnData {
        ColumnData {
            id: self.id,
            index: self.index,
            title: self.title,
            column_type: self.column_type.unwrap_or_else(|| "TEXT_NUMBER".to_string()),
            primary: self.primary.unwrap_or(false),
            validation: self.validation.unwrap_or(false),
            width: self.width,
            locked: self.locked.unwrap_or(false),
            locked_for_user: self.locked_for_user.unwrap_or(false),
        }
    }
}

impl SmartsheetApiRow {
    pub fn into_row_data(self) -> RowData {
        let cells: Vec<CellData> = self.cells
            .into_iter()
            .map(|c| c.into_cell_data())
            .collect();
        
        RowData {
            id: self.id,
            row_number: self.row_number,
            parent_id: self.parent_id,
            sibling_id: self.sibling_id,
            cells,
            created_at: self.created_at,
            created_by: self.created_by.map(|u| u.into_user_data()),
            modified_at: self.modified_at,
            modified_by: self.modified_by.map(|u| u.into_user_data()),
        }
    }
}

impl SmartsheetApiCell {
    pub fn into_cell_data(self) -> CellData {
        CellData {
            column_id: self.column_id,
            value: self.value,
            display_value: self.display_value,
            hyperlink: self.hyperlink,
            link_in_from_cell: self.link_in_from_cell,
        }
    }
}

impl SmartsheetApiUser {
    pub fn into_user_data(self) -> UserData {
        UserData {
            id: self.id,
            email: self.email,
            name: self.name,
        }
    }
}

impl SmartsheetApiSheetSummary {
    pub fn into_sheet_summary(self) -> SheetSummary {
        SheetSummary {
            id: self.id,
            name: self.name,
            access_level: self.access_level,
            created_at: self.created_at,
            modified_at: self.modified_at,
            permalink: self.permalink,
            version: self.version,
            total_row_count: self.total_row_count,
        }
    }
}

/// Transform a row to string values in column order
pub fn transform_row_to_values(
    row: &SmartsheetApiRow,
    column_order: &HashMap<i64, usize>,
    num_columns: usize,
) -> Vec<String> {
    // Pre-allocate with empty strings
    let mut values = vec![String::new(); num_columns];
    
    // Build cell map for quick lookup
    let cell_map: HashMap<i64, &SmartsheetApiCell> = row.cells
        .iter()
        .map(|c| (c.column_id, c))
        .collect();
    
    // Fill in values based on column order
    for (column_id, &index) in column_order {
        if let Some(cell) = cell_map.get(column_id) {
            let value = cell.display_value
                .as_ref()
                .cloned()
                .or_else(|| {
                    cell.value.as_ref().map(|v| match v {
                        serde_json::Value::String(s) => s.clone(),
                        serde_json::Value::Number(n) => n.to_string(),
                        serde_json::Value::Bool(b) => b.to_string(),
                        serde_json::Value::Null => String::new(),
                        _ => v.to_string(),
                    })
                })
                .unwrap_or_default();
            
            if index < values.len() {
                values[index] = value;
            }
        }
    }
    
    values
}

// Created and developed by Jai Singh
