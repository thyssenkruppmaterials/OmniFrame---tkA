// Created and developed by Jai Singh
//! Zone audit strategy stub. Body lands in the Zoning follow-on plan.
use async_trait::async_trait;
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use super::{DispatchStrategy, ResolvedWorkTypeSettings, StrategyContext, StrategySqlFragments};

pub struct ZoneAuditStrategy;

#[async_trait]
impl DispatchStrategy for ZoneAuditStrategy {
    fn task_type(&self) -> &'static str {
        "zone_audit"
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
            order_clause: "primary_location ASC",
        }
    }

    fn capacity_per_worker_default(&self) -> u32 {
        1
    }
}

// Created and developed by Jai Singh
