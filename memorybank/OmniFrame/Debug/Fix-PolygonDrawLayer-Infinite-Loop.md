---
tags: [type/debug, status/active, domain/frontend]
created: 2026-04-25
---
# Fix: PolygonDrawLayer Infinite Loop

## Symptom
```
map-canvas.tsx:452 Error: Maximum update depth exceeded.
  at polygon-draw-layer.tsx:45:7
```

## Cause
```tsx
useEffect(() => {
  if (!active) {
    setPoints([])
    return
  }
  setPoints(initialPoints)
}, [active, initialPoints])  // ← initialPoints in deps
```

The parent (`MapCanvas`) passes the default `initialPoints = []`. Every parent re-render creates a *new* `[]` reference. The effect then sees `initialPoints` as "changed" and re-runs, calls `setPoints`, triggers a re-render → loop.

## Fix
Capture the initial value once in a ref and depend only on `active`:
```tsx
const initialPointsRef = useRef(initialPoints)
useEffect(() => {
  if (!active) { setPoints([]); return }
  setPoints(initialPointsRef.current)
}, [active])
```

## Lesson
Never put a freshly-allocated default value (`[]`, `{}`, function) into a `useEffect` dep array unless the parent memoizes it. Use `useRef` or stable references.

## Related
- [[Warehouse-Map-Phase-A-D-Complete]]
- [[Fix-MapStatistics-Shape-Drift]]
