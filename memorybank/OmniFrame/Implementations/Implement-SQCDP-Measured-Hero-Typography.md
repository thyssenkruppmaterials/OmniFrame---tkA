---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-05-17
---

# Implement SQCDP Measured Hero Typography

## Purpose / Context

Third pass on the SQCDP TV hero typography in a single day. After v15 (`cqh`, [[Implement-SQCDP-Hero-Autofit-Typography]]) and v15.1 (`vh`, [[Implement-SQCDP-Uniform-Hero-Typography]]) both shipped CSS-only recipes that the user reported as broken on the TV display, v15.2 takes the JS measurement route. The decision log is [[Decisions/ADR-SQCDP-Measured-vs-Viewport-Hero-Typography]] — it captures why pure-CSS approaches can't deliver "every card the same px AND no card overflows" without measuring what actually fits.

Quote from the user's third request:

> "It looks like it is currently not displaying as expected. The sizes are still different, and the percent is cut off. Please review comprehensively and fix these issues."

The v15.1 fault map from the user's screenshot:

| Card | v15.1 symptom |
|------|---------------|
| Delivery / `99.7%` | `%` glyph clipped on the right edge |
| Safety / `848 Days` | Wrapped to 2 stacked lines |
| Quality / `35 QNs` | Wrapped to 2 stacked lines |
| Cost / `8 % OT` | Single line, looks smaller than wrapped neighbours |
| People / `475` | Looks bigger / less constrained than the others |
| Shipping / `500 Orders` | Secondary single-mode card rendered at the primary clamp → overflowed |
| Announcement / `73 DAYS FOR PHYSICAL` | Same as Shipping; `"PHYSICAL"` hidden, `"73 DAYS FOR"` clipped right-edge too |

v15.2 closes all seven symptoms.

## Mechanism — `useUniformHeroFit` + `<SqcdpHeroFitProvider>`

Two new files plus three modifications:

```
sqcdp/
  hooks/
    use-uniform-hero-fit.ts                 ← NEW — hook + registry + context type
  components/
    sqcdp-hero-fit-provider.tsx             ← NEW — mounts the registry at the board root
    sqcdp-card.tsx                          ← MODIFIED — registers value text + sub-metrics
  sqcdp-board.tsx                            ← MODIFIED — wraps the TV branch in the provider
  components/
    sqcdp-card.test.tsx                     ← MODIFIED — replaces v15.1 tests with v15.2 + adds hook tests
```

### The hook's three independent registries

```ts
export type HeroTier = 'primary' | 'sub' | 'secondarySingle'
```

- **`primary`** — primary-tier cards in single-mode. Carries the chart strip.
- **`sub`** — every `<SubMetricBlock>` value across the board (primary stacked cards + secondary stacked cards). Sub-metrics share their card with siblings so the floor + ceiling are tighter than primary's.
- **`secondarySingle`** — secondary-tier cards in single-mode. Independent from primary so longer secondary values ("500 Orders", "73 DAYS FOR PHYSICAL") don't drag the primary tier size down.

Each tier has independent `viewportCeilingVh`, `floorPx`, and `initialPx` knobs (see [[Decisions/ADR-SQCDP-Measured-vs-Viewport-Hero-Typography]] for the tuning table).

### The compute pipeline

```
for each registered entry in tier:
  natural = measureWidth(entry.text, refPx = 100)  // cached by font properties
  available = entry.el.clientWidth - inlineSafetyPx
  maxFit = (available / natural) * refPx

tierSize = min(maxFit across tier)
tierSize = min(tierSize, viewportHeight * viewportCeilingVh[tier] / 100)
tierSize = max(tierSize, floorPx[tier])
tierSize = roundToNearest(tierSize, roundToPx)
```

If `min(maxFit) < floorPx[tier]` the snuggest entry is demoted out of the tier-size computation, the entry gets `whitespace: normal` + `line-clamp-2`, and the tier picks its size from the survivors. Bounded by entry count.

