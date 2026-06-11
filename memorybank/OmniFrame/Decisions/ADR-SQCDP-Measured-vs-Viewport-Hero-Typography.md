---
tags: [type/decision, status/active, domain/frontend]
created: 2026-05-17
---

# ADR — SQCDP Measured vs. Viewport Hero Typography

## Status

Accepted (2026-05-17). Supersedes [[ADR-SQCDP-Uniform-vs-AutoFit-Typography]] (the v15.1 `vh`-only decision from earlier the same day) and the v15 cqh-based design from [[Implement-SQCDP-Hero-Autofit-Typography]].

## Context

Third iteration on the SQCDP TV hero typography. Earlier the same day we landed two CSS-only attempts:

- **v15 — `cqh` (container queries).** Each card scaled to its OWN value-block height. Per-card content drove different wrapper heights → siblings drifted. User reported a 1080p screenshot with the five primary cards rendering at noticeably different glyph heights despite identical class chains.
- **v15.1 — `vh` (viewport units).** Replaced `cqh` with `vh` so the clamp resolved to the SAME px in every card on a given viewport. Siblings agreed but the chosen size had no width awareness. The user reviewed a fresh TV screenshot and reported:

  > "It looks like it is currently not displaying as expected. The sizes are still different, and the percent is cut off. Please review comprehensively and fix these issues."

The screenshot showed:

