---
tags: [type/implementation, status/active, domain/frontend, domain/database]
created: 2026-05-02
---
# Implement Frontend Supabase Load Reduction (v1.7.4)

## Purpose / Context

The OmniFrame web frontend was generating an estimated **~3,000+ requests/minute** at a 50-user steady state against Supabase, almost entirely from two sources:

1. `useAgentDetection` and `useOnlineSapAgents` (a.k.a. `useFleetAgentsOnline`) each spun up their own `sap_agents` Realtime channel **with no `organization_id` filter**, so every row change in every org fanned out to every connected client.
2. Multiple hooks called `supabase.auth.getUser()` (GoTrue round-trip) + `supabase.from('user_profiles').select('organization_id')` on every tick / submit / Realtime fan-out, even though the auth-state layer already caches both.
3. `usePutawayOperations` had no `organization_id` Realtime filter, no debounce on its cache invalidations, and fired a `toast.info` on every event — including the user's own writes. With 50 viewers and 10 writes/min that was ~500 toasts/min in aggregate.

This pass implements Tier 1, Tier 2, and parts of Tier 3 from the investigation report — frontend-only, transparent to the UI, no migration, no agent change, no `LATEST_AGENT_VERSION` bump.

## Details

### Fix 1 — `auth.getUser()` → `auth.getSession()` in hot paths

`getUser()` always round-trips GoTrue; `getSession()` reads localStorage (synchronous IO). Swapped in:

- `useAgentDetection.probeFleetOnce` (fleet polling hot path)
- `useJobQueue.submit`
- `useAgentTriggerRuntime` queue-mode insert block (~line 336)
- `useAgentTriggerRuntime.applyPostSuccessPatch` putaway confirmation path

### Fix 2 — `organization_id` filter on every `sap_agents` Realtime channel

Three channels previously unfiltered:

- `omniframe-agent-detection-fleet` (in `use-agent-detection.ts`)
- `sap-agents-fleet` (in `agents-fleet-card.tsx`)
- `sap-agents-fleet-online-only` (was in `agents-fleet-card.tsx`; deleted — see Fix 8)

All remaining channels now pass `filter: \`organization_id=eq.${orgId}\`` to the `postgres_changes` config. The agent-detection channel is now wired lazily inside `probeFleetOnce` once the org id is known (rather than eagerly in `startFleetPoller`) because the filter requires the org id to exist.

### Fix 3 — Visibility-gated cadence for agent detection polling

Replaced the unconditional 5s `setInterval` with a visibility-aware scheduler:

- **Visible**: 15s cadence (local `/health` + `/agent-token/check` + Supabase fleet probe)
- **Hidden**: 60s cadence
- **Immediate probe on `visibilitychange` → visible** so the snapshot is fresh the instant the user tabs back.

Implementation: one `setInterval` per poller whose handle is cleared + re-scheduled at the new cadence when `document.visibilityState` changes. Both the local `/health` leg and the Supabase fleet leg are gated.

### Fix 4 — 500ms debounce on `usePutawayOperations` Realtime invalidations

Mirror of the pattern in `use-outbound-to-data.ts` — `useRef<setTimeout>` cleared + re-set on each event, so a burst of 20 scanner writes in 200ms coalesces into one `queryClient.invalidateQueries` round.

### Fix 5 — `organization_id` filter on `usePutawayOperations` Realtime

Added the server-side filter to the `rf_putaway_operations` channel. Effect guards against the signed-in profile not yet being hydrated (returns early, re-runs on `profile?.organization_id` change).

### Fix 6 — Session-level `organization_id` cache

Added two exports to `src/lib/auth/unified-auth-provider.tsx`:

- `useOrgId(): string | null` — React hook variant (reads from `useUnifiedAuth().authState.profile?.organization_id`).
- `getCurrentOrgId(): string | null` — module-level accessor for non-React code paths (reads from `singletonAuthManager.getAuthState().profile?.organization_id`).

Both resolve from the profile that was already loaded once at sign-in by `SingletonAuthManager.loadUserProfile`, so no `user_profiles` lookup runs per tick. Call sites updated:

- `useAgentDetection.probeFleetOnce` — `getCurrentOrgId()`
- `AgentsFleetCard.refresh` + Realtime channel — `useOrgId()`
- `useOnlineSapAgents` — now delegates entirely (see Fix 8); its direct Supabase calls are gone.
- `useJobQueue.submit` — `getCurrentOrgId()`
- `useAgentTriggerRuntime` queue insert — `getCurrentOrgId()`

