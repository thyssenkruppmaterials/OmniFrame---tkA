---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-04-30
---

# Implement — Fleet-Aware SmartImportButton (v1.6.6 follow-up)

## Purpose / Context

User report: opening **Outbound Apps Data Manager** from outside Citrix shows the SmartImportButton's `Import via Agent` option **greyed out** with `"JAISINGHB180 (Console) · v1.0.0 — upgrade to enable"` even though the org's fleet has `USINDPR-CXA105V-…` (v1.6.6, full capability set including `import-lt22`) **online**. The user does NOT want to upgrade their local v1.0.0 dev/test agent — they want the button to recognise the fleet has a capable agent and route the work via the existing `sap_agent_jobs` queue.

The queue infrastructure was built for exactly this (any agent in the org claims & processes jobs, see [[Job-Queue-Architecture]]). The dialog (`ImportLt22Dialog`) was already enqueueing through the queue. The button + dialog were just **gated only on local capability**, so the user couldn't even open the dialog. Pure frontend miss.

## What changed

Frontend-only fix. **No agent code change.** No new RLS policy. No new migrations.

### File-by-file deltas

| File | LOC delta | What |
|------|-----------|------|
| `src/features/admin/sap-testing/hooks/use-agent-detection.ts` | +207 / -10 | Added `FleetAgent`, `FleetSnapshot` types; module-scoped fleet poller + Realtime subscription on `sap_agents`; `fleet`, `fleetHasCapability`, `bestAgentFor` on the `AgentDetection` shape; `refreshAgentDetection` now refreshes both legs. |
| `src/components/outbound-data-manager.tsx` | +95 / -32 | SmartImportButton's `agent` option now derives label / subLabel / description / disabled / hidden from `bestAgentFor('import-lt22')` instead of just `hasCapability('import-lt22')`. CSV is preferred only when `route === null`. |
| `src/features/outbound/components/import-lt22-dialog.tsx` | +44 / -14 | `route` + `fleetAgent` derived from `detection.bestAgentFor('import-lt22')`; agent strip pivots to `Routing through: <fleet-id> · v<ver> (Fleet)` when fleet-routed; submit gate uses `canRoute` (was `detection.available`); queue insert auto-pins `assigned_agent_id` to the fleet agent when not manually overridden. |
| `src/features/admin/sap-testing/lib/agent-fetch.ts` | +18 / -1 | Doc-block on `LATEST_AGENT_VERSION` lists the new `job-queue-fleet-routing` frontend feature + cross-links to Patterns + Implementations notes. |

### Routing flowchart

```
             ┌── local available + recent + has cap?  ── yes ──→  'local'  (existing dialog flow; queue picks up local poller)
  cap ?────→ │
             │── any online fleet agent has cap?     ── yes ──→  'fleet'  (open dialog; auto-pin job to fleet agent)
             └── neither                            ──────────→   null    (greyed; smarter copy names BOTH paths to recovery)
```

### Smart copy table (the three live states)

| State              | Primary label                       | subLabel                              | Description (tooltip / dropdown row)                                                                                                                  | Enabled |
|--------------------|-------------------------------------|---------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|---------|
| local-good         | `Import via Agent`                  | `<hostname>`                          | Pull live LT22 open transfer orders directly from SAP via the on-prem agent.                                                                          | yes     |
| fleet-good         | `Import via Agent (Fleet)`          | `via <fleet-id> · v<ver>`             | Routing through fleet agent <id> via the queue. Local agent (v<ver>) lacks the capability; the job will be claimed and run on a remote Citrix box.    | yes     |
| both-bad           | `Import via Agent`                  | `<hostname> · v<ver> — upgrade to enable` | Local agent (v<ver>) is too old. No other agents in your fleet have `import-lt22`. Upgrade your local agent OR ensure a remote agent (v1.6.6+) is online. | no    |

## Why this design

### Why both probes share the 5s cadence

The local probe was already a module-scoped 5s setInterval with a single in-flight promise + a Set of listeners. Adding a parallel fleet probe on the same cadence keeps the model consistent: ONE timer per leg, ONE Realtime channel for `sap_agents`, ONE in-flight promise. Mounting N consumers (`outbound-data-manager` + `inventory-management-tab` + `import-lt22-dialog` + the SAP Testing tab + the Connect Account button) still produces exactly two in-flight requests per tick.

### Why Realtime AND a 5s poll

The Realtime channel is the snappy path — a fleet agent flipping `status='online'` lights up SmartImportButton within ~1s. The 5s timer is the safety net for environments where Realtime drops silently (Citrix WebSocket inspection has historically broken `realtime>=2.x` connections; see the v1.6.4 work in [[Sessions/2026-04-30]]).

### Why auto-pin to `assigned_agent_id` when fleet-routing

