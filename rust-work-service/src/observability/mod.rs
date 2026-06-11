// Created and developed by Jai Singh
//! Observability surface for the work-service.
//!
//! - `metrics` — Prometheus registry + claim/push/complete/release counters
//!   and histograms (Phase 12.1).
//! - `middleware` — Idempotency-Key middleware backed by
//!   `work_request_idempotency` (Phase 1.5).
//! - `http_metrics` — Phase 2 (2026-05-06) HTTP request counter
//!   middleware backing the `WorkServiceHealthFailing` alert.

pub mod http_metrics;
pub mod metrics;
pub mod middleware;

// Created and developed by Jai Singh
