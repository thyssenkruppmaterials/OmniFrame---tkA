// Created and developed by Jai Singh
//! Per-org settings cache + LISTEN consumer (Phase 0a.3 + Phase 2.6).
//!
//! The cache is hot-path for every claim, push, and reassign. We refresh on:
//!   - cold start;
//!   - `LISTEN work_engine_settings_changed` notifications;
//!   - 60-second TTL fall-back if NOTIFY is silent.

pub mod cache;
pub mod listener;

// Created and developed by Jai Singh
