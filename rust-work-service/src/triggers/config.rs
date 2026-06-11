// Created and developed by Jai Singh
//! Phase 9 — security allowlists for the trigger DSL evaluator.
//!
//! These are intentionally `const` arrays compiled into the binary —
//! NOT user-configurable, NOT env-tunable, NOT readable from the
//! database. Adding a new entry requires a Rust release.
//!
//! See [`memorybank/OmniFrame/Decisions/ADR-Trigger-DSL-Evaluator-Phase9.md`]
//! for the rationale.

/// Tables whose NOTIFY channel the evaluator is permitted to subscribe
/// to and whose rows the DSL is permitted to inspect.
///
/// Every entry MUST have:
///
/// 1. A `<table>_changed` NOTIFY trigger installed by a migration
///    (mirroring `notify_rf_putaway_changed` from migration 276).
/// 2. A `PgListener` subscribe-and-broadcast wired into
///    [`crate::triggers::evaluator::run`].
///
/// Adding a row here without doing both of those is a hard compile-
/// time misconfiguration in spirit; the evaluator will silently skip
/// the un-listened table at boot with a `tracing::warn!`.
pub const ALLOWED_SOURCE_TABLES: &[&str] = &[
    // Phase 4 — `notify_rf_putaway_changed` (migration 276).
    "rf_putaway_operations",
    // Phase 4 — `notify_sap_agent_job_changed` (migration 271).
    "sap_agent_jobs",
    // Tier 1 — `notify_work_tasks_changed` (future migration; the
    // evaluator skips this table with a warn until the NOTIFY
    // trigger lands. Listed here so admins can pre-author work_tasks
    // triggers that go live the moment the migration ships).
    "work_tasks",
    // v1.7.2 — `shipment_queue` was advertised in the agent's
    // `_HARDCODED_TRIGGERS` but the table itself does not exist in
    // the canonical schema today (see Phase 4's
    // `omni_agent/agent.py::_start_realtime_subscription` defensive
    // skip + [[Debug/Fix-Realtime-CleanClose-Cycle]] v1.8.1 footnote).
    // Kept in the allowlist so the moment the table is created plus
    // a NOTIFY trigger added, admin-authored shipment_queue triggers
    // start firing without a Rust release. The evaluator's listener
    // attempt logs and skips when the channel does not exist.
    "shipment_queue",
];

/// Cheap O(N) membership test — N is fixed at compile time.
pub fn is_allowed_source_table(table: &str) -> bool {
    ALLOWED_SOURCE_TABLES.contains(&table)
}

/// Endpoints that a trigger may target. The `target_endpoint` column
/// of `agent_triggers` MUST exactly equal one of these strings.
///
/// Notably ABSENT (and intentionally so):
///
/// - `/sap/connect`, `/sap/disconnect`, `/sap/select-session`,
///   `/sap/unpin-session` — agent-control endpoints.
/// - `/supabase/login`, `/supabase/logout`,
///   `/agent-token/rotate`, `/agent-token/check`, `/shutdown` — auth /
///   lifecycle.
/// - `/realtime/status`, `/health`, `/status` — diagnostic reads.
///
/// The evaluator's blast radius is bounded to "drives SAP work" by
/// construction — it can never make the agent reconnect, sign out,
/// or shut down.
pub const ALLOWED_TARGET_ENDPOINTS: &[&str] = &[
    "/sap/confirm-to",
    "/sap/process-shipment",
    "/sap/lt12",
    "/sap/import-lt22",
    "/sap/material-master-bin",
    "/sap/material-master-storage-types",
];

/// Cheap O(N) membership test — N is fixed at compile time.
pub fn is_allowed_target_endpoint(endpoint: &str) -> bool {
    ALLOWED_TARGET_ENDPOINTS.contains(&endpoint)
}

