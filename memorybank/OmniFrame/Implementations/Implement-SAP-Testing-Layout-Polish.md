---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-05-02
---
# Implement SAP Testing Layout Polish

## Purpose / Context

Frontend-only refresh of the SAP Testing tabs (Inventory Management + Agent Triggers) on 2026-05-02. Three connected goals:

1. **Right-size the Agent Health + Agent Fleet cards.** They were rendering on the Inventory Management tab where they cluttered the form area. They actually belong next to the trigger runtime that depends on the fleet — Agent Triggers — so users can see fleet health while configuring rules without scrolling away from the queries form.
2. **Replace the bulky "SAP Agent Not Detected" amber card with a minimal inline strip.** The full-width card was eating ~96px of vertical space and repeating the same copy across two tabs. The new strip is a single 32px-tall amber bar with a compact text-button Retry — same shared component on both tabs.
3. **Polish Inventory Management to feel professional.** Compact crumb-style header in the active query panel (`Warehouse / LT10` instead of a big icon + full transaction badge), tighter spacing, consistent typography. Layout grid stays the same (280px sidebar / form / console).

No agent rebuild, no migrations, no `LATEST_AGENT_VERSION` bump. Pure layout shell.

## Details

### What moved where

**Removed from Inventory Management** (`src/features/admin/sap-testing/components/inventory-management-tab.tsx`):
- `<AgentHealthCard agentConnected={...} />`
- `<AgentsFleetCard />`
- The full amber `<Card>` rendered when `status === 'missing'` inside `AgentStatusBar`.
- Direct imports of `AgentHealthCard`, `AgentsFleetCard` (kept `useOnlineSapAgents` — still needed by `BatchModePanel` for the "Pin to agent" picker).

**Added to Agent Triggers** (`src/features/admin/sap-testing/components/agent-triggers-tab.tsx`):
- Imports for `AgentHealthCard`, `AgentsFleetCard`, `AgentNotDetectedBanner`.
- `<AgentHealthCard>` + `<AgentsFleetCard>` rendered between the KPI tile row and the violet `agentSideTriggersActive` banner.
- Minimal banner rendered at the very top of the tab content when `agentStatus === 'missing'` (with trigger-specific copy: "triggers can be configured but won't fire until the agent is running").
- The `missing` branch in the Agent Triggers `AgentStatusBar` returns `null` since the new banner above replaces it.

**New shared component**: [[Components/Inventory-Management - SAP Query Framework]] and [[Components/Agent-Triggers - Realtime Automation]] now both import from a single ~50-line file.

```
src/features/admin/sap-testing/components/agent-not-detected-banner.tsx
```

Props: `{ onRetry: () => void; message?: string; className?: string }`. Default copy is the inventory variant; the Agent Triggers tab passes a custom `message` so it doesn't lose the "triggers can be configured but won't fire" nuance.

### Final order on Agent Triggers

1. `<AgentNotDetectedBanner />` — only when `agentStatus === 'missing'`.
2. `<AgentStatusBar />` — handles `checking` / `unauthenticated` / `connected` (returns `null` for `missing`).
3. `<KpiRow />` — Triggers / Fires Today / Errors Today / Avg Latency / Online Agents.
4. `<AgentHealthCard />` — collapsible, defaults closed.
5. `<AgentsFleetCard />` — collapsible, defaults open.
6. Violet `agentSideTriggersActive` banner — only when the agent is owning the rf_putaway_operations subscription itself (capability `agent-side-triggers`).
7. Triggers list (col-span-3) + Triggers Console (col-span-2) split.

### Final order on Inventory Management

