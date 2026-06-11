// Created and developed by Jai Singh
//! Redis HSET/ZSET helpers for the per-org presence map.
//!
//! Schema (one Redis instance, shared across orgs):
//!
//!   `presence:org:{org_id}` — HSET, field = `user_id`, value = JSON
//!     blob (the FE's `PresencePayload` minus `current_page`). The
//!     authoritative "who is online and what is their status" map for
//!     the org. Lives until the evictor removes it (90s after the
//!     last heartbeat) or `untrack_presence` is called explicitly.
//!
//!   `presence:org:{org_id}:expirations` — ZSET, member = `user_id`,
//!     score = `last_seen_unix_ts + 90s`. The evictor uses
//!     `ZRANGEBYSCORE … -inf {now}` to find expired user_ids in O(log N).
//!     Per-field TTL on a Redis HSET isn't natively supported in the
//!     server versions we target, so this sibling ZSET is the cheapest
//!     way to model the expiry channel.
//!
//!   `presence:orgs` — SET of org_ids that have at least one
//!     presence record OR have had one in the recent past. Added on
//!     first `track_presence`, removed lazily by the evictor when an
//!     org's HSET reaches zero entries. The evictor iterates this set
//!     every 30s instead of scanning the full keyspace (KEYS is
//!     forbidden in the OmniFrame ops playbook — too expensive on
//!     prod-sized stores).
//!
//! Why HSET + ZSET + SET (three keys) instead of one fancier
//! structure: each of these primitives is O(log N) at worst, has
//! well-understood operational characteristics, and reads atomically
//! within a single command. A `MULTI/EXEC` wrapper to fold them into
//! a transaction would prevent partial writes but would also serialise
//! every track call through a single Redis cluster node — not worth
//! the cost for an ephemeral state store where 90s of stale data on
//! one user is acceptable.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use bb8::Pool;
use bb8_redis::redis::AsyncCommands;
use bb8_redis::RedisConnectionManager;
use tracing::warn;
use uuid::Uuid;

use crate::observability::metrics;

/// TTL for a presence row in seconds. Set 3× the foreground heartbeat
/// cadence (`DB_HEARTBEAT_INTERVAL = 60s`) so a single missed beat
/// (network blip, JWT refresh) doesn't evict the user. Hidden tabs
/// heartbeat every 5 minutes so they will always be evicted unless the
/// FE crank promotes them — which is the desired UX.
pub const PRESENCE_TTL_SECONDS: u64 = 90;

/// Redis pool alias used by the rest of the module + the route
/// handlers. Keeps the trait bounds local so call sites don't need to
/// know about `bb8` / `bb8_redis` internals.
pub type RedisPool = Pool<RedisConnectionManager>;

fn org_hash_key(org_id: &Uuid) -> String {
    format!("presence:org:{}", org_id)
}

fn org_expirations_key(org_id: &Uuid) -> String {
    format!("presence:org:{}:expirations", org_id)
}

const ORGS_SET_KEY: &str = "presence:orgs";

fn now_unix_ts() -> i64 {
    // Saturating cast: presence works up to year ~292 billion CE.
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Outcome of a `track_presence` call — the route handler uses it to
/// decide whether to broadcast `PresenceJoined` (first time we see
/// this user_id in the HSET this session) or `PresenceUpdated`
/// (subsequent heartbeat).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrackOutcome {
    /// First heartbeat for this `(org_id, user_id)` pair this session.
    Joined,
    /// User was already in the HSET; this updated the payload + bumped
    /// the expiry.
    Updated,
}

