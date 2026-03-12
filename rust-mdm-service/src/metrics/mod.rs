use metrics_exporter_prometheus::{Matcher, PrometheusBuilder, PrometheusHandle};
use std::time::Duration;

const LATENCY_BUCKETS: &[f64] = &[
    0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
];

pub fn setup_metrics() -> PrometheusHandle {
    PrometheusBuilder::new()
        .set_buckets_for_metric(
            Matcher::Full("http.request.duration_ms".to_string()),
            LATENCY_BUCKETS,
        )
        .unwrap()
        .set_buckets_for_metric(
            Matcher::Full("mdm.command.duration_ms".to_string()),
            LATENCY_BUCKETS,
        )
        .unwrap()
        .set_buckets_for_metric(
            Matcher::Full("mdm.checkin.duration_ms".to_string()),
            LATENCY_BUCKETS,
        )
        .unwrap()
        .set_buckets_for_metric(
            Matcher::Full("telemetry.ingest.duration_ms".to_string()),
            LATENCY_BUCKETS,
        )
        .unwrap()
        .install_recorder()
        .expect("Failed to install Prometheus recorder")
}

pub fn record_api_request(method: &str, path: &str, status: u16, duration: Duration) {
    metrics::histogram!(
        "http.request.duration_ms",
        "method" => method.to_string(),
        "path" => path.to_string(),
        "status" => status.to_string()
    )
    .record(duration.as_millis() as f64);

    metrics::counter!(
        "http.requests.total",
        "method" => method.to_string(),
        "status" => status.to_string()
    )
    .increment(1);
}

pub fn record_apns_push(success: bool) {
    let result = if success { "success" } else { "failure" };
    metrics::counter!("mdm.apns.pushes", "result" => result.to_string()).increment(1);
}

pub fn record_command_queued(command_type: &str) {
    metrics::counter!("mdm.commands.queued", "type" => command_type.to_string()).increment(1);
}

pub fn record_checkin(message_type: &str) {
    metrics::counter!("mdm.checkins", "type" => message_type.to_string()).increment(1);
}

pub fn record_telemetry_ingest(source: &str) {
    metrics::counter!("telemetry.ingests", "source" => source.to_string()).increment(1);
}

pub fn set_command_queue_depth(depth: f64) {
    metrics::gauge!("mdm.commands.queue_depth").set(depth);
}

pub fn set_connected_devices(count: f64) {
    metrics::gauge!("mdm.devices.connected").set(count);
}
