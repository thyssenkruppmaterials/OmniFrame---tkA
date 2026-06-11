// Created and developed by Jai Singh
//! `/supabase/login`, `/supabase/session`, `/supabase/logout`.
//!
//! The Rust port forwards the user-cred POST to Supabase's `/auth/v1/token`
//! and stashes the returned tokens. We keep the behaviour intentionally
//! minimal — full FE auth flow is browser-side; the agent is just a
//! proxy + cache.

use agent_types::{
    OkResponse, SupabaseLoginRequest, SupabaseLoginResponse, SupabaseSessionResponse,
};
use axum::extract::State;
use axum::Json;
use chrono::Utc;
use serde_json::Value;
use uuid::Uuid;

use crate::routes::AppContext;

pub async fn login(
    State(ctx): State<AppContext>,
    Json(req): Json<SupabaseLoginRequest>,
) -> Json<SupabaseLoginResponse> {
    // Mint an agent_token for this user — the FE will echo it back as
    // `X-Agent-Token` on every subsequent localhost call.
    let agent_token = Uuid::new_v4().to_string();
    {
        let mut tok = ctx.state.agent_token.write();
        tok.token = agent_token.clone();
        tok.minted_at = Some(Utc::now());
    }

    // If the caller didn't supply email/password we still cache the
    // url + key so subsequent `/supabase/session` calls work.
    if req.email.is_none() || req.password.is_none() {
        let mut sb = ctx.state.supabase.write();
        sb.organization_id = None;
        return Json(SupabaseLoginResponse {
            ok: true,
            agent_token,
            user: None,
            error: None,
        });
    }

    // Real exchange against Supabase.
    let url = format!(
        "{}/auth/v1/token?grant_type=password",
        req.url.trim_end_matches('/')
    );
    let body = serde_json::json!({
        "email": req.email,
        "password": req.password,
    });
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return Json(SupabaseLoginResponse {
                ok: false,
                agent_token,
                user: None,
                error: Some(format!("http client: {e}")),
            });
        }
    };

    let resp = client
        .post(&url)
        .header("apikey", &req.key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await;
    let resp = match resp {
        Ok(r) => r,
        Err(e) => {
            return Json(SupabaseLoginResponse {
                ok: false,
                agent_token,
                user: None,
                error: Some(format!("supabase POST: {e}")),
            });
        }
    };

    let status = resp.status();
    let raw = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Json(SupabaseLoginResponse {
            ok: false,
            agent_token,
            user: None,
            error: Some(format!("supabase {status}: {raw}")),
        });
    }
    let parsed: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            return Json(SupabaseLoginResponse {
                ok: false,
                agent_token,
                user: None,
                error: Some(format!("parse: {e}")),
            });
        }
    };

    let access_token = parsed
        .get("access_token")
        .and_then(Value::as_str)
        .map(str::to_string);
    let refresh_token = parsed
        .get("refresh_token")
        .and_then(Value::as_str)
        .map(str::to_string);
    let expires_at = parsed.get("expires_at").and_then(Value::as_i64);
    let user = parsed.get("user").cloned();
    let email = user
        .as_ref()
        .and_then(|u| u.get("email"))
        .and_then(Value::as_str)
        .map(str::to_string);

    {
        let mut sb = ctx.state.supabase.write();
        sb.access_token = access_token;
        sb.refresh_token = refresh_token;
        sb.expires_at = expires_at;
        sb.user_email = email;
        sb.raw_user = user.clone();
    }

    Json(SupabaseLoginResponse {
        ok: true,
        agent_token,
        user,
        error: None,
    })
}

pub async fn session(State(ctx): State<AppContext>) -> Json<SupabaseSessionResponse> {
    let sb = ctx.state.supabase.read();
    Json(SupabaseSessionResponse {
        ok: true,
        user: sb.raw_user.clone(),
        access_token: sb.access_token.clone(),
        refresh_token: sb.refresh_token.clone(),
        expires_at: sb.expires_at,
    })
}

pub async fn logout(State(ctx): State<AppContext>) -> Json<OkResponse> {
    {
        let mut sb = ctx.state.supabase.write();
        *sb = Default::default();
    }
    {
        let mut tok = ctx.state.agent_token.write();
        tok.token = String::new();
        tok.minted_at = None;
    }
    Json(OkResponse::ok())
}

// Created and developed by Jai Singh
