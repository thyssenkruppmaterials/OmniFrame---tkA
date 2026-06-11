---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-05-20
---
# Redesign Kit Build Audit Trail Dialog Layout

## Purpose / Context

The Kit Build Audit Trail dialog (rendered from `KitProductionTrackerDialog` in `src/components/kitting/kit-production-tracker.tsx`) is the primary surface for inspecting one in-flight kit: identifiers, stage progress, ship-short authorizations, flags, audit-trail chat, and TO lines.

The previous layout had several visual issues:

1. **Cramped header** — title, description, and three action buttons (Edit Ship Short / Delete Kit / Refresh) competed for one row, causing the description to wrap awkwardly under the buttons on narrower widths.
2. **Wall of separate cards** — Kit Information (4-col grid) and Timeline & Dates (3-col grid) were two adjacent cards even though both are just kit metadata.
3. **Unbalanced 2-col body** — Production Progress on the left vs. Flags + Notes stacked on the right made the Kit Notes pane only ~320px tall, which felt cramped for an iOS-style chat audit trail.
4. **Mixed button styles** — amber outline (Edit Ship Short) + destructive red (Delete Kit) + outline (Refresh) created visual noise in the header.
5. **Inconsistent card chrome** — some headers used `bg-muted/50`, others didn't; `CardHeader` `pb-3` everywhere but no divider between header and content.

## Details

### Dialog shell

- Width bumped from `max-w-[1400px] min-w-[1200px]` → `max-w-[1600px] min-w-[1280px]`, max-height from `85vh` → `90vh`.
- `DialogContent` now uses `p-0` so the header can be sticky with its own padding and the body can scroll under it.
- New sticky header: `bg-background sticky top-0 z-10 border-b px-6 pt-6 pb-4 pr-14` (the `pr-14` clears the close-X button).
- Body wrapped in `<div className='px-6 pt-2 pb-6'>`.

### Header

- Title row uses `flex flex-wrap items-center gap-3` so the status `Badge` sits inline with **Kit Build Audit Trail** instead of repeated in the Kit Information grid.
- Description renders the kit serial number in `font-mono font-medium` for quick scanning.
- Right side: `Edit Ship Short` (amber outline) + `Delete Kit` (destructive) + `Refresh` (ghost icon-only with sr-only label and `title='Refresh kit data'`). All buttons forced to `h-9` for vertical alignment.

### Kit Overview card (merged Information + Timeline)

Replaces the two prior cards with one consolidated `Kit Overview` card:

- Header strip: `Kit Overview` title left, **Priority** pill right.
- Body: `grid grid-cols-2 gap-x-6 gap-y-5 text-sm md:grid-cols-3 lg:grid-cols-5` with all 9 fields.
- Identifier fields (Kit Serial Number, Kit PO Number, Kit Build Number) render in `font-mono font-semibold` for legibility.
- Field labels use `text-muted-foreground text-xs font-medium tracking-wide uppercase` — a small-caps treatment that visually subordinates labels to values.
- `Current Status` no longer appears here — it's promoted into the dialog title row.
- `Created At` spans 2 cols on the 5-col grid to fill the row.

### Body grid — 3-column Progress | Flags | Notes

Replaces `grid-cols-2` with `grid-cols-1 gap-5 lg:grid-cols-12`:

- **Production Progress** — `lg:col-span-4`.
- **Kit Build Flags** — `lg:col-span-3`.
- **Kit Notes** — `lg:col-span-5`, height `h-[520px]` (was 320px). Header shows an `Audit trail` hint on the right.

All three card headers normalized:

- Title size `text-base font-semibold` (was `text-lg`).
- Icons sized `h-4 w-4 text-muted-foreground` for subordination.
- `border-b pb-3` divider between header and content.
- `CardContent` uses `pt-5` to compensate for the divider.

Flag card's `Add Flag` button shrunk to `h-8 gap-1.5` so it sits naturally in the narrower 3/12 column.

