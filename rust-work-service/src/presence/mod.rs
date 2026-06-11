// Created and developed by Jai Singh
//! Server-side presence subsystem (Option 2 from
//! `memorybank/OmniFrame/Decisions/ADR-Presence-Architecture-Next-Steps.md`).
//!
//! Replaces the org-wide Supabase Realtime Presence channel
//! (`presence-org-{org_id}`) with a Redis-backed per-org HSET that
//! `rust-work-service` owns end-to-end. Browsers heartbeat to
//! `POST /api/v1/presence/heartbeat`; the route handler writes the
//! payload to Redis and broadcasts a `WsEvent::Presence{Joined,Updated}`
//! through the existing `broadcast::Sender<WsEvent>`. A 30s tokio
//! evictor task removes rows whose 90s TTL elapsed and broadcasts
//! `WsEvent::PresenceLeft` for each.
//!
//! See:
//!   - `redis.rs` — HSET / ZSET / SET helpers (the schema lives there)
//!   - `evictor.rs` — the 30s sweeper task that fans out PresenceLeft
//!   - `crate::api::routes::presence` — the three REST endpoints
//!     (`POST /heartbeat`, `GET /online`, `DELETE /`)

pub mod evictor;
pub mod redis;

// Created and developed by Jai Singh
