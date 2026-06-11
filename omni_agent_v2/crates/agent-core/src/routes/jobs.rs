// Created and developed by Jai Singh
//! `/jobs/claim`, `/jobs/{id}/complete`, `/jobs/{id}/fail`,
//! `/jobs/{id}/heartbeat` — proxies to `rust-work-service`.

use agent_types::{
    JobClaimRequest, JobClaimResponse, JobCompleteRequest, JobFailRequest, JobHeartbeatRequest,
    OkResponse,
};
use axum::extract::{Path, State};
use axum::Json;
use uuid::Uuid;

use crate::routes::AppContext;

pub async fn claim(
    State(ctx): State<AppContext>,
    Json(req): Json<JobClaimRequest>,
) -> Json<JobClaimResponse> {
    let bearer = match ctx.state.jwt.read().bearer.clone() {
        Some(b) => b,
        None => {
            return Json(JobClaimResponse {
                ok: false,
                job: None,
                active_job_id: None,
                error: Some("no JWT cached — service-key not yet exchanged".into()),
            });
        }
    };
    let client =
        match crate::work_service::WorkServiceClient::new(ctx.config.work_service_url.clone()) {
            Ok(c) => c,
            Err(e) => {
                return Json(JobClaimResponse {
                    ok: false,
                    job: None,
                    active_job_id: None,
                    error: Some(format!("client: {e}")),
                });
            }
        };
    match client.claim(&bearer, &req).await {
        Ok(r) => Json(r),
        Err(e) => Json(JobClaimResponse {
            ok: false,
            job: None,
            active_job_id: None,
            error: Some(format!("upstream: {e}")),
        }),
    }
}

pub async fn complete(
    State(ctx): State<AppContext>,
    Path(job_id): Path<Uuid>,
    Json(req): Json<JobCompleteRequest>,
) -> Json<OkResponse> {
    let bearer = ctx.state.jwt.read().bearer.clone().unwrap_or_default();
    let client =
        match crate::work_service::WorkServiceClient::new(ctx.config.work_service_url.clone()) {
            Ok(c) => c,
            Err(e) => return Json(OkResponse::with_message(format!("client: {e}"))),
        };
    match client.complete(&bearer, job_id, &req).await {
        Ok(r) => {
            ctx.state
                .jobs_processed
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            Json(r)
        }
        Err(e) => Json(OkResponse::with_message(format!("upstream: {e}"))),
    }
}

pub async fn fail(
    State(ctx): State<AppContext>,
    Path(job_id): Path<Uuid>,
    Json(req): Json<JobFailRequest>,
) -> Json<OkResponse> {
    let bearer = ctx.state.jwt.read().bearer.clone().unwrap_or_default();
    let client =
        match crate::work_service::WorkServiceClient::new(ctx.config.work_service_url.clone()) {
            Ok(c) => c,
            Err(e) => return Json(OkResponse::with_message(format!("client: {e}"))),
        };
    match client.fail(&bearer, job_id, &req).await {
        Ok(r) => Json(r),
        Err(e) => Json(OkResponse::with_message(format!("upstream: {e}"))),
    }
}

pub async fn heartbeat(
    State(ctx): State<AppContext>,
    Path(job_id): Path<Uuid>,
    Json(req): Json<JobHeartbeatRequest>,
) -> Json<OkResponse> {
    let bearer = ctx.state.jwt.read().bearer.clone().unwrap_or_default();
    let client =
        match crate::work_service::WorkServiceClient::new(ctx.config.work_service_url.clone()) {
            Ok(c) => c,
            Err(e) => return Json(OkResponse::with_message(format!("client: {e}"))),
        };
    match client.heartbeat(&bearer, job_id, &req).await {
        Ok(r) => Json(r),
        Err(e) => Json(OkResponse::with_message(format!("upstream: {e}"))),
    }
}

// Created and developed by Jai Singh
