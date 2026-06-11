---
tags: [type/debug, status/active, domain/backend, domain/database, domain/infra]
created: 2026-05-01
---
# Fix — Agent-Internal Dual-Patcher Race on TO Confirms (v1.6.8)

## Symptoms

After v1.6.6 + v1.6.7 shipped honest agent attribution (the `confirmed_by_label = "Omni Agent"` / `confirmed_by_agent_id = <stable agent id>` columns from migration 251), the SAP Testing → Putaway Log table was *still* showing the user's display name ("Jai Singh") in the **Confirmed By** column for TOs that the agent had auto-confirmed via Realtime triggers. The row was correctly flipped to **TO Confirmed**, the timestamps were right, but every attribution column was NULL:

```sql
SELECT id, to_number, to_status, confirmed_by, confirmed_by_label,
       confirmed_by_agent_id, confirmed_source
  FROM rf_putaway_operations
 WHERE confirmed_at >= now() - interval '1 day'
   AND confirmed_at IS NOT NULL
 ORDER BY confirmed_at DESC LIMIT 5;
```

Every recent agent-confirmed row had:
- `to_status = 'TO Confirmed'` ✓
- `confirmed_at = <correct UTC>` ✓
- `confirmed_by = <user JWT id>` ✓
- `confirmed_by_label = NULL` ✗ (should have been `'Omni Agent'`)
- `confirmed_by_agent_id = NULL` ✗ (should have been `'USINDPR-Console-jsingh'`)
- `confirmed_source = NULL` ✗ (should have been `'agent_trigger_direct'`)

The agent console log meanwhile printed `[triggers] post-success PATCH rf_putaway_operations/<row_id> applied (job <job_id>)` with no errors. PostgREST returned 200 OK on every PATCH. So the bug was *invisible* to anyone reading the logs — it looked like everything was working.

The frontend wasn't broken either: the v1.6.6 UI logic correctly preferred `confirmed_by_label` when present and fell back to `user_profiles.full_name` when NULL. With every label NULL, the fallback path was being exercised universally — making it look exactly like the v1.6.6 attribution bug all over again, even though that bug had been fixed two days ago.

## Root cause — TWO patchers fight on every agent-side TO confirm

The agent has TWO functions that write to `rf_putaway_operations` after a successful agent-side LT12 confirm. They run in sequence on the same row, and the SECOND one was silently no-op'ing.

### Patcher 1 — `_update_putaway_status` (called from inside `confirm_transfer_order`, around line 2727)

```python
def _update_putaway_status(to_number: str, warehouse: str):
    # ...
    requests.patch(
        f"{state.supabase_url}/rest/v1/rf_putaway_operations"
        f"?to_number=eq.{to_number}"
        f"&warehouse=eq.{warehouse}"
        f"&to_status=neq.TO%20Confirmed"
        f"&created_at=gte.{today}",
        json={
            "to_status": "TO Confirmed",
            "confirmed_by": state.user_id,
            "confirmed_at": datetime.utcnow().isoformat() + "Z",
        },
        # ...
    )
```

This is the LEGACY patcher — it predates v1.6.4 agent-side triggers. It writes the 3 traditional fields (`to_status`, `confirmed_by`, `confirmed_at`) and is called unconditionally after every successful LT12, regardless of whether the source was a manual user click or an agent-side trigger.

### Patcher 2 — `_apply_trigger_post_patch` (called by the job poller AFTER the handler returns, around line 2359)

```python
def _apply_trigger_post_patch(post_patch: dict, job_id: str) -> None:
    # ...
    body = dict(post_patch.get("patch") or {})  # <— FULL body
    skip_if = post_patch.get("skip_if") or {}
    # ...
    qs = [f"id=eq.{row_id}"]
    for k, v in skip_if.items():
        qs.append(f"{k}=neq.{v}")  # <— THE BUG
    url = f"{state.supabase_url}/rest/v1/{table}?{'&'.join(qs)}"
    requests.patch(url, json=body, ...)
```

The trigger row carried in `payload.__omni_trigger_meta.post_success_patch` was:
```json
{
  "table": "rf_putaway_operations",
  "row_id": "<uuid>",
  "patch": {
    "to_status": "TO Confirmed",
    "confirmed_at": "2026-05-01T...",
    "confirmed_by": "<user-id>",
    "confirmed_source": "agent_trigger_direct",
    "confirmed_by_label": "Omni Agent",
    "confirmed_by_agent_id": "USINDPR-Console-jsingh"
  },
  "skip_if": { "to_status": "TO Confirmed" }
}
```

The intent of `skip_if` was: don't blindly re-apply this patch if the row is already at the target state (idempotency guard for retries). PostgREST encodes it as `&to_status=neq.TO%20Confirmed`, so the WHERE clause becomes:

```sql
WHERE id = '<uuid>' AND to_status <> 'TO Confirmed'
```

### The race

In the agent-side path, the call ordering is:

1. `confirm_transfer_order` runs end-to-end (LT12 GUI scripting, save, status check).
2. Inside it, `_update_putaway_status(to_number, warehouse)` runs as the last step before the handler returns. **`to_status` flips to `'TO Confirmed'` here.**
3. The handler returns `{"ok": True, ...}` to the job poller.
4. The poller, seeing success, runs `_apply_trigger_post_patch(post_patch, job_id)`.
5. The PATCH URL contains `&to_status=neq.TO%20Confirmed` — but step 2 already set `to_status='TO Confirmed'`, so **the row no longer matches the WHERE clause**.
6. PostgREST returns 200 OK with `[]` (zero rows updated). The function logs `applied`. Net effect: **all six fields stayed at whatever they were before — and on a fresh INSERT all six were NULL.**

The legacy 3 fields *do* get set — but by patcher 1, not patcher 2. Patcher 2 was supposed to add the OVERLAY (attribution) fields on top, and that's exactly the part that silently broke.

The browser-side path doesn't have this bug because there's no `_update_putaway_status` call there — the browser's `applyPostSuccessPatch` is the *only* writer, so it owns all six fields and `skip_if` works as intended.

### Why it took two days to notice

- The browser-side path (where most testing happens during dev) wasn't affected.
- The agent-side path was only exercised in the user's actual production Citrix environment after fleet-aware trigger suppression rolled out yesterday ([[Sessions/2026-05-01]]).
- The agent log printed "applied" with no error.
- PostgREST returned 200 OK with no warning.
- The UI gracefully fell back to `user_profiles.full_name` so users saw a human name in the column instead of "(unknown)" — making the failure look like a *display* bug rather than a data-write bug.

## Fix — Overlay-only body in `_apply_trigger_post_patch`

The fix is surgical. We change `_apply_trigger_post_patch` so it OWNS only the attribution columns and `_update_putaway_status` keeps owning the legacy 3. Two cooperating writes on disjoint column sets — no race possible.

```python
def _apply_trigger_post_patch(post_patch: dict, job_id: str) -> None:
    # ...
    body = {
        k: v for k, v in (post_patch.get("patch") or {}).items()
        if k in ("confirmed_source", "confirmed_by_label", "confirmed_by_agent_id")
    }
    if not table or not row_id or not body:
        return
    # NO `skip_if` — the legacy `_update_putaway_status` already set
    # `to_status='TO Confirmed'`. Re-applying a `&to_status=neq.TO%20Confirmed`
    # filter here would always match 0 rows (the v1.6.7 race condition).
    url = f"{state.supabase_url}/rest/v1/{table}?id=eq.{row_id}"
    resp = requests.patch(
        url,
        json=body,
        headers={**_supabase_headers(), "Prefer": "return=representation"},
        # ...
    )
    # ...rows_affected counted from resp.json(); WARN log on 0...
```

Five things changed:
1. **Body is filtered to ONLY the three OVERLAY columns** — `confirmed_source`, `confirmed_by_label`, `confirmed_by_agent_id`. Legacy 3 fields never sent.
2. **`skip_if` is dropped entirely.** Since we no longer touch `to_status`, there's no double-write risk to guard against.
3. **`Prefer: return=minimal` → `Prefer: return=representation`.** Lets us read the response body and count rows affected.
4. **New diagnostic log line** prints the actual field values + `rows_affected=N`. On `rows_affected == 0` the prefix becomes `WARN ` so the next regression of this kind shows up loud.
5. **The v1.6.7 self-healing `_TRIGGER_DROP_AGENT_ATTRIBUTION` fallback is preserved** — it still strips `confirmed_by_label` + `confirmed_by_agent_id` when migration 251 isn't yet visible to PostgREST and re-attempts the full schema after a 5-min cooldown. With overlay-only filtering, the fallback's stripped-down body is `{"confirmed_source": "agent_trigger_direct"}` — still useful, still non-empty.

A small comment was also added to `_update_putaway_status` calling out the overlay pattern so future engineers reading either function understand they cooperate:

```python
# NOTE: This sets the LEGACY 3 fields only. Agent-side trigger flow
# overlays `confirmed_source`, `confirmed_by_label`, `confirmed_by_agent_id`
# in `_apply_trigger_post_patch` (called after the handler returns).
# Don't try to set those here — the trigger meta isn't accessible from
# this function and we'd need to plumb it through every handler. The
# overlay pattern keeps the change surgical. See [[Patterns/Agent-Self-Attribution]].
```

No logic change inside `_update_putaway_status`. No handler changes. No frontend logic changes (the version constant is the only frontend touch).

## New log line format

After the fix, every successful agent-side TO confirm prints:

