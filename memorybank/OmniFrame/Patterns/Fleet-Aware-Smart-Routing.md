---
tags: [type/pattern, status/active, domain/frontend, domain/backend]
created: 2026-04-30
---

# Pattern — Fleet-Aware Smart Routing for Agent Capabilities

## Purpose / Context

A single user can have **multiple OmniFrame agents** in their org's fleet — typically one local dev/test agent on their laptop and one production v1.6.6+ agent inside Citrix. They open OmniFrame from outside Citrix → the on-prem `localhost:8765` agent the page detects is the LOCAL one (often older / missing capabilities), even though the org's fleet has a perfectly capable remote agent online.

Before this pattern landed, surfaces like the SmartImportButton (`Outbound Apps Data Manager` → "Import via Agent") were gated *only* on the LOCAL agent's `hasCapability('import-lt22')`. Result: an ancient v1.0.0 dev agent on the user's Mac kept the button greyed out with `"upgrade to enable"` even though `USINDPR-CXA105V-…` (v1.6.6) was online and capable. The user had to physically RDP into Citrix and trigger the import from there — the queue was *built* for cross-machine fan-out, but the UI wasn't using it.

This pattern formalises **when** to extend a capability-gated control to fleet-route through the queue and **when not to**.

## Pattern

```ts
// 1. The hook now exposes BOTH local + fleet awareness.
const { available, hasCapability, fleet, fleetHasCapability, bestAgentFor } =
  useAgentDetection()

// 2. The button decides where the work goes BEFORE rendering copy / state.
const route = bestAgentFor('import-lt22')   // 'local' | 'fleet' | null

// 3. The control activates whenever route !== null.
//    - 'local' → existing direct-fire / dialog flow.
//    - 'fleet' → opens dialog; dialog auto-pins the queue job to the
//                fleet agent that has the capability.
//    - null    → greyed state + smarter copy that names BOTH paths
//                to recovery (upgrade local OR bring a fleet agent online).
```

### Routing decision (`bestAgentFor`)

```
             ┌── local available + recent + has cap?  ── yes ──→  'local'
             │                                                  (latency wins; user can WATCH SAP)
  cap ?────→ │
             │── any online fleet agent has cap?     ── yes ──→  'fleet'
             │                                                  (queue claims + runs cross-machine)
             └── neither                            ──────────→  null
                                                                (caller falls back to manual UI)
```

### When to fleet-route

A capability-gated control is a **good fit** for fleet routing when ALL hold:

1. **The agent endpoint is queue-safe** — it doesn't depend on the caller's
   browser session, the local SAP COM bridge being attached *to that user*, or
   any other state that can't be reproduced on a remote agent.
2. **Result delivery is decoupled from the caller** — the agent writes the
   result to Supabase (or another shared store) and the UI subscribes via
   Realtime. The caller doesn't expect a synchronous JSON response from the
   local fetch.
3. **The action is idempotent or cheaply re-runnable** — a queue claim CAN
   fail mid-flight, get reclaimed, etc. Use `idempotency_key` to dedupe.
4. **No interactive prompt mid-action** — the local agent flow may pop the
   user a dialog ("select valid SAP session") which only makes sense if the
   user is actually at that screen. The remote agent has no UI surface back
   to the caller.

### When NOT to fleet-route

The inverse — controls that MUST stay local-only:

- **Inventory Management `runQuery` / `runMutation`** (LT10, MM02 bin lookup,
  `material_master_read.read_bin`, etc.). These need the LOCAL SAP session the
  user is signed into; pulling "my" bin stock from a remote SAP session that
  *isn't* signed in as me is wrong (RLS / data scoping breaks).
- **SAP Recorder** — captures UI events from the local SAP GUI. Remote agent
  has no SAP GUI for the caller to drive.
- **Reversal Engine "compute inverse"** — synchronous response shape; the
  panel renders the preview from the JSON body. Trivial to migrate to the
  queue but the existing UX assumes an instant reply.
