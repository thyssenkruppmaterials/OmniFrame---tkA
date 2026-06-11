// Created and developed by Jai Singh
//! ExacqVision data models
//!
//! Data structures for cameras, devices, streams, and events.

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

/// Login response from ExacqVision
#[derive(Debug, Clone, Deserialize)]
pub struct LoginResponse {
    /// Session UUID returned from login
    #[serde(rename = "session")]
    pub session_id: Option<String>,
    /// Alternative field name for session
    #[serde(rename = "s")]
    pub session_alt: Option<String>,
    /// Error message if login failed
    pub error: Option<String>,
    /// Status code
    pub status: Option<i32>,
}

impl LoginResponse {
    /// Get the session ID from either field
    pub fn get_session_id(&self) -> Option<&str> {
        self.session_id.as_deref().or(self.session_alt.as_deref())
    }
}

/// Session verification response
#[derive(Debug, Clone, Deserialize)]
pub struct SessionVerifyResponse {
    /// Session is valid
    pub valid: Option<bool>,
    /// Session status
    pub status: Option<String>,
    /// Error message
    pub error: Option<String>,
}

/// Camera information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Camera {
    /// Camera ID
    pub id: i64,
    /// Camera name
    pub name: String,
    /// Camera description
    #[serde(default)]
    pub description: Option<String>,
    /// Whether camera is enabled
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Whether camera is online
    #[serde(default)]
    pub online: bool,
    /// Camera type/model
    #[serde(rename = "type")]
    pub camera_type: Option<String>,
    /// PTZ capabilities
    #[serde(default)]
    pub ptz_enabled: bool,
    /// Audio capabilities
    #[serde(default)]
    pub audio_enabled: bool,
    /// Resolution width
    #[serde(default)]
    pub width: Option<u32>,
    /// Resolution height
    #[serde(default)]
    pub height: Option<u32>,
    /// Frame rate
    #[serde(default)]
    pub fps: Option<f32>,
    /// Server ID this camera belongs to
    #[serde(default)]
    pub server_id: Option<i64>,
}

fn default_true() -> bool {
    true
}

/// Device information from /server.web/devices
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
    /// Device ID
    pub id: i64,
    /// Device name
    pub name: String,
    /// Device type
    #[serde(rename = "type")]
    pub device_type: Option<String>,
    /// IP address
    pub ip: Option<String>,
    /// MAC address
    pub mac: Option<String>,
    /// Serial number
    pub serial: Option<String>,
    /// Firmware version
    pub firmware: Option<String>,
    /// Online status
    #[serde(default)]
    pub online: bool,
    /// Associated cameras
    #[serde(default)]
    pub cameras: Vec<Camera>,
}

/// Devices response wrapper
#[derive(Debug, Clone, Deserialize)]
pub struct DevicesResponse {
    /// List of devices
    #[serde(default)]
    pub devices: Vec<Device>,
    /// Alternative: list of cameras directly
    #[serde(default)]
    pub cameras: Vec<Camera>,
}

/// Camera detail response
#[derive(Debug, Clone, Deserialize)]
pub struct CameraDetailResponse {
    /// Camera information
    pub camera: Option<Camera>,
    /// Error message
    pub error: Option<String>,
}

/// Stream parameters for video requests
#[derive(Debug, Clone, Serialize)]
pub struct StreamParams {
    /// Session ID
    pub session_id: String,
    /// Camera ID
    pub camera_id: i64,
    /// Video width
    pub width: u32,
    /// Video height
    pub height: u32,
    /// Quality (1-10)
    pub quality: u8,
    /// Format (6 = MJPEG)
    pub format: u8,
}

impl StreamParams {
    /// Create new stream parameters with defaults
    pub fn new(session_id: String, camera_id: i64) -> Self {
        Self {
            session_id,
            camera_id,
            width: 640,
            height: 480,
            quality: 8,
            format: 6, // MJPEG
        }
    }

    /// Build the URL path for video.web endpoint
    /// Note: ExacqVision uses semicolons as parameter separators
    pub fn to_url_path(&self) -> String {
        format!(
            "/video.web?s={};camera={};w={};h={};q={};format={}",
            self.session_id,
            self.camera_id,
            self.width,
            self.height,
            self.quality,
            self.format
        )
    }

    /// Build URL with cache-busting timestamp
    pub fn to_url_path_with_timestamp(&self) -> String {
        let timestamp = chrono::Utc::now().timestamp_millis();
        format!(
            "/video.web?s={};camera={};w={};h={};q={};format={};t={}",
            self.session_id,
            self.camera_id,
            self.width,
            self.height,
            self.quality,
            self.format,
            timestamp
        )
    }
}

/// Recording information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recording {
    /// Recording ID
    pub id: String,
    /// Camera ID
    pub camera_id: i64,
    /// Start time
    pub start_time: DateTime<Utc>,
    /// End time
    pub end_time: Option<DateTime<Utc>>,
    /// Duration in seconds
    pub duration_seconds: Option<i64>,
    /// Recording type (continuous, motion, alarm)
    pub recording_type: Option<String>,
    /// File size in bytes
    pub file_size: Option<u64>,
}

