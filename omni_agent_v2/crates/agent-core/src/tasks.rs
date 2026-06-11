// Created and developed by Jai Singh
//! Long-running background tasks that the AgentCore spawns at boot.

use std::sync::Arc;
use std::time::Duration;

use agent_rpc::PythonHelper;
use agent_types::{
    HEARTBEAT_ACTIVE_SEC, HEARTBEAT_IDLE_SEC, JWT_REFRESH_INTERVAL_SEC, WATCHDOG_TIMEOUT_SEC,
};
use agent_ws::{WorkServiceWs, WsEvent};
use chrono::Duration as ChronoDuration;
use tracing::{debug, info, warn};

use crate::config::AgentConfig;
use crate::jwt;
use crate::state::AgentState;

/// Spawn every long-running task. Caller drops nothing — the tasks
/// are kept alive by the tokio runtime.
pub fn spawn_all(
    state: Arc<AgentState>,
    helper: PythonHelper,
    ws: WorkServiceWs,
    config: AgentConfig,
) {
    tokio::spawn(jwt_refresher(state.clone(), config.clone()));
    tokio::spawn(heartbeat(state.clone(), config.clone()));
    tokio::spawn(helper_watchdog(state.clone(), helper.clone()));
    tokio::spawn(console_relay(state.clone(), helper.clone(), config.clone()));
    tokio::spawn(ws_runner(ws.clone(), state.clone()));
    tokio::spawn(ws_event_router(ws.clone(), state.clone()));
    tokio::spawn(job_poller(state.clone(), helper.clone(), config.clone()));
}

/// Refresh the identity-v2 JWT every 90% of its lifetime. Loads the
/// service key on the first run via the 3-tier loader.
async fn jwt_refresher(state: Arc<AgentState>, config: AgentConfig) {
    loop {
        let canonical = config
            .service_key_path
            .clone()
            .unwrap_or_else(jwt::default_canonical_path);
        let alongside = config.install_dir.join("agent_service_key.txt");

        match jwt::load_service_key(&canonical, &alongside) {
            Ok(key) => {
                let prefix = key.chars().take(12).collect::<String>();
                match jwt::exchange_service_key(&config.work_service_url, &key, &state.agent_id)
                    .await
                {
                    Ok(resp) => {
                        let mut cache = state.jwt.write();
                        cache.bearer = Some(resp.access_token);
                        cache.expires_at = Some(
                            chrono::Utc::now() + ChronoDuration::seconds(resp.expires_in as i64),
                        );
                        cache.service_key_prefix = Some(prefix);
                        info!("jwt refreshed (expires in {}s)", resp.expires_in);
                    }
                    Err(e) => {
                        warn!(error = %e, "jwt exchange failed; will retry in 60s");
                        tokio::time::sleep(Duration::from_secs(60)).await;
                        continue;
                    }
                }
            }
            Err(e) => {
                warn!(error = %e, "service key not found; agent will run without JWT");
            }
        }

        tokio::time::sleep(Duration::from_secs(JWT_REFRESH_INTERVAL_SEC)).await;
    }
}

/// Periodic heartbeat — adapts cadence based on whether any pool slot
/// is currently `Busy`.
async fn heartbeat(state: Arc<AgentState>, _config: AgentConfig) {
    loop {
        let any_busy = state
            .session_pool
            .snapshot()
            .sessions
            .iter()
            .any(|s| s.state == agent_types::SessionState::Busy);
        let cadence = if any_busy {
            Duration::from_secs(HEARTBEAT_ACTIVE_SEC)
        } else {
            Duration::from_secs(HEARTBEAT_IDLE_SEC)
        };
        // Stub — full heartbeat will POST to rust-work-service in v2.0.1.
        debug!(any_busy, "heartbeat tick");
        tokio::time::sleep(cadence).await;
    }
}

/// Counts helper restarts so `/metrics` + `/health` reflect them.
async fn helper_watchdog(state: Arc<AgentState>, helper: PythonHelper) {
    let mut last_seen = helper.status().restart_count;
    loop {
        tokio::time::sleep(Duration::from_secs(5)).await;
        let cur = helper.status().restart_count;
        if cur > last_seen {
            state
                .helper_restart_count
                .fetch_add(cur - last_seen, std::sync::atomic::Ordering::Relaxed);
            warn!(restart_count = cur, "helper restarted");
            last_seen = cur;
        }
        if !helper.is_alive() {
            // Hint: if helper has been dead for > WATCHDOG_TIMEOUT_SEC
            // we'd usually escalate to "kill+respawn", but the
            // supervisor handles that already. We just emit a debug.
            let _ = WATCHDOG_TIMEOUT_SEC;
            debug!("helper not alive (supervisor will respawn)");
        }
    }
}