Triggers for re-compute:

- Mount (initial registration kicks the RAF).
- Window resize (debounced 100 ms).
- Per-element resize (shared `ResizeObserver` across all registered elements).
- Text content change (separate `useEffect` re-registers when the `text` prop to the hook changes).
- Registry composition change (registration / unregistration both call `schedule()`).

Multiple `schedule()` calls in a single tick collapse into one RAF-scheduled `compute()` call.

### Measurement details

`measureNatural(el, text, refPx, cache)` clones the live element's relevant computed style (`font-family`, `font-weight`, `font-style`, `letter-spacing`, `text-transform`) onto a hidden `<span>` with `position: absolute; visibility: hidden; white-space: nowrap; font-size: ${refPx}px`, reads `getBoundingClientRect().width`, then removes the span. Result cached by `(text, font-family, font-weight, font-style, letter-spacing, text-transform, refPx)` key so resize ticks don't re-measure when nothing changed.

### Registered-element layout (primary card)

The trend icon sits as a flex sibling of the value text. For the measurement's `available width` to be accurate, the **registered element** must be a wrapper that contains JUST the value text (not the icon). The primary card's value JSX is now:

```tsx
<div className="flex items-end gap-3 ...">           {/* outer flex row */}
  <div ref={primaryFit.ref} className="min-w-0 flex-1 ...">
    {renderedPrimaryValue}
  </div>
  {trendEnabled && <TrendIndicator sizeStyle={measuredIconStyle} />}
</div>
```

The inner `min-w-0 flex-1` wrapper takes whatever width the trend icon leaves. Its `clientWidth` is the actual available space for the value text. The hook measures against THAT, not against the outer-row width. Sub-metric blocks (no trend icon competing) keep their original single-div structure.

The trend icon's size is derived from the measured hero px: `iconPx = clamp(28, heroPx * 0.5, 80)`. Applied as inline `style={{ width, height }}` on the SVG via the new `sizeStyle?` prop on `<TrendIndicator>`.

## Diff snippet (the key change)

```ts
// sqcdp-card.tsx — module-scope class chains. v15.2 drops the vh clamp
// constants and the trend-icon clamp; the chain is now
// whitespace-nowrap + overflow-hidden + leading + transition, with the
// font-size delivered via inline style from the measured-fit hook.
const TV_MEASURED_HERO =
  'whitespace-nowrap overflow-hidden leading-[0.95] motion-safe:transition-opacity motion-safe:duration-150'
const TV_MEASURED_HERO_OVERFLOW =
  'whitespace-normal overflow-hidden leading-[0.95] line-clamp-2 motion-safe:transition-opacity motion-safe:duration-150'
const TV_MEASURED_SUB =
  'whitespace-nowrap overflow-hidden leading-[1] motion-safe:transition-opacity motion-safe:duration-150'
const TV_MEASURED_SUB_OVERFLOW =
  'whitespace-normal overflow-hidden leading-[1.05] line-clamp-2 motion-safe:transition-opacity motion-safe:duration-150'
```

```tsx
// sqcdp-card.tsx — hook invocation (pre-return so Rules of Hooks holds)
const tierForFit: HeroTier = def?.tier === 'primary' ? 'primary' : 'secondarySingle'
const useMeasuredForFit =
  !!metric && !!def && density === 'tv' && !styleConfig.primary?.size
const primaryFit = useUniformHeroFit({
  enabled: useMeasuredForFit && !isStackedModeForFit,
  tier: tierForFit,
  id: metric?.id ?? `${category}::no-metric`,
  text: renderedPrimaryValueForFit,
})
```

```tsx
// sqcdp-board.tsx — provider wraps the TV branch only (in-page rendering
// keeps the static density tokens unchanged).
<TvFrame ...>
  <SqcdpHeroFitProvider enabled>
    {loadingMetrics && metrics.length === 0 ? (
      <SqcdpGridSkeleton density='tv' categories={categories} />
    ) : (
      <SqcdpGrid metrics={metrics} density='tv' />
    )}
  </SqcdpHeroFitProvider>
</TvFrame>
```

