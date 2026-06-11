// Created and developed by Jai Singh
//! Redis HSET/ZSET helpers for the per-entity focus map.
//!
//! Schema (one Redis instance, shared across orgs):
//!
//!   `presence:focus:{org_id}:{entity_kind}:{entity_id}` — HSET,
//!     field = `user_id`, value = JSON blob (`{user_id, started_at}`).
//!     The authoritative "who is focused on this entity" map.
//!
//!   `presence:focus:{org_id}:expirations` — ZSET, member =
//!     `{entity_kind}|{entity_id}|{user_id}`, score =
//!     `last_seen_unix_ts + 30s`. The evictor uses
//!     `ZRANGEBYSCORE … -inf {now}` to find expired leases in
//!     O(log N). Per-field TTL on a Redis HSET isn't natively
//!     supported in the server versions we target, so this sibling
//!     ZSET is the cheapest way to model expiry.
//!
//!   `presence:focus:orgs` — SET of org_ids with at least one
//!     active focus lease. Added on first heartbeat, removed lazily
//!     by the evictor when the org's expiration ZSET reaches zero
//!     entries. Iteration source for the evictor (KEYS is
//!     forbidden in the OmniFrame ops playbook).

use std::time::{SystemTime, UNIX_EPOCH};

use bb8::Pool;
use bb8_redis::redis::AsyncCommands;
use bb8_redis::RedisConnectionManager;
use serde::{Deserialize, Serialize};
use tracing::warn;
use uuid::Uuid;

use crate::observability::metrics;

/// TTL for a focus lease in seconds. Half of presence's 90s because
/// focus leases are short-lived — a user typically stops "focusing"
/// the moment they navigate away or the row deselects. The FE
/// heartbeats every 15s (half of TTL — same safety-margin pattern
/// presence uses with its 30s heartbeat / 90s TTL).
pub const FOCUS_TTL_SECONDS: u64 = 30;

/// Redis pool alias mirrors `presence::redis::RedisPool` so call
/// sites stay symmetrical.
pub type RedisPool = Pool<RedisConnectionManager>;

const ORGS_SET_KEY: &str = "presence:focus:orgs";

fn entity_hash_key(org_id: &Uuid, entity_kind: &str, entity_id: &str) -> String {
    format!(
        "presence:focus:{}:{}:{}",
        org_id, entity_kind, entity_id
    )
}

fn org_expirations_key(org_id: &Uuid) -> String {
    format!("presence:focus:{}:expirations", org_id)
}

/// Compose the ZSET member that encodes `(entity_kind, entity_id,
/// user_id)` into a single string. Pipe-delimited because none of
/// the components legitimately contain a pipe character (we'd
/// otherwise have to consider escaping).
fn expiration_member(entity_kind: &str, entity_id: &str, user_id: &Uuid) -> String {
    format!("{}|{}|{}", entity_kind, entity_id, user_id)
}

/// Inverse of `expiration_member`. Returns `None` when the encoded
/// string is malformed; caller logs and skips.
fn parse_expiration_member(s: &str) -> Option<ExpiredFocus> {
    let mut parts = s.splitn(3, '|');
    let entity_kind = parts.next()?.to_string();
    let entity_id = parts.next()?.to_string();
    let user_id = Uuid::parse_str(parts.next()?).ok()?;
    Some(ExpiredFocus {
        entity_kind,
        entity_id,
        user_id,
    })
}

fn now_unix_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Outcome of a `track_focus` call — the route handler uses it to
/// decide whether to broadcast `EntityFocus { action: "enter" }`
/// (first heartbeat for this user on this entity) or
/// `EntityFocus { action: "heartbeat" }` (refresh).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusOutcome {
    Entered,
    Refreshed,
}

/// One entry in the HSET — a user's focus lease metadata. Stored as
/// a JSON blob so future fields (e.g. cursor position, edit-mode
/// flag) land without a Redis schema change.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusEntry {
    pub user_id: Uuid,
    /// Unix timestamp (seconds) of when this user first started
    /// focusing this entity in their current session.
    pub started_at: i64,
}

/// Result row of the focus-users-on-entity query. Returned by
/// `get_focus_users` for the bootstrap REST endpoint.
#[derive(Debug, Clone, Serialize)]
pub struct FocusUserPublic {
    pub user_id: Uuid,
    pub started_at: i64,
}

/// Tuple decoded from an expired ZSET entry. The evictor needs all
/// three to broadcast a meaningful `EntityFocus { action: "leave" }`.
#[derive(Debug, Clone)]
pub struct ExpiredFocus {
    pub entity_kind: String,
    pub entity_id: String,
    pub user_id: Uuid,
}

