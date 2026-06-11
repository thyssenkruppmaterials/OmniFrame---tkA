// Created and developed by Jai Singh
//! `/supabase/*` passthrough types — login / session / logout.
//!
//! The Rust agent forwards these to `https://<supabase>.supabase.co/auth/v1`
//! and caches the result locally so the browser admin UI can use the
//! agent as a thin auth proxy (mirrors v1.x `omni_agent/agent.py` behaviour).

use serde::{Deserialize, Serialize};

/// `POST /supabase/login` — body. Mirrors v1.x `SupabaseConfigRequest`
/// with the user-cred fields included.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SupabaseLoginRequest {
    pub url: String,
    pub key: String,
    /// User email + password — optional because the FE sometimes calls
    /// `/supabase/login` purely to seed `state.supabase_url + key` for
    /// later RLS-fronted calls.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
}

/// `POST /supabase/login` response. We surface the freshly-minted
/// agent_token + the cached user object so the FE can immediately
/// stash both.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SupabaseLoginResponse {
    pub ok: bool,
    /// `agent_token` is the per-user X-Agent-Token gate. See
    /// `agent_core::middleware::token_guard` for enforcement.
    pub agent_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// `GET /supabase/session` — returns the cached session blob (or a
/// `null` `user` if not logged in). Loose-typed because Supabase's
/// session payload evolves with their SDK and we don't want a release
/// here every time they add a field.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct SupabaseSessionResponse {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
}

// Created and developed by Jai Singh
