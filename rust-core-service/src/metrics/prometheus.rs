//! Prometheus metrics exporter

use metrics_exporter_prometheus::{Matcher, PrometheusBuilder, PrometheusHandle};
use std::time::Duration;

/// Histogram buckets for latency metrics (in seconds)
const LATENCY_BUCKETS: &[f64] = &[
    0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
];

/// Setup Prometheus metrics recorder
pub fn setup_metrics() -> PrometheusHandle {
    PrometheusBuilder::new()
        // HTTP request duration buckets
        .set_buckets_for_metric(
            Matcher::Full("http.request.duration_ms".to_string()),
            LATENCY_BUCKETS,
        )
        .unwrap()
        // Database query duration buckets
        .set_buckets_for_metric(
            Matcher::Full("db.query.duration_ms".to_string()),
            LATENCY_BUCKETS,
        )
        .unwrap()
        // Cache operation duration buckets
        .set_buckets_for_metric(
            Matcher::Full("cache.operation.duration_ms".to_string()),
            LATENCY_BUCKETS,
        )
        .unwrap()
        // JWT validation duration buckets
        .set_buckets_for_metric(
            Matcher::Full("auth.jwt.validation_time_ms".to_string()),
            LATENCY_BUCKETS,
        )
        .unwrap()
        .install_recorder()
        .expect("Failed to install Prometheus recorder")
}

/// Record database query duration
pub fn record_query_duration(query_name: &str, duration: Duration) {
    metrics::histogram!(
        "db.query.duration_ms",
        "query" => query_name.to_string()
    ).record(duration.as_millis() as f64);
}

/// Record cache operation
pub fn record_cache_operation(operation: &str, hit: bool) {
    let result = if hit { "hit" } else { "miss" };
    metrics::counter!(
        "cache.operations",
        "operation" => operation.to_string(),
        "result" => result.to_string()
    ).increment(1);
}

/// Record API request
pub fn record_api_request(method: &str, path: &str, status: u16, duration: Duration) {
    metrics::histogram!(
        "http.request.duration_ms",
        "method" => method.to_string(),
        "path" => path.to_string(),
        "status" => status.to_string()
    ).record(duration.as_millis() as f64);

    metrics::counter!(
        "http.requests.total",
        "method" => method.to_string(),
        "status" => status.to_string()
    ).increment(1);
}

/// Record authentication event
pub fn record_auth_event(event_type: &str, success: bool) {
    let result = if success { "success" } else { "failure" };
    metrics::counter!(
        "auth.events",
        "type" => event_type.to_string(),
        "result" => result.to_string()
    ).increment(1);
}

/// Record database pool metrics
pub fn record_pool_metrics(total: u32, idle: u32, active: u32) {
    metrics::gauge!("db.pool.connections.total").set(total as f64);
    metrics::gauge!("db.pool.connections.idle").set(idle as f64);
    metrics::gauge!("db.pool.connections.active").set(active as f64);
}
