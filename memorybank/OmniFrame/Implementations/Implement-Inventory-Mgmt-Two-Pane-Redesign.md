---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-05-07
---
# Implement Inventory Management — Two-Pane Redesign (Round 4)

## Purpose / Context

Round-4 enterprise polish on the SAP Testing → Inventory Management tab. Round 1–3 (see [[Implement-SAP-Testing-Layout-Polish]]) established the Unified-Workbench-Card-Layout with three columns (Library / Form / Console) packed inside a single bordered Card at a fixed `lg:h-[440px]`. The result was clean but had three issues at desktop widths that mid-2026 user flagged on a 1080p screenshot:

1. The fixed-height workbench left a large empty band below it until the user ran a query — desktop viewport felt under-used.
2. Form panel was sparse (3 inputs + 2 buttons) sitting next to a wide live-streaming console — the visual weight didn't match the information density.
3. AgentStatusBar was a `py-3` Card eating ~50 vertical px to communicate one row of pills.

Round 4 restructures into a **two-pane layout with the console as a collapsible bottom drawer**, plus subtle category accent stripes for scannability. No agent / handler / SAP / migration / capability changes — pure layout shell.

## Final shape

```
┌─ AgentStatusBar (h-10 strip — env pill, version, GUI status, session picker, [Console ⇈]) ─┐
├──────────────────────┬──────────────────────────────────────────────────────────────────────┤
│ Query Library (40vh) │                                                                       │
│  · filter input      │                          Right pane (results-first)                  │
│  · category accents  │   • when no result — ResultsEmptyState (icon + meta + last-run)      │
│                      │   • when result      — ResultsCard (existing, unchanged)             │
├──────────────────────┤                                                                       │
│ Active Query Form    │                                                                       │
│  · category eyebrow  │                                                                       │
│  · inputs            │                                                                       │
│  · run / batch       │                                                                       │
└──────────────────────┴──────────────────────────────────────────────────────────────────────┘
┌─ Console drawer — collapsed by default, state persisted to localStorage ────────────────────┐
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Files modified

- `src/features/admin/sap-testing/components/inventory-management-tab.tsx`

Single file. No new components extracted (kept the changes inline-able to avoid a 30-prop drilling layer).

## Changes in detail

### 1. New `CATEGORY_ACCENT` map

Dropped right after `categoryLabel()`. Hand-picked colours for the four work categories so the four sections of the Library don't compete with status colours (red/amber/emerald already mean error/warn/ok elsewhere on this tab):

| Category | Bar | Text |
|---|---|---|
| Warehouse | `bg-blue-500` | `text-blue-600 dark:text-blue-400` |
| Inventory | `bg-emerald-500` | `text-emerald-600 dark:text-emerald-400` |
| Master Data | `bg-amber-500` | `text-amber-600 dark:text-amber-400` |
| Tools | `bg-violet-500` | `text-violet-600 dark:text-violet-400` |
| Custom | `bg-slate-500` | `text-slate-600 dark:text-slate-400` |

Used in three places: Library category headers (1.5px dot), library buttons (left edge stripe — `opacity-30` inactive, `opacity-100` active), Form panel eyebrow (text colour), and the new `ResultsEmptyState` icon halo + accent dot.

### 2. `AgentStatusBar` rewritten as a single 40px strip

Was a `<Card><CardContent className='py-3'>` (~50px) with three branches (`checking` / `unauthenticated` / `connected`); `missing` returned null and let `<AgentNotDetectedBanner />` carry the message.

Now: a `<div className='flex h-10 items-center'>` strip in all four states. Same colour-coded session pill / version / GUI badge / session picker — just denser. Three new props (`consoleOpen`, `onToggleConsole`, `consoleMessageCount`) drive the right-aligned **Console toggle** which is shared across every state including `missing` (so the user can flip the drawer even before the agent connects).

The `missing` branch now renders a slim grey strip (`Agent offline — start it from the One Click Ship tab.`) instead of returning null. Slight regression vs round-1's "banner above + null strip below" but it keeps the Console toggle reachable from every state without a second component.

### 3. Two-pane layout replaces three-column workbench

Removed the outer `<Card className='gap-0 overflow-hidden p-0 shadow-sm'>` + inner `divide-x grid lg:grid-cols-[260px_1fr_1fr]` workbench wrapper.

New shape (`lg:items-start` so the right pane can grow):

```tsx
<div className='grid items-start gap-3 lg:grid-cols-[400px_1fr]'>
  {/* Left rail — sticky, capped at viewport-180px so it stays in view as
      result tables scroll long. Library + Form stacked. */}
  <div className='flex flex-col gap-3 lg:sticky lg:top-3 lg:max-h-[calc(100vh-180px)]'>
    <QueryLibraryCard ... className='lg:max-h-[42vh]' />
    <Card form>...</Card>
  </div>
  {/* Right pane */}
  <div className='min-w-0'>
    {result ? <ResultsCard ... /> : <ResultsEmptyState ... />}
  </div>
