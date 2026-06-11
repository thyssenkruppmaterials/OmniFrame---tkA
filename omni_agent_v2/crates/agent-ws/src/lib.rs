// Created and developed by Jai Singh
//! Resilient WebSocket client to `rust-work-service /ws`.
//!
//! Port of `omni_agent/work_service_ws.py` to Rust. Same two-layer
//! keepalive (library-level ping/pong + application-level watchdog),
//! same bounded exponential reconnect (1s → 30s with stable-connection
//! reset), same metrics surface (`reconnect_count`, `watchdog_trips`,
//! `last_message_received_at`, `last_reconnect_reason`).
//!
//! Public API:
//!
//! ```ignore
//! use std::sync::Arc;
//! use agent_ws::{TokenProvider, WorkServiceWs};
//!
//! struct StaticToken(String);
//!
//! #[async_trait::async_trait]
//! impl TokenProvider for StaticToken {
//!     async fn get_token(&self) -> anyhow::Result<String> {
//!         Ok(self.0.clone())
//!     }
//! }
//!
//! # async fn demo() -> anyhow::Result<()> {
//! let url = url::Url::parse("https://rust-work-service-production.up.railway.app")?;
//! let provider = Arc::new(StaticToken("bearer-token".into()));
//! let ws = WorkServiceWs::new(url, provider).await?;
//! let mut events = ws.subscribe_events();
//! tokio::spawn(async move {
//!     ws.run("HOST-W1".into(), vec!["lt12".into()], "v2.0.0-alpha".into()).await;
//! });
//! # Ok(()) }
//! ```

mod metrics;
mod runner;
mod token;

pub use metrics::WsMetrics;
pub use runner::WorkServiceWs;
pub use token::TokenProvider;

// Re-export the types downstream crates need.
pub use agent_types::{SubscribeMessage, WsEvent};

// Created and developed by Jai Singh
