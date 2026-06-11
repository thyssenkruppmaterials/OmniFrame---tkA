// Created and developed by Jai Singh
//! Phase 9 of [`.cursor/plans/rust_work_service_full_integration_5b88165d.plan.md`] —
//! server-side trigger DSL evaluator.
//!
//! Replaces:
//!
//! - `omni_agent/agent.py::_HARDCODED_TRIGGERS` (3 entries: `builtin-rf-
//!   putaway-completed`, `builtin-shipment-queue`, `builtin-pick-completed`)
//!   plus `_on_rf_putaway_change`, `_on_hardcoded_table_change`,
//!   `_start_trigger_backfill_poller`, and the `_recently_queued_rows`
//!   in-memory dedup cache. The agent post-Phase 9 is a pure consumer
//!   of `sap_agent_jobs` rows.
//! - `src/features/admin/sap-testing/hooks/use-agent-trigger-runtime.ts`
//!   (~700 LOC). The browser-side runtime is deleted entirely; the
//!   "Agent Triggers" tab becomes pure CRUD over `agent_triggers`.
//!
//! Architecture:
//!
//! 1. `loader::run` boots from the database (reads `agent_triggers`
//!    rows where `enabled = true`) and stores them in a shared
//!    `Arc<RwLock<TriggerSet>>`. It then `LISTEN`s on the
//!    `agent_triggers_changed` NOTIFY channel (migration 281's trigger)
//!    and hot-reloads the rule set on every change.
//! 2. `evaluator::run_for_table(table)` subscribes to the per-table
//!    NOTIFY channel (e.g. `rf_putaway_operation_changed` from
//!    migration 276; future migrations add NOTIFY triggers on the
//!    other tables in [`config::ALLOWED_SOURCE_TABLES`]). On each
//!    notification, it looks up matching enabled triggers from the
//!    shared rule set, runs each rule's `match_filter` through the
//!    DSL parser, and on match INSERTs a `sap_agent_jobs` row + emits
//!    a `WsEvent::TriggerFired`.
//! 3. The DSL parser (`dsl::parse_filter`) only recognises the
//!    whitelisted operators in [`ADR-Trigger-DSL-Evaluator-Phase9`].
//!    Bad filters fail loudly with a [`DslError`] carrying the JSON
//!    pointer + a human-readable message.
//! 4. Loop detection (`evaluator::check_and_increment_depth`) uses a
//!    Redis counter `trigger:depth:{org}:{row_id}` with a 60s TTL.
//!    Depth >3 aborts the evaluation and audit-logs.
//!
//! Security mitigations are documented in
//! [`memorybank/OmniFrame/Decisions/ADR-Trigger-DSL-Evaluator-Phase9.md`].

pub mod config;
pub mod dsl;
pub mod evaluator;
pub mod loader;

// Internal-only module; consumers reach into the sub-modules directly
// (e.g. `crate::triggers::config::ALLOWED_SOURCE_TABLES`,
// `crate::triggers::dsl::parse_filter`). No top-level re-exports — they
// triggered Rust's `unused_imports` lint when the route handler was
// the only consumer.

// Created and developed by Jai Singh
