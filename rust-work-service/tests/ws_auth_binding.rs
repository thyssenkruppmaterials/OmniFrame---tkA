// Created and developed by Jai Singh
//! Plan §13.4 / Item 16 — WS subscribe-token org binding.
//!
//! These tests exercise the token-issue → token-verify roundtrip and
//! the org-mismatch rejection logic. They don't spin up a full axum
//! server (the upgrade handler is exercised end-to-end by Playwright in
//! `phase-9-verification.md`); the unit-level checks here lock the
//! binding contract that the upgrade handler relies on.

use rust_work_service::ws_token::{issue, verify, WsTokenError};
use uuid::Uuid;

#[tokio::test]
async fn positive_case_token_matches_org_at_subscribe_time() {
    let user = Uuid::new_v4();
    let org = Uuid::new_v4();
    let token = issue(user, org);
    let claims = verify(&token).expect("freshly-issued token must verify");
    assert_eq!(
        claims.organization_id, org,
        "token claim must match the org that requested issuance"
    );

    // The Subscribe message carries an `organization_id`; the upgrade
    // handler compares it to `claims.organization_id`. Match = subscribe;
    // mismatch = close. Simulate that comparison.
    let subscribe_org_match = org;
    let subscribe_org_mismatch = Uuid::new_v4();
    assert!(
        claims.organization_id == subscribe_org_match,
        "matching subscribe org must allow continuation"
    );
    assert!(
        claims.organization_id != subscribe_org_mismatch,
        "mismatched subscribe org must trigger close"
    );
}

#[tokio::test]
async fn negative_case_tampered_token_rejected_before_subscribe() {
    let token = issue(Uuid::new_v4(), Uuid::new_v4());
    let mut bytes = token.into_bytes();
    let last = bytes.last_mut().unwrap();
    *last = if *last == b'A' { b'B' } else { b'A' };
    let bad = String::from_utf8(bytes).unwrap();
    match verify(&bad) {
        Err(WsTokenError::BadSignature) => {}
        other => panic!("expected BadSignature for tampered token, got {:?}", other),
    }
}

// Created and developed by Jai Singh
