// Created and developed by Jai Singh
//! Phase 9 — listener-driven trigger evaluator.
//!
//! For each allowlisted table that has a `<table>_changed` NOTIFY
//! trigger installed, [`run`] spawns a `PgListener` task. On every
//! NOTIFY:
//!
//! 1. Parse the JSON payload (must carry `row_id`, `organization_id`,
//!    `op`, and `new` — the latter being `row_to_jsonb(NEW)`).
//! 2. Walk every enabled trigger whose `source_table` matches AND
//!    whose `source_events` contains the op.
//! 3. Run the trigger's filter against `new`.
//! 4. On match: check the loop-detection counter, then INSERT a
//!    `sap_agent_jobs` row + emit `WsEvent::TriggerFired`.
//!
//! The interpolation engine is a deliberately tiny subset: only
//! `{{row.<dotted.path>}}` is recognised in string template values.
//! Numbers / booleans / nulls in the template pass through verbatim.
//! Nested objects / arrays in the template are walked recursively.
//!
//! Bad payloads, missing rows, channel disconnects, sqlx errors —
//! all logged and continue. The evaluator NEVER kills itself on a
//! single bad row.

use bb8::Pool;
use bb8_redis::redis::AsyncCommands;
use bb8_redis::RedisConnectionManager;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sqlx::PgPool;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::pglistener::{self, NotifyFrame};
use crate::triggers::config::{
    is_allowed_source_table, ALLOWED_SOURCE_TABLES, DEPTH_TTL_SECONDS, MAX_DEPTH,
};
use crate::triggers::loader::{TriggerRecord, TriggerSet};
use crate::websocket::WsEvent;

/// Wire shape produced by the per-table NOTIFY trigger functions
/// (e.g. `notify_rf_putaway_changed` from migration 276 — same shape
/// as Phase 4's `rf_putaway_listener::Notification`). The `new` field
/// is `row_to_jsonb(NEW)`. Loose-typed because the evaluator's job is
/// to walk arbitrary row shapes.
#[derive(Debug, Deserialize)]
struct RowChangeNotification {
    row_id: Uuid,
    organization_id: Uuid,
    op: String,
    #[serde(default)]
    new: Value,
}

/// Legacy entry point: spawn one `PgListener` task per allowlisted
/// source table. Pre-consolidation each table got its own dedicated
/// Postgres backend connection — 4 in production today. The
/// consolidated listener in `main.rs` now subscribes ONE multi-
/// channel `PgListener` to every channel returned by
/// [`evaluator_channels`] and dispatches per frame via [`handle`],
/// which is the budget-conscious path. Preserved here so the public
/// crate surface still exports `run` (tests + future redeploys).
#[allow(dead_code)]
pub async fn run(
    pool: PgPool,
    redis_pool: Pool<RedisConnectionManager>,
    set: Arc<RwLock<TriggerSet>>,
    ws_tx: broadcast::Sender<WsEvent>,
) {
    for table in ALLOWED_SOURCE_TABLES {
        let pool = pool.clone();
        let redis_pool = redis_pool.clone();
        let set = set.clone();
        let ws_tx = ws_tx.clone();
        let table = (*table).to_string();
        tokio::spawn(async move {
            run_for_table(pool, redis_pool, set, ws_tx, table).await;
        });
    }
}

/// Per-table listener loop. The `notify_*` migrations 270/271/276
/// chose SINGULAR channel names (`rf_putaway_operation_changed`,
/// `sap_agent_job_changed`) even though the source tables are PLURAL
/// (`rf_putaway_operations`, `sap_agent_jobs`). The Phase 9 evaluator
/// originally derived channel names with a naive `format!("{}_changed",
/// table)` which produced PLURAL channel names — so its `LISTEN` calls
/// silently subscribed to channels nothing publishes to. The Postgres
/// `LISTEN` succeeds on any name (it just registers interest), so the
/// `LISTEN failed` branch never fired and the bug was invisible until
/// the 2026-05-07 Citrix run on `USINDPR-CXA103V` showed putaway TOs
/// piling up at `to_status='Completed', confirmed_source IS NULL`
/// while no `sap_agent_jobs` rows were ever INSERTed by the evaluator.
/// See [[Debug/Fix-Trigger-Evaluator-Channel-Singular-Plural]].
pub fn channel_for_table(table: &str) -> String {
    match table {
        // Migration 276 / 285 — `pg_notify('rf_putaway_operation_changed', …)`.
        "rf_putaway_operations" => "rf_putaway_operation_changed".to_string(),
        // Migration 271 — `pg_notify('sap_agent_job_changed', …)`.
        "sap_agent_jobs" => "sap_agent_job_changed".to_string(),
        // Tables without a shipped NOTIFY trigger (`work_tasks`,
        // `shipment_queue`) keep the convention so the moment a
        // future migration installs `<table>_changed` it lights up
        // without a code change. The evaluator's `LISTEN failed`
        // branch logs and sleeps when the channel is missing.
        _ => format!("{}_changed", table),
    }
}