/// Track or refresh a focus lease.
///
/// Returns `FocusOutcome::Entered` if this user_id was NOT previously
/// in the entity's HSET (so the caller broadcasts
/// `EntityFocus { action: "enter" }`), or `FocusOutcome::Refreshed`
/// if it was (the caller broadcasts `EntityFocus { action: "heartbeat" }`).
pub async fn track_focus(
    pool: &RedisPool,
    org_id: Uuid,
    entity_kind: &str,
    entity_id: &str,
    user_id: Uuid,
) -> Result<FocusOutcome, bb8_redis::redis::RedisError> {
    let mut conn = pool.get().await.map_err(redis_pool_err)?;
    let hash_key = entity_hash_key(&org_id, entity_kind, entity_id);
    let exp_key = org_expirations_key(&org_id);
    let now = now_unix_ts();
    let expires_at: i64 = now + FOCUS_TTL_SECONDS as i64;
    let user_field = user_id.to_string();

    // 1. Decide enter vs. refresh by checking field membership BEFORE
    //    we mutate. Same race tolerance as `presence::track_presence`:
    //    if a sibling tab beats us between HEXISTS and HSET, we
    //    broadcast `heartbeat` instead of `enter` — the FE handler
    //    treats both as "this user is currently focused" so the UX
    //    is unchanged.
    let existed: bool = conn.hexists(&hash_key, &user_field).await?;

    // Preserve the original `started_at` on refresh so the FE can
    // show "editing for 2m" without having to re-derive on the
    // client. On first enter, started_at = now.
    let started_at = if existed {
        match conn.hget::<_, _, Option<String>>(&hash_key, &user_field).await? {
            Some(json_str) => serde_json::from_str::<FocusEntry>(&json_str)
                .map(|e| e.started_at)
                .unwrap_or(now),
            None => now,
        }
    } else {
        now
    };

    let entry = FocusEntry {
        user_id,
        started_at,
    };
    let payload_str = serde_json::to_string(&entry).unwrap_or_default();

    let _: () = conn.hset(&hash_key, &user_field, &payload_str).await?;
    let _: () = conn
        .zadd(
            &exp_key,
            expiration_member(entity_kind, entity_id, &user_id),
            expires_at,
        )
        .await?;
    let _: () = conn.sadd(ORGS_SET_KEY, org_id.to_string()).await?;

    metrics::WORK_ENTITY_FOCUS_TOTAL
        .with_label_values(&["track"])
        .inc();

    Ok(if existed {
        FocusOutcome::Refreshed
    } else {
        FocusOutcome::Entered
    })
}

/// Remove a focus lease (explicit DELETE on row deselect / dialog
/// close).
///
/// Returns `true` if the row actually existed (the caller broadcasts
/// `EntityFocus { action: "leave" }` only in that case so we don't
/// fan out a leave event for a lease that wasn't there).
pub async fn untrack_focus(
    pool: &RedisPool,
    org_id: Uuid,
    entity_kind: &str,
    entity_id: &str,
    user_id: Uuid,
) -> Result<bool, bb8_redis::redis::RedisError> {
    let mut conn = pool.get().await.map_err(redis_pool_err)?;
    let hash_key = entity_hash_key(&org_id, entity_kind, entity_id);
    let exp_key = org_expirations_key(&org_id);
    let user_field = user_id.to_string();

    let removed: i64 = conn.hdel(&hash_key, &user_field).await?;
    let _: () = conn
        .zrem(
            &exp_key,
            expiration_member(entity_kind, entity_id, &user_id),
        )
        .await?;

    if removed > 0 {
        metrics::WORK_ENTITY_FOCUS_TOTAL
            .with_label_values(&["untrack"])
            .inc();
    }

    Ok(removed > 0)
}

/// Snapshot the current set of users focused on `(entity_kind,
/// entity_id)`. Used by the bootstrap REST endpoint
/// `GET /api/v1/entity-focus/users` so a late-joining tab sees the
/// existing pill state immediately, before WS events catch up.
pub async fn get_focus_users(
    pool: &RedisPool,
    org_id: Uuid,
    entity_kind: &str,
    entity_id: &str,
) -> Result<Vec<FocusUserPublic>, bb8_redis::redis::RedisError> {
    let mut conn = pool.get().await.map_err(redis_pool_err)?;
    let hash_key = entity_hash_key(&org_id, entity_kind, entity_id);

    let raw: std::collections::HashMap<String, String> = conn.hgetall(&hash_key).await?;

    let mut out: Vec<FocusUserPublic> = Vec::with_capacity(raw.len());
    for (uid, json_str) in raw {
        match serde_json::from_str::<FocusEntry>(&json_str) {
            Ok(e) => out.push(FocusUserPublic {
                user_id: e.user_id,
                started_at: e.started_at,
            }),
            Err(err) => {
                warn!(
                    user_id = %uid,
                    org_id = %org_id,
                    error = ?err,
                    "entity_focus::get_focus_users: skipping malformed row"
                );
            }
        }
    }

    out.sort_by(|a, b| a.started_at.cmp(&b.started_at));
    Ok(out)
}

