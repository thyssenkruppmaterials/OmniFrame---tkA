//! Service-to-service API key authentication
//!
//! This module provides secure internal authentication for microservices
//! communicating with rust-core-service.
//!
//! ## API Key Format
//! Keys follow the format: `omf_{service}_{random_32_chars}`
//! Example: `omf_ai_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`
//!
//! ## Security
//! - Keys are never stored in plaintext
//! - SHA-256 hashing for key validation
//! - Rate limiting per service
//! - Audit logging for all key usage
//!
//! Created: January 27, 2026
//! Part of: Comprehensive Authentication Security Overhaul - Phase 1

use axum::http::HeaderMap;
use ring::digest::{digest, SHA256};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{instrument, warn};

/// API key format: omf_{service}_{random_32_chars}
/// The prefix is always 8 characters for consistent extraction
const KEY_PREFIX_LENGTH: usize = 8;

/// Errors that can occur during API key validation
#[derive(Debug, Error)]
pub enum ApiKeyError {
    #[error("Missing X-Service-Key header")]
    MissingHeader,

    #[error("Invalid API key format")]
    InvalidFormat,

    #[error("API key not found or inactive")]
    NotFound,

    #[error("API key expired")]
    Expired,

    #[error("Rate limit exceeded")]
    RateLimitExceeded,

    #[error("Insufficient permissions for this operation")]
    InsufficientPermissions,

    #[error("Database error: {0}")]
    DatabaseError(String),
}

/// Represents a stored service API key (without the actual key)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceApiKey {
    pub id: String,
    pub service_name: String,
    pub permissions: Vec<String>,
    pub rate_limit_per_minute: i32,
}

/// Represents a validated service after successful API key validation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidatedService {
    pub service_name: String,
    pub permissions: Vec<String>,
}

/// Extract and hash API key for validation
///
/// # Arguments
/// * `api_key` - The full API key string
///
/// # Returns
/// * `Ok((prefix, hash))` - The 8-character prefix and SHA-256 hash
/// * `Err(ApiKeyError)` - If the key format is invalid
///
/// # Example
/// ```ignore
/// let (prefix, hash) = extract_key_parts("omf_ai_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6")?;
/// assert_eq!(prefix, "omf_ai_");
/// assert_eq!(hash.len(), 64); // SHA-256 produces 64 hex chars
/// ```
pub fn extract_key_parts(api_key: &str) -> Result<(String, String), ApiKeyError> {
    // Expected format: omf_{service}_{32chars}
    if !api_key.starts_with("omf_") {
        return Err(ApiKeyError::InvalidFormat);
    }

    if api_key.len() < 12 {
        return Err(ApiKeyError::InvalidFormat);
    }

    let prefix = api_key[..KEY_PREFIX_LENGTH].to_string();

    // Hash the full key using ring's SHA-256
    let hash_bytes = digest(&SHA256, api_key.as_bytes());
    let hash = hex_encode(hash_bytes.as_ref());

    Ok((prefix, hash))
}

/// Convert bytes to hex string
fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// API Key validator with database lookup
pub struct ApiKeyValidator {
    pool: sqlx::PgPool,
}

impl ApiKeyValidator {
    /// Create a new API key validator with a database connection pool
    pub fn new(pool: sqlx::PgPool) -> Self {
        Self { pool }
    }

    /// Validate an API key against the database
    ///
    /// # Arguments
    /// * `api_key` - The full API key to validate
    ///
    /// # Returns
    /// * `Ok(ValidatedService)` - If the key is valid
    /// * `Err(ApiKeyError)` - If validation fails
    #[instrument(skip(self, api_key))]
    pub async fn validate(&self, api_key: &str) -> Result<ValidatedService, ApiKeyError> {
        let (prefix, hash) = extract_key_parts(api_key)?;

        // Query database for key validation using the validate_service_api_key function
        let result = sqlx::query_as::<_, (bool, String, sqlx::types::Json<Vec<String>>, i32)>(
            r#"
            SELECT is_valid, service_name, permissions, rate_limit
            FROM validate_service_api_key($1, $2)
            "#,
        )
        .bind(&prefix)
        .bind(&hash)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| ApiKeyError::DatabaseError(e.to_string()))?;