/// PTZ (Pan-Tilt-Zoom) command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PtzCommand {
    /// PTZ action (pan_left, pan_right, tilt_up, tilt_down, zoom_in, zoom_out, stop, preset)
    pub action: String,
    /// Speed (0-100)
    #[serde(default = "default_speed")]
    pub speed: u8,
    /// Preset number (for preset action)
    pub preset: Option<u8>,
}

fn default_speed() -> u8 {
    50
}

/// WebSocket event types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CameraEvent {
    /// Motion detected
    #[serde(rename = "motion")]
    Motion {
        camera_id: i64,
        camera_name: String,
        timestamp: DateTime<Utc>,
        zone: Option<String>,
    },
    /// Camera offline
    #[serde(rename = "offline")]
    Offline {
        camera_id: i64,
        camera_name: String,
        timestamp: DateTime<Utc>,
    },
    /// Camera online
    #[serde(rename = "online")]
    Online {
        camera_id: i64,
        camera_name: String,
        timestamp: DateTime<Utc>,
    },
    /// Recording started
    #[serde(rename = "recording_start")]
    RecordingStart {
        camera_id: i64,
        camera_name: String,
        timestamp: DateTime<Utc>,
        recording_id: String,
    },
    /// Recording stopped
    #[serde(rename = "recording_stop")]
    RecordingStop {
        camera_id: i64,
        camera_name: String,
        timestamp: DateTime<Utc>,
        recording_id: String,
    },
    /// Alarm/trigger event
    #[serde(rename = "alarm")]
    Alarm {
        camera_id: i64,
        camera_name: String,
        timestamp: DateTime<Utc>,
        alarm_type: String,
    },
    /// Generic event
    #[serde(rename = "event")]
    Generic {
        camera_id: Option<i64>,
        message: String,
        timestamp: DateTime<Utc>,
    },
}

/// API response wrapper for camera list
#[derive(Debug, Clone, Serialize)]
pub struct CameraListResponse {
    pub cameras: Vec<Camera>,
    pub total: usize,
    pub timestamp: DateTime<Utc>,
}

/// API response wrapper for single camera
#[derive(Debug, Clone, Serialize)]
pub struct CameraResponse {
    pub camera: Camera,
    pub timestamp: DateTime<Utc>,
}

/// Health check response for ExacqVision connection
#[derive(Debug, Clone, Serialize)]
pub struct ExacqHealth {
    pub connected: bool,
    pub session_valid: bool,
    pub latency_ms: u64,
    pub last_check: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_params_new_sets_correct_defaults() {
        let params = StreamParams::new("sess-abc-123".to_string(), 42);

        assert_eq!(params.session_id, "sess-abc-123");
        assert_eq!(params.camera_id, 42);
        assert_eq!(params.width, 640);
        assert_eq!(params.height, 480);
        assert_eq!(params.quality, 8);
        assert_eq!(params.format, 6); // MJPEG
    }

    #[test]
    fn stream_params_to_url_path_formats_correctly() {
        let params = StreamParams {
            session_id: "test-session".to_string(),
            camera_id: 7,
            width: 1280,
            height: 720,
            quality: 9,
            format: 6,
        };

        assert_eq!(
            params.to_url_path(),
            "/video.web?s=test-session;camera=7;w=1280;h=720;q=9;format=6"
        );
    }

    #[test]
    fn login_response_prefers_primary_session_field() {
        let resp = LoginResponse {
            session_id: Some("primary-id".to_string()),
            session_alt: Some("alt-id".to_string()),
            error: None,
            status: None,
        };
        assert_eq!(resp.get_session_id(), Some("primary-id"));
    }

    #[test]
    fn login_response_falls_back_to_alt_session_field() {
        let resp = LoginResponse {
            session_id: None,
            session_alt: Some("alt-id".to_string()),
            error: None,
            status: None,
        };
        assert_eq!(resp.get_session_id(), Some("alt-id"));
    }

    #[test]
    fn login_response_returns_none_when_both_fields_empty() {
        let resp = LoginResponse {
            session_id: None,
            session_alt: None,
            error: Some("auth failed".to_string()),
            status: Some(401),
        };
        assert_eq!(resp.get_session_id(), None);
    }

    #[test]
    fn camera_event_motion_serializes_with_correct_type_tag() {
        let event = CameraEvent::Motion {
            camera_id: 5,
            camera_name: "Front Door".to_string(),
            timestamp: chrono::Utc::now(),
            zone: Some("Zone A".to_string()),
        };
        let json = serde_json::to_value(&event).unwrap();

        assert_eq!(json["type"], "motion");
        assert_eq!(json["camera_id"], 5);
        assert_eq!(json["camera_name"], "Front Door");
        assert_eq!(json["zone"], "Zone A");
    }

    #[test]
    fn ptz_command_deserializes_with_default_speed() {
        let cmd: PtzCommand = serde_json::from_str(r#"{"action": "pan_left"}"#).unwrap();

        assert_eq!(cmd.action, "pan_left");
        assert_eq!(cmd.speed, 50);
        assert!(cmd.preset.is_none());
    }
}

// Created and developed by Jai Singh
