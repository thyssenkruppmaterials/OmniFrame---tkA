// Created and developed by Jai Singh
use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::state::{AppState, DeviceEvent};

async fn resolve_device_org(pool: &sqlx::PgPool, device_id: Uuid) -> Option<String> {
    sqlx::query_as::<_, (String,)>(
        "SELECT organization_id::text FROM mdm_devices WHERE id = $1"
    )
    .bind(device_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .map(|r| r.0)
}

#[derive(Debug, Deserialize)]
pub struct HeartbeatRequest {
    pub device_id: Uuid,
    pub battery_level: Option<f64>,
    pub battery_health: Option<String>,
    pub total_storage_bytes: Option<i64>,
    pub available_storage_bytes: Option<i64>,
    pub ip_address: Option<String>,
    pub carrier: Option<String>,
    pub cellular_technology: Option<String>,
    pub is_roaming: Option<bool>,
    pub agent_version: Option<String>,
}

pub async fn heartbeat(
    State(state): State<Arc<AppState>>,
    Json(request): Json<HeartbeatRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let org_id = resolve_device_org(&state.db_pool, request.device_id).await;

    sqlx::query(
        "UPDATE mdm_devices SET
           battery_level = COALESCE($2, battery_level),
           battery_health = COALESCE($3, battery_health),
           total_storage_bytes = COALESCE($4, total_storage_bytes),
           available_storage_bytes = COALESCE($5, available_storage_bytes),
           ip_address = COALESCE($6::inet, ip_address),
           carrier = COALESCE($7, carrier),
           cellular_technology = COALESCE($8, cellular_technology),
           is_roaming = COALESCE($9, is_roaming),
           last_checkin_at = NOW(),
           updated_at = NOW()
         WHERE id = $1"
    )
    .bind(request.device_id)
    .bind(request.battery_level)
    .bind(&request.battery_health)
    .bind(request.total_storage_bytes)
    .bind(request.available_storage_bytes)
    .bind(&request.ip_address)
    .bind(&request.carrier)
    .bind(&request.cellular_technology)
    .bind(request.is_roaming)
    .execute(&state.db_pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to process heartbeat");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Database error"})))
    })?;

    crate::metrics::record_telemetry_ingest("heartbeat");

    let _ = state.ws_broadcast.send(DeviceEvent {
        event_type: "heartbeat".to_string(),
        device_id: Some(request.device_id.to_string()),
        organization_id: org_id.clone(),
        payload: serde_json::json!({"battery_level": request.battery_level}),
        timestamp: chrono::Utc::now(),
    });

    Ok(Json(serde_json::json!({"status": "ok"})))
}

#[derive(Debug, Deserialize)]
pub struct LocationReport {
    pub device_id: Uuid,
    pub latitude: f64,
    pub longitude: f64,
    pub altitude: Option<f64>,
    pub horizontal_accuracy: Option<f64>,
    pub vertical_accuracy: Option<f64>,
    pub speed: Option<f64>,
    pub heading: Option<f64>,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub source: Option<String>,
}

pub async fn report_location(
    State(state): State<Arc<AppState>>,
    Json(request): Json<LocationReport>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let source = request.source.as_deref().unwrap_or("agent");

    let org_id = resolve_device_org(&state.db_pool, request.device_id).await
        .ok_or_else(|| {
            tracing::warn!(device_id = %request.device_id, "Device not found for location report");
            (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Device not found"})))
        })?;

    sqlx::query(
        "INSERT INTO mdm_device_locations
           (organization_id, device_id, latitude, longitude, altitude, horizontal_accuracy,
            vertical_accuracy, speed, heading, timestamp, source)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"
    )
    .bind(&org_id)
    .bind(request.device_id)
    .bind(request.latitude)
    .bind(request.longitude)
    .bind(request.altitude)
    .bind(request.horizontal_accuracy)
    .bind(request.vertical_accuracy)
    .bind(request.speed)
    .bind(request.heading)
    .bind(request.timestamp)
    .bind(source)
    .execute(&state.db_pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to store location");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Database error"})))
    })?;

    crate::metrics::record_telemetry_ingest("location");

    evaluate_geofences(&state.db_pool, &org_id, request.device_id, request.latitude, request.longitude).await;

    let _ = state.ws_broadcast.send(DeviceEvent {
        event_type: "location".to_string(),
        device_id: Some(request.device_id.to_string()),
        organization_id: Some(org_id),
        payload: serde_json::json!({
            "latitude": request.latitude,
            "longitude": request.longitude,
            "accuracy": request.horizontal_accuracy,
            "speed": request.speed,
            "heading": request.heading,
            "timestamp": request.timestamp,
        }),
        timestamp: chrono::Utc::now(),
    });

    Ok(Json(serde_json::json!({"status": "ok"})))
}

