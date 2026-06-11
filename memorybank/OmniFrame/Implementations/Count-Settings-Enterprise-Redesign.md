---
tags: [type/implementation, status/active, domain/frontend, domain/admin]
created: 2026-05-04
---
# Count Settings Enterprise Redesign

## Purpose / Context

The **Count Settings** tab inside Inventory Management (`src/components/count-settings.tsx`) was the last admin surface still using the pre-redesign chrome: 4 ghost-button section switchers in a thin border-bottom strip + a stacked-Card workflow editor with a sticky-bottom save bar. Visually it read as a "settings page" rather than an enterprise control surface, especially next to the redesigned SAP Testing tabs (Inventory Management workbench / Agent Triggers Mission Control).

This redesign brings Count Settings in line with the [[Unified-Workbench-Card-Layout]] pattern already shipped on `inventory-management-tab.tsx` and `agent-triggers-tab.tsx`.

## Details

### Three structural layers (replacing one)

**1. Section Rail (top-level nav)** — replaces the row of 4 ghost buttons with `border-b pb-2`.
- Single bordered Card, `gap-0 overflow-hidden p-0`, with internal grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` and `divide-x lg:divide-y-0` rules.
- Each cell (`<SectionTile>`) is icon-chip + title + one-line description + chevron, plus a 0.5px top accent rail (`bg-primary` / `bg-blue-500` / `bg-emerald-500` / `bg-amber-500`) that lights up when active.
- Each section gets its own brand colour so users can scan rails like a top-level KPI strip.

**2. Domain Header + KPI Strip** — Workflow Rules now opens with a single Card containing:
- Top row: title ("Count Workflow Settings") + helper sentence + state pills (`v{version}`, `Unsaved changes` / `In sync`).
- Bottom row: 4-cell `<StatCell>` strip (`Configured` / `Active` / `Inactive` / `Avg Steps`) — same 1-px-divider pattern. Computes `avg = round(stepsTotal / total * 10) / 10`.

**3. Workbench Card** — replaces the previous `lg:grid-cols-[360px_1fr]` two-pane that was just CSS gap.
- One bordered Card holding sidebar (`320px`) + editor.
- Sidebar: search + New button on top, then **status-filter chips** (`All N` / `Active N` / `Inactive N`), then a denser list. Each list item is a button with a left status rail (`bg-primary w-0.5`) when selected, count slug shown as `<code class='font-mono'>`, status dot + chevron on the right.
- Editor: **toolbar at the top** instead of footer save. Identity chip (icon + name + slug + version) on the left, then on the right: validation pill, active-state pill+switch, Reset, Save. Body section has Identity (Display Name / Slug readonly / Description) + Steps. Empty state moved to its own `<EmptyEditorState>` with keyboard-hint cards.

### Validation pill

Validation is now **continuously evaluated** via `useMemo` on `editedSteps` and surfaced as a pill in the editor toolbar:
- Green "Valid" with `CheckCircle2` when `validateSteps(editedSteps)` returns `[]`.
- Amber "N issues" with `AlertTriangle` otherwise.
- An inline amber banner under the toolbar lists each issue (no longer surfaced only on save attempt).
- Save is `disabled` when validation fails, in addition to existing `!hasUnsavedChanges` / `isSaving` / `isResetting` gates.

### Behaviour preservation

All existing flows kept identical:
- DnD step reorder (`@dnd-kit/sortable`).
- Add Step popover (now labelled "Step Library").
- Required/Optional toggle on each step card.
- Create-Workflow dialog with preset chips, slug auto-derive, validation regex.
- `useWorkflowConfigs` hook untouched. `WorkflowConfigService.upsertConfig` / `resetToDefault` unchanged.
- Lazy-loaded sub-panels (`PathEnginePanel`, `ZoneRulesPanel`, `PriorityRulesPanel`) still mounted via `Suspense` based on `activeSection`.

### Files Touched

- `src/components/count-settings.tsx` — full redesign of `CountSettings` shell + `WorkflowRulesPanel`. Added `SectionTile`, `StatCell`, `EmptyEditorState` helpers and `SECTIONS` config. Removed the old footer save bar (moved to top toolbar). Replaced single-card "Header + Steps" stack with one workbench Card.

### Quality

- `tsc -b --noEmit` clean (one stale `CardContent`/`CardHeader`/`CardTitle` import removed after first pass).
- `eslint src/components/count-settings.tsx` clean.
- `prettier --check` clean (after `--write`).
- `pnpm build` succeeds in ~11s with no new bundle-budget violations.

## Related

- [[Unified-Workbench-Card-Layout]] — pattern source
- [[Add-New-Count-Workflow-Button]] — prior major iteration
- [[Cycle-Count-Priority-Rules-And-Heartbeat-Release]] — added the `Priority Rules` 4th section
- [[Cycle-Count-Zone-Exclusivity]] — added the `Zone Rules` 3rd section
- [[Components/Configuration Services - Supabase Service]]
