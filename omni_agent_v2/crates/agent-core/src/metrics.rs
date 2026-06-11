// Created and developed by Jai Singh
//! Prometheus-style text exposition for the agent. Tiny — we only need
//! a handful of counters to surface helper / WS health.

use std::sync::Arc;

use crate::state::AgentState;
use agent_rpc::PythonHelper;
use agent_ws::WorkServiceWs;

/// Render the `/metrics` body.
pub fn render(state: &Arc<AgentState>, helper: &PythonHelper, ws: &WorkServiceWs) -> String {
    use std::fmt::Write;

    let mut out = String::new();
    let helper_st = helper.status();
    let ws_metrics = ws.metrics();
    let jobs_processed = state
        .jobs_processed
        .load(std::sync::atomic::Ordering::Relaxed);
    let helper_restarts = state
        .helper_restart_count
        .load(std::sync::atomic::Ordering::Relaxed)
        .max(helper_st.restart_count);

    let _ = writeln!(
        out,
        "# HELP agent_jobs_processed_total Jobs that the agent has fully processed since boot."
    );
    let _ = writeln!(out, "# TYPE agent_jobs_processed_total counter");
    let _ = writeln!(out, "agent_jobs_processed_total {jobs_processed}");

    let _ = writeln!(
        out,
        "# HELP agent_helper_restart_total Times the Python helper has had to be respawned."
    );
    let _ = writeln!(out, "# TYPE agent_helper_restart_total counter");
    let _ = writeln!(out, "agent_helper_restart_total {helper_restarts}");

    let _ = writeln!(
        out,
        "# HELP agent_helper_alive 1 if the Python helper is currently alive."
    );
    let _ = writeln!(out, "# TYPE agent_helper_alive gauge");
    let _ = writeln!(
        out,
        "agent_helper_alive {}",
        if helper.is_alive() { 1 } else { 0 }
    );

    let _ = writeln!(
        out,
        "# HELP agent_ws_reconnect_total WS reconnects since boot."
    );
    let _ = writeln!(out, "# TYPE agent_ws_reconnect_total counter");
    let _ = writeln!(
        out,
        "agent_ws_reconnect_total {}",
        ws_metrics.reconnect_count
    );

    let _ = writeln!(out, "# HELP agent_ws_watchdog_trips_total Subset of reconnects driven by the application watchdog.");
    let _ = writeln!(out, "# TYPE agent_ws_watchdog_trips_total counter");
    let _ = writeln!(
        out,
        "agent_ws_watchdog_trips_total {}",
        ws_metrics.watchdog_trips
    );

    let _ = writeln!(
        out,
        "# HELP agent_ws_connected 1 if the WS is currently connected."
    );
    let _ = writeln!(out, "# TYPE agent_ws_connected gauge");
    let _ = writeln!(
        out,
        "agent_ws_connected {}",
        if ws_metrics.connected { 1 } else { 0 }
    );

    out
}

// Created and developed by Jai Singh
