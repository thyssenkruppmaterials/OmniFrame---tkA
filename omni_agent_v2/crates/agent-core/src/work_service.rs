// Created and developed by Jai Singh
//! Thin client for `rust-work-service /api/v1/sap-agents/jobs/*`.

use std::time::Duration;

use agent_types::{
    Job, JobClaimRequest, JobClaimResponse, JobCompleteRequest, JobFailRequest,
    JobHeartbeatRequest, OkResponse,
};
use anyhow::{Context, Result};
use reqwest::header;
use serde::Serialize;
use tracing::warn;
use uuid::Uuid;

#[derive(Clone)]
pub struct WorkServiceClient {
    base_url: String,
    http: reqwest::Client,
}

impl WorkServiceClient {
    pub fn new(base_url: String) -> Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .context("build work-service http client")?;
        Ok(Self { base_url, http })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url.trim_end_matches('/'), path)
    }

    /// Helper for any POST that takes a Bearer + JSON body.
    async fn post_json<B: Serialize, R: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        bearer: &str,
        body: &B,
    ) -> Result<R> {
        let resp = self
            .http
            .post(self.url(path))
            .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
            .json(body)
            .send()
            .await
            .with_context(|| format!("POST {path}"))?;
        let status = resp.status();
        let raw = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            anyhow::bail!("work-service {path} returned {status}: {raw}");
        }
        serde_json::from_str(&raw).with_context(|| format!("parse {path} response: {raw}"))
    }

    pub async fn claim(&self, bearer: &str, req: &JobClaimRequest) -> Result<JobClaimResponse> {
        self.post_json("/api/v1/sap-agents/jobs/claim", bearer, req)
            .await
    }

    pub async fn complete(
        &self,
        bearer: &str,
        job_id: Uuid,
        req: &JobCompleteRequest,
    ) -> Result<OkResponse> {
        self.post_json(
            &format!("/api/v1/sap-agents/jobs/{job_id}/complete"),
            bearer,
            req,
        )
        .await
    }

    pub async fn fail(
        &self,
        bearer: &str,
        job_id: Uuid,
        req: &JobFailRequest,
    ) -> Result<OkResponse> {
        self.post_json(
            &format!("/api/v1/sap-agents/jobs/{job_id}/fail"),
            bearer,
            req,
        )
        .await
    }

    pub async fn heartbeat(
        &self,
        bearer: &str,
        job_id: Uuid,
        req: &JobHeartbeatRequest,
    ) -> Result<OkResponse> {
        self.post_json(
            &format!("/api/v1/sap-agents/jobs/{job_id}/heartbeat"),
            bearer,
            req,
        )
        .await
    }

    /// Best-effort poll for the next job. Returns `Ok(None)` when no
    /// job is available.
    pub async fn try_claim_next(
        &self,
        bearer: &str,
        agent_id: &str,
        capabilities: &[String],
    ) -> Result<Option<Job>> {
        let req = JobClaimRequest {
            agent_id: agent_id.to_string(),
            capabilities: Some(capabilities.to_vec()),
            lease_seconds: Some(60),
        };
        match self.claim(bearer, &req).await {
            Ok(resp) => Ok(resp.job),
            Err(e) => {
                warn!(error = %e, "claim poll failed");
                Err(e)
            }
        }
    }
}

// Created and developed by Jai Singh
