---
tags: [type/implementation, status/active, domain/frontend, domain/realtime]
created: 2026-05-07
---

# Implementation: `<LiveOperatorStatus>` — "In Building" Tab

FE-only follow-up to [[Re-Enable-CurrentPage-In-ActiveOperators]]. Adds a second tab to the Active Operators panel showing all presence-tracked users in the org (the **Option-2 union** asked for in chat). Tab 1 ("On Counts") stays as-is — work-engine operators from `worker_heartbeats`. Tab 2 ("In Building") is new — presence-tracked users that are NOT currently checked in to the work engine. Cards on Tab 2 are visually compact since those users aren't running a count.

## Why

Day-after follow-up to the same-day scoped re-enablement of `current_page`. The user wants a complete picture of who's in the building, not just who's running cycle counts — supervisors browsing the Inventory Counts tab need to see at a glance:

1. Who's actively running counts (Tab 1 — work_heartbeats join).
2. Who else is around the org but not on a count (Tab 2 — presence union minus Tab 1).

The second tab is the answer to "is anyone else available to help right now?" without leaving the Inventory Counts surface.

## File deltas

| File | Change |
|---|---|
| `src/components/live-operator-status.tsx` | Added second tab via shadcn `<Tabs>`. Added `usePresenceOptional()`-driven `inBuildingUsers` memo with worker-id Set dedup. Added `<PresenceUserCard>` (compact ~60px-tall variant of the existing operator card, uses `<PresenceAvatar size="sm">`). Added `PRESENCE_THEME` palette + `<PresenceSummaryTile>` component for the per-tab status counts strip (Option A from spec). Re-imported `Bell`, `CircleDot`, `PresenceAvatar`, `PRESENCE_STATUS_CONFIG`, `PresenceStatus`, `PresenceUser`, `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`. Net delta ~+330 LOC. |

## Decision Log

### Step 4 — per-tab vs global status counts strip

**Option A picked: per-tab semantics.** The strip is visually load-bearing, and the work-engine palette (orange busy / sky idle / amber break) doesn't map cleanly onto presence semantics (green available / yellow away / red busy / gray offline). Showing the work-engine counts on Tab 2 would be misleading because Tab 2's users are NOT work-engine operators. Per-tab semantics costs ~30 LOC of duplicated SummaryTile rendering and one extra theme palette (`PRESENCE_THEME`); the UX honesty payoff is worth it.

**What this looks like in practice:**
- Tab 1 active → strip = `BUSY · ONLINE · IDLE · BREAK · OFFLINE` (5 tiles, work-engine palette, work-engine counts via `useActiveWorkers()`).
- Tab 2 active → strip = `AVAILABLE · AWAY · BUSY · OFFLINE` (4 tiles, presence palette, presence counts derived from `inBuildingUsers`).

**Folded `do_not_disturb` into Busy** so the Tab 2 strip stays at four tiles. The avatar dot still shows the precise DND colour via `PresenceAvatar` (`PRESENCE_STATUS_CONFIG.do_not_disturb.dotClass`); the summary tile just bundles them visually because the supervisor cue is identical ("don't bother this person").

### Tab labels + counts

