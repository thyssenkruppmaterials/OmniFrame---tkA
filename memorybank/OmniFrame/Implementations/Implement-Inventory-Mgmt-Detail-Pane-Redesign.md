---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-05-09
---
# Implement Inventory Management — Unified Detail Pane (Round 5)

## Purpose / Context

Round-5 layout polish on the SAP Testing → Inventory Management tab. Round 4 ([[Implement-Inventory-Mgmt-Two-Pane-Redesign]]) introduced a sticky two-pane layout where the **left rail stacked the Query Library on top of the active query Form Card** while the right pane was results-first (`ResultsCard` or `ResultsEmptyState`). User feedback on that round (2026-05-09 screenshot) flagged a continuing scroll-and-back-and-forth flow:

1. Selecting a query in the Library scrolled the Library out of view to surface the form below it.
2. The query *description* lived in the right-pane empty state while the form fields lived BELOW the library — so a user reading the description had to look down-and-left to find the inputs they were supposed to fill.
3. The "Transfer Inventory (LT01)" quick-action button hung off the bottom of the Form Card as a full-width row, separated from the primary Run button.

Round 5 unifies the description + status + form into a **single Query Detail Card in the right pane** so picking a query in the Library immediately reveals everything needed to run it without scrolling. The Library shrinks to the space it actually needs (320px column, alone in the left rail) and stays sticky.

## Final shape

```
┌─ AgentNotDetectedBanner (only when missing — slim 32px strip) ─────────────────────────────┐
├─ Auto-update banner (only when needs update) ───────────────────────────────────────────────┤
├─ AgentStatusBar (h-10 strip — env pill, version, GUI, session picker, [Console ⇈]) ─────────┤
├─────────────────────┬───────────────────────────────────────────────────────────────────────┤
│ Query Library       │ ┌─ Query Detail Card ──────────────────────────────────────────────┐ │
│ (320px, sticky,     │ │ category eyebrow + name + transcode badge                        │ │
│  capped at          │ │ line-clamp description                                            │ │
│  viewport-180px)    │ ├─── status strip (border-y, bg-muted/30) ─────────────────────────┤ │
│ · filter input      │ │ Last run … · N inputs · [agent gating callout when offline]      │ │
│ · category accents  │ ├─── form ──────────────────────────────────────────────────────────┤ │
│ · grouped list      │ │ inputs grid (md:cols-2 lg:cols-3)                                 │ │
│                     │ │ [Run Query] [Refresh] [Batch Mode] [⇄ Transfer Inventory (LT01)] │ │
│                     │ │ BatchModePanel (when open)                                        │ │
│                     │ └───────────────────────────────────────────────────────────────────┘ │
│                     │ ┌─ Results ─────────────────────────────────────────────────────────┐ │
│                     │ │ ResultsCard (when result) OR compact dashed placeholder          │ │
│                     │ └───────────────────────────────────────────────────────────────────┘ │
├─────────────────────┴───────────────────────────────────────────────────────────────────────┤
│ Console drawer (collapsible bottom panel — toggled from AgentStatusBar)                     │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Files modified

- `src/features/admin/sap-testing/components/inventory-management-tab.tsx` — single file. Pure layout/UX restructure; same data, same handlers, better composition.

## Changes in detail

### 1. Form Card lifted out of the left rail into the right pane

The round-4 left rail (`flex flex-col gap-3 lg:sticky lg:top-3 lg:max-h-[calc(100vh-180px)]`) used to stack Library (`lg:max-h-[42vh]`) on top of an active query Form Card. Round 5 removes the Form Card from the left rail entirely. The new left rail is a single Card (Library) that fills the whole sticky column up to `viewport-180px`.

```diff
-<div className='grid items-start gap-3 lg:grid-cols-[400px_1fr]'>
+<div className='grid items-start gap-3 lg:grid-cols-[320px_1fr]'>
   {/* Left rail */}
-  <div className='flex flex-col gap-3 lg:sticky lg:top-3 lg:max-h-[calc(100vh-180px)]'>
-    <QueryLibraryCard … className='lg:max-h-[42vh]' />
-    <Card>{/* Form Card */}…</Card>
-  </div>
+  <div className='lg:sticky lg:top-3 lg:max-h-[calc(100vh-180px)]'>
+    <QueryLibraryCard … className='lg:max-h-[calc(100vh-180px)]' />
+  </div>
```

The inventory-adjustment tool branch was aligned to the same 320px column for consistency (was 400px). Recorder + Reversal-Engine branches keep their existing 360px column since they replace the whole workspace.

### 2. New Query Detail Card composes identity → status → form

The right pane's previous shape was `result ? <ResultsCard /> : <ResultsEmptyState />`. The empty state held a duplicate identity block (icon halo + eyebrow + name + description + last-run + agent gating) which was effectively the form Card's header *minus the form*.

Round 5 moves identity into a new top-of-pane **Query Detail Card** that owns the form too:

```tsx
<Card className='flex flex-col gap-0 overflow-hidden py-0 shadow-sm'>
  <CardHeader>{/* category eyebrow + name + transcode + line-clamp description */}</CardHeader>
  <div className='bg-muted/30 border-y px-6 py-2 text-[11px]'>
    {/* Status strip: Last run … · N inputs · agent-gating callout (when offline) */}
  </div>
  <CardContent>
    {/* Inputs grid (md:cols-2 lg:cols-3) */}
    {/* Action row: Run + Refresh + Batch Mode + Transfer Inventory chip */}
    {/* BatchModePanel when batchOpen */}
  </CardContent>