/// Inverse of [`channel_for_table`]. Returns the table name the
/// channel was emitted by, or `None` if the channel is not a known
/// evaluator source. Used by the consolidated multi-channel
/// dispatcher in `main.rs` to route a frame to the right
/// allowlisted-table handler.
pub fn table_for_channel(channel: &str) -> Option<&'static str> {
    for t in ALLOWED_SOURCE_TABLES {
        if channel_for_table(t) == channel {
            return Some(t);
        }
    }
    None
}

/// All channel names the evaluator wants to LISTEN on (one per
/// allowlisted source table). Stable boot-time list — useful for
/// the consolidated multi-channel listener in `main.rs`.
pub fn evaluator_channels() -> Vec<String> {
    ALLOWED_SOURCE_TABLES
        .iter()
        .map(|t| channel_for_table(t))
        .collect()
}

/// Per-frame handler — looks up the originating table from
/// `frame.channel` (via [`table_for_channel`]) and runs the
/// allowlisted-table evaluation. Safe to call from the
/// consolidated multi-channel dispatcher in `main.rs`.
pub async fn handle(
    frame: &NotifyFrame,
    pool: &PgPool,
    redis_pool: &Pool<RedisConnectionManager>,
    set: &Arc<RwLock<TriggerSet>>,
    ws_tx: &broadcast::Sender<WsEvent>,
) {
    let table = match table_for_channel(&frame.channel) {
        Some(t) => t,
        None => {
            warn!(
                channel = %frame.channel,
                "trigger_evaluator: frame channel does not map to any \
                 allowlisted source table (skipped)"
            );
            return;
        }
    };
    if let Err(e) = handle_notification(pool, redis_pool, set, ws_tx, table, &frame.payload).await
    {
        error!(
            ?e,
            table = %table,
            "trigger_evaluator: handle_notification failed"
        );
    }
}

/// Per-table listener loop. Resilient PgListener handles connection
/// errors + watchdog reconnects so a silent TCP drop on the
/// `<table>_changed` channel can no longer wedge per-org trigger
/// firing. See
/// `memorybank/OmniFrame/Implementations/Implement-Resilient-PgListener.md`.
async fn run_for_table(
    pool: PgPool,
    redis_pool: Pool<RedisConnectionManager>,
    set: Arc<RwLock<TriggerSet>>,
    ws_tx: broadcast::Sender<WsEvent>,
    table: String,
) {
    let channel = channel_for_table(&table);
    let pool_for_callback = pool.clone();
    pglistener::run(pool, channel, move |frame| {
        let pool = pool_for_callback.clone();
        let redis_pool = redis_pool.clone();
        let set = set.clone();
        let ws_tx = ws_tx.clone();
        let table = table.clone();
        async move {
            if let Err(e) = handle_notification(
                &pool,
                &redis_pool,
                &set,
                &ws_tx,
                &table,
                &frame.payload,
            )
            .await
            {
                error!(
                    ?e,
                    table = %table,
                    "trigger_evaluator: handle_notification failed"
                );
            }
        }
    })
    .await;
}

