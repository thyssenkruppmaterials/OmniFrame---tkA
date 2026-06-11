---
tags: [type/implementation, status/superseded, domain/frontend]
created: 2026-05-17
---

> **Superseded by v15.2 — see [[Implement-SQCDP-Measured-Hero-Typography]] (same day, 2026-05-17).** The v15.1 `vh`-based clamp produced overflow on the user's TV screenshot ("99.7%" right-edge clip; "848 Days" + "35 QNs" wrapped to 2 lines; secondary single-mode cards inherited the primary clamp and overflowed even worse). Pure-CSS approaches can't deliver "every card the same px AND no card overflows" without measuring what actually fits. v15.2 takes the JS measurement route via `useUniformHeroFit` + three independent tier registries (`primary`, `sub`, `secondarySingle`). Decision log: [[Decisions/ADR-SQCDP-Measured-vs-Viewport-Hero-Typography]]. The v15.1 text below is kept verbatim for the historical record.

---

# Implement SQCDP Uniform Hero Typography

## Purpose / Context

Same-day v15.1 follow-on to [[Implement-SQCDP-Hero-Autofit-Typography]]
(v15). The v15 pass swapped the static `text-9xl` for
`text-[clamp(6rem, 28cqh, 16rem)]` so each card scaled its hero number
to its OWN value-block container height. Result on a 1080p TV review:

| Card | Value | Rendered glyph height |
|------|-------|----------------------|
| Safety | 848 Days (wraps) | ~80–90 px / line |
| Quality | 35 QNs | ~110 px |
| Cost | 8 % OT | ~80 px |
| Delivery | 99.7% | ~100 px |
| People | 475 | ~95 px |

User's request — pure consistency. Quote, verbatim:

> "Review the screenshot and see that there are differences in the
>  text sizes. What I would like to see is pure consistency across the
>  board, where everything resizes in the correct ratio as the screen
>  gets larger. This way, it is an even design across the board that
>  is dynamic and fluid. Please ensure you think through this to make
>  this the most optimized way."

Decision rationale + alternatives in
[[Decisions/ADR-SQCDP-Uniform-vs-AutoFit-Typography]].

## Mechanism — viewport-relative `vh`

Replace `cqh` (container-query height) with `vh` (viewport-relative
height). `vh` resolves against the **viewport** — every card on a
given screen sees the same value, so siblings render at the same px
even though their per-card geometry differs. Still fluid: 1 vh on
1080p = 10.8 px, on 4K = 21.6 px — the same clamp expression resolves
to the same px in every card on a given viewport, but smoothly tracks
screen size.

No `containerType: 'size'` needed → drop the inline style entirely
and the per-block container-query boundary that v15 added on each
`<SubMetricBlock>`. Less code, less browser-specific layout to worry
about, no risk of Recharts coexistence concerns at the container
boundary (the chart strip already lived outside it; now there's no
boundary at all).

### Naming change

The constants are renamed from `TV_AUTOFIT_*` to `TV_UNIFORM_*` —
v15.1 isn't auto-fitting per-card, it's a uniform fluid size that
applies the SAME class string to every primary hero element. Future
readers searching for "how does the SQCDP hero scale on TV?" should
land on a name that reflects the actual mental model.

```ts
const TV_UNIFORM_PRIMARY =
  'text-[clamp(4.5rem,10.5vh,12rem)] leading-[0.95] overflow-hidden'
const TV_UNIFORM_SUB =
  'text-[clamp(2.25rem,5.5vh,5.5rem)] leading-[1] overflow-hidden'
const TV_UNIFORM_TREND_ICON =
  'h-[7vh] w-[7vh] min-h-[2rem] min-w-[2rem] max-h-[4.5rem] max-w-[4.5rem]'
```

The gate variable (`useAutoFitPrimary` → `useUniformPrimary`,
`useAutoFit` → `useUniform`) is renamed for the same reason.

### Why static literals

Tailwind v4's JIT scans source files for class literals; a template-
composed `text-[clamp(${min}rem, ${preferred}vh, ${max}rem)]` would
be invisible to the build. Same gotcha as
[[Patterns/Per-Field-Style-Overrides]].

### Why these specific values