/// Capability id advertised by `rust-work-service` so FE consumers can
/// gate on "the server supports the v1 DSL grammar" if/when a future
/// v2 grammar lands. See `useSapTestingDashboard().fleet_capabilities`
/// for the consumption shape (FE side).
///
/// The trailing `-v1` is the grammar major version, NOT the Rust
/// service version. A future v2 of the grammar (e.g. adding regex
/// operators) bumps this to `trigger-dsl-evaluator-v2` and ships
/// alongside the v1 entry until clients migrate.
pub const DSL_GRAMMAR_VERSION: &str = "trigger-dsl-evaluator-v1";

/// Maximum allowed depth for the loop-detection counter. >`MAX_DEPTH`
/// aborts the evaluation. 3 is empirically generous — a typical
/// trigger fires once per row event, so any real loop crosses 3
/// within a few seconds.
pub const MAX_DEPTH: u32 = 3;

/// TTL for the per-row depth counter. Short enough that a legitimate
/// retry of the same row 5 minutes later is not punished, long
/// enough that a runaway loop within a single SAP-bound work cycle
/// (single-digit seconds) is observable.
pub const DEPTH_TTL_SECONDS: u64 = 60;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowed_source_tables_contains_phase4_tables() {
        // Phase 4 shipped `rf_putaway_operations` + `sap_agent_jobs`
        // listeners; if this regression check fails we've broken
        // wire-compat with already-running deployments.
        assert!(is_allowed_source_table("rf_putaway_operations"));
        assert!(is_allowed_source_table("sap_agent_jobs"));
    }

    #[test]
    fn unknown_source_table_is_rejected() {
        // Defence-in-depth — even if a future migration adds a
        // `cycle_counts_changed` NOTIFY trigger, the table is not
        // a permitted trigger source until added here. This is the
        // hard gate the ADR commits to.
        assert!(!is_allowed_source_table("cycle_counts"));
        assert!(!is_allowed_source_table("user_profiles"));
        assert!(!is_allowed_source_table("organizations"));
        assert!(!is_allowed_source_table(""));
    }

    #[test]
    fn allowed_target_endpoints_excludes_agent_control() {
        // Hard contract — the ADR commits to NEVER allowing the
        // evaluator to drive agent-control endpoints. Regression
        // here would be a security incident.
        assert!(!is_allowed_target_endpoint("/sap/connect"));
        assert!(!is_allowed_target_endpoint("/sap/disconnect"));
        assert!(!is_allowed_target_endpoint("/sap/select-session"));
        assert!(!is_allowed_target_endpoint("/supabase/login"));
        assert!(!is_allowed_target_endpoint("/supabase/logout"));
        assert!(!is_allowed_target_endpoint("/agent-token/rotate"));
        assert!(!is_allowed_target_endpoint("/shutdown"));
    }

    #[test]
    fn allowed_target_endpoints_includes_phase9_six() {
        // Sanity — the six endpoints the ADR commits to ship with.
        for endpoint in [
            "/sap/confirm-to",
            "/sap/process-shipment",
            "/sap/lt12",
            "/sap/import-lt22",
            "/sap/material-master-bin",
            "/sap/material-master-storage-types",
        ] {
            assert!(
                is_allowed_target_endpoint(endpoint),
                "endpoint {} must be allowlisted",
                endpoint
            );
        }
    }

    #[test]
    fn dsl_grammar_version_is_v1() {
        // FE contract — the SAP Testing dashboard's
        // `fleet_capabilities` consumer keys on this string. Any
        // change here is a wire-compat break that requires updating
        // the FE in lockstep.
        assert_eq!(DSL_GRAMMAR_VERSION, "trigger-dsl-evaluator-v1");
    }

    #[test]
    fn endpoint_match_is_exact_not_prefix() {
        // The allowlist must be EXACT match — `/sap/confirm-to-evil`
        // must NOT pass because it starts with `/sap/confirm-to`.
        assert!(!is_allowed_target_endpoint("/sap/confirm-to-evil"));
        assert!(!is_allowed_target_endpoint("/sap/confirm-to/extra"));
        assert!(!is_allowed_target_endpoint("/sap/lt12?safe=false"));
    }
}

// Created and developed by Jai Singh
