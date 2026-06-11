// Created and developed by Jai Singh
//! HTTP route handlers. Split per concern so each module stays
//! readable.

pub mod agents;
pub mod auth;
pub mod jobs;
pub mod lifecycle;
pub mod recording;
pub mod sap;
pub mod session_v2;

use std::sync::Arc;

use crate::config::AgentConfig;
use crate::state::AgentState;
use agent_rpc::PythonHelper;
use agent_ws::WorkServiceWs;

/// Bundle of dependencies passed to every handler via axum
/// [`State`](axum::extract::State).
#[derive(Clone)]
pub struct AppContext {
    pub state: Arc<AgentState>,
    pub helper: PythonHelper,
    pub ws: WorkServiceWs,
    pub config: AgentConfig,
}

// Created and developed by Jai Singh
