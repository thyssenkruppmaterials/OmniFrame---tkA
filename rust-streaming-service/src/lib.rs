// Created and developed by Jai Singh
//! OneBox AI Rust Streaming Service
//!
//! High-performance ExacqVision camera streaming proxy providing:
//! - MJPEG stream proxying with zero-copy forwarding
//! - WebSocket event broadcasting for motion/trigger alerts
//! - Session management with Redis caching
//! - Camera metadata and recordings access
//!
//! ## Architecture
//!
//! ```text
//! +-------------------+     +-------------------+
//! |   REST :8020      |     |   WebSocket       |
//! +-------------------+     +-------------------+
//!          |                         |
//!          v                         v
//! +----------------------------------------+
//! |           Middleware Stack             |
//! |  CORS | Tracing | Compression          |
//! +----------------------------------------+
//! |           ExacqVision Client           |
//! |  Session Mgr | Stream Proxy | Events   |
//! +----------------------------------------+
//! |            Data Layer                  |
//! |  Redis Pool | Session Cache            |
//! +----------------------------------------+
//! ```

pub mod config;
pub mod exacq;
pub mod api;
pub mod cache;

use std::sync::Arc;

/// Application state shared across all handlers
#[derive(Clone)]
pub struct AppState {
    /// ExacqVision client for API calls
    pub exacq_client: Arc<exacq::client::ExacqClient>,
    /// Session manager for ExacqVision sessions
    pub session_manager: Arc<exacq::session::SessionManager>,
    /// Redis cache service (optional)
    pub cache_service: Option<Arc<cache::CacheService>>,
    /// Configuration
    pub config: Arc<config::AppConfig>,
}

impl AppState {
    /// Create a new AppState with all dependencies initialized
    pub async fn new(config: config::AppConfig) -> anyhow::Result<Self> {
        let config = Arc::new(config);
        
        // Initialize ExacqVision client
        let exacq_client = Arc::new(exacq::client::ExacqClient::new(
            config.exacq.base_url.clone(),
            config.exacq.username.clone(),
            config.exacq.password.clone(),
        )?);
        
        // Initialize cache service if Redis is configured
        let cache_service = if let Some(ref redis_url) = config.redis_url {
            tracing::info!("Attempting Redis connection...");
            match cache::create_redis_pool(redis_url).await {
                Ok(pool) => {
                    tracing::info!("Redis pool initialized");
                    Some(Arc::new(cache::CacheService::new(
                        pool,
                        std::time::Duration::from_secs(config.session_ttl_seconds),
                    )))
                }
                Err(e) => {
                    tracing::warn!("Failed to connect to Redis: {}. Session caching disabled.", e);
                    None
                }
            }
        } else {
            tracing::info!("REDIS_URL not set. Session caching disabled.");
            None
        };
        
        // Initialize session manager
        let session_manager = Arc::new(exacq::session::SessionManager::new(
            exacq_client.clone(),
            cache_service.clone(),
            config.session_ttl_seconds,
        ));
        
        Ok(Self {
            exacq_client,
            session_manager,
            cache_service,
            config,
        })
    }
}

/// Version information
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const NAME: &str = env!("CARGO_PKG_NAME");

// Created and developed by Jai Singh
