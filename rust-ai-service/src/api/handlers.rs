//! API Handlers
//! 
//! HTTP endpoint handlers for the AI analysis service.
//! 
//! SECURITY: All handlers except health_check require authentication
//! and validate organization context.

use axum::{
    extract::{Path, State, Extension},
    http::StatusCode,
    Json,
};
use std::sync::Arc;
use uuid::Uuid;

use crate::ai::{WAREHOUSE_ANALYSIS_PROMPT, DAMAGE_DETECTION_PROMPT, BARCODE_FOCUS_PROMPT};
use crate::auth::AuthenticatedUser;
use crate::models::{
    AnalyzeRequest, AnalyzeResponse, BatchAnalyzeRequest, 
    HealthResponse, AnalysisResult,
};
use crate::AppState;

/// Health check endpoint (public - no auth required)
pub async fn health_check(
    State(state): State<Arc<AppState>>,
) -> Json<HealthResponse> {
    // Check database connection
    let db_status = match &state.db {
        Some(pool) => {
            match sqlx::query("SELECT 1").fetch_one(pool).await {
                Ok(_) => "connected".to_string(),
                Err(_) => "disconnected".to_string(),
            }
        }
        None => "not_configured".to_string(),
    };
    
    Json(HealthResponse {
        status: "healthy".to_string(),
        service: "drone-ai-service".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        database: db_status,
        ai_provider: "huggingface".to_string(),
    })
}

/// Analyze a single image (requires authentication)
pub async fn analyze_image(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(request): Json<AnalyzeRequest>,
) -> Result<Json<AnalyzeResponse>, (StatusCode, String)> {
    tracing::info!(
        user_id = %user.user_id,
        organization_id = ?user.organization_id,
        "Processing analyze request"
    );
    
    // Validate organization context matches request (if provided)
    if let Some(req_org) = &request.organization_id {
        if user.organization_id.as_ref() != Some(req_org) && user.role.as_deref() != Some("service") {
            return Err((
                StatusCode::FORBIDDEN,
                "Organization mismatch".to_string()
            ));
        }
    }
    
    let prompt = match request.prompt_type.as_deref() {
        Some("damage") => DAMAGE_DETECTION_PROMPT,
        Some("barcode") => BARCODE_FOCUS_PROMPT,
        _ => WAREHOUSE_ANALYSIS_PROMPT,
    };
    
    match state.ai_service.analyze_with_prompt(&request.image_url, prompt).await {
        Ok(ai_result) => {
            // If scan_id provided, save results to database
            if let Some(scan_id) = request.scan_id {
                if let Err(e) = save_analysis_results(&state, scan_id, &ai_result.result, &ai_result.provider, ai_result.fallback_used, ai_result.processing_time_ms).await {
                    tracing::error!("Failed to save analysis results: {:?}", e);
                }
            }
            
            Ok(Json(AnalyzeResponse {
                success: true,
                scan_id: request.scan_id,
                result: Some(ai_result.result),
                provider: Some(ai_result.provider),
                fallback_used: ai_result.fallback_used,
                processing_time_ms: ai_result.processing_time_ms,
                error: None,
            }))
        }
        Err(e) => {
            tracing::error!("Analysis failed: {:?}", e);
            
            // If scan_id provided, mark as failed
            if let Some(scan_id) = request.scan_id {
                let _ = mark_analysis_failed(&state, scan_id, &e.to_string()).await;
            }
            
            Ok(Json(AnalyzeResponse {
                success: false,
                scan_id: request.scan_id,
                result: None,
                provider: None,
                fallback_used: false,
                processing_time_ms: 0,
                error: Some(e.to_string()),
            }))
        }
    }
}

