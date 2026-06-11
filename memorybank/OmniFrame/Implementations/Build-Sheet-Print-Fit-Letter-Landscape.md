---
tags: [type/implementation, status/active, domain/frontend, kitting]
created: 2026-06-05
---

# Build Sheet Print — Fit to Letter Landscape

## Purpose / Context

The printable Kit Build / Cover Sheet (`KitBuildSheet.handlePrint`) printed at
`@page size: A4 landscape` and at natural size, so as the sheet grew (TO
barcodes, the new Authorized Ship Short section) content could spill onto a
second page. Request: make it fit everything on a normal **8.5 x 11**
sheet in **landscape**.

## Changes (`kit-build-sheet.tsx`, print-window builder in `handlePrint`)

- `@page` → `size: 11in 8.5in; margin: 0.4cm;` (explicit Letter landscape;
  dimensions instead of the `letter landscape` keyword for cross-browser
  reliability).
- Wrapped the printed markup in `#print-scale-wrapper > #print-root`.
- New `fitToPage()` (runs in the print window before `print()`):
  1. Computes the printable box in CSS px (96dpi): `availW = 11*96 - 2*margin
     - 2px`, `availH = 8.5*96 - 2*margin - 2px`.
  2. Sets `#print-root` width to `availW` so it lays out at the **printed**
     width regardless of the popup window's size, then measures
     `scrollWidth/scrollHeight`.
  3. `scale = min(availW/contentW, availH/contentH, 1)` (never upscales) and
     applies `transform: scale(...)` with `transform-origin: top left`.
  4. Collapses `#print-scale-wrapper` to `contentW*scale × contentH*scale`
     with `overflow: hidden` — a CSS transform doesn't shrink the layout box,
     so without this the original full-size box would still paginate.
- Print is now fired once via a `hasPrinted`-guarded `printOnce()` (onload +
  a 300ms fallback), replacing the old double `print()` calls.

## Why measure-and-scale instead of static sizing

The sheet's height is data-driven (number of TO rows, ship-short rows). A
uniform measured scale guarantees single-page fit without hand-tuning font
sizes every time the layout changes. data: URL images (QR + barcodes) are
already decoded by onload so the measured height is accurate.

## Verification

`tsc -b` clean; ESLint clean (the lone `flex-shrink-0` warning is the
pre-existing colour sidebar). Print-window-only change; covers both the
**Print Build Sheet** and **Print Cover Sheet** (audit-trail footer) entry
points since both render `KitBuildSheet`.

## Related
- [[Scannable-TO-Barcodes-On-Build-Sheet]]
- [[Build-Sheet-Authorized-Ship-Short-Section]]
- [[Print-Cover-Sheet-From-Audit-Trail]]
