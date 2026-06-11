# Workstream D: Bundle & Performance Health — Evidence

> Secret dev credential findings excluded per [scope-lock-non-secret-2026-02-16.md](../scope-lock-non-secret-2026-02-16.md).

## Before State

- Largest first-party chunk: ~692 kB
- manualChunks: vendor-only (object-based, 9 entries)
- CI bundle check: inline shell script, emits `::warning` only, never fails build
- No bundle budget script
- `chunkSizeWarningLimit: 500` in vite.config.ts

**Baseline build:** ~692 kB largest chunk, advisory-only warnings

## After State

- Largest first-party chunk: 476 kB (`feature-admin`) — under 500 kB budget
- manualChunks: function-based with 10 vendor + 13 feature splits
- Bundle budget script: `scripts/check-bundle-budget.mjs` with hard enforcement
- CI calls script and fails on budget violation
- Key chunk breakdown:
  - `feature-admin`: 476 kB
  - `vendor-react-pdf`: 422 kB
  - `feature-rf-interface`: 406 kB
  - `vendor-recharts`: 388 kB
  - `feature-shift-team`: 322 kB
  - `feature-shift-productivity`: 301 kB
  - `exceljs.min`: 937 kB (lazy-loaded, exempt)

**Post-change build:** 476 kB largest first-party chunk, hard budget enforcement

## Import Conflict Verification

- `activity-source-config` service: confirmed static-only imports, no conflict
- Broad scan of ~50 dynamic imports: all in safe categories (React.lazy, heavy vendor lazy-load)
- No mixed static+dynamic import conflicts found

## Files Changed

| File | Change |
|------|--------|
| `vite.config.ts` | Function-based manualChunks with vendor + feature splits |
| `scripts/check-bundle-budget.mjs` | Created — bundle budget enforcement (500 kB/chunk, 7500 kB total) |
| `docs/quality/bundle-budget.md` | Updated thresholds, chunk ownership table, script docs |
| `src/features/customer-portal/components/ExcelViewer.tsx` | Dynamic import for exceljs |
| `src/features/rf-interface/rf-interface.tsx` | Fixed TS error (checkbox type) |
| `src/features/shift-productivity/settings/labor-management/components/edit-area-dialog.tsx` | Fixed TS error |

## Residual Risks

- exceljs chunk at 937 kB is exempt (lazy-loaded) but large — consider server-side parsing long-term
- Vite still emits chunk size warning for exceljs (cosmetic, not a gate failure)

---

*Date: 2026-02-16*
