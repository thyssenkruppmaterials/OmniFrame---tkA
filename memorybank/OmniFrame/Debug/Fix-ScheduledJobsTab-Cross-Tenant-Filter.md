---
tags: [type/debug, status/active, domain/frontend, domain/realtime, domain/security]
created: 2026-05-06
---

# Fix: Scheduled Jobs Tab Cross-Tenant Realtime Leak

## Severity

**Medium — confidentiality side-channel.** Cross-tenant `sap_agent_schedules` row UPDATEs were fanning out to every authenticated tab in every other tenant via a Supabase Realtime channel that had no `organization_id` filter. The page-level `refresh()` immediately re-queries with `eq('organization_id', oid)` so no foreign-org rows ever rendered, but the channel METADATA (timing, fan-out shape, write volume) leaked across tenants — and a future bug in the refresh predicate could have promoted this from a side-channel to direct exposure.

## Mechanism

`src/features/admin/sap-testing/components/scheduled-jobs-tab.tsx:252` opened

```ts
const channel = supabase.channel('sap-agent-schedules-tab')
;(channel as any).on(
  'postgres_changes',
  { event: '*', schema: 'public', table: 'sap_agent_schedules' }, // ← NO filter
  () => { void refresh() }
)
```

With no `filter: organization_id=eq.<orgId>`, Supabase Realtime fanned out every `sap_agent_schedules` row change to every connected client across every tenant. The handler re-fetched `sap_agent_schedules WHERE organization_id=eq.<oid>`, so the visible row list stayed correctly scoped — but the act of fetching itself (timing, frequency) was correlated with cross-tenant write activity.

Discovery: audit pass while building [[Migrate-SapAgentChanged-To-Rust-WS]]. The roadmap's `[[Roadmap-Rust-WS-Unlocks]]` Tier 1 row for this callsite explicitly flagged it: "Fix the cross-tenant leak in 0.5 day TODAY by adding `filter: organization_id=eq.<orgId>` (independent of migration)."

## Fix (one-liner)

Added `filter: \`organization_id=eq.${orgId}\`` to the channel's `postgres_changes` config + an `if (!orgId) return` guard. Same teardown semantics, same handler — the only behavioural difference is the server-side filter.

## Files touched

| File | Δ |
|---|---|
| `src/features/admin/sap-testing/components/scheduled-jobs-tab.tsx` | +18 LOC (filter + guard + 13-line block comment explaining the diagnosis). Effect dep array gains `orgId`. |

No migration, no Rust delta, no schema change. This is a pure FE ratchet shipped as a standalone unit, sequenced FIRST per the deliverable plan so it lands cleanly even if the larger `WsEvent::SapAgentChanged` migration runs into trouble.

## Verification

- Grep for the channel name `sap-agent-schedules-tab` — only consumer is the patched `useEffect` in `scheduled-jobs-tab.tsx`. No other code path was relying on the channel seeing cross-tenant events.
- `pnpm tsc -b --noEmit` — clean.
- `npx eslint` on the touched file — 0 warnings, 0 errors.
- Production build — `feature-admin-sap` chunk at 401.99 KB, well under the 500 KB per-chunk budget.

## What this fix is NOT

- It does NOT migrate the channel to `WsEvent::SapScheduleChanged`. That is a SEPARATE Tier 1 follow-on (~1.5 days) deliberately deferred per [[Roadmap-Rust-WS-Unlocks]] Tier 1 "Bottom of the list" — load is small and the existing pattern is fine once the org filter is in place.
- It does NOT touch `use-job-queue.ts` or `import-lt22-dialog.tsx` — also deferred per roadmap.

## Related

- [[Roadmap-Rust-WS-Unlocks]] — Tier 1 row that called this out.
- [[Migrate-SapAgentChanged-To-Rust-WS]] — companion migration shipped same-day.
- [[Add-WsEvent-Lagged-Metric]] — Rust ops ratchet shipped same-day.
- [[Patterns/Realtime-Presence-Browser-Hardening]] — defence-in-depth pattern this fix slots into.
- [[Sessions/2026-05-06]] — session log.
