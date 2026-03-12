//! SmartSheet API Client
//!
//! High-performance async HTTP client for SmartSheet API.
//! Uses reqwest for truly async operations with connection pooling.

use reqwest::{Client, StatusCode};
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tracing::{info, warn, instrument};

use crate::db::models::smartsheet::*;

/// SmartSheet API base URL
const SMARTSHEET_API_BASE: &str = "https://api.smartsheet.com/2.0";

/// Default outbound sheet ID
pub const DEFAULT_OUTBOUND_SHEET_ID: i64 = 4478754962231172;

/// SmartSheet client errors
#[derive(Error, Debug)]
pub enum SmartsheetError {
    #[error("HTTP request failed: {0}")]
    HttpError(#[from] reqwest::Error),
    
    #[error("Authentication failed: {0}")]
    AuthenticationError(String),
    
    #[error("Rate limit exceeded")]
    RateLimitError,
    
    #[error("Resource not found: {0}")]
    NotFoundError(String),
    
    #[error("API error ({status}): {message}")]
    ApiError { status: u16, message: String },
    
    #[error("Configuration error: {0}")]
    ConfigError(String),
    
    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),
}

/// SmartSheet client configuration
#[derive(Clone)]
pub struct SmartsheetConfig {
    pub access_token: String,
    pub timeout_seconds: u64,
    pub max_retries: u32,
}

impl Default for SmartsheetConfig {
    fn default() -> Self {
        Self {
            access_token: String::new(),
            timeout_seconds: 60,
            max_retries: 3,
        }
    }
}

/// High-performance SmartSheet API client
#[derive(Clone)]
pub struct SmartsheetClient {
    client: Client,
    access_token: String,
    _max_retries: u32,
}

impl SmartsheetClient {
    /// Create a new SmartSheet client
    pub fn new(config: SmartsheetConfig) -> Result<Self, SmartsheetError> {
        if config.access_token.is_empty() {
            return Err(SmartsheetError::ConfigError(
                "SmartSheet access token is required".to_string()
            ));
        }
        
        let client = Client::builder()
            .timeout(Duration::from_secs(config.timeout_seconds))
            .pool_max_idle_per_host(10)
            .pool_idle_timeout(Duration::from_secs(90))
            .tcp_keepalive(Duration::from_secs(60))
            .build()
            .map_err(SmartsheetError::HttpError)?;
        
        Ok(Self {
            client,
            access_token: config.access_token,
            _max_retries: config.max_retries,
        })
    }
    
    /// Create from environment variables
    pub fn from_env() -> Result<Self, SmartsheetError> {
        let access_token = std::env::var("SMARTSHEET_ACCESS_TOKEN")
            .map_err(|_| SmartsheetError::ConfigError(
                "SMARTSHEET_ACCESS_TOKEN environment variable not set".to_string()
            ))?;
        
        let config = SmartsheetConfig {
            access_token,
            ..Default::default()
        };
        
        Self::new(config)
    }
    
    /// Build authorization header
    fn auth_header(&self) -> String {
        format!("Bearer {}", self.access_token)
    }
    
    /// Handle API response and errors
    async fn handle_response<T: serde::de::DeserializeOwned>(
        &self,
        response: reqwest::Response,
    ) -> Result<T, SmartsheetError> {
        let status = response.status();
        
        match status {
            StatusCode::OK | StatusCode::CREATED => {
                response.json::<T>().await.map_err(SmartsheetError::HttpError)
            }
            StatusCode::UNAUTHORIZED => {
                let body = response.text().await.unwrap_or_default();
                Err(SmartsheetError::AuthenticationError(body))
            }
            StatusCode::TOO_MANY_REQUESTS => {
                Err(SmartsheetError::RateLimitError)
            }
            StatusCode::NOT_FOUND => {
                let body = response.text().await.unwrap_or_default();
                Err(SmartsheetError::NotFoundError(body))
            }
            _ => {
                let body = response.text().await.unwrap_or_default();
                Err(SmartsheetError::ApiError {
                    status: status.as_u16(),
                    message: body,
                })
            }
        }
    }
    
