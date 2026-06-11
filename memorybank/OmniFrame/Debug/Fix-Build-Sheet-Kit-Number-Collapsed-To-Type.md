---
tags: [type/debug, status/resolved, domain/frontend, kitting]
created: 2026-06-06
---

# Fix Build Sheet Kit Number Collapsed To Type

## Symptom

Kit `KIT-20260602-005` has kit number **`431, 432 LF Stack 3 (A)`** (shown
correctly in the Kit Build Audit Trail), but the printable **Kit Build /
Cover Sheet** rendered the title as just **`KIT : Stack`** — the full kit
number wasn't displaying.

## Root cause

The `KIT : X` title line in `kit-build-sheet.tsx` ran the kit number through
a `getKitTypeLabel(kitNumber, engineProgramType)` helper that collapsed any
value containing `STACK` / `SEAL` / `BEARING` / `GASKET` down to that single
word:

```ts
if (kitUpper.includes('STACK') || engineProgramType === 'STACK') return 'Stack'
// … etc; only the no-match branch returned the real kitNumber
```

So `431, 432 LF Stack 3 (A)` matched the STACK branch and rendered `Stack`.

## Fix

Render the full kit number directly: `KIT : {kitData.kitNumber || 'Kit'}`.
Removed the now-unused `getKitTypeLabel` helper (avoids an unused-symbol lint
warning / lint-ratchet bump). `getEngineProgramType` is untouched — it still
drives the italic program line above the title and the Tackle Box items.

## Verification

`tsc -b` clean; ESLint clean (the lone `flex-shrink-0` warning is the
pre-existing colour sidebar). The earlier print fit-to-page scaling
([[Build-Sheet-Print-Fit-Letter-Landscape]]) keeps the longer title on one
page. FE-only — ships with the next frontend deploy.

## Related
- [[Kit-Number-On-Kanban-Card]] — sibling "show the real kit number" fix on the kanban
- [[Build-Sheet-Print-Fit-Letter-Landscape]]
