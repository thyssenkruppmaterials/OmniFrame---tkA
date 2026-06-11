// Created and developed by Jai Singh
use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::Response,
    Extension,
};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tracing::{debug, error, info};

use crate::auth::AuthenticatedUser;
use crate::state::AppState;

pub async fn device_stream_handler(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    ws: WebSocketUpgrade,
) -> Response {
    let org_id = user.organization_id.clone();

    info!(org_id = ?org_id, "Device stream WebSocket connection request");
    ws.on_upgrade(move |socket| handle_device_stream(socket, state, org_id))
}

async fn handle_device_stream(socket: WebSocket, state: Arc<AppState>, org_id: Option<String>) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.ws_broadcast.subscribe();

    info!("Device stream WebSocket client connected");

    let send_task = tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            if let Some(ref filter_org) = org_id {
                if let Some(ref event_org) = event.organization_id {
                    if event_org != filter_org {
                        continue;
                    }
                }
            }

            let json = match serde_json::to_string(&event) {
                Ok(j) => j,
                Err(e) => {
                    error!(error = %e, "Failed to serialize device event");
                    continue;
                }
            };
            if sender.send(Message::Text(json)).await.is_err() {
                break;
            }
        }
    });

    let recv_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            match msg {
                Ok(Message::Ping(_)) => debug!("Received ping"),
                Ok(Message::Close(_)) => {
                    info!("Client closed WebSocket");
                    break;
                }
                Err(e) => {
                    error!(error = %e, "WebSocket receive error");
                    break;
                }
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = send_task => debug!("Send task completed"),
        _ = recv_task => debug!("Receive task completed"),
    }

    info!("Device stream WebSocket client disconnected");
}

pub async fn location_stream_handler(
    State(state): State<Arc<AppState>>,
    Extension(user): Extension<AuthenticatedUser>,
    ws: WebSocketUpgrade,
) -> Response {
    let org_id = user.organization_id.clone();

    info!(org_id = ?org_id, "Location stream WebSocket connection request");
    ws.on_upgrade(move |socket| handle_location_stream(socket, state, org_id))
}

async fn handle_location_stream(socket: WebSocket, state: Arc<AppState>, org_id: Option<String>) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.ws_broadcast.subscribe();

    info!("Location stream WebSocket client connected");

    let send_task = tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            if event.event_type != "location" && event.event_type != "geofence" {
                continue;
            }

            if let Some(ref filter_org) = org_id {
                if let Some(ref event_org) = event.organization_id {
                    if event_org != filter_org {
                        continue;
                    }
                }
            }

            let json = match serde_json::to_string(&event) {
                Ok(j) => j,
                Err(e) => {
                    error!(error = %e, "Failed to serialize location event");
                    continue;
                }
            };
            if sender.send(Message::Text(json)).await.is_err() {
                break;
            }
        }
    });

    let recv_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            match msg {
                Ok(Message::Close(_)) => break,
                Err(_) => break,
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    info!("Location stream WebSocket client disconnected");
}

// Created and developed by Jai Singh
