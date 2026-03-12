//! JWKS (JSON Web Key Set) fetching and caching
//!
//! Provides automatic fetching and caching of Supabase Auth public keys
//! for RS256 JWT signature verification.

use jsonwebtoken::DecodingKey;
use reqwest::Client;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::{info, warn, instrument};

/// A single JWK (JSON Web Key)
#[derive(Debug, Clone, Deserialize)]
pub struct JwkKey {
    /// Key type (RSA)
    pub kty: String,
    /// Key ID
    pub kid: String,
    /// Algorithm (RS256)
    pub alg: String,
    /// RSA modulus (base64url encoded)
    pub n: String,
    /// RSA exponent (base64url encoded)
    pub e: String,
    /// Key use (sig = signature)
    #[serde(rename = "use")]
    pub key_use: Option<String>,
}

/// JWKS response from Supabase Auth
#[derive(Debug, Clone, Deserialize)]
pub struct JwksResponse {
    pub keys: Vec<JwkKey>,
}

/// JWKS cache for storing and refreshing public keys
pub struct JwksCache {
    /// Cached decoding keys by key ID
    keys: Arc<RwLock<HashMap<String, DecodingKey>>>,
    /// JWKS endpoint URL
    jwks_url: String,
    /// HTTP client for fetching keys
    client: Client,
    /// Last refresh timestamp
    last_refresh: Arc<RwLock<Instant>>,
    /// Refresh interval
    refresh_interval: Duration,
}

impl JwksCache {
    /// Create a new JWKS cache
    pub fn new(supabase_url: &str) -> Self {
        let jwks_url = format!(
            "{}/auth/v1/.well-known/jwks.json",
            supabase_url.trim_end_matches('/')
        );

        Self {
            keys: Arc::new(RwLock::new(HashMap::new())),
            jwks_url,
            client: Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .expect("Failed to create HTTP client"),
            last_refresh: Arc::new(RwLock::new(Instant::now() - Duration::from_secs(3600))),
            refresh_interval: Duration::from_secs(3600), // Refresh hourly
        }
    }

    /// Create with custom refresh interval
    pub fn with_refresh_interval(supabase_url: &str, refresh_interval: Duration) -> Self {
        let mut cache = Self::new(supabase_url);
        cache.refresh_interval = refresh_interval;
        cache
    }

    /// Refresh JWKS keys from Supabase Auth
    #[instrument(skip(self))]
    pub async fn refresh_keys(&self) -> Result<(), anyhow::Error> {
        info!(url = %self.jwks_url, "Refreshing JWKS keys");

        let response: JwksResponse = self.client
            .get(&self.jwks_url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;

        let mut keys = self.keys.write().await;
        keys.clear();

        let mut loaded_count = 0;
        for jwk in response.keys {
            if jwk.kty == "RSA" && jwk.alg == "RS256" {
                match DecodingKey::from_rsa_components(&jwk.n, &jwk.e) {
                    Ok(key) => {
                        info!(kid = %jwk.kid, "Loaded RSA key");
                        keys.insert(jwk.kid.clone(), key);
                        loaded_count += 1;
                    }
                    Err(e) => {
                        warn!(kid = %jwk.kid, error = %e, "Failed to load RSA key");
                    }
                }
            }
        }

        *self.last_refresh.write().await = Instant::now();
        
        info!(
            key_count = loaded_count,
            total_keys = keys.len(),
            "JWKS refresh complete"
        );

        metrics::gauge!("auth.jwks.key_count").set(loaded_count as f64);
        metrics::counter!("auth.jwks.refresh").increment(1);

        Ok(())
    }

    /// Get a decoding key by key ID
    pub async fn get_key(&self, kid: &str) -> Option<DecodingKey> {
        // Check if refresh is needed
        let last_refresh = *self.last_refresh.read().await;
        if last_refresh.elapsed() > self.refresh_interval {
            // Spawn background refresh
            let self_clone = self.clone();
            tokio::spawn(async move {
                if let Err(e) = self_clone.refresh_keys().await {
                    warn!(error = %e, "Background JWKS refresh failed");
                }
            });
        }

        self.keys.read().await.get(kid).cloned()
    }

    /// Force a key refresh and get key
    pub async fn get_key_with_refresh(&self, kid: &str) -> Option<DecodingKey> {
        // Try current cache first
        if let Some(key) = self.keys.read().await.get(kid).cloned() {
            return Some(key);
        }

        // Refresh and try again
        if let Err(e) = self.refresh_keys().await {
            warn!(error = %e, "JWKS refresh failed during key lookup");
            return None;
        }

        self.keys.read().await.get(kid).cloned()
    }

    /// Check if cache is empty
    pub async fn is_empty(&self) -> bool {
        self.keys.read().await.is_empty()
    }

    /// Get all key IDs
    pub async fn get_key_ids(&self) -> Vec<String> {
        self.keys.read().await.keys().cloned().collect()
    }
}

impl Clone for JwksCache {
    fn clone(&self) -> Self {
        Self {
            keys: Arc::clone(&self.keys),
            jwks_url: self.jwks_url.clone(),
            client: self.client.clone(),
            last_refresh: Arc::clone(&self.last_refresh),
            refresh_interval: self.refresh_interval,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_jwks_cache_creation() {
        let cache = JwksCache::new("https://example.supabase.co");
        assert!(cache.jwks_url.contains("/.well-known/jwks.json"));
    }
}