        match result {
            Some((true, service_name, permissions, _rate_limit)) => {
                metrics::counter!("auth.api_key.validated").increment(1);
                Ok(ValidatedService {
                    service_name,
                    permissions: permissions.0,
                })
            }
            _ => {
                metrics::counter!("auth.api_key.rejected").increment(1);
                warn!(key_prefix = %prefix, "API key validation failed");
                Err(ApiKeyError::NotFound)
            }
        }
    }

    /// Check if a validated service has a specific permission
    ///
    /// # Arguments
    /// * `service` - The validated service
    /// * `required` - The required permission string
    ///
    /// # Returns
    /// `true` if the service has the permission, `false` otherwise
    ///
    /// # Permission Matching Rules
    /// - Exact match: `"auth:validate"` matches `"auth:validate"`
    /// - Wildcard `"*"`: Matches everything
    /// - Scoped wildcard: `"auth:*"` matches `"auth:validate"`, `"auth:permissions"`, etc.
    pub fn check_permission(service: &ValidatedService, required: &str) -> bool {
        service.permissions.iter().any(|p| {
            // Exact match
            p == "*"
                || p == required
                || {
                    // Check wildcard permissions like "auth:*"
                    if let Some(prefix) = p.strip_suffix(":*") {
                        required.starts_with(prefix) && required.len() > prefix.len()
                    } else if let Some(prefix) = p.strip_suffix("*") {
                        required.starts_with(prefix)
                    } else {
                        false
                    }
                }
        })
    }

    /// Validate API key and check specific permission in one call
    #[instrument(skip(self, api_key))]
    pub async fn validate_with_permission(
        &self,
        api_key: &str,
        required_permission: &str,
    ) -> Result<ValidatedService, ApiKeyError> {
        let service = self.validate(api_key).await?;

        if !Self::check_permission(&service, required_permission) {
            warn!(
                service_name = %service.service_name,
                required = %required_permission,
                "Service lacks required permission"
            );
            return Err(ApiKeyError::InsufficientPermissions);
        }

        Ok(service)
    }
}

/// Extract X-Service-Key header from request headers
///
/// # Arguments
/// * `headers` - The HTTP headers from the request
///
/// # Returns
/// * `Ok(&str)` - The API key value
/// * `Err(ApiKeyError::MissingHeader)` - If the header is not present
pub fn extract_service_key(headers: &HeaderMap) -> Result<&str, ApiKeyError> {
    headers
        .get("X-Service-Key")
        .and_then(|v| v.to_str().ok())
        .ok_or(ApiKeyError::MissingHeader)
}

/// Configuration for allowed services and their default permissions
#[derive(Debug, Clone)]
pub struct AllowedServices {
    pub services: Vec<AllowedService>,
}

/// Represents an allowed service configuration
#[derive(Debug, Clone)]
pub struct AllowedService {
    pub name: String,
    pub permissions: Vec<String>,
}

impl Default for AllowedServices {
    fn default() -> Self {
        Self {
            services: vec![
                AllowedService {
                    name: "rust-ai-service".to_string(),
                    permissions: vec![
                        "auth:validate".to_string(),
                        "auth:permissions".to_string(),
                    ],
                },
                AllowedService {
                    name: "rust-dashboard-service".to_string(),
                    permissions: vec!["auth:validate".to_string(), "stats:read".to_string()],
                },
                AllowedService {
                    name: "python-api".to_string(),
                    permissions: vec![
                        "auth:validate".to_string(),
                        "auth:permissions".to_string(),
                        "admin:*".to_string(),
                    ],
                },
            ],
        }
    }
}

impl AllowedServices {
    /// Check if a service name is in the allowed list
    pub fn is_allowed(&self, service_name: &str) -> bool {
        self.services.iter().any(|s| s.name == service_name)
    }

