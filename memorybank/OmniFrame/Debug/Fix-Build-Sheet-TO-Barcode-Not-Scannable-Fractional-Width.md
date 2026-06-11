---
tags: [type/debug, status/fixed, domain/frontend, kitting, barcode]
created: 2026-06-11
---

# Fix: Build Sheet TO Barcodes Not Scannable (Fractional Module Width)

## Symptom

The Code128 TO barcodes on the printed Kit Build Sheet
(`kit-build-sheet.tsx`, see [[Scannable-TO-Barcodes-On-Build-Sheet]])
**looked** like real barcodes but did not decode. Verified empirically with
`zxing-cpp`: the raw generated PNGs, the 28px on-screen rendering, and a
simulated 600dpi print **all failed to decode**, while the kit QR code on the
same sheet decoded fine.

## Root Cause

`JsBarcode` was called with **`width: 1.4`** (px per module). Canvas 2D
anti-aliases bars placed at fractional pixel boundaries, so the rendered
bar/space widths no longer respect the strict 1-2-3-4 module-width ratios
Code128 requires. The result is visually plausible but undecodable.
`imageRendering: 'pixelated'` on the `<img>` preserved the distortion at
print resolution instead of letting the printer smooth it.

Control experiment (same lib, same data `1795176`):

| module width | decodes at 1x |
|---|---|
| 1 | yes |
| 1.4 | **no** |
| 1.5 | **no** |
| 2 | yes |
| 3 | yes |

Secondary issue: `margin: 0` baked **no quiet zone** into the PNG — Code128
needs ≥10 modules of white on each side, and scanning depended on incidental
table-cell whitespace.

## Fix (`kit-build-sheet.tsx` → `loadKitData`)

- `width: 1.4` → **`width: 2`** (integer module width only — never fractional)
- `height: 30` → **`height: 56`** (2× the 28px CSS display height, clean
  2:1 downscale, crisp at print DPI)
- `margin: 0` + **`marginLeft: 20, marginRight: 20`** (10-module quiet zone
  baked into the PNG, independent of surrounding layout)
- Removed `imageRendering: 'pixelated'` from the `<img>` style.

## Verification

Playwright harness generated barcodes with the exact production options;
`zxing-cpp` decoded them successfully under: raw 1x, 50% bilinear and
nearest downscale (screen), simulated 600dpi print upscale, and with a black
table border adjacent to the image. Numeric TOs (`1795176`, `2009708227`)
and alphanumeric (`KIT-20260605-006`) all round-trip.

## Rule of Thumb

**Never pass a fractional `width` to JsBarcode when rasterising to canvas.**
If you need a smaller printed barcode, keep `width` an integer and scale the
`<img>` down by an integer factor (generate at 2x/3x). Always bake quiet
zones into the image with `marginLeft`/`marginRight` (≥ 10 × width).

Note: `src/components/ui/barcode.tsx` is a **fake placeholder** (draws
random-ish bars, not a real encoding). It is still imported by
`putback-tool-form.tsx` — anything rendered with it is not scannable.

## Related
- [[Scannable-TO-Barcodes-On-Build-Sheet]] — original implementation
- [[Print-Cover-Sheet-From-Audit-Trail]] — reprint entry point
