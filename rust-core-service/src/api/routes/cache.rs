//! Cache API endpoints

use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::api::error::{ApiError, ApiResult};
use crate::AppState;

/// Cache get response
#[derive(Debug, Serialize)]
pub struct CacheGetResponse {
    pub key: String,
    pub value: Option<String>,
    pub found: bool,
}

/// Get cached value
pub async fn get_cached(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> ApiResult<Json<CacheGetResponse>> {
    let cache_service = state.cache_service.as_ref()
        .ok_or_else(|| ApiError::Cache("Caching is not available".to_string()))?;
    
    let value: Option<String> = cache_service
        .get_raw(&key)
        .await
        .map_err(|e| ApiError::Cache(e.to_string()))?;

    Ok(Json(CacheGetResponse {
        key,
        found: value.is_some(),
        value,
    }))
}

/// Cache set request
#[derive(Debug, Deserialize)]
pub struct CacheSetRequest {
    pub value: String,
    pub ttl_seconds: Option<u64>,
}

/// Cache set response
#[derive(Debug, Serialize)]
pub struct CacheSetResponse {
    pub key: String,
    pub success: bool,
}

/// Set cached value
pub async fn set_cached(
    State(state): State<AppState>,
    Path(key): Path<String>,
    Json(request): Json<CacheSetRequest>,
) -> ApiResult<Json<CacheSetResponse>> {
    let cache_service = state.cache_service.as_ref()
        .ok_or_else(|| ApiError::Cache("Caching is not available".to_string()))?;
    
    let ttl = request.ttl_seconds.map(std::time::Duration::from_secs);

    cache_service
        .set_raw(&key, &request.value, ttl)
        .await
        .map_err(|e| ApiError::Cache(e.to_string()))?;

    Ok(Json(CacheSetResponse {
        key,
        success: true,
    }))
}

/// Cache delete response
#[derive(Debug, Serialize)]
pub struct CacheDeleteResponse {
    pub key: String,
    pub deleted: bool,
}

/// Delete cached value
pub async fn delete_cached(
    State(state): State<AppState>,
    Path(key): Path<String>,
) -> ApiResult<Json<CacheDeleteResponse>> {
    let cache_service = state.cache_service.as_ref()
        .ok_or_else(|| ApiError::Cache("Caching is not available".to_string()))?;
    
    let deleted = cache_service
        .delete(&key)
        .await
        .map_err(|e| ApiError::Cache(e.to_string()))?;

    Ok(Json(CacheDeleteResponse {
        key,
        deleted,
    }))
}

/// Batch get request
#[derive(Debug, Deserialize)]
pub struct BatchGetRequest {
    pub keys: Vec<String>,
}

/// Batch get response
#[derive(Debug, Serialize)]
pub struct BatchGetResponse {
    pub results: Vec<CacheGetResponse>,
}

/// Batch get cached values
pub async fn batch_get(
    State(state): State<AppState>,
    Json(request): Json<BatchGetRequest>,
) -> ApiResult<Json<BatchGetResponse>> {
    let cache_service = state.cache_service.as_ref()
        .ok_or_else(|| ApiError::Cache("Caching is not available".to_string()))?;
    
    let values: Vec<Option<String>> = cache_service
        .batch_get(&request.keys)
        .await
        .map_err(|e| ApiError::Cache(e.to_string()))?;

    let results: Vec<CacheGetResponse> = request.keys
        .into_iter()
        .zip(values.into_iter())
        .map(|(key, value)| CacheGetResponse {
            key,
            found: value.is_some(),
            value,
        })
        .collect();

    Ok(Json(BatchGetResponse { results }))
}
