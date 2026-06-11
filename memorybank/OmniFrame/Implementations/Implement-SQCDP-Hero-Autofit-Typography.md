---
tags: [type/implementation, status/superseded, domain/frontend]
created: 2026-05-17
---

# Implement SQCDP Hero Auto-fit Typography

> **Superseded by v15.1 — see
> [[Implement-SQCDP-Uniform-Hero-Typography]] (same day, 2026-05-17).**
> The v15 cqh-based per-card auto-fit produced visibly inconsistent
> glyph sizes across siblings on a 1080p TV review (each card scaled
> to its own value-block height, which differs by content / wrap /
> trend-arrow presence). v15.1 swaps `cqh` for `vh` so every primary
> card resolves to the SAME font-size on a given viewport, while
> still scaling smoothly across screen sizes. Decision log:
> [[ADR-SQCDP-Uniform-vs-AutoFit-Typography]]. The v15 text below is
> kept verbatim for the historical record.

## Purpose / Context

Same-day follow-on to [[Implement-SQCDP-TV-Viewport-Fit]]. The v1 viewport-fit pass made every primary card the full row-stretched height, but the static `text-{N}xl` token on the hero number meant short single-line values like "475" looked small relative to the new tall card body — leaving cosmetic dead space between the colored header and the chart strip.

The user, looking at a TV display:

> "The CDP board is on display for the TV. The top cards have tons of empty space. Is there a way that the text inside of those stack cards dynamically increases to help fill up the space and make it look much nicer?"

Goal: hero number scales to fill the available card-body height, so a one-line value grows much larger than a two-line value, without overflowing, and without making the card meta / chart strip look cramped. Same treatment for the secondary tier's stacked sub-metric values. **TV-only** — normal in-page rendering must be unchanged.

## Mechanism — CSS container queries (`cqh`)

Three approaches were on the table (see "Approach" section in the spec):

1. **CSS container queries + `cqh` units** — chosen.
2. Hand-rolled `useFitText` hook with `ResizeObserver` — rejected (extra component, flash of un-fitted text, more code, harder to test).
3. Plain viewport units (`vh`) — rejected (doesn't respond to the tier flex-weight ratio; primary 5/8 vs secondary 3/8 of viewport would scale identically against `vh`, which isn't what we want).

Why container queries won:

- **Zero JavaScript** — pure CSS, no `ResizeObserver`, no measurement pass, no flash of un-fitted text on mount.
- **Already in the codebase** — `<StatTile>` and `<KpiGrid>` use Tailwind v4's `@container/...` utilities for width-based queries; `cqh` is the height counterpart from the same spec.
- **Recharts coexists cleanly** — the chart strip lives OUTSIDE the new container boundary (`d.body` vs the sibling `d.chartStrip`), so `<ResponsiveContainer>` is unaffected. Verified by the existing `sqcdp-chart.test.tsx` (14 tests all green).
- **Curator overrides compose naturally** — twMerge dedup handles the `text-9xl` ↔ `text-[clamp(...)]` precedence.

## Files changed

| File | Why |
|------|-----|
| `src/features/.../sqcdp/components/sqcdp-card.tsx` | Module-level `TV_AUTOFIT_*` constants. Single-mode wrapper gets `containerType: 'size'` inline style + auto-fit class on the value div (TV + no curator size override). `<SubMetricBlock>` gains `flex-1 min-h-0` per block + the same container/auto-fit treatment. Trend icon scales via `cqh` too. |
| `src/features/.../sqcdp/components/sqcdp-card.test.tsx` | +6 new tests: TV applies auto-fit + container; normal does not; curator override defers; sub-metric block gets the chain; sub-metric in normal density does not; trend icon scales via cqh. |
| `src/features/.../sqcdp/components/sqcdp-editor-dialog.tsx` | Inline hint under the Size field of `<FieldStyleRow>` (Primary value field only) — "TV mode: auto-fit scales the value to the card height (default)." or "TV mode: pinned size wins — auto-fit disabled. Use the Reset button to re-enable." |