async fn handle_notification(
    pool: &PgPool,
    redis_pool: &Pool<RedisConnectionManager>,
    set: &Arc<RwLock<TriggerSet>>,
    ws_tx: &broadcast::Sender<WsEvent>,
    table: &str,
    payload: &str,
) -> anyhow::Result<()> {
    let n: RowChangeNotification = match serde_json::from_str(payload) {
        Ok(n) => n,
        Err(e) => {
            error!(?e, payload, "trigger_evaluator: bad NOTIFY payload (skipped)");
            return Ok(());
        }
    };

    if !is_allowed_source_table(table) {
        // Belt-and-brace — the listener loop spawn already filters,
        // but defence-in-depth: if a future bug routes the wrong
        // table here, refuse to evaluate.
        warn!(table, "trigger_evaluator: refusing to evaluate non-allowlisted table");
        return Ok(());
    }

    // Snapshot the rule set under read lock — we want to drop the
    // lock before doing any I/O.
    let rules: Vec<TriggerRecord> = {
        let guard = set.read().await;
        match guard.for_table(table) {
            Some(r) => r.to_vec(),
            None => return Ok(()),
        }
    };

    if rules.is_empty() {
        return Ok(());
    }

    for rule in rules {
        if rule.organization_id != n.organization_id {
            // Triggers are org-scoped — never fire across tenants.
            continue;
        }
        if !rule.source_events.iter().any(|e| e == &n.op) {
            continue;
        }
        if !rule.filter.eval(&n.new) {
            continue;
        }

        // Loop detection — increment the per-row depth counter.
        // Aborts on the FOURTH cycle.
        match check_and_increment_depth(redis_pool, &rule.organization_id, &n.row_id).await {
            Ok(depth) if depth > MAX_DEPTH => {
                warn!(
                    trigger_id = %rule.id,
                    source_row_id = %n.row_id,
                    organization_id = %rule.organization_id,
                    depth,
                    audit_kind = "trigger.loop_detected",
                    "trigger_evaluator: loop detected — aborting evaluation"
                );
                continue;
            }
            Ok(_) => {}
            Err(e) => {
                // Redis hiccup — fail open (let the trigger fire).
                // The DB-side `idempotency_key` unique constraint on
                // `sap_agent_jobs` is the final guard against
                // duplicate enqueues.
                warn!(
                    ?e,
                    trigger_id = %rule.id,
                    "trigger_evaluator: loop-detection counter unavailable; \
                     proceeding"
                );
            }
        }

        if let Err(e) = fire_trigger(pool, ws_tx, &rule, &n).await {
            error!(
                ?e,
                trigger_id = %rule.id,
                source_row_id = %n.row_id,
                "trigger_evaluator: fire failed (skipped)"
            );
        }
    }

    Ok(())
}

async fn fire_trigger(
    pool: &PgPool,
    ws_tx: &broadcast::Sender<WsEvent>,
    rule: &TriggerRecord,
    n: &RowChangeNotification,
) -> anyhow::Result<()> {
    let mut payload = interpolate_value(&rule.payload_template, &n.new);

    // Embed the post_success_patch (if any) under the same
    // `__omni_trigger_meta` envelope the legacy
    // `_HARDCODED_TRIGGERS` path used. The agent's job poller looks
    // for this exact key (`payload.__omni_trigger_meta.post_success_patch`)
    // and applies the patch after the SAP dispatch returns success.
    // See `omni_agent/agent.py::_apply_trigger_post_patch`.
    if let Some(patch) = &rule.post_success_patch {
        let patch = interpolate_value(patch, &n.new);
        let mut meta = Map::new();
        meta.insert("post_success_patch".into(), patch);
        // payload may itself be a non-object (e.g. an admin pre-fills
        // a literal payload "{}"); ensure it's an object before we
        // splice in the meta key.
        if !payload.is_object() {
            payload = json!({});
        }
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("__omni_trigger_meta".into(), Value::Object(meta));
        }
    }

    // Build the idempotency key with the same shape the legacy
    // agent path used (`trig:<id>:<row>:<unix-day>`). The unix-day
    // suffix lets a row whose first enqueue failed retry tomorrow
    // without a permanent 409 lockout — see
    // [[Debug/Fix-Audit-Closeout-v1.7.2]].
    let unix_day: i64 = chrono::Utc::now().timestamp() / 86_400;
    let idem_key = format!("trig:{}:{}:{}", rule.id, n.row_id, unix_day);

    let job_id: Uuid = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO public.sap_agent_jobs (
            organization_id,
            endpoint,
            payload,
            priority,
            status,
            idempotency_key
        )
        VALUES ($1, $2, $3, 50, 'queued', $4)
        ON CONFLICT (organization_id, idempotency_key) DO NOTHING
        RETURNING id
        "#,
    )
    .bind(rule.organization_id)
    .bind(&rule.target_endpoint)
    .bind(&payload)
    .bind(&idem_key)
    .fetch_optional(pool)
    .await?
    .unwrap_or_else(Uuid::nil);

    if job_id.is_nil() {
        debug!(
            trigger_id = %rule.id,
            source_row_id = %n.row_id,
            idem_key,
            "trigger_evaluator: job already queued (idempotency hit)"
        );
        return Ok(());
    }

    // Broadcast for FE observability. Failure here is non-fatal —
    // the job IS queued; the WS event is purely a UI signal.
    let _ = crate::websocket::broadcast_event(
        ws_tx,
        WsEvent::TriggerFired {
            trigger_id: rule.id,
            source_row_id: n.row_id,
            target_endpoint: rule.target_endpoint.clone(),
            job_id,
            organization_id: rule.organization_id,
        },
    );

    info!(
        trigger_id = %rule.id,
        source_row_id = %n.row_id,
        target_endpoint = %rule.target_endpoint,
        job_id = %job_id,
        organization_id = %rule.organization_id,
        "trigger_evaluator: fired"
    );

    Ok(())
}

