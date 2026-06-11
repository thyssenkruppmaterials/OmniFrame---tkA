---
tags:
  - type/implementation
  - status/active
  - domain/frontend
  - cycle-count
created: 2026-05-19
---
# Add Progress Dialog for Inventory Counts "Import Bulk Counts"

## Purpose
The **Import Bulk Counts** dialog on the Inventory Counts tab previously had no feedback while it ran. Because `cycleCountService.importFromClipboard` inserts rows **one-at-a-time on the client** (calls `createCycleCount` per row), users would click Import, see the modal close immediately, and assume it was done. Navigating away mid-loop silently dropped any unprocessed rows.

## Files Changed
- `src/components/ui/cycle-count-import-progress-dialog.tsx` — new file, focused dialog for the simple `{ total, processed, errors, isComplete }` shape from `cycle-count.service.ts`.
- `src/components/manual-counts-search.tsx` — destructured `importProgress` from `useCycleCountOperations`, rendered the new dialog, added a `beforeunload` guard while `isImporting` is true, and added a local `importProgressDismissed` flag so users can click **Done** before the hook's 3-second auto-clear runs.

## How it works
1. `useCycleCountOperations` already exposes `importProgress: ImportProgress | null` and updates it inside `cycleCountService.importFromClipboard` via the `onProgress` callback (one update per row).
2. `<CycleCountImportProgressDialog isOpen={importProgress != null && !importProgressDismissed} progress={importProgress} onClose=… />` opens as soon as the import begins.
3. While running:
   - The Radix dialog blocks **Escape**, **click-outside**, and hides the **×** close button (via `onInteractOutside={e.preventDefault()}` + `onEscapeKeyDown={e.preventDefault()}` + `showCloseButton={false}`).
   - A `beforeunload` listener on the component triggers the browser's native "Are you sure you want to leave?" prompt if the user tries to close the tab / hard-navigate.
4. The bar shows `processed / total * 100` (clamped to 99% until `isComplete`, with a 5% floor before `total` is known so the user gets immediate visual feedback). Badges count inserted vs errors vs remaining. The last 5 errors are surfaced inline.
5. When `isComplete` flips true, the title swaps to **Import Complete**, the warning banner is replaced with a green/amber summary card, and a **Done** button is enabled. Clicking Done sets `importProgressDismissed=true` so the user doesn't have to wait for the hook's 3 s timeout to clear `importProgress`.
6. A `useEffect([isImporting])` resets `importProgressDismissed=false` whenever a new import begins, so back-to-back imports re-open the dialog.

## Design notes
- I deliberately did not reuse the existing `ImportProgressDialog` / `LX03ImportProgressDialog` — those are keyed to the multi-phase `{ phase, currentRow, totalRows, processedChunks, totalChunks, insertedRows, duplicateRows, errorRows, message }` shape from delivery-status / LX03 services. The cycle-count `ImportProgress` is intentionally simpler (`{ total, processed, errors, isComplete }`) and mapping it into the multi-phase dialog would have required service-layer changes I didn't want to entangle with a UX-only fix.
- `src/components/ui/` is lint-ignored project-wide (see `eslint.config.js`), so the new file gets the same exemption as the other shadcn-style primitives there. Confirmed `npx eslint` reports it as ignored and `npx tsc --noEmit -p tsconfig.app.json` is clean.
- The `beforeunload` guard fires only while `isImporting === true`. As soon as the loop finishes (errors or not) the listener detaches, so the post-import "Done" close + the hook's 3 s auto-clear don't trigger spurious prompts.

## Verification
- `npx tsc --noEmit -p tsconfig.app.json` → clean.
- `npx eslint src/components/manual-counts-search.tsx` → 0 errors, 8 pre-existing `no-explicit-any` warnings unchanged (new file is in the ignored UI folder).

## Related
- [[ManualCountsSearch - Inventory Tab]]
- [[Inventory-Counts-Tab-Comprehensive-Redesign]]
- [[Fix-Inventory-Counts-Total-Mismatch]]
