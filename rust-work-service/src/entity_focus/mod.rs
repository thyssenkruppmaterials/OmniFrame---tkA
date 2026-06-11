// Created and developed by Jai Singh
//! Tier 2 #1 (2026-05-06) — entity-focus soft-locking subsystem.
//!
//! Sibling subsystem to `crate::presence` (Option 2 / ADR-Presence-Architecture-Next-Steps).
//! The presence module tracks "who is online in the org"; this module
//! tracks "who is editing this row right now" — a much shorter-lived
//! lease keyed by `(entity_kind, entity_id)`.
//!
//! Schema (mirrors the presence shape but on a separate Redis prefix):
//!
//!   `presence:focus:{org_id}:{entity_kind}:{entity_id}` — HSET
//!     field=user_id, value=JSON {user_id, started_at}. The
//!     authoritative "who is focused on this row" map.
//!
//!   `presence:focus:{org_id}:expirations` — ZSET
//!     member=`{entity_kind}|{entity_id}|{user_id}`,
//!     score=`last_seen_unix_ts + 30s`. The evictor scans this in
//!     O(log N) per tick to find expired focus leases.
//!
//!   `presence:focus:orgs` — SET of org_ids that have at least one
//!     active focus lease. Lazy iteration source for the evictor.
//!
//! Why a separate prefix from presence's keys: focus leases have a
//! 30s TTL (vs presence's 90s) because focus is short-lived — a user
//! typically stops "focusing" the moment they navigate away or the
//! row deselects. Mixing them on the same ZSET would force a single
//! TTL choice. Two prefixes also means a `presence:*` flush
//! command operationally targets one or the other deliberately.
//!
//! Coordination notes for Worker 1 (presence subsystem owner):
//!
//!   - We share the same Redis pool but no keys. Reads/writes are
//!     entirely independent.
//!   - We share the SAME 30s evictor cadence — but each subsystem
//!     runs its OWN tokio task to keep failure domains isolated.
//!     A Redis hiccup that breaks our evictor doesn't stall theirs.
//!     If consolidation is desired later, the two evictors are small
//!     enough that a single combined task is trivial.
//!
//! See:
//!   - `redis.rs` — HSET / ZSET / SET helpers (the schema lives there)
//!   - `evictor.rs` — the 30s sweeper task that fans out
//!     `EntityFocus { action: "leave" }` for expired leases
//!   - `crate::api::routes::entity_focus` — the three REST endpoints
//!     (`POST /heartbeat`, `DELETE /`, `GET /users`)

pub mod evictor;
pub mod redis;

// Created and developed by Jai Singh
