---
tags: [type/pattern, status/active, domain/backend, domain/database, domain/auth]
created: 2026-04-30
---

# Pattern — Agent Self-Attribution Under a User's JWT

## Problem

When an autonomous agent acts on a user's behalf — e.g. the OmniAgent's `_HARDCODED_TRIGGERS` flow auto-confirming a TO via the user's Supabase JWT — the audit trail conflates the user with the agent. Any column the agent writes that's keyed off the JWT (`auth.uid()`, the user's `user_id`, etc.) credits the user, even though it was the agent that actually decided + executed the action.

In the v1.6.4 → v1.6.5 implementation, this manifested as: the putaway log UI showed the user's display name in the **Confirmed By** column for TOs that the agent had auto-confirmed via Realtime triggers. Warehouse leads couldn't tell at a glance which TOs were human-driven vs automation-driven.

The naive fix — "set `confirmed_by = NULL` when the agent acts" — breaks RLS (users can't read rows where they're not in the `confirmed_by` ownership chain) AND breaks every productivity rollup that joins on `confirmed_by` (we have at least 8 of those: 085_team_performance_optimization, 156_fix_putaway_double_count, 169_customer_portal_productivity, 188_add_cart_stow_to_productivity, 091_dynamic_activity_events_integration, 086_dynamic_activity_configuration, 093_fix_dynamic_activity_org_filter, 158_fix_rpc_type_mismatches).

## Pattern

**Keep the existing UUID owner column unchanged. Add adjacent text columns for the honest label + the stable agent identifier. The UI prefers the label when present.**

For `rf_putaway_operations` (v1.6.6, migration 251):

```sql
ALTER TABLE public.rf_putaway_operations
  ADD COLUMN IF NOT EXISTS confirmed_by_label    text,
  ADD COLUMN IF NOT EXISTS confirmed_by_agent_id text;
```

| Column | Type | Purpose | Set by |
|---|---|---|---|
| `confirmed_by` | `uuid → user_profiles(id)` | RLS owner + productivity join key | Always = JWT-holder's user_id, regardless of who decided |
| `confirmed_by_label` | `text` | Display string for UI | "Omni Agent" when agent decided, NULL when human decided (UI falls back to user_profiles.full_name) |
| `confirmed_by_agent_id` | `text` | Stable agent id for fleet filtering | `_agent_self_id()` ("USINDPR-Console-jsingh") when agent decided, NULL when human |

The UI reads:

```ts
const rawLabel = item.confirmed_by_label
const agentLabel =
  typeof rawLabel === 'string' && rawLabel.trim().length > 0
    ? rawLabel
    : 'OmniAgent'  // pre-v1.6.6 fallback for `agent_trigger` rows
```

So future relabels ("Omni Agent" → "OmniFrame Bot" → "Aria-Putaway-1") are pure DB writes; no UI ship needed.

## Why not just two source tags?

You could in principle distinguish via `confirmed_source` alone:

- `confirmed_source='manual'` → show `user_profiles.full_name`
- `confirmed_source='agent_trigger'` (browser-side) → show "OmniAgent"
- `confirmed_source='agent_trigger_direct'` (agent-side) → show "OmniAgent"
- `confirmed_source='agent_one_click_ship'` → show "OmniAgent"

That works for the binary "human vs agent" distinction. But it doesn't carry per-action display nuance (e.g. "Aria-Putaway-1" vs "Cleo-Replenishment-2" once we have multi-personality agents) and it doesn't tell ops _which physical agent box_ confirmed when several Citrix sessions are running. The label + agent_id pair is the future-proof shape.

## When to use this pattern

- An autonomous service writes to a table where an existing UUID FK identifies "who did it" for ownership / RLS / reporting purposes.
- That UUID FK is a foreign key into a user table, and you can't just put a string there.
- You want the UI to display the autonomous service's identity without breaking the FK.

## When NOT to use this pattern

- Greenfield tables — start with `created_by_actor_id` (text), `created_by_actor_kind` (enum: 'user' | 'agent' | 'system'), and `created_by_user_id` (UUID FK, nullable) from day one.
- Tables where the writer is always a human (no agents touch them) — pure overhead.
- Tables where productivity rollups don't matter — you can keep `confirmed_by = NULL` and use a single `actor_label` column.

## Two-step overlay pattern (v1.6.8)

When the column-set splits across an existing **legacy patcher** (writes the traditional ownership/timestamp/status columns) and a new **attribution patcher** (writes the overlay columns from this pattern), the two patchers MUST own disjoint column sets. Trying to make both write all columns races and silently breaks attribution.

In OmniAgent (`omni_agent/agent.py`), the agent-side trigger flow has exactly this shape:

| Patcher | When | Owns |
|---|---|---|
| `_update_putaway_status` | Synchronously, from inside `confirm_transfer_order`, immediately after a successful SAP LT12. | `to_status` (`'TO Confirmed'`), `confirmed_at`, `confirmed_by` (UUID FK to JWT-holder). |
| `_apply_trigger_post_patch` | Asynchronously, from the job poller AFTER the handler returns successfully. | `confirmed_source`, `confirmed_by_label`, `confirmed_by_agent_id` — the OVERLAY columns. |

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
    # filter here would always match 0 rows.
    url = f"{state.supabase_url}/rest/v1/{table}?id=eq.{row_id}"
    # ... PATCH with Prefer: return=representation, count rows_affected,
    # WARN on 0
```

### The bug that motivated the rule (v1.6.7 → v1.6.8)

v1.6.6 + v1.6.7 had `_apply_trigger_post_patch` write the FULL body (legacy 3 + attribution 3) with a `skip_if = {to_status: 'TO Confirmed'}` idempotency filter. The filter was encoded as `&to_status=neq.TO%20Confirmed`. But `_update_putaway_status` had already flipped `to_status='TO Confirmed'` synchronously — so the filter ALWAYS matched 0 rows. PostgREST returned 200 OK with empty body, the agent logged "applied", and the OVERLAY columns silently stayed NULL forever. See [[Debug/Fix-Agent-Dual-Patcher-Race]] for the full diagnosis.

### Rules for the two-step overlay

1. **Each patcher owns a disjoint column set.** No column appears in both PATCH bodies.
2. **The OVERLAY patcher does not gate on columns it doesn't own.** Specifically: NO `skip_if` on `to_status` if the legacy patcher already set it. (It can still gate on its OWN columns — e.g. `confirmed_source IS NULL` to dodge re-applying after a manual override.)
3. **The OVERLAY patcher uses `Prefer: return=representation` and counts rows.** A `rows_affected == 0` is suspicious — log it as WARN with the field values, don't bury it in a successful-looking line.
4. **Document the cooperation at BOTH function tops.** Future engineers reading either function in isolation must understand that the other one runs.

### Why not consolidate to one patcher?

It's tempting to "just" make `_update_putaway_status` write all six columns (or remove it and let `_apply_trigger_post_patch` own everything). Both options break:

- **Plumbing trigger meta into `_update_putaway_status`** would require every SAP handler that calls it (`confirm_transfer_order` today, more soon) to thread the `__omni_trigger_meta.post_success_patch` through. The function lives 5 layers deep inside the handler. Plumbing kills future-handler ergonomics.
- **Removing `_update_putaway_status` and letting `_apply_trigger_post_patch` own everything** breaks the manual-user-click path (`POST /sap/confirm-to`) which has no `__omni_trigger_meta` to drive the post-patch — we'd have to invent a synthetic post-patch on every direct call.

The disjoint-column overlay (this pattern) keeps each function's responsibilities focused: the in-handler patcher owns the "this row was confirmed" facts (which always need to be written, regardless of caller), the post-handler overlay patcher owns the "and HERE'S who/what confirmed it" facts (which only the trigger meta knows about).

The browser-side equivalent (`applyPostSuccessPatch` in `use-agent-trigger-runtime.ts`) cooperates the same way: the in-handler `confirmTransferOrder` mutation writes the legacy 3 fields, then the post-success patch writes the overlay 3.

## Related

- [[Components/Agent-Triggers - Realtime Automation]] — the agent-side flow that benefits from this
- [[Components/Omni-Agent - Headless SAP Agent]] — where `_agent_self_id()` is defined
- [[Debug/Fix-Agent-Triggers-Browser-Dependency]] — origin of the `agent_trigger_direct` source tag (v1.6.4)
- [[Debug/Fix-Agent-Dual-Patcher-Race]] — the v1.6.7 → v1.6.8 race that motivated the "Two-step overlay pattern" rules above
- [[Implementations/Implement-Agent-SAP-AutoConnect]] — the v1.6.6 sibling change
- [[Sessions/2026-04-30]]
- [[Sessions/2026-05-01]]
