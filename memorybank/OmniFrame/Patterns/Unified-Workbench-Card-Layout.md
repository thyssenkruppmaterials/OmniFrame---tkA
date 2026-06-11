---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-02
---
# Unified Workbench Card Layout

## Purpose / Context

Reusable layout pattern for "control center" pages that have **N tightly-coupled sections** (typically 2–5) that need to read as **one cohesive surface** rather than several floating cards separated by gutters.

Surfaced from the 2026-05-02 round-2 SAP Testing redesign (see [[Implement-SAP-Testing-Layout-Polish]] § Round 2). Replaced (a) the 3-Card grid in Inventory Management (Library / Form / Console) and (b) the 5-Card KPI row + 2-Card Triggers/Console split in Agent Triggers.

The fragmented "card-per-section" approach was dashboard-y but visually noisy — each card competing for attention with its own border, shadow, and gutter. A single bordered container with internal 1px dividers reads as enterprise control-surface instead of "5 floating widgets."

## Anatomy

```tsx
// Outer wrapper Card — the only visible chrome
<Card className='gap-0 overflow-hidden p-0 shadow-sm'>
  {/* Internal grid with dividers between cells */}
  <div className='divide-border grid divide-y lg:h-[440px] lg:grid-cols-[260px_1fr_1fr] lg:divide-x lg:divide-y-0'>
    {/* Each child is "embedded" — strips its own Card chrome */}
    <ChildSection className='gap-3 rounded-none border-0 py-4 shadow-none lg:h-full' />
    <ChildSection className='gap-3 rounded-none border-0 py-4 shadow-none lg:h-full' />
    <ChildSection className='gap-3 rounded-none border-0 py-4 shadow-none lg:h-full' />
  </div>
</Card>
```

Required pieces:

| Piece | Why |
|---|---|
| `gap-0 overflow-hidden p-0` on outer Card | Default Card uses `gap-6 py-6 rounded-xl border shadow-sm`. We keep the rounded border + shadow but kill the internal padding so children go edge-to-edge. `overflow-hidden` is what lets `divide-x` lines stop cleanly at the rounded corners. |
| `divide-y lg:divide-x lg:divide-y-0` on inner grid | Horizontal divider between rows on small screens (children stack); vertical 1px divider between columns at `lg`+. `divide-border` token matches the outer Card border. |
| `lg:h-[Npx]` on the grid (or outer Card) | Locks all sections to the same height so dividers reach floor-to-ceiling. Children also need `lg:h-full` and `min-h-0` (to let scroll containers actually scroll). |
| `rounded-none border-0 shadow-none` on each child Card | Strips the inner Card's border/shadow/rounded-corner so only the outer Card chrome shows. The child still keeps its `flex flex-col` + header/content structure. |
| `gap-3 py-4` on each child Card | Tightens the default `gap-6 py-6` so embedded sections feel denser than they would as standalone Cards. Tweak per-design — `gap-3` is the redesign baseline. |

Children that scroll need `min-h-0 flex-1 overflow-y-auto` on their CardContent so the scrollbar lives inside the section instead of pushing the whole grid taller than `lg:h-[Npx]`.

## When to use

✅ Sections are conceptually one workspace (e.g. picker → form → output, or KPI strip).
✅ Sections benefit from being side-by-side at desktop width.
✅ You want consistent typography/header treatment across sections.

❌ Sections are independent and the user might collapse one but not another (use separate Cards — the divider would look broken if one column collapses).
❌ Sections have wildly different heights (e.g. one is 80px tall and another is 600px) — the locked height forces wasted whitespace.
❌ Single-section page — just use a regular Card.

## Variants

### Wide horizontal strip (KPI bar)
- 5 cells, equal width via `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5`
- No fixed height; cells size to content
- Each cell is a plain `<div>` (not a Card) since there's no internal scroll/header structure to preserve

```tsx
<Card className='gap-0 overflow-hidden p-0 shadow-sm'>
  <div className='divide-border grid grid-cols-2 divide-y sm:grid-cols-3 lg:grid-cols-5 lg:divide-x lg:divide-y-0'>
    <KpiCell ... />  {/* plain div with hover:bg-accent/30 */}
    ...
  </div>
</Card>
```

Live example: `KpiRow` + `KpiCell` in `agent-triggers-tab.tsx` (round 2).

### Asymmetric workbench (3-column query workbench)
- `lg:grid-cols-[260px_1fr_1fr]` — narrow picker, equal-width form/output
- Fixed `lg:h-[440px]` so dividers are full-height
- Each column is its own embedded Card

Live example: Inventory Management — Library / Form / Console.

### Two-pane control surface (Triggers + Console)
- `lg:grid-cols-5` with `col-span-3` / `col-span-2` for asymmetric weighting
- Viewport-fill height: `lg:h-[calc(100vh-260px)] lg:min-h-[480px]`

Live example: Agent Triggers — Triggers list + Console.

## Header style for embedded sections

To keep the three sections legible without their own borders, use a **small uppercase eyebrow** for section titles instead of a heavy `text-base` CardTitle:

```tsx
<CardTitle className='text-muted-foreground flex items-center gap-2 text-[11px] font-semibold tracking-[0.08em] uppercase'>
  <Icon className='h-3.5 w-3.5' />
  Section Name
  <Badge variant='secondary' className='ml-auto font-mono text-[10px] font-normal'>{count}</Badge>
</CardTitle>
```

The form/center section can use a heavier title (e.g. `text-[15px] font-semibold`) when it's the primary work surface — visual weight matches importance.

## Embedded console gotcha

The shared `SapConsoleCard` renders a dark terminal area inside its CardContent. With `p-0` on CardContent and the outer Card now flush, the dark area becomes a hard square edge-to-edge slab. Fix is to give the terminal **inset padding** + soften it:

```tsx
<CardContent className='min-h-0 flex-1 px-3 pb-3'>
  <div className='h-full overflow-y-auto rounded-lg border border-zinc-800/40 bg-zinc-950/40 px-3 py-2 shadow-inner ...'>
```

Now the terminal floats as a "panel within a panel" instead of black-square slab. This change benefits both the embedded inventory workbench AND the standalone Agent Triggers console where the SapConsoleCard still has its own outer border.

## Why outer chrome only

Modern dashboard pattern (Linear, Vercel, Supabase Studio) is to have a **single bordered surface per logical workspace**, with internal structure conveyed by typography + 1px dividers + spacing rather than nested borders. Fragmented card stacks read as Bootstrap-era admin panels.

## Related

- [[UI-Component-Conventions]]
- [[Implement-SAP-Testing-Layout-Polish]] — first application
- [[Components/Inventory-Management - SAP Query Framework]]
- [[Components/Agent-Triggers - Realtime Automation]]



## 2026-05-03 — Pattern applied two more places on Agent Triggers (round 3)

### Mission Control Header
The five-cell KPI Card from round 2 is now the **bottom half** of a single bordered Card. The **top half** is a status strip (`<StatusStrip />`) with the env pill / agent version / SAP GUI badge / Connect Account / refresh — what used to be the standalone `<AgentStatusBar />`. A 1-px `border-t` separates them. Border colour mirrors agent state (emerald/amber/red/none). One Card replaces two.

### Fleet & Diagnostics Panel
`AgentHealthCard` (per-process metrics) and `AgentsFleetCard` (org-wide registry) are now rendered side-by-side inside a single bordered Card via `lg:grid-cols-2 lg:divide-x`. Both child Cards accept a `className?` prop (added today) and are passed `gap-0 rounded-none border-0 py-0 shadow-none` so the parent Card owns the chrome. Same trick the round-2 workbench used for `SapConsoleCard`.

### Generalised "child Card needs to embed inside parent Card" recipe
When you want a self-contained Card component (header, refresh button, collapsible body) to live inside a parent unified Card:
1. Add `className?: string` to the child's props.
2. Inside the child, merge it into the outer Card's classes via `cn(...)`.
3. From the parent, pass `gap-0 rounded-none border-0 py-0 shadow-none` (or similar) to strip the outer chrome while leaving the inner content, header, and event handlers intact.
4. Wrap the children in the parent Card with `divide-x` / `divide-y` and let the parent own the border + shadow.

This recipe now applies to: `SapConsoleCard` (round 2 workbench), `AgentHealthCard` (round 3 fleet panel), `AgentsFleetCard` (round 3 fleet panel).

### Where this pattern is now used
- **Inventory Management** — Library + Form + Console workbench (round 2).
- **Agent Triggers** — Triggers + Console workbench (round 2), Mission Control (round 3), Fleet & Diagnostics (round 3).

See [[Sessions/2026-05-03]] for the full diff.



## 2026-05-07 — When NOT to use this pattern (Inventory Mgmt round-4)

The Inventory Management tab moved *off* this pattern in round 4 ([[Implement-Inventory-Mgmt-Two-Pane-Redesign]]). The fixed-height 3-column workbench (`lg:grid-cols-[260px_1fr_1fr] lg:h-[440px]`) ran into the limitation already noted in the original "When to use" section:

> ❌ Sections have wildly different heights (e.g. one is 80px tall and another is 600px) — the locked height forces wasted whitespace.

Inventory's results column wants to grow vertically with row count. Locking the workbench at 440px meant either the results table couldn't render in-place (round 1–3 split it out into a separate Card *below* the workbench, leaving the right column underused) or had to scroll inside a 440px window (cramped on long tables). The round-4 fix is a **two-pane** layout (`lg:grid-cols-[400px_1fr] lg:items-start`) where the left rail is `lg:sticky` and the right pane is free to grow.

Rule of thumb: **use the unified workbench when all sections fit naturally inside the same fixed height (Triggers list + Console — both bounded by viewport; KPI strip — content-sized).** Use a two-pane layout with a sticky rail when one section is content-bounded (results, charts, long lists) and the others are bounded inputs.

Agent Triggers is still on the unified pattern because its sub-panels (KPI cells, status strip, observability cards, triggers/console workbench) are all roughly equally bounded.