/// Track or refresh a presence row.
///
/// Returns `TrackOutcome::Joined` if this user_id was NOT previously
/// in the HSET (so the caller broadcasts `PresenceJoined`), or
/// `TrackOutcome::Updated` if it was (the caller broadcasts
/// `PresenceUpdated`).
///
/// The two-step "HEXISTS then HSET" is intentional — we want to
/// distinguish join from update at the broadcast boundary, and
/// Redis's `HSET` returns `1` for new field / `0` for update which is
/// the same idea but inverted. We keep the explicit HEXISTS step for
/// clarity and so the function reads naturally to a future maintainer.
pub async fn track_presence(
    pool: &RedisPool,
    org_id: Uuid,
    user_id: &str,
    payload: &serde_json::Value,
) -> Result<TrackOutcome, bb8_redis::redis::RedisError> {
    let mut conn = pool.get().await.map_err(redis_pool_err)?;
    let hash_key = org_hash_key(&org_id);
    let exp_key = org_expirations_key(&org_id);
    let expires_at: i64 = now_unix_ts() + PRESENCE_TTL_SECONDS as i64;

    // 1. Decide join vs. update by checking field membership BEFORE
    //    we mutate. A race here is harmless: if another tab in the
    //    same session lands its HSET between our HEXISTS and HSET, we
    //    will broadcast PresenceUpdated when PresenceJoined would have
    //    been more accurate — the FE handler unifies them anyway.
    let existed: bool = conn.hexists(&hash_key, user_id).await?;

    // 2. Write the payload + bump the expiry. Use the JSON string
    //    representation to keep the wire shape inspection-friendly
    //    (`redis-cli HGET ...` returns readable JSON).
    let payload_str = payload.to_string();
    let _: () = conn.hset(&hash_key, user_id, &payload_str).await?;
    let _: () = conn.zadd(&exp_key, user_id, expires_at).await?;
    // 3. Make sure the org is in the iteration set. SADD is idempotent
    //    so re-adding on every track is a tiny cost for the safety of
    //    not missing an org during eviction.
    let _: () = conn.sadd(ORGS_SET_KEY, org_id.to_string()).await?;

    metrics::WORK_PRESENCE_TRACK_TOTAL
        .with_label_values(&["track"])
        .inc();

    Ok(if existed {
        TrackOutcome::Updated
    } else {
        TrackOutcome::Joined
    })
}

/// Remove a presence row (explicit "Appear Offline" / sign-out).
///
/// Returns `true` if the row actually existed (the caller broadcasts
/// `PresenceLeft` only in that case so we don't fan out a `Left` event
/// for someone who was already gone).
pub async fn untrack_presence(
    pool: &RedisPool,
    org_id: Uuid,
    user_id: &str,
) -> Result<bool, bb8_redis::redis::RedisError> {
    let mut conn = pool.get().await.map_err(redis_pool_err)?;
    let hash_key = org_hash_key(&org_id);
    let exp_key = org_expirations_key(&org_id);

    // HDEL returns the count of fields removed (0 or 1 here).
    let removed: i64 = conn.hdel(&hash_key, user_id).await?;
    let _: () = conn.zrem(&exp_key, user_id).await?;

    if removed > 0 {
        metrics::WORK_PRESENCE_TRACK_TOTAL
            .with_label_values(&["untrack"])
            .inc();
    }

    Ok(removed > 0)
}

/// Snapshot the current org-wide presence map. Used by the bootstrap
/// `GET /api/v1/presence/online` endpoint that new tabs call before the
/// WS catches up.
///
/// Returns `(user_id → PresencePayload-as-JSON)`. Deserialisation is
/// the caller's job; we return the raw JSON so callers that just want
/// to forward the blob can avoid a round-trip through `PresencePayload`.
pub async fn get_org_presence(
    pool: &RedisPool,
    org_id: Uuid,
) -> Result<HashMap<String, serde_json::Value>, bb8_redis::redis::RedisError> {
    let mut conn = pool.get().await.map_err(redis_pool_err)?;
    let hash_key = org_hash_key(&org_id);

    let raw: HashMap<String, String> = conn.hgetall(&hash_key).await?;

    let mut out: HashMap<String, serde_json::Value> = HashMap::with_capacity(raw.len());
    for (uid, json_str) in raw {
        match serde_json::from_str::<serde_json::Value>(&json_str) {
            Ok(v) => {
                out.insert(uid, v);
            }
            Err(e) => {
                // Don't fail the whole snapshot for one bad row — the
                // legitimate use case is that a future schema change
                // can leave a single row unreadable. The evictor will
                // sweep these on its next pass anyway.
                warn!(
                    user_id = %uid,
                    org_id = %org_id,
                    error = ?e,
                    "presence::get_org_presence: skipping malformed row"
                );
            }
        }
    }

    Ok(out)
}

