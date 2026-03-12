//! ExacqVision HTTP client
//!
//! Provides low-level HTTP operations for ExacqVision API.

use reqwest::{Client, Response};
use std::time::Duration;
use tracing::{debug, error, info, instrument, warn};

use super::models::*;

/// ExacqVision HTTP client
#[derive(Debug, Clone)]
pub struct ExacqClient {
    /// HTTP client
    client: Client,
    /// Base URL for ExacqVision
    base_url: String,
    /// Username for authentication
    username: String,
    /// Password for authentication
    password: String,
}

impl ExacqClient {
    /// Create a new ExacqVision client
    pub fn new(base_url: String, username: String, password: String) -> anyhow::Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .danger_accept_invalid_certs(true) // ExacqVision often uses self-signed certs
            .build()?;

        // Remove trailing slash from base URL
        let base_url = base_url.trim_end_matches('/').to_string();

        Ok(Self {
            client,
            base_url,
            username,
            password,
        })
    }

    /// Get base URL
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Login to ExacqVision and get a session UUID
    /// 
    /// Two-step process as per ExacqVision API:
    /// 1. GET /login.web?output=json - Discover servers
    /// 2. POST /login.web - Authenticate with user, password, id
    #[instrument(skip(self))]
    pub async fn login(&self) -> anyhow::Result<String> {
        // Step 1: Discover servers with GET request
        let discover_url = format!("{}/login.web?output=json", self.base_url);
        debug!(url = %discover_url, "Step 1: Discovering ExacqVision servers");

        let discover_response = self.client
            .get(&discover_url)
            .header("Accept", "application/json")
            .send()
            .await?;

        let discover_status = discover_response.status();
        let discover_text = discover_response.text().await?;
        
        debug!(status = %discover_status, "Server discovery response received");
        
        // Log preview for debugging
        let preview: String = discover_text.chars().take(300).collect();
        debug!(preview = %preview, "Discovery response preview");

        // Parse server list to get server ID (usually "0" for single server)
        let server_id = if let Ok(discover_json) = serde_json::from_str::<serde_json::Value>(&discover_text) {
            // Try to extract server ID from list
            discover_json.get("list")
                .and_then(|list| list.as_array())
                .and_then(|arr| arr.first())
                .and_then(|server| server.get("id"))
                .and_then(|id| id.as_str())
                .unwrap_or("0")
                .to_string()
        } else {
            "0".to_string() // Default to "0" if parsing fails
        };
        
        debug!(server_id = %server_id, "Using server ID for authentication");

        // Step 2: Authenticate with POST request
        let login_url = format!("{}/login.web", self.base_url);
        debug!(url = %login_url, "Step 2: Authenticating with ExacqVision");

        let params = [
            ("user", self.username.as_str()),
            ("password", self.password.as_str()),
            ("id", server_id.as_str()),
        ];

        let response = self.client
            .post(&login_url)
            .header("Accept", "application/json")
            .header("X-Requested-With", "XMLHttpRequest")
            .form(&params)
            .send()
            .await?;

        let status = response.status();
        let text = response.text().await?;
        
        debug!(status = %status, "Login response received");

        // Log preview for debugging
        let login_preview: String = text.chars().take(300).collect();
        debug!(preview = %login_preview, "Login response preview");

        // Check if we got HTML instead of JSON (server not accessible or wrong endpoint)
        if text.contains("<!DOCTYPE") || text.contains("<html") {
            error!("Received HTML instead of JSON - ExacqVision server may not be accessible from this network");
            return Err(anyhow::anyhow!("ExacqVision returned HTML login page - server may require local network access or VPN"));
        }

        // Try to parse as JSON
        if let Ok(login_response) = serde_json::from_str::<LoginResponse>(&text) {
            if let Some(session_id) = login_response.get_session_id() {
                info!(session_id = %session_id, "ExacqVision login successful");
                return Ok(session_id.to_string());
            }
            if let Some(error) = login_response.error {
                error!(error = %error, "ExacqVision login failed");
                return Err(anyhow::anyhow!("Login failed: {}", error));
            }
        }

        // Sometimes the response is just the session UUID as plain text
        let trimmed = text.trim();
        if trimmed.len() >= 32 && !trimmed.contains(' ') && !trimmed.contains("error") {
            info!(session_id = %trimmed, "ExacqVision login successful (plain text response)");
            return Ok(trimmed.to_string());
        }

        Err(anyhow::anyhow!("Failed to parse login response: {}", login_preview))
    }

    /// Verify a session is still valid
    #[instrument(skip(self))]
    pub async fn verify_session(&self, session_id: &str) -> anyhow::Result<bool> {
        let url = format!(
            "{}/login.web?s={}&action=verify",
            self.base_url, session_id
        );

        debug!(url = %url, "Verifying session");

        let response = self.client
            .get(&url)
            .send()
            .await?;

        let status = response.status();
        
        if status.is_success() {
            let text = response.text().await?;
            // Check for various success indicators
            if text.contains("valid") || text.contains("ok") || text.is_empty() {
                return Ok(true);
            }
            // Parse as JSON if possible
            if let Ok(verify_response) = serde_json::from_str::<SessionVerifyResponse>(&text) {
                return Ok(verify_response.valid.unwrap_or(false));
            }
        }

        Ok(false)
    }

    /// Get list of devices/cameras
    #[instrument(skip(self))]
    pub async fn get_devices(&self, session_id: &str) -> anyhow::Result<Vec<Camera>> {
        let url = format!(
            "{}/server.web/devices?s={}",
            self.base_url, session_id
        );

        debug!(url = %url, "Fetching devices");

        let response = self.client
            .get(&url)
            .send()
            .await?;

        let status = response.status();
        let text = response.text().await?;
        
        debug!(status = %status, "Devices response received");

        // Try to parse as DevicesResponse
        if let Ok(devices_response) = serde_json::from_str::<DevicesResponse>(&text) {
            // Flatten cameras from devices or use direct cameras list
            let cameras: Vec<Camera> = if !devices_response.cameras.is_empty() {
                devices_response.cameras
            } else {
                devices_response.devices
                    .into_iter()
                    .flat_map(|d| d.cameras)
                    .collect()
            };
            return Ok(cameras);
        }

        // Try parsing as direct array of cameras
        if let Ok(cameras) = serde_json::from_str::<Vec<Camera>>(&text) {
            return Ok(cameras);
        }

        warn!(response = %text, "Could not parse devices response");
        Ok(Vec::new())
    }

    /// Get camera details
    #[instrument(skip(self))]
    pub async fn get_camera(&self, session_id: &str, camera_id: i64) -> anyhow::Result<Option<Camera>> {
        let url = format!(
            "{}/camera.web?s={}&camera={}",
            self.base_url, session_id, camera_id
        );

        debug!(url = %url, "Fetching camera details");

        let response = self.client
            .get(&url)
            .send()
            .await?;

        let status = response.status();
        let text = response.text().await?;

        if !status.is_success() {
            return Ok(None);
        }

        // Try to parse as CameraDetailResponse
        if let Ok(detail_response) = serde_json::from_str::<CameraDetailResponse>(&text) {
            return Ok(detail_response.camera);
        }

        // Try parsing directly as Camera
        if let Ok(camera) = serde_json::from_str::<Camera>(&text) {
            return Ok(Some(camera));
        }

        Ok(None)
    }

    /// Get raw HTTP client for streaming
    pub fn http_client(&self) -> &Client {
        &self.client
    }

    /// Build video stream URL
    pub fn build_stream_url(&self, params: &StreamParams) -> String {
        format!("{}{}", self.base_url, params.to_url_path_with_timestamp())
    }

    /// Build snapshot URL (single frame)
    pub fn build_snapshot_url(&self, session_id: &str, camera_id: i64, width: u32, height: u32, quality: u8) -> String {
        let timestamp = chrono::Utc::now().timestamp_millis();
        format!(
            "{}/video.web?s={};camera={};w={};h={};q={};format=6;t={};single=1",
            self.base_url, session_id, camera_id, width, height, quality, timestamp
        )
    }

    /// Get streaming response (for MJPEG proxy)
    #[instrument(skip(self))]
    pub async fn get_stream(&self, params: &StreamParams) -> anyhow::Result<Response> {
        let url = self.build_stream_url(params);
        
        debug!(url = %url, "Starting video stream");

        let response = self.client
            .get(&url)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("Stream request failed: {} - {}", status, text));
        }

        Ok(response)
    }

    /// Get single snapshot
    #[instrument(skip(self))]
    pub async fn get_snapshot(
        &self,
        session_id: &str,
        camera_id: i64,
        width: u32,
        height: u32,
        quality: u8,
    ) -> anyhow::Result<bytes::Bytes> {
        let url = self.build_snapshot_url(session_id, camera_id, width, height, quality);
        
        debug!(url = %url, "Getting snapshot");

        let response = self.client
            .get(&url)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!("Snapshot request failed: {} - {}", status, text));
        }

        Ok(response.bytes().await?)
    }

    /// Send PTZ command
    #[instrument(skip(self))]
    pub async fn send_ptz_command(
        &self,
        session_id: &str,
        camera_id: i64,
        command: &PtzCommand,
    ) -> anyhow::Result<bool> {
        // ExacqVision PTZ command format
        let url = format!(
            "{}/ptz.web?s={}&camera={}&action={}&speed={}",
            self.base_url, session_id, camera_id, command.action, command.speed
        );

        let url = if let Some(preset) = command.preset {
            format!("{}&preset={}", url, preset)
        } else {
            url
        };

        debug!(url = %url, "Sending PTZ command");

        let response = self.client
            .get(&url)
            .send()
            .await?;

        Ok(response.status().is_success())
    }

    /// Get WebSocket URL for events
    pub fn get_websocket_url(&self, session_id: &str) -> String {
        // Convert HTTP(S) URL to WS(S) URL
        let ws_url = if self.base_url.starts_with("https://") {
            self.base_url.replace("https://", "wss://")
        } else {
            self.base_url.replace("http://", "ws://")
        };

        format!(
            "{}/camera.web/legacywebsocket?s={}",
            ws_url, session_id
        )
    }
}
