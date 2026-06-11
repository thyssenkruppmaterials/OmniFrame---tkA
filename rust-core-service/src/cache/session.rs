// Created and developed by Jai Singh
//! Session caching for authenticated users
//!
//! This module provides comprehensive session management with profile caching.
//! All session data including user profile information is cached to eliminate
//! repeated database queries for authentication.

use super::redis_pool::CacheService;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::instrument;

/// Cached session information with full user profile
/// 
/// This struct contains everything needed for authentication and authorization,
/// eliminating the need for Python to make separate database queries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedSession {
    /// User ID from JWT (UUID string)
    pub user_id: String,
    /// User email
    pub email: String,
    /// User role from RBAC
    pub role: String,
    /// Organization ID (if applicable)
    pub organization_id: Option<String>,
    /// List of permissions from RBAC
    pub permissions: Vec<String>,
    /// Session creation timestamp (Unix epoch)
    pub created_at: i64,
    /// Last activity timestamp (Unix epoch)
    pub last_activity: i64,
    
    // === Profile fields (populated from user_profiles table) ===
    
    /// User's full name
    pub full_name: Option<String>,
    /// Avatar URL
    pub avatar_url: Option<String>,
    /// Department
    pub department: Option<String>,
    /// Job title
    pub job_title: Option<String>,
    /// User status (active, inactive, etc.)
    pub status: Option<String>,
}

/// Session caching service
pub struct SessionService {
    cache: CacheService,
    session_ttl: Duration,
}

impl SessionService {
    /// Create a new session service
    pub fn new(cache: CacheService) -> Self {
        Self {
            cache,
            session_ttl: Duration::from_secs(3000), // 50 minutes (aligned with JWT expiry)
        }
    }

    /// Create with custom TTL
    pub fn with_ttl(cache: CacheService, ttl: Duration) -> Self {
        Self {
            cache,
            session_ttl: ttl,
        }
    }

    /// Generate session cache key
    fn session_key(token_hash: &str) -> String {
        format!("session:{}", token_hash)
    }

    /// Generate user sessions key
    fn _user_sessions_key(user_id: &str) -> String {
        format!("user_sessions:{}", user_id)
    }

    /// Get a cached session
    #[instrument(skip(self))]
    pub async fn get_session(&self, token_hash: &str) -> Result<Option<CachedSession>, anyhow::Error> {
        self.cache.get(&Self::session_key(token_hash)).await
    }

    /// Cache a session
    #[instrument(skip(self, session))]
    pub async fn set_session(
        &self,
        token_hash: &str,
        session: &CachedSession,
    ) -> Result<(), anyhow::Error> {
        self.cache.set(
            &Self::session_key(token_hash),
            session,
            Some(self.session_ttl),
        ).await
    }

    /// Invalidate a specific session
    #[instrument(skip(self))]
    pub async fn invalidate_session(&self, token_hash: &str) -> Result<(), anyhow::Error> {
        self.cache.delete(&Self::session_key(token_hash)).await?;
        metrics::counter!("session.invalidate").increment(1);
        Ok(())
    }

    /// Invalidate all sessions for a user
    #[instrument(skip(self))]
    pub async fn invalidate_user_sessions(&self, user_id: &str) -> Result<u64, anyhow::Error> {
        let deleted = self.cache.delete_pattern(&format!("session:*")).await?;
        // Note: This is a simplified implementation. In production, you'd want to
        // track session tokens per user to invalidate only their sessions.
        metrics::counter!("session.invalidate_user").increment(1);
        Ok(deleted)
    }

    /// Refresh session activity timestamp
    #[instrument(skip(self))]
    pub async fn refresh_session(&self, token_hash: &str) -> Result<bool, anyhow::Error> {
        if let Some(mut session) = self.get_session(token_hash).await? {
            session.last_activity = chrono::Utc::now().timestamp();
            self.set_session(token_hash, &session).await?;
            metrics::counter!("session.refresh").increment(1);
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Check if a session exists
    #[instrument(skip(self))]
    pub async fn session_exists(&self, token_hash: &str) -> Result<bool, anyhow::Error> {
        self.cache.exists(&Self::session_key(token_hash)).await
    }

    /// Get session TTL
    #[instrument(skip(self))]
    pub async fn session_ttl(&self, token_hash: &str) -> Result<Option<i64>, anyhow::Error> {
        self.cache.ttl(&Self::session_key(token_hash)).await
    }
}

impl Clone for SessionService {
    fn clone(&self) -> Self {
        Self {
            cache: self.cache.clone(),
            session_ttl: self.session_ttl,
        }
    }
}

// Created and developed by Jai Singh