- **Delivery / "99.7%"** — the `%` glyph clipped on the right edge of the card. Horizontal overflow at the v15.1 113 px size.
- **Safety "848 Days"** + **Quality "35 QNs"** — wrapped to 2 stacked lines because the value rendered taller than its card width could hold.
- **Cost "8 % OT"** — kept to one line but looked smaller than the wrapped neighbours because the wraps doubled the stack height.
- **People "475"** — looked oversized / less constrained than the others because nothing about it competed for space.
- **Shipping "500 Orders"** + **Announcement "73 DAYS FOR PHYSICAL"** — secondary single-mode cards rendered at the SAME primary clamp (the v15.1 gate didn't split tiers), so they overflowed even worse than the primaries.

The "trigger to revisit" condition documented in the [[ADR-SQCDP-Uniform-vs-AutoFit-Typography]] ("a curator authors a value that's longer than what comfortably wraps at the vh size") was met by every single primary card under the canonical 5-card layout. Pure-CSS approaches can't deliver "every card the same px AND no card overflows" without **measuring what actually fits**.

## Why pure-CSS approaches stop here

The constraint is two-part:

1. **Width-aware**: the chosen size has to fit the actual rendered text inside the actual card body width. CSS can do this per-card (`text-fit` polyfills, `calc()` with available width) but the math depends on glyph widths — which CSS doesn't expose.
2. **Cross-component uniform**: every member of a tier renders at the SAME px regardless of per-card content. CSS container queries are designed for per-component responsiveness — the opposite of this requirement.

No single CSS unit lands at the intersection. `vh` gives uniformity without width awareness. `cqi` / `cqw` gives width-awareness via the container's inline-size but is still per-container, not cross-component-uniform. Sub-grid alignment tricks address height alignment not font-size choice. The space is genuinely outside what CSS can express.

JS measurement IS the right tool. The previous agent rejected it on grounds of:

- "Adds JavaScript to a rendering hot path" — true, but the alternative is a broken rendering. Measured fit runs once at mount, debounced 100 ms on resize, and the measurement uses cached natural widths so resize ticks don't recompute when nothing changed about the values.
- "Couples sibling cards" — also true and **desirable** for this surface. The user explicitly asked for cross-component uniformity.
- "First-paint flash of un-fitted text" — mitigated by `opacity-0` until the first measurement lands (single RAF tick, ~16 ms invisible duration, no visible flash).
- "Harder to test" — jsdom doesn't compute layout so the end-to-end "right px in a real browser" check is in the visual QA matrix. The mocked-clientWidth + mocked-getBoundingClientRect test surface exercises the compute pipeline structurally.

## Decision

Replace the v15.1 `vh` clamp with a measured-fit hook (`useUniformHeroFit`) + a context provider (`<SqcdpHeroFitProvider>`) mounted at the SQCDP board root. Three independent registries:

| Tier | Members | Why distinct |
|------|---------|--------------|
| `primary` | Primary-tier cards in single-mode | Carries the chart strip; deserves the largest hero typography. |
| `sub` | Sub-metric blocks (in any tier) | Smaller fonts because each block shares its card with siblings. |
| `secondarySingle` | Secondary-tier cards in single-mode | Independent so longer secondary values ("500 Orders", "73 DAYS FOR PHYSICAL") can't drag the primary tier down. |

Each tier independently computes:

```
for each entry in tier:
  natural = measureWidth(entry.text, refPx = 100)
  maxFit  = (entry.clientWidth - inlineSafetyPx) / natural * refPx

tierSize = min(maxFit across tier)
tierSize = min(tierSize, viewportHeight * viewportCeilingVh[tier] / 100)
tierSize = max(tierSize, floorPx[tier])
tierSize = roundToNearest(tierSize, roundToPx)
```

### Tuning

`DEFAULT_UNIFORM_HERO_FIT_OPTIONS` (in `hooks/use-uniform-hero-fit.ts`):

| Knob | Primary | Sub | SecondarySingle |
|------|---------|-----|-----------------|
| `viewportCeilingVh` | 11 | 6 | 9 |
| `floorPx` | 56 | 32 | 48 |
| `initialPx` | 128 | 56 | 96 |

Globals: `inlineSafetyPx = 16`, `roundToPx = 4`, `resizeDebounceMs = 100`, `referenceFontPx = 100`.

### Overflow safety net

If a value's one-line max-fit would force the tier below `floorPx[tier]`, the snuggest entry is **demoted** out of the tier-size computation, the demoted entry renders with `whitespace: normal` + `line-clamp-2`, and the tier picks its size from the survivors. Bounded by the entry count so the loop terminates.

Example: at 1080p, Announcement ("73 DAYS FOR PHYSICAL", 20 chars) can't fit at the secondary-single floor of 48 px → demoted → secondary tier picks its size from Shipping ("500 Orders") survivor → "73 DAYS FOR PHYSICAL" wraps to 2 lines at the survivor's size.

### Curator overrides defer

Unchanged from v15 / v15.1: when `metric.styleConfig.primary.size` is pinned, the card passes `enabled: false` to the hook → no registration → no inline `fontSize` override → the static `text-{N}xl` class from `primaryClasses` wins via the existing chain. See [[Patterns/Per-Field-Style-Overrides]] for the static-class convention this defers to.

### Trend icon

No longer carries its own `vh`-based clamp. Instead derives from the measured hero size at runtime: `iconPx = clamp(28, heroPx * 0.5, 80)`. Applied as inline `style={{ width, height }}` on the SVG.

## Alternatives reconsidered

The v15.1 ADR's alternatives table is updated here with v15.2's hindsight:

### 1. Keep `vh` and accept overflow

The v15.1 status quo. **Rejected** — the user's screenshot is the proof that overflow breaks the user experience badly enough to revisit.

### 2. JS measurement (this ADR)

The approach we're picking. Three independent tier registries, shared ResizeObserver, debounced resize, RAF-collapsed recomputes, natural-width cache keyed by `(text, font-family, font-weight, font-style, letter-spacing, text-transform)`.

### 3. Keep `vh` but pick a smaller preferred + remove the trend icon

Would fit short values but waste vertical budget on cards with short values. Doesn't address the secondary-single case at all (those have longer values than primaries). **Rejected** as half-measures.

### 4. Move to a fixed 2-line wrap default

Would fit everything by allowing wraps. **Rejected** — single-line is what curators expect for hero numbers, and our overflow fallback handles the rare unfittable case without forcing everyone into 2-line.

### 5. Use a different layout (1 column instead of 5)

Would give every card more width. **Rejected** — the 5-card SQCDP layout is canonical and curators can already adjust via [[Implement-SQCDP-Editable-Categories]].

## Consequences

### Positive

- **No card overflows** at the chosen size. The measurement IS the fit guarantee.
- **Every primary card renders at the same px**. Every sub-metric block at the same px. Every secondary single-mode card at the same px. Three distinct tier sizes that all fit, all uniform within tier.
- **Smooth scaling**: 1080p → 1440p → 4K traces a monotonic curve per tier — bigger viewport, bigger uniform size.
- **Width-aware secondary tier**: "500 Orders" no longer rendered at the primary clamp; "73 DAYS FOR PHYSICAL" no longer cut off.
- **Overflow fallback**: pathological values relax to 2-line wrap without breaking the tier.
- **Curator overrides still defer** — same composition as v15 / v15.1.

### Negative

- **Adds JavaScript to the render path** for TV mode. One-time cost on mount + on resize (debounced) + on text content change. Pure measurement (no layout writes from JS); browsers can fit this in 1-2 ms even at 4K with all primaries + sub-metrics + secondary-singles registered.
- **First-paint requires an invisible frame**. `opacity-0` until the first compute pass lands; total ~16 ms. The initial fallback px renders during this frame but is invisible.
- **The chosen px is smaller than v15.1's** for cards where v15.1 was overflowing. That's intentional — v15.1 was choosing px that didn't fit. The measured px IS the largest size that fits. Trade-off the user explicitly asked for.

### Neutral

- **Per-tier knobs are exported constants** (`DEFAULT_UNIFORM_HERO_FIT_OPTIONS`). Future tuning lives in one named module, not scattered across class strings.
- **Test surface is structural** — jsdom doesn't compute layout, so the end-to-end "right px in a real browser" check moves to the visual QA matrix in [[Implement-SQCDP-Measured-Hero-Typography]]. The hook's compute pipeline is exercised with mocked clientWidth + getBoundingClientRect.

## Trigger to revisit

- A curator reports that a card's value still looks oddly-sized → likely a measurement timing issue. Check that the value text changes (`text` prop to the hook) are triggering re-registration via the dedicated `useEffect` rather than just sitting in the registry.
- A new TV display class lands (e.g. an 8K wall) and the per-tier `viewportCeilingVh` numbers feel too tight → loosen the ceiling rather than re-introducing per-card scaling.
- A second board adopts the recipe → promote `useUniformHeroFit` + `SqcdpHeroFitProvider` to a shared `production-boards/lib/uniform-hero-fit/` module.
- The overflow fallback fires for a regular curator value (not edge-case like "73 DAYS FOR PHYSICAL") → revisit either the secondary-single floor (raise) or the per-tier ceiling (loosen).

## Related

- [[Implementations/Implement-SQCDP-Measured-Hero-Typography]] — v15.2 implementation log with the full diff, visual QA matrix, tests.
- [[ADR-SQCDP-Uniform-vs-AutoFit-Typography]] — v15.1 ADR, **superseded by this note**. Its "trigger to revisit" condition has now been met.
- [[Implementations/Implement-SQCDP-Uniform-Hero-Typography]] — v15.1 implementation, superseded.
- [[Implementations/Implement-SQCDP-Hero-Autofit-Typography]] — v15 (cqh) implementation, already superseded by v15.1.
- [[Patterns/TV-Viewport-Fit-Grid]] — extended with the v15.2 measured-fit recipe; v15 and v15.1 are kept verbatim as historical record.
- [[Patterns/Per-Field-Style-Overrides]] — the static-class convention that the curator-override path still defers to.
- [[Implementations/Implement-SQCDP-TV-Viewport-Fit]] — v1 viewport-fit substrate that all three iterations build on top of.
