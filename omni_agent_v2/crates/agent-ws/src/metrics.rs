// Created and developed by Jai Singh
//! Atomic-counter snapshot exposed via [`super::WorkServiceWs::metrics`].

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use parking_lot::RwLock;

/// Snapshot returned by [`super::WorkServiceWs::metrics`]. All fields
/// are point-in-time copies — we don't hand out the live counters so
/// callers can't accidentally mutate them.
#[derive(Debug, Clone)]
pub struct WsMetrics {
    pub reconnect_count: u64,
    pub watchdog_trips: u64,
    pub last_message_at: Option<Instant>,
    pub last_reason: Option<String>,
    pub connected: bool,
}

#[derive(Debug, Default)]
pub(crate) struct MetricsInner {
    pub(crate) reconnect_count: AtomicU64,
    pub(crate) watchdog_trips: AtomicU64,
    pub(crate) last_message_at: RwLock<Option<Instant>>,
    pub(crate) last_reason: RwLock<Option<String>>,
    pub(crate) connected: AtomicBool,
}

impl MetricsInner {
    pub(crate) fn snapshot(&self) -> WsMetrics {
        WsMetrics {
            reconnect_count: self.reconnect_count.load(Ordering::Relaxed),
            watchdog_trips: self.watchdog_trips.load(Ordering::Relaxed),
            last_message_at: *self.last_message_at.read(),
            last_reason: self.last_reason.read().clone(),
            connected: self.connected.load(Ordering::Relaxed),
        }
    }

    pub(crate) fn mark_message(&self) {
        *self.last_message_at.write() = Some(Instant::now());
    }

    pub(crate) fn mark_disconnect(&self, reason: impl Into<String>) {
        self.connected.store(false, Ordering::Relaxed);
        *self.last_reason.write() = Some(reason.into());
    }
}

pub(crate) type SharedMetrics = Arc<MetricsInner>;

// Created and developed by Jai Singh