```
[triggers] post-success PATCH rf_putaway_operations/<row_id> applied — overlay fields: source=agent_trigger_direct, label='Omni Agent', agent_id=USINDPR-Console-jsingh (rows_affected=1) (job <job_id>)
```

Or on a regression (PATCH no-op):

```
[triggers] WARN post-success PATCH rf_putaway_operations/<row_id> applied — overlay fields: source=agent_trigger_direct, label='Omni Agent', agent_id=USINDPR-Console-jsingh (rows_affected=0) (job <job_id>)
```

The WARN variant is the diagnostic that would have caught this bug 30 seconds after v1.6.7 shipped.

## Verification

- AST parse: `python3 -c "import ast; ast.parse(open('omni_agent/agent.py').read())"` → OK.
- `npm run build` → clean, 8.87s, 181 PWA precache entries.
- `ReadLints` → no lints on `agent.py` or `agent-fetch.ts`.
- Copied `agent.py` → `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py` for Parallels rebuild.

User to verify post-rebuild by:
1. Run `cd omni_agent && build_exe.bat` on Parallels Windows.
2. Re-launch `OmniFrame_Agent.exe` on Citrix.
3. Trigger an agent-side TO confirm (any putaway flagged for auto-confirm).
4. Watch agent console for the new log line — `rows_affected=1` confirms the OVERLAY landed.
5. SQL spot-check:
   ```sql
   SELECT to_number, to_status, confirmed_by_label, confirmed_by_agent_id, confirmed_source
     FROM rf_putaway_operations
    WHERE confirmed_at >= now() - interval '5 minutes'
    ORDER BY confirmed_at DESC LIMIT 3;
   ```
   All three attribution columns should be non-NULL.
6. UI check: Putaway Log "Confirmed By" column should show **"Omni Agent"** with the bot icon for the new row, not the user's full name.

## Files modified

| File | Change | LOC |
|------|--------|-----|
| `omni_agent/agent.py` | Replaced `_apply_trigger_post_patch` body; added overlay-pattern comment to `_update_putaway_status`; bumped `AGENT_VERSION = "1.6.8"` with banner | +66 / -28 |
| `src/features/admin/sap-testing/lib/agent-fetch.ts` | Bumped `LATEST_AGENT_VERSION = '1.6.8'` + comment block | +9 / -1 |
| `/Users/jaisingh/Downloads/MacWindowsBridge/Omni-Agent/agent.py` | Mirrored copy for Parallels rebuild | (full file) |

## Why this fix and not the alternatives

### Alternative 1 — drop `skip_if` only, keep the full body
Would have fixed the immediate symptom (PATCH would land), but two patchers writing the same legacy 3 fields back-to-back leaves a tiny window where a Realtime subscriber could observe a `(to_status='TO Confirmed', confirmed_by=…)` row, then a redundant `(to_status='TO Confirmed', confirmed_by=…)` UPDATE, generating a spurious second event downstream. Overlay-only avoids the duplicate UPDATE entirely.

### Alternative 2 — remove `_update_putaway_status` and let `_apply_trigger_post_patch` own everything
Would require plumbing the trigger meta into every handler that today calls `_update_putaway_status` (only `confirm_transfer_order` today, but more handlers will follow). Also breaks the manual-user-click path: a user hitting `POST /sap/confirm-to` directly has no `__omni_trigger_meta` to drive the post-patch, so we'd have to invent a synthetic post-patch on every direct call. The overlay split keeps both paths simple.

### Alternative 3 — make `_update_putaway_status` set the attribution columns too
Would require it to know whether it's running under a trigger context (and which trigger). The function is called from inside the handler, well before the poller has any idea what the trigger meta said. Plumbing the meta through every handler is the same anti-pattern as alternative 2.

The overlay split (this fix) keeps each function's responsibilities disjoint and matches how the existing browser-side `applyPostSuccessPatch` already cooperates with the in-handler legacy patcher when running browser-mode. It's the minimum-surface-area fix consistent with the existing architecture.

## Related

- [[Patterns/Agent-Self-Attribution]] — defines the OVERLAY pattern formally; this fix is the canonical example
- [[Components/Omni-Agent - Headless SAP Agent]] — adds v1.6.8 to "Recent additions"
- [[Patterns/Self-Healing-Schema-Fallback]] — `_TRIGGER_DROP_AGENT_ATTRIBUTION` (preserved unchanged)
- [[Debug/Fix-Agent-Triggers-Browser-Dependency]] — origin of `agent_trigger_direct` source tag (v1.6.4) and `_apply_trigger_post_patch` itself
- [[Debug/Fix-Agent-Fleet-Bloat-And-Token-Rotation]] — `_agent_self_id()` (v1.6.5)
- [[Sessions/2026-05-01]]
- [[Sessions/2026-04-30]] — v1.6.6 attribution feature this fix unblocks