- ~~**Agent Triggers banner** — already operates on the agent that owns the
  trigger (the fleet agent's own subscription drives the work). The browser
  doesn't decide which agent fires; the agent does. No change needed.~~
  **Superseded 2026-05-01 (v1.6.7 follow-up).** This was wrong. The browser
  *did* decide whether to also fire — `useAgentTriggerRuntime`'s
  `agentSideTriggersActive` gate was local-only, so users opening OmniFrame
  on a machine whose local agent was old/missing would double-fire and
  overwrite the Citrix agent's `confirmed_by_label = 'Omni Agent'` with
  their own `auth.uid()`. The gate is now `localAgentSideTriggers ||
  fleetAgentSideTriggers`. See [[Sessions/2026-05-01]].

The **current users** of fleet-aware routing are:
1. The SmartImportButton's outbound LT22 import (`import-lt22` capability).
2. The Agent Triggers tab's browser-side runtime suppression
   (`agent-side-triggers` capability, v1.6.7 follow-up — see below).

New surfaces should opt in deliberately — over-extending the pattern
silently turns local-context-dependent operations into broken remote calls.

## Implementation primitives

### `useAgentDetection` (shared hook, module-scoped)

- Local probe — `agentFetch('/health')` every 5s (existing).
- **NEW** Fleet probe — Supabase `sap_agents WHERE status='online' AND organization_id=<org>` every 5s + Realtime subscription on the table for snappy status flips. Skipped entirely for anonymous web sessions (no signed-in Supabase user → empty fleet, no RLS noise).
- Module-scoped cache means N components mounting the hook share ONE poller, ONE Realtime channel, ONE in-flight probe.

### Auto-pinning queue jobs

When the dialog enqueues a `sap_agent_jobs` row and the routing decision is `'fleet'`:

```ts
const effectivePinnedAgentId =
  pinnedAgentId ||                                 // user's manual pick wins
  (route === 'fleet' && fleetAgent ? fleetAgent.id : null)  // else auto-pin

// jobInsert.assigned_agent_id = effectivePinnedAgentId
```

The auto-pin ensures the v1.0.0 local agent (which polls the queue but doesn't
expose `/sap/import-lt22`) **never** claims a job it can't actually run. The
claim function (`claim_sap_agent_job`) honours `assigned_agent_id` — if set,
only that agent can claim.

### Smart copy in three states

| State              | Primary label                       | subLabel                              | Description (tooltip / dropdown row)                                                                                                                  | Enabled |
|--------------------|-------------------------------------|---------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|---------|
| local-good         | `Import via Agent`                  | `<hostname>`                          | Pull live LT22 open transfer orders directly from SAP via the on-prem agent.                                                                          | yes     |
| fleet-good         | `Import via Agent (Fleet)`          | `via <fleet-id> · v<ver>`             | Routing through fleet agent <id> via the queue. Local agent (v1.0.0) lacks the capability; the job will be claimed and run on a remote Citrix box.    | yes     |
| both-bad           | `Import via Agent`                  | `<hostname> · v<ver> — upgrade to enable` | Local agent (v1.0.0) is too old. No other agents in your fleet have `import-lt22`. Upgrade your local agent OR ensure a remote agent (v1.6.6+) is online. | no    |
| no infrastructure  | (option hidden, CSV becomes primary)| —                                     | —                                                                                                                                                      | hidden  |

The button + dialog *copy* makes the routing decision visible — never silently
fan out to a remote agent without telling the user.

## File paths

- `src/features/admin/sap-testing/hooks/use-agent-detection.ts` — `FleetAgent`, `FleetSnapshot`, `fleet`, `fleetHasCapability`, `bestAgentFor`, fleet poller + Realtime subscription.
- `src/components/outbound-data-manager.tsx` — SmartImportButton routing + smart copy.
- `src/features/outbound/components/import-lt22-dialog.tsx` — agent strip + submit gate + auto-pin on `assigned_agent_id`.
- `src/features/admin/sap-testing/lib/agent-fetch.ts` — `LATEST_AGENT_VERSION` doc-block records the `job-queue-fleet-routing` frontend feature.
- `src/features/admin/sap-testing/components/agent-triggers-tab.tsx` (v1.6.7) — `agentSideTriggersActive` now uses `localAgentSideTriggers || fleetAgentSideTriggers`; violet banner shows `via <fleet-hostname> · v<ver>` when ONLY the fleet has the cap.
- `src/features/admin/sap-testing/hooks/use-agent-trigger-runtime.ts` — *unchanged*. The two `agentSideTriggersActive` gates (`enqueueFire` short-circuit + Realtime subscription bail-out) already do the right thing once the input is correct.

## Updates

- **v1.6.7 follow-up (2026-05-01):** same gate now applied to `useAgentTriggerRuntime`'s `agentSideTriggersActive`. The Agent Triggers banner uses `localAgentSideTriggers || fleetAgentSideTriggers` so the browser-side runtime correctly cedes to a remote v1.6.7+ agent that owns the `rf_putaway_operations` subscription. Banner copy mirrors the SmartImportButton's `via <hostname> · v<ver>` format. Files: `src/features/admin/sap-testing/components/agent-triggers-tab.tsx` (~+22 LOC). See [[Sessions/2026-05-01]].

## Related

- [[Smart-Import-Button]] — the visual primitive this pattern extends.
- [[Agent-Capability-Negotiation]] — `hasCapability` is the gate; `bestAgentFor` is the *router*.
- [[Implementations/Job-Queue-Architecture]] — the underlying queue (`sap_agent_jobs`) + claim function.
- [[Implementations/Implement-Fleet-Aware-SmartImportButton]] — the v1.6.6 follow-up that introduced this pattern.
- [[Debug/Fix-Agent-Triggers-Browser-Dependency]] — the v1.6.4 origin of `agent-side-triggers` (where the gate was first introduced, local-only).
- [[Components/Omni-Agent - Headless SAP Agent]] — `_agent_self_id()` (stable id format used as `assigned_agent_id`).
- [[Sessions/2026-04-30]]
- [[Sessions/2026-05-01]] — v1.6.7 fleet-aware trigger suppression follow-up.