/// Remove all presence rows whose `expires_at` is in the past.
///
/// Returns the list of evicted `user_id`s so the caller (the evictor
/// task) can broadcast a `PresenceLeft` event for each. The evictor is
/// the only normal caller; route handlers don't run eviction inline so
/// we don't pay the ZRANGEBYSCORE cost on hot paths.
pub async fn evict_expired(
    pool: &RedisPool,
    org_id: Uuid,
) -> Result<Vec<String>, bb8_redis::redis::RedisError> {
    let mut conn = pool.get().await.map_err(redis_pool_err)?;
    let hash_key = org_hash_key(&org_id);
    let exp_key = org_expirations_key(&org_id);
    let now = now_unix_ts();

    // Find all user_ids whose expiration is at or before "now".
    // Returns Vec<String>; an empty result is the steady state for an
    // org with active heartbeats.
    let expired: Vec<String> = conn
        .zrangebyscore(&exp_key, "-inf", now.to_string())
        .await?;

    if expired.is_empty() {
        return Ok(vec![]);
    }

    // Bulk-delete from both keys. We could MULTI/EXEC for atomicity,
    // but a partial-failure window of a few ms doesn't matter — the
    // next eviction pass cleans up either way.
    for uid in &expired {
        let _: () = conn.hdel(&hash_key, uid).await?;
        let _: () = conn.zrem(&exp_key, uid).await?;
    }

    metrics::WORK_PRESENCE_TRACK_TOTAL
        .with_label_values(&["evict"])
        .inc_by(expired.len() as u64);

    Ok(expired)
}

/// Snapshot the cardinality of the per-org HSET. Cheap (`HLEN` is O(1))
/// and sampled by the evictor so the `work_presence_active_users`
/// gauge tracks the post-eviction truth.
pub async fn count_org_presence(
    pool: &RedisPool,
    org_id: Uuid,
) -> Result<i64, bb8_redis::redis::RedisError> {
    let mut conn = pool.get().await.map_err(redis_pool_err)?;
    let hash_key = org_hash_key(&org_id);
    let len: i64 = conn.hlen(&hash_key).await?;
    Ok(len)
}

/// Fetch the iteration set of orgs the evictor needs to scan. The set
/// is grown by `track_presence`; if a row count for an org reaches
/// zero we drop it from the set lazily so the evictor doesn't
/// re-iterate empty orgs forever.
pub async fn list_known_orgs(
    pool: &RedisPool,
) -> Result<Vec<Uuid>, bb8_redis::redis::RedisError> {
    let mut conn = pool.get().await.map_err(redis_pool_err)?;
    let raw: Vec<String> = conn.smembers(ORGS_SET_KEY).await?;
    let mut out = Vec::with_capacity(raw.len());
    for s in raw {
        match Uuid::parse_str(&s) {
            Ok(u) => out.push(u),
            Err(e) => {
                warn!(
                    raw = %s,
                    error = ?e,
                    "presence::list_known_orgs: skipping non-UUID entry"
                );
            }
        }
    }
    Ok(out)
}

/// Drop an org from the iteration set when its HSET reaches zero
/// entries. Idempotent; re-tracking will SADD it back.
pub async fn forget_org(
    pool: &RedisPool,
    org_id: Uuid,
) -> Result<(), bb8_redis::redis::RedisError> {
    let mut conn = pool.get().await.map_err(redis_pool_err)?;
    let _: () = conn.srem(ORGS_SET_KEY, org_id.to_string()).await?;
    Ok(())
}

/// Convert a bb8 pool acquisition error into a `RedisError`. The
/// `bb8::RunError` variant we care about is `User(RedisError)` which
/// wraps the underlying Redis client error. We could box this through
/// `anyhow` but keeping a `RedisError` return makes it easy to fold
/// into the error counter without a downcast.
fn redis_pool_err(e: bb8::RunError<bb8_redis::redis::RedisError>) -> bb8_redis::redis::RedisError {
    metrics::WORK_PRESENCE_REDIS_ERRORS_TOTAL.inc();
    match e {
        bb8::RunError::User(re) => re,
        bb8::RunError::TimedOut => bb8_redis::redis::RedisError::from(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "redis pool acquire timeout",
        )),
    }
}

// Created and developed by Jai Singh
