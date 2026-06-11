// Created and developed by Jai Singh
//! Shared test fixtures.
//!
//! Skips cleanly if `TEST_DATABASE_URL` is unset — no fail. Operators
//! point this at a throwaway Supabase project / local Postgres for the
//! full integration matrix; CI without a DB silently skips per plan §13.4.

// This `common` module is compiled into EACH integration-test binary, but
// not every binary calls every helper (e.g. `ensure_zone_rules_enabled` is
// used by `idempotency.rs` + `critical_priority.rs` only). Rust therefore
// reports the unused-in-this-binary helpers as dead code. Allow it
// module-wide — the idiomatic treatment for a shared test-fixtures module.
#![allow(dead_code)]

use sqlx::PgPool;
use std::time::Duration;
use uuid::Uuid;

/// Try to acquire a Postgres pool against `TEST_DATABASE_URL`. Returns
/// `None` (with a clear `eprintln!`) when the env var is unset so the
/// caller can skip without failing CI.
pub async fn try_pool() -> Option<PgPool> {
    let url = match std::env::var("TEST_DATABASE_URL") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => {
            eprintln!(
                "skipping: TEST_DATABASE_URL not set — set it to a throwaway Postgres to run \
                 the work-service integration tests (see docs/work-engine/phase-9-verification.md)"
            );
            return None;
        }
    };

    match sqlx::postgres::PgPoolOptions::new()
        .max_connections(4)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&url)
        .await
    {
        Ok(p) => Some(p),
        Err(e) => {
            eprintln!(
                "skipping: TEST_DATABASE_URL set but connection failed ({e}); not failing CI"
            );
            None
        }
    }
}

/// Lookup an org id with at least 3 active users so we can simulate
/// admin + 2 operators. Returns None to skip if not satisfied.
pub async fn pick_seed_org(pool: &PgPool) -> Option<(Uuid, Uuid, Uuid, Uuid)> {
    let org = sqlx::query_scalar::<_, Uuid>(
        r#"SELECT organization_id
             FROM public.user_profiles
            GROUP BY organization_id
           HAVING COUNT(*) >= 3
            ORDER BY COUNT(*) DESC
            LIMIT 1"#,
    )
    .fetch_optional(pool)
    .await
    .ok()??;

    let users: Vec<Uuid> = sqlx::query_scalar(
        r#"SELECT id FROM public.user_profiles
            WHERE organization_id = $1
            ORDER BY created_at ASC
            LIMIT 3"#,
    )
    .bind(org)
    .fetch_all(pool)
    .await
    .ok()?;

    if users.len() < 3 {
        return None;
    }
    Some((org, users[0], users[1], users[2]))
}

/// Activate the cycle-count zone rule for an org if not already enabled.
/// Idempotent; safe to call from any test.
pub async fn ensure_zone_rules_enabled(pool: &PgPool, org_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO public.cycle_count_zone_rules (organization_id, enabled, policy)
           VALUES ($1, true, 'one_counter_per_zone')
           ON CONFLICT (organization_id) DO UPDATE
             SET enabled = true, policy = 'one_counter_per_zone'"#,
    )
    .bind(org_id)
    .execute(pool)
    .await?;
    Ok(())
}

// Created and developed by Jai Singh
