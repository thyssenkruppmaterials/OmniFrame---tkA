// Created and developed by Jai Singh
//! OmniAgent v2 — Tauri shell.
//!
//! The Tauri GUI is a thin operator console that supervises the local agent
//! (the headless v2 binary, eventually shipped alongside this app). All
//! business logic — SAP COM bridge, job claim/lease, work-service WS,
//! console capture — lives in the agent process. The GUI calls into it via
//! HTTP on the local control plane (`127.0.0.1:8765` by default) and emits
//! Tauri events for live updates so the React frontend can subscribe with
//! `event.listen()` instead of polling every command.
//!
//! Architectural notes:
//!
//! * The shared state ([`AppState`]) holds a [`reqwest::Client`] tuned for
//!   loopback (short timeouts, no proxy, HTTP/1.1) plus a tokio mutex that
//!   serialises console-tail cursors per slot.
//! * Background tasks run on the Tauri-managed tokio runtime — Tauri 2 spins
//!   one up automatically. We spawn three tasks at app boot:
//!     1. **session-poller** — calls [`agent-core /session-pool`] every 1s
//!        and emits `session-state-changed` on changes (or every 5s
//!        regardless, so the UI heals after a missed event).
//!     2. **console-stream** — opens an SSE/websocket-shaped HTTP poll of
//!        `/console/tail?slot=N&since_seq=X` per slot and emits
//!        `console-line:{slot}` for each line. The poll is cheap because the
//!        endpoint blocks until new data is ready (long-poll up to 5s).
//!     3. **metrics-poller** — calls [`agent-core /metrics`] every 5s and
//!        emits `ws-event` whenever WS connection state or the job counters
//!        change.
//! * When the agent endpoint is unreachable we emit a synthetic
//!   `SessionPoolSnapshot` in `Empty` state so the GUI renders without a
//!   reload. The frontend status pills tell the operator the WS is down.

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod commands;

use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex as PlMutex;
use tauri::{Emitter, Manager};
use tokio::sync::Mutex as TokioMutex;
use tracing::{info, warn};

pub(crate) const DEFAULT_AGENT_BASE_URL: &str = "http://127.0.0.1:8765";
pub(crate) const SESSION_POLL_INTERVAL_MS: u64 = 1_000;
pub(crate) const METRICS_POLL_INTERVAL_MS: u64 = 5_000;
pub(crate) const CONSOLE_LONG_POLL_TIMEOUT_MS: u64 = 5_000;
pub(crate) const SLOT_COUNT: u8 = 6;

/// Shared Tauri state. Held as `Arc<AppState>` so command handlers and
/// background pollers see the same client + the same console cursors.
pub(crate) struct AppState {
    pub(crate) http: reqwest::Client,
    pub(crate) base_url: PlMutex<String>,
    /// `last_seq` per slot for the console tail long-poll cursor.
    pub(crate) console_cursors: TokioMutex<[u64; SLOT_COUNT as usize]>,
    /// Cached snapshot of the last successful `/session-pool` response so
    /// commands can answer cheaply between polls.
    pub(crate) last_snapshot: PlMutex<Option<commands::SessionPoolSnapshot>>,
}

impl AppState {
    fn new() -> Arc<Self> {
        let base_url = std::env::var("OMNIFRAME_AGENT_BASE_URL")
            .unwrap_or_else(|_| DEFAULT_AGENT_BASE_URL.to_string());

        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .connect_timeout(Duration::from_secs(2))
            .no_proxy()
            .pool_max_idle_per_host(8)
            .tcp_nodelay(true)
            .build()
            .expect("reqwest client must build");

        Arc::new(Self {
            http,
            base_url: PlMutex::new(base_url),
            console_cursors: TokioMutex::new([0_u64; SLOT_COUNT as usize]),
            last_snapshot: PlMutex::new(None),
        })
    }

    pub(crate) fn base_url(&self) -> String {
        self.base_url.lock().clone()
    }
}