## Visual QA matrix

Computed from the formula + the canonical 5+4 SQCDP layout dimensions. Real rendered px in a browser may differ by a few px from font-metric variations, but the structural shape (every card in a tier at the same px, no overflow, monotonic scaling with viewport) is exactly what the formula delivers.

Layout assumptions:

- `<TvFrame>`'s `<main class="flex-1 overflow-auto p-10">` = 80 px horizontal padding.
- Primary row: `grid grid-cols-5 gap-6` (24 px gap).
- Secondary row: `grid grid-cols-4 gap-5` (20 px gap).
- Card body: `p-7` = 28 px each side (56 px total).
- Inline safety: 16 px (8 each side).
- Trend icon width on a primary card with trend: derived from `heroPx * 0.5` (~40–80 px depending on viewport).

| Viewport | Per-tier card body width | Primary tier size | Sub-metric tier size | Secondary-single tier size | "99.7%" overflow? | "475" oversized? | Overflow fallback fires? |
|----------|--------------------------|-------------------|----------------------|----------------------------|--------------------|------------------|---------------------------|
| 1920×1080 | Primary ≈ 293 px / Secondary ≈ 386 px | **~64 px** (snuggest = "8 % OT"; primary inner ≈ 215 px after trend icon + 16 px safety) | **~64 px** (clamped by 1080 × 0.06 vh ceiling = 65 px) | **~60 px** (snuggest survivor "500 Orders" fits; "73 DAYS FOR PHYSICAL" demoted to 2-line wrap) | NO | NO — same ~64 px as siblings | YES — "73 DAYS FOR PHYSICAL" wraps to 2 lines |
| 2560×1440 | Primary ≈ 477 px / Secondary ≈ 597 px | **~100 px** (inner ≈ 345 px after trend icon) | **~88 px** (clamped by 1440 × 0.06 vh ceiling) | **~80 px** (survivor "500 Orders"; "73 DAYS FOR PHYSICAL" still demoted) | NO | NO | YES |
| 3840×2160 | Primary ≈ 733 px / Secondary ≈ 904 px | **~180 px** (inner ≈ 585 px after trend icon) | **~128 px** (clamped by 2160 × 0.06 vh ceiling) | **~72 px** (BOTH entries fit, snuggest = "73 DAYS FOR PHYSICAL"; no demotion at 4K because the wider card finally accommodates it on one line) | NO | NO | NO at 4K |

> Pixel values computed from the formula assuming font-black sans-serif with `tabular-nums` (avg glyph width ≈ 0.6–0.85 em depending on character class). Real-browser rendered px may vary by a few px due to font metric specifics; what's guaranteed is the structural shape: every member of a tier renders at the SAME computed px, no card overflows at the chosen px, and the per-tier values scale monotonically with viewport size.

Where the column is `~Xpx`, X is the largest font that fits the snuggest registered entry. Other cards in the same tier render at the same X.

The v15.1 baseline for comparison (every card at 113 px on 1080p) was a px the snuggest card couldn't actually fit — hence the overflow that triggered this work. v15.2 picks the px that DOES fit. Some viewports yield smaller numbers than v15.1; that's the correct trade-off (the user explicitly asked for fit + uniformity over "big but overflowing").

## Edge cases

- **Overflow fallback** (`73 DAYS FOR PHYSICAL`). The hook demotes the snuggest entry when its `maxFit < floorPx[tier]`, repeats until the survivors all fit ≥ floor (or only one entry remains). Demoted entries render with `whitespace-normal` + `line-clamp-2`. Tier-wide uniform px applies to survivors AND demoted entries — the only difference is the wrap class.

- **Curator override defers**. When `metric.styleConfig.primary.size` is set, the card's `useMeasuredForFit` gate is false → hook is called with `enabled: false` → registration is a no-op → `fit.style` is `{}` → the static `text-{N}xl` from the `primaryClasses` chain on the outer wrapper survives via CSS inheritance to the inner registered div. Verified by test ("defers to a curator size override" in `sqcdp-card.test.tsx`).