// ────────────────────────────────────────────────────────────────────
// Loop detection (Redis depth counter)
// ────────────────────────────────────────────────────────────────────

fn depth_key(org: &Uuid, row_id: &Uuid) -> String {
    format!("trigger:depth:{}:{}", org, row_id)
}

/// INCR the per-row counter and surface the new value. The counter
/// auto-expires after [`DEPTH_TTL_SECONDS`] so a legitimate retry of
/// the same row 5 minutes later starts fresh. Returns the new depth
/// (1 on the first call). Errors propagate so the caller can choose
/// to fail open vs closed.
pub async fn check_and_increment_depth(
    pool: &Pool<RedisConnectionManager>,
    org: &Uuid,
    row_id: &Uuid,
) -> Result<u32, bb8_redis::redis::RedisError> {
    let mut conn = pool
        .get()
        .await
        .map_err(|e| match e {
            bb8::RunError::User(re) => re,
            bb8::RunError::TimedOut => bb8_redis::redis::RedisError::from(
                std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "redis pool acquire timeout",
                ),
            ),
        })?;
    let key = depth_key(org, row_id);
    let depth: i64 = conn.incr(&key, 1).await?;
    if depth == 1 {
        let _: () = conn.expire(&key, DEPTH_TTL_SECONDS as i64).await?;
    }
    Ok(depth.max(0) as u32)
}

// ────────────────────────────────────────────────────────────────────
// Template interpolation
// ────────────────────────────────────────────────────────────────────

/// Walk a template and replace `{{row.<dotted.path>}}` references in
/// string values with the corresponding row field. The replacement
/// preserves the JSON type when the entire string is a single
/// reference (e.g. `"{{row.qty}}"` resolves to a JSON number, not the
/// stringified number). Mixed strings (`"qty: {{row.qty}}"`) coerce
/// the resolved value to a string.
///
/// This is a deliberately tiny subset — no expressions, no defaults,
/// no transformations. Admins who need richer interpolation can edit
/// the rule's `payload_template` until the use case is real.
pub fn interpolate_value(template: &Value, row: &Value) -> Value {
    match template {
        Value::String(s) => interpolate_string(s, row),
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, v)| (k.clone(), interpolate_value(v, row)))
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(|v| interpolate_value(v, row)).collect()),
        _ => template.clone(),
    }
}

fn interpolate_string(s: &str, row: &Value) -> Value {
    // Fast path — no interpolation tokens at all.
    if !s.contains("{{") {
        return Value::String(s.to_string());
    }

    // Whole-string single token (preserves JSON type).
    if let Some(path) = parse_single_token(s) {
        if let Some(v) = lookup_row_path(row, path) {
            return v.clone();
        }
        return Value::Null;
    }

    // Mixed string — coerce all tokens to strings.
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after_open = &rest[start + 2..];
        let end = match after_open.find("}}") {
            Some(e) => e,
            None => {
                // No closing brace — emit the rest literally.
                out.push_str(&rest[start..]);
                rest = "";
                break;
            }
        };
        let token = after_open[..end].trim();
        let path = token.strip_prefix("row.").unwrap_or("");
        let resolved = if path.is_empty() {
            "".to_string()
        } else {
            match lookup_row_path(row, path) {
                Some(Value::String(s)) => s.clone(),
                Some(Value::Number(n)) => n.to_string(),
                Some(Value::Bool(b)) => b.to_string(),
                Some(Value::Null) | None => "".to_string(),
                Some(other) => other.to_string(),
            }
        };
        out.push_str(&resolved);
        rest = &after_open[end + 2..];
    }
    out.push_str(rest);
    Value::String(out)
}