Without the auto-pin, the v1.0.0 local agent's queue poller (if it has one — v1.0.0 predates Phase A1, but defensive) could happily claim the LT22 job and 404 on `/sap/import-lt22`. The auto-pin ensures only the fleet agent that *actually has* the capability can claim. The manual "Pin to agent" picker (visible when `onlineAgents.length > 1`) always overrides the auto-pin.

### Why local wins ties in `bestAgentFor`

1. **Latency**: in-process SAP COM bridge → ms-scale; queue → ~5s (the agent's queue poller cadence).
2. **Visibility**: the user can WATCH SAP GUI execute the action.
3. **Auth simplicity**: local agent already holds the user's JWT in `state.supabase_token`; no per-job RLS surprise.

Fleet wins only when the local can't — the queue is the *fallback*, not the default.

### Why don't we change other capability-gated surfaces

Audited per [[Patterns/Fleet-Aware-Smart-Routing]]'s "When NOT to fleet-route" list:

- **Agent Triggers tab** — already fleet-aware (the agent that owns the trigger fires it; browser doesn't decide).
- **Inventory Management `runQuery` / `runMutation`** — LT10 needs the LOCAL SAP session the user is signed into. Routing to a remote SAP session that isn't signed in as the user breaks data scoping.
- **Reversal Engine, Recording, Cubiscan workspace, etc.** — local-only by design.

Fleet routing is the right call **only** for the SmartImportButton + outbound-data-manager LT22 import. Don't over-extend.

## What the user will see on next refresh

The user opens Outbound Apps Data Manager (still from outside Citrix, local agent still v1.0.0):

1. SmartImportButton becomes `Import via Agent (Fleet)` with the emerald accent + Zap icon.
2. subLabel reads `via USINDPR-CXA105V-... · v1.6.6` (or whatever the fleet agent's hostname/id is).
3. Tooltip / dropdown description: `Routing through fleet agent USINDPR-CXA105V-... via the queue. Local agent (v1.0.0) lacks the capability; the job will be claimed and run on a remote Citrix box that has \`import-lt22\` in its capability set.`
4. Click → dialog opens.
5. Dialog's agent strip says `Routing through: USINDPR-CXA105V-... · v1.6.6 (Fleet)` with `Fleet · queued` badge.
6. Submit button reads `Run LT22 Import (Fleet)`.
7. On submit → `sap_agent_jobs` row inserts with `assigned_agent_id = <USINDPR-... id>` so only the v1.6.6 Citrix agent can claim it.
8. v1.6.6 Citrix agent's queue poller claims within ~5s, runs LT22, persists rows to `sap_outbound_to_imports`, PATCHes `sap_outbound_to_import_runs` to `completed`.
9. Dialog's existing Realtime subscription on the run row flips the pill to `✓ completed · N rows`, toasts, closes; outbound data manager grid auto-refreshes via `onImported`.

All without the user touching their v1.0.0 local agent.

## Edge cases handled

- **Anonymous web session** (no signed-in Supabase user) — `probeFleetOnce()` short-circuits; fleet stays `{online: 0, agents: []}`; `bestAgentFor` returns 'local' (if local works) or null. No RLS console noise.
- **No fleet agent has the capability** — `bestAgentFor` returns null → button shows the existing greyed state with smarter copy that names BOTH paths to recovery.
- **Local agent has cap AND fleet has cap** — `bestAgentFor` returns 'local' (latency wins; user can watch SAP). Same UX as before this change.
- **User manually pins via the dialog's `Pin to agent` picker** — manual pick always wins over the auto-pin.
- **`assigned_agent_id` points at an agent that just went offline** — the queue claim function returns null until the agent comes back. Job stays `queued`; user sees the `queued` pill in the dialog. Standard queue behaviour.
- **Two fleet agents both have the cap** — the dialog's manual `Pin to agent` picker becomes visible (because `onlineAgents.length > 1`); auto-pin uses the first match in the fleet list. Future enhancement: round-robin or least-loaded.

## Build verification

- `npm run build` — passes (`✓ built in 9.11s`). `feature-admin-sap` chunk: 391.05 KB → 392.57 KB (+1.52 KB — the fleet types + poller + Realtime sub + the smarter copy in outbound-data-manager).
- No new TS errors, no new lint errors. Pre-existing `-inset-[1px]` Tailwind warnings in `RustPoweredSearchInput` are unrelated.

## Related

- [[Patterns/Fleet-Aware-Smart-Routing]] — the formal pattern.
- [[Smart-Import-Button]] — the visual primitive this extends.
- [[Implement-LT22-Outbound-Import]] — the original LT22 + ImportLt22Dialog work (Phase D).
- [[Job-Queue-Architecture]] — the underlying queue.
- [[Components/Omni-Agent - Headless SAP Agent]] — `_agent_self_id()` (stable id format used as `assigned_agent_id`).
- [[Debug/Fix-Agent-Fleet-Bloat-And-Token-Rotation]] — v1.6.5 sibling work (stable agent id, persistent agent token, fleet hygiene).
- [[Sessions/2026-04-30]]