</div>
```

Left rail uses `lg:sticky lg:top-3` so the form stays visible while the user scrolls down through long result tables. Form Card got back its own border (`shadow-sm` + default border) since it no longer sits inside an outer wrapper that owned the chrome — rounds 2/3 stripped its chrome via `rounded-none border-0 shadow-none`.

### 4. Tool-branch (recorder / reversal-engine) preserved

Still uses `lg:grid-cols-[360px_1fr]` (Library | tool panel) — those tools take over the entire workspace and aren't a fit for the two-pane layout. Library now passes `search` / `onSearchChange` so the filter input works in tool branches too.

### 5. `QueryLibraryCard` gained filter + accent stripes

New optional props `search?: string` and `onSearchChange?: (v: string) => void`. When `onSearchChange` is provided the header renders a compact `<Input>` with a clear button. Filter is case-insensitive substring on `name + transaction`. Header badge now shows `n / total` when the filter is active.

Library buttons get a 2px category accent stripe on the left edge in all states (not just active). `opacity-30` when inactive, `opacity-70` on hover, `opacity-100` when active. Active button's icon colour switches from neutral to the category accent.

Empty state when filter matches zero queries: `No queries match "abc".` in muted text.

### 6. New `ResultsEmptyState` component (~80 LOC)

Renders in the right pane when no query has been run yet for the current `selectedQuery`. Shows:

- Icon halo (h-14 w-14 rounded-full with category-tinted bg, query's own icon centered)
- Eyebrow: accent-coloured category dot + `Warehouse / LT10`
- Title (16px semibold) + `line-clamp-3` description
- Meta row: `Last run {date}` (or `Not yet run this session`) + input count
- When `agentStatus !== 'connected'`: amber callout with the right "fix me" instruction (start agent / reconnect account / checking…)

Min height `400px` so the empty state doesn't collapse to a tiny strip on a viewport with a sparse left rail.

### 7. New `ConsoleDrawer` component

Wraps the existing `<SapConsoleCard />` with a `lg:h-[280px]` cap and a top-right close button (X icon). Renders inline below the workbench when `consoleOpen === true`. State persisted to `omniframe.inv-mgmt.console-open.v1` so the drawer state survives page reload.

Tool branches (recorder / reversal-engine) push activity into the same `consoleMessages` buffer, so the drawer stays mounted in all cases — opening it during a recording session shows recorder activity.

## Persistence keys

Added one new localStorage key:

- `omniframe.inv-mgmt.console-open.v1` — `'1'` / `'0'` for the drawer's open state.

No migration; missing key defaults to closed.

## Build / lint

- `npx tsc --noEmit -p tsconfig.json` — clean.
- `npx eslint src/features/admin/sap-testing/components/inventory-management-tab.tsx` — 0 errors, 1 pre-existing warning at line 1067 (`pollRef.current` in a cleanup function — unrelated to round-4 edits).
- `pnpm build` — succeeds in 10.7s. `feature-admin-sap` chunk size `427.35 kB / 115 kB gzip` (round-3 was `~424 kB / ~114 kB` — within noise).

No new dependencies. No agent rebuild. No `LATEST_AGENT_VERSION` bump. No Supabase migration. No RLS / capability changes.

## Trade-offs / what I considered and didn't ship

- **Console as a Sheet (slide-in modal)** instead of inline drawer: rejected because it would obscure the form/results during long-running mutations where the user wants to watch SAP logs *while* fixing inputs. Inline drawer keeps both visible.
- **Tabs in the right pane (Results | History | Inputs)**: too ambitious for a layout pass; round-5 candidate.
- **Density toggle**: most users live in one density; toggle adds settings surface that rounds 1–3 deliberately avoided.
- **Sticky right pane** instead of left rail: the natural reading order is "pick query → fill form → see results", so locking the left rail keeps the picker/form visible while results scroll.
- **Embed AgentSupabaseStatusButton inside the strip in `connected` state too** (currently only shown in `unauthenticated`): would duplicate the existing global status pill mounted by the shell. Skipped.

## Pattern impact

[[Unified-Workbench-Card-Layout]] documents the 3-column pattern from rounds 2–3. Round 4 is a deliberate move *off* that pattern for the inventory tab specifically — the asymmetric workbench (3-col fixed-height) doesn't fit when one column (results) wants to grow vertically with content. Agent Triggers tab still uses the round-2/3 unified pattern because all of its sub-panels are roughly equally bounded in height.

I added a one-line note in the Patterns/ file calling out when *not* to use the unified workbench (sections with wildly different heights).

## Related

- [[Components/Inventory-Management - SAP Query Framework]]
- [[Patterns/Unified-Workbench-Card-Layout]]
- [[Implement-SAP-Testing-Layout-Polish]] — rounds 1–3
- [[Sessions/2026-05-07]]
