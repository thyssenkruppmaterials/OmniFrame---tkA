use std::sync::Arc;
use tokio::sync::broadcast;

use crate::auth::AuthClient;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DeviceEvent {
    pub event_type: String,
    pub device_id: Option<String>,
    pub organization_id: Option<String>,
    pub payload: serde_json::Value,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

pub struct AppState {
    pub db_pool: sqlx::PgPool,
    pub redis_pool: Option<bb8::Pool<bb8_redis::RedisConnectionManager>>,
    pub auth_client: AuthClient,
    pub ws_broadcast: broadcast::Sender<DeviceEvent>,
    pub config: Arc<crate::config::AppConfig>,
}

impl AppState {
    pub async fn new(config: crate::config::AppConfig) -> anyhow::Result<Self> {
        let config = Arc::new(config);

        tracing::info!("Connecting to PostgreSQL...");
        let db_pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(20)
            .acquire_timeout(std::time::Duration::from_secs(10))
            .connect(&config.database_url)
            .await?;
        tracing::info!("Connected to PostgreSQL");

        let redis_pool = match bb8_redis::RedisConnectionManager::new(config.redis_url.clone()) {
            Ok(manager) => {
                tracing::info!("Connecting to Redis...");
                match bb8::Pool::builder().max_size(10).build(manager).await {
                    Ok(pool) => {
                        tracing::info!("Connected to Redis");
                        Some(pool)
                    }
                    Err(e) => {
                        tracing::warn!("Failed to connect to Redis: {}. Continuing without Redis.", e);
                        None
                    }
                }
            }
            Err(e) => {
                tracing::warn!("Invalid REDIS_URL: {}. Continuing without Redis.", e);
                None
            }
        };

        let auth_client = AuthClient::new(crate::auth::AuthConfig {
            rust_core_url: config.rust_core_url.clone(),
            service_api_key: config.rust_core_api_key.clone(),
        });

        let (ws_tx, _) = broadcast::channel::<DeviceEvent>(256);

        Ok(Self {
            db_pool,
            redis_pool,
            auth_client,
            ws_broadcast: ws_tx,
            config,
        })
    }
}