</Card>
```

`gap-0 py-0` on the Card and `border-y` on the inline status strip create a 3-band visual hierarchy without nesting Cards: **header band** → **status band** (subtle muted background) → **content band** (form + actions). Reads as one column.

### 3. Inputs grid widened

Form inputs went from `grid gap-3 md:grid-cols-2` (round 4 — fit inside a 400px-wide left rail Card) to `grid gap-3 md:grid-cols-2 lg:grid-cols-3` (round 5 — full right-pane width). The 3-input LT10 form (Material / Warehouse / Storage Type) now fits on a single line at `lg`+ instead of wrapping to two rows.

### 4. Status strip with inline agent-gating

Instead of a separate "agent offline" callout sitting in the empty-state Card (which only existed when no result was loaded), the new strip lives between the description and the form **on every page state** — so the user sees `Start the SAP agent to enable this query.` next to the form they're trying to fill, even after a stale prior result is loaded:

```tsx
<div className='bg-muted/30 border-y px-6 py-2 text-[11px] flex flex-wrap items-center gap-x-3 gap-y-1.5'>
  {lastRunAt ? <>Last run <strong>{time}</strong></> : <><Sparkles /> Not yet run this session</>}
  · <strong>{N}</strong> inputs
  {agentStatus !== 'connected' && (
    <span className='ml-auto … border-amber-500/40 bg-amber-500/5 …'>
      <ShieldAlert /> {missing|unauthenticated|checking message}
    </span>
  )}
</div>
```

Messages by `agentStatus`:
| Status | Message |
|---|---|
| `missing` | `Start the SAP agent to enable this query.` |
| `unauthenticated` | `Reconnect the agent account to enable this query.` |
| `checking` | `Checking agent…` |
| `connected` | (callout hidden) |

### 5. Run button tooltip mirrors the inline status

The Run / Run Query button's `title` attribute used to show only the capability-missing reason. Round 5 extends `disabledReason` to include the same offline-agent message so the disabled button is self-explanatory on hover even when the inline strip is scrolled off:

```tsx
const disabledReason = capMissing
  ? `Requires agent v${LATEST_AGENT_VERSION}+ (capability '${cap}' missing)`
  : offline
    ? agentStatus === 'missing'
      ? 'Start the SAP agent to enable this query.'
      : agentStatus === 'unauthenticated'
        ? 'Reconnect the agent account to enable this query.'
        : 'Checking agent…'
    : ''
```

No change in actual disabled logic (`!canRun || capMissing` was already correct); only the explanatory text expanded.

### 6. Transfer Inventory (LT01) becomes a chip

Round 4 rendered the LT10 manual entry-point as a `<Button className='w-full'>` taking up its own row beneath the form. Round 5 demotes it to an `<Button variant='outline' size='sm'>` chip in the same flex row as Run + Batch Mode. Same capability gate (`transfer-inventory`), same prefill payload (`manual: true`), same dialog.

### 7. ResultsEmptyState compacted

The component stayed as `function ResultsEmptyState({ query })` but the props collapsed from `{ query, lastRunAt, agentStatus }` to `{ query }` — `lastRunAt` and `agentStatus` are now in the Detail card's status strip directly above, so the empty state no longer duplicates them. The body shrunk from a `min-h-[400px]` Card with icon halo + eyebrow + name + description + last-run + agent gating to a single dashed-border row:

```tsx
<div className='border-muted-foreground/30 bg-muted/20 flex items-center gap-3 rounded-lg border border-dashed px-6 py-6'>
  <div className={cn('rounded-md p-2', accent.bg)}>
    <Layers className={cn('h-4 w-4', accent.icon)} />
  </div>
  <div className='min-w-0 flex-1 text-xs'>
    <div className='text-foreground text-sm font-medium'>No results yet</div>
    <div>Run <span className='font-mono'>{query.transaction}</span> from the form above to populate this area.</div>
  </div>
