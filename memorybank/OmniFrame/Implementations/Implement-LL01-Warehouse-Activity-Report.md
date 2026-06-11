---
tags: [type/implementation, status/active, domain/frontend, sap, ll01, reporting]
created: 2026-06-01
---
# Implement LL01 Warehouse Activity Report (PDF + Excel)

Adds a **Generate Report** dropdown to the Warehouse Activity Monitor that
exports a beautifully-designed report of the **Plant × Category heatmap** + the
**aging breakdown of every category** (Plant × >30/>60/>90 cumulative buckets,
calendar-quarter spread, top users). **No Trend** (per request). Renders from
the currently-shown run, so it works for live AND saved (History) runs.

## Format decision (user-approved)
**Both** PDF and Excel, offered via a dropdown on the button.
- **PDF**: a print-styled, self-contained HTML report printed via a hidden
  iframe → browser "Save as PDF". Chosen over a PDF library because
  `@react-pdf/renderer`/`pdfmake` would risk the 500 KB/chunk bundle guardrail;
  HTML+CSS gives pixel-perfect control of the traffic-light heatmap with zero
  new deps.
- **Excel**: styled `.xlsx` via the project's existing (lazy, bundle-exempt)
  `exceljs` — true one-click download.

## Architecture
- **`lib/ll01-report.ts`** — pure `buildLL01ReportModel(result)` → a render-
  agnostic `LL01ReportModel` (heatmap rows + severity, plant/grand totals, and
  per-category aging sections via `bucketizeLL01Aging` / `ll01QuarterLabel` /
  `LL01_USER_FIELD`). Shared by BOTH renderers so they never drift. Also
  `LL01_SEVERITY_COLORS` (hex for CSS / ARGB for Excel) + `ll01ReportFilenameStem`.
- **`lib/ll01-report-pdf.ts`** — `renderLL01ReportHtml(model)` (branded header,
  stat strip, colored heatmap table, per-category aging cards with
  `break-inside: avoid`, A4 portrait `@page`, `print-color-adjust: exact`) +
  `generateLL01Pdf(model)` (hidden-iframe print).
- **`lib/ll01-report-excel.ts`** — `generateLL01Excel(model)`: "Heatmap" sheet
  (traffic-light fills + totals, frozen header) + "Aging" sheet (one stacked
  section per category: Plant × bucket table with share-based tints, quarter
  line, top-users block). Lazy `import('exceljs')` (mirrors
  `inventory-adjustment-view`).
- **`components/ll01-report-button.tsx`** — `<LL01ReportButton result>` shadcn
  `DropdownMenu` ("Download PDF" / "Download Excel"); lazy-imports each
  generator; per-action busy spinner + toasts; disabled until a successful run.
- **`warehouse-activity-monitor-view.tsx`** — button rendered in a flex row
  beside the `TabsList`, fed the effective `result`.

## Tests / verification
- `lib/__tests__/ll01-report.test.ts` (6) — heatmap counts/severity/totals,
  cumulative aging buckets, top users, quarter bucketing, `supportsAging` from
  `payload_version`, default-plant fallback.
- Full sap-testing suite 33 green; `tsc -b` clean; ESLint clean; `pnpm build`
  succeeds.

## Bundle
Feature is bundle-neutral: `feature-admin-sap` = 489.7 KiB (< 500 KiB);
`exceljs` stays lazy + exempt. NOTE: the repo bundle budget currently FAILS on
**unrelated** chunks (`warehouse-location-map` 1.5 MB, `feature-admin` 1.0 MB,
`feature-rf-interface` 547 KB — RF-redesign WIP) — tracked by
`plans/onebox_latency_speed_remediation_*`, not this feature.

## Notes / follow-ups
- FE-only — needs a frontend deploy to go live (alongside the pending History
  `this`-fix + recovery + fleet-progress).
- The button reports the displayed run; pair with the History picker to export
  any saved run.
- Aging sections show a "requires v2 run" note when `payload_version < 2`.

## Related
- [[Implement-LL01-Warehouse-Activity-Monitor]] / [[LL01-Aging-Breakdown]]
- [[Implement-LL01-Run-History-Date-Picker]] (report works on saved runs)
