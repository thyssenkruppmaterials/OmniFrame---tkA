// Created and developed by Jai Singh
//! Agent core — the HTTP server on `127.0.0.1:8765`, the in-process
//! state, the lifecycle background tasks, and the reversal engine.
//!
//! Public entry point: [`AgentCore::run`].

pub mod config;
pub mod jwt;
pub mod metrics;
pub mod reversal;
pub mod router;
pub mod session_pool;
pub mod state;
pub mod token_provider;
pub mod work_service;

mod middleware;
mod routes;
mod tasks;

pub use config::{AgentConfig, AgentConfigBuilder};
pub use state::AgentState;

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;

use agent_rpc::PythonHelper;
use agent_ws::WorkServiceWs;
use anyhow::Context;
use tracing::info;
use url::Url;

/// Top-level handle. Holds everything `agent.exe` (and the Tauri GUI
/// shell) need to run a fully-armed agent without invoking individual
/// modules.
pub struct AgentCore {
    pub state: Arc<AgentState>,
    pub helper: PythonHelper,
    pub ws: WorkServiceWs,
    pub config: AgentConfig,
}

impl AgentCore {
    /// Build a core with a pre-spawned helper. Useful for the GUI shell
    /// which wants to share one helper with both the HTTP server and a
    /// set of direct `tauri::command` handlers.
    pub async fn build(config: AgentConfig, helper: PythonHelper) -> anyhow::Result<Self> {
        let state = Arc::new(AgentState::new(&config));

        // Construct a TokenProvider against the in-process AgentState.
        let token_provider: Arc<dyn agent_ws::TokenProvider> =
            Arc::new(token_provider::StateBackedTokenProvider {
                state: state.clone(),
            });

        let ws = WorkServiceWs::new(
            Url::parse(&config.work_service_url).context("parse work_service_url")?,
            token_provider,
        )
        .await?;

        Ok(Self {
            state,
            helper,
            ws,
            config,
        })
    }

    /// Convenience entry point that spawns the helper from
    /// `config.python_exe` + `config.helper_script`, then [`Self::run`]s.
    pub async fn run(config: AgentConfig) -> anyhow::Result<()> {
        let helper =
            PythonHelper::spawn(config.python_exe.clone(), config.helper_script.clone()).await?;
        let core = Self::build(config, helper).await?;
        core.serve().await
    }

    /// Start the HTTP server + the lifecycle background tasks. Blocks
    /// on Ctrl-C; `serve_until` is the testing-friendly variant.
    pub async fn serve(self) -> anyhow::Result<()> {
        let port = self.config.port;
        let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
        info!(%addr, "agent.exe starting HTTP server");

        // Wire up the long-running background tasks. They hold their
        // own clones of state/helper/ws so the server task can run
        // independently.
        tasks::spawn_all(
            self.state.clone(),
            self.helper.clone(),
            self.ws.clone(),
            self.config.clone(),
        );

        let app = router::build_router(
            self.state.clone(),
            self.helper.clone(),
            self.ws.clone(),
            self.config.clone(),
        );

        let listener = tokio::net::TcpListener::bind(addr)
            .await
            .with_context(|| format!("bind {addr}"))?;
        axum::serve(listener, app)
            .with_graceful_shutdown(shutdown_signal())
            .await
            .context("axum serve")?;

        info!("agent.exe HTTP server stopped — draining helper");
        let _ = self.helper.shutdown().await;
        Ok(())
    }
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    info!("ctrl-c received — initiating graceful shutdown");
}

// Created and developed by Jai Singh
