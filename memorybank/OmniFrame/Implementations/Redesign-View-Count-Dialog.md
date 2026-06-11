---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-04-19
---
# Redesign: View-Count Dialog

## Purpose / Context
The old Cycle Count details dialog was 3-column "baseball-card" style with a large empty photo placeholder, nested sub-Cards, and separate full-width sections for Recount + Assignment History. It didn't fit in one view, didn't surface any of the new **Part Number Verification** data (`scanned_material_number`, `scanned_parts`, `part_variance`, `location_reported_empty`), and didn't show `evidence_photo_urls`.

## Redesigned layout (`src/components/manual-counts-search.tsx`)

### Container
- Flex-col dialog, `max-w-[1100px]`, `max-h-[90vh]`, zero padding on the content so the hero and footer can be edge-to-edge.
- Fixed **Hero Header** (gradient) + scrollable **Body** + sticky **Footer**.

### Hero Header
- `Package` icon + count number in mono.
- Material number + description.
- Chips: `MapPin` location · count type · warehouse · batch (if present).
- Right-aligned priority badge + short ID.

### Stat tiles row (adaptive, 3 or 4 columns)
New `StatTile` helper with `neutral` / `info` / `success` / `warning` / `danger` variants.
1. **Status** tile — current status with icon + counter_name / count_date context.
2. **Part Check** tile (conditional on `hasPartVerification`) — Match / Part Variance / Location Empty / Not verified, showing the found part number.
3. **Qty Variance** tile (conditional on `hasQtyVariance`) — signed variance, system vs counted, percentage.
4. **Assigned** tile — assignee full name + email, or "Unassigned" with subtle muted style.

### Two-column mid-row
- **Details**: compact `dl` with Material / UOM / System Qty / Counted Qty / Created / Updated / Counter. Tabular-nums everywhere.
- **Scanned Parts**: new `ScannedPartRow` helper renders each entry from `scanned_parts` (or falls back to the primary `scanned_material_number` when the array is empty). Row is green when the part matches the expected material, red when it doesn't. Shows qty, method (scan/manual), and capture timestamp. Handles the "Location Empty" and "Not yet verified" empty states explicitly.

### Notes
- Single card, visible only when `countData.notes` is set. Wraps whitespace.

### Evidence Photos
- Grid of clickable thumbnails rendered from `evidence_photo_urls` (the column populated by the cycle-count-photos service and `RFStepPhotoCapture`). Each thumbnail opens the full-res image in a new tab; hover scales slightly.

### Assignment History (collapsible timeline)
- Header button toggles expand/collapse; auto-opens on first reassignment only (avoids drowning rows with lots of history).
- Vertical timeline: one dot per history entry, line connecting them. Most recent entry is amber.
- Compact row: `previous → new`, date, previous qty, previous status — all on 1-2 lines.

### Recount action
- Inline orange card in-body (not separate full-width section). Reason input + Recount button sit on one line.

### Sticky Footer
- Left: short ID chip + "Updated" timestamp.
- Right: `Close` + context-specific `Approve Variance` (only when status = `variance_review`).

## Helpers added
- `StatTile` — 5-variant border/bg presets + label/icon slot.
- `ScannedPartRow` — colored row with expected-vs-wrong distinction.

## Trimmed / replaced
- Deleted the ~480-line old 3-col layout (photo placeholder, nested Cards for Inventory Stats / Count Details / Additional Info / Recount Info / full-width Assignment History / full-width Recount card).
- Removed the now-unused `Separator` import.

## Verification
- `npx tsc -b --noEmit` — 0 errors.
- `npx eslint src/components/manual-counts-search.tsx --quiet` — 0 errors.
- `npx vitest run` — 159/161 passed (same 2 pre-existing env/storage failures as baseline).

## Related
- [[Part-Number-Verification-Workflow-Step]]
- [[Close-Out-RF-Workflow-Future-Work]]


## 2026-04-19 follow-up — wider dialog + photo column

User feedback: the 1100px max-width felt cramped and the original photo slot needed to come back. Changes:

- Dialog sizing: `max-w-[1400px]` with `sm:min-w-[900px]` / `lg:min-w-[1200px]` so the layout breathes on 13"+ displays but still collapses gracefully on small screens.
- Body grid upgraded from 2-col to **12-col** (`md:grid-cols-12`):
  - **Photo / Location** card — `col-span-3`. If `evidence_photo_urls` exists, the first photo renders large (aspect-square, clickable to open full-res, with an "+N more" overlay when applicable). Otherwise the legacy `<Camera />` placeholder with helper copy.
  - Below the photo: the prominent **Location** card with zone/aisle context when resolved.
  - **Details** card — `col-span-4`. Compact definition list.
  - **Scanned Parts** card — `col-span-5`. More room for part numbers + qty rows.
- "More Evidence Photos" section below now only renders when there are 2+ photos (the primary is already large on the left). Denser thumbnail grid (6–8 cols) to avoid wasted vertical space.

Typecheck + lint clean.
