---
tags: [type/debug, status/active, domain/backend, domain/database, domain/infra]
created: 2026-05-06
---
# Fix — Putaway Status PATCH Silently No-ops Across UTC Midnight (v1.8.3)

## Symptoms

19 `rf_putaway_operations` rows that the agent successfully confirmed in SAP (LT12) between **00:21–00:31 UTC May 6** stayed at `to_status='Completed'` and `confirmed_at=NULL` even though the TO had already been LT12-confirmed. The frontend kept showing "**Pending TO Confirm**" pills on rows the user could see were already done in SAP.

```sql
SELECT id, to_number, warehouse, to_status, confirmed_at,
       confirmed_source, confirmed_by_label, confirmed_by_agent_id,
       created_at
  FROM rf_putaway_operations
 WHERE to_status = 'Completed'
   AND confirmed_at IS NULL
   AND created_at >= '2026-05-05 22:00:00+00'
 ORDER BY created_at DESC LIMIT 25;
```

Every recent agent-processed row had:

- `to_status = 'Completed'` ✗ (should have been `'TO Confirmed'`)
- `confirmed_at = NULL` ✗ (should have been the LT12 commit UTC)
- `confirmed_source = 'agent_trigger_direct'` ✓
- `confirmed_by_label = 'Omni Agent'` ✓
- `confirmed_by_agent_id = 'USINDPR-Console-jsingh'` ✓

In other words, the **OVERLAY** patch (v1.6.8) worked correctly but the **LEGACY** patch silently no-op'd. PostgREST returned `200 OK` with empty body and the agent log read:

```
[lt12]  WARN _update_putaway_status patched 0 rows (TO 0001736242 WH WH5).
        Row may already be TO Confirmed, or created before today UTC, or RLS
        hid it from this user.
```

19 rows with this exact warn pattern in the user's agent console, all clustered around the 00:21–00:31 UTC window.

## Root cause — UTC midnight crossing in the legacy PATCH filter

`_update_putaway_status` in `omni_agent/agent.py` was filtering by `created_at >= today` (UTC):

```python
def _update_putaway_status(to_number: str, warehouse: str):
    today = datetime.utcnow().strftime("%Y-%m-%d")
    resp = _supabase_request(
        "PATCH",
        f"{state.supabase_url}/rest/v1/rf_putaway_operations"
        f"?to_number=eq.{to_number}"
        f"&warehouse=eq.{warehouse}"
        f"&to_status=neq.TO%20Confirmed"
        f"&created_at=gte.{today}",
        ...
    )
```

This is the legacy "set the 3 fields" PATCH that v1.6.6/v1.6.8 explicitly preserved as the canonical writer for `to_status` / `confirmed_at` / `confirmed_by`. The OVERLAY patch in `_apply_trigger_post_patch` (v1.6.8) ALREADY uses `id=eq.<row_id>` so it correctly targets the source row regardless of timezone — that's why the OVERLAY columns (`confirmed_source`, `confirmed_by_label`, `confirmed_by_agent_id`) were always set even on the 19 broken rows.

**The race**: a TO created at `2026-05-05 22:30:00+00` (8 PM ET / day boundary close) gets processed by the agent at `2026-05-06 00:21:00+00` (after midnight UTC). The agent's `today` is now `2026-05-06`. The PATCH filter `created_at >= 2026-05-06` excludes the row whose `created_at = 2026-05-05 22:30:00`. PostgREST returns `200 OK` with `[]`. The agent logs "patched 0 rows" and moves on.

This bug has existed since the v1.6.0 introduction of the date-window filter — but it's only visible when the agent's job-poller picks up a TO whose `created_at` is on the previous UTC day. With the v1.7.0 drain mode + v1.6.9 backfill poller catching missed rows, the agent now processes at-most-once stragglers from up to 24 hours ago, which expanded the surface area of this bug. The 19 affected rows were processed during a single 10-minute drain burst that crossed midnight UTC.

## Why the date filter existed in the first place

`to_number + warehouse` is NOT a unique key on `rf_putaway_operations`. SAP allows a TO number to be re-created in the same warehouse on a future day after a cancel/repost (or after the daily ALV refresh). Without a date narrower, the PATCH would match historical "ghost" rows that the user manually closed weeks ago. The "today" window was a guess at the right scope for "the row I'm currently confirming" when the function was written before trigger metadata existed.

## The fix — prefer row_id when the trigger flow has it

Trigger-driven jobs (every agent-side TO confirm fired through `_HARDCODED_TRIGGERS`) carry `__omni_trigger_meta.post_success_patch.row_id` in the queued payload. The OVERLAY patch already uses it. We now plumb the same `row_id` into the LEGACY patch.

### Three surgical changes

#### 1. `_update_putaway_status(to_number, warehouse, row_id=None)`

When `row_id` is provided, PATCH by **exact id** with the existing `to_status=neq.TO%20Confirmed` skip filter:

```python
if row_id:
    url = (
        f"{state.supabase_url}/rest/v1/rf_putaway_operations"
        f"?id=eq.{row_id}"
        f"&to_status=neq.TO%20Confirmed"
    )
else:
    cutoff = (datetime.utcnow() - timedelta(hours=48)).strftime("%Y-%m-%d")
    url = (
        f"{state.supabase_url}/rest/v1/rf_putaway_operations"
        f"?to_number=eq.{to_number}"
        f"&warehouse=eq.{warehouse}"
        f"&to_status=neq.TO%20Confirmed"
        f"&created_at=gte.{cutoff}"
    )
```

