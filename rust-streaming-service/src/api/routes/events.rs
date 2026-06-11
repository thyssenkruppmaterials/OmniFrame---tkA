// Created and developed by Jai Singh
//! WebSocket event streaming
//!
//! Provides real-time camera events (motion, triggers) via WebSocket.

use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::{debug, error, info, instrument, warn};

use crate::AppState;
use crate::exacq::models::CameraEvent;

/// WebSocket handler for camera events
#[instrument(skip(state, ws))]
pub async fn websocket_handler(
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> Response {
    info!("WebSocket connection request");
    ws.on_upgrade(|socket| handle_socket(socket, state))
}

/// Handle individual WebSocket connection
async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();

    info!("WebSocket client connected");

    // Get session for ExacqVision WebSocket
    let session_id = match state.session_manager.get_session().await {
        Ok(id) => id,
        Err(e) => {
            error!(error = %e, "Failed to get session for WebSocket");
            let error_msg = serde_json::json!({
                "type": "error",
                "message": "Failed to establish ExacqVision session"
            });
            let _ = sender.send(Message::Text(error_msg.to_string())).await;
            return;
        }
    };

    // Create broadcast channel for events
    let (tx, mut rx) = broadcast::channel::<CameraEvent>(100);
    let tx = Arc::new(tx);

    // Spawn task to connect to ExacqVision WebSocket and receive events
    let tx_clone = tx.clone();
    let client = state.exacq_client.clone();
    let session_manager = state.session_manager.clone();
    
    let exacq_task = tokio::spawn(async move {
        connect_to_exacq_websocket(client, session_manager, session_id, tx_clone).await
    });

    // Spawn task to send events to client
    let send_task = tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            let json = match serde_json::to_string(&event) {
                Ok(j) => j,
                Err(e) => {
                    error!(error = %e, "Failed to serialize event");
                    continue;
                }
            };

            if sender.send(Message::Text(json)).await.is_err() {
                break;
            }
        }
    });

    // Handle incoming messages from client (ping/pong, commands)
    let recv_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    debug!(message = %text, "Received text message from client");
                    // Could handle client commands here (subscribe to specific cameras, etc.)
                }
                Ok(Message::Ping(_)) => {
                    debug!("Received ping");
                    // Axum handles pong automatically
                }
                Ok(Message::Close(_)) => {
                    info!("Client closed WebSocket connection");
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

    // Wait for any task to complete
    tokio::select! {
        _ = send_task => {
            debug!("Send task completed");
        }
        _ = recv_task => {
            debug!("Receive task completed");
        }
    }

    // Cancel ExacqVision task
    exacq_task.abort();
    
    info!("WebSocket client disconnected");
}

/// Connect to ExacqVision WebSocket and broadcast events
async fn connect_to_exacq_websocket(
    client: Arc<crate::exacq::client::ExacqClient>,
    session_manager: Arc<crate::exacq::session::SessionManager>,
    session_id: String,
    tx: Arc<broadcast::Sender<CameraEvent>>,
) {
    let ws_url = client.get_websocket_url(&session_id);
    info!(url = %ws_url, "Connecting to ExacqVision WebSocket");

    loop {
        match connect_and_listen(&ws_url, &tx).await {
            Ok(()) => {
                info!("ExacqVision WebSocket connection closed normally");
            }
            Err(e) => {
                error!(error = %e, "ExacqVision WebSocket error");
            }
        }

        // Reconnect after delay
        warn!("Reconnecting to ExacqVision WebSocket in 5 seconds...");
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;

        // Refresh session before reconnecting
        match session_manager.refresh_session().await {
            Ok(new_session) => {
                info!(session_id = %new_session, "Session refreshed for reconnection");
            }
            Err(e) => {
                error!(error = %e, "Failed to refresh session");
                continue;
            }
        }
    }
}

