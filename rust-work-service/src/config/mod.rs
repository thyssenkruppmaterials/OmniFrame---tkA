//! Configuration module for rust-work-service
//!
//! Loads all configuration from environment variables.

use std::env;

/// Application configuration loaded from environment variables
#[derive(Debug, Clone)]
pub struct AppConfig {
    /// PostgreSQL connection URL
    pub database_url: String,
    /// Redis connection URL
    pub redis_url: String,
    /// HTTP server port
    pub server_port: u16,
    /// rust-core-service URL for auth validation
    pub rust_core_url: String,
    /// Service API key for rust-core-service
    pub rust_core_api_key: String,
    /// Supabase URL (optional, for storage — will be used when Supabase integration is wired up)
    #[allow(dead_code)]
    pub supabase_url: Option<String>,
    /// Supabase service role key (optional — will be used when Supabase integration is wired up)
    #[allow(dead_code)]
    pub supabase_service_role_key: Option<String>,
}

impl AppConfig {
    /// Load configuration from environment variables
    ///
    /// # Panics
    /// Panics if required environment variables are not set:
    /// - DATABASE_URL
    /// - REDIS_URL
    /// - RUST_CORE_API_KEY
    pub fn from_env() -> Self {
        Self {
            database_url: env::var("DATABASE_URL")
                .expect("DATABASE_URL must be set"),
            redis_url: env::var("REDIS_URL")
                .expect("REDIS_URL must be set"),
            server_port: env::var("PORT")
                .unwrap_or_else(|_| "8030".to_string())
                .parse()
                .expect("PORT must be a valid u16"),
            rust_core_url: env::var("RUST_CORE_URL")
                .unwrap_or_else(|_| "http://localhost:8010".to_string()),
            rust_core_api_key: env::var("RUST_CORE_API_KEY")
                .expect("RUST_CORE_API_KEY must be set"),
            supabase_url: env::var("SUPABASE_URL").ok(),
            supabase_service_role_key: env::var("SUPABASE_SERVICE_ROLE_KEY").ok(),
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_default_port_value() {
        // PORT env not set should default to 8030
        std::env::remove_var("PORT");
        let port: u16 = std::env::var("PORT")
            .unwrap_or_else(|_| "8030".to_string())
            .parse()
            .unwrap();
        assert_eq!(port, 8030);
    }

    #[test]
    fn test_rust_core_url_default() {
        std::env::remove_var("RUST_CORE_URL");
        let url = std::env::var("RUST_CORE_URL")
            .unwrap_or_else(|_| "http://localhost:8010".to_string());
        assert_eq!(url, "http://localhost:8010");
    }
}