### TO Lines table

- Header chrome unified with the other cards (`border-b pb-3`, `text-base`, smaller icon).
- Title now shows total count inline: `Transfer Order Lines (N total)`.

## Files Touched

- `src/components/kitting/kit-production-tracker.tsx` — single-file change; only JSX/layout, no business logic.

## Functional Invariants Preserved

- All callbacks (`handleAddFlag`, `handleRemoveFlag`, `handleClearFlag`, `handleSaveShipShort`, `handleDeleteKit`, `handleSendMessage`, `handleBlackHatPanelSaved`) unchanged.
- All `useState` / `useEffect` / `useCallback` / `useMemo` hooks unchanged.
- All framer-motion variants (`containerVariants`, `itemVariants`, `fadeInVariants`, `springTransition`) reused as-is.
- `BlackHatShipShortPanel`, `EditShipShortDialog`, `ConfirmDialog` mounted in same positions and with same props.
- Inspection-stage hiding logic (`kitInspectionRequired`) preserved.
- Chat synthesizing logic (`chatMessages` memo + synthetic `kit_created` entry) untouched.

## Verification

- `npx tsc -b --force` — clean.
- `npx eslint src/components/kitting/kit-production-tracker.tsx` — clean.
- `npx prettier --write` applied.
- Lint ratchet was already failing for unrelated files in the working tree (95 warnings vs baseline 16) — this file contributes 0 new warnings.

## Related

- [[Black-Hat-Ship-Short-Authorization-Panel]]
- [[Persist-Kit-Notes-Chat-Thread]]
- [[Edit-Ship-Short-Post-Creation-Flow]]
- [[Authorized-Ship-Short-Negates-Black-Hat]]


## V2 Redesign — Enterprise Record-Detail Layout (same day)

User feedback after the V1 redesign: the 3-column body "looks like a wall of small disconnected boxes" and is not enterprise-feeling. Specific issues seen in the screenshot:

1. `Kit Build Flags` title wrapped onto two lines because the col-span-3 column was too narrow once the Add Flag button took its space.
2. Vertical timeline wasted vertical space on a wide dialog.
3. The orange Priority pill in the Kit Overview header strip looked redundant next to the Status badge.
4. Kit Overview's 9-field grid felt like a spec sheet, not a record header.

### V2 layout

**Page-style sticky header (two lines):**

- Line 1: title (`text-xl font-semibold`) + Status badge inline + action group right (Edit Ship Short, Delete — now an outline destructive style, icon-only Refresh).
- Line 2: enterprise meta strip — `KIT · PRIORITY · DUE · PLANT` as label/value pairs separated by `•` dividers, matching the Salesforce/Linear/Jira record-detail header convention.
- Dialog uses `overflow-hidden` so the header stays sticky while the body scrolls inside `max-h-[calc(92vh-7.5rem)] overflow-y-auto` with a subtle `bg-muted/30` so the body reads as a workspace.

**Body:**

1. **Black Hat panel** (conditional, full width).
2. **Production Progress** — new full-width `HorizontalProgressStepper` (Salesforce "Path"-style):
   - 4 stages laid out as columns separated by a connector line behind the status circles.
   - Per-stage forward fill on the connector based on `connectorFraction(a, b)` (1.0 if both adjacent stages are completed, 0.5 if next is in-progress, 0.25 if current is in-progress, 0 otherwise).
   - Each stage column shows: status circle (animated for in-progress) → stage name + `X / Y` count → progress bar + `N% complete` → status pill.
   - Replaces the prior vertical `TimelineStage` (now removed) which scaled poorly to wide dialogs.