- **Primary floor 4.5rem (72 px)** — matches the previous default
  (`text-7xl` = 72 px) so the change doesn't regress small embedded
  previews.
- **Primary preferred 10.5vh** — yields ≈ 113 px on 1080p
  (canonical TV viewport). Bigger than the v15 floor (96 px), in the
  same ballpark as the v15 1080p result.
- **Primary ceiling 12rem (192 px)** — tighter than v15's 16rem. With
  uniform sizing every card reaches the max, so a ceiling that's "twice
  the previous default" rather than "much bigger than the previous
  default" feels right at 4K.
- **Sub-metric floor 2.25rem (36 px)** — matches `text-4xl` baseline.
- **Sub-metric preferred 5.5vh** — about half the primary's preferred,
  reflecting the secondary tier's smaller content density.
- **Trend icon 7vh** — between the primary's 10.5vh and the sub-
  metric's 5.5vh, capped at 4.5rem (72 px) so the icon hits its
  ceiling at 1080p (75.6 vh-derived → 72 px) and stays there at
  larger viewports while the hero keeps scaling.

## Files changed

| File | Why |
|------|-----|
| `src/features/.../sqcdp/components/sqcdp-card.tsx` | `TV_UNIFORM_*` constants replace `TV_AUTOFIT_*`. `TV_AUTOFIT_CONTAINER_STYLE` is removed (no per-card container boundary). The gate variable is renamed. The single-mode wrapper drops `style={useAutoFitPrimary ? TV_AUTOFIT_CONTAINER_STYLE : undefined}`. `<SubMetricBlock>` drops the same. The composition rule (auto-fit class appended last) is unchanged. |
| `src/features/.../sqcdp/components/sqcdp-card.test.tsx` | The 6 v15 auto-fit tests are updated, not removed — assertions for `containerType: 'size'` and `cqh` clamps are replaced with assertions for the new vh-based clamps and the absence of the container style. A 7th test mounts `<SqcdpGrid>` with five primary metrics and asserts every hero element receives the SAME size-token class string. |
| `src/features/.../sqcdp/components/sqcdp-editor-dialog.tsx` | The Primary-field hint copy is updated. No-override → "TV mode: uniform fluid size scales every card together with the screen." With override → "TV mode: pinned size wins — uniform scaling disabled. Use the Reset button to re-enable." |

## Diff snippet (the key change)

```ts
// sqcdp-card.tsx — module-scope constants
- const TV_AUTOFIT_PRIMARY =
-   'text-[clamp(6rem,28cqh,16rem)] leading-[0.95] overflow-hidden'
- const TV_AUTOFIT_SUB =
-   'text-[clamp(3rem,30cqh,9rem)] leading-[1] overflow-hidden'
- const TV_AUTOFIT_TREND_ICON =
-   'h-[20cqh] w-[20cqh] min-h-[2.5rem] min-w-[2.5rem] max-h-[5rem] max-w-[5rem]'
- const TV_AUTOFIT_CONTAINER_STYLE: CSSProperties = {
-   containerType: 'size',
-   containerName: 'sqcdp-value',
- }
+ const TV_UNIFORM_PRIMARY =
+   'text-[clamp(4.5rem,10.5vh,12rem)] leading-[0.95] overflow-hidden'
+ const TV_UNIFORM_SUB =
+   'text-[clamp(2.25rem,5.5vh,5.5rem)] leading-[1] overflow-hidden'
+ const TV_UNIFORM_TREND_ICON =
+   'h-[7vh] w-[7vh] min-h-[2rem] min-w-[2rem] max-h-[4.5rem] max-w-[4.5rem]'

// sqcdp-card.tsx — single-mode wrapper
  <div
    className={cn(
      'flex flex-col gap-1',
      density === 'tv' && 'min-h-0 flex-1'
    )}
-   style={useAutoFitPrimary ? TV_AUTOFIT_CONTAINER_STYLE : undefined}
  >

// sqcdp-card.tsx — value div composition (gate rename)
  <div className={cn(
    d.primary, primaryClasses, d.primaryReserve,
    'flex items-end gap-3',
-   useAutoFitPrimary && TV_AUTOFIT_PRIMARY,
+   useUniformPrimary && TV_UNIFORM_PRIMARY,
    'dark:[text-shadow:...]'
  )}>
```