/// Analyze multiple images (requires authentication)
pub async fn analyze_batch(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(request): Json<BatchAnalyzeRequest>,
) -> Json<Vec<AnalyzeResponse>> {
    tracing::info!(
        user_id = %user.user_id,
        organization_id = ?user.organization_id,
        batch_size = request.images.len(),
        "Processing batch analyze request"
    );
    
    let mut results = Vec::new();
    
    for image_request in request.images {
        // Validate organization context for each image
        if let Some(ref req_org) = image_request.organization_id {
            if user.organization_id.as_ref() != Some(req_org) && user.role.as_deref() != Some("service") {
                results.push(AnalyzeResponse {
                    success: false,
                    scan_id: image_request.scan_id,
                    result: None,
                    provider: None,
                    fallback_used: false,
                    processing_time_ms: 0,
                    error: Some("Organization mismatch".to_string()),
                });
                continue;
            }
        }
        
        let prompt = match image_request.prompt_type.as_deref() {
            Some("damage") => DAMAGE_DETECTION_PROMPT,
            Some("barcode") => BARCODE_FOCUS_PROMPT,
            _ => WAREHOUSE_ANALYSIS_PROMPT,
        };
        
        let response = match state.ai_service.analyze_with_prompt(&image_request.image_url, prompt).await {
            Ok(ai_result) => {
                if let Some(scan_id) = image_request.scan_id {
                    let _ = save_analysis_results(
                        &state, scan_id, &ai_result.result, 
                        &ai_result.provider, ai_result.fallback_used, 
                        ai_result.processing_time_ms
                    ).await;
                }
                
                AnalyzeResponse {
                    success: true,
                    scan_id: image_request.scan_id,
                    result: Some(ai_result.result),
                    provider: Some(ai_result.provider),
                    fallback_used: ai_result.fallback_used,
                    processing_time_ms: ai_result.processing_time_ms,
                    error: None,
                }
            }
            Err(e) => {
                if let Some(scan_id) = image_request.scan_id {
                    let _ = mark_analysis_failed(&state, scan_id, &e.to_string()).await;
                }
                
                AnalyzeResponse {
                    success: false,
                    scan_id: image_request.scan_id,
                    result: None,
                    provider: None,
                    fallback_used: false,
                    processing_time_ms: 0,
                    error: Some(e.to_string()),
                }
            }
        };
        
        results.push(response);
    }
    
    Json(results)
}

