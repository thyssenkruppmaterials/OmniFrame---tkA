// Created and developed by Jai Singh
//! In-memory per-org settings cache.
//!
//! Read path: `SettingsCache::resolved(org, task_type, warehouse)` returns a
//! `ResolvedWorkTypeSettings` populated through Postgres `work_setting()`
//! resolution order (warehouse → type → engine → default).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use sqlx::PgPool;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::strategies::ResolvedWorkTypeSettings;

const TTL: Duration = Duration::from_secs(60);

#[derive(Default, Clone)]
struct Entry {
    settings: HashMap<String, ResolvedWorkTypeSettings>,
    fetched_at: Option<Instant>,
}

#[derive(Clone, Default)]
pub struct SettingsCache {
    inner: Arc<RwLock<HashMap<Uuid, Entry>>>,
}

impl SettingsCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn invalidate(&self, org_id: Uuid) {
        let mut g = self.inner.write().await;
        g.remove(&org_id);
    }

    pub async fn invalidate_all(&self) {
        let mut g = self.inner.write().await;
        g.clear();
    }

    pub async fn resolved(
        &self,
        pool: &PgPool,
        org_id: Uuid,
        task_type: &str,
    ) -> ResolvedWorkTypeSettings {
        // Hit?
        {
            let g = self.inner.read().await;
            if let Some(e) = g.get(&org_id) {
                if let Some(fetched) = e.fetched_at {
                    if fetched.elapsed() < TTL {
                        if let Some(s) = e.settings.get(task_type) {
                            return s.clone();
                        }
                    }
                }
            }
        }

        // Miss → fetch the entire org row (cheap; small table) and remember.
        let rows = sqlx::query_as::<_, (String, bool, bool, bool, bool, i32, bool, bool, i32, i32, i32, Vec<String>)>(
            r#"SELECT task_type, enabled, push_enabled, pull_enabled, batch_push_enabled,
                       capacity_per_worker, require_capability, require_zone_assignment,
                       abandonment_minutes, reservation_escalation_minutes,
                       heartbeat_release_minutes, bypass_priorities
                  FROM work_type_settings
                 WHERE organization_id = $1"#,
        )
        .bind(org_id)
        .fetch_all(pool)
        .await
        .unwrap_or_default();

        let mut map = HashMap::new();
        for r in rows {
            map.insert(
                r.0.clone(),
                ResolvedWorkTypeSettings {
                    require_capability: r.6,
                    require_zone_assignment: r.7,
                    capacity_per_worker: r.5 as u32,
                    abandonment_minutes: r.8 as u32,
                    reservation_escalation_minutes: r.9 as u32,
                    heartbeat_release_minutes: r.10 as u32,
                    bypass_priorities: r.11,
                },
            );
        }

        let cached = map.get(task_type).cloned().unwrap_or_default();

        let mut g = self.inner.write().await;
        g.insert(
            org_id,
            Entry {
                settings: map,
                fetched_at: Some(Instant::now()),
            },
        );
        cached
    }
}

// Created and developed by Jai Singh