The v1 `flex-1 items-end` chain on the value-block (from
[[Implement-SQCDP-TV-Viewport-Fit]]) is preserved — that's the layout
substrate; v15.1 only changes the **typography** model, not how the
card distributes vertical space.

## Visual QA matrix

Computed by evaluating the clamps directly against each viewport's
reported `vh` unit. (These are the deterministic numbers — actual
rendered px in a real browser may shift by ±1 px from sub-pixel
rounding.)

| Viewport | 1 vh | Primary preferred (`10.5vh`) | Primary clamped px | Sub-metric preferred (`5.5vh`) | Sub-metric clamped px | Trend icon (`7vh`) | Trend icon clamped px |
|----------|------|------------------------------|---------------------|--------------------------------|------------------------|---------------------|------------------------|
| 1024×768 (small preview) | 7.68 | 80.6 px | **80 px** (preferred) | 42.2 px | **42 px** (preferred) | 53.8 px | **54 px** (preferred) |
| 1920×1080 (canonical TV) | 10.80 | 113.4 px | **113 px** (preferred) | 59.4 px | **59 px** (preferred) | 75.6 px | **72 px** (max wins, 4.5rem) |
| 2560×1440 (1440p) | 14.40 | 151.2 px | **151 px** (preferred) | 79.2 px | **79 px** (preferred) | 100.8 px | **72 px** (max wins) |
| 3840×2160 (4K TV) | 21.60 | 226.8 px | **192 px** (max wins, 12rem) | 118.8 px | **88 px** (max wins, 5.5rem) | 151.2 px | **72 px** (max wins) |

For the canonical 1080p TV viewport:

- **All five primary cards** ("475", "99.7%", "8 % OT", "35 QNs",
  "848 Days") render at **113 px** — confirmed by mounting
  `<SqcdpGrid>` with all five categories in `sqcdp-card.test.tsx` and
  asserting every hero element receives the literal
  `text-[clamp(4.5rem,10.5vh,12rem)]` class string. The user's
  reported drift ("35 QNs ~110 px, 848 Days ~80–90 px") is gone — the
  size-resolution input is the viewport, not the per-card container.
- **2-line "848 Days"** — both lines render at the SAME 113 px height
  as the 1-line cards; total stack ≈ 226 px (with `leading-[0.95]`,
  effective stack ≈ 215 px). The reserved value-block height (the
  `flex-1` from [[TV-Viewport-Fit-Grid]]) accommodates this without
  pushing into the chart strip.
- **"35 QNs"** — renders at the SAME 113 px as "475". This is the
  regression the user reported from v15; v15.1 closes it.

## Tests

**Updated** the 6 v15 tests in `sqcdp-card.test.tsx` (renamed
`describe` block to "TV uniform fluid typography (v15.1)"):

| # | Test | What changed |
|---|------|--------------|
| 1 | applies the uniform vh clamp on the hero in TV density when no size override | Asserts the new vh-based clamp class; asserts the absence of the v15 container style |
| 2 | does NOT apply uniform sizing in normal density | Updated assertion to reference the absence of any clamp class — same shape as v15 |
| 3 | defers to a curator size override | Unchanged in spirit; renamed gate variable in the body |
| 4 | applies the sub-metric uniform clamp on each stacked block | Asserts new sub-metric vh clamp; asserts the absence of the per-block container style |
| 5 | does NOT apply sub-metric uniform sizing in normal density | Unchanged |
| 6 | scales the trend icon via vh in TV uniform mode (with rem floor/ceiling pins) | Asserts `h-[7vh]` / `w-[7vh]` / `min-h-[2rem]` / `max-h-[4.5rem]` |

