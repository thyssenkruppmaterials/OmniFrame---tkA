---
tags: [type/decision, status/superseded, domain/frontend]
created: 2026-05-17
---

> **Superseded same day by [[ADR-SQCDP-Measured-vs-Viewport-Hero-Typography]] (v15.2).** The "trigger to revisit" condition flagged in this ADR ("a curator authors a value that's longer than what comfortably wraps at the vh size") turned out to apply to the canonical 5-card primary layout itself — every primary card overflowed on the user's TV at the v15.1 clamp. The original v15.1 decision text is kept verbatim below for the historical record.

---

# ADR — SQCDP Uniform vs. Auto-fit Hero Typography

## Status

Accepted (2026-05-17). Supersedes the cqh-based v15 model from
[[Implement-SQCDP-Hero-Autofit-Typography]] within the same day.

## Context

Same-day follow-on to v15 (auto-fit hero typography via CSS container
queries + `cqh` units). The user reviewed a 1080p TV screenshot and
asked for a different mental model — quote, verbatim:

> "Review the screenshot and see that there are differences in the text
>  sizes. What I would like to see is pure consistency across the
>  board, where everything resizes in the correct ratio as the screen
>  gets larger. This way, it is an even design across the board that is
>  dynamic and fluid. Please ensure you think through this to make this
>  the most optimized way."

The screenshot showed clearly different glyph sizes across the five
primary cards despite identical class chains:

| Card | Value | Rendered glyph height |
|------|-------|----------------------|
| Safety | 848 Days (wraps) | ~80–90 px / line |
| Quality | 35 QNs | ~110 px |
| Cost | 8 % OT | ~80 px |
| Delivery | 99.7% | ~100 px |
| People | 475 | ~95 px |

## Why the v15 model drifts

v15 used `text-[clamp(6rem, 28cqh, 16rem)]` with
`style={{ containerType: 'size' }}` on each card's value-block wrapper.
`cqh` resolves against the **owning container's** block-axis dimension
— and each card's value-block wrapper is `flex-1` inside the body, with
subtitle / comparison / `<TrendIndicator>` competing for residual
space. Subtle per-card differences (text wrap, comparison text width,
trend arrow presence) yield subtly different wrapper heights → subtly
different `cqh` values → subtly different font-sizes.

Container queries are designed for **per-component responsiveness**.
The user explicitly wants the **opposite**: cross-component uniformity
that still scales with screen size. CSS container queries are the
wrong tool for this job.

## Decision

Replace `cqh` with `vh`. Keep the static-literal clamp class
convention from [[Per-Field-Style-Overrides]] (Tailwind v4 JIT can't
see template-composed strings). Drop the `containerType: 'size'`
inline style — no per-card containment boundary needed when sizing is
viewport-relative. Rename the constants from `TV_AUTOFIT_*` to
`TV_UNIFORM_*` so future readers know the model is uniform-fluid, not
per-card auto-fit.

**Landed values** (reviewed at 1080p / 1440p / 4K; tune during QA):

| Token | Class |
|-------|-------|
| Primary | `text-[clamp(4.5rem,10.5vh,12rem)] leading-[0.95] overflow-hidden` |
| Sub-metric | `text-[clamp(2.25rem,5.5vh,5.5rem)] leading-[1] overflow-hidden` |
| Trend icon | `h-[7vh] w-[7vh] min-h-[2rem] min-w-[2rem] max-h-[4.5rem] max-w-[4.5rem]` |

Why these values:

- **Primary floor 4.5rem (72 px)** — readable on small embedded
  previews (e.g. an iframe in a curator preview). Higher than the
  jsdom-default 16 px and the v12.x `text-7xl` (72 px) baseline so
  small viewports don't regress.
- **Primary preferred 10.5vh** — gives ≈ 113 px on a 1080p TV (the
  canonical viewport), ≈ 151 px on 1440p, ≈ 227 px on 4K.
- **Primary ceiling 12rem (192 px)** — prevents unbounded growth on
  ultra-wide / 8K displays. The v15 max was 16rem (256 px); we tighten
  to 12rem because at 4K and beyond the 192 px figure already feels
  like a hero number, and uniform sizing means EVERY card gets it
  (vs. v15 where only some cards reached the max).
- **Sub-metric scaling factor ≈ 0.52** — 5.5vh is roughly half the
  primary's 10.5vh, mirroring the existing `text-9xl` / `text-7xl`
  ratio (≈ 0.67 in pixels — close enough; we tighten the sub-metric
  ratio because each sub-metric block shares its card with siblings).
- **Trend icon at 7vh capped at 4.5rem (72 px)** — at 1080p the icon
  hits its 72 px ceiling next to a 113 px hero, which reads well; on
  larger displays the cap holds (the hero keeps growing to its own
  192 px ceiling, so the visual hierarchy is preserved).

