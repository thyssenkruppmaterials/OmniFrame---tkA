// Created and developed by Jai Singh
//! Shared serde models for OmniAgent v2.
//!
//! This crate is the **wire contract** between the headless `agent.exe`,
//! the Tauri GUI shell, the Python SAP helper subprocess, the
//! browser-side admin UI that calls `http://127.0.0.1:8765`, and the
//! `rust-work-service` job control plane.
//!
//! Every shape in here matches one of:
//!
//! 1. A Pydantic model in `omni_agent/agent.py` / `lt22_import.py` /
//!    `zmm60_lookup.py` / `lx25_inventory_completion.py` /
//!    `material_master_read.py` (the v1.x Python agent). The Rust port
//!    must accept and emit byte-compatible JSON so the existing
//!    frontend keeps working without coordinated releases.
//!
//! 2. A `WsEvent` variant in `rust-work-service/src/websocket/mod.rs`.
//!    We re-declare the events we consume rather than depending on the
//!    work-service crate to keep the agent build self-contained.
//!
//! 3. A NEW v2 shape (the 6-slot session pool — see [`session::SessionPoolSnapshot`]).
//!    These carry the `multi-session-pool` capability flag and are the
//!    reason v2 is a major version bump.
//!
//! ## Serde conventions
//!
//! * `#[serde(rename_all = "snake_case")]` on every struct unless the
//!   shape it mirrors (a tagged enum from `rust-work-service`) is
//!   `PascalCase`.
//! * `#[serde(default, skip_serializing_if = "Option::is_none")]` on
//!   every optional field so omitted-vs-null wire shapes stay
//!   interchangeable.
//! * Tagged enums use `#[serde(tag = "type")]` to match the
//!   `rust-work-service` convention (see [`ws::WsEvent`]).

pub mod constants;
pub mod health;
pub mod jobs;
pub mod recording;
pub mod rpc;
pub mod sap;
pub mod session;
pub mod supabase;
pub mod ws;

pub use constants::*;
pub use health::*;
pub use jobs::*;
pub use recording::*;
pub use rpc::*;
pub use sap::*;
pub use session::*;
pub use supabase::*;
pub use ws::*;

// Created and developed by Jai Singh