## Auto-fit class chain

Three static literal class strings at the top of `sqcdp-card.tsx`:

```ts
const TV_AUTOFIT_PRIMARY =
  'text-[clamp(6rem,28cqh,16rem)] leading-[0.95] overflow-hidden'
const TV_AUTOFIT_SUB =
  'text-[clamp(3rem,30cqh,9rem)] leading-[1] overflow-hidden'
const TV_AUTOFIT_TREND_ICON =
  'h-[20cqh] w-[20cqh] min-h-[2.5rem] min-w-[2.5rem] max-h-[5rem] max-w-[5rem]'
const TV_AUTOFIT_CONTAINER_STYLE: CSSProperties = {
  containerType: 'size',
  containerName: 'sqcdp-value',
}
```

**Why static literals** — Tailwind v4's JIT scans source files for class literals; a template-composed `text-[clamp(${min}rem,${preferred}cqh,${max}rem)]` would be invisible to the build. Same gotcha that's documented in [[Patterns/Per-Field-Style-Overrides]].

**Why `container-type: size` (not just `inline-size`)** — only `size` containers expose `cqh` (block-axis 1%). `inline-size` containers only expose `cqi` / `cqw`. The auto-fit needs height, so `size` is required.

### Clamp tuning rationale

The clamp values are tuned for the canonical 5+4 SQCDP layout at three TV resolutions:

| Resolution | Body height (single-mode wrapper) | `28cqh` preferred | Clamp picks |
|------------|----------------------------------|-------------------|-------------|
| 1080p | ~160 px | ~45 px | 96 px (min: `6rem`) |
| 1440p | ~280 px | ~78 px | 96 px (min: `6rem`) — still floored |
| 2160p (4K) | ~620 px | ~174 px | 174 px (in range) |
| 5K / TV walls | ~900 px | ~252 px | 256 px (max: `16rem`) |

Critical decision: the **min** clamp is `6rem` (96 px), which is **bigger than the previous default render** (`text-7xl` from `DEFAULT_STYLES.primary.size = '7xl'` = 72 px) — so the change is a strict improvement at 1080p too, not a regression. The **max** clamp is `16rem` (256 px), which is twice the size of the static `text-9xl` (128 px) for big TVs.

For sub-metrics, the clamp is tighter (`3rem` to `9rem`) because each sub-metric block shares its parent's height (1/N), and `30cqh` of the smaller per-block height is the right multiplier.

### Composition rule with curator overrides

Each value div composes its className via `cn()` (twMerge under the hood). The order matters:

```tsx
className={cn(
  d.primary,           // 'text-9xl ...'  (density baseline)
  primaryClasses,      // 'font-sans text-7xl ...'  (curator merge, defaults to 7xl)
  d.primaryReserve,    // 'flex flex-1 items-end min-h-0'
  'flex items-end gap-3',
  useAutoFitPrimary && TV_AUTOFIT_PRIMARY,  // ← appended last, wins via twMerge
  'dark:[text-shadow:...]'
)}
```

twMerge dedup picks the *last* `text-*` size class. So:

- **Default render (no curator override, TV)** — `useAutoFitPrimary === true` → `TV_AUTOFIT_PRIMARY` wins → `text-[clamp(...)]`.
- **Curator pins `primary.size = '9xl'`** — `useAutoFitPrimary === false` (the gate is `!styleConfig.primary?.size`) → auto-fit class NOT added → `text-9xl` survives via twMerge dedup.
- **Normal density** — `useAutoFitPrimary === false` → auto-fit class NOT added → existing `text-7xl` (or curator's pin) renders unchanged.

Same composition rule applies to `<SubMetricBlock>` for the `TV_AUTOFIT_SUB` class.

### `flex-1 min-h-0` on each sub-metric block

The v1 viewport-fit pass added `flex-1 min-h-0` to the stacked-mode WRAPPER (so the wrapper consumes the body's height) but didn't put `flex-1` on each individual block. That meant each block sized to content — and if the wrapper was 700 px but the blocks summed to 200 px, there was 500 px of dead space at the bottom of the wrapper.

v15 adds `density === 'tv' && 'flex-1 min-h-0'` to each `<SubMetricBlock>` so blocks distribute the wrapper's height evenly:

| Sub-metrics | Per-block height (4K body) |
|-------------|---------------------------|
| 1 | 100% of wrapper (~620 px) |
| 2 | 50% (~310 px) |
| 3 | ~33% (~206 px) |

Combined with the per-block `container-type: size`, the value text scales proportionally — fewer sub-metrics → bigger blocks → bigger numbers.

## Editor UX — curator-facing hint

`<FieldStyleRow>` for `fieldKey === 'primary'` now renders a `text-[10px]` hint below the Size select:

- **Size unset** → `"TV mode: auto-fit scales the value to the card height (default)."`
- **Size pinned** → `"TV mode: pinned size wins — auto-fit disabled. Use the Reset button to re-enable."`

The existing row-level `Reset` button (top-right of the field card) clears every override on that field, including `size`, so the user re-enables auto-fit by clicking Reset. We didn't add a separate per-field "Reset to auto-fit" button to keep the diff scoped — the row-level Reset already covers it and no other field has per-key reset affordances. (Optional polish, deferred — see "Open items" below.)

## Visual QA matrix (1080p TV, canonical 5+4 layout)

Computed font sizes from the clamp math + the per-card heights derived above. All values assume a single-tier metric with no curator override.

| Case | Body wrapper height | `28cqh` / `30cqh` preferred | Clamp picks | Lines fit? |
|------|--------------------|-----------------------------|-------------|-----------|
| 1-line "475" | ~160 px | 44.8 px | 96 px (min) | yes (1 × 91 px) |
| 1-line "99.7%" | ~160 px | 44.8 px | 96 px (min) | yes |
| 2-line "848 Days" | ~160 px | 44.8 px | 96 px (min) | yes (2 × 91 px = 182 px exceeds 160 px → wraps to 1 line at 96 px on most card widths; on narrow cards `overflow: hidden` clips graceful) |
| Trend arrow ↗ | (sized off same wrapper) | 32 px | 40 px (min) | matches `h-10 w-10` baseline |
| 2 sub-metrics, ~140 px each | 140 px each | 42 px | 48 px (min) | each value at 48 px |
| 3 sub-metrics, ~93 px each | 93 px each | 27.9 px | 48 px (min) | each value at 48 px |
| Curator pinned `size: '7xl'` | n/a | n/a | 72 px (text-7xl wins via twMerge) | unchanged behavior |

At 1080p the floor mostly wins because the wrapper is shallow; the value at the auto-fit floor (96 px primary, 48 px sub) is still **bigger than the previous `text-7xl` default** (72 / 36 px), so the user's "tons of empty space" complaint shrinks meaningfully without any layout change.

At higher resolutions (1440p, 4K, 5K) the `28cqh` preferred starts dominating and the value text scales smoothly up to the `16rem` (256 px) primary max / `9rem` (144 px) sub max.

## Why the chart strip is unaffected

The container-query container is on the **single-mode wrapper** (a child of `d.body`). The chart strip is a sibling of `d.body`, NOT a descendant — see `<SqcdpCard>` JSX:

```tsx
<CardSurface>
  <div className={d.header}>...</div>
  <div className={d.body} data-testid='sqcdp-card-body'>
    <div className='flex flex-col gap-1' style={containerType: 'size'}>...</div>
    <div className='mt-auto'>...</div>
  </div>
  {isPrimary && <div className={d.chartStrip}><SqcdpChart .../></div>}
</CardSurface>
```

`<ResponsiveContainer>` (Recharts) inside the chart strip is outside the container boundary. It uses its own `ResizeObserver` against its own parent's width/height. No interaction.

## Verification

- `pnpm vitest run src/features/shift-productivity/production-boards/boards/sqcdp/` — **155 tests / 13 files all green** (was 149; +6 new in `sqcdp-card.test.tsx`).
- `pnpm exec eslint <touched files>` — clean.
- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm build` — clean. Tailwind v4 JIT correctly emitted every arbitrary class:
  - `text-[clamp(6rem,28cqh,16rem)]` ✓
  - `text-[clamp(3rem,30cqh,9rem)]` ✓
  - `h-[20cqh]` / `w-[20cqh]` ✓
  - `min-h-[2.5rem]` / `min-w-[2.5rem]` ✓
  - `max-h-[5rem]` / `max-w-[5rem]` ✓
  - `leading-[0.95]` / `leading-[1]` ✓
- `feature-shift-productivity` chunk: 470.77 KB (was 470.81 KB — unchanged within rounding; the new code is ~2 KB of CSS classes which Tailwind compresses into the shared CSS bundle).

## Open items

- **Per-key "Reset to auto-fit" button** — optional polish from the spec that we deferred. The row-level Reset covers the same operation, and no other field has per-key reset affordances, so adding it just for `size` would diverge. Re-evaluate if curators ask.
- **Tune the clamp ladder per board** — if a sibling TV adopter (e.g. a future scorecard) lands the same auto-fit recipe with different aspect ratios, promote `TV_AUTOFIT_PRIMARY` / `TV_AUTOFIT_SUB` to a shared `production-boards/lib/tv-fit.ts` helper. Today the constants live in `sqcdp-card.tsx` because there's only one consumer.
- **Cap on insanely tall single-tier layouts** — at 5K+ resolutions the max clamp (16rem / 256 px) might still feel small if the curator only ships 1 primary card across the whole tier. Hard to anticipate without seeing it. Bump the max if a real-world report comes in.

## Decisions

- **Container queries beat `useFitText` hook.** Zero JS, no flash, scales with container height which already responds to the tier flex-weight + viewport size.
- **Container goes on the wrapper, not the value div.** Putting `container-type: size` on the wrapper means `cqh` resolves against "the value-block's available height" (after subtitle / comparison / meta). Putting it on the value div would make `cqh` resolve against the value div's own height, which is itself sized by its `flex-1` — circular.
- **`6rem` floor on primary.** Bigger than the previous default (`text-7xl` = 72 px) so the auto-fit is a strict improvement at every viewport size. The user's "tons of empty space" complaint becomes "less empty space" at 1080p (96 vs 72 px) and "much less empty space" at 4K (256 vs 72 px).
- **Per-block `flex-1 min-h-0` for sub-metrics.** v1's stacked-mode wrapper had `flex-1 min-h-0` but each block was content-sized, leaving dead space at the bottom of the wrapper for short sub-metric stacks. v15 distributes the wrapper height across blocks so 1/2/3 sub-metrics each get an equal share.
- **TV-only.** Normal density renders identically to before — the auto-fit class is gated on `density === 'tv'`. All 149 existing tests still pass without modification.
- **Curator overrides win.** `useAutoFitPrimary` derived as `density === 'tv' && !styleConfig.primary?.size`. Pinned size → no auto-fit class, twMerge picks the curator's `text-{N}xl` from `primaryClasses`.

## Related

- [[Patterns/TV-Viewport-Fit-Grid]] — extended with the new "Auto-fit hero typography" section.
- [[Patterns/Per-Field-Style-Overrides]] — JIT-safe static class map convention reused here for `TV_AUTOFIT_*`.
- [[Implementations/Implement-SQCDP-TV-Viewport-Fit]] — v1 work this builds on. v1's flex-1 chain is the substrate; v15 adds the typography scaling on top.
- [[Implementations/Implement-SQCDP-Editor-Fine-Grained-Controls]] — the v14 editor whose `<FieldStyleRow>` got the new auto-fit hint.
- [[Implementations/Implement-SQCDP-Editable-Categories]] — sibling work landed earlier today; the dynamic category counts work uniformly with auto-fit.
- [[Components/ProductionBoards - Feature Module]] — feature module index.
