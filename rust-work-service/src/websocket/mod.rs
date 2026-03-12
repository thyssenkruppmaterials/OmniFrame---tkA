//! WebSocket server implementation for rust-work-service
//!
//! Provides real-time event broadcasting for:
//! - Task assignments and status changes
//! - Worker status updates
//! - Queue statistics updates
//! - Pushed work notifications

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::AppState;

/// WebSocket events sent from server to clients
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WsEvent {
    /// A task was assigned to a user
    TaskAssigned {
        task_id: Uuid,
        user_id: Uuid,
        priority: String,
        location: String,
        material: String,
    },
    /// A task's status changed
    TaskStatusChanged {
        task_id: Uuid,
        old_status: String,
        new_status: String,
    },
    /// A worker's status changed
    WorkerStatusChanged {
        user_id: Uuid,
        status: String,
    },
    /// Queue statistics were updated
    QueueStatsUpdated {
        pending: i64,
        in_progress: i64,
        completed_today: i64,
    },
    /// Work was pushed to a user (supervisor push mode)
    PushedWork {
        task_id: Uuid,
        user_id: Uuid,
        material: String,
        location: String,
        count_number: String,
        priority: String,
    },
    /// Heartbeat acknowledgment
    Heartbeat {
        user_id: Uuid,
    },
}

/// Messages sent from clients to server
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum WsClientMessage {
    /// Subscribe to organization events
    Subscribe {
        organization_id: Uuid,
    },
    /// Worker heartbeat with optional task info
    Heartbeat {
        task_id: Option<Uuid>,
        #[allow(dead_code)] // Deserialized from client messages; not yet processed server-side
        task_type: Option<String>,
        #[allow(dead_code)] // Deserialized from client messages; not yet processed server-side
        zone: Option<String>,
        #[allow(dead_code)] // Deserialized from client messages; not yet processed server-side
        location: Option<String>,
        status: String,
    },
    /// Unsubscribe from events
    Unsubscribe,
}

/// WebSocket upgrade handler
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    tracing::info!("WebSocket connection request received");
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

/// Handle individual WebSocket connection
async fn handle_socket(socket: WebSocket, state: Arc<AppState>) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.ws_broadcast.subscribe();

    tracing::info!("WebSocket client connected");

    // Spawn task to forward broadcast events to this client
    let send_task = tokio::spawn(async move {
        while let Ok(event) = rx.recv().await {
            let json = match serde_json::to_string(&event) {
                Ok(j) => j,
                Err(e) => {
                    tracing::error!("Failed to serialize WebSocket event: {}", e);
                    continue;
                }
            };
            if sender.send(Message::Text(json)).await.is_err() {
                tracing::debug!("WebSocket send failed, client likely disconnected");
                break;
            }
        }
    });

    // Handle incoming messages from client
    while let Some(Ok(msg)) = receiver.next().await {
        match msg {
            Message::Text(text) => {
                match serde_json::from_str::<WsClientMessage>(&text) {
                    Ok(WsClientMessage::Heartbeat {
                        task_id,
                        task_type: _,
                        zone: _,
                        location: _,
                        status,
                    }) => {
                        tracing::debug!(
                            "Received heartbeat via WebSocket: task_id={:?}, status={}",
                            task_id,
                            status
                        );
                        // TODO: use real user_id from auth-on-upgrade once implemented
                        let _ = state.ws_broadcast.send(WsEvent::Heartbeat {
                            user_id: uuid::Uuid::nil(),
                        });
                    }
                    Ok(WsClientMessage::Subscribe { organization_id }) => {
                        tracing::info!(
                            "Client subscribed to organization: {}",
                            organization_id
                        );
                        // Could implement per-org filtering here
                    }
                    Ok(WsClientMessage::Unsubscribe) => {
                        tracing::debug!("Client unsubscribed from events");
                    }
                    Err(e) => {
                        tracing::warn!("Failed to parse WebSocket message: {} - raw: {}", e, text);
                    }
                }
            }
            Message::Ping(_) => {
                tracing::trace!("Received WebSocket ping");
                // Axum handles pong automatically
            }
            Message::Close(_) => {
                tracing::info!("Client closed WebSocket connection");
                break;
            }
            _ => {}
        }
    }

    // Clean up: abort the send task
    send_task.abort();
    tracing::info!("WebSocket client disconnected");
}

/// Create a broadcast channel for WebSocket events
///
/// Returns a tuple of (sender, receiver) where sender is cloned into AppState
/// and receiver can be used for testing or monitoring.
pub fn create_broadcast_channel() -> (broadcast::Sender<WsEvent>, broadcast::Receiver<WsEvent>) {
    broadcast::channel(1000)
}