3. **Two-column record-detail body** (`lg:grid-cols-12`):
   - **Left rail — `col-span-4`**:
     - `Details` card with grouped definition lists: `Identifiers` (Kit PO, Build Number, Kit Number, Engine Program) / `Schedule` (Due Date, Created By, Created At) / `Logistics` (Deliver To, Ship-Short Auth. when > 0). Each group has a muted-bar heading with small-caps label and a divided `<dl>` of `label → value` rows. Identifiers render in `font-mono`.
     - `Build Flags` card with the `Add Flag` dropdown in the header. Per-flag rows shrunk to fit the narrower column (h-8 avatar, single-line truncated meta).
   - **Right column — `col-span-8`**:
     - `Audit Trail` card at `h-[640px]` — dominant size because the chat thread is the primary workspace. iOS-style bubbles with system messages italicized and bordered, user messages in solid blue when authored by the current user. Header shows an entry count on the right.
4. **TO Lines** — full width at the bottom, unified header chrome.

### Card chrome normalization

All cards now use the same enterprise header pattern:

- `CardHeader className='border-b px-5 py-3'`
- `CardTitle className='text-muted-foreground flex items-center gap-2 text-[11px] font-semibold tracking-wider uppercase'`
- 3.5-w/h icon in `text-muted-foreground`
- Inline secondary text in `normal-case`
- `CardContent` uses `p-0` for tables / `px-5 py-6` for content blocks

This matches the title treatment used by Linear (sidebar section headings), Jira (issue panel headings), and Salesforce Lightning (section bars).

### Removed code

- `TimelineStage` component (replaced by `HorizontalProgressStepper`).
- `fadeInVariants` framer-motion variant (no longer referenced).
- The Kit Overview card (its data is now in the header meta strip + the Details left-rail card).

### Verification

- `npx tsc -b --force` — clean (TS6133 unused-variable error for `fadeInVariants` caught and fixed).
- `npx eslint src/components/kitting/kit-production-tracker.tsx` — clean.
- `npx prettier --write` applied.
- Functional invariants still preserved: every handler, hook, child-dialog mount, and inspection-stage-hiding logic untouched.


## V3 Polish — Tighter Headers + Inline Flag Bar (same day)

User feedback after V2: the card header strips (`PRODUCTION PROGRESS`, `DETAILS`, `AUDIT TRAIL`) felt oversized for the tiny 11px text, and the Production Progress header's empty right side was wasted space. Request: tighter headers, slightly larger text, and move the Build Flags inline with the Production Progress header.

### Card chrome tightened

All card headers normalized to a tighter, slightly larger treatment:

- `border-b px-5 py-3` → `border-b px-5 py-2` (24px → 16px total vertical padding).
- `text-[11px]` → `text-xs` (11px → 12px) for all all-caps section titles.
- Icon size unchanged at `h-3.5 w-3.5` — it sits naturally with the 12px text.
- TO Lines badges sized to `h-6` to align with the new tighter header height.
- Audit Trail's right-side entry-count text bumped `text-[11px]` → `text-xs` to match.

### Inline flag bar in the Production Progress header

The standalone Build Flags card in the left rail was removed. The active flags + Add Flag dropdown now live in the right side of the Production Progress card header.

Flag pill design (canonical "chip with delete" pattern — Linear labels, Jira components, GitHub labels):

- `h-6` rounded-full pill, `border` + tinted background in the flag's brand color (purple/orange/red/black).
- Layout: `[colored-dot] [Flag Name] [× button]` with `gap-1.5`.
- Dot prefix (`h-2 w-2 rounded-full`) replaces the prior hardhat-avatar prefix so the pill stays compact in the header.
- Remove button: `opacity-50` resting state, `opacity-100` + `text-destructive` + subtle background on hover.
- `title` attribute carries the set-by / set-at meta for tooltip-style detail without needing a heavyweight `Tooltip` import.
- Subtle `bg-border h-4 w-px` vertical divider sits between the last pill and the Add Flag button so the button reads as a distinct action, not another pill.

Add Flag button sized to `h-7 gap-1.5 px-2.5 text-xs` so it lives comfortably in the tightened header.

### Left rail simplified

