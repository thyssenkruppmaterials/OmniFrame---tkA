// Created and developed by Jai Singh
//! [`WorkServiceWs`] — long-lived WS client with two-layer keepalive.

use std::sync::Arc;
use std::time::{Duration, Instant};

use agent_types::{
    SubscribeMessage, WsEvent, WS_PING_INTERVAL_SEC, WS_WATCHDOG_INTERVAL_SEC,
    WS_WATCHDOG_TIMEOUT_SEC,
};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::protocol::Message as WsMessage;
use tracing::{debug, info, warn};
use url::Url;

use crate::metrics::{MetricsInner, SharedMetrics, WsMetrics};
use crate::token::TokenProvider;

/// Reconnect ladder bounds. Match `omni_agent/work_service_ws.py`
/// constants so the operator's mental model carries over.
const INITIAL_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
/// A connection that survives this long resets the backoff to its
/// initial value — single corp-proxy blip shouldn't slow recovery.
const STABLE_CONNECTION: Duration = Duration::from_secs(60);

/// Broadcast capacity for [`WorkServiceWs::subscribe_events`]. Matches
/// what `agent-rpc` uses for its notification fan-out so a single
/// slow consumer can lag by 1000 events before drops.
const EVENT_CHANNEL_CAPACITY: usize = 1000;

/// Public client. Cheap to clone — internal state is `Arc`-shared.
#[derive(Clone)]
pub struct WorkServiceWs {
    base_url: Url,
    token_provider: Arc<dyn TokenProvider>,
    events_tx: broadcast::Sender<WsEvent>,
    metrics: SharedMetrics,
}

