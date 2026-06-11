// Created and developed by Jai Singh
//! Service-key + JWT exchange helpers.
//!
//! 3-tier loader (matches v1.x):
//!
//!   1. `OMNIFRAME_AGENT_SERVICE_KEY` env var (fast path — operators
//!      can override at launch).
//!   2. canonical file at `~/.omniframe/agent_service_key.txt`.
//!   3. alongside-EXE file at `<install_dir>/agent_service_key.txt` —
//!      auto-promoted to the canonical path on first read.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

/// Hand-back from a successful `/api/v1/agent-identity/exchange` call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct IdentityExchangeResponse {
    pub access_token: String,
    pub expires_in: u64,
    /// `Argon2id`-hashed service-key fingerprint the server echoes
    /// back. Helpful breadcrumb when an operator rotates a key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_fingerprint: Option<String>,
}

/// Read the service key using the 3-tier loader. Returns Err if all
/// three sources are empty.
pub fn load_service_key(canonical: &Path, alongside_exe: &Path) -> Result<String> {
    if let Ok(env_val) = std::env::var("OMNIFRAME_AGENT_SERVICE_KEY") {
        if !env_val.trim().is_empty() {
            return Ok(env_val.trim().to_string());
        }
    }
    if let Ok(content) = std::fs::read_to_string(canonical) {
        let trimmed = content.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    if let Ok(content) = std::fs::read_to_string(alongside_exe) {
        let trimmed = content.trim();
        if !trimmed.is_empty() {
            // Auto-promote to the canonical path so subsequent boots
            // pick it up via tier 2.
            if let Some(parent) = canonical.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(canonical, trimmed);
            return Ok(trimmed.to_string());
        }
    }
    Err(anyhow::anyhow!(
        "service key not found: tried env OMNIFRAME_AGENT_SERVICE_KEY, {}, {}",
        canonical.display(),
        alongside_exe.display()
    ))
}

/// Default canonical path: `~/.omniframe/agent_service_key.txt`.
pub fn default_canonical_path() -> PathBuf {
    dirs::home_dir()
        .map(|h| h.join(".omniframe").join("agent_service_key.txt"))
        .unwrap_or_else(|| PathBuf::from("agent_service_key.txt"))
}

/// Exchange the service key for a 15-min JWT. Returns the typed
/// response; the caller is responsible for caching + scheduling
/// renewal (see `tasks::jwt_refresher`).
pub async fn exchange_service_key(
    work_service_url: &str,
    service_key: &str,
    agent_id: &str,
) -> Result<IdentityExchangeResponse> {
    let url = format!(
        "{}/api/v1/agent-identity/exchange",
        work_service_url.trim_end_matches('/')
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .context("build reqwest client")?;

    let body = serde_json::json!({
        "service_key": service_key,
        "agent_id": agent_id,
    });
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .with_context(|| format!("POST {url}"))?;
    let status = resp.status();
    let raw = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        anyhow::bail!("identity exchange {status}: {raw}");
    }
    let parsed: IdentityExchangeResponse =
        serde_json::from_str(&raw).with_context(|| format!("parse exchange response: {raw}"))?;
    Ok(parsed)
}

// Created and developed by Jai Singh
