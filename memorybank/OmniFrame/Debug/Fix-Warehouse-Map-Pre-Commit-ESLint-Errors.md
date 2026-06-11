---
tags: [type/debug, status/active, domain/frontend]
created: 2026-04-25
---
# Fix: Warehouse Map pre-commit ESLint errors

## Purpose / Context
After staging the warehouse-map feature batch (DXF import, polygon draw layer, embeddable widget, etc.), the Husky `pre-commit` hook (lint-staged → `eslint --fix`) failed with 3 errors blocking the commit. Two warnings already existed but were not blocking. This note captures the fixes so the same class of error is avoided next time.

## Errors blocking commit

```
src/components/warehouse-map/dxf-import-dialog.tsx
  222:7  error  Unexpected console statement  no-console
  447:7  error  Unexpected console statement  no-console

src/components/warehouse-map/polygon-draw-layer.tsx
  11:15  error  'KonvaEventObject' is defined but never used  @typescript-eslint/no-unused-vars
```

## Fixes

### 1. `dxf-import-dialog.tsx` — `no-console`
The project bans direct `console.*` and provides a structured logger at `src/lib/utils/logger.ts` (env-aware: verbose in dev, minimal in prod).

- Added `import { logger } from '@/lib/utils/logger'` alongside the other `@/lib/...` imports.
- Replaced `console.error('DXF parse failed', err)` → `logger.error('DXF parse failed', err)` (parse failure handler).
- Replaced `console.error('DXF import failed', err)` → `logger.error('DXF import failed', err)` (mutation `onError`).

### 2. `polygon-draw-layer.tsx` — unused import
- Removed the leftover `import type { KonvaEventObject } from 'konva/lib/Node'`. The component only uses `Konva.Stage` (via `stageRef`), so the unused alias was redundant.

## Pattern: never use `console.*` directly
The codebase has a single allow-listed `console.*` site — `src/lib/utils/logger.ts` itself, which `eslint-disable`s the rule because it IS the wrapper. Every other module must import `logger` and call `logger.debug | info | log | warn | error`. Existing examples: `rf-kitting-picking-form.tsx`, `inspect-kit-form.tsx`, `use-inspect-kit.ts`, `role-edit-dialog.tsx`, etc.

## Remaining (non-blocking) warnings
These did not block the commit but are tracked for follow-up:
- `aisle-graph-editor.tsx` lines 367 / 406 / 416 — `@tanstack/query/no-unstable-deps`: passing `useMutation` result objects directly into `useCallback` deps. Fix by destructuring (`const { mutate, mutateAsync } = useMutation(...)`) and depending on the destructured fn.
- `warehouse-map-widget.tsx` line 141 — `react-hooks/exhaustive-deps`: a logical expression for `mappings` could change every render. Fix by moving the initialization inside the `useMemo` callback at line 158 or wrapping in its own `useMemo`.

## Verification
```
npx eslint src/components/warehouse-map/dxf-import-dialog.tsx \
           src/components/warehouse-map/polygon-draw-layer.tsx
# exit 0, no output
```

## Related
- [[DXF-Import-Warehouse-Map]]
- [[Warehouse Map - Feature Module]]
- [[Fix-PolygonDrawLayer-Infinite-Loop]]
- [[2026-04-25]]