/// If the input is exactly `{{row.<path>}}` with no surrounding text,
/// return the path. Otherwise None (handled as mixed-string interpolation).
fn parse_single_token(s: &str) -> Option<&str> {
    let trimmed = s.trim();
    let inner = trimmed.strip_prefix("{{")?.strip_suffix("}}")?;
    let inner = inner.trim();
    let path = inner.strip_prefix("row.")?;
    if path.is_empty() {
        return None;
    }
    Some(path)
}

fn lookup_row_path<'a>(row: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = row;
    for part in path.split('.') {
        if part.is_empty() {
            return None;
        }
        current = current.as_object()?.get(part)?;
    }
    Some(current)
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ── Channel-name mapping (regression for the 2026-05-07 fix) ──

    #[test]
    fn channel_for_table_uses_singular_for_phase4_tables() {
        // Migrations 271 + 276 chose SINGULAR channel names. The
        // 2026-05-07 Citrix run on `USINDPR-CXA103V` proved that
        // any drift here disconnects the evaluator silently — the
        // `LISTEN` succeeds on any name, so the bug doesn't surface
        // as a startup error. Lock the names in.
        assert_eq!(
            channel_for_table("rf_putaway_operations"),
            "rf_putaway_operation_changed"
        );
        assert_eq!(
            channel_for_table("sap_agent_jobs"),
            "sap_agent_job_changed"
        );
    }

    #[test]
    fn channel_for_table_falls_back_to_convention_for_future_tables() {
        // `work_tasks` and `shipment_queue` are allowlisted but have
        // no NOTIFY trigger today. When they ship, the migration
        // is expected to use the `<table>_changed` convention.
        assert_eq!(channel_for_table("work_tasks"), "work_tasks_changed");
        assert_eq!(
            channel_for_table("shipment_queue"),
            "shipment_queue_changed"
        );
    }

    /// 2026-05-20 — the consolidated multi-channel listener dispatches
    /// by `frame.channel`, so the inverse mapping
    /// (channel → allowlisted table) must round-trip cleanly for every
    /// allowlisted source. Lock the contract.
    #[test]
    fn table_for_channel_is_inverse_of_channel_for_table() {
        for t in ALLOWED_SOURCE_TABLES {
            let ch = channel_for_table(t);
            assert_eq!(
                table_for_channel(&ch),
                Some(*t),
                "round-trip failed for table {} (channel {})",
                t,
                ch
            );
        }
    }

    #[test]
    fn table_for_channel_returns_none_for_unknown_channel() {
        assert!(table_for_channel("not_a_real_channel").is_none());
        assert!(table_for_channel("").is_none());
        assert!(table_for_channel("work_engine_settings_changed").is_none());
    }

    #[test]
    fn evaluator_channels_covers_every_allowlisted_table() {
        let channels = evaluator_channels();
        assert_eq!(channels.len(), ALLOWED_SOURCE_TABLES.len());
        for ch in &channels {
            assert!(
                table_for_channel(ch).is_some(),
                "evaluator_channels emitted {} but table_for_channel can't resolve it",
                ch
            );
        }
    }

    // ── Interpolation ──────────────────────────────────────────────

    #[test]
    fn interpolate_single_string_token_preserves_type() {
        let row = json!({"qty": 42, "warehouse": "WH5"});
        let tmpl = json!({"qty": "{{row.qty}}", "warehouse": "{{row.warehouse}}"});
        let out = interpolate_value(&tmpl, &row);
        assert_eq!(out, json!({"qty": 42, "warehouse": "WH5"}));
    }

    #[test]
    fn interpolate_mixed_string_token_coerces_to_string() {
        let row = json!({"to_number": "1790022", "warehouse": "WH5"});
        let tmpl = json!({"label": "TO {{row.to_number}} in {{row.warehouse}}"});
        let out = interpolate_value(&tmpl, &row);
        assert_eq!(out, json!({"label": "TO 1790022 in WH5"}));
    }

    #[test]
    fn interpolate_dotted_path() {
        let row = json!({"payload": {"material": "MAT-001"}});
        let tmpl = json!({"material": "{{row.payload.material}}"});
        let out = interpolate_value(&tmpl, &row);
        assert_eq!(out, json!({"material": "MAT-001"}));
    }

    #[test]
    fn interpolate_missing_path_yields_null_for_single_token() {
        let row = json!({"qty": 42});
        let tmpl = json!({"warehouse": "{{row.warehouse}}"});
        let out = interpolate_value(&tmpl, &row);
        assert_eq!(out, json!({"warehouse": null}));
    }

    #[test]
    fn interpolate_missing_path_yields_empty_string_for_mixed() {
        let row = json!({"qty": 42});
        let tmpl = json!({"label": "warehouse={{row.warehouse}}"});
        let out = interpolate_value(&tmpl, &row);
        assert_eq!(out, json!({"label": "warehouse="}));
    }

    #[test]
    fn interpolate_passthrough_non_string_values() {
        let row = json!({});
        let tmpl = json!({"priority": 50, "enabled": true, "tag": null});
        let out = interpolate_value(&tmpl, &row);
        assert_eq!(out, tmpl);
    }

    #[test]
    fn interpolate_nested_objects_and_arrays() {
        let row = json!({"to_number": "1790022", "warehouse": "WH5"});
        let tmpl = json!({
            "outer": {
                "inner": "{{row.to_number}}",
                "list": ["{{row.warehouse}}", "literal"]
            }
        });
        let out = interpolate_value(&tmpl, &row);
        assert_eq!(
            out,
            json!({"outer": {"inner": "1790022", "list": ["WH5", "literal"]}})
        );
    }

    #[test]
    fn interpolate_unmatched_braces_pass_through() {
        // No closing `}}` — the substring is emitted literally so an
        // admin sees the typo in the dispatched payload.
        let row = json!({});
        let tmpl = json!({"label": "broken {{row.qty"});
        let out = interpolate_value(&tmpl, &row);
        assert_eq!(out, json!({"label": "broken {{row.qty"}));
    }

    // ── Loop-detection key shape ───────────────────────────────────

    #[test]
    fn depth_key_is_well_formed() {
        let org = Uuid::parse_str("00000000-0000-0000-0000-000000000001").unwrap();
        let row = Uuid::parse_str("00000000-0000-0000-0000-0000000000aa").unwrap();
        let key = depth_key(&org, &row);
        assert!(key.starts_with("trigger:depth:"));
        assert!(key.contains(&org.to_string()));
        assert!(key.contains(&row.to_string()));
    }

    // ── End-to-end fire-shape sanity (NO DB / NO Redis) ───────────

    #[test]
    fn matched_rule_emits_expected_meta_envelope() {
        // Reproduce the shape the agent's `_apply_trigger_post_patch`
        // expects. We don't fire here (no DB/Redis in unit tests) —
        // we just exercise the interpolation + envelope-splice path.
        let row = json!({
            "id": "11111111-1111-1111-1111-111111111111",
            "to_number": "1790022",
            "warehouse": "WH5"
        });
        let payload_tmpl = json!({
            "to_number": "{{row.to_number}}",
            "warehouse": "{{row.warehouse}}"
        });
        let post_patch_tmpl = json!({
            "table": "rf_putaway_operations",
            "filter": { "eq": { "field": "id", "value": "{{row.id}}" } },
            "update": { "confirmed_source": "agent_trigger_direct" }
        });

        let mut payload = interpolate_value(&payload_tmpl, &row);
        let patch = interpolate_value(&post_patch_tmpl, &row);
        let mut meta = Map::new();
        meta.insert("post_success_patch".into(), patch);
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("__omni_trigger_meta".into(), Value::Object(meta));
        }

        let expected = json!({
            "to_number": "1790022",
            "warehouse": "WH5",
            "__omni_trigger_meta": {
                "post_success_patch": {
                    "table": "rf_putaway_operations",
                    "filter": { "eq": { "field": "id", "value": "11111111-1111-1111-1111-111111111111" } },
                    "update": { "confirmed_source": "agent_trigger_direct" }
                }
            }
        });
        assert_eq!(payload, expected);
    }
}

// Created and developed by Jai Singh