- **Secondary single split**. The card's `tierForFit` is `def?.tier === 'primary' ? 'primary' : 'secondarySingle'`. Primary cards register with `primary`; secondary cards register with `secondarySingle`. Each tier picks its own size from its own entries. The v15.1 fault (secondary single-mode cards inheriting the primary clamp) is closed.

- **Sub-metric stacks**. Always register with the `sub` tier regardless of parent card tier. Each block has id `${metricId}::${sub.id}` so blocks from different metrics don't collide.

- **First-paint flash**. The hook returns `style.fontSize: ${initialPx}px` when measurement hasn't landed yet. The card applies `opacity-0` until `fit.ready` flips true (after the first compute pass, ~16 ms). Curators see no flash because the invisible frame swaps to the measured render before the eye registers anything.

- **Resize behaviour**. Window `resize` listener debounced 100 ms. `ResizeObserver` on each registered element triggers a `schedule()` (also collapsed via RAF). Compute reads `window.innerHeight` so the per-tier ceiling clamps track viewport shrinks/grows.

- **Text content change**. When the metric's value updates (curator edit, history poll), the `text` prop changes → `useEffect` re-registers → cache miss on the new text → fresh measurement → tier-wide recompute. The measurement cache is keyed by `(text, font properties)` so the OLD text's cache entry stays for any future re-use.

- **Provider absent**. When the card is rendered outside the provider (e.g. a unit test or a non-TV embed), `useUniformHeroFit` short-circuits: the ref callback is a no-op, `sizePx` is null, `style.fontSize` is unset. The card's static density tokens render unchanged. Verified by the `does NOT apply measured sizing in normal density` test.

## Tests

Updated `sqcdp-card.test.tsx`. Total goes 156 → 161 (+5 net new):

| # | Test | Notes |
|---|------|-------|
| 1 | applies the measured-hero class chain on the hero in TV density when no size override | Asserts `whitespace-nowrap`, `overflow-hidden`, `leading-[0.95]`; absence of the v15.1 `text-[clamp` |
| 2 | does NOT apply measured sizing in normal density | Asserts the inner div has no measured chain + no inline fontSize |
| 3 | defers to a curator size override | Inner div has no measured chain; outer styled container still has `text-7xl` |
| 4 | applies the measured-sub class chain on each stacked block in TV density | Asserts each sub-metric value div has the chain; absence of v15.1 sub-metric clamp |
| 5 | does NOT apply sub-metric measured sizing in normal density | |
| 6 | trend icon stays at the density baseline class (no vh clamp); inline size applied only after measurement | jsdom doesn't measure so style is empty initially — verifies the absence of the v15.1 `h-[7vh]` and presence of `h-10` |
| 7 (hook) | picks the largest font that fits the snuggest entry, uniform across the tier | Mocks `clientWidth` + `getBoundingClientRect`; both probes resolve to the same px |
| 8 (hook) | produces distinct sizes per tier (primary vs sub vs secondarySingle) | |
| 9 (hook) | skips registration entirely when enabled is false (curator override path) | Inline `fontSize` stays empty |
| 10 (hook) | re-runs the fit after a window resize event (debounced) | Dispatches `resize`, waits 200 ms past the 100 ms debounce, asserts size changes |
| 11 (hook) | exposes a default tuning constant with sensible per-tier values | Smoke test on the exported defaults |
| 12 (grid) | every primary card exposes the measured-hero class chain | Mounts `<SqcdpGrid>` inside the provider with 5 primary builtins |

The v15.1 sibling-uniformity test ("every primary hero element receives the same vh-based size token") is replaced with a structural check on the measured class chain. End-to-end "every card at the SAME px in a real browser" lives in the visual QA matrix — jsdom doesn't compute layout so it can't sign off on the exact px.

