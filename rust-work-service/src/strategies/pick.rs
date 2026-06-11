// Created and developed by Jai Singh
//! Pick strategy stub. Body lands in the Picking follow-on plan; the OmniAgent
//! `builtin-pick-completed` trigger ships in the same plan.
use async_trait::async_trait;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use super::{DispatchStrategy, ResolvedWorkTypeSettings, StrategyContext, StrategySqlFragments};

pub struct PickStrategy;

#[async_trait]
impl DispatchStrategy for PickStrategy {
    fn task_type(&self) -> &'static str {
        "pick"
    }

    async fn load_context(
        &self,
        _tx: &mut Transaction<'_, Postgres>,
        org_id: Uuid,
        user_id: Uuid,
        settings: ResolvedWorkTypeSettings,
    ) -> Result<StrategyContext, sqlx::Error> {
        Ok(StrategyContext {
            org_id,
            user_id,
            settings,
            ..StrategyContext::default()
        })
    }

    fn static_sql(&self) -> StrategySqlFragments {
        StrategySqlFragments {
            extra_where: "",
            order_clause: "due_date ASC NULLS LAST, resolved_sequence ASC NULLS LAST",
        }
    }

    fn capacity_per_worker_default(&self) -> u32 {
        5
    }
}

// Created and developed by Jai Singh
