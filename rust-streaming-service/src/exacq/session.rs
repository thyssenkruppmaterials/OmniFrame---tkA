//! ExacqVision session management
//!
//! Handles session lifecycle with automatic refresh and Redis caching.

use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::{debug, info, instrument, warn};

use super::client::ExacqClient;
use crate::cache::CacheService;

/// Session state with metadata
#[derive(Debug, Clone)]
struct SessionState {
    /// Session ID from ExacqVision
    session_id: String,
    /// When the session was created
    created_at: Instant,
    /// Last time the session was verified
    last_verified: Instant,
}

/// Session manager with automatic refresh and caching
pub struct SessionManager {
    /// ExacqVision client
    client: Arc<ExacqClient>,
    /// Redis cache service (optional)
    cache: Option<Arc<CacheService>>,
    /// Current session state
    session: RwLock<Option<SessionState>>,
    /// Session TTL in seconds
    session_ttl_seconds: u64,
    /// Refresh margin (refresh when TTL is below this threshold)
    refresh_margin: Duration,
}

impl SessionManager {
    /// Create a new session manager
    pub fn new(
        client: Arc<ExacqClient>,
        cache: Option<Arc<CacheService>>,
        session_ttl_seconds: u64,
    ) -> Self {
        // Refresh session when it has less than 10% of TTL remaining
        let refresh_margin = Duration::from_secs(session_ttl_seconds / 10);

        Self {
            client,
            cache,
            session: RwLock::new(None),
            session_ttl_seconds,
            refresh_margin,
        }
    }

    /// Get cache key for session
    fn cache_key() -> &'static str {
        "exacq:session"
    }

    /// Get a valid session ID, refreshing if necessary
    #[instrument(skip(self))]
    pub async fn get_session(&self) -> anyhow::Result<String> {
        // First, try to get from memory
        {
            let session_guard = self.session.read().await;
            if let Some(ref state) = *session_guard {
                // Check if session is still valid (not too old)
                let age = state.created_at.elapsed();
                let ttl = Duration::from_secs(self.session_ttl_seconds);
                
                if age < ttl - self.refresh_margin {
                    debug!(
                        session_id = %state.session_id,
                        age_secs = age.as_secs(),
                        "Using cached session from memory"
                    );
                    return Ok(state.session_id.clone());
                }
            }
        }

        // Try to get from Redis cache
        if let Some(ref cache) = self.cache {
            if let Ok(Some(session_id)) = cache.get_raw(Self::cache_key()).await {
                // Verify the cached session is still valid
                if self.client.verify_session(&session_id).await.unwrap_or(false) {
                    debug!(session_id = %session_id, "Using cached session from Redis");
                    
                    // Update memory cache
                    let mut session_guard = self.session.write().await;
                    *session_guard = Some(SessionState {
                        session_id: session_id.clone(),
                        created_at: Instant::now(),
                        last_verified: Instant::now(),
                    });
                    
                    return Ok(session_id);
                }
            }
        }

        // Need to create a new session
        self.refresh_session().await
    }

    /// Force refresh the session
    #[instrument(skip(self))]
    pub async fn refresh_session(&self) -> anyhow::Result<String> {
        info!("Refreshing ExacqVision session");

        // Login to get new session
        let session_id = self.client.login().await?;
        let now = Instant::now();

        // Update memory cache
        {
            let mut session_guard = self.session.write().await;
            *session_guard = Some(SessionState {
                session_id: session_id.clone(),
                created_at: now,
                last_verified: now,
            });
        }

        // Update Redis cache
        if let Some(ref cache) = self.cache {
            if let Err(e) = cache
                .set_with_ttl(Self::cache_key(), &session_id, self.session_ttl_seconds)
                .await
            {
                warn!(error = %e, "Failed to cache session in Redis");
            }
        }

        info!(session_id = %session_id, "Session refreshed successfully");
        Ok(session_id)
    }

    /// Check if current session is valid
    #[instrument(skip(self))]
    pub async fn is_session_valid(&self) -> bool {
        let session_guard = self.session.read().await;
        if let Some(ref state) = *session_guard {
            // Check age
            let age = state.created_at.elapsed();
            let ttl = Duration::from_secs(self.session_ttl_seconds);
            if age >= ttl {
                return false;
            }

            // Verify with ExacqVision if enough time has passed since last verification
            let time_since_verify = state.last_verified.elapsed();
            if time_since_verify > Duration::from_secs(60) {
                // Drop the read lock before making HTTP request
                let session_id = state.session_id.clone();
                drop(session_guard);
                
                return self.client.verify_session(&session_id).await.unwrap_or(false);
            }

            return true;
        }
        false
    }

    /// Invalidate current session
    #[instrument(skip(self))]
    pub async fn invalidate_session(&self) {
        info!("Invalidating session");
        
        // Clear memory cache
        {
            let mut session_guard = self.session.write().await;
            *session_guard = None;
        }

        // Clear Redis cache
        if let Some(ref cache) = self.cache {
            if let Err(e) = cache.delete(Self::cache_key()).await {
                warn!(error = %e, "Failed to delete session from Redis");
            }
        }
    }

    /// Get session info for health check
    pub async fn get_session_info(&self) -> Option<SessionInfo> {
        let session_guard = self.session.read().await;
        session_guard.as_ref().map(|state| SessionInfo {
            session_id: state.session_id.clone(),
            age_seconds: state.created_at.elapsed().as_secs(),
            last_verified_seconds: state.last_verified.elapsed().as_secs(),
            ttl_remaining: self.session_ttl_seconds.saturating_sub(state.created_at.elapsed().as_secs()),
        })
    }
}

/// Session info for diagnostics
#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionInfo {
    pub session_id: String,
    pub age_seconds: u64,
    pub last_verified_seconds: u64,
    pub ttl_remaining: u64,
}
