// Created and developed by Jai Singh
//! Wire-types shared by the bin's `commands` module + any external
//! consumer that wants to render the same shape without reaching into
//! `agent-types` directly.
//!
//! Worker C's `src/main.rs` references `commands::SessionPoolSnapshot`
//! locally (a sibling type kept inside the bin); this lib-level
//! re-declaration lets Worker A's downstream tests + the `in_process`
//! module use the same shape without a circular bin↔lib import.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use agent_types::SessionSlot as TypesSessionSlot;

/// Lib-level twin of the `commands::SessionPoolSnapshot` Worker C uses
/// inside the bin. We surface it here so the in-process command stubs
/// can return the same shape without dragging the bin module across
/// the lib boundary.
///
/// `serde(transparent)`-ish behaviour: the wire JSON is identical to a
/// raw `SessionPoolSnapshot` from `agent-types`. We just add a flat
/// `polled_at` for the GUI's "last refreshed" timestamp.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct SessionPoolSnapshot {
    pub sessions: Vec<TypesSessionSlot>,
    pub polled_at: DateTime<Utc>,
}

impl SessionPoolSnapshot {
    pub fn from_types(snap: agent_types::SessionPoolSnapshot) -> Self {
        Self {
            sessions: snap.sessions.to_vec(),
            polled_at: Utc::now(),
        }
    }

    /// Empty slots in `Empty` state — used by the bin when the agent
    /// is unreachable so the GUI tile grid renders without a blank
    /// frame.
    pub fn offline() -> Self {
        Self {
            sessions: (0..agent_types::SESSION_POOL_SIZE)
                .map(|i| TypesSessionSlot::empty(i as u8))
                .collect(),
            polled_at: Utc::now(),
        }
    }
}

/// One console line as the GUI renders it. The lib-side type drops the
/// `seq` (the bin tracks cursors per-slot in its own `AppState`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ConsoleSnapshotLine {
    pub ts: DateTime<Utc>,
    pub level: String,
    pub message: String,
    pub slot_id: u8,
    pub seq: u64,
}

impl From<agent_types::ConsoleLine> for ConsoleSnapshotLine {
    fn from(line: agent_types::ConsoleLine) -> Self {
        Self {
            ts: line.ts,
            level: line.level,
            message: line.message,
            slot_id: line.slot_id,
            seq: line.seq,
        }
    }
}

// Created and developed by Jai Singh
