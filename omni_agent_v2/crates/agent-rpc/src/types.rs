// Created and developed by Jai Singh
//! Public error / status types for the helper supervisor.

use agent_types::RpcError;
use thiserror::Error;

/// What went wrong on a single `PythonHelper::call`.
#[derive(Debug, Error)]
pub enum HelperCallError {
    /// The helper returned a structured JSON-RPC error.
    #[error("rpc error: {0}")]
    Rpc(#[from] RpcError),
    /// The supervisor channel closed (helper crashed mid-flight).
    #[error("helper channel closed: {0}")]
    ChannelClosed(String),
    /// The per-call timeout fired before a response arrived.
    #[error("helper timeout after {elapsed_ms}ms")]
    Timeout { elapsed_ms: u64 },
    /// JSON encode of the params failed (programmer error).
    #[error("could not serialize request params: {0}")]
    Serialize(#[source] serde_json::Error),
    /// JSON decode of the response failed (helper protocol violation).
    #[error("could not deserialize response: {0}")]
    Deserialize(#[source] serde_json::Error),
}

impl From<HelperCallError> for RpcError {
    fn from(err: HelperCallError) -> Self {
        match err {
            HelperCallError::Rpc(e) => e,
            HelperCallError::ChannelClosed(m) => RpcError::channel_closed(m),
            HelperCallError::Timeout { elapsed_ms } => {
                RpcError::helper_timeout(format!("{elapsed_ms}ms"))
            }
            HelperCallError::Serialize(e) => RpcError::new(RpcError::INVALID_PARAMS, e.to_string()),
            HelperCallError::Deserialize(e) => {
                RpcError::new(RpcError::INTERNAL_ERROR, e.to_string())
            }
        }
    }
}

/// Lifecycle snapshot for the helper. Read by `agent-core /metrics` +
/// `/health` so the FE can flag a helper that's been restarting in a
/// loop.
#[derive(Debug, Clone, Copy)]
pub struct HelperStatus {
    /// Has the supervisor seen at least one live child since boot?
    pub ever_started: bool,
    /// Number of times the supervisor has had to respawn the child.
    pub restart_count: u64,
    /// Process id of the current (live) child, if any.
    pub pid: Option<u32>,
}

// Created and developed by Jai Singh
