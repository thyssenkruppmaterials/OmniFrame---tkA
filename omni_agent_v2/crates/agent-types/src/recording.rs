// Created and developed by Jai Singh
//! `/sap/recording/*` types — self-recording mode (mirror v1.x).

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RecordingStartRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// `"hooks" | "polling"`. Defaults to `"hooks"`.
    #[serde(default = "default_recording_mode")]
    pub mode: String,
}

fn default_recording_mode() -> String {
    "hooks".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RecordingTranslateRequest {
    pub name: String,
    /// `"query" | "mutation"`. Defaults to `"mutation"`.
    #[serde(default = "default_translate_kind")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_overrides: Option<Value>,
}

fn default_translate_kind() -> String {
    "mutation".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RecordingListItem {
    pub id: String,
    pub name: String,
    pub status: String,
    pub started_at: String,
    #[serde(default)]
    pub event_count: usize,
    #[serde(default)]
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RecordingListResponse {
    pub ok: bool,
    pub items: Vec<RecordingListItem>,
    pub count: usize,
}

// Created and developed by Jai Singh