## Verification

- `pnpm vitest run src/features/shift-productivity/production-boards/boards/sqcdp/` — **13 files, 161 tests** all green (was 156; +5 net).
- `pnpm vitest run src/features/shift-productivity/production-boards/` — **36 files, 380 tests** all green (was 375; +5 net, sibling boards unaffected).
- `pnpm exec eslint <touched files>` — clean.
- `pnpm exec tsc -b --noEmit` — clean.
- `pnpm build` — clean. `feature-shift-productivity` chunk: **474.66 KB raw / 101.08 KB gzip** (was 473.88 KB → +0.78 KB raw for the hook + provider).
- The pre-existing per-chunk / total-JS budget overruns on `warehouse-location-map` / `feature-admin` / `feature-rf-interface` are unaffected by this slice (confirmed by stash + rebuild against `main`'s working tree per the v15.1 implementation note).

## Decisions

See [[Decisions/ADR-SQCDP-Measured-vs-Viewport-Hero-Typography]] for the full alternatives log + the reversal of the previous decision ("v15.1 ADR rejected JS measurement — that rejection was wrong; user evidence overrules"). Recap:

- **Three independent tier registries** so the secondary tier's longer values don't drag the primary tier down.
- **Per-element registration via context + ref callback**. Stable ref callback (via refs-of-everything trick) so context updates don't churn the registry.
- **Overflow fallback**: demote the unfittable entry, pick tier size from survivors, demoted entry wraps to 2 lines.
- **Curator override defers** unchanged.
- **Trend icon scales from the measured hero px** rather than carrying its own clamp.
- **First-paint invisibility** via `opacity-0` until `fit.ready` lands (~16 ms).

## Open items

- **Promote to shared module** if a second board adopts measured-fit hero typography. Today the hook + provider live in the SQCDP module because they're SQCDP-specific (the tier names `primary`/`sub`/`secondarySingle` map to SQCDP's structure). A generic promotion would rename them to neutral terms (e.g. `tierA`/`tierB`/`tierC` or per-tier opaque IDs).
- **Per-board ceiling tuning** if a different content shape lands. A board with much shorter values + only 2 cards per row would want a higher ceiling than SQCDP's 11 vh.
- **Investigate `text-fit` CSS proposal** if it ever ships. `text-fit` would express "fit this text to its container" purely in CSS. Today it's at W3C proposal stage; not in any browser as of 2026-05-17. If/when it lands, revisit whether the JS hook can simplify to CSS + a thin sync layer.
- **Surface the chosen px to curators** in the editor preview. Today curators see the chosen size only on the TV display. A preview pane could show "This metric will render at ~84 px on a 1080p TV" as a curator-facing hint.

## Canonical handles (if you want to tune further)

- **Viewport ceilings** → `DEFAULT_UNIFORM_HERO_FIT_OPTIONS.viewportCeilingVh` in `hooks/use-uniform-hero-fit.ts`. Per-tier vh percentages out of 100. Raise to allow bigger sizes on bigger viewports; lower to keep cards from looking comically large on huge screens.
- **Floors** → `DEFAULT_UNIFORM_HERO_FIT_OPTIONS.floorPx`. Per-tier minimums in px. Raise to keep small embedded previews readable; lower to allow even tighter fits before the overflow fallback fires.
- **Initial fallback sizes** → `DEFAULT_UNIFORM_HERO_FIT_OPTIONS.initialPx`. Per-tier values rendered behind `opacity-0` during the invisible first frame. Tune to whatever feels right at the canonical 1080p TV viewport so first-paint is sensible if measurement is delayed.
- **Inline safety pad** → `DEFAULT_UNIFORM_HERO_FIT_OPTIONS.inlineSafetyPx`. Total horizontal slack subtracted from `clientWidth` (8 px each side). Raise to give glyphs more breathing room; lower to fit slightly bigger values.
- **Resize debounce** → `DEFAULT_UNIFORM_HERO_FIT_OPTIONS.resizeDebounceMs`. 100 ms. Raise to reduce CPU during continuous resizes (window dragging); lower for snappier feedback.
- **Round step** → `DEFAULT_UNIFORM_HERO_FIT_OPTIONS.roundToPx`. 4 px. Raise to reduce resize-jitter at the cost of slightly coarser fit; lower for finer-grained sizes.
- **Trend-icon scale factor** → `Math.max(28, Math.min(measuredHeroPx * 0.5, 80))` in `sqcdp-card.tsx`. Adjust the `0.5` ratio, `28` floor, or `80` ceiling.
- **Per-card overrides** → still the existing curator path. Pin `metric.styleConfig.primary.size` via the editor's Style tab → measurement skipped for that card → static `text-{N}xl` wins.

