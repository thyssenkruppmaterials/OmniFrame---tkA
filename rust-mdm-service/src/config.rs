use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct AppConfig {
    pub database_url: String,
    pub redis_url: String,
    pub server_port: u16,
    pub rust_core_url: String,
    pub rust_core_api_key: String,
    pub mdm_base_url: Option<String>,
    pub apns_cert_path: Option<String>,
    pub apns_cert_password: Option<String>,
    pub abm_server_token_path: Option<String>,
    pub profile_signing_cert_path: Option<String>,
    pub profile_signing_key_path: Option<String>,
    pub scep_ca_cert_path: Option<String>,
    pub scep_ca_key_path: Option<String>,
    pub telemetry_shared_secret: Option<String>,
}

impl AppConfig {
    pub fn from_env() -> Self {
        Self {
            database_url: std::env::var("DATABASE_URL")
                .expect("DATABASE_URL must be set"),
            redis_url: std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),
            server_port: std::env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(8040),
            rust_core_url: std::env::var("RUST_CORE_URL")
                .unwrap_or_else(|_| "http://localhost:8010".to_string()),
            rust_core_api_key: std::env::var("RUST_CORE_API_KEY")
                .expect("RUST_CORE_API_KEY must be set"),
            mdm_base_url: std::env::var("MDM_BASE_URL").ok(),
            apns_cert_path: std::env::var("APNS_CERT_PATH").ok(),
            apns_cert_password: std::env::var("APNS_CERT_PASSWORD").ok(),
            abm_server_token_path: std::env::var("ABM_SERVER_TOKEN_PATH").ok(),
            profile_signing_cert_path: std::env::var("PROFILE_SIGNING_CERT_PATH").ok(),
            profile_signing_key_path: std::env::var("PROFILE_SIGNING_KEY_PATH").ok(),
            scep_ca_cert_path: std::env::var("SCEP_CA_CERT_PATH").ok(),
            scep_ca_key_path: std::env::var("SCEP_CA_KEY_PATH").ok(),
            telemetry_shared_secret: std::env::var("TELEMETRY_SHARED_SECRET").ok(),
        }
    }

    pub fn mdm_enabled(&self) -> bool {
        self.apns_cert_path.is_some() && self.mdm_base_url.is_some()
    }

    pub fn telemetry_enabled(&self) -> bool {
        self.telemetry_shared_secret.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_defaults_are_correct() {
        std::env::set_var("DATABASE_URL", "postgres://test:test@localhost/test");
        std::env::set_var("RUST_CORE_API_KEY", "test_key");
        let config = AppConfig::from_env();
        assert_eq!(config.server_port, 8040);
        assert_eq!(config.rust_core_url, "http://localhost:8010");
        assert!(!config.mdm_enabled());
        assert!(!config.telemetry_enabled());
        std::env::remove_var("DATABASE_URL");
        std::env::remove_var("RUST_CORE_API_KEY");
    }
}
