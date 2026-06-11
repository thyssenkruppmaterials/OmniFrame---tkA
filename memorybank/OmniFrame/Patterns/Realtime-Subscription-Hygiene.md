---
tags: [type/pattern, status/active, domain/frontend, domain/database]
created: 2026-05-02
---
# Realtime Subscription Hygiene

## Purpose / Context

Supabase Realtime fan-out cost is the default-on failure mode for frontend-heavy apps. Each unfiltered `postgres_changes` channel receives a copy of every `INSERT`/`UPDATE`/`DELETE` on the watched table across the **entire database**, not just the caller's org. With N concurrent users × M tables × unfiltered channels × burst-write workloads (scanners, schedulers, agent heartbeats), fan-out goes quadratic fast.

This pattern documents the four rules the OmniFrame frontend should follow for every Realtime subscription.

## Rule 1 — Always filter by `organization_id` (or equivalent tenant key)

**Never** subscribe to a multi-tenant table without the server-side filter. The filter goes on the `postgres_changes` config:

```ts
channel.on(
  'postgres_changes',
  {
    event: '*',
    schema: 'public',
    table: 'sap_agents',
    filter: `organization_id=eq.${orgId}`, // ← required
  },
  handler
)
```

This is server-side — the client never receives the other-tenant rows in the first place, so it's both a performance **and** a defense-in-depth win.

If the filter column isn't `organization_id`, the same logic applies: `map_id=eq.X`, `user_id=eq.X`, etc. The only tables that legitimately subscribe unfiltered are admin/cross-tenant views (Platform Admins only) and tables where RLS makes fan-out a no-op (e.g. per-user row visibility enforced by policy).

## Rule 2 — Always debounce cache invalidations

Bursts are the common case, not the exception. Scanner workflows, import jobs, trigger fan-outs, and backfill loops all produce 10–100 events in 1 second. Without debouncing, each event kicks off a refetch, each refetch fires a `toast.info`, and the UI spins.

Canonical implementation (matches `use-outbound-to-data.ts`, `use-putaway-operations.ts`, `use-cubiscan.ts`):

```ts
const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

// inside the Realtime handler:
if (debounceRef.current) clearTimeout(debounceRef.current)
debounceRef.current = setTimeout(() => {
  queryClient.invalidateQueries({ queryKey: [QUERY_KEY] })
  queryClient.invalidateQueries({ queryKey: [STATS_QUERY_KEY] })
}, 500) // 300–500ms is the sweet spot; longer makes the UI feel laggy
```

Always clear the timeout in the effect cleanup so an unmount mid-debounce doesn't fire `invalidateQueries` on a dead component.

## Rule 3 — Gate polling on `document.visibilityState`

Pollers (and the polling-half of Realtime + timer fallback patterns) should back off when the tab is hidden. The user isn't looking; every poll is waste.

Standard cadence:

- **Visible**: 15–30s (depends on feature — agent detection = 15s, kanban boards = 30s)
- **Hidden**: 60–120s (just enough to not be stale on tab-show)
- **Immediate probe on `visibilitychange` → visible** so the snapshot is fresh when the user's first interaction reads it.

Implementation: one `setInterval` whose handle is cleared + re-scheduled on each visibility transition. Don't just `return` early in the interval callback based on `visibilityState` — the interval still fires at the old cadence, just with a wasted tick. See `use-agent-detection.ts` (`rescheduleLocalPoller`, `rescheduleFleetPoller`, `handleVisibilityChange`) for the canonical shape.

## Rule 4 — Never scope `event: '*'` without a tenant filter

`event: '*'` is the fan-out multiplier — it matches `INSERT`, `UPDATE`, and `DELETE` on every row. Combined with no filter, it's three subscriptions for the price of one wasted channel.

If you truly need all events, always pair it with a tenant filter (Rule 1). If you only need one event type, be explicit: `event: 'INSERT'`. Explicit event types sometimes let Supabase's query planner do less work server-side.

## Rule 5 (corollary) — Don't toast on self-events

Realtime handlers receive **your own** writes back. If the UI path that triggered the write already showed a `toast.success`, the Realtime-triggered `toast.info` is at best redundant and at worst noisy (operators complained about 500 toasts/min at 50 viewers). Gate with the actor id:

```ts
const actorId = payload.new?.confirmed_by ?? payload.new?.created_by ?? null
if (actorId && actorId === currentUser.id) return // skip self-event toast
```

Leaving the cache-invalidation path unconditional is fine — stale caches cost nothing; noisy toasts cost attention.

## Call-site inventory (as of 2026-05-02)

Compliant with all 4 rules:

- `useAgentDetection` (omniframe-agent-detection-fleet) — org filter, visibility gated, no debounce (polling-half is debounced by cadence itself).
- `AgentsFleetCard` (sap-agents-fleet) — org filter, no self-toast (no toast at all).
- `usePutawayOperations` (putaway-operations-changes) — org filter, 500ms debounce, self-event toast skip.
- `useOutboundTOData` (outbound_to_data_changes) — org filter, 300ms debounce, throttled toast via sessionStorage.
- `useCubiscan` — org filter, debounce.
- `useDroneScans` — org filter.
- `useOptimizedOutboundData` — org filter.

Known non-compliant (❌ tracked for follow-up, NOT blocking 2026-05-02 release):

- `useSQ01Data`, `useLX03Data`, `useMaterialMasterData` — unfiltered (these are read-mostly global tables; low-traffic, but should still be filtered once the column exists).
- `useInboundScans`, `useInboundCarts`, `useGRSGripProcessing`, `useGripProcessing` — unfiltered.
- `useSessionManagement` — unfiltered on `user_sessions`, `enhanced_user_sessions`, `security_alerts`, `session_activities` (global admin view; okay for admin-only screens).
- `kit-kanban.service.ts`, `kit-definitions.service.ts`, `kit-definition-chains.service.ts`, `rr-kitting-data.service.ts`, `device-manager.service.ts`, `zone-rules.service.ts` — unfiltered service-level subscriptions.

## Related

- [[Implement-Frontend-Supabase-Load-Reduction]]
- [[React-Query-Patterns]]
- [[Components/Agents-Fleet-Manager]]
