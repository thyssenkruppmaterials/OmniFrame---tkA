---
tags: [type/implementation, status/active, domain/infra, domain/frontend]
created: 2026-04-16
---
# Implement Agent Triggers — Realtime Automation

## Context
After shipping One Click Ship as a manually-triggered SAP flow, the next logical step was to turn **database events** into **automatic SAP transactions**. The user's framing: treat the web app as the orchestrator and SAP as a capability, so any Supabase event can drive an SAP fire.

Built as a new tab `Agent Triggers` (8th tab in SAP Testing admin page) that manages rules and runs them at runtime.

## Deliverables

### 1. Runtime hook: `use-agent-trigger-runtime.ts`
**File:** `src/features/admin/sap-testing/hooks/use-agent-trigger-runtime.ts`

A dedicated React hook that:
- Subscribes to Supabase Realtime channels for each enabled trigger
- Serializes fires through a single global queue (SAP is single-threaded per session)
- Rate-limits per-trigger (default 30 fires/min)
- Switches SAP session via `/sap/session` when trigger has `sessionBinding: 'specific'`
- Interpolates `${row.field}` placeholders in payload templates
- Defense-in-depth filter check (re-validates client-side)
- Handles agent-offline with `skipped` log entries (subscriptions stay alive)
- Exposes `testFire(trigger, row)` for manual testing

Exposes the shared type definitions (`AgentTrigger`, `EventLogEntry`, `TriggerSource`, etc.) so the tab component imports them from here.

### 2. Tab component: `agent-triggers-tab.tsx`
**File:** `src/features/admin/sap-testing/components/agent-triggers-tab.tsx`

Broken into discrete sub-components:
- `AgentTriggersTab` — main container, owns state, wires the runtime hook
- `AgentStatusBar` — unified agent + SAP session status
- `StatCard` — stat tiles for Configured / Enabled / Recent Events
- `EmptyTriggersCard` — empty state with "Add your first trigger" CTA
- `TriggerCard` — one card per trigger with live status badge, switch, test/edit/delete buttons, meta grid, stats
- `MetaRow` — icon + label + value row (used inside TriggerCard)
- `EventLogCard` / `EventLogRow` — scrollable event log
- `TemplatePickerDialog` — 3 starter templates + blank
- `EditTriggerDialog` — form to edit name/source/action/session binding
- `TestFireDialog` — synthetic row input, bypasses Supabase, fires directly

### 3. Tab registration
**File:** `src/features/admin/sap-testing/index.tsx`
- Added `AgentTriggersTab` import
- Added `{ id: 'agent-triggers', label: 'Agent Triggers' }` to `SAP_TESTING_TABS`
- Added `case 'agent-triggers'` to the renderTabContent switch

## Key Design Decisions

### Shared types live in the hook file
`AgentTrigger`, `EventLogEntry`, `TriggerSource`, `TriggerAction`, etc. are defined once in `use-agent-trigger-runtime.ts` and re-exported via `import type` in the tab. Avoids duplication and keeps the runtime self-contained.

### Serialized fire queue (not parallel)
SAP GUI is single-threaded per session. If 10 events arrive at once, firing them all in parallel would cause `findById` races and corrupt the SAP window state. The hook uses a single global queue processed by one worker with a 500ms gap between fires.

We didn't use per-session queues because there's typically only one session in use per desktop, and serializing all fires is safer than clever parallelism.

### Stable subscription dependency
The `useEffect` that manages subscriptions uses a **serialized key** instead of the full triggers array:
```ts
}, [
  triggers.filter(t => t.enabled && t.source.type === 'supabase-realtime')
    .map(t => `${t.id}|${t.source.table}|${(t.source.events ?? []).join(',')}|${t.source.filter ?? ''}`)
    .join('||'),
  enqueueFire,
])
```
This prevents re-subscribing on every stats update. Only re-subscribes when enabled-state, table, events, or filter actually change.

### Callbacks via refs
Callbacks (`onStatsUpdate`, `onLogEntry`, `onSubscriptionStatus`) are stored in refs and updated on each render. This lets the subscription effect capture them once without re-running whenever the parent re-renders.

### Rate limit buckets in ref
`rateBucketsRef.current: Map<triggerId, number[]>` — a sliding 60-second window of fire timestamps per trigger. Cleared opportunistically when new fires are enqueued.

### Local counter ref for stats
Because React state updates are async and callbacks may fire before the parent re-renders, a ref (`counterRef`) holds authoritative counts for each trigger. The ref increments synchronously, then pushes the new value to parent state.

### Session binding workflow
When a trigger has `sessionBinding: 'specific'`, the fire worker does:
```
POST /sap/session {conn_idx, sess_idx}
POST /sap/confirm-to {...}   // or /sap/process-shipment
```
The agent validates the session binding before accepting. Failed session switches are best-effort (logged but the fire still tries).

## Endpoint Policy

Only the agent's **GUI-scripting** endpoints are allowed:
- `/sap/confirm-to` (LT12 via COM scripts)
- `/sap/process-shipment` (full 6-step via COM scripts)

We deliberately excluded `/api/sap/confirm-to` (Railway-side pyrfc) because it's not integrated end-to-end. GUI scripts are the route that actually works in production today.

## Persistence

v1 uses **localStorage** on the user's browser:
- `omniframe.agent_triggers.v1` — trigger configs
- `omniframe.agent_triggers.log.v1` — event log (truncated to 200 entries)

Reasons:
- No schema migration needed
- Ships same-day
- Good enough for per-user exploration

Trade-offs:
- Triggers don't sync across browsers/devices
- No team visibility
- Cleared if user wipes site data

**Migration path** (future): move to a new `agent_triggers` table with RLS by organization, plus a `realtime` publication so multiple users see trigger updates live.

## TypeScript Fixes Encountered

### `React.ElementType` too broad for `className` prop
`React.ElementType` allows any component including intrinsic elements that don't accept `className`. TypeScript strict mode rejected `<Icon className="..." />` with `Type 'string' is not assignable to type 'never'`.

Fix: narrow to `React.ComponentType<{ className?: string }>`. Applied to `StatCard` and `MetaRow`.

### `liveStatus.icon` JSX call
Even after narrowing, calling `<liveStatus.icon />` inline got the same error. Fix: extract to a capitalized local variable `const StatusIcon = liveStatus.icon` before JSX use.

## Testing Notes

### Build verification
```bash
cd /Users/jaisingh/Documents/Projects/OneBoxFullStack
npm run build  # ✓ passes
```

### Smoke test path
1. Open Agent Triggers tab on Citrix Chrome
2. Verify green `SAP Agent Connected` status bar
3. Add Trigger → pick "Auto-Confirm Completed Putaways"
4. Enable with switch → badge flips `paused` → `subscribing` → `listening`
5. Click flask icon → fill sample row JSON (`{to_number: '...', warehouse: '...'}`) → Fire Now
6. Watch event log: `received` → `fired` → `success` or `error`
7. Toggle off → badge drops to `paused` and subscription closes

### Real-event test
- Create a row manually in Supabase matching the filter
- Confirm the event log captures `received` within ~1 second
- Confirm SAP GUI executes the transaction

## Related
- [[Agent-Triggers - Realtime Automation]] — the component itself
- [[Omni-Agent - Headless SAP Agent]] — the agent this feature drives
- [[Implement-Omni-Agent]] — agent implementation
- [[Implement-One-Click-Ship]] — manual-trigger equivalent
- [[Sessions/2026-04-16]]
