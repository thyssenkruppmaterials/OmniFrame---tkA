// Created and developed by Jai Singh
//! JSON-RPC client + supervisor for the Python SAP helper subprocess.
//!
//! The Rust agent shell shells out to a long-lived `python sap_helper.py`
//! process and talks to it over stdin/stdout using line-delimited
//! JSON-RPC 2.0. This crate owns:
//!
//! 1. **Spawn + supervisor** ([`PythonHelper::spawn`]) — launches the
//!    subprocess, attaches stdin/stdout/stderr pipes, and restarts on
//!    unexpected exit with bounded exponential backoff.
//! 2. **Request dispatch** ([`PythonHelper::call`]) — strongly-typed
//!    over the params + result with a per-call timeout.
//! 3. **Notification fan-out** ([`PythonHelper::subscribe_notifications`])
//!    — broadcast channel for one-way messages (log lines, slot state
//!    flips). The agent-core console relay consumes this.
//! 4. **Stderr capture** — stderr is line-tee'd into the tracing
//!    subscriber at WARN level so a Python traceback shows up in the
//!    same log stream as the Rust side.
//!
//! See `omni_agent_v2/crates/agent-rpc/tests/round_trip.rs` for the
//! integration test that runs a mock helper end-to-end.

mod helper;
mod supervisor;
mod types;

pub use helper::PythonHelper;
pub use supervisor::HelperConfig;
pub use types::{HelperCallError, HelperStatus};

// Re-export the types Worker A's downstream crates need so they don't
// have to depend on `agent-types` AND `agent-rpc` separately.
pub use agent_types::{RpcError, RpcMethod, RpcNotification, RpcRequest, RpcResponse};

// Created and developed by Jai Singh
