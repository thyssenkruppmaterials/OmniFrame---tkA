// Created and developed by Jai Singh
//! JWT validation with full cryptographic verification
//!
//! **CRITICAL SECURITY**: This module properly validates JWT signatures,
//! fixing the security vulnerability in the Python implementation that
//! skipped signature verification.

use super::jwks::JwksCache;
use super::claims::SupabaseClaims;
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use thiserror::Error;
use tracing::{instrument, warn};

/// JWT validation errors
#[derive(Debug, Error)]
pub enum JwtError {
    #[error("Missing Authorization header")]
    MissingHeader,
    
    #[error("Invalid Authorization header format (expected 'Bearer <token>')")]
    InvalidHeaderFormat,
    
    #[error("Token expired")]
    Expired,
    
    #[error("Invalid token signature")]
    InvalidSignature,
    
    #[error("Unknown key ID: {0}")]
    UnknownKeyId(String),
    
    #[error("Invalid token claims")]
    InvalidClaims,
    
    #[error("Unsupported algorithm: {0}")]
    UnsupportedAlgorithm(String),
    
    #[error("Token validation failed: {0}")]
    ValidationError(#[from] jsonwebtoken::errors::Error),
    
    #[error("JWKS not initialized")]
    JwksNotInitialized,
}

/// JWT validator with JWKS caching
pub struct JwtValidator {
    /// JWKS cache for RS256 keys
    jwks_cache: JwksCache,
    /// Expected audience claim
    expected_audience: String,
    /// Expected issuer claim
    expected_issuer: String,
    /// HS256 secret for service role tokens (optional)
    hs256_secret: Option<String>,
}

impl JwtValidator {
    /// Create a new JWT validator
    pub fn new(supabase_url: &str, jwt_secret: Option<String>) -> Self {
        Self {
            jwks_cache: JwksCache::new(supabase_url),
            expected_audience: "authenticated".to_string(),
            expected_issuer: format!("{}/auth/v1", supabase_url.trim_end_matches('/')),
            hs256_secret: jwt_secret,
        }
    }

    /// Initialize the validator by fetching JWKS keys
    pub async fn initialize(&self) -> Result<(), anyhow::Error> {
        self.jwks_cache.refresh_keys().await
    }

    /// Validate a JWT token with full cryptographic verification
    ///
    /// This method:
    /// 1. Decodes the token header to get the algorithm and key ID
    /// 2. For RS256 tokens: Fetches the public key from JWKS and verifies signature
    /// 3. For HS256 tokens: Uses the JWT secret to verify (service role only)
    /// 4. Validates all claims (exp, aud, iss)
    #[instrument(skip(self, token))]
    pub async fn validate_token(&self, token: &str) -> Result<SupabaseClaims, JwtError> {
        let start = std::time::Instant::now();
        
        // Decode header to get algorithm and key ID
        let header = decode_header(token)?;

        let claims = match header.alg {
            Algorithm::RS256 => {
                // Production path: RS256 with JWKS
                let kid = header.kid.ok_or_else(|| {
                    JwtError::UnknownKeyId("Missing kid in token header".to_string())
                })?;
                
                // Get key from JWKS cache
                let key = self.jwks_cache
                    .get_key_with_refresh(&kid)
                    .await
                    .ok_or_else(|| JwtError::UnknownKeyId(kid.clone()))?;

                // Setup validation
                let mut validation = Validation::new(Algorithm::RS256);
                validation.set_audience(&[&self.expected_audience]);
                validation.set_issuer(&[&self.expected_issuer]);
                validation.validate_exp = true;

                // Decode and verify
                decode::<SupabaseClaims>(token, &key, &validation)?.claims
            }
            Algorithm::HS256 => {
                // Service role tokens use HS256
                let secret = self.hs256_secret
                    .as_ref()
                    .ok_or(JwtError::InvalidSignature)?;

                let key = DecodingKey::from_secret(secret.as_bytes());
                
                // HS256 tokens may have different audience/issuer
                let mut validation = Validation::new(Algorithm::HS256);
                validation.validate_exp = true;
                // Don't validate audience/issuer for service role tokens
                validation.validate_aud = false;
                validation.set_required_spec_claims(&["exp", "sub"]);

                decode::<SupabaseClaims>(token, &key, &validation)?.claims
            }
            alg => {
                warn!(algorithm = ?alg, "Unsupported JWT algorithm");
                return Err(JwtError::UnsupportedAlgorithm(format!("{:?}", alg)));
            }
        };

        // Additional claim validation
        if claims.sub.is_empty() {
            return Err(JwtError::InvalidClaims);
        }

        // Record metrics
        let duration = start.elapsed();
        metrics::histogram!("auth.jwt.validation_time_ms").record(duration.as_millis() as f64);
        metrics::counter!("auth.jwt.validated").increment(1);

        tracing::debug!(
            user_id = %claims.sub,
            email = ?claims.email,
            role = %claims.role,
            "JWT validated successfully"
        );

        Ok(claims)
    }

    /// Validate token and return validation result (for API responses)
    pub async fn validate_token_result(&self, token: &str) -> ValidationResult {
        match self.validate_token(token).await {
            Ok(claims) => ValidationResult {
                valid: true,
                user_id: Some(claims.sub.clone()),
                email: claims.email.clone(),
                role: Some(claims.role.clone()),
                error: None,
                expires_at: Some(claims.exp),
            },
            Err(e) => {
                metrics::counter!("auth.jwt.validation_failed").increment(1);
                ValidationResult {
                    valid: false,
                    user_id: None,
                    email: None,
                    role: None,
                    error: Some(e.to_string()),
                    expires_at: None,
                }
            }
        }
    }
}

/// JWT validation result for API responses
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub user_id: Option<String>,
    pub email: Option<String>,
    pub role: Option<String>,
    pub error: Option<String>,
    pub expires_at: Option<i64>,
}

/// Extract bearer token from Authorization header
pub fn extract_bearer_token(auth_header: &str) -> Result<&str, JwtError> {
    auth_header
        .strip_prefix("Bearer ")
        .ok_or(JwtError::InvalidHeaderFormat)
}

/// Hash a token for cache key purposes
pub fn hash_token(token: &str) -> String {
    use md5::{Md5, Digest};
    let mut hasher = Md5::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_bearer_token() {
        assert_eq!(
            extract_bearer_token("Bearer abc123").unwrap(),
            "abc123"
        );
        assert!(extract_bearer_token("Basic abc123").is_err());
        assert!(extract_bearer_token("abc123").is_err());
    }

    #[test]
    fn test_hash_token() {
        let hash = hash_token("test_token");
        assert!(!hash.is_empty());
        assert_eq!(hash.len(), 32); // MD5 produces 32 hex chars
    }
}

// Created and developed by Jai Singh
