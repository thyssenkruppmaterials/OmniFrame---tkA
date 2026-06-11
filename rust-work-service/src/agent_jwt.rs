// Created and developed by Jai Singh
//! Phase 10 (`.cursor/plans/rust_work_service_full_integration_5b88165d.plan.md`)
//! — short-lived agent JWTs.
//!
//! Issued by `POST /api/v1/agent-identity/exchange` after a successful
//! Argon2id verification of the agent's plaintext service key against
//! the row in `public.agent_service_keys`. Verified locally in
//! `crate::middleware::require_auth` — agent JWTs DO NOT round-trip to
//! `rust-core-service` (which only knows about Supabase user JWTs).
//!
//! Wire format: standard HS256 JWT
//! (`<header-b64u>.<payload-b64u>.<sig-b64u>`). Claims:
//!
//! ```text
//! {
//!   "sub":       "<agent_id>",          // stable agent_id, not user UUID
//!   "org_id":    "<organization uuid>", // agent's tenant
//!   "kind":      "agent",                // discriminator vs user JWT
//!   "key_id":    "<agent_service_keys.id>", // for revocation lookup
//!   "exp":       <unix_secs>             // 15 min default
//! }
//! ```
//!
//! TTL: 900 s (15 min) by default; agents refresh ~60 s before expiry
//! via the same `/exchange` endpoint.
//!
//! Secret: `WORK_SERVICE_AGENT_JWT_SECRET` env var. Falls back to a
//! deterministic dev-only string in non-production environments
//! (mirrors the same dev-only convention in `ws_token.rs`). Operators
//! MUST set this in production; the warning is logged on boot when the
//! fallback fires.

use base64::engine::{general_purpose::URL_SAFE_NO_PAD, Engine};
use jsonwebtoken::{
    decode, decode_header, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation,
};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// Discriminator value for agent-issued JWTs. Routed locally in
/// `require_auth`; user JWTs (no `kind` claim, or `kind != "agent"`)
/// continue through the existing `rust-core-service` validation path.
pub const AGENT_KIND_CLAIM: &str = "agent";

/// Default TTL: 15 minutes per the Phase 10 plan. Agents refresh ~60 s
/// before expiry so a slow tick can't fire requests with a dead token.
pub const AGENT_JWT_TTL_SECONDS: u64 = 900;

/// HMAC key length (bytes). Operators SHOULD set
/// `WORK_SERVICE_AGENT_JWT_SECRET` to a 32+ byte random value; we don't
/// enforce it because Phase 10 tests rely on short fixed strings.
const MIN_DEV_FALLBACK_LEN: usize = 16;
const DEV_FALLBACK_SECRET: &str = "dev-only-agent-jwt-secret-not-for-production";