    /// Get the default permissions for a service
    pub fn get_permissions(&self, service_name: &str) -> Option<&[String]> {
        self.services
            .iter()
            .find(|s| s.name == service_name)
            .map(|s| s.permissions.as_slice())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_key_parts_valid() {
        let key = "omf_ai_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6";
        let result = extract_key_parts(key);
        assert!(result.is_ok());
        let (prefix, hash) = result.unwrap();
        assert_eq!(prefix, "omf_ai_");
        assert_eq!(hash.len(), 64); // SHA-256 produces 64 hex chars
    }

    #[test]
    fn test_extract_key_parts_valid_dashboard() {
        let key = "omf_da_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6";
        let result = extract_key_parts(key);
        assert!(result.is_ok());
        let (prefix, _hash) = result.unwrap();
        assert_eq!(prefix, "omf_da_");
    }

    #[test]
    fn test_extract_key_parts_invalid_prefix() {
        let key = "invalid_key_here";
        let result = extract_key_parts(key);
        assert!(matches!(result, Err(ApiKeyError::InvalidFormat)));
    }

    #[test]
    fn test_extract_key_parts_too_short() {
        let key = "omf_ai";
        let result = extract_key_parts(key);
        assert!(matches!(result, Err(ApiKeyError::InvalidFormat)));
    }

    #[test]
    fn test_extract_key_parts_no_omf_prefix() {
        let key = "test_ai_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6";
        let result = extract_key_parts(key);
        assert!(matches!(result, Err(ApiKeyError::InvalidFormat)));
    }

    #[test]
    fn test_check_permission_exact() {
        let service = ValidatedService {
            service_name: "test".to_string(),
            permissions: vec!["auth:validate".to_string()],
        };
        assert!(ApiKeyValidator::check_permission(&service, "auth:validate"));
        assert!(!ApiKeyValidator::check_permission(
            &service,
            "auth:permissions"
        ));
    }

    #[test]
    fn test_check_permission_wildcard() {
        let service = ValidatedService {
            service_name: "test".to_string(),
            permissions: vec!["*".to_string()],
        };
        assert!(ApiKeyValidator::check_permission(&service, "anything"));
        assert!(ApiKeyValidator::check_permission(
            &service,
            "auth:validate"
        ));
        assert!(ApiKeyValidator::check_permission(&service, "admin:users"));
    }

    #[test]
    fn test_check_permission_scoped_wildcard() {
        let service = ValidatedService {
            service_name: "test".to_string(),
            permissions: vec!["auth:*".to_string()],
        };
        assert!(ApiKeyValidator::check_permission(
            &service,
            "auth:validate"
        ));
        assert!(ApiKeyValidator::check_permission(
            &service,
            "auth:permissions"
        ));
        assert!(!ApiKeyValidator::check_permission(&service, "admin:users"));
    }

    #[test]
    fn test_check_permission_prefix_wildcard() {
        let service = ValidatedService {
            service_name: "test".to_string(),
            permissions: vec!["admin:*".to_string()],
        };
        assert!(ApiKeyValidator::check_permission(&service, "admin:users"));
        assert!(ApiKeyValidator::check_permission(&service, "admin:roles"));
        assert!(!ApiKeyValidator::check_permission(&service, "auth:validate"));
    }

    #[test]
    fn test_check_permission_multiple() {
        let service = ValidatedService {
            service_name: "test".to_string(),
            permissions: vec![
                "auth:validate".to_string(),
                "stats:read".to_string(),
                "admin:*".to_string(),
            ],
        };
        assert!(ApiKeyValidator::check_permission(
            &service,
            "auth:validate"
        ));
        assert!(ApiKeyValidator::check_permission(&service, "stats:read"));
        assert!(ApiKeyValidator::check_permission(&service, "admin:users"));
        assert!(!ApiKeyValidator::check_permission(
            &service,
            "auth:permissions"
        ));
    }

    #[test]
    fn test_allowed_services_default() {
        let allowed = AllowedServices::default();
        assert!(allowed.is_allowed("rust-ai-service"));
        assert!(allowed.is_allowed("rust-dashboard-service"));
        assert!(allowed.is_allowed("python-api"));
        assert!(!allowed.is_allowed("unknown-service"));
    }

    #[test]
    fn test_allowed_services_permissions() {
        let allowed = AllowedServices::default();

        let ai_perms = allowed.get_permissions("rust-ai-service");
        assert!(ai_perms.is_some());
        assert!(ai_perms.unwrap().contains(&"auth:validate".to_string()));

        let python_perms = allowed.get_permissions("python-api");
        assert!(python_perms.is_some());
        assert!(python_perms.unwrap().contains(&"admin:*".to_string()));

        let unknown_perms = allowed.get_permissions("unknown-service");
        assert!(unknown_perms.is_none());
    }

    #[test]
    fn test_hex_encode() {
        let bytes = [0x00, 0xff, 0x10, 0xab];
        let hex = hex_encode(&bytes);
        assert_eq!(hex, "00ff10ab");
    }

    #[test]
    fn test_consistent_hashing() {
        // Same key should always produce the same hash
        let key = "omf_ai_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6";
        let (_, hash1) = extract_key_parts(key).unwrap();
        let (_, hash2) = extract_key_parts(key).unwrap();
        assert_eq!(hash1, hash2);
    }
}
