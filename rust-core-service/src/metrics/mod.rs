//! Metrics and observability module

pub mod prometheus;

pub use prometheus::{setup_metrics, record_query_duration, record_cache_operation};