Wrap behaviour preserved on purpose. "848 Days" wraps to 2 lines at
hero size; that's GOOD because it preserves content. `leading-[0.95]`
packs the two lines tight; `overflow-hidden` clips a pathological
3-line wrap on a very narrow card without shoving the chart strip
off-screen.

## Alternatives considered

### 1. Keep `cqh`, switch container to `cqw` (width)

`grid-cols-5` + `auto-rows-fr` means every primary card has the same
width. So `cqw` would be uniform too. **Rejected** because the
container-query containment boundary is still required (Tailwind's
`@container/...` modifiers + `containerType: 'inline-size'`); that's
extra fragility around flex layout for no win versus `vh`. `vh` is
strictly simpler.

### 2. JS-driven `useUniformHeroSize` hook

`ResizeObserver` measures all primary value spans on resize, picks the
largest font-size that fits the SMALLEST of them, applies via a CSS
custom property `--sqcdp-hero-px`. Gives **perfect** consistency AND
**perfect** fit. **Rejected** because:

- Adds JavaScript to a rendering hot path.
- Couples sibling cards (a re-mount of one triggers a measurement
  pass for the row).
- First-paint flash of un-fitted text until the observer fires.
- Harder to test (jsdom doesn't compute layout, so we'd be back to
  asserting on class composition anyway).

Hold this option in reserve — if vh proves insufficient at extreme
content lengths (e.g. a curator types a 6-word value on a Safety card
that wraps to 3 lines), a measurement-based hook becomes worth the
complexity.

### 3. Single fixed vh value (no clamp)

`text-[10.5vh]` without `min`/`max`. **Rejected** because it'd be
unreadable on a small embedded preview (~80 px on 768-tall preview but
collapses below readability on 480-tall tiles) AND comically large on
8K (216 px on 8K, but a 16K wall would push it to 432 px which busts
the card geometry).

### 4. CSS subgrid / grid-row sizing tricks

Force every primary card's value cell into the same grid track height
via subgrid. **Rejected** as overkill — the cards already have
identical row-stretched heights (via `auto-rows-fr` from
[[Patterns/TV-Viewport-Fit-Grid]]); the inconsistency is in font-size
resolution against THAT height, not in the height itself.

## Consequences

### Positive

- Pure consistency across the row — every primary hero element on a
  given screen renders at the same px.
- Smoother scaling story: 1080p → 1440p → 4K → 8K traces one clamp
  curve, not one curve per card-of-different-height.
- Less code. The `containerType: 'size'` style prop and its
  `CSSProperties` constant are gone; the gate logic is unchanged but
  the class chain is simpler.
- No first-paint flash; rendering is one CSS pass. Recharts
  coexistence is automatic (no container boundary to worry about).

### Negative

- A 1-line value on a tall card no longer "fills" the card's vertical
  budget the way v15 did — there's some empty space between the
  header band and the meta row at large viewport heights. This is the
  **deliberate** tradeoff: the user prefers visual consistency across
  cards over per-card vertical-budget fill.
- The 4K ceiling at 12rem (192 px) is tighter than v15's 16rem. If a
  customer asks for "even bigger numbers on the 8K wall in the
  lobby," loosen the ceiling rather than re-introducing per-card
  scaling.

### Neutral

- Curator size overrides (`metric.styleConfig.primary.size`) still
  win — same gate as v15 (`density === 'tv' && !styleConfig.primary?.size`),
  same composition rule (auto-fit class appended last; twMerge dedup
  picks the curator's pin if present).
- All 156 SQCDP unit tests pass after the test updates (155 → 156;
  +1 for the new "uniform across the row" assertion that mounts
  `<SqcdpGrid>` and counts hero elements with the same size token).

## Trigger to revisit

- A curator reports that "X-Y-Z card looks visibly smaller than the
  others on our TV." That would mean `vh` isn't actually uniform on
  some browser path (tablet `100vh` quirks?) or a parent has
  `transform: scale(...)` that breaks vh. Investigate the rendering
  path before assuming vh is wrong.
- A new TV display class lands (e.g. a 16K wall) and the 192 px
  ceiling feels small. Loosen the ceiling.
- A curator wants a value that's longer than what comfortably wraps to
  2 lines at hero size. Switch to the JS measurement hook (Alternative
  #2) for that surface specifically — keep vh as the default for the
  rest of the board.

## Related

- [[Implementations/Implement-SQCDP-Uniform-Hero-Typography]] — v15.1
  implementation log with the full diff and visual QA matrix.
- [[Implementations/Implement-SQCDP-Hero-Autofit-Typography]] — v15
  implementation, now superseded; kept for historical record.
- [[Patterns/TV-Viewport-Fit-Grid]] — extended with the v15.1 uniform-
  fluid recipe; the v15 cqh recipe is preserved as historical.
- [[Patterns/Per-Field-Style-Overrides]] — same JIT-safe static-class
  convention reused here.
- [[Implementations/Implement-SQCDP-TV-Viewport-Fit]] — v1 viewport-fit
  substrate that both v15 and v15.1 build on top of.