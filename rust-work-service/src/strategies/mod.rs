// Created and developed by Jai Singh
//! DispatchStrategy plug-in framework (Phase 2.5).
//!
//! Defines the contract that every WorkType must satisfy to participate in
//! the generic dispatcher. Today three impls live here:
//!   - `CycleCountStrategy` — wraps the existing `claim_next_cycle_count`
//!     SQL path and preserves all 18 invariants from plan §2.1.
//!   - `ZoneAuditStrategy` — placeholder until the Zoning plan ships.
//!   - `PickStrategy` — placeholder until the Picking plan ships.
//!
//! SQL fragments are STATIC strings owned by the strategy code; admin or
//! user-supplied SQL is never interpolated.

use async_trait::async_trait;
use serde_json::{json, Value as Json};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::db::CycleCountTask;

/// Resolved per-(org, task_type, warehouse) settings — populated by
/// `settings::cache` before each strategy call.
#[derive(Clone, Debug)]
pub struct ResolvedWorkTypeSettings {
    pub require_capability: bool,
    pub require_zone_assignment: bool,
    pub capacity_per_worker: u32,
    pub abandonment_minutes: u32,
    pub reservation_escalation_minutes: u32,
    pub heartbeat_release_minutes: u32,
    pub bypass_priorities: Vec<String>,
}

impl Default for ResolvedWorkTypeSettings {
    fn default() -> Self {
        Self {
            require_capability: false,
            require_zone_assignment: false,
            capacity_per_worker: 1,
            abandonment_minutes: 30,
            reservation_escalation_minutes: 60,
            heartbeat_release_minutes: 10,
            bypass_priorities: vec![],
        }
    }
}

/// Per-claim context populated by the strategy's `load_context`.
#[derive(Clone, Debug, Default)]
pub struct StrategyContext {
    pub org_id: Uuid,
    pub user_id: Uuid,
    pub capabilities: Vec<String>,
    pub blocked: Vec<String>,
    pub zones: Vec<String>,
    pub settings: ResolvedWorkTypeSettings,
}

/// Result of evaluating a candidate row.
#[derive(Clone, Copy, Debug)]
pub enum CandidateDecision {
    Take,
    Skip,
}

/// Static SQL fragments a strategy contributes. The dispatcher composes them
/// into the generic claim query. Code-owned strings only — never user input.
#[derive(Clone, Debug, Default)]
pub struct StrategySqlFragments {
    /// Optional extra `WHERE` AND-clauses appended to the base candidate scan.
    pub extra_where: &'static str,
    /// Optional order-by suffix applied AFTER `priority_rank` but BEFORE
    /// `created_at ASC`.
    pub order_clause: &'static str,
}

/// Trait every WorkType implements to participate in the generic dispatcher.
#[async_trait]
pub trait DispatchStrategy: Send + Sync {
    fn task_type(&self) -> &'static str;

    async fn load_context(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        org_id: Uuid,
        user_id: Uuid,
        settings: ResolvedWorkTypeSettings,
    ) -> Result<StrategyContext, sqlx::Error>;

    /// Pure ranker run AFTER the SQL `ORDER BY` to apply alternating-aisle
    /// bucketing and other in-memory tiebreakers.
    fn rank_candidates(&self, _candidates: &mut [CycleCountTask], _ctx: &StrategyContext) {}

    fn filter_candidate(&self, _t: &CycleCountTask, _ctx: &StrategyContext) -> CandidateDecision {
        CandidateDecision::Take
    }

    fn static_sql(&self) -> StrategySqlFragments {
        StrategySqlFragments::default()
    }

    fn capability_required(&self, _settings: &ResolvedWorkTypeSettings) -> bool {
        false
    }

    fn capacity_per_worker_default(&self) -> u32 {
        1
    }

    fn supports_advisory_lock(&self) -> bool {
        true
    }

    fn build_event_payload(&self, t: &CycleCountTask, _ctx: &StrategyContext) -> Json {
        json!({
            "task_type": self.task_type(),
            "task_id":   t.id,
            "priority":  t.priority,
        })
    }
}

mod cycle_count;
mod pick;
mod zone_audit;

pub use cycle_count::CycleCountStrategy;
pub use pick::PickStrategy;
pub use zone_audit::ZoneAuditStrategy;

/// Strategy registry — looked up by task_type slug. Keep `Arc<dyn …>` slots so
/// `WorkServiceState` can clone the registry into request handlers cheaply.
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Clone, Default)]
pub struct DispatchStrategyRegistry {
    inner: HashMap<&'static str, Arc<dyn DispatchStrategy>>,
}

impl DispatchStrategyRegistry {
    pub fn new() -> Self {
        let mut r = Self::default();
        r.inner.insert("cycle_count", Arc::new(CycleCountStrategy));
        r.inner.insert("zone_audit",  Arc::new(ZoneAuditStrategy));
        r.inner.insert("pick",        Arc::new(PickStrategy));
        r
    }

    pub fn get(&self, task_type: &str) -> Option<Arc<dyn DispatchStrategy>> {
        self.inner.get(task_type).cloned()
    }
}

// Created and developed by Jai Singh
