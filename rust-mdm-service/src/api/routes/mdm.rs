use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use std::sync::Arc;

use crate::state::AppState;

pub async fn handle_checkin(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    let content_type = headers
        .get("Content-Type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !content_type.contains("plist") && !content_type.contains("xml") {
        tracing::warn!(content_type = %content_type, "Unexpected content type for MDM check-in");
    }

    match plist::from_bytes::<plist::Dictionary>(&body) {
        Ok(dict) => {
            let message_type = dict
                .get("MessageType")
                .and_then(|v| v.as_string())
                .unwrap_or("Unknown");

            tracing::info!(message_type = %message_type, "MDM check-in received");
            crate::metrics::record_checkin(message_type);

            match message_type {
                "Authenticate" => handle_authenticate(&state, &dict).await,
                "TokenUpdate" => handle_token_update(&state, &dict).await,
                "CheckOut" => handle_checkout(&state, &dict).await,
                _ => {
                    tracing::warn!(message_type = %message_type, "Unknown check-in message type");
                    StatusCode::OK.into_response()
                }
            }
        }
        Err(e) => {
            tracing::error!(error = %e, "Failed to parse check-in plist");
            (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": "Invalid plist"}))).into_response()
        }
    }
}

async fn handle_authenticate(
    state: &Arc<AppState>,
    dict: &plist::Dictionary,
) -> axum::response::Response {
    let udid = dict.get("UDID").and_then(|v| v.as_string()).unwrap_or("");
    let topic = dict.get("Topic").and_then(|v| v.as_string()).unwrap_or("");
    let serial = dict.get("SerialNumber").and_then(|v| v.as_string()).unwrap_or("");
    let model = dict.get("Model").and_then(|v| v.as_string()).unwrap_or("");
    let product = dict.get("ProductName").and_then(|v| v.as_string()).unwrap_or("");
    let os_version = dict.get("OSVersion").and_then(|v| v.as_string()).unwrap_or("");

    tracing::info!(udid = %udid, serial = %serial, model = %model, "Device authenticating");

    let result = sqlx::query(
        "INSERT INTO mdm_devices (udid, serial_number, model, product_name, os_version, topic, status, organization_id)
         VALUES ($1, $2, $3, $4, $5, $6, 'Pending',
           (SELECT id FROM organizations LIMIT 1))
         ON CONFLICT (udid) DO UPDATE SET
           serial_number = EXCLUDED.serial_number,
           model = EXCLUDED.model,
           product_name = EXCLUDED.product_name,
           os_version = EXCLUDED.os_version,
           topic = EXCLUDED.topic,
           last_checkin_at = NOW()"
    )
    .bind(udid)
    .bind(serial)
    .bind(model)
    .bind(product)
    .bind(os_version)
    .bind(topic)
    .execute(&state.db_pool)
    .await;

    if let Err(e) = result {
        tracing::error!(error = %e, "Failed to register device");
    }

    StatusCode::OK.into_response()
}

async fn handle_token_update(
    state: &Arc<AppState>,
    dict: &plist::Dictionary,
) -> axum::response::Response {
    let udid = dict.get("UDID").and_then(|v| v.as_string()).unwrap_or("");
    let push_magic = dict.get("PushMagic").and_then(|v| v.as_string()).unwrap_or("");
    let topic = dict.get("Topic").and_then(|v| v.as_string()).unwrap_or("");

    tracing::info!(udid = %udid, "Token update received");

    let device_id_result = sqlx::query_as::<_, (uuid::Uuid,)>(
        "SELECT id FROM mdm_devices WHERE udid = $1"
    )
    .bind(udid)
    .fetch_optional(&state.db_pool)
    .await;

    if let Ok(Some((device_id,))) = device_id_result {
        let _ = sqlx::query(
            "INSERT INTO mdm_device_secrets (device_id, push_magic, topic)
             VALUES ($1, $2, $3)
             ON CONFLICT (device_id) DO UPDATE SET
               push_magic = EXCLUDED.push_magic,
               topic = EXCLUDED.topic,
               updated_at = NOW()"
        )
        .bind(device_id)
        .bind(push_magic)
        .bind(topic)
        .execute(&state.db_pool)
        .await;

        let _ = sqlx::query(
            "UPDATE mdm_devices SET status = 'Online', last_checkin_at = NOW(), mdm_profile_installed = true WHERE id = $1"
        )
        .bind(device_id)
        .execute(&state.db_pool)
        .await;
    }

    StatusCode::OK.into_response()
}

async fn handle_checkout(
    state: &Arc<AppState>,
    dict: &plist::Dictionary,
) -> axum::response::Response {
    let udid = dict.get("UDID").and_then(|v| v.as_string()).unwrap_or("");
    tracing::info!(udid = %udid, "Device checked out");

    let _ = sqlx::query(
        "UPDATE mdm_devices SET status = 'Offline', mdm_profile_installed = false, last_checkin_at = NOW() WHERE udid = $1"
    )
    .bind(udid)
    .execute(&state.db_pool)
    .await;

    StatusCode::OK.into_response()
}

pub async fn handle_server_request(
    State(state): State<Arc<AppState>>,
    body: Bytes,
) -> impl IntoResponse {
    let dict = match plist::from_bytes::<plist::Dictionary>(&body) {
        Ok(d) => d,
        Err(_) => {
            return StatusCode::OK.into_response();
        }
    };

    let udid = dict.get("UDID").and_then(|v| v.as_string()).unwrap_or("");
    if udid.is_empty() {
        return StatusCode::OK.into_response();
    }

    let device = sqlx::query_as::<_, (uuid::Uuid,)>(
        "SELECT id FROM mdm_devices WHERE udid = $1"
    )
    .bind(udid)
    .fetch_optional(&state.db_pool)
    .await;

    let device_id = match device {
        Ok(Some((id,))) => id,
        _ => return StatusCode::OK.into_response(),
    };

    if let Some(cmd_status) = dict.get("Status").and_then(|v| v.as_string()) {
        if let Some(cmd_uuid_str) = dict.get("CommandUUID").and_then(|v| v.as_string()) {
            if let Ok(cmd_uuid) = uuid::Uuid::parse_str(cmd_uuid_str) {
                let new_status = match cmd_status {
                    "Acknowledged" => "Completed",
                    "Error" => "Failed",
                    "CommandFormatError" => "Failed",
                    "NotNow" => "NotNow",
                    _ => "Acknowledged",
                };

                let prev: Option<(String, uuid::Uuid)> = sqlx::query_as(
                    "SELECT status, COALESCE(correlation_id, gen_random_uuid()) FROM mdm_commands WHERE command_uuid = $1"
                )
                .bind(cmd_uuid)
                .fetch_optional(&state.db_pool)
                .await
                .ok()
                .flatten();

                if let Some((prev_status, corr_id)) = prev {
                    let _ = sqlx::query(
                        "UPDATE mdm_commands SET status = $1, completed_at = CASE WHEN $1 IN ('Completed','Failed') THEN NOW() ELSE completed_at END, acknowledged_at = NOW() WHERE command_uuid = $2"
                    )
                    .bind(new_status)
                    .bind(cmd_uuid)
                    .execute(&state.db_pool)
                    .await;

                    let cmd_id: Option<(uuid::Uuid,)> = sqlx::query_as(
                        "SELECT id FROM mdm_commands WHERE command_uuid = $1"
                    )
                    .bind(cmd_uuid)
                    .fetch_optional(&state.db_pool)
                    .await
                    .ok()
                    .flatten();

                    if let Some((cid,)) = cmd_id {
                        super::admin::write_command_event(
                            &state.db_pool, cid, "device_response",
                            Some(&prev_status), Some(new_status),
                            None, "device", corr_id,
                        ).await;
                    }
                }
            }
        }
    }

    let next_cmd = sqlx::query_as::<_, (uuid::Uuid, String, Option<serde_json::Value>)>(
        "SELECT command_uuid, command_type, payload FROM mdm_commands
         WHERE device_id = $1 AND status IN ('Queued', 'Approved')
         ORDER BY priority DESC, queued_at ASC
         LIMIT 1"
    )
    .bind(device_id)
    .fetch_optional(&state.db_pool)
    .await;

    match next_cmd {
        Ok(Some((cmd_uuid, cmd_type, _payload))) => {
            let _ = sqlx::query("UPDATE mdm_commands SET status = 'Sent', sent_at = NOW() WHERE command_uuid = $1")
                .bind(cmd_uuid)
                .execute(&state.db_pool)
                .await;

            let mut response_dict = plist::Dictionary::new();
            response_dict.insert("CommandUUID".to_string(), plist::Value::String(cmd_uuid.to_string()));
            response_dict.insert("Command".to_string(), plist::Value::Dictionary({
                let mut cmd = plist::Dictionary::new();
                cmd.insert("RequestType".to_string(), plist::Value::String(cmd_type));
                cmd
            }));

            let mut plist_bytes = Vec::new();
            if plist::to_writer_xml(&mut plist_bytes, &response_dict).is_ok() {
                (
                    StatusCode::OK,
                    [("Content-Type", "application/xml")],
                    plist_bytes,
                ).into_response()
            } else {
                StatusCode::OK.into_response()
            }
        }
        _ => StatusCode::OK.into_response(),
    }
}

pub async fn generate_enrollment_profile(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let mdm_base_url = state.config.mdm_base_url.as_deref().unwrap_or("https://mdm.example.com");

    Json(serde_json::json!({
        "enrollment_url": format!("{}/api/v1/mdm/enroll/profile", mdm_base_url),
        "checkin_url": format!("{}/api/v1/mdm/checkin", mdm_base_url),
        "server_url": format!("{}/api/v1/mdm/server", mdm_base_url),
        "note": "Full signed .mobileconfig generation requires PROFILE_SIGNING_CERT_PATH",
    }))
}
