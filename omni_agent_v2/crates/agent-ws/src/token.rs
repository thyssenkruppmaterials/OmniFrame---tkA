// Created and developed by Jai Singh
//! [`TokenProvider`] — abstraction over "give me a fresh JWT".
//!
//! The agent's auth flow re-mints a 15-minute identity-v2 JWT every
//! 540s; the WS reconnect loop reads via this trait so the caller can
//! plug in any source (env var for tests, a `JwtCache` from agent-core
//! in production).

use async_trait::async_trait;

#[async_trait]
pub trait TokenProvider: Send + Sync + 'static {
    /// Return the current Bearer token. Invoked on EVERY reconnect so
    /// a freshly-minted JWT is picked up automatically.
    async fn get_token(&self) -> anyhow::Result<String>;

    /// Return the organization id to scope the Subscribe message on.
    /// Defaults to None (lets the work service infer from the token —
    /// same default the v1.x Python client uses when org isn't known).
    async fn organization_id(&self) -> anyhow::Result<Option<uuid::Uuid>> {
        Ok(None)
    }
}

/// Convenience constant token impl for tests + initial bring-up.
#[allow(dead_code)]
pub struct StaticToken {
    pub token: String,
    pub organization_id: Option<uuid::Uuid>,
}

#[async_trait]
impl TokenProvider for StaticToken {
    async fn get_token(&self) -> anyhow::Result<String> {
        Ok(self.token.clone())
    }
    async fn organization_id(&self) -> anyhow::Result<Option<uuid::Uuid>> {
        Ok(self.organization_id)
    }
}

// Created and developed by Jai Singh
