// Created and developed by Jai Singh
//! Phase 2 telemetry foundation (2026-05-06) — HTTP request metrics
//! middleware.
//!
//! Layered at the top of the merged Router so it sees every request
//! (public + protected, including `/health`, `/metrics`, and `/ws`
//! upgrade attempts). Increments
//! `work_http_requests_total{route, method, status}` after the inner
//! handler returns.
//!
//! Cardinality is bounded by `axum::extract::MatchedPath` — the route
//! template (e.g. `/api/v1/work/tasks/:id/complete`) is used as the
//! `route` label rather than the raw URL. Requests that don't match a
//! route (404 on a path the router doesn't recognise) carry the literal
//! `unmatched` label so dashboards can spot scanning / misrouted
//! traffic without opening up unbounded label growth.
//!
//! RUNBOOK: docs/runbooks/work-engine/service-health-failing.md

use axum::{
    extract::{MatchedPath, Request},
    middleware::Next,
    response::Response,
};

use super::metrics;

/// Axum middleware that increments `work_http_requests_total` once per
/// served request. Apply via
/// `axum::middleware::from_fn(track_http_metrics)` on the merged router
/// so it runs for every endpoint.
pub async fn track_http_metrics(req: Request, next: Next) -> Response {
    // Capture the labels BEFORE consuming the request — `next.run`
    // takes ownership of `req`, so we extract the matched path and
    // method up front.
    let route = req
        .extensions()
        .get::<MatchedPath>()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| "unmatched".to_string());
    let method = req.method().as_str().to_string();

    let response = next.run(req).await;

    let status = response.status().as_u16().to_string();
    metrics::WORK_HTTP_REQUESTS_TOTAL
        .with_label_values(&[&route, &method, &status])
        .inc();

    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counter_registered_and_renders() {
        // We can't easily wire a router through `oneshot` without
        // pulling in the `tower::util::ServiceExt` import path that
        // isn't currently a dependency. Smoke-test the metric handle
        // instead — incrementing it must show up in the Prometheus
        // exposition output, which is what the middleware does
        // post-`next.run`.
        metrics::WORK_HTTP_REQUESTS_TOTAL
            .with_label_values(&["/test", "GET", "200"])
            .inc();
        let body = metrics::render_text().expect("encode");
        assert!(body.contains("work_http_requests_total"));
        assert!(body.contains("route=\"/test\""));
        assert!(body.contains("status=\"200\""));
    }

    #[test]
    fn middleware_function_has_expected_signature() {
        // Compile-time check: track_http_metrics must satisfy the
        // axum middleware function signature so
        // `axum::middleware::from_fn(track_http_metrics)` typechecks.
        // Capturing it as a function pointer here is the cheapest
        // way to make the compiler validate the shape without
        // standing up a Router.
        let _f: fn(axum::extract::Request, axum::middleware::Next) -> _ = track_http_metrics;
    }
}

// Created and developed by Jai Singh