/// Establish WebSocket connection and listen for events
async fn connect_and_listen(
    ws_url: &str,
    tx: &Arc<broadcast::Sender<CameraEvent>>,
) -> anyhow::Result<()> {
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message as TungsteniteMessage;

    let (ws_stream, _) = connect_async(ws_url).await?;
    let (mut _write, mut read) = ws_stream.split();

    info!("Connected to ExacqVision WebSocket");

    // Send initial connection success event
    let connect_event = CameraEvent::Generic {
        camera_id: None,
        message: "Connected to ExacqVision event stream".to_string(),
        timestamp: chrono::Utc::now(),
    };
    let _ = tx.send(connect_event);

    while let Some(msg) = read.next().await {
        match msg {
            Ok(TungsteniteMessage::Text(text)) => {
                debug!(message = %text, "Received ExacqVision event");
                
                // Parse ExacqVision event and convert to our format
                if let Some(event) = parse_exacq_event(&text) {
                    if tx.send(event).is_err() {
                        // No receivers, but keep connection alive
                        debug!("No WebSocket clients connected");
                    }
                }
            }
            Ok(TungsteniteMessage::Binary(data)) => {
                debug!(size = data.len(), "Received binary message");
            }
            Ok(TungsteniteMessage::Ping(_)) => {
                debug!("Received ping from ExacqVision");
            }
            Ok(TungsteniteMessage::Close(_)) => {
                info!("ExacqVision WebSocket closed");
                break;
            }
            Err(e) => {
                error!(error = %e, "ExacqVision WebSocket error");
                return Err(e.into());
            }
            _ => {}
        }
    }

    Ok(())
}

/// Parse ExacqVision event message into our event format
fn parse_exacq_event(text: &str) -> Option<CameraEvent> {
    // Try to parse as JSON first
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(text) {
        // ExacqVision event format varies, try to extract common fields
        let event_type = json.get("type")
            .or_else(|| json.get("event"))
            .and_then(|v| v.as_str());

        let camera_id = json.get("camera")
            .or_else(|| json.get("cameraId"))
            .or_else(|| json.get("camera_id"))
            .and_then(|v| v.as_i64());

        let camera_name = json.get("cameraName")
            .or_else(|| json.get("camera_name"))
            .or_else(|| json.get("name"))
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown")
            .to_string();

        let timestamp = chrono::Utc::now();

        match event_type {
            Some("motion") | Some("Motion") => {
                return Some(CameraEvent::Motion {
                    camera_id: camera_id.unwrap_or(0),
                    camera_name,
                    timestamp,
                    zone: json.get("zone").and_then(|v| v.as_str()).map(String::from),
                });
            }
            Some("offline") | Some("Offline") | Some("disconnected") => {
                return Some(CameraEvent::Offline {
                    camera_id: camera_id.unwrap_or(0),
                    camera_name,
                    timestamp,
                });
            }
            Some("online") | Some("Online") | Some("connected") => {
                return Some(CameraEvent::Online {
                    camera_id: camera_id.unwrap_or(0),
                    camera_name,
                    timestamp,
                });
            }
            Some("alarm") | Some("Alarm") | Some("trigger") => {
                return Some(CameraEvent::Alarm {
                    camera_id: camera_id.unwrap_or(0),
                    camera_name,
                    timestamp,
                    alarm_type: json.get("alarmType")
                        .or_else(|| json.get("alarm_type"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string(),
                });
            }
            Some("recording_start") | Some("recordStart") => {
                return Some(CameraEvent::RecordingStart {
                    camera_id: camera_id.unwrap_or(0),
                    camera_name,
                    timestamp,
                    recording_id: json.get("recordingId")
                        .or_else(|| json.get("recording_id"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string(),
                });
            }
            Some("recording_stop") | Some("recordStop") => {
                return Some(CameraEvent::RecordingStop {
                    camera_id: camera_id.unwrap_or(0),
                    camera_name,
                    timestamp,
                    recording_id: json.get("recordingId")
                        .or_else(|| json.get("recording_id"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string(),
                });
            }
            _ => {
                // Generic event for unknown types
                return Some(CameraEvent::Generic {
                    camera_id,
                    message: text.to_string(),
                    timestamp,
                });
            }
        }
    }

    // If not JSON, treat as generic message
    Some(CameraEvent::Generic {
        camera_id: None,
        message: text.to_string(),
        timestamp: chrono::Utc::now(),
    })
}

// Created and developed by Jai Singh