</div>
```

The empty-state is now ~64px tall (was ~400px) and reads as a placeholder, not a competing identity block.

## Component composition (new shape)

```
InventoryManagementTab
├── AgentNotDetectedBanner       (only when agentStatus === 'missing')
├── Auto-update banner            (only when agentNeedsUpdate)
├── AgentStatusBar                (h-10 strip with Console toggle)
├── Two-pane workbench (or tool branch — recorder/reversal-engine/inventory-adjustment)
│   ├── Left rail (320px sticky)
│   │   └── QueryLibraryCard      (filter + grouped list)
│   └── Right pane (flex column)
│       ├── Query Detail Card
│       │   ├── CardHeader        (category eyebrow + name + transcode + description)
│       │   ├── Status strip      (last-run, input count, agent-gating callout)
│       │   └── CardContent
│       │       ├── Inputs grid   (md:cols-2 lg:cols-3)
│       │       ├── Action row    (Run + Refresh + Batch Mode + LT01 chip)
│       │       └── BatchModePanel (conditional)
│       └── ResultsCard | ResultsEmptyState  (below detail card)
├── ConsoleDrawer                 (toggled from AgentStatusBar)
└── Dialogs                        (Transfer / BinBlocks / DryRun / BigBatchConfirm)
```

Lifted state stays in the parent. No new components extracted (the Detail card is composed inline; abstracting it would require ~25 props) — the JSX block is well-commented and readable as-is.

## Constraint compliance

- ✅ No new `supabase.channel(...)` callsites (this was a pure layout change; existing realtime usage untouched).
- ✅ No new dependencies, no `manualChunks` change in `vite.config.ts`.
- ✅ No edit to `src/routeTree.gen.ts`.
- ✅ Preserved every handler (`runQuery`, `runMutation`, `runBatch`, `openSingleDryRun`, `openBatchDryRun`, `handleAddToInventoryAdjustment`), every dialog, every capability gate, every persistence key (`omniframe.inventory_query_inputs.v1`, `omniframe.inventory_console.v1`, `omniframe.inv-mgmt.console-open.v1`, batch CSV history, queue mode, pinned agent).
- ✅ Accessibility preserved — every input keeps its `<Label htmlFor>`, the form Enter-key handler still triggers `runQuery()`, the Run button focus order is identical (after the last input), the LT01 chip has a `title` attribute explaining its disabled state.

## Build / lint / type-check

- `pnpm exec tsc -b` — clean (20.7s).
- `pnpm exec eslint src/features/admin/sap-testing/components/inventory-management-tab.tsx` — 0 errors. 1 warning (`pollRef.current` cleanup at line 1199, **pre-existing** since the round-4 cleanup of the legacy 3s polling loop — not introduced by this change).
- `node scripts/lint-ratchet.mjs` — repo-wide warning count unchanged before/after this edit (verified by `git stash && lint-ratchet && git stash pop`). Baseline drift (93 vs 16) is a pre-existing repo-wide condition unrelated to this change.
- No new `eslint-disable` directives added.
- `pnpm test:unit` — 4 unrelated test files fail in the security/zone-rules suite due to jsdom auth-js / Web Crypto storage shimming issues that pre-date this change. No tests target inventory-management-tab; manual smoke would be the user's next step.

## Persistence keys

No change. All localStorage keys from rounds 1–4 still in use:

- `omniframe.inventory_query_inputs.v1` — last-used input values per query
- `omniframe.inventory_console.v1` — SAP console buffer
- `omniframe.inv-mgmt.console-open.v1` — console drawer open state
- `omniframe.batch_queue_mode.v1` — batch queue mode toggle
- `omniframe.last_batch.<queryId>` — last-submitted CSV per query
- `sap.testing.pinned-agent-id` — pinned fleet agent for queue dispatch

## Trade-offs considered and rejected

- **Extract a `<QueryDetailPane>` component**: would require ~25 props (every state + every handler). Inlining the JSX keeps the parent's render readable and avoids a fragile prop-drilling layer. If a future round adds more sections (e.g. saved presets, recent runs), a sub-component refactor becomes worth it.
- **`<ResizablePanelGroup>` for the two-pane split**: shadcn primitive available, but the left rail is content-bounded (Library has fixed natural height) and the right rail wants to grow with results — a fixed 320px rail + sticky positioning is simpler and matches the round-4 sticky behaviour that already worked.
- **Form sticky at the top of the right pane while results scroll**: rejected. The natural reading order is identity → form → results; locking the detail card breaks long-form scroll-through behaviour and conflicts with the sticky left-rail (would need 2 sticky containers).
- **Persist library/right-pane split**: no existing persistence pattern for resizable panels in the repo; out of scope.

## Pattern impact

This round leans further away from the [[Patterns/Unified-Workbench-Card-Layout]] pattern (3-column fixed-height workbench) for the inventory tab. Round 4 already moved off the unified workbench because results want to grow vertically; round 5 also moves the form out of the left rail because the form belongs visually with the description, not with the picker. The pattern note's "When NOT to use" section already covers this case (asymmetric heights / content-bounded sections); no edit needed to the pattern.

## Related

- [[Components/Inventory-Management - SAP Query Framework]]
- [[Implement-Inventory-Mgmt-Two-Pane-Redesign]] — round 4
- [[Implement-SAP-Testing-Layout-Polish]] — rounds 1–3
- [[Patterns/Unified-Workbench-Card-Layout]]
- [[Sessions/2026-05-09]]