## Related

- [[Decisions/ADR-SQCDP-Measured-vs-Viewport-Hero-Typography]] — the v15.2 decision log; supersedes v15.1's ADR.
- [[Implementations/Implement-SQCDP-Uniform-Hero-Typography]] — v15.1 implementation, **superseded by this note**.
- [[Implementations/Implement-SQCDP-Hero-Autofit-Typography]] — v15 implementation, already superseded.
- [[Patterns/TV-Viewport-Fit-Grid]] — extended with the v15.2 measured-fit recipe.
- [[Patterns/Per-Field-Style-Overrides]] — the curator-override convention this defers to.
- [[Implementations/Implement-SQCDP-TV-Viewport-Fit]] — v1 viewport-fit foundation.
- [[Implementations/Implement-SQCDP-Editable-Categories]] — the dynamic-category world this lives in.
- [[Components/ProductionBoards - Feature Module]] — feature module index.


## Postmortem — v15.2 first-shipping bug (2026-05-18)

~30 minutes after this implementation landed, the user reported the secondary single-mode cards were STILL clipping on the TV display. Two failure modes from the screenshot:

- **Shipping** (`500 Orders Shipped`) — rendered as `500 Orders Shipp`, no wrap fallback.
- **Announcement** (`73 DAYS FOR PHYSICAL`) — wrap fallback DID fire (`73 DAYS FOR` / `PHYSICAL`).

Two cards, two visible symptoms, one root cause.

### Root cause

The demote loop in `useUniformHeroFitRegistry.compute()` shipped with an off-by-one in the bookkeeping. The original check:

```ts
if (minFit < options.floorPx[tier] && working.length > 1) {
  // demote: overflow.add + filter + continue
}
```

