---
tags: [type/debug, status/active, domain/frontend]
created: 2026-05-13
---
# Fix: SQCDP Editor Live Preview Bleed-Through

## Symptom

In the **Edit metric · {Title}** dialog (`SqcdpEditorDialog`), the form labels and inputs from the active tab were visibly *floating beneath* the sticky live-preview card at the top of the dialog body. Most obvious on the Basics tab where `Days since last LTI` (subtitle field), the `Format / Period` row, and `Current value / Target` row were ghosting through the live-preview surface as the user scrolled.

## Root Cause

The v12 layout placed the live preview at the top of a single-column scrolling form body using:

```tsx
<div className='border-border/50 bg-muted/20 sticky top-0 z-10 ... backdrop-blur-sm'>
  <SqcdpCard ... />
</div>
```

The combination of `bg-muted/20` (≈ 20 % opacity) plus `backdrop-blur-sm` is a frosted-glass treatment — it intentionally lets background content show through. As the form below scrolled, the inputs scrolled UP behind the sticky preview, and the translucent backdrop made them visible. On a light theme that surfaces as the floating-text artifact in the screenshot.

Two possible fixes:

1. **Quick fix** — swap `bg-muted/20 backdrop-blur-sm` for `bg-background` (fully opaque). Removes the bleed-through but keeps the editor as a tall single-column scroll.
2. **Layout fix** (chosen) — restructure the dialog body into a SIDE-BY-SIDE split: preview pinned in a dedicated left column, tabs + controls + footer in a scrollable right column. There's nothing for the preview to bleed *over*, so the translucency requirement disappears entirely. Bonus: the right column gets a sticky footer so Save / Cancel / Delete are always reachable.

## The Fix

`src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-editor-dialog.tsx`

1. Bumped `<DialogContent>` from `sm:max-w-[920px]` → `sm:max-w-[1040px]` and changed it from grid to flex column so child rows can fill available height.
2. Replaced the body's `max-h-[calc(88vh-7rem)] overflow-y-auto px-6 py-5` wrapper with a `flex min-h-0 flex-1 flex-col overflow-hidden` shell. Padding moved into each pane so the panes are flush against the body edges.
3. Inside `MetricForm`, the `<form>` element is now the flex container:
   - `flex flex-col overflow-y-auto md:flex-row md:overflow-hidden`
   - Mobile (`< md`): stacked, single scroll.
   - md+: side-by-side, each pane its own scroll.
4. `<aside>` left pane: `bg-muted/20 border-r md:w-[380px] md:overflow-y-auto`. Hosts `<LivePreview>` only.
5. `<div>` right pane: `flex flex-1 flex-col md:overflow-hidden`. Inside it, a `flex-1 md:overflow-y-auto` content area for the `<Tabs>` and a `border-t shrink-0` `<DialogFooter>` pinned at the bottom.
6. `<LivePreview>` simplified — dropped `sticky top-0 z-10`, `bg-muted/20`, `backdrop-blur-sm`, the rounded outer border, and the `mx-auto max-w-md` centering wrapper. The card now fills the column width.
7. `ProblemForm` got a matching scroll wrapper + sticky footer (single column — no preview to split off).

## Why side-by-side and not just opaque background

The quick fix (`bg-background` on the sticky preview) would have stopped the visual artifact, but the underlying UX issue is the same as the bleed-through: the curator was working in a tall scrolling column where the preview competes with the form fields for vertical real estate, and the sticky overlay only showed the top ~280 px of the dialog body's available height. Splitting the layout gives the preview its own committed column (always visible, always at native size) AND gives the form column its own scroll — so the History tab's embedded `<SqcdpHistoryEditor>` no longer fights the preview for the same scroll axis.

## Mobile behaviour

`md` breakpoint (768 px) is the cut-over. Below `md`, the dialog stacks: preview on top with a bottom border, form below, both inside a single `overflow-y-auto` column. The `<DialogFooter>` is `sticky bottom-0` on mobile so the action buttons stay reachable while scrolling. At `md+`, the footer becomes `md:static` (it's already pinned by the right pane's flex-col layout — sticky would be redundant).

## Verification

- `pnpm tsc --noEmit -p tsconfig.app.json` — clean.
- `pnpm prettier --write` — file is formatted.
- `ReadLints` — no linter errors.
- No tests directly cover `SqcdpEditorDialog`; the supporting tests (`sqcdp-card.test.tsx`, `sqcdp-chart.test.tsx`, `sqcdp-history-editor.test.tsx`) are layout-agnostic.

## Related

- [[Editable-Board-Dialogs]] — the host pattern; updated with a v12.3 "Side-by-side preview / controls layout" section pointing here.
- [[Editable-Board-Sheets]] — sibling pattern (Sheet not Dialog), unaffected.
- [[Implementations/Implement-Production-Boards-Hourly-Grid]] — primary implementation log for SQCDP editor evolution.
- [[Sessions/2026-05-13]] — session log with the change context.
