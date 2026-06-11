// Created and developed by Jai Singh
//! agent-gui library surface.
//!
//! Two consumers today:
//!
//! 1. **The Tauri 2 binary** (`src/main.rs`) — driven by Worker C. It
//!    imports `mod commands;` (a bin-internal sibling) and dispatches
//!    `#[tauri::command]` handlers that long-poll the headless
//!    `agent.exe` over HTTP loopback. The binary is gated behind the
//!    `gui` Cargo feature so `cargo check --workspace` on a macOS dev
//!    box without the Tauri toolchain still passes.
//!
//! 2. **The in-process command stubs** ([`InProcessCommands`]) — usable
//!    by ANY embedder that wants to share an `Arc<AgentCore>` directly
//!    instead of round-tripping through HTTP. Worker A's task spec
//!    enumerates the eight canonical signatures (`get_session_states`,
//!    `connect_session`, …, `get_agent_metrics`); they live under the
//!    `in-process` Cargo feature so the lib stays Tauri-free + agent-
//!    core-free for the default build the bin uses today.

pub mod snapshot;

#[cfg(feature = "in-process")]
pub mod in_process;

#[cfg(feature = "in-process")]
pub use in_process::{AgentMetrics, InProcessCommands};

pub use snapshot::{ConsoleSnapshotLine, SessionPoolSnapshot};

// Created and developed by Jai Singh