When `row_id` is missing (manual `/sap/confirm-to` curl, browser-side queued job without trigger meta) the fallback path widens the date window to **48 hours** so a same-day retry still hits AND the UTC-midnight cliff is no longer fatal. We deliberately do NOT remove the date filter on the fallback path — without a row id we still need to disambiguate when the same `(to_number, warehouse)` appears multiple times across history.

The `to_status=neq.TO%20Confirmed` filter stays so a re-fired job doesn't overwrite a row that's already marked confirmed (preserves the v1.6.8 dual-patcher contract).

#### 2. `confirm_transfer_order(req, row_id=None)`

Accepts an optional `row_id` kwarg and forwards it to BOTH `_update_putaway_status` call sites:

- The "already-confirmed" branch (idempotent success when SAP says the TO is already done).
- The "post-Save success" branch (the normal 1-step or 2-step LT12 commit path).

FastAPI exposes `row_id` as a query parameter on `POST /sap/confirm-to` but the agent's only HTTP caller is the queue dispatcher, which uses the kwarg directly via `_dispatch_job`. Browser-side direct-fire calls don't include the query param so `row_id` stays None for them and the legacy 48-hour fallback runs.

#### 3. `_dispatch_job(job)`

Extracts `row_id` from `payload.__omni_trigger_meta.post_success_patch.row_id` and passes it as a kwarg ONLY to endpoints in a narrow allowlist:

```python
_ROW_ID_AWARE_ENDPOINTS = ("/sap/confirm-to",)
...
if endpoint in _ROW_ID_AWARE_ENDPOINTS and trigger_row_id:
    return handler_fn(Model(**payload), row_id=trigger_row_id)
return handler_fn(Model(**payload))
```

Other handlers don't receive `row_id` so adding the kwarg to them later (e.g. `process_shipment`, `transfer_inventory`) is opt-in — no implicit broadcast that could break a handler that doesn't expect the kwarg.

#### 4. Diagnostic — louder when it no-ops

The `count == 0` branch now includes the row_id + cutoff in the warn line so future regressions are immediately visible:

```
[lt12]  WARN _update_putaway_status PATCHED 0 rows for TO {to_number} WH {warehouse}
       (row_id={row_id}, cutoff={cutoff}). Possible UTC-midnight crossing OR row
       already TO Confirmed OR RLS hid it from this user. Check Putaway Log
       directly. See [[Debug/Fix-Putaway-Status-UTC-Midnight]].
```

## What stayed the same (deliberately)

- **`_apply_trigger_post_patch` (v1.6.8)** — already uses `id=eq.<row_id>` and was unaffected by this bug. UNCHANGED.
- **The `to_status=neq.TO%20Confirmed` skip filter** — preserves the v1.6.8 dual-patcher contract (don't double-write a row already confirmed).
- **No migration. No RLS change. No trigger semantics change.** The fix is purely client-side in the agent's PATCH-URL construction.
- **The legacy 3-field patcher / overlay 3-field patcher split** stays as documented in [[Patterns/Agent-Self-Attribution]].
- **No SAP handler logic touched.** The LT12 commit path is byte-identical to v1.8.2.

## The 19-row backfill (executed via Supabase MCP before the fix shipped)

```sql
UPDATE rf_putaway_operations
   SET to_status = 'TO Confirmed',
       confirmed_at = '2026-05-06 00:31:00+00'  -- approximate; agent logs had per-row timestamps
 WHERE id IN (
   '<19 row ids extracted from agent log>'
 );
```

All 19 rows now read correctly in the Putaway Log table. Confirmed via the SQL above + Putaway Log UI screenshot.

## Verification

- AST parse on `agent.py` clean.
- `npm run build` clean in 10.5s.
- `ReadLints` on `agent.py` + `src/features/admin/sap-testing/lib/agent-fetch.ts` clean.
- Manual probe to be done on the next live agent run that crosses midnight UTC — the new WARN log line will surface immediately if the row_id wasn't plumbed correctly.

## Capability

`putaway-update-by-rowid` advertised in `/health.capabilities` (purely informational, no frontend gating). Older agents (≤1.8.2) will silently use the legacy date-window path; once they upgrade the WARN log line will go quiet.

## Related

- [[Fix-Agent-Dual-Patcher-Race]] — The v1.6.8 fix that introduced the OVERLAY-only post-patch and explicitly left `_update_putaway_status` as the canonical legacy-fields writer.
- [[Fix-Missed-Realtime-Events-Backfill]] — The v1.6.9 backfill poller that increased the surface area of this bug by processing up-to-24h-old rows.
- [[Patterns/Agent-Self-Attribution]] — Two-step overlay pattern.
- [[Implementations/Implement-LT12-TO-Confirmation]] — The handler that calls `_update_putaway_status`.
- [[Components/Omni-Agent - Headless SAP Agent]] — Component note (Recent additions appended).
- [[Sessions/2026-05-06]] — Session log.