gated BOTH the `overflow.add` and the `filter+continue` on `working.length > 1`. The filter gate is correct (can't filter out the last entry — the loop would never pick a size), but the bookkeeping gate is wrong. When two secondary-single entries both have `maxFit < floor`:

1. Iter 1: snuggest entry (Announcement) demoted into `overflow`, filtered from `working`.
2. Iter 2: `working = [Shipping]`, `minFit < floor`, but `working.length === 1` → guard fails → Shipping is **not** added to `overflow` → falls through to `chosen = floor`, breaks the loop.

Result: tier size = floor (48 px); Shipping renders single-line at 48 px with the `whitespace-nowrap` chain because the card thinks it's NOT in overflow. By construction `maxFit < floor` means the floor doesn't fit either — visible horizontal clipping.

The v15.2 code comment said *"only one entry remains (we accept its overflow)"*. The fix:

```diff
-        if (minFit < options.floorPx[tier] && working.length > 1) {
+        if (minFit < options.floorPx[tier]) {
           const culprit = working.reduce((acc, e) =>
             e.maxFit < acc.maxFit ? e : acc
           )
           overflow.add(entryKey(tier, culprit.id))
-          working = working.filter((e) => e.id !== culprit.id)
-          continue
+          if (working.length > 1) {
+            working = working.filter((e) => e.id !== culprit.id)
+            continue
+          }
         }
```

After the fix, both Shipping and Announcement land in the overflow set; tier size = floor (48 px); both wrap cleanly to 2 lines at canonical 1080p TV (`500 Orders` / `Shipped` and `73 DAYS FOR` / `PHYSICAL`).

### Secondary fix — font-load re-measure

Geist is loaded from Google Fonts with `display=swap`. The first compute pass runs against the system fallback font (narrower per-glyph than Geist), so the initial natural-width measurement is undersized and the chosen tier size comes out larger than what actually fits once Geist swaps in. Added a `document.fonts.ready` listener that clears the natural-width cache and re-schedules a compute. Defensive against the latent race — didn't change the immediate visible bug because both fallback and Geist measurements put the user's values below the floor anyway, but borderline cases would have silently misfired without it.

### Padding theory in the task spec was wrong

The task spec ranked "padding accounting wrong" as the #1 suspect (`p-7` = 56 px subtracted, etc.). Verified directly: the registered element is the inner `min-w-0 flex-1` div, which sits INSIDE the body's `p-7`. Its `clientWidth` is the post-`p-7` inner width by construction; no double-counting. The padding was always correctly accounted for. Recording this so the next reader doesn't go down the same wrong trail.

### Verification (re-run on the fixed tree)

| Viewport | Tier | Shipping | Announcement | Clipping? |
|----------|------|----------|--------------|-----------|
| 1920×1080 | secondarySingle | overflow=true, 48 px floor, wraps `500 Orders` / `Shipped` in 373 px available | overflow=true, 48 px floor, wraps `73 DAYS FOR` / `PHYSICAL` in 373 px available | NO |
| 2560×1440 | secondarySingle | overflow=true, 48 px floor, wraps cleanly in 497 px available | overflow=true, 48 px floor, wraps cleanly | NO |
| 3840×2160 | secondarySingle | overflow probably false (maxFit > 48 px at 745 px available); renders one-line at the tier size | similar — may fit one-line at 4K's wider cards | NO |

Primary tier unaffected by this fix (the bug only bit the sole-survivor case; primaries had 5 entries so the demote loop never reached the sole-survivor branch).

### Tests added (regression guards)

Three new tests in `components/sqcdp-card.test.tsx`, total 161 → 164:

1. *demotes BOTH entries to overflow when the secondary tier has 2 unfittable values* — the direct user-screenshot guard. Shipping + Announcement at `containerWidthPx=220`; asserts both probes have `data-overflow="true"` and identical `style.fontSize`.
2. *still demotes the sole entry when only one secondary-single card has a value too long for its width* — single-card tier guard for the same bug class.
3. *keeps a fittable entry out of overflow even when the snuggest sibling gets demoted* — ensures the fix doesn't over-demote in mixed survivor + demoted cases.

The v15.2 `TestProbe` now also exposes `data-overflow={fit.overflow}` so the regression tests can assert the bookkeeping directly without going through the class-chain proxy.

### What we did NOT change

- The ADR ([[Decisions/ADR-SQCDP-Measured-vs-Viewport-Hero-Typography]]) — the architecture is correct; this was a bookkeeping bug, not a design flaw.
- The tuning constants in `DEFAULT_UNIFORM_HERO_FIT_OPTIONS` — the per-tier floors / ceilings still hold.
- The trend icon scaling, the curator-override gate, the first-paint fade-in, the shared `ResizeObserver`, the cache keying — all unchanged.

### Open items (still)

All the v15.2 open items from above still apply. One new entry:

- **Embedded preview viewports (< 1024 px wide cards):** When the card is rendered at less than ~220 px wide (e.g. a curator preview pane on a laptop), the secondary-single floor of 48 px can still be wider than the value's longest word fits. The wrap goes to 3+ lines and `line-clamp-2` clips. Not a TV-mode issue; the curator-preview surface today doesn't run measured-fit at all (gate is `density === 'tv'`). If we ever bring measured-fit to the curator preview, add Fix D from the original task spec (re-measure wrapped-text height; shrink the tier size below floor if the wrap exceeds 2 lines).