impl WorkServiceWs {
    /// Construct a new client. Doesn't connect — call [`Self::run`] to
    /// drive the connect loop.
    pub async fn new(
        base_url: Url,
        token_provider: Arc<dyn TokenProvider>,
    ) -> anyhow::Result<Self> {
        let (events_tx, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        Ok(Self {
            base_url,
            token_provider,
            events_tx,
            metrics: Arc::new(MetricsInner::default()),
        })
    }

    /// Subscribe to incoming events.
    pub fn subscribe_events(&self) -> broadcast::Receiver<WsEvent> {
        self.events_tx.subscribe()
    }

    pub fn metrics(&self) -> WsMetrics {
        self.metrics.snapshot()
    }

    /// Run the connect loop forever. Caller is responsible for spawning
    /// this on a tokio task.
    pub async fn run(self, agent_id: String, capabilities: Vec<String>, version: String) {
        let mut backoff = INITIAL_BACKOFF;
        loop {
            let started = Instant::now();
            let outcome = self
                .one_connection(&agent_id, &capabilities, &version)
                .await;
            let alive_for = started.elapsed();
            match outcome {
                ConnectionOutcome::CleanClose => {
                    self.metrics.mark_disconnect(format!(
                        "clean close after {:.1}s",
                        alive_for.as_secs_f32()
                    ));
                }
                ConnectionOutcome::WatchdogTrip { silent_for } => {
                    self.metrics
                        .watchdog_trips
                        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    self.metrics.mark_disconnect(format!(
                        "watchdog timeout (no message for {:.0}s)",
                        silent_for.as_secs_f32()
                    ));
                }
                ConnectionOutcome::Error(reason) => {
                    self.metrics.mark_disconnect(reason);
                }
            }

            if alive_for >= STABLE_CONNECTION {
                backoff = INITIAL_BACKOFF;
            } else {
                self.metrics
                    .reconnect_count
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let snap = self.metrics.snapshot();
                warn!(
                    backoff = ?backoff,
                    reconnect_count = snap.reconnect_count,
                    watchdog_trips = snap.watchdog_trips,
                    "ws disconnected; backing off"
                );
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(MAX_BACKOFF);
            }
        }
    }

    /// One connection lifecycle: mint token → connect → Subscribe →
    /// drain events with watchdog → return outcome.
    async fn one_connection(
        &self,
        agent_id: &str,
        capabilities: &[String],
        version: &str,
    ) -> ConnectionOutcome {
        let token = match self.token_provider.get_token().await {
            Ok(t) if !t.is_empty() => t,
            Ok(_) => return ConnectionOutcome::Error("empty token from provider".into()),
            Err(e) => return ConnectionOutcome::Error(format!("token provider error: {e}")),
        };

        let org = match self.token_provider.organization_id().await {
            Ok(o) => o,
            Err(e) => return ConnectionOutcome::Error(format!("org provider error: {e}")),
        };

        let url = match build_ws_url(&self.base_url, &token) {
            Ok(u) => u,
            Err(e) => return ConnectionOutcome::Error(format!("bad ws url: {e}")),
        };

        let (mut ws_stream, _resp) = match tokio_tungstenite::connect_async(url.as_str()).await {
            Ok(c) => c,
            Err(e) => return ConnectionOutcome::Error(format!("connect: {e}")),
        };

        let sub = SubscribeMessage {
            agent_id: agent_id.to_string(),
            capabilities: capabilities.to_vec(),
            version: version.to_string(),
            organization_id: org,
        };
        let sub_json = match serde_json::to_string(&sub) {
            Ok(s) => s,
            Err(e) => return ConnectionOutcome::Error(format!("subscribe encode: {e}")),
        };
        if let Err(e) = ws_stream.send(WsMessage::Text(sub_json)).await {
            return ConnectionOutcome::Error(format!("subscribe send: {e}"));
        }

        self.metrics.mark_message();
        self.metrics
            .connected
            .store(true, std::sync::atomic::Ordering::Relaxed);
        info!(base = %self.base_url, "ws connected");

        // ── Two timers: app-watchdog + library-style ping ───────
        let mut watchdog = tokio::time::interval(Duration::from_secs(WS_WATCHDOG_INTERVAL_SEC));
        watchdog.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        watchdog.tick().await; // burn the immediate tick

        let mut pinger = tokio::time::interval(Duration::from_secs(WS_PING_INTERVAL_SEC));
        pinger.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        pinger.tick().await;

        loop {
            tokio::select! {
                _ = watchdog.tick() => {
                    let last = *self.metrics.last_message_at.read();
                    if let Some(last) = last {
                        let age = last.elapsed();
                        if age > Duration::from_secs(WS_WATCHDOG_TIMEOUT_SEC) {
                            warn!(silent_for = ?age, "ws watchdog tripped — closing");
                            let _ = ws_stream.close(Some(tokio_tungstenite::tungstenite::protocol::CloseFrame {
                                code: tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Iana(1011),
                                reason: "agent watchdog timeout".into(),
                            })).await;
                            return ConnectionOutcome::WatchdogTrip { silent_for: age };
                        }
                    }
                }
                _ = pinger.tick() => {
                    if let Err(e) = ws_stream.send(WsMessage::Ping(Vec::new())).await {
                        return ConnectionOutcome::Error(format!("ping send: {e}"));
                    }
                }
                msg = ws_stream.next() => {
                    let Some(msg) = msg else {
                        return ConnectionOutcome::CleanClose;
                    };
                    self.metrics.mark_message();
                    match msg {
                        Ok(WsMessage::Text(text)) => {
                            self.dispatch_text(&text);
                        }
                        Ok(WsMessage::Binary(bytes)) => {
                            // The work-service sends JSON as Text; a
                            // Binary frame is unusual but parse it
                            // anyway since some WS proxies repackage.
                            if let Ok(text) = std::str::from_utf8(&bytes) {
                                self.dispatch_text(text);
                            } else {
                                warn!("ws binary frame not utf-8");
                            }
                        }
                        Ok(WsMessage::Ping(payload)) => {
                            // tungstenite handles pong responses
                            // automatically when configured; we still
                            // surface a debug for diagnostics.
                            debug!(payload_len = payload.len(), "ws ping rx");
                        }
                        Ok(WsMessage::Pong(_)) => {
                            debug!("ws pong rx");
                        }
                        Ok(WsMessage::Close(frame)) => {
                            return ConnectionOutcome::Error(format!(
                                "server closed: {:?}", frame
                            ));
                        }
                        Ok(WsMessage::Frame(_)) => {
                            // Raw frame — only surfaced if the consumer
                            // opted into low-level mode. Ignore safely.
                        }
                        Err(e) => {
                            return ConnectionOutcome::Error(format!("recv: {e}"));
                        }
                    }
                }
            }
        }
    }

    fn dispatch_text(&self, raw: &str) {
        match serde_json::from_str::<WsEvent>(raw) {
            Ok(ev) => {
                let _ = self.events_tx.send(ev);
            }
            Err(e) => {
                warn!(error = %e, "ws event parse");
            }
        }
    }
}

enum ConnectionOutcome {
    CleanClose,
    WatchdogTrip { silent_for: Duration },
    Error(String),
}

/// Convert `https://host` → `wss://host/ws?token=...`. Preserves any
/// existing path so a future routing layer (e.g. `/realtime/ws`) keeps
/// working without a Rust release.
fn build_ws_url(base: &Url, token: &str) -> anyhow::Result<Url> {
    let mut u = base.clone();
    // The borrow of `u.scheme()` must end before we call set_scheme,
    // so we collect the chosen scheme into an owned String first.
    let new_scheme: String = match u.scheme() {
        "http" => "ws".to_string(),
        "https" => "wss".to_string(),
        s => s.to_string(),
    };
    u.set_scheme(&new_scheme)
        .map_err(|()| anyhow::anyhow!("could not set ws scheme"))?;

    // Append `/ws` only if the base doesn't already point at one.
    if !u.path().ends_with("/ws") {
        let new_path = if u.path().ends_with('/') {
            format!("{}ws", u.path())
        } else {
            format!("{}/ws", u.path())
        };
        u.set_path(&new_path);
    }

    // Replace the query with `token=...`. The work service accepts
    // duplicate keys but we keep things simple.
    u.set_query(Some(&format!("token={token}")));
    Ok(u)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_to_ws_url() {
        let base = Url::parse("https://rust-work-service-production.up.railway.app").unwrap();
        let url = build_ws_url(&base, "abc123").unwrap();
        assert_eq!(url.scheme(), "wss");
        assert_eq!(url.path(), "/ws");
        assert_eq!(url.query(), Some("token=abc123"));
    }

    #[test]
    fn http_dev_to_ws() {
        let base = Url::parse("http://localhost:8030").unwrap();
        let url = build_ws_url(&base, "tok").unwrap();
        assert_eq!(url.scheme(), "ws");
        assert_eq!(url.host_str(), Some("localhost"));
        assert_eq!(url.port(), Some(8030));
        assert_eq!(url.path(), "/ws");
    }

    #[test]
    fn preserves_existing_ws_path() {
        let base = Url::parse("https://example.com/ws").unwrap();
        let url = build_ws_url(&base, "t").unwrap();
        assert_eq!(url.path(), "/ws");
    }
}

// Created and developed by Jai Singh