/// Remove all focus leases for an org whose `expires_at` is in the
/// past. Returns the list of `ExpiredFocus` tuples so the evictor
/// can broadcast `EntityFocus { action: "leave" }` for each.
pub async fn evict_expired(
    pool: &RedisPool,
    org_id: Uuid,
) -> Result<Vec<ExpiredFocus>, bb8_redis::redis::RedisError> {
    let mut conn = pool.get().await.map_err(redis_pool_err)?;
    let exp_key = org_expirations_key(&org_id);
    let now = now_unix_ts();

    let expired: Vec<String> = conn
        .zrangebyscore(&exp_key, "-inf", now.to_string())
        .await?;

    if expired.is_empty() {
        return Ok(vec![]);
    }

    let mut out: Vec<ExpiredFocus> = Vec::with_capacity(expired.len());
    for raw_member in expired {
        let parsed = match parse_expiration_member(&raw_member) {
            Some(p) => p,
            None => {
                // Malformed entry — drop it from the ZSET so we don't
                // re-process it forever. We don't have an HSET key
                // to clean up since we couldn't parse the entity_kind
                // / entity_id components.
                let _: () = conn.zrem(&exp_key, &raw_member).await?;
                warn!(
                    raw = %raw_member,
                    org_id = %org_id,
                    "entity_focus::evict_expired: malformed expiration member, dropped"
                );
                continue;
            }
        };

        // Bulk-delete from both keys. A partial-failure window of a
        // few ms doesn't matter — the next eviction pass cleans up.
        let hash_key = entity_hash_key(&org_id, &parsed.entity_kind, &parsed.entity_id);
        let _: () = conn.hdel(&hash_key, parsed.user_id.to_string()).await?;
        let _: () = conn.zrem(&exp_key, &raw_member).await?;
        out.push(parsed);
    }

    if !out.is_empty() {
        metrics::WORK_ENTITY_FOCUS_TOTAL
            .with_label_values(&["evict"])
            .inc_by(out.len() as u64);
    }

    Ok(out)
}

/// Snapshot the cardinality of the per-org expirations ZSET. Cheap
/// (`ZCARD` is O(1)). Sampled by the evictor each tick so the
/// `work_entity_focus_active` gauge tracks the post-eviction truth.
pub async fn count_org_focus(
    pool: &RedisPool,
    org_id: Uuid,
) -> Result<i64, bb8_redis::redis::RedisError> {
    let mut conn = pool.get().await.map_err(redis_pool_err)?;
    let exp_key = org_expirations_key(&org_id);
    let len: i64 = conn.zcard(&exp_key).await?;
    Ok(len)
}

/// Fetch the iteration set of orgs the evictor needs to scan.
pub async fn list_known_orgs(
    pool: &RedisPool,
) -> Result<Vec<Uuid>, bb8_redis::redis::RedisError> {
    let mut conn = pool.get().await.map_err(redis_pool_err)?;
    let raw: Vec<String> = conn.smembers(ORGS_SET_KEY).await?;
    let mut out = Vec::with_capacity(raw.len());
    for s in raw {
        match Uuid::parse_str(&s) {
            Ok(u) => out.push(u),
            Err(e) => warn!(
                raw = %s,
                error = ?e,
                "entity_focus::list_known_orgs: skipping non-UUID entry"
            ),
        }
    }
    Ok(out)
}

/// Drop an org from the iteration set when its expirations ZSET
/// reaches zero entries. Idempotent.
pub async fn forget_org(
    pool: &RedisPool,
    org_id: Uuid,
) -> Result<(), bb8_redis::redis::RedisError> {
    let mut conn = pool.get().await.map_err(redis_pool_err)?;
    let _: () = conn.srem(ORGS_SET_KEY, org_id.to_string()).await?;
    Ok(())
}

/// Convert a bb8 pool acquisition error into a `RedisError`. Same
/// shape as `presence::redis::redis_pool_err` but increments our
/// own error counter so the metric attribution stays clean.
fn redis_pool_err(e: bb8::RunError<bb8_redis::redis::RedisError>) -> bb8_redis::redis::RedisError {
    metrics::WORK_ENTITY_FOCUS_REDIS_ERRORS_TOTAL.inc();
    match e {
        bb8::RunError::User(re) => re,
        bb8::RunError::TimedOut => bb8_redis::redis::RedisError::from(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "redis pool acquire timeout",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expiration_member_round_trips() {
        let uid = Uuid::nil();
        let m = expiration_member("ticket", "42", &uid);
        let parsed = parse_expiration_member(&m).expect("parse");
        assert_eq!(parsed.entity_kind, "ticket");
        assert_eq!(parsed.entity_id, "42");
        assert_eq!(parsed.user_id, uid);
    }

    #[test]
    fn expiration_member_handles_entity_id_with_dashes() {
        // entity_ids may legitimately contain dashes (UUIDs do), but
        // not pipes — so the splitn(3) decoding stays unambiguous.
        let uid = Uuid::nil();
        let m = expiration_member("work_task", "550e8400-e29b-41d4-a716-446655440000", &uid);
        let parsed = parse_expiration_member(&m).expect("parse");
        assert_eq!(parsed.entity_id, "550e8400-e29b-41d4-a716-446655440000");
    }

    #[test]
    fn parse_expiration_member_rejects_malformed() {
        assert!(parse_expiration_member("only_one_segment").is_none());
        assert!(parse_expiration_member("two|segments").is_none());
        assert!(parse_expiration_member("kind|id|not-a-uuid").is_none());
    }
}

// Created and developed by Jai Singh