1. `<AgentNotDetectedBanner />` — only when `agentStatus === 'missing'`.
2. Auto-update banner (Phase C #5) — only when an outdated agent is connected.
3. `<AgentStatusBar />` — env-coloured session pill + GUI status + session selector.
4. Query picker + form/console grid (`lg:grid-cols-[280px_1fr_1fr]`).
5. Results card with stats + sortable/searchable/paginated table.
6. Dialogs (Transfer, Bin Blocks, big-batch confirm, Material Master dry-run).

### Active query header — compact crumb

Replaced:

```tsx
<CardTitle className='flex items-center gap-2'>
  <selectedQuery.icon className='h-5 w-5' />
  {selectedQuery.name}
  <Badge variant='outline' className='ml-2 font-mono text-xs'>
    {selectedQuery.transaction}
  </Badge>
</CardTitle>
<CardDescription>{selectedQuery.description}</CardDescription>
```

With a two-row crumb + title:

```tsx
<div className='text-muted-foreground flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase'>
  <selectedQuery.icon className='h-3 w-3' />
  <span>{categoryLabel(selectedQuery.category)}</span>
  <span className='opacity-50'>/</span>
  <span className='font-mono normal-case'>{selectedQuery.transaction}</span>
</div>
<CardTitle className='text-base font-semibold'>{selectedQuery.name}</CardTitle>
<CardDescription className='text-xs'>{selectedQuery.description}</CardDescription>
```

New helper `categoryLabel(category)` maps the raw enum (`inventory` / `warehouse` / `master-data` / `tools` / `custom`) to the display label (`Inventory` / `Warehouse` / `Master Data` / `Tools` / `Custom`). Reused inside `QueryLibraryCard` so the sidebar category headers also pick up the proper casing.

### Banner styling

```tsx
<div className='flex h-8 items-center justify-between gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 text-xs text-amber-700 dark:text-amber-300'>
  <ShieldAlert /> <span>Agent not detected — start it from the One Click Ship tab to run queries.</span>
  <button>Retry</button>
</div>
```

- Single line, exactly 32px tall (`h-8`).
- Subtle amber: `border-amber-500/30 bg-amber-500/10`, `text-amber-700 dark:text-amber-300`.
- Retry is a plain `<button>` with `hover:underline` — no boxy primary/outline button.
- `role='status'` + `aria-live='polite'` for screen readers.
- Disappears entirely when `agentStatus !== 'missing'` (no persistent placeholder reserving height).

## Files modified

- `src/features/admin/sap-testing/components/inventory-management-tab.tsx` — removed bulky AgentStatusBar `missing` branch + Health/Fleet card mounts + their imports; added crumb header + `categoryLabel` helper. Net ≈ −2 LOC (substitutions).
- `src/features/admin/sap-testing/components/agent-triggers-tab.tsx` — added Health/Fleet card mounts + new banner mount + imports; nullified the `missing` branch in its AgentStatusBar. Net ≈ +5 LOC.
- `src/features/admin/sap-testing/components/agent-not-detected-banner.tsx` — **new** ~50 LOC.

## Build status

`npm run build` passes (9.6s). No new ESLint errors on any of the three files. No new dependencies. Existing shadcn primitives still used everywhere; the banner is intentionally vanilla `<div>` + `<button>` to keep it weightless.

## Why these placements

- **Why move Health/Fleet cards to Agent Triggers**: The trigger runtime is the *only* surface that fundamentally depends on multi-agent fleet awareness — `agentSideTriggersActive` flips when the agent owns its own Realtime subscription, and the violet banner cross-references the specific fleet agent that's holding it. Inventory Management runs queries against the locally-attached agent only; users on that tab don't need to see the fleet to work.
- **Why a banner instead of a full bar**: Two tabs were duplicating the same amber card with slightly different copy. Centralising into `AgentNotDetectedBanner` removes the duplication and shrinks the visual noise. The `AgentStatusBar` continues to handle all *non-missing* states.
- **Why a crumb header**: The current screenshot shows the active query's title + description card eating roughly 1/3 of the form panel height with mostly redundant info (icon + name + transaction badge + description). The crumb pattern (`Warehouse / LT10` + name + description) is a single visual unit that scales better as more queries are added.

## Related

- [[Components/Inventory-Management - SAP Query Framework]]
- [[Components/Agent-Triggers - Realtime Automation]]
- [[Components/Omni-Agent - Headless SAP Agent]]
- [[Implementations/Implement-Inventory-Management]]
- [[Implementations/Implement-Agent-Triggers]]
- [[Implementations/Implement-Multi-Agent-Coordination]]



---

## Round 2 — Workbench Unification (2026-05-02 evening)

Same-day follow-up that took the round-1 polish further into a true enterprise control-center layout. Established the [[Unified-Workbench-Card-Layout]] pattern.

### What changed

**Inventory Management** (`inventory-management-tab.tsx`):
- Combined the 3-column grid (Library / Form / Console — three independent Cards with a 24px gutter) into a **single bordered Card** with internal `divide-x` separators. Outer wrapper: `<Card className='gap-0 overflow-hidden p-0 shadow-sm'>` with an inner grid `lg:grid-cols-[260px_1fr_1fr] lg:divide-x`. Each child Card now uses `gap-3 rounded-none border-0 py-4 shadow-none lg:h-full` to strip its own chrome.
- **Query Library buttons redesigned** to fix the truncation problem reported in the screenshot ("List Warehouse Sto…" / "Material Master — …"). Old layout was `name + transaction badge` on one row with `truncate`. New layout stacks: `name` on top (free to wrap multiple lines via `leading-snug`) + `transaction code` mono small below. Active state replaced the outlined-border look with a subtle `bg-accent` + 2px primary accent bar on the left edge.
- `QueryLibraryCard` gained a `className?: string` prop so the parent can pass embedded-mode chrome overrides without a new component.
- **Form section header** modernized to a 3-tier hierarchy: small uppercase eyebrow with category icon → 15px bold title with right-aligned transaction badge → `line-clamp-2` description. Replaced the v1 crumb pattern from round 1.
- Library header switched to the same eyebrow style (`text-[11px] font-semibold tracking-[0.08em] uppercase`) with a count badge (`{QUERY_LIBRARY.length}`) on the right.

**SAP Console** (`sap-console-card.tsx` — shared component):
- Terminal area was a hard `bg-zinc-950/70` edge-to-edge slab inside `CardContent p-0`. With the new flush workbench wrapper, it read as a black square pasted into the unified card.
- Fixed by giving CardContent **inset padding** (`px-3 pb-3`) and turning the terminal into a floated panel: `rounded-lg border border-zinc-800/40 bg-zinc-950/40 shadow-inner` (also softer alpha — `/40` instead of `/70`). Reads as "panel within a panel" now.
- Change benefits both contexts: in the embedded inventory workbench it stops looking square; in the standalone Agent Triggers usage it gets a polished card-within-card treatment.

**Agent Triggers** (`agent-triggers-tab.tsx`) — full enterprise control-center redesign:
1. **KPI strip**: 5 floating Cards collapsed into 1 unified Card. Replaced `KpiTile` (each its own `<Card className='h-20'>`) with `KpiCell` (plain `<div>` with `hover:bg-accent/30` and `tabular-nums` 20px value). Outer wrapper uses `divide-x lg:divide-y-0` so cells separate cleanly. Visually one continuous status bar instead of 5 floating boxes.
2. **Observability stack** (Health + Fleet): dropped the loud `border-blue-500/30` and `border-emerald-500/30` borders that competed for attention. Both cards now use neutral chrome (`gap-0 py-0 shadow-sm`) with eyebrow titles. Wrapped both in a `<div className='space-y-2'>` group so they read as paired observability panels (vs the 16px gap the parent gives every other section). Color is preserved on the icon only (Activity blue, Server emerald).
3. **Workbench panel** (Triggers list + Console): combined into a single bordered Card with internal `lg:grid-cols-5` split (3-col triggers / 2-col console). Triggers section: clean header bar (eyebrow title + count badge + Test Fire + Add Trigger). Console embedded with the same flush treatment as the inventory workbench. Fills viewport height: `lg:h-[calc(100vh-260px)] lg:min-h-[480px]`.

### Files modified

- `src/features/admin/sap-testing/components/inventory-management-tab.tsx` — outer Card wrapping, embedded-mode className overrides on three children, redesigned `QueryLibraryCard` (added `className` prop, stacked button layout, eyebrow header), modernized form header.
- `src/features/admin/sap-testing/components/agent-triggers-tab.tsx` — `KpiRow` + `KpiCell` rewrite, observability stack wrapper, workbench unification.
- `src/features/admin/sap-testing/components/agent-health-card.tsx` — neutral chrome, eyebrow CardTitle.
- `src/features/admin/sap-testing/components/agents-fleet-card.tsx` — neutral chrome, eyebrow CardTitle.
- `src/features/admin/sap-testing/components/sap-console-card.tsx` — inset padding + floated terminal panel.

### Build status

`npx tsc --noEmit --skipLibCheck` passes cleanly between every step. No new dependencies. No runtime/handler/SAP/migration changes.

### Pattern extracted

[[Unified-Workbench-Card-Layout]] — the reusable "outer Card + inner divide-x + embedded children stripped of their own chrome" recipe, with documented variants for KPI strips, asymmetric workbenches, and two-pane control surfaces. Plus the embedded-console inset-padding gotcha.

### Related (round 2)

- [[Unified-Workbench-Card-Layout]] — the new pattern this round produced
- [[Components/Inventory-Management - SAP Query Framework]] § "2026-05-02 round 2"
- [[Components/Agent-Triggers - Realtime Automation]] § "2026-05-02 round 2"



---

## Round 3 — Page header collapsed into the tab band (2026-05-09 PM)

Last remnant of the legacy chrome on the SAP Testing surface: a tall page header that ate ~80px above the tab row. User screenshot showed the heading + subtitle stacked over the `<TabMenu>` with a 24px sibling gap on top.

### What changed

Collapsed the entire header block in `src/features/admin/sap-testing/index.tsx` (lines 93–112) into a single horizontal band where the heading sits inline with the `<TabMenu>`:

- **Removed** the `SAP COM Automation Suite` subtitle entirely (was redundant with the page title + the sidebar entry that put the user here).
- **Removed** the wrapping `mb-2 flex flex-wrap items-center justify-between space-y-2` outer block — replaced with a single flex row.
- **Shrunk** the heading from `text-2xl font-bold tracking-tight` (24px) to `text-lg font-semibold tracking-tight whitespace-nowrap` (18px). Matches the `text-lg font-semibold` admin-header weight already in use at `src/routes/customer-portal/index.tsx`.
- **Inlined** the heading on the same row as the TabMenu using `flex flex-wrap items-center gap-x-6 gap-y-2`. The TabMenu sits in a `min-w-0 flex-1` child so its internal `overflow-x-auto` scroll behavior keeps working when the row is too narrow for the title + all six tabs.

### Files modified

- `src/features/admin/sap-testing/index.tsx` — single block replacement (~6 LOC delta, net −4 LOC).

### Before / after

Before: `text-2xl` heading (~32px) + `text-muted-foreground` subtitle (~24px) + `mb-2` (~8px) + `space-y-6` sibling gap to TabMenu (~24px) = ~88px before the tab row.

After: single horizontal band of `max(28px heading, 41px tab strip)` = ~41px before the tab row, then `space-y-6` (~24px) to tab content. **Net −47px** of vertical chrome above the tab content.

### Quality gate results

- `pnpm tsc -b --noEmit` — clean (20.9s).
- `pnpm build` — clean (10.2s). `feature-admin-sap` chunk: 455.93 KB raw / 122.77 KB gzip — unchanged from `main` (layout-only edit, no new imports / strings).
- `ReadLints` on `src/features/admin/sap-testing/index.tsx` — zero diagnostics.
- No new `supabase.channel(...)` callsites; no new dependencies; no `manualChunks` change; no migration; no `AGENT_VERSION` bump; rust-work-service version unchanged.
- Tab functionality untouched: `useTabSearchParam`, `pageResource='sap_testing'`, `showHiddenTabs={true}`, the `renderTabContent()` switch, and the `SAP_TESTING_TABS` array all unchanged.

### Why this exact shape

- `whitespace-nowrap` on the heading prevents a width-collapse on narrow viewports — the title always reads as one line, then `flex-wrap` drops the TabMenu container to a second row if the band can't fit both.
- `min-w-0 flex-1` on the TabMenu wrapper is required for the inner `overflow-x-auto` to reclaim horizontal space without blowing out the parent flex layout — the TabMenu's own internal `mx-auto w-fit` keeps the tabs visually centered within whatever space remains, mirroring how `<TabMenu>` looks on every other page that uses it (Inventory Management, Inbound Apps, Data Manager).
- Heading size + weight (`text-lg font-semibold`) match the customer-portal header's `<h1>` — establishes precedent in the codebase for compact page-header titles, so this isn't introducing a new design token.

### Vault

- This file (Round 3 section appended).
- Today's session log: `Sessions/2026-05-09.md` — appended a top-level entry under the day's existing work.

### Related (round 3)

- [[Components/Inventory-Management - SAP Query Framework]]
- [[Components/Agent-Triggers - Realtime Automation]]
- [[Patterns/Unified-Workbench-Card-Layout]]
