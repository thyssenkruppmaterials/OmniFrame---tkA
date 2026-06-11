// Created and developed by Jai Singh
//! Cycle Count strategy — preserves all 18 invariants from plan §2.1.
//!
//! Today this strategy is a thin facade around the existing
//! `db::queries::claim_next_cycle_count` SQL path. The dispatcher cuts the
//! generic `claim_next_task('cycle_count', …)` call through this strategy so
//! follow-on plans can swap the SQL behind it without changing handlers or
//! tests.

use async_trait::async_trait;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use super::{
    CandidateDecision, DispatchStrategy, ResolvedWorkTypeSettings, StrategyContext,
    StrategySqlFragments,
};
use crate::db::CycleCountTask;

pub struct CycleCountStrategy;

#[async_trait]
impl DispatchStrategy for CycleCountStrategy {
    fn task_type(&self) -> &'static str {
        "cycle_count"
    }

    async fn load_context(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        org_id: Uuid,
        user_id: Uuid,
        settings: ResolvedWorkTypeSettings,
    ) -> Result<StrategyContext, sqlx::Error> {
        // Capabilities/zones come from the worker_capabilities VIEW (Phase 1).
        // If the row is missing, return an empty context — when
        // require_capability=false the dispatcher treats empty as
        // "unrestricted except blocked".
        #[derive(sqlx::FromRow)]
        struct Caps {
            work_types: Vec<String>,
            blocked_work_types: Vec<String>,
            zones: Vec<String>,
        }
        let row: Option<Caps> = sqlx::query_as::<_, Caps>(
            r#"SELECT work_types, blocked_work_types, zones
                 FROM worker_capabilities
                WHERE organization_id = $1 AND user_id = $2"#,
        )
        .bind(org_id)
        .bind(user_id)
        .fetch_optional(&mut **tx)
        .await?;

        let (capabilities, blocked, zones) = match row {
            Some(c) => (c.work_types, c.blocked_work_types, c.zones),
            None => (vec![], vec![], vec![]),
        };

        Ok(StrategyContext {
            org_id,
            user_id,
            capabilities,
            blocked,
            zones,
            settings,
        })
    }

    fn filter_candidate(&self, _t: &CycleCountTask, ctx: &StrategyContext) -> CandidateDecision {
        // The legacy SQL already enforces the heavy filters; the strategy is
        // only responsible for blocked-type and capability gating.
        if ctx.blocked.iter().any(|s| s == "cycle_count") {
            return CandidateDecision::Skip;
        }
        if ctx.settings.require_capability && !ctx.capabilities.iter().any(|s| s == "cycle_count") {
            return CandidateDecision::Skip;
        }
        CandidateDecision::Take
    }

    fn static_sql(&self) -> StrategySqlFragments {
        // Cycle count uses the full claim_next_cycle_count SQL today; these
        // fragments are reserved for the generic-claim follow-on.
        StrategySqlFragments::default()
    }

    fn capability_required(&self, settings: &ResolvedWorkTypeSettings) -> bool {
        settings.require_capability
    }

    fn capacity_per_worker_default(&self) -> u32 {
        1
    }

    fn supports_advisory_lock(&self) -> bool {
        true
    }
}

// Created and developed by Jai Singh
