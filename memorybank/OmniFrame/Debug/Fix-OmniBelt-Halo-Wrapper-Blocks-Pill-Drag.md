---
tags: [type/debug, status/active, domain/frontend]
created: 2026-05-24
---
# Fix: OmniBelt halo wrapper blocked pill drag/click

## Symptom
When any background job was active (`activeJobs.length > 0`), the pill's drag-grip, expand chevron, pin button and tool icons all became unresponsive. Drag wouldn't start; clicks would silently miss. Disappeared the moment the last job evicted, returning to a working pill.

## Root cause
In `src/features/omnibelt/skins/pill/OmniBeltPill.tsx`, the halo wrapper `<div>` carried:

```tsx
className='pointer-events-none absolute'
style={{
  ...inset(-12),
  pointerEvents: 'auto',   // ← inline style overrode the class
}}
```

The inline `pointerEvents: 'auto'` defeated the `pointer-events-none` className. The wrapper extends 12 px outside the pill on every side (to give the halo SVG room), so it captured every pointer event in that whole rect — including the entire pill body underneath. SVG `pointer-events: stroke` on the rings was correct, but the **wrapper** was eating events before they reached the SVG strokes or the buttons.

## Fix
- Wrapper stays `pointer-events: none` (class kept, inline override removed).
- `HaloRings` SVG already sets its own `pointerEvents: 'auto'` when `onClick` is provided + each `<circle>` has `pointerEvents: 'stroke'` — so painted rings stay clickable, transparent interior falls through to the pill body.
- Added `pointer-events-auto` class to the SVG element to make the intent explicit.

## Verification
- All 364 OmniBelt unit tests pass.
- Build clean (9.4 KB gzip base, 53.69 KB feature chunk unchanged).
- Manually: drag handle, expand, pin, tool icons remain clickable while halo rings paint progress.

## Related
- [[Implement-OmniBelt-MVP]]
- [[OmniBelt-Floating-Launcher]]
- [[ADR-OmniBelt-Site-Chrome]]