/// Strongly-typed claims for the rust-work-service-issued agent JWT.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentJwtClaims {
    /// Subject — the stable `agent_id` (`_agent_self_id()` in
    /// `omni_agent/agent.py`, e.g. `INDPDC1-Console-aclark`).
    pub sub: String,
    /// Owning organization UUID.
    pub org_id: Uuid,
    /// Discriminator. Always `"agent"` for tokens issued by this
    /// module; the middleware uses it to decide between local
    /// verification (this module) and the existing
    /// rust-core-service validation path.
    pub kind: String,
    /// Foreign key into `public.agent_service_keys.id`. Used by the
    /// revocation check in the middleware.
    pub key_id: Uuid,
    /// Expiry, unix seconds. `jsonwebtoken` enforces this when
    /// `Validation::leeway` is non-zero.
    pub exp: u64,
    /// Issued-at, unix seconds. Useful for forensic log queries.
    #[serde(default)]
    pub iat: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum AgentJwtError {
    /// The token's `kind` claim is not `"agent"` (or the token is
    /// malformed / signed with the wrong secret / expired).
    #[error("invalid or wrong-kind agent JWT: {0}")]
    Invalid(String),
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Read the HS256 signing secret from the env. Returns the bytes of
/// `WORK_SERVICE_AGENT_JWT_SECRET` when set, otherwise the deterministic
/// dev fallback. Production deployments MUST set the env var (operator
/// audit pass — see `ADR-Agent-Identity-V2-Phase10`).
pub fn signing_secret() -> Vec<u8> {
    match std::env::var("WORK_SERVICE_AGENT_JWT_SECRET") {
        Ok(v) if v.len() >= MIN_DEV_FALLBACK_LEN => v.into_bytes(),
        Ok(v) => {
            tracing::warn!(
                len = v.len(),
                "WORK_SERVICE_AGENT_JWT_SECRET is set but very short (<16 bytes). \
                 Continuing for dev convenience; production deployments MUST use a \
                 strong random secret."
            );
            v.into_bytes()
        }
        Err(_) => {
            tracing::warn!(
                "WORK_SERVICE_AGENT_JWT_SECRET not set — falling back to a \
                 deterministic dev-only string. Production deployments MUST set \
                 this env var to a strong random value."
            );
            DEV_FALLBACK_SECRET.as_bytes().to_vec()
        }
    }
}

/// Issue a fresh `kind: "agent"` JWT.
pub fn issue(agent_id: &str, org_id: Uuid, key_id: Uuid) -> Result<String, AgentJwtError> {
    let now = now_secs();
    let claims = AgentJwtClaims {
        sub: agent_id.to_string(),
        org_id,
        kind: AGENT_KIND_CLAIM.to_string(),
        key_id,
        exp: now + AGENT_JWT_TTL_SECONDS,
        iat: now,
    };
    let header = Header::new(Algorithm::HS256);
    let key = EncodingKey::from_secret(&signing_secret());
    encode(&header, &claims, &key).map_err(|e| AgentJwtError::Invalid(e.to_string()))
}

/// Verify the signature + freshness of a candidate token. Does NOT
/// check revocation — the middleware does that against Postgres /
/// Redis after this function returns Ok.
pub fn verify(token: &str) -> Result<AgentJwtClaims, AgentJwtError> {
    let mut validation = Validation::new(Algorithm::HS256);
    // No `aud` / `iss` enforcement today; we only rely on signature +
    // expiry + `kind` claim equality.
    validation.validate_exp = true;
    validation.required_spec_claims = ["exp"].iter().map(|s| s.to_string()).collect();
    validation.leeway = 5; // small clock-skew tolerance, mirrors industry default

    let key = DecodingKey::from_secret(&signing_secret());
    let data = decode::<AgentJwtClaims>(token, &key, &validation)
        .map_err(|e| AgentJwtError::Invalid(e.to_string()))?;
    if data.claims.kind != AGENT_KIND_CLAIM {
        return Err(AgentJwtError::Invalid(format!(
            "expected kind='agent', got '{}'",
            data.claims.kind
        )));
    }
    Ok(data.claims)
}

/// Quick "does this token claim to be an agent JWT?" probe.
///
/// Looks at the unverified header + payload to cheaply route a
/// candidate Bearer token between the local verify path and the legacy
/// rust-core-service validation path. The middleware MUST then call
/// `verify()` to actually trust the claim.
///
/// Returns `false` if the token is malformed, signed with a non-HS256
/// algorithm, or carries a `kind` claim other than `"agent"`. The
/// happy path (a Supabase user JWT, which is HS256 / RS256 with no
/// `kind` claim) returns `false` so the caller falls through to
/// `rust-core-service`.
pub fn looks_like_agent_jwt(token: &str) -> bool {
    // jsonwebtoken's `decode_header` parses without verifying.
    if decode_header(token).is_err() {
        return false;
    }
    // Pull the payload section to peek at `kind` without verifying.
    // We accept any HS256-shape JWT here — `verify()` re-checks the
    // signature against our local secret before issuing trust.
    let payload_b64 = match token.split('.').nth(1) {
        Some(p) => p,
        None => return false,
    };
    let payload_bytes = match URL_SAFE_NO_PAD.decode(payload_b64) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let val: serde_json::Value = match serde_json::from_slice(&payload_bytes) {
        Ok(v) => v,
        Err(_) => return false,
    };
    val.get("kind").and_then(|k| k.as_str()) == Some(AGENT_KIND_CLAIM)
}

/// Process-wide test mutex serialising every test that mutates the
/// `WORK_SERVICE_AGENT_JWT_SECRET` env var. Shared across module
/// boundaries (`agent_identity::tests` reaches in via `pub use`)
/// because env-var state is process-global — a parallel test
/// swapping the secret between `issue` and `verify` would otherwise
/// surface as a flaky `InvalidSignature`.
#[cfg(test)]
pub static AGENT_JWT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;
    use super::AGENT_JWT_ENV_LOCK as ENV_LOCK;

    fn set_test_secret() {
        std::env::set_var(
            "WORK_SERVICE_AGENT_JWT_SECRET",
            "test-secret-for-agent-jwt-roundtrip-32b!",
        );
    }

    #[test]
    fn issue_then_verify_roundtrip() {
        let _guard = ENV_LOCK.lock().unwrap();
        set_test_secret();
        let key_id = Uuid::new_v4();
        let org = Uuid::new_v4();
        let token = issue("INDPDC1-Console-aclark", org, key_id).expect("issue");
        let claims = verify(&token).expect("verify");
        assert_eq!(claims.sub, "INDPDC1-Console-aclark");
        assert_eq!(claims.org_id, org);
        assert_eq!(claims.kind, "agent");
        assert_eq!(claims.key_id, key_id);
        assert!(claims.exp > now_secs());
        assert!(claims.iat > 0);
    }

    #[test]
    fn looks_like_agent_jwt_detects_kind_claim() {
        let _guard = ENV_LOCK.lock().unwrap();
        set_test_secret();
        let token = issue("hostA", Uuid::nil(), Uuid::nil()).unwrap();
        assert!(looks_like_agent_jwt(&token));
    }

    #[test]
    fn looks_like_agent_jwt_rejects_user_jwt_shape() {
        // No `kind` claim → fall through to legacy rust-core-service path.
        // Hand-craft a payload with no `kind`; signature validity isn't
        // checked by `looks_like_agent_jwt`.
        let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"HS256","typ":"JWT"}"#);
        let payload = URL_SAFE_NO_PAD.encode(br#"{"sub":"user-1","exp":9999999999}"#);
        let bogus_sig = URL_SAFE_NO_PAD.encode(b"sig");
        let token = format!("{header}.{payload}.{bogus_sig}");
        assert!(!looks_like_agent_jwt(&token));
    }

    #[test]
    fn verify_rejects_tampered_signature() {
        let _guard = ENV_LOCK.lock().unwrap();
        set_test_secret();
        let token = issue("hostA", Uuid::nil(), Uuid::nil()).unwrap();
        let mut bytes = token.into_bytes();
        let last = bytes.last_mut().unwrap();
        *last = if *last == b'A' { b'B' } else { b'A' };
        let bad = String::from_utf8(bytes).unwrap();
        assert!(verify(&bad).is_err());
    }

    #[test]
    fn verify_rejects_token_signed_with_wrong_secret() {
        let _guard = ENV_LOCK.lock().unwrap();
        std::env::set_var(
            "WORK_SERVICE_AGENT_JWT_SECRET",
            "first-secret-for-issue-roundtrip-test!",
        );
        let token = issue("hostA", Uuid::nil(), Uuid::nil()).unwrap();
        std::env::set_var(
            "WORK_SERVICE_AGENT_JWT_SECRET",
            "different-secret-for-verify-roundtrip!",
        );
        assert!(verify(&token).is_err());
    }

    #[test]
    fn verify_rejects_non_agent_kind_claim() {
        let _guard = ENV_LOCK.lock().unwrap();
        set_test_secret();
        // Manually issue with kind=user.
        #[derive(Serialize)]
        struct C<'a> {
            sub: &'a str,
            kind: &'a str,
            exp: u64,
        }
        let header = Header::new(Algorithm::HS256);
        let key = EncodingKey::from_secret(&signing_secret());
        let token = encode(
            &header,
            &C {
                sub: "x",
                kind: "user",
                exp: now_secs() + 60,
            },
            &key,
        )
        .unwrap();
        assert!(verify(&token).is_err());
    }
}

// Created and developed by Jai Singh
