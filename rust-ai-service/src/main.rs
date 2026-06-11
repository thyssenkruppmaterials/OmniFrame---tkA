// Created and developed by Jai Singh
//! Drone AI Analysis Service
//! 
//! This service processes drone scan images using AI vision models
//! (Qwen3-VL-8B-Instruct via Hugging Face Inference API) for warehouse
//! inventory analysis.
//!
//! SECURITY: All endpoints (except /health) require authentication via
//! rust-core-service JWT validation.

mod ai;
mod api;
mod auth;       // Authentication client module
mod middleware; // Auth middleware
mod models;
mod storage;

use axum::{
    routing::{get, post},
    Router,
    middleware as axum_middleware,
};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::ai::AIService;
use crate::auth::{AuthClient, AuthConfig};
use crate::middleware::require_auth;
use crate::storage::SupabaseStorage;

/// Application state shared across all handlers
pub struct AppState {
    pub db: Option<sqlx::PgPool>,
    pub ai_service: AIService,
    pub storage: SupabaseStorage,
    pub supabase_url: String,
    pub supabase_key: String,
    pub auth_client: AuthClient,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load environment variables
    dotenvy::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "drone_ai_service=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting Drone AI Analysis Service (Secured)");

    // Database connection (optional - will use REST API fallback if unavailable)
    let db_pool = match std::env::var("DATABASE_URL") {
        Ok(database_url) => {
            tracing::info!("Attempting database connection...");
            match PgPoolOptions::new()
                .max_connections(10)
                .acquire_timeout(std::time::Duration::from_secs(10))
                .connect(&database_url)
                .await
            {
                Ok(pool) => {
                    tracing::info!("Connected to database successfully");
                    Some(pool)
                }
                Err(e) => {
                    tracing::warn!("Failed to connect to database: {}. Will use REST API fallback.", e);
                    None
                }
            }
        }
        Err(_) => {
            tracing::info!("DATABASE_URL not set. Using REST API mode only.");
            None
        }
    };

    // Initialize AI service
    let hf_api_key = std::env::var("HUGGINGFACE_API_KEY")
        .expect("HUGGINGFACE_API_KEY must be set");
    let novita_api_key = std::env::var("NOVITA_API_KEY").ok();

    let ai_service = AIService::new(hf_api_key, novita_api_key);

    // Initialize Supabase storage
    let supabase_url = std::env::var("SUPABASE_URL")
        .expect("SUPABASE_URL must be set");
    let supabase_key = std::env::var("SUPABASE_SERVICE_ROLE_KEY")
        .expect("SUPABASE_SERVICE_ROLE_KEY must be set");

    let storage = SupabaseStorage::new(supabase_url.clone(), supabase_key.clone());

    // Initialize auth client
    let auth_config = AuthConfig::from_env();
    let auth_client = AuthClient::new(auth_config);
    tracing::info!("Auth client initialized for rust-core-service");

    // Create shared state
    let state = Arc::new(AppState {
        db: db_pool,
        ai_service,
        storage,
        supabase_url,
        supabase_key,
        auth_client,
    });

    // Build router with authentication
    // Health endpoint is public (for load balancer checks)
    let public_routes = Router::new()
        .route("/health", get(api::handlers::health_check));
    
    // Protected routes require authentication
    let protected_routes = Router::new()
        .route("/analyze", post(api::handlers::analyze_image))
        .route("/analyze/batch", post(api::handlers::analyze_batch))
        .route("/process-pending", post(api::handlers::process_pending_scans))
        .route("/status/:scan_id", get(api::handlers::get_scan_status))
        .layer(axum_middleware::from_fn_with_state(state.clone(), require_auth));

    let app = Router::new()
        .merge(public_routes)
        .merge(protected_routes)
        .layer(
            CorsLayer::new()
                .allow_origin([
                    "http://localhost:5173".parse().unwrap(),
                    "http://localhost:3000".parse().unwrap(),
                    "https://onebox-ai.netlify.app".parse().unwrap(),
                    "https://onebox-ai-logistics-production.up.railway.app".parse().unwrap(),
                ])
                .allow_methods([
                    axum::http::Method::GET,
                    axum::http::Method::POST,
                    axum::http::Method::PUT,
                    axum::http::Method::DELETE,
                    axum::http::Method::OPTIONS,
                ])
                .allow_headers([
                    axum::http::header::AUTHORIZATION,
                    axum::http::header::CONTENT_TYPE,
                    axum::http::header::ACCEPT,
                    "X-Service-Key".parse().unwrap(),
                ])
                .allow_credentials(true),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Start server
    let port = std::env::var("PORT").unwrap_or_else(|_| "8001".to_string());
    let addr = format!("0.0.0.0:{}", port);
    
    tracing::info!("Listening on {} (auth enabled)", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

// Created and developed by Jai Singh