async fn evaluate_geofences(pool: &sqlx::PgPool, org_id: &str, device_id: Uuid, lat: f64, lng: f64) {
    #[derive(sqlx::FromRow)]
    struct GeofenceRow {
        id: Uuid,
        center_lat: Option<f64>,
        center_lng: Option<f64>,
        radius_meters: Option<f64>,
        alert_type: String,
    }

    let fences = sqlx::query_as::<_, GeofenceRow>(
        "SELECT id, center_lat, center_lng, radius_meters, alert_type
         FROM mdm_geofences
         WHERE organization_id = $1::uuid AND enabled = true AND geometry_type = 'circle'
           AND center_lat IS NOT NULL AND center_lng IS NOT NULL AND radius_meters IS NOT NULL"
    )
    .bind(org_id)
    .fetch_all(pool)
    .await;

    let fences = match fences {
        Ok(f) => f,
        Err(e) => {
            tracing::warn!(error = %e, "Failed to load geofences for evaluation");
            return;
        }
    };

    for fence in fences {
        let center_lat = fence.center_lat.unwrap();
        let center_lng = fence.center_lng.unwrap();
        let radius = fence.radius_meters.unwrap();
        let distance = haversine_meters(lat, lng, center_lat, center_lng);
        let inside = distance <= radius;

        let last_event: Option<(String,)> = sqlx::query_as(
            "SELECT event_type FROM mdm_geofence_events
             WHERE geofence_id = $1 AND device_id = $2
             ORDER BY triggered_at DESC LIMIT 1"
        )
        .bind(fence.id)
        .bind(device_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();

        let was_inside = last_event.as_ref().map(|e| e.0 == "enter").unwrap_or(false);

        let transition = if inside && !was_inside {
            Some("enter")
        } else if !inside && was_inside {
            Some("exit")
        } else {
            None
        };

        if let Some(event_type) = transition {
            if (fence.alert_type == "enter" && event_type != "enter")
                || (fence.alert_type == "exit" && event_type != "exit") {
                continue;
            }

            let _ = sqlx::query(
                "INSERT INTO mdm_geofence_events (organization_id, geofence_id, device_id, event_type, latitude, longitude)
                 VALUES ($1::uuid, $2, $3, $4, $5, $6)"
            )
            .bind(org_id)
            .bind(fence.id)
            .bind(device_id)
            .bind(event_type)
            .bind(lat)
            .bind(lng)
            .execute(pool)
            .await;

            tracing::info!(
                geofence_id = %fence.id, device_id = %device_id, event = event_type,
                "Geofence transition detected"
            );
        }
    }
}

fn haversine_meters(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f64 {
    let r = 6_371_000.0;
    let phi1 = lat1.to_radians();
    let phi2 = lat2.to_radians();
    let delta_phi = (lat2 - lat1).to_radians();
    let delta_lambda = (lng2 - lng1).to_radians();
    let a = (delta_phi / 2.0).sin().powi(2)
        + phi1.cos() * phi2.cos() * (delta_lambda / 2.0).sin().powi(2);
    let c = 2.0 * a.sqrt().atan2((1.0 - a).sqrt());
    r * c
}

#[derive(Debug, Deserialize)]
pub struct DeviceHealthReport {
    pub device_id: Uuid,
    pub metrics: serde_json::Value,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

pub async fn report_device_health(
    State(state): State<Arc<AppState>>,
    Json(request): Json<DeviceHealthReport>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    sqlx::query(
        "INSERT INTO mdm_device_health_samples (device_id, metrics, timestamp) VALUES ($1, $2, $3)"
    )
    .bind(request.device_id)
    .bind(&request.metrics)
    .bind(request.timestamp)
    .execute(&state.db_pool)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Failed to store health sample");
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "Database error"})))
    })?;

    crate::metrics::record_telemetry_ingest("device-health");

    Ok(Json(serde_json::json!({"status": "ok"})))
}

// Created and developed by Jai Singh
