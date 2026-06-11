---
tags: [type/implementation, status/active, domain/frontend, kitting]
created: 2026-06-04
---

# Scannable TO Barcodes On Build Sheet

## Purpose / Context

The printable Kit Build Sheet (`KitBuildSheet`, `kit-build-sheet.tsx`) lists
each kit's **TO numbers** in the "TO's" table, but they were text only —
operators had to key them in. Request: add a scannable **barcode** next to
each TO number so each TO is scannable off the printed sheet.

## Solution

Generate a **Code 128** 1D barcode per unique TO number and render it under
the TO number in the TO's table. Code 128 (not QR) is the warehouse-standard
linear barcode RF/handheld scanners expect for short numeric IDs, and fits a
table row cleanly.

- New dep **`jsbarcode`** (`3.12.3`, `@types/jsbarcode` dev). **Dynamically
  imported** inside `loadKitData` (`await import('jsbarcode')`) so it lands
  in its own lazy chunk (`JsBarcode` ≈ 68 KB / 14.6 KB gzip) and only loads
  when the sheet opens — keeps it out of the eager kitting bundle.
- Barcodes are generated into a **detached `<canvas>`**
  (`document.createElement('canvas')` → `JsBarcode(canvas, to, {...})` →
  `canvas.toDataURL('image/png')`) and stored in a `toBarcodes` state map
  keyed by TO number. Rendering them as `<img>` data URLs is essential
  because `handlePrint` copies `printRef.current.innerHTML` into a new
  window — same technique as the existing kit QR.
- Options: `{ format: 'CODE128', width: 2, height: 56, displayValue: false,
  margin: 0, marginLeft: 20, marginRight: 20 }`. `displayValue: false`
  because the human-readable TO number is already rendered above the bars.
  ⚠️ `width` **must be an integer** — the original `width: 1.4` produced
  barcodes that looked right but did not decode (canvas anti-aliasing breaks
  Code128 bar-width ratios). The 20px side margins bake in the required
  10-module quiet zones. See
  [[Fix-Build-Sheet-TO-Barcode-Not-Scannable-Fractional-Width]].
- The `<img>` uses **inline styles** (`height: 28px; width: auto;
  maxWidth: 100%; margin: 2px auto 0`) rather than Tailwind classes, because
  the print window only ships the hardcoded utility-class subset in
  `handlePrint` — inline styles survive the innerHTML copy.
- `toBarcodes` is cleared on dialog close alongside `qrCodeDataUrl`.

## Verification

`tsc -b` clean. ESLint: only the pre-existing `flex-shrink-0` warning on the
colour sidebar (not added here). Production build splits `JsBarcode` into its
own lazy chunk as intended. Bundle-budget gate still reports its
**pre-existing** failures (`warehouse-location-map`, `feature-admin`,
`feature-rf-interface`, and the total) — unchanged by this work; the new
bytes are an on-demand lazy chunk.

## Related
- [[Print-Cover-Sheet-From-Audit-Trail]] — reprint entry point for this sheet
- [[Kit-Serial-Scoping]] — the sheet's serial-scoped load
- [[Components/Kitting System - Feature Module]]