**New** test (the user's "uniform across the row" verification):

- 7. `<SqcdpGrid>` — every primary hero element receives the same
  vh-based size token. Mounts the grid with the 5 primary builtin
  categories and a metric per category, then queries
  `[class*="text-[clamp(4.5rem,10.5vh,12rem)]"]` and asserts the
  count equals the primary card count. Direct check that there's no
  per-card variation in the size class.

## Verification

- `pnpm vitest run src/features/shift-productivity/production-boards/boards/sqcdp/`
  — **13 files, 156 tests** all green (was 155; +1 new uniform-row
  assertion).
- `pnpm exec eslint <touched files>` — clean.
- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm build` — clean. New arbitrary classes confirmed in the built
  CSS (`dist/assets/index-*.css`):
  - `text-[clamp(4.5rem,10.5vh,12rem)]` ✓
  - `text-[clamp(2.25rem,5.5vh,5.5rem)]` ✓
  - `h-[7vh]` / `w-[7vh]` ✓
  - `min-h-[2rem]` / `min-w-[2rem]` ✓
  - `max-h-[4.5rem]` / `max-w-[4.5rem]` ✓
  - `leading-[0.95]` / `leading-[1]` ✓
- `feature-shift-productivity` chunk: 473.88 KB (unchanged within
  rounding — net delta is small CSS plus a small constant rename).

## Decisions

- **vh beat cqh.** Container queries are the wrong tool when the
  requirement is cross-component uniformity. vh resolves against the
  viewport so every card sees the same input. See
  [[ADR-SQCDP-Uniform-vs-AutoFit-Typography]] for the full alternatives
  log (cqw / measurement hook / fixed vh / subgrid all rejected).
- **Drop `containerType: 'size'`.** With vh-based sizing there's no
  reason to establish a containment boundary. Removing it simplifies
  the chain and removes the only browser-specific layout concern.
- **Tighten the primary ceiling.** v15 max was 16rem (256 px). v15.1
  uses 12rem (192 px) because uniform sizing means EVERY card reaches
  the max, so a ceiling chosen for "biggest possible card" feels too
  large when applied to all cards equally.
- **Keep wrap behaviour intentional.** "848 Days" wraps to 2 lines at
  hero size — that's good, it preserves the actual content.
  `whitespace-nowrap` would either truncate or shrink-to-fit per-card,
  re-introducing the inconsistency we're removing. The
  `leading-[0.95]` line-height packs the two lines tight; the
  `overflow-hidden` safety net stays in place.
- **Curator overrides still win.** Same gate as v15
  (`density === 'tv' && !styleConfig.primary?.size`), same composition
  rule (uniform class appended last; twMerge picks the curator's pin
  if present).

## Open items

- **Per-board clamp tuning.** If a sibling TV board adopts uniform
  sizing with a different aspect ratio (e.g. a 2-tier layout where
  the secondary tier is much taller per-card), promote
  `TV_UNIFORM_*` to a shared `production-boards/lib/tv-fit.ts` helper.
  Today the constants live in `sqcdp-card.tsx` because there's only
  one consumer.
- **Loosen the 4K ceiling if a customer asks.** 12rem at 4K reads as a
  hero number; if a curator wants "even bigger on the 8K wall in the
  lobby," bump the max — don't re-introduce per-card scaling.
- **JS measurement hook stays in reserve.** If a curator authors a
  hero value that's longer than what comfortably wraps to 2 lines at
  113 px (e.g. "December 31, 2026"), a measurement-based hook becomes
  worth the complexity for that surface specifically. Until then, vh
  + wrap is sufficient.

## Related

- [[Decisions/ADR-SQCDP-Uniform-vs-AutoFit-Typography]] — why vh, and
  the four alternatives we considered.
- [[Implementations/Implement-SQCDP-Hero-Autofit-Typography]] — v15
  (cqh-based), now superseded by this note.
- [[Patterns/TV-Viewport-Fit-Grid]] — extended with v15.1 recipe; the
  v15 cqh recipe is preserved as historical.
- [[Patterns/Per-Field-Style-Overrides]] — JIT-safe static-class-map
  convention reused here.
- [[Implementations/Implement-SQCDP-TV-Viewport-Fit]] — v1 viewport-fit
  substrate. Both v15 and v15.1 build on this; the only thing v15.1
  changes vs. v1 is the typography token (constants + composition
  rule), not the layout chain.
- [[Implementations/Implement-SQCDP-Editor-Fine-Grained-Controls]] —
  the v14 editor whose `<FieldStyleRow>` got the new uniform-sizing
  hint copy.
- [[Components/ProductionBoards - Feature Module]] — feature module
  index.