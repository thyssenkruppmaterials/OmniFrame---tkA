// Created and developed by Jai Singh
//! In-process state. One `Arc<AgentState>` is shared by every router
//! handler + every lifecycle background task.

use std::sync::Arc;

use agent_types::SessionPoolSnapshot;
use chrono::{DateTime, Utc};
use parking_lot::RwLock;

use crate::config::AgentConfig;
use crate::session_pool::SessionPool;

/// Cache for the most recently exchanged identity-v2 JWT. The work-
/// service tokens have a 15-minute lifetime so we re-mint at 90% (540s)
/// to keep a fresh one in hand.
#[derive(Debug, Clone, Default)]
pub struct JwtCache {
    pub bearer: Option<String>,
    /// When the cached token stops being usable.
    pub expires_at: Option<DateTime<Utc>>,
    /// Service-key fingerprint (`omni_sk_<first 8 chars>`) for log
    /// breadcrumbs. Never stores the full key.
    pub service_key_prefix: Option<String>,
}

/// Cached Supabase session. We expose an `Option<Value>` so the FE can
/// see exactly what the auth handshake returned without us re-modeling
/// the Supabase user shape.
#[derive(Debug, Clone, Default)]
pub struct SupabaseSession {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
    pub user_email: Option<String>,
    pub organization_id: Option<uuid::Uuid>,
    pub raw_user: Option<serde_json::Value>,
}

/// Per-user `agent_token` issued on `/supabase/login`. The middleware
/// gate compares this against the `X-Agent-Token` header for sensitive
/// endpoints — see `middleware::token_guard`.
#[derive(Debug, Clone, Default)]
pub struct AgentToken {
    pub token: String,
    pub minted_at: Option<DateTime<Utc>>,
}

/// Centralized mutable state.
pub struct AgentState {
    pub agent_id: String,
    pub started_at: DateTime<Utc>,
    pub install_dir: String,

    pub session_pool: SessionPool,

    pub jwt: RwLock<JwtCache>,
    pub supabase: RwLock<SupabaseSession>,
    pub agent_token: RwLock<AgentToken>,

    pub helper_restart_count: std::sync::atomic::AtomicU64,
    pub jobs_processed: std::sync::atomic::AtomicU64,
}

impl AgentState {
    pub fn new(config: &AgentConfig) -> Self {
        let agent_id = config
            .agent_id_override
            .clone()
            .unwrap_or_else(default_agent_id);
        Self {
            agent_id,
            started_at: Utc::now(),
            install_dir: config.install_dir.to_string_lossy().to_string(),
            session_pool: SessionPool::new(),
            jwt: RwLock::new(JwtCache::default()),
            supabase: RwLock::new(SupabaseSession::default()),
            agent_token: RwLock::new(AgentToken::default()),
            helper_restart_count: std::sync::atomic::AtomicU64::new(0),
            jobs_processed: std::sync::atomic::AtomicU64::new(0),
        }
    }

    pub fn snapshot_pool(&self) -> SessionPoolSnapshot {
        self.session_pool.snapshot()
    }

    /// True if any of the heuristics in the v1.x `detect_citrix()`
    /// match. Keeping it conservative: we look at SESSIONNAME and
    /// CITRIX_* env vars.
    pub fn detect_citrix() -> bool {
        if let Ok(s) = std::env::var("SESSIONNAME") {
            if s.to_ascii_lowercase().starts_with("ica-") {
                return true;
            }
        }
        std::env::var("CITRIX_LOGON_ID").is_ok() || std::env::var("CITRIX_HDX_USERNAME").is_ok()
    }
}

/// `<COMPUTERNAME>-<SESSIONNAME>-<USERNAME>` per the v1.x convention.
/// macOS dev-host fallback: `host-cli-user`. We keep this here (rather
/// than in `agent-bin`) so unit tests can poke it.
pub fn default_agent_id() -> String {
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "host".into());
    let sess = std::env::var("SESSIONNAME").unwrap_or_else(|_| "cli".into());
    let user = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "user".into());
    format!("{host}-{sess}-{user}")
}

/// Convenient typed alias used by axum extractors.
pub type SharedState = Arc<AgentState>;

// Created and developed by Jai Singh
