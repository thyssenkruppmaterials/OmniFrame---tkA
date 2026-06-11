// Created and developed by Jai Singh
//! API route modules for rust-work-service

pub mod dispatch;
pub mod entity_focus;
pub mod health;
pub mod notifications;
pub mod presence;
pub mod sap_agents;
pub mod sap_mutations;
pub mod sap_testing;
pub mod work;
pub mod workers;
// Phase 6 (2026-05-07) — fleet-wide live console streaming. Append-only
// add so parallel Phase 8 edits on this file merge cleanly. See
// `sap_console.rs` module doc-block.
pub mod sap_console;
// Phase 9 (2026-05-07) — server-side trigger DSL evaluator CRUD.
// See `triggers.rs` + `crate::triggers` module + ADR-Trigger-DSL-Evaluator-Phase9.
pub mod triggers;
// Phase 10 (2026-05-07) — agent identity v2 (service-key
// authentication for the omni_agent fleet). Splits into a public
// `/exchange` route and three admin-only management routes
// (`/register`, `/revoke`, `/list`). See ADR-Agent-Identity-V2-Phase10
// and `Implementations/Implement-Rust-Work-Service-Phase10.md`.
pub mod agent_identity;

// Re-export route handlers for convenience
pub use dispatch::dispatch_routes;
pub use entity_focus::entity_focus_routes;
pub use health::{health_check, health_check_detailed};
pub use notifications::notifications_routes;
pub use presence::presence_routes;
pub use sap_agents::sap_agents_routes;
pub use sap_mutations::sap_mutations_routes;
pub use sap_testing::sap_testing_routes;
pub use work::{metrics_endpoint, work_routes};
pub use workers::workers_routes;
// Phase 6 (2026-05-07) — append-only re-export to keep parallel
// merges clean.
pub use sap_console::sap_console_routes;
// Phase 9 (2026-05-07) — `agent_triggers` CRUD + dry-run / preview routes.
pub use triggers::triggers_routes;
// Phase 10 (2026-05-07) — split into a public router (no auth — agents
// have no JWT yet at exchange time) and a protected router (admin
// JWT). Mounted in main.rs alongside the other public/protected
// nests.
pub use agent_identity::{agent_identity_protected_routes, agent_identity_public_routes};

// Note: WebSocket handler is exported directly from crate::websocket module
// and used in main.rs for the /ws route

// Created and developed by Jai Singh
