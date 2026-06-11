// Created and developed by Jai Singh
//! HTTP middleware: CORS, Private-Network-Access, X-Agent-Token gate.

use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, HeaderValue, Method, Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::state::AgentState;

/// Paths that bypass the X-Agent-Token check. Mirrors the v1.x
/// `_TOKEN_EXEMPT_PATHS` set.
pub const EXEMPT_PATHS: &[&str] = &[
    "/health",
    "/status",
    "/sap/sessions",
    "/sap/shipment-progress",
    "/supabase/login",
    "/supabase/session",
    "/supabase/logout",
    "/metrics",
    "/shutdown",
    "/sap/connect",
    "/agents",
    "/realtime/status",
    "/agent-token/check",
    "/agent-token/rotate",
];

fn is_exempt(path: &str) -> bool {
    if EXEMPT_PATHS.contains(&path) {
        return true;
    }
    path.starts_with("/jobs/") || path.starts_with("/agents/") || path.starts_with("/sap/v2/")
}

/// `X-Agent-Token` gate. Same semantics as the v1.x Python version:
///
///   * Exempt path → pass.
///   * No token minted yet → pass (legacy clients).
///   * Header missing → pass + WARN log (back-compat).
///   * Header mismatch → 401.
pub async fn token_guard(
    state: axum::extract::State<Arc<AgentState>>,
    request: Request<Body>,
    next: Next,
) -> Response {
    if request.method() == Method::OPTIONS {
        return next.run(request).await;
    }
    let path = request.uri().path().to_string();
    if is_exempt(&path) {
        return next.run(request).await;
    }
    let expected = state.agent_token.read().token.clone();
    if expected.is_empty() {
        return next.run(request).await;
    }
    let supplied = request
        .headers()
        .get("X-Agent-Token")
        .or_else(|| request.headers().get("x-agent-token"))
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());
    match supplied {
        Some(s) if s == expected => next.run(request).await,
        Some(_) => (
            StatusCode::UNAUTHORIZED,
            r#"{"ok":false,"error":"Invalid or stale X-Agent-Token. Re-login from the web app."}"#,
        )
            .into_response(),
        None => {
            tracing::warn!(method = %request.method(), %path, "no X-Agent-Token — allowing for back-compat");
            next.run(request).await
        }
    }
}

/// Adds the Chrome 108+ Private-Network-Access response header to
/// every response — required for `https://app.example.com` to fetch
/// our `http://127.0.0.1:8765` endpoints without a silent-block.
pub async fn private_network_access(request: Request<Body>, next: Next) -> Response {
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());

    let mut response = next.run(request).await;

    let headers = response.headers_mut();
    headers.insert(
        header::HeaderName::from_static("access-control-allow-private-network"),
        HeaderValue::from_static("true"),
    );
    if let Some(o) = origin {
        if let Ok(val) = HeaderValue::from_str(&o) {
            headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, val);
        }
    } else {
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            HeaderValue::from_static("*"),
        );
    }
    response
}

// Created and developed by Jai Singh