    /// Execute request with retry logic (planned for future use)
    #[allow(dead_code)]
    async fn execute_with_retry<T, F, Fut>(
        &self,
        operation: F,
    ) -> Result<T, SmartsheetError>
    where
        F: Fn() -> Fut,
        Fut: std::future::Future<Output = Result<T, SmartsheetError>>,
    {
        let mut last_error = None;
        
        for attempt in 0..=self._max_retries {
            match operation().await {
                Ok(result) => return Ok(result),
                Err(SmartsheetError::RateLimitError) => {
                    let delay = Duration::from_millis(1000 * (2_u64.pow(attempt)));
                    warn!("Rate limit hit, retrying in {:?}", delay);
                    tokio::time::sleep(delay).await;
                    last_error = Some(SmartsheetError::RateLimitError);
                }
                Err(e) => {
                    last_error = Some(e);
                    break;
                }
            }
        }
        
        Err(last_error.unwrap_or_else(|| SmartsheetError::ApiError {
            status: 500,
            message: "Unknown error".to_string(),
        }))
    }
    
    // ==================== API METHODS ====================
    
    /// Test connection and get current user
    #[instrument(skip(self))]
    pub async fn get_current_user(&self) -> Result<SmartsheetApiCurrentUser, SmartsheetError> {
        let url = format!("{}/users/me", SMARTSHEET_API_BASE);
        
        let response = self.client
            .get(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(SmartsheetError::HttpError)?;
        
        self.handle_response(response).await
    }
    
    /// Health check - test connection
    #[instrument(skip(self))]
    pub async fn health_check(&self) -> Result<SmartsheetHealthResponse, SmartsheetError> {
        match self.get_current_user().await {
            Ok(user) => Ok(SmartsheetHealthResponse {
                success: true,
                connection_status: "healthy".to_string(),
                user_email: Some(user.email),
                user_id: Some(user.id),
                error: None,
            }),
            Err(e) => Ok(SmartsheetHealthResponse {
                success: false,
                connection_status: "unhealthy".to_string(),
                user_email: None,
                user_id: None,
                error: Some(e.to_string()),
            }),
        }
    }
    
    /// List all accessible sheets
    #[instrument(skip(self))]
    pub async fn list_sheets(
        &self,
        include_all: bool,
        page_size: Option<i64>,
    ) -> Result<SmartsheetApiSheetsResponse, SmartsheetError> {
        let mut url = format!("{}/sheets", SMARTSHEET_API_BASE);
        
        let mut params = vec![];
        if include_all {
            params.push("includeAll=true".to_string());
        }
        if let Some(size) = page_size {
            params.push(format!("pageSize={}", size));
        }
        
        if !params.is_empty() {
            url = format!("{}?{}", url, params.join("&"));
        }
        
        info!("Fetching sheets list from SmartSheet API");
        
        let response = self.client
            .get(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(SmartsheetError::HttpError)?;
        
        self.handle_response(response).await
    }
    
    /// Get sheet with full details
    #[instrument(skip(self))]
    pub async fn get_sheet(
        &self,
        sheet_id: i64,
        level: i64,
        include: Option<&str>,
    ) -> Result<SmartsheetApiSheet, SmartsheetError> {
        let mut url = format!("{}/sheets/{}", SMARTSHEET_API_BASE, sheet_id);
        
        let mut params = vec![format!("level={}", level)];
        if let Some(inc) = include {
            params.push(format!("include={}", inc));
        }
        
        url = format!("{}?{}", url, params.join("&"));
        
        info!(sheet_id = sheet_id, level = level, "Fetching sheet from SmartSheet API");
        
        let start = std::time::Instant::now();
        
        let response = self.client
            .get(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(SmartsheetError::HttpError)?;
        
        let result: SmartsheetApiSheet = self.handle_response(response).await?;
        
        let elapsed = start.elapsed();
        info!(
            sheet_id = sheet_id,
            rows = result.rows.len(),
            columns = result.columns.len(),
            elapsed_ms = elapsed.as_millis() as u64,
            "Fetched sheet from SmartSheet API"
        );
        
        Ok(result)
    }
    
    /// Get sheet and transform to our format
    #[instrument(skip(self))]
    pub async fn get_sheet_transformed(
        &self,
        sheet_id: i64,
        level: i64,
        include: Option<&str>,
    ) -> Result<SheetData, SmartsheetError> {
        let sheet: SmartsheetApiSheet = self.get_sheet(sheet_id, level, include).await?;
        
        let start = std::time::Instant::now();
        let result = sheet.into_sheet_data();
        let elapsed = start.elapsed();
        
        info!(
            sheet_id = sheet_id,
            transform_ms = elapsed.as_millis() as u64,
            "Transformed sheet data"
        );
        
        Ok(result)
    }
    
    /// Import outbound data from SmartSheet
    #[instrument(skip(self))]
    pub async fn import_outbound_data(
        &self,
        sheet_id: Option<i64>,
    ) -> Result<OutboundImportResponse, SmartsheetError> {
        let target_sheet_id = sheet_id.unwrap_or(DEFAULT_OUTBOUND_SHEET_ID);
        
        info!(sheet_id = target_sheet_id, "Starting outbound data import");
        
        let start = std::time::Instant::now();
        
        // Fetch sheet with level 2 (includes rows)
        let sheet: SmartsheetApiSheet = self.get_sheet(target_sheet_id, 2, None).await?;
        
        let fetch_elapsed = start.elapsed();
        info!(
            sheet_id = target_sheet_id,
            fetch_ms = fetch_elapsed.as_millis() as u64,
            rows = sheet.rows.len(),
            "Fetched sheet for import"
        );
        
        // Transform to import format
        let transform_start = std::time::Instant::now();
        let import_data = sheet.into_outbound_import();
        let transform_elapsed = transform_start.elapsed();
        
        info!(
            sheet_id = target_sheet_id,
            transform_ms = transform_elapsed.as_millis() as u64,
            total_rows = import_data.total_rows,
            "Transformed data for import"
        );
        
        let total_elapsed = start.elapsed();
        
        Ok(OutboundImportResponse {
            success: true,
            message: format!(
                "Successfully fetched {} rows from SmartSheet in {}ms",
                import_data.total_rows,
                total_elapsed.as_millis()
            ),
            data: import_data,
        })
    }
    
    // ==================== WRITE OPERATIONS ====================
    
    /// Update cells in a row
    #[instrument(skip(self, cell_updates))]
    pub async fn update_cells(
        &self,
        sheet_id: i64,
        row_id: i64,
        cell_updates: Vec<CellUpdate>,
    ) -> Result<UpdateCellsResponse, SmartsheetError> {
        let url = format!("{}/sheets/{}/rows", SMARTSHEET_API_BASE, sheet_id);
        
        info!(
            sheet_id = sheet_id,
            row_id = row_id,
            cells_count = cell_updates.len(),
            "Updating cells in SmartSheet"
        );
        
        let start = std::time::Instant::now();
        
        // Build the row update payload
        let cells: Vec<serde_json::Value> = cell_updates
            .iter()
            .map(|c| {
                let mut cell = serde_json::json!({
                    "columnId": c.column_id,
                    "value": c.value
                });
                if let Some(ref hyperlink) = c.hyperlink {
                    cell["hyperlink"] = serde_json::json!(hyperlink);
                }
                cell
            })
            .collect();
        
        let payload = serde_json::json!([{
            "id": row_id,
            "cells": cells
        }]);
        
        let response = self.client
            .put(&url)
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(SmartsheetError::HttpError)?;
        
        let status = response.status();
        let elapsed = start.elapsed();
        
        if status.is_success() {
            let result: serde_json::Value = response.json().await
                .map_err(SmartsheetError::HttpError)?;
            
            info!(
                sheet_id = sheet_id,
                row_id = row_id,
                elapsed_ms = elapsed.as_millis() as u64,
                "Cells updated successfully"
            );
            
            Ok(UpdateCellsResponse {
                success: true,
                message: format!("Updated {} cells in {}ms", cell_updates.len(), elapsed.as_millis()),
                updated_cells: cell_updates.len(),
                row_id,
                result: Some(result),
            })
        } else {
            let body = response.text().await.unwrap_or_default();
            Err(SmartsheetError::ApiError {
                status: status.as_u16(),
                message: body,
            })
        }
    }
    
    /// Add rows to a sheet
    #[instrument(skip(self, rows_data))]
    pub async fn add_rows(
        &self,
        sheet_id: i64,
        rows_data: Vec<NewRowData>,
        location: Option<&str>,
    ) -> Result<AddRowsResponse, SmartsheetError> {
        let mut url = format!("{}/sheets/{}/rows", SMARTSHEET_API_BASE, sheet_id);
        
        // Add location parameter
        if let Some(loc) = location {
            let param = match loc {
                "toTop" => "toTop=true",
                "toBottom" => "toBottom=true",
                _ => "toBottom=true",
            };
            url = format!("{}?{}", url, param);
        }
        
        info!(
            sheet_id = sheet_id,
            rows_count = rows_data.len(),
            location = ?location,
            "Adding rows to SmartSheet"
        );
        
        let start = std::time::Instant::now();
        
        // Build the rows payload
        let rows: Vec<serde_json::Value> = rows_data
            .iter()
            .map(|row| {
                let cells: Vec<serde_json::Value> = row.cells
                    .iter()
                    .map(|c| serde_json::json!({
                        "columnId": c.column_id,
                        "value": c.value
                    }))
                    .collect();
                serde_json::json!({
                    "toBottom": true,
                    "cells": cells
                })
            })
            .collect();
        
        let response = self.client
            .post(&url)
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/json")
            .json(&rows)
            .send()
            .await
            .map_err(SmartsheetError::HttpError)?;
        
        let status = response.status();
        let elapsed = start.elapsed();
        
        if status.is_success() {
            let result: serde_json::Value = response.json().await
                .map_err(SmartsheetError::HttpError)?;
            
            info!(
                sheet_id = sheet_id,
                rows_added = rows_data.len(),
                elapsed_ms = elapsed.as_millis() as u64,
                "Rows added successfully"
            );
            
            Ok(AddRowsResponse {
                success: true,
                message: format!("Added {} rows in {}ms", rows_data.len(), elapsed.as_millis()),
                rows_added: rows_data.len(),
                result: Some(result),
            })
        } else {
            let body = response.text().await.unwrap_or_default();
            Err(SmartsheetError::ApiError {
                status: status.as_u16(),
                message: body,
            })
        }
    }
    
    /// Delete rows from a sheet
    #[instrument(skip(self))]
    pub async fn delete_rows(
        &self,
        sheet_id: i64,
        row_ids: Vec<i64>,
        ignore_not_found: bool,
    ) -> Result<DeleteRowsResponse, SmartsheetError> {
        let ids_str = row_ids.iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",");
        
        let mut url = format!("{}/sheets/{}/rows?ids={}", SMARTSHEET_API_BASE, sheet_id, ids_str);
        
        if ignore_not_found {
            url = format!("{}&ignoreRowsNotFound=true", url);
        }
        
        info!(
            sheet_id = sheet_id,
            row_count = row_ids.len(),
            "Deleting rows from SmartSheet"
        );
        
        let start = std::time::Instant::now();
        
        let response = self.client
            .delete(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(SmartsheetError::HttpError)?;
        
        let status = response.status();
        let elapsed = start.elapsed();
        
        if status.is_success() {
            let result: serde_json::Value = response.json().await
                .map_err(SmartsheetError::HttpError)?;
            
            info!(
                sheet_id = sheet_id,
                rows_deleted = row_ids.len(),
                elapsed_ms = elapsed.as_millis() as u64,
                "Rows deleted successfully"
            );
            
            Ok(DeleteRowsResponse {
                success: true,
                message: format!("Deleted {} rows in {}ms", row_ids.len(), elapsed.as_millis()),
                rows_deleted: row_ids.len(),
                result: Some(result),
            })
        } else {
            let body = response.text().await.unwrap_or_default();
            Err(SmartsheetError::ApiError {
                status: status.as_u16(),
                message: body,
            })
        }
    }
    
    // ==================== ATTACHMENT OPERATIONS ====================
    
    /// List row attachments
    #[instrument(skip(self))]
    pub async fn list_row_attachments(
        &self,
        sheet_id: i64,
        row_id: i64,
    ) -> Result<AttachmentsResponse, SmartsheetError> {
        let url = format!("{}/sheets/{}/rows/{}/attachments", SMARTSHEET_API_BASE, sheet_id, row_id);
        
        info!(sheet_id = sheet_id, row_id = row_id, "Listing row attachments");
        
        let response = self.client
            .get(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(SmartsheetError::HttpError)?;
        
        self.handle_response(response).await
    }
    
    /// Attach URL to row
    #[instrument(skip(self))]
    pub async fn attach_url_to_row(
        &self,
        sheet_id: i64,
        row_id: i64,
        url_to_attach: &str,
        name: &str,
    ) -> Result<AttachmentResponse, SmartsheetError> {
        let url = format!("{}/sheets/{}/rows/{}/attachments", SMARTSHEET_API_BASE, sheet_id, row_id);
        
        info!(sheet_id = sheet_id, row_id = row_id, "Attaching URL to row");
        
        let payload = serde_json::json!({
            "attachmentType": "LINK",
            "url": url_to_attach,
            "name": name
        });
        
        let response = self.client
            .post(&url)
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(SmartsheetError::HttpError)?;
        
        self.handle_response(response).await
    }
    
    // ==================== DISCUSSION OPERATIONS ====================
    
    /// List row discussions
    #[instrument(skip(self))]
    pub async fn list_row_discussions(
        &self,
        sheet_id: i64,
        row_id: i64,
    ) -> Result<DiscussionsResponse, SmartsheetError> {
        let url = format!("{}/sheets/{}/rows/{}/discussions?include=comments", SMARTSHEET_API_BASE, sheet_id, row_id);
        
        info!(sheet_id = sheet_id, row_id = row_id, "Listing row discussions");
        
        let response = self.client
            .get(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(SmartsheetError::HttpError)?;
        
        self.handle_response(response).await
    }
    
    /// Create row discussion
    #[instrument(skip(self))]
    pub async fn create_row_discussion(
        &self,
        sheet_id: i64,
        row_id: i64,
        comment_text: &str,
    ) -> Result<DiscussionResponse, SmartsheetError> {
        let url = format!("{}/sheets/{}/rows/{}/discussions", SMARTSHEET_API_BASE, sheet_id, row_id);
        
        info!(sheet_id = sheet_id, row_id = row_id, "Creating row discussion");
        
        let payload = serde_json::json!({
            "comment": {
                "text": comment_text
            }
        });
        
        let response = self.client
            .post(&url)
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(SmartsheetError::HttpError)?;
        
        self.handle_response(response).await
    }
    
    /// Get a specific discussion with all comments
    #[instrument(skip(self))]
    pub async fn get_discussion(
        &self,
        sheet_id: i64,
        discussion_id: i64,
    ) -> Result<DiscussionDetailResponse, SmartsheetError> {
        let url = format!("{}/sheets/{}/discussions/{}", SMARTSHEET_API_BASE, sheet_id, discussion_id);
        
        info!(sheet_id = sheet_id, discussion_id = discussion_id, "Getting discussion");
        
        let response = self.client
            .get(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(SmartsheetError::HttpError)?;
        
        self.handle_response(response).await
    }
    
    /// Add comment to an existing discussion
    #[instrument(skip(self))]
    pub async fn add_comment_to_discussion(
        &self,
        sheet_id: i64,
        discussion_id: i64,
        comment_text: &str,
    ) -> Result<CommentResponse, SmartsheetError> {
        let url = format!("{}/sheets/{}/discussions/{}/comments", SMARTSHEET_API_BASE, sheet_id, discussion_id);
        
        info!(sheet_id = sheet_id, discussion_id = discussion_id, "Adding comment to discussion");
        
        let payload = serde_json::json!({
            "text": comment_text
        });
        
        let response = self.client
            .post(&url)
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(SmartsheetError::HttpError)?;
        
        self.handle_response(response).await
    }
    
    /// Update an existing comment
    #[instrument(skip(self))]
    pub async fn update_comment(
        &self,
        sheet_id: i64,
        comment_id: i64,
        text: &str,
    ) -> Result<CommentResponse, SmartsheetError> {
        let url = format!("{}/sheets/{}/comments/{}", SMARTSHEET_API_BASE, sheet_id, comment_id);
        
        info!(sheet_id = sheet_id, comment_id = comment_id, "Updating comment");
        
        let payload = serde_json::json!({
            "text": text
        });
        
        let response = self.client
            .put(&url)
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(SmartsheetError::HttpError)?;
        
        self.handle_response(response).await
    }
    
    /// Delete a comment
    #[instrument(skip(self))]
    pub async fn delete_comment(
        &self,
        sheet_id: i64,
        comment_id: i64,
    ) -> Result<DeleteResponse, SmartsheetError> {
        let url = format!("{}/sheets/{}/comments/{}", SMARTSHEET_API_BASE, sheet_id, comment_id);
        
        info!(sheet_id = sheet_id, comment_id = comment_id, "Deleting comment");
        
        let response = self.client
            .delete(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(SmartsheetError::HttpError)?;
        
        let status = response.status();
        if status.is_success() {
            Ok(DeleteResponse {
                message: "Comment deleted successfully".to_string(),
                result_code: 0,
            })
        } else {
            let body = response.text().await.unwrap_or_default();
            Err(SmartsheetError::ApiError {
                status: status.as_u16(),
                message: body,
            })
        }
    }
    
    /// Delete a discussion
    #[instrument(skip(self))]
    pub async fn delete_discussion(
        &self,
        sheet_id: i64,
        discussion_id: i64,
    ) -> Result<DeleteResponse, SmartsheetError> {
        let url = format!("{}/sheets/{}/discussions/{}", SMARTSHEET_API_BASE, sheet_id, discussion_id);
        
        info!(sheet_id = sheet_id, discussion_id = discussion_id, "Deleting discussion");
        
        let response = self.client
            .delete(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(SmartsheetError::HttpError)?;
        
        let status = response.status();
        if status.is_success() {
            Ok(DeleteResponse {
                message: "Discussion deleted successfully".to_string(),
                result_code: 0,
            })
        } else {
            let body = response.text().await.unwrap_or_default();
            Err(SmartsheetError::ApiError {
                status: status.as_u16(),
                message: body,
            })
        }
    }
    
    // ==================== ATTACHMENT EXTENDED OPERATIONS ====================
    
    /// Get attachment details (includes download URL)
    #[instrument(skip(self))]
    pub async fn get_attachment(
        &self,
        sheet_id: i64,
        attachment_id: i64,
    ) -> Result<AttachmentDetailResponse, SmartsheetError> {
        let url = format!("{}/sheets/{}/attachments/{}", SMARTSHEET_API_BASE, sheet_id, attachment_id);
        
        info!(sheet_id = sheet_id, attachment_id = attachment_id, "Getting attachment");
        
        let response = self.client
            .get(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(SmartsheetError::HttpError)?;
        
        self.handle_response(response).await
    }
    
    /// Delete an attachment
    #[instrument(skip(self))]
    pub async fn delete_attachment(
        &self,
        sheet_id: i64,
        attachment_id: i64,
    ) -> Result<DeleteResponse, SmartsheetError> {
        let url = format!("{}/sheets/{}/attachments/{}", SMARTSHEET_API_BASE, sheet_id, attachment_id);
        
        info!(sheet_id = sheet_id, attachment_id = attachment_id, "Deleting attachment");
        
        let response = self.client
            .delete(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(SmartsheetError::HttpError)?;
        
        let status = response.status();
        if status.is_success() {
            Ok(DeleteResponse {
                message: "Attachment deleted successfully".to_string(),
                result_code: 0,
            })
        } else {
            let body = response.text().await.unwrap_or_default();
            Err(SmartsheetError::ApiError {
                status: status.as_u16(),
                message: body,
            })
        }
    }
    
    /// List sheet attachments
    #[instrument(skip(self))]
    pub async fn list_sheet_attachments(
        &self,
        sheet_id: i64,
    ) -> Result<AttachmentsResponse, SmartsheetError> {
        let url = format!("{}/sheets/{}/attachments", SMARTSHEET_API_BASE, sheet_id);
        
        info!(sheet_id = sheet_id, "Listing sheet attachments");
        
        let response = self.client
            .get(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(SmartsheetError::HttpError)?;
        
        self.handle_response(response).await
    }
}

/// Optional: SmartSheet client with caching
pub struct CachedSmartsheetClient {
    client: SmartsheetClient,
    cache: Option<Arc<crate::cache::redis_pool::CacheService>>,
}

impl CachedSmartsheetClient {
    pub fn new(
        client: SmartsheetClient,
        cache: Option<Arc<crate::cache::redis_pool::CacheService>>,
    ) -> Self {
        Self { client, cache }
    }
    
    /// Get sheet with caching
    #[instrument(skip(self))]
    pub async fn get_sheet_cached(
        &self,
        sheet_id: i64,
        level: i64,
        ttl_seconds: u64,
    ) -> Result<SheetData, SmartsheetError> {
        let cache_key = format!("smartsheet:sheet:{}:{}", sheet_id, level);
        
        // Try cache first
        if let Some(ref cache) = self.cache {
            if let Ok(Some(cached)) = cache.get::<String>(&cache_key).await {
                info!(sheet_id = sheet_id, "Cache hit for sheet");
                if let Ok(data) = serde_json::from_str::<SheetData>(&cached) {
                    return Ok(data);
                }
            }
        }
        
        // Fetch from API
        let data: SheetData = self.client.get_sheet_transformed(sheet_id, level, None).await?;
        
        // Store in cache
        if let Some(ref cache) = self.cache {
            if let Ok(json) = serde_json::to_string(&data) {
                let _ = cache.set_with_ttl(&cache_key, &json, ttl_seconds).await;
                info!(sheet_id = sheet_id, ttl = ttl_seconds, "Cached sheet data");
            }
        }
        
        Ok(data)
    }
    
    /// Import outbound data with caching
    #[instrument(skip(self))]
    pub async fn import_outbound_data_cached(
        &self,
        sheet_id: Option<i64>,
        ttl_seconds: u64,
    ) -> Result<OutboundImportResponse, SmartsheetError> {
        let target_sheet_id = sheet_id.unwrap_or(DEFAULT_OUTBOUND_SHEET_ID);
        let cache_key = format!("smartsheet:import:{}", target_sheet_id);
        
        // Try cache first
        if let Some(ref cache) = self.cache {
            if let Ok(Some(cached)) = cache.get::<String>(&cache_key).await {
                info!(sheet_id = target_sheet_id, "Cache hit for import data");
                if let Ok(data) = serde_json::from_str::<OutboundImportResponse>(&cached) {
                    return Ok(data);
                }
            }
        }
        
        // Fetch from API
        let response: OutboundImportResponse = self.client.import_outbound_data(sheet_id).await?;
        
        // Store in cache
        if let Some(ref cache) = self.cache {
            if let Ok(json) = serde_json::to_string(&response) {
                let _ = cache.set_with_ttl(&cache_key, &json, ttl_seconds).await;
                info!(sheet_id = target_sheet_id, ttl = ttl_seconds, "Cached import data");
            }
        }
        
        Ok(response)
    }
    
    /// Direct access to underlying client
    pub fn inner(&self) -> &SmartsheetClient {
        &self.client
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_transform_row_to_values() {
        use std::collections::HashMap;
        
        let row = SmartsheetApiRow {
            id: 1,
            row_number: Some(1),
            parent_id: None,
            sibling_id: None,
            cells: vec![
                SmartsheetApiCell {
                    column_id: 100,
                    value: Some(serde_json::json!("Value A")),
                    display_value: Some("Display A".to_string()),
                    hyperlink: None,
                    link_in_from_cell: None,
                },
                SmartsheetApiCell {
                    column_id: 200,
                    value: Some(serde_json::json!(42)),
                    display_value: None,
                    hyperlink: None,
                    link_in_from_cell: None,
                },
            ],
            created_at: None,
            created_by: None,
            modified_at: None,
            modified_by: None,
        };
        
        let mut column_order = HashMap::new();
        column_order.insert(100_i64, 0_usize);
        column_order.insert(200_i64, 1_usize);
        
        let values = super::super::super::db::models::smartsheet::transform_row_to_values(&row, &column_order, 2);
        
        assert_eq!(values.len(), 2);
        assert_eq!(values[0], "Display A");
        assert_eq!(values[1], "42");
    }
}