### Fix 7 — Gate `toast.info` in `usePutawayOperations` on other-user events

Toast now only fires when `payload.new.confirmed_by` / `payload.new.created_by` / `payload.old.*` (whichever is populated) differs from the signed-in user's id. Self-events are silent because the UI path that triggered them already showed a success toast.

### Fix 8 — Collapse `useOnlineSapAgents` into `useAgentDetection().fleet`

The hook previously opened its own 30s `setInterval` + its own `sap_agents` Realtime channel (a third one, on top of the detection channel and the fleet-card channel) with no org filter. It now delegates entirely — `const { fleet } = useAgentDetection()` → `fleet.agents.map(...)`. Consumers (inventory-management-tab, scheduled-jobs-tab, agent-triggers-tab, import-lt22-dialog) only read `id`, `hostname`, `citrix_session`, `version`, `capabilities` — all present on the shared `FleetAgent` projection.

The shape returned is structurally-compatible `SapAgentRow` (unused admin-card-only fields default to `null` / `'online'`) so no call sites needed to change.

### Fix 9 — Build + verification

- `npm run build` → ✓ 9.46s
- `ReadLints` on all modified files → no new errors
- Grep sanity: ZERO unfiltered `event: '*'` postgres_changes on `sap_agents` or `rf_putaway_operations`.
- Grep sanity: ZERO `auth.getUser()` calls remain in the agent-detection / job-queue / trigger-runtime hot paths (remaining `getUser()` calls in the repo are in non-hot-path helpers like `sap-audit.ts` and `scheduled-jobs-tab.tsx.loadOrg` — out of scope).

## Files touched

- `src/lib/auth/unified-auth-provider.tsx` — +33 LOC — added `useOrgId()` + `getCurrentOrgId()`.
- `src/features/admin/sap-testing/hooks/use-agent-detection.ts` — +170 net — visibility gating, org-scoped Realtime filter, cached-org probes, cadence bump 5s → 15s/60s.
- `src/features/admin/sap-testing/components/agents-fleet-card.tsx` — -25 net — `useOrgId` + org filter + `useOnlineSapAgents` collapsed to delegate to `useAgentDetection().fleet`.
- `src/hooks/use-putaway-operations.ts` — +55 net — debounce, org filter, self-event toast skip.
- `src/features/admin/sap-testing/hooks/use-job-queue.ts` — ±0 net — `getSession` + cached org.
- `src/features/admin/sap-testing/hooks/use-agent-trigger-runtime.ts` — ±0 net — `getSession` + cached org in queue-insert AND post-success patch.

Total: ~+213 LOC net across 6 files.

## Expected load reduction (50 concurrent users baseline)

| Source | Before (req/min, aggregate) | After | Reduction |
|---|---|---|---|
| `sap_agents` Realtime fan-out (3 unfiltered channels × all orgs) | ~1,200 | ~org-scoped only (~100) | ~92% |
| `useAgentDetection.probeFleetOnce` (5s → 15s, visibility-gated) | ~600 | ~200 foreground / ~50 background | ~70% |
| `useAgentDetection` `user_profiles` selects (every tick, uncached) | ~600 | 0 | 100% |
| `useJobQueue.submit` + `useAgentTriggerRuntime` `user_profiles` selects | ~50 | 0 | 100% |
| `useOnlineSapAgents` extra poller + channel (×4 consumers) | ~400 | 0 (delegated) | 100% |
| `useFleetAgentsOnline` self-channel | ~300 | 0 | 100% |
| `rf_putaway_operations` Realtime fan-out (unfiltered) | ~400 | ~org-scoped (~80) | ~80% |
| `usePutawayOperations` cache invalidations (no debounce) | ~200 invalidations/min | ~20 (500ms debounce) | ~90% |
| Per-event `toast.info` churn (50 viewers × 10 writes/min) | ~500 | ~50 (only other-user events) | ~90% |

Estimated aggregate: **3,000+ req/min → ~400 req/min** at steady state — an ~85% reduction.

## Related

- [[Realtime-Subscription-Hygiene]]
- [[Sessions/2026-05-02]]
- [[Components/Agents-Fleet-Manager]]
- [[Components/Inventory-Management - SAP Query Framework]]
