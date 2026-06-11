// Created and developed by Jai Singh
//! Short-lived signed `WS-Subscribe-Token` (Phase 2.0 v1 decision).
//!
//! Issued by `POST /api/v1/work/ws-token` after the caller is authenticated
//! over HTTP. The WebSocket upgrade handler verifies the token before
//! accepting any subscribe message.
//!
//! Token format: `<v1>.<payload-b64u>.<sig-b64u>` where payload is JSON
//! `{ user_id, organization_id, exp_unix_secs }` and sig is HMAC-SHA256 of
//! `v1.<payload-b64u>` using the env-configured secret.
//!
//! TTL: 5 minutes by default. Clients refresh via the same HTTP route.

use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::{general_purpose::URL_SAFE_NO_PAD, Engine};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use uuid::Uuid;

const TOKEN_VERSION: &str = "v1";
const TTL_SECONDS: u64 = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsTokenClaims {
    pub user_id: Uuid,
    pub organization_id: Uuid,
    pub exp_unix_secs: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum WsTokenError {
    #[error("token has wrong version")]
    BadVersion,
    #[error("token malformed")]
    Malformed,
    #[error("invalid signature")]
    BadSignature,
    #[error("token expired")]
    Expired,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn secret() -> Vec<u8> {
    std::env::var("WORK_WS_TOKEN_SECRET")
        .unwrap_or_else(|_| "dev-only-not-for-production-secret".to_string())
        .into_bytes()
}

pub fn issue(user_id: Uuid, organization_id: Uuid) -> String {
    let claims = WsTokenClaims {
        user_id,
        organization_id,
        exp_unix_secs: now_secs() + TTL_SECONDS,
    };
    let payload_json = serde_json::to_vec(&claims).expect("serialize WsTokenClaims");
    let payload_b64 = URL_SAFE_NO_PAD.encode(&payload_json);
    let signing_input = format!("{TOKEN_VERSION}.{payload_b64}");

    let mut mac = Hmac::<Sha256>::new_from_slice(&secret()).expect("HMAC key length");
    mac.update(signing_input.as_bytes());
    let sig = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());

    format!("{signing_input}.{sig}")
}

pub fn verify(token: &str) -> Result<WsTokenClaims, WsTokenError> {
    let mut parts = token.splitn(3, '.');
    let version = parts.next().ok_or(WsTokenError::Malformed)?;
    let payload = parts.next().ok_or(WsTokenError::Malformed)?;
    let sig = parts.next().ok_or(WsTokenError::Malformed)?;
    if version != TOKEN_VERSION {
        return Err(WsTokenError::BadVersion);
    }

    let signing_input = format!("{version}.{payload}");
    let mut mac = Hmac::<Sha256>::new_from_slice(&secret()).expect("HMAC key length");
    mac.update(signing_input.as_bytes());
    let expected_sig = mac.finalize().into_bytes();
    let provided_sig = URL_SAFE_NO_PAD.decode(sig).map_err(|_| WsTokenError::Malformed)?;
    if provided_sig.as_slice() != expected_sig.as_slice() {
        return Err(WsTokenError::BadSignature);
    }

    let payload_json = URL_SAFE_NO_PAD.decode(payload).map_err(|_| WsTokenError::Malformed)?;
    let claims: WsTokenClaims =
        serde_json::from_slice(&payload_json).map_err(|_| WsTokenError::Malformed)?;
    if claims.exp_unix_secs <= now_secs() {
        return Err(WsTokenError::Expired);
    }
    Ok(claims)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issue_then_verify_roundtrip() {
        let user = Uuid::new_v4();
        let org = Uuid::new_v4();
        let token = issue(user, org);
        let claims = verify(&token).expect("valid token verifies");
        assert_eq!(claims.user_id, user);
        assert_eq!(claims.organization_id, org);
        assert!(claims.exp_unix_secs > now_secs());
    }

    #[test]
    fn tampered_signature_rejected() {
        let token = issue(Uuid::new_v4(), Uuid::new_v4());
        // Flip the last char of the signature.
        let mut bytes = token.into_bytes();
        let last = bytes.last_mut().unwrap();
        *last = if *last == b'A' { b'B' } else { b'A' };
        let bad = String::from_utf8(bytes).unwrap();
        match verify(&bad) {
            Err(WsTokenError::BadSignature) => {}
            other => panic!("expected BadSignature, got {:?}", other),
        }
    }

    #[test]
    fn malformed_token_rejected() {
        // Three dotted parts, but the payload + sig aren't valid base64u →
        // signature check fires before payload decode.
        match verify("v1.not_a_payload.not_a_signature") {
            Err(WsTokenError::BadSignature) | Err(WsTokenError::Malformed) => {}
            other => panic!("expected BadSignature/Malformed, got {:?}", other),
        }
        // Single token part — no dots → only one section returned by splitn.
        match verify("noformat") {
            Err(WsTokenError::Malformed) => {}
            other => panic!("expected Malformed, got {:?}", other),
        }
    }

    #[test]
    fn wrong_version_rejected() {
        // Hand-craft a token with version v0.
        let claims = WsTokenClaims {
            user_id: Uuid::new_v4(),
            organization_id: Uuid::new_v4(),
            exp_unix_secs: now_secs() + 60,
        };
        let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap());
        let signing_input = format!("v0.{payload}");
        let mut mac = Hmac::<Sha256>::new_from_slice(&secret()).unwrap();
        mac.update(signing_input.as_bytes());
        let sig = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
        let token = format!("{signing_input}.{sig}");
        match verify(&token) {
            Err(WsTokenError::BadVersion) => {}
            other => panic!("expected BadVersion, got {:?}", other),
        }
    }
}

// Created and developed by Jai Singh