With flags moved inline, the left-rail wrapper `<div className='space-y-5 lg:col-span-4'>` and the Build Flags `<Card>` were both removed. The Details `<Card>` now sits directly in the grid with `lg:col-span-4`, which:

- Removes one level of unnecessary DOM nesting.
- Keeps Details as a pure reference column (Identifiers / Schedule / Logistics).
- Frees enough rail height that the Details card no longer has to share airtime, so the grouped definition lists feel deliberate rather than crammed.

### Cleanup

- Removed `Flag` icon import (no longer used after the Build Flags card removal).
- Added `X` icon import for the flag pill remove buttons.
- All callbacks (`handleAddFlag`, `handleRemoveFlag`, `handleClearFlag`, `availableFlags`, `addingFlag` state) unchanged — same logic, new home.

### Verification

- `npx tsc -b --force` — clean.
- `npx eslint src/components/kitting/kit-production-tracker.tsx` — clean.
- `npx prettier --write` applied.
- File at 1,665 lines, JSX structure balanced.


## V4 Polish — Footer Delete + Inline Edit Ship Short + Type Scale Bump (same day)

Three adjustments after V3:

### 1. Delete moved to a sticky dialog footer

DialogContent restructured from `grid gap-0 overflow-hidden` → `flex flex-col gap-0 overflow-hidden` so the header pins at the top, the body grows to fill, and a new footer pins at the bottom — no `calc()` height math required:

- Header: `shrink-0` (removed `sticky top-0 z-10` since flex pins it naturally)
- Body: `flex-1 overflow-y-auto` (removed `max-h-[calc(92vh-7.5rem)]`)
- Footer: `shrink-0 border-t bg-background px-6 py-3` with a left-aligned destructive caption (`Deleting this kit removes its TO lines, flags, kanban cards, and audit trail. This action cannot be undone.`) and a right-aligned outline-destructive `Delete Kit` button

Moving the destructive action to the bottom-right is the canonical enterprise pattern (Linear / Notion / Jira issue dialogs) — it stops the destructive button from competing with the primary read/edit affordances and gives the action explicit context via the caption.

### 2. Edit Ship Short moved inline with Add Flag

The amber `Edit Ship Short` button now sits in the Production Progress card header, immediately before the `Add Flag` dropdown:

```
[🕒 PRODUCTION PROGRESS]  [flag pills] | [🛡️ Edit Ship Short (N)] [⛑️ Add Flag ▾]
```

Both are quality / exception actions that operate on the current kit, so they share an action group separated from the title by the same `bg-border h-4 w-px` divider already used to separate the flag pills from the action buttons.

Button sized to match the Add Flag dropdown: `h-7 gap-1.5 px-2.5 text-xs` with the existing amber colour treatment (border-amber-500/40, text-amber-700, count badge with bg-amber-500/20).

### 3. Type scale bump

Universal one-step type bump where the labels felt undersized for the tightened padding:

- All-caps card titles: `text-xs` (12px) → `text-[13px]`
- Subsection sub-headings (Identifiers / Schedule / Logistics): `text-[10px]` → `text-[11px]`
- Header meta-strip labels (KIT / PRIORITY / DUE / PLANT): `text-[10px]` → `text-[11px]`
- Header meta-strip values: `text-sm` (14px) → `text-[15px]`
- Details `<dt>` labels: `text-xs` → `text-[13px]`
- Audit Trail entry count: `text-xs` → `text-[13px]`
- TO Lines `(N total)` caption: `text-xs` → `text-[13px]`

Result: titles now read with the prominence the tightened header padding deserves, and detail rows read more comfortably without changing the underlying grid structure.

### Verification

- `tsc -b --force` — clean.
- `eslint` on the file — clean.
- `prettier --write` applied.
- Vite HMR updates all succeed (terminal log).
- Zero functional changes — the `handleDeleteKit`, `handleSaveShipShort`, ship-short authorization items count, and flag handlers are all unchanged; only their host node in the DOM moved.
