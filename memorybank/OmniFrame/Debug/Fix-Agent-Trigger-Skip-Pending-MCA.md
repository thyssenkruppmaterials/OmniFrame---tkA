---
tags: [type/debug, status/active, domain/frontend, domain/integration]
created: 2026-04-27
---
# Fix - Agent Trigger Skip Pending MCA Rows

## Problem
The **Auto-Confirm Completed Putaways** agent trigger (and its UPDATE-variant sibling) fires LT12 against the SAP GUI for any row in `rf_putaway_operations` with `to_status = 'Completed'`. The Supabase realtime filter `to_status=eq.Completed` is the only condition Supabase enforces server-side, so rows with `is_mca_workflow = true` (which surface in the UI as **"Pending MCA"**) were also being auto-confirmed. Those rows belong to a separate manual review workflow and should not be touched by the auto-confirm trigger.

Why not just add `is_mca_workflow=eq.false` to the trigger filter? Supabase `postgres_changes` channels only support **one equality filter per channel**, so a compound `to_status AND is_mca_workflow` filter is not expressible at the realtime layer.

## Fix
Client-side guard added in `src/features/admin/sap-testing/hooks/use-agent-trigger-runtime.ts` inside `enqueueFire`, **before** the rate-limit accounting:

```ts
if (
  trigger.action.endpoint === '/sap/confirm-to' &&
  trigger.source.table === 'rf_putaway_operations' &&
  row.is_mca_workflow === true
) {
  onLogRef.current({
    triggerId: trigger.id,
    triggerName: trigger.name,
    status: 'skipped',
    message: `Skipped: is_mca_workflow=true (Pending MCA — auto-confirm only handles non-MCA putaways)`,
  })
  return
}
```

### Why `enqueueFire` (and not the realtime callback)?
- Single chokepoint for both realtime events AND test fires.
- Test fires with synthetic `{ is_mca_workflow: true }` rows now show the same `skipped` log, so users get truthful dry-run behavior.
- Future source types (poll, webhook) inherit the guard for free.
- Doesn't consume a rate-limit slot or queue slot for skipped rows.

### Why hard-coded (not a trigger config field)?
- The user explicitly asked for this behavior on the auto-confirm putaway trigger, not as an opt-in toggle.
- It's a safety property, not a preference — firing LT12 on an MCA row is always wrong.
- Avoids a localStorage data migration for existing user triggers.
- Custom triggers that share the same `/sap/confirm-to` + `rf_putaway_operations` shape automatically inherit the protection.

## Template Description Update
Both built-in templates in `agent-triggers-tab.tsx` (`Auto-Confirm Completed Putaways` INSERT and `Auto-Confirm Pending TO Updates` UPDATE) had their descriptions updated to mention the MCA skip behavior. So users see the rule in the template picker before adding the trigger.

## Test Plan
1. Create a test row in `rf_putaway_operations` with `to_status='Completed'`, `is_mca_workflow=true` → trigger fires once, log shows `skipped: is_mca_workflow=true (Pending MCA ...)`, no LT12 GUI call.
2. Same row but `is_mca_workflow=false` → trigger fires, LT12 runs, row patched to `TO Confirmed`.
3. Test Fire dialog with a synthetic row containing `is_mca_workflow: true` → same skip behavior; no agent call.
4. Custom user trigger pointed at `/sap/confirm-to` + `rf_putaway_operations` with no filter → still skips MCA rows.

## Files Touched
- `src/features/admin/sap-testing/hooks/use-agent-trigger-runtime.ts` — added `enqueueFire` guard
- `src/features/admin/sap-testing/components/agent-triggers-tab.tsx` — updated template descriptions

## Related
- [[Agent-Triggers - Realtime Automation]]
- [[PutawayLogService - Supabase Service]]
- [[Omni-Agent - Headless SAP Agent]]
- [[Sessions/2026-04-27]]