fn init_tracing() {
    use tracing_subscriber::{fmt, prelude::*, EnvFilter};

    let filter = EnvFilter::try_from_env("OMNIFRAME_GUI_LOG")
        .unwrap_or_else(|_| EnvFilter::new("agent_gui=info,tauri=warn,reqwest=warn"));

    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_target(false).with_level(true))
        .try_init();
}

fn spawn_background_pollers(handle: tauri::AppHandle, state: Arc<AppState>) {
    // Session pool poller — emits a `session-state-changed` event whenever
    // the pool snapshot changes (any slot's `state` or `current_action`
    // diffs). Falls back to emitting an empty placeholder snapshot when the
    // agent is unreachable so the UI knows the agent is down.
    {
        let handle = handle.clone();
        let state = state.clone();
        tauri::async_runtime::spawn(async move {
            let mut interval =
                tokio::time::interval(Duration::from_millis(SESSION_POLL_INTERVAL_MS));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

            loop {
                interval.tick().await;
                let snapshot = commands::fetch_session_pool(&state)
                    .await
                    .unwrap_or_else(|err| {
                        warn!(error = %err, "session pool fetch failed; emitting offline snapshot");
                        commands::SessionPoolSnapshot::offline()
                    });

                let changed = {
                    let mut last = state.last_snapshot.lock();
                    let dirty = last.as_ref().map(|s| s != &snapshot).unwrap_or(true);
                    if dirty {
                        *last = Some(snapshot.clone());
                    }
                    dirty
                };

                if changed {
                    if let Err(err) = handle.emit("session-state-changed", &snapshot) {
                        warn!(error = %err, "failed to emit session-state-changed");
                    }
                }
            }
        });
    }

    // Metrics poller — fan-outs `ws-event` and `agent-metrics` so the
    // header bar can keep its pulse animation in sync. Cheap: one HTTP
    // round-trip every 5s plus a JSON diff.
    {
        let handle = handle.clone();
        let state = state.clone();
        tauri::async_runtime::spawn(async move {
            let mut interval =
                tokio::time::interval(Duration::from_millis(METRICS_POLL_INTERVAL_MS));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                interval.tick().await;
                match commands::fetch_agent_metrics(&state).await {
                    Ok(metrics) => {
                        let _ = handle.emit("agent-metrics", &metrics);
                        let _ = handle.emit("ws-event", &metrics.ws_status);
                    }
                    Err(err) => {
                        warn!(error = %err, "metrics fetch failed");
                    }
                }
            }
        });
    }

    // Per-slot console long-poll. Each task owns its own slot cursor and
    // emits one `console-line:N` event per line so the frontend can append
    // without a roundtrip back to Rust.
    for slot in 0..SLOT_COUNT {
        let handle = handle.clone();
        let state = state.clone();
        tauri::async_runtime::spawn(async move {
            let event_name = format!("console-line:{slot}");
            loop {
                match commands::long_poll_console_tail(&state, slot).await {
                    Ok(lines) => {
                        for line in lines {
                            let _ = handle.emit(&event_name, &line);
                        }
                    }
                    Err(err) => {
                        warn!(slot, error = %err, "console long-poll failed; backing off");
                        tokio::time::sleep(Duration::from_secs(2)).await;
                    }
                }
            }
        });
    }
}

fn main() {
    init_tracing();

    tauri::Builder::default()
        .setup(|app| {
            let state = AppState::new();
            app.manage(state.clone());
            info!(
                base_url = %state.base_url(),
                "OmniAgent GUI booted; spawning background pollers"
            );
            spawn_background_pollers(app.handle().clone(), state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_session_states,
            commands::connect_session,
            commands::disconnect_session,
            commands::list_sap_sessions,
            commands::pin_sap_session,
            commands::release_session,
            commands::run_quick_action,
            commands::get_console_tail,
            commands::get_agent_metrics,
            commands::get_ws_status,
            commands::get_settings,
            commands::update_settings,
            commands::get_build_info,
            commands::open_log_directory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OmniAgent Tauri application");
}

// Created and developed by Jai Singh
