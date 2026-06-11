// Created and developed by Jai Singh
//! Multi-session pool types (NEW in v2).
//!
//! The Python v1.x agent pinned to a single `(conn_idx, sess_idx)` SAP
//! GUI session via globals. v2 manages a fixed 6-slot pool so the
//! Tauri GUI can render a 3×2 tile grid of live sessions and the FE
//! can dispatch parallel SAP work without spawning multiple agent.exe
//! processes.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::constants::SESSION_POOL_SIZE;

/// Slot id within the pool. Always `0..SESSION_POOL_SIZE` (currently 6).
pub type SlotId = u8;

/// Lifecycle state of a single pool slot. Mirrors the GUI tile colour
/// palette in `memorybank/OmniFrame/Implementations/Plan-Multi-Session-Agent-Master.md`
/// §"Color system":
///
/// | State           | Tile pill |
/// |-----------------|-----------|
/// | `Empty`         | grey      |
/// | `Connecting`    | amber     |
/// | `Idle`          | green     |
/// | `Busy`          | green + spinner |
/// | `Error`         | red       |
/// | `Disconnected`  | rose      |
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    /// Slot has no SAP session bound.
    #[default]
    Empty,
    /// Connecting to / pinning a SAP session.
    Connecting,
    /// Bound + healthy, ready to accept work.
    Idle,
    /// Bound + healthy, currently executing a SAP operation.
    Busy,
    /// Bound but in an unrecoverable error state — operator must Fix.
    Error,
    /// Was bound, lost its SAP connection (COM exception, sapgui restart).
    Disconnected,
}

/// One pool slot. Carries everything the GUI tile needs to render
/// without a follow-up round-trip. Most fields are `Option` because a
/// brand-new slot has nothing bound to it yet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct SessionSlot {
    pub slot_id: SlotId,
    pub state: SessionState,
    /// SAP COM `Children(...)` index — the upstream Connection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conn_idx: Option<i32>,
    /// SAP COM `Children(...).Children(...)` index — the Session in that
    /// Connection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sess_idx: Option<i32>,
    /// Operator-supplied human label ("Bay 1 — Outbound").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Short string for the GUI ("LT12 confirm TO 8801").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_op: Option<String>,
    /// When `last_op` was set, so the GUI can render "12s ago".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_op_at: Option<DateTime<Utc>>,
    /// Last error message (truncated to ~200 chars by the agent before
    /// serialisation).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    /// When the slot was marked `Busy`. Used by the GUI to render a
    /// spinner age. None when the slot is anything other than `Busy`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub busy_since: Option<DateTime<Utc>>,
}

impl SessionSlot {
    pub fn empty(slot_id: SlotId) -> Self {
        Self {
            slot_id,
            state: SessionState::Empty,
            ..Default::default()
        }
    }
}

/// Snapshot of all 6 slots. Returned by `GET /sap/v2/sessions` and
/// embedded in `StatusResponse.six_session_pool`. The fixed-size array
/// guarantees the FE always renders exactly 6 tiles.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SessionPoolSnapshot {
    /// Always [`SESSION_POOL_SIZE`] entries, indexed by `slot_id`. We
    /// serialize as a flat array so the FE can do `pool.sessions[3]`
    /// without searching by `slot_id`.
    pub sessions: [SessionSlot; SESSION_POOL_SIZE],
}

impl Default for SessionPoolSnapshot {
    fn default() -> Self {
        SessionPoolSnapshot {
            sessions: [
                SessionSlot::empty(0),
                SessionSlot::empty(1),
                SessionSlot::empty(2),
                SessionSlot::empty(3),
                SessionSlot::empty(4),
                SessionSlot::empty(5),
            ],
        }
    }
}

/// Optional `session_id` field/param accepted by every existing
/// `/sap/*` route to thread the call to a specific pool slot. v1.x
/// payloads omit it (the single-session agent has no choice anyway).
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SessionTarget {
    /// Slot to dispatch to. Defaults to slot 0 (the legacy "primary"
    /// session) when unset, preserving v1.x single-session semantics.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<SlotId>,
}

/// Body of `POST /sap/v2/sessions/{slot_id}/pin`. We carry the raw COM
/// indices the Python helper needs to `Children(conn_idx).Children(sess_idx)`
/// on the SAP scripting engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct PinSlotRequest {
    pub conn_idx: i32,
    pub sess_idx: i32,
    /// Operator-supplied human label. Optional; if omitted the agent
    /// generates a default like "Slot {slot_id}".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// `GET /sap/sessions` response item — one entry per SAP session
/// discovered via `SAPGUI.GetScriptingEngine.Children(i).Children(j).Info`.
/// Used by the GUI's "Pair workers to sessions" wizard step and the
/// "Reassign Session" dialog.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SapSession {
    pub conn_idx: i32,
    pub sess_idx: i32,
    pub system: String,
    pub client: String,
    pub user: String,
    pub transaction: String,
    pub program: String,
    pub session_title: String,
    /// True if this `(conn_idx, sess_idx)` is currently pinned to a
    /// pool slot.
    #[serde(default)]
    pub pinned: bool,
    /// When `pinned == true`, which slot owns it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pinned_slot: Option<SlotId>,
}

// Created and developed by Jai Singh