/// Process pending scans from the database (requires authentication)
pub async fn process_pending_scans(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    tracing::info!(
        user_id = %user.user_id,
        role = ?user.role,
        "Processing pending scans request"
    );
    
    // This endpoint is typically called by service accounts
    // Verify the caller has appropriate permissions
    if user.role.as_deref() != Some("service") && !user.permissions.contains(&"*".to_string()) {
        // For non-service users, require admin permission
        if !user.permissions.iter().any(|p| p.contains("admin") || p.contains("drone")) {
            return Err((
                StatusCode::FORBIDDEN,
                "Insufficient permissions for this operation".to_string()
            ));
        }
    }
    
    let pool = match &state.db {
        Some(p) => p,
        None => return Err((StatusCode::SERVICE_UNAVAILABLE, "Database not configured. Use REST API mode.".to_string())),
    };
    
    // Get pending scans using the RPC function
    let scans: Vec<(Uuid, String, Uuid)> = sqlx::query_as(
        r#"
        SELECT id, image_url, organization_id 
        FROM get_pending_drone_scans(10)
        "#
    )
    .fetch_all(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    let total = scans.len();
    let mut processed = 0;
    let mut failed = 0;
    
    for (scan_id, image_url, org_id) in scans {
        // For non-service users, only process scans in their organization
        if user.role.as_deref() != Some("service") {
            if user.organization_id.as_ref() != Some(&org_id.to_string()) {
                tracing::debug!(
                    scan_id = %scan_id,
                    scan_org = %org_id,
                    user_org = ?user.organization_id,
                    "Skipping scan from different organization"
                );
                continue;
            }
        }
        
        match state.ai_service.analyze(&image_url).await {
            Ok(ai_result) => {
                if let Err(e) = save_analysis_results(
                    &state, scan_id, &ai_result.result,
                    &ai_result.provider, ai_result.fallback_used,
                    ai_result.processing_time_ms
                ).await {
                    tracing::error!("Failed to save results for {}: {:?}", scan_id, e);
                    failed += 1;
                } else {
                    processed += 1;
                }
            }
            Err(e) => {
                tracing::error!("Analysis failed for {}: {:?}", scan_id, e);
                let _ = mark_analysis_failed(&state, scan_id, &e.to_string()).await;
                failed += 1;
            }
        }
    }
    
    Ok(Json(serde_json::json!({
        "total_found": total,
        "processed": processed,
        "failed": failed,
        "user_id": user.user_id
    })))
}

/// Get scan analysis status (requires authentication)
pub async fn get_scan_status(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(scan_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    tracing::info!(
        user_id = %user.user_id,
        scan_id = %scan_id,
        "Getting scan status"
    );
    
    let pool = match &state.db {
        Some(p) => p,
        None => return Err((StatusCode::SERVICE_UNAVAILABLE, "Database not configured".to_string())),
    };
    
    // Query scan with organization check
    let scan: Option<(String, Option<String>, Option<i32>, Uuid)> = sqlx::query_as(
        r#"
        SELECT ai_analysis_status, ai_model_used, ai_processing_time_ms, organization_id
        FROM drone_scans
        WHERE id = $1
        "#
    )
    .bind(scan_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    
    match scan {
        Some((status, model, time_ms, org_id)) => {
            // Validate organization access (unless service user)
            if user.role.as_deref() != Some("service") {
                if user.organization_id.as_ref() != Some(&org_id.to_string()) {
                    return Err((StatusCode::FORBIDDEN, "Access denied to this scan".to_string()));
                }
            }
            
            Ok(Json(serde_json::json!({
                "scan_id": scan_id,
                "status": status,
                "model_used": model,
                "processing_time_ms": time_ms
            })))
        },
        None => Err((StatusCode::NOT_FOUND, "Scan not found".to_string())),
    }
}

// Helper function to save analysis results
async fn save_analysis_results(
    state: &AppState,
    scan_id: Uuid,
    result: &AnalysisResult,
    provider: &str,
    fallback_used: bool,
    processing_time_ms: u64,
) -> Result<(), sqlx::Error> {
    let pool = match &state.db {
        Some(p) => p,
        None => {
            tracing::warn!("Database not configured, skipping save for scan {}", scan_id);
            return Ok(());
        }
    };
    
    let detected_texts = serde_json::to_value(&result.texts).unwrap_or_default();
    let detected_objects = serde_json::to_value(&result.objects).unwrap_or_default();
    let detected_barcodes = serde_json::to_value(&result.barcodes).unwrap_or_default();
    let inventory_assessment = serde_json::to_value(&result.inventory).ok();
    let raw_text = result.to_searchable_text();
    
    sqlx::query(
        r#"
        SELECT save_drone_scan_analysis(
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
        "#
    )
    .bind(scan_id)
    .bind(provider)
    .bind(detected_texts)
    .bind(detected_objects)
    .bind(detected_barcodes)
    .bind(inventory_assessment)
    .bind(&result.spatial_description)
    .bind(&raw_text)
    .bind(fallback_used)
    .bind(processing_time_ms as i32)
    .execute(pool)
    .await?;
    
    Ok(())
}

// Helper function to mark analysis as failed
async fn mark_analysis_failed(
    state: &AppState,
    scan_id: Uuid,
    error_message: &str,
) -> Result<(), sqlx::Error> {
    let pool = match &state.db {
        Some(p) => p,
        None => {
            tracing::warn!("Database not configured, skipping failure mark for scan {}", scan_id);
            return Ok(());
        }
    };
    
    sqlx::query("SELECT fail_drone_scan_analysis($1, $2)")
        .bind(scan_id)
        .bind(error_message)
        .execute(pool)
        .await?;
    
    Ok(())
}