- **"On Counts"** — `activeWorkers.length` (non-offline workers, matches Tab 1's existing display semantics). Sub-text shows `{N} on counts` in the panel sub-title (workers.length includes offline too — distinct number kept on the title line for transparency).
- **"In Building"** — `inBuildingUsers.length` (presence union minus workers).

Default active tab: `'on-counts'` (preserves existing behaviour — supervisors don't get a layout shift on first mount).

### Card layout — compact for Tab 2

Reused `<PresenceAvatar size="sm">` from `src/components/presence/presence-avatar.tsx` (already supports `sm/md/lg`; `sm` = `h-7 w-7` avatar with `xs` dot). Card height is ~60px (avatar `h-7` + 1.5 padding-y) vs Tab 1's ~80–90px (initials chip `h-10` + 2.5 padding-y). Subtitle font size `text-[10px]` vs Tab 1's `text-[11px]`. Single row layout: `<PresenceAvatar /> | name + status badge / 'in {feature}' | timestamp`.

### Sort order on Tab 2

`online → busy → do_not_disturb → away → offline`. Differs from Tab 1's `busy → online → idle → break → offline` deliberately: in the work-engine world "busy" means "actively working, leave them alone"; in the presence world "busy" means "in a meeting, leave them alone". Supervisors looking at Tab 2 want to find someone *available to help*, so Available comes first.

## Tab 2 dedup logic + edge cases

```typescript
const workerIds = new Set(workers.map(w => w.user_id))
const inBuildingUsers = allPresent
  .filter(u => !workerIds.has(u.user_id))
  .sort(/* online first, busy mid, away/offline last */)
```

- **Self-exclusion** — inherited for free. Both `presence.service.ts:511` (Supabase mode) and `presence.service.rust.ts:417` (Option-2 mode) drop the current user from `allPresent` at the SERVICE layer. Tab 2 sees "everyone else" by default.
- **Worker dedup** — `Set(workers.map(...))` uses ALL workers (online + offline), not just `activeWorkers`. A user who's a work-engine operator (even currently offline) belongs to Tab 1's roster, never Tab 2.
- **Null `current_page`** — handled in `<PresenceUserCard>`: when `feature` is null/undefined, the sub-row falls back to `PRESENCE_STATUS_CONFIG[user.status].label` italic ("Available" / "Away" / etc.) instead of "in {feature}". Avoids a dangling "in" prefix.
- **Kiosk users** — RF / timeclock / customer-portal users are opted out of presence by `PRESENCE_KIOSK_ROUTE_PATTERNS` (Layer 4 of [[Realtime-Presence-Browser-Hardening]]), so they don't appear in `allPresent` at all. They show up in Tab 1 (via `worker_heartbeats`) when actively running counts; they DON'T show up in Tab 2 even on idle RF screens. **This is a real gap — see "Anything to flag" below.**
- **`presence === null`** — when the panel mounts outside `<PresenceProvider>` (no consumer does this today, but `usePresenceOptional()` was kept for forward compat — see ADR), `allPresent` is undefined and `inBuildingUsers` is `[]` → Tab 2 renders the empty state ("No other users online"). Tab 1 keeps working unchanged.

## Privacy contract

Unchanged. The grep contract in [[ADR-Scoped-CurrentPage-In-ActiveOperators]] continues to count `live-operator-status.tsx` as a SINGLE consumer file — the file now reads `current_page` in two card components (`<OperatorCard>` + `<PresenceUserCard>`) but both are inside the same RBAC-gated panel inside the same `view inventory_apps`-gated route. No new permission key. The `<OnlineUsersPanel>` / `<StatusSelector>` / `<PresenceAvatar>` family stays `current_page`-agnostic.

Full-repo grep after the change confirms the same 8 files match `current_page` in `src/`:

- `src/lib/presence/types.ts` (declaration)
- `src/lib/presence/presence.service.ts` (broadcaster)
- `src/lib/presence/presence.service.rust.ts` (broadcaster)
- `src/lib/presence/route-features.ts` (docstring reference, excluded from the contract count)
- `src/hooks/use-presence-tracker.ts` (caller of `updateCurrentPage`)
- `src/hooks/use-presence-visibility.ts` (vestigial flag)
- `src/hooks/use-entity-focus.ts` (fallback stub)
- `src/components/live-operator-status.tsx` (THE consumer — Tab 1 + Tab 2 cards)

No new file in the list. ADR's Rule 2 ("`PresenceUser.current_page` is consumed by **exactly one** UI surface") still holds.

## Quality gate results

- `pnpm tsc -b --noEmit` — clean (~20s).
- `npx eslint src/components/live-operator-status.tsx` — 0 errors, 0 warnings on the touched file.
- `pnpm build` — clean in ~10.6s; PWA precache regenerated. No new chunk crossed any per-chunk threshold.
- Unit tests covering `<LiveOperatorStatus>` — none in the workspace (verified by grep).
- Bundle delta — `feature-rf-interface` chunk was 500.84 KB pre-change; this file ships in `inventory` chunk (199.02 KB pre-change), expect +1–2 KB from the four extra lucide icons (`Bell`, `CircleDot`) + the `<Tabs>` Radix primitive (already used elsewhere in the chunk, deduped). No new chunk.

## Manual verification procedure

1. Sign in to a tenant where the current user has `view inventory_apps` permission.
2. Navigate to **Apps → Inventory → Inventory Counts**.
3. Confirm `<LiveOperatorStatus>` renders below the search bar (toggle defaults on).
4. The header now shows three counts: `{X} active · {Y} on counts · {Z} in building`. Two tabs underneath: "On Counts · {N}" and "In Building · {M}".
5. **Tab 1 verification** — flip to "On Counts" (default). Confirm:
   - Status counts strip shows 5 work-engine tiles (BUSY / ONLINE / IDLE / BREAK / OFFLINE), tile colours from work-engine palette (orange / emerald / sky / amber / slate).
   - Operator cards render with the existing layout — initials chip, name + status badge, task location, current task type, "on {Feature}" line for operators in the presence channel.
6. **Tab 2 verification** — flip to "In Building". Confirm:
   - Status counts strip swaps to 4 presence tiles (AVAILABLE / AWAY / BUSY / OFFLINE), tile colours from presence palette (green / yellow / red / gray).
   - Compact cards render — `<PresenceAvatar>` with status dot, name + status badge inline, "in {Feature}" sub-row, relative timestamp on the right.
   - Hover the "in {Feature}" line — tooltip shows raw `current_page` pathname.
7. **Dedup check** — open a second browser tab as a different user, sign that user in. Have them check in to a count via RF (so they enter the worker_heartbeats table). Refresh the panel. Confirm the user appears in Tab 1 and is ABSENT from Tab 2 (i.e. dedup is working). Have the second user check out — they should disappear from Tab 1; if their browser tab is still open and presence is enabled, they should now appear in Tab 2.
8. **Empty state check** — on a quiet org with only the supervisor's own session, both tabs show their respective empty states.
9. **Self-exclusion check** — confirm the current user does NOT appear in Tab 2 (presence service drops self at the service layer).

## Anything to flag

### 1. Kiosk-opt-out gap (raised, not fixed)

**Tab 2 won't include warehouse RF operators on idle RF screens** because `PRESENCE_KIOSK_ROUTE_PATTERNS` opts them out of presence entirely (Layer 4 of [[Realtime-Presence-Browser-Hardening]]). The route prefixes `/rf-*`, `/timeclock(app)?`, `/customer-portal*` skip `presenceService.initialize()` so those tabs never join the channel. Knock-on effect on Tab 2: an RF operator who's signed in on a handheld but not currently checked in to a count is invisible in both tabs.

The original kiosk opt-out was added during Phase B (2026-05-06) to defend the tenant-overload incident on `c9d89a74` — RF terminals leaving Realtime channels open all shift was load-amplifying. **Now that Layer 7 (Option 2 — server-side presence on `rust-work-service`) has shipped, that load argument is moot.** RF terminals heartbeating to Redis-backed presence cost ~1 HSET per ~30s rather than a Realtime channel subscription, and the per-org `broadcast::channel(1000)` already defends fan-out.

**Decision left to the user:** revisit `PRESENCE_KIOSK_ROUTE_PATTERNS` for `/rf-*` specifically? The trade-off:

- Pro — Tab 2 becomes a real "who's in the building" view. Idle RF terminals on the cycle-count signin screen would show up. Supervisors get the full picture.
- Pro — Layer 7's Redis path doesn't have the load problem that motivated the original opt-out.
- Con — Reintroduces presence churn from RF tabs; if a handheld goes to sleep/wakes throughout a shift the joins/leaves multiply by the number of operators on the floor.
- Con — Privacy: RF terminals are typically used by "clocked-in" warehouse staff; they may not want their location/screen on a presence panel on the same level as office staff.

No code change made — flagging for product decision.

### 2. UX trade-off: do_not_disturb folded into Busy on the strip

Tab 2 status strip merges `busy` + `do_not_disturb` into a single "BUSY" tile to keep the strip at 4 tiles. The user's individual avatar dot still shows the precise DND colour. If the user wants the strip to expand to 5 tiles (mirroring Tab 1's layout) we'd need to either find a fifth meaningful presence bucket or just split DND out for symmetry. Defaulted to the cleaner 4-tile shape.

### 3. Sort order differs across tabs

Tab 1 sorts `busy → online → idle → break → offline` (work focus first); Tab 2 sorts `online → busy → ... → offline` (availability first). Captured under "Decision Log" above with rationale. If the user prefers identical sort orders across tabs we can align — flagging as a deliberate UX choice rather than a default.

## Related

- [[Re-Enable-CurrentPage-In-ActiveOperators]] — the same-day implementation this composes on top of; both share the privacy contract.
- [[ADR-Scoped-CurrentPage-In-ActiveOperators]] — privacy contract; Tab 2 inherits the same RBAC gate (no new permission key).
- [[Route-To-Feature-Name-Mapping]] — the `resolveFeature()` resolver reused for Tab 2 cards.
- [[Realtime-Presence-Browser-Hardening]] — the kiosk opt-out (Layer 4) flagged in "Anything to flag" above.
- [[Implement-Presence-On-Rust-Option-2]] — the Layer 7 work that makes revisiting the kiosk opt-out load-safe.
- [[Components/PresenceUI - Status Indicators]] — `<PresenceAvatar size="sm">` reused here.
- [[Sessions/2026-05-07]] — today's session log.
