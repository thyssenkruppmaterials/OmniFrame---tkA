// Created and developed by Jai Singh
//! Bridge between [`crate::state::AgentState`] and the [`agent_ws::TokenProvider`]
//! abstraction.

use std::sync::Arc;

use async_trait::async_trait;

use crate::state::AgentState;

/// Reads the cached JWT + organization id from `AgentState`. The token
/// itself is refreshed by `tasks::jwt_refresher`.
pub struct StateBackedTokenProvider {
    pub state: Arc<AgentState>,
}

#[async_trait]
impl agent_ws::TokenProvider for StateBackedTokenProvider {
    async fn get_token(&self) -> anyhow::Result<String> {
        let bearer = self
            .state
            .jwt
            .read()
            .bearer
            .clone()
            .ok_or_else(|| anyhow::anyhow!("no bearer token in cache yet"))?;
        Ok(bearer)
    }

    async fn organization_id(&self) -> anyhow::Result<Option<uuid::Uuid>> {
        Ok(self.state.supabase.read().organization_id)
    }
}

// Created and developed by Jai Singh
