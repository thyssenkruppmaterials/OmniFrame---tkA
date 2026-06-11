// Created and developed by Jai Singh
//! Multi-session pool — owns the 6 [`SessionSlot`] state machines.
//!
//! All mutation goes through here so the [`SessionPoolSnapshot`] the
//! GUI tile grid renders is always internally consistent.

use agent_types::{SessionPoolSnapshot, SessionSlot, SessionState, SlotId, SESSION_POOL_SIZE};
use chrono::Utc;
use parking_lot::RwLock;

pub struct SessionPool {
    inner: RwLock<[SessionSlot; SESSION_POOL_SIZE]>,
}

impl SessionPool {
    pub fn new() -> Self {
        let inner = [
            SessionSlot::empty(0),
            SessionSlot::empty(1),
            SessionSlot::empty(2),
            SessionSlot::empty(3),
            SessionSlot::empty(4),
            SessionSlot::empty(5),
        ];
        Self {
            inner: RwLock::new(inner),
        }
    }

    pub fn snapshot(&self) -> SessionPoolSnapshot {
        SessionPoolSnapshot {
            sessions: self.inner.read().clone(),
        }
    }

    pub fn get(&self, slot: SlotId) -> Option<SessionSlot> {
        let s = self.inner.read();
        s.get(slot as usize).cloned()
    }

    pub fn with_slot_mut<R>(
        &self,
        slot: SlotId,
        f: impl FnOnce(&mut SessionSlot) -> R,
    ) -> Option<R> {
        let mut s = self.inner.write();
        s.get_mut(slot as usize).map(f)
    }

    pub fn set_state(&self, slot: SlotId, new_state: SessionState) {
        self.with_slot_mut(slot, |sl| {
            sl.state = new_state;
            if new_state == SessionState::Busy {
                sl.busy_since = Some(Utc::now());
            } else {
                sl.busy_since = None;
            }
        });
    }

    pub fn pin(&self, slot: SlotId, conn_idx: i32, sess_idx: i32, label: Option<String>) {
        self.with_slot_mut(slot, |sl| {
            sl.state = SessionState::Idle;
            sl.conn_idx = Some(conn_idx);
            sl.sess_idx = Some(sess_idx);
            if label.is_some() {
                sl.label = label;
            }
            sl.last_error = None;
        });
    }

    pub fn release(&self, slot: SlotId) {
        self.with_slot_mut(slot, |sl| {
            *sl = SessionSlot::empty(slot);
        });
    }

    pub fn record_op(&self, slot: SlotId, label: impl Into<String>) {
        self.with_slot_mut(slot, |sl| {
            sl.last_op = Some(label.into());
            sl.last_op_at = Some(Utc::now());
        });
    }

    pub fn record_error(&self, slot: SlotId, msg: impl Into<String>) {
        self.with_slot_mut(slot, |sl| {
            sl.state = SessionState::Error;
            let mut s = msg.into();
            if s.len() > 200 {
                s.truncate(200);
            }
            sl.last_error = Some(s);
            sl.busy_since = None;
        });
    }
}

impl Default for SessionPool {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pool_snapshot_is_six_slots() {
        let p = SessionPool::new();
        let snap = p.snapshot();
        assert_eq!(snap.sessions.len(), 6);
        for (i, slot) in snap.sessions.iter().enumerate() {
            assert_eq!(slot.slot_id, i as u8);
            assert_eq!(slot.state, SessionState::Empty);
        }
    }

    #[test]
    fn pin_then_release() {
        let p = SessionPool::new();
        p.pin(2, 0, 5, Some("Bay 3".into()));
        let slot = p.get(2).unwrap();
        assert_eq!(slot.state, SessionState::Idle);
        assert_eq!(slot.conn_idx, Some(0));
        assert_eq!(slot.sess_idx, Some(5));
        assert_eq!(slot.label.as_deref(), Some("Bay 3"));

        p.release(2);
        let slot = p.get(2).unwrap();
        assert_eq!(slot.state, SessionState::Empty);
        assert!(slot.conn_idx.is_none());
    }

    #[test]
    fn busy_then_idle_clears_busy_since() {
        let p = SessionPool::new();
        p.pin(0, 0, 0, None);
        p.set_state(0, SessionState::Busy);
        assert!(p.get(0).unwrap().busy_since.is_some());
        p.set_state(0, SessionState::Idle);
        assert!(p.get(0).unwrap().busy_since.is_none());
    }

    #[test]
    fn record_error_truncates() {
        let p = SessionPool::new();
        p.pin(0, 0, 0, None);
        let long = "x".repeat(500);
        p.record_error(0, long);
        let slot = p.get(0).unwrap();
        assert_eq!(slot.state, SessionState::Error);
        assert_eq!(slot.last_error.as_ref().unwrap().len(), 200);
    }
}

// Created and developed by Jai Singh