/// Forward helper notifications (`log.line` / `log.batch`) onto the
/// work-service `/api/v1/sap-console/lines` route. Best-effort: drops
/// lines if the JWT isn't ready yet.
async fn console_relay(state: Arc<AgentState>, helper: PythonHelper, config: AgentConfig) {
    let mut rx = helper.subscribe_notifications();
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            warn!(error = %e, "console relay: could not build http client");
            return;
        }
    };
    let url = format!(
        "{}/api/v1/sap-console/lines",
        config.work_service_url.trim_end_matches('/')
    );
    while let Ok(notif) = rx.recv().await {
        if notif.method != "log.line" && notif.method != "log.batch" {
            continue;
        }
        let bearer = state.jwt.read().bearer.clone();
        let Some(bearer) = bearer else { continue };
        let agent_id = state.agent_id.clone();
        let body = serde_json::json!({
            "agent_id": agent_id,
            "lines": match notif.method.as_str() {
                "log.batch" => notif.params.clone(),
                _ => serde_json::json!([notif.params.clone()]),
            }
        });
        let _ = client
            .post(&url)
            .header("Authorization", format!("Bearer {bearer}"))
            .json(&body)
            .send()
            .await;
    }
}

async fn ws_runner(ws: WorkServiceWs, state: Arc<AgentState>) {
    let agent_id = state.agent_id.clone();
    let caps: Vec<String> = agent_types::CAPABILITIES
        .iter()
        .map(|s| s.to_string())
        .collect();
    ws.run(agent_id, caps, agent_types::AGENT_VERSION_STR.to_string())
        .await;
}

async fn ws_event_router(ws: WorkServiceWs, _state: Arc<AgentState>) {
    let mut rx = ws.subscribe_events();
    while let Ok(ev) = rx.recv().await {
        match ev {
            WsEvent::SapJobStatusChanged { status, job_id, .. } => {
                debug!(%status, %job_id, "ws: sap_job_status_changed");
                // The job poller wakes on its own cadence; we don't
                // need to push to any channel today (the poller backoff
                // is short anyway).
            }
            WsEvent::RfPutawayChanged { .. } => {
                debug!("ws: rf_putaway_changed (server-side trigger)");
            }
            WsEvent::TriggerFired {
                trigger_id, job_id, ..
            } => {
                info!(%trigger_id, %job_id, "ws: trigger_fired");
            }
            WsEvent::SapAgentConsoleLine {
                agent_id, message, ..
            } => {
                debug!(%agent_id, "ws: sap_agent_console_line: {message}");
            }
            WsEvent::Unknown => {
                debug!("ws: unknown event variant");
            }
        }
    }
}

/// Background poller: every 5s try to claim a job. The WS event router
/// could short-circuit this with a wake-up channel; for v2.0.0-alpha
/// we keep it simple and rely on the bounded poll cadence.
async fn job_poller(state: Arc<AgentState>, _helper: PythonHelper, config: AgentConfig) {
    let client = match crate::work_service::WorkServiceClient::new(config.work_service_url.clone())
    {
        Ok(c) => c,
        Err(e) => {
            warn!(error = %e, "job poller: could not build client");
            return;
        }
    };
    let caps: Vec<String> = agent_types::CAPABILITIES
        .iter()
        .map(|s| s.to_string())
        .collect();
    loop {
        tokio::time::sleep(Duration::from_secs(5)).await;
        let bearer = state.jwt.read().bearer.clone();
        let Some(bearer) = bearer else { continue };
        match client.try_claim_next(&bearer, &state.agent_id, &caps).await {
            Ok(Some(job)) => {
                info!(job_id = %job.id, endpoint = %job.endpoint, "claimed job");
                // The dispatch path that invokes the right handler
                // lives in `agent-core/src/job_dispatch.rs` (TBD —
                // Worker A will land it in v2.0.1). For now we just
                // log + heartbeat to keep the lease healthy.
            }
            Ok(None) => {}
            Err(e) => {
                debug!(error = %e, "job poll error");
            }
        }
    }
}

// Created and developed by Jai Singh
