---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-17
---

# TV Viewport Fit Grid

## Purpose / Context

Reusable layout recipe for **TV-display boards** that must fit the entire surface in a single viewport snapshot — no scroll, no dead space below the content, no oversized internal reservations that float values mid-card.

First surfaced from the 2026-05-17 SQCDP TV-mode polish (see [[Implement-SQCDP-TV-Viewport-Fit]]). The complaint that crystallised the recipe:

> When displaying SQCDP on a TV, the top of each card has tons of empty space — it goes down to about where it says "848 Days" for the safety record. The cards should size naturally with the TV so the whole page shows in a single snapshot.

Use this when:

- A board renders inside [[TvFrame]]'s `<main class="flex-1">` (or any equivalent viewport-sized parent).
- The board has two (or more) tiers of cards that should each take a deterministic share of the vertical budget.
- Values inside the cards historically used a fixed `min-h-[…]` reserve to baseline-align across a row, and that reserve is now visible as dead space at TV scale.

Do NOT use this when:

- The board genuinely overflows even at full TV viewport height (e.g. a 50-row × 13-col grid — those should keep `overflow-auto` and rely on tab/area rotation instead, see [[Cinematic-Tab-Rotation]]).
- The page is rendered in-app (non-TV) — keep the natural-height vertical rhythm; the recipe is TV-only.

## Recipe — three coordinated changes

```
┌─ TvFrame <main class="flex-1 overflow-auto p-10">  (already in place)
│  └─ Board grid wrapper       ← change 1: become column flex, h-full
│     ├─ Tier 1 (primary) row  ← change 2: flex-N weight, auto-rows-fr, min-h-0
│     └─ Tier 2 (secondary) row ← change 2: flex-M weight, auto-rows-fr, min-h-0
│        └─ Card body          ← change 3: drop hard min-h reserves, use flex-1
```

### Change 1 — Board grid wrapper fills the parent

```tsx
<div
  className={cn(
    isTv ? 'flex h-full flex-col gap-6' : 'space-y-4 lg:space-y-6'
  )}
>
  {/* primary row */}
  {/* secondary row */}
</div>
```

TV mode swaps the in-page `space-y-*` rhythm for a column-flex container that fills its parent (`h-full`). The `gap-6` replaces the static spacing — flex children can't use `space-y-*` reliably.

### Change 2 — Tier rows share the vertical budget with flex weights

```tsx
<motion.div  /* primary */
  className={cn(
    'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5',
    'gap-6',
    isTv && 'min-h-0 flex-5 auto-rows-fr',
  )}
>
  …
</motion.div>
<div  /* secondary */
  className={cn(
    'grid grid-cols-2 lg:grid-cols-4',
    'gap-5',
    isTv && 'min-h-0 flex-3 auto-rows-fr',
  )}
>
  …
</div>
```

Three concerns layered onto each row:

1. **`flex-N`** — the row's share of the column-flex parent's vertical budget. Pick weights that reflect each tier's content density: SQCDP uses `flex-5` for primary (it carries a chart strip) and `flex-3` for secondary (meta-only), giving a 5:3 split. Adjust based on what's inside each tier.
2. **`min-h-0`** — flex children default to `min-height: auto` (their content height). Without `min-h-0`, the row refuses to shrink and pushes past the viewport, defeating the whole point.
3. **`auto-rows-fr`** — the grid only has explicit columns (`grid-cols-X`), so all rows are implicit. `auto-rows-fr` (`grid-auto-rows: minmax(0, 1fr)`) makes the single grid row consume the row's allocated height instead of sizing to content. Paired with each card's `h-full` chain, every card in a row gets the same stretched height.

### Change 3 — Card bodies drop hard reserves, use flex-grow instead

The legacy pattern was to reserve a worst-case 2-line height (e.g. `min-h-[16rem]`) on the big-number block and bottom-anchor the value with `items-end`. That gave baseline alignment across the row — but at TV scale the reserve is huge and creates visible dead space above single-line values.

TV mode swaps the reserve for a flex-grow chain:

```tsx
// DENSITY.tv:
{
  body: 'flex flex-1 flex-col gap-4 p-7',
  primary: 'text-9xl font-black tabular-nums leading-none',
  primaryReserve: 'flex flex-1 items-end min-h-0',  // was 'min-h-[16rem] flex items-end'
}

// Inside the card JSX:
<div className={cn(
  'flex flex-col gap-1',
  density === 'tv' && 'min-h-0 flex-1',  // wrapper grows so its child's flex-1 has space
)}>
  <div className={cn(d.primary, d.primaryReserve, 'items-end gap-3')}>
    {value}
  </div>
  <div>{subtitle}</div>
  <div>{comparison}</div>
</div>
```

The baseline alignment now comes from the row itself (every card has the same stretched height via `auto-rows-fr`), not from a hardcoded reserve. The value bottom-anchors against whatever the body has available — small cards get a small reserve, tall cards get a tall reserve, all values still align across the row.

Apply the same flex-1 pass-through to any other content wrappers inside the body (e.g. the stacked sub-metrics container in SQCDP) so they fully consume the body's available space.

## Why each layer matters

| Layer | Without it | With it |
|---|---|---|
| Wrapper `flex h-full flex-col` | Grid renders at content height; empty space below | Grid fills viewport |
| Row `flex-N` | Rows size to content; ratios drift | Tier-appropriate vertical share |
| Row `min-h-0` | Rows refuse to shrink, push past viewport, scroll appears | Rows shrink-fit the parent |
| Row `auto-rows-fr` | Cells size to content within the row | Cells stretch to fill the row |
| Body wrapper `flex-1 min-h-0` | `flex-1` on the value collapses (no parent space to grow into) | Value gets the full body to grow within |
| Value `flex-1 items-end` | Value top-anchored, no baseline alignment | Bottom-anchored against the stretched row height — baseline aligned across the row |

Missing any single layer and the chain breaks. The most common failure is forgetting `min-h-0` on a flex child — flex's default `min-height: auto` is the silent culprit behind "why is my flex-1 element overflowing."

## Performance

Pure CSS — no JS resize observers, no `vh` math, no `useEffect` height-syncing. Browsers compose this in their normal layout pass.

## Don't

- **Don't** use viewport units (`100vh`, `100dvh`) inside the card chain to force height. The TvFrame already gives you a viewport-sized parent via its own flex layout — re-deriving from `vh` invites double-counting against the header/footer rows.
- **Don't** combine `min-h-[…]` reserves with `flex-1` in TV mode. The reserve wins (it's the larger of `min-h` and `flex-basis: 0`) and you're back to the dead-space problem.
- **Don't** drop `auto-rows-fr` thinking the grid's default `align-items: stretch` will do the work. Stretch only works if the row has a known height — and the row's default height IS content-height. `auto-rows-fr` is what gives the row a definite height to stretch into.
- **Don't** keep `space-y-*` on the wrapper after switching to `flex flex-col`. The TV-mode swap to `gap-*` is intentional.
- **Don't** apply this recipe to non-TV (in-app) rendering — the in-page surface lives inside a scrollable shell and the natural-height rhythm is correct there.

## Reusability

Applies to any board that already uses [[TvFrame]] and shows multiple tiers of cards:

- **SQCDP** (first adopter, 2026-05-17) — primary 5 cards with chart strip, secondary 4 cards meta-only, `flex-5` / `flex-3` split.
- Likely next: any future productivity / shift / scorecard board with 2+ tiers.

If a second board adopts and the layer chain is identical, promote the `isTv && 'min-h-0 flex-N auto-rows-fr'` token + the wrapper recipe to a shared `production-boards/lib/tv-fit.ts` helper (or, more likely, an `@utility` block in `src/index.css` that names the chain). Keep the per-feature flex weights — those are content-driven and shouldn't be globalised.

## Related

- [[Elevated-KPI-Stat-Cards]] — the SQCDP card's outer shell (Variant: Colored Header Scorecard), unchanged by this recipe.
- [[Cinematic-Tab-Rotation]] — when content genuinely doesn't fit even at full TV viewport, rotate slices instead of shrinking.
- [[Responsive-StatTile-And-KpiGrid]] — the in-app workhorse for KPI strips. Different problem (container-query fit-to-width), same principle (don't bake hard reserves that defeat the layout system).
- [[Implement-SQCDP-TV-Viewport-Fit]] — first application, full file diff.



## Dynamic counts (2026-05-17)

The original recipe assumed a fixed 5+3 SQCDP split (`flex-5` / `flex-3`). The 2026-05-17 [[Implement-SQCDP-Editable-Categories]] work made the category list per-org curator-editable, so both row counts (and therefore the flex-weight split) are now dynamic. The recipe still applies — the only change is that the per-tier `flex-N` class is computed at render time instead of hard-coded.

### `lib/grid-sizing.ts`

Helper module that owns the static class maps + the count → class resolver. Lives in its own file (not next to the React component) so unit tests can exercise it without mounting React, and so the `react-refresh/only-export-components` lint rule stays happy on `<SqcdpGrid>`.

```ts
// Tailwind v4 JIT can't see template-literal class strings
// (`flex-${n}` etc.). Enumerate every value the runtime might pick.
export const GRID_COLS_CLASS: Record<number, string> = {
  1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3',
  4: 'grid-cols-4', 5: 'grid-cols-5', 6: 'grid-cols-6',
}
export const FLEX_WEIGHT_CLASS: Record<number, string> = {
  1: 'flex-1', 2: 'flex-2', 3: 'flex-3', 4: 'flex-4',
  5: 'flex-5', 6: 'flex-6', 7: 'flex-7', 8: 'flex-8',
}
const MAX_COLS = 6
const MAX_FLEX = 8
```

### Resolver

```ts
export function resolveGridSizing(
  primaryCount: number,
  secondaryCount: number
): {
  primaryColsClass: string
  primaryFlexClass: string  // empty string when primaryCount === 0
  secondaryColsClass: string
  secondaryFlexClass: string  // empty string when secondaryCount === 0
}
```

Key choices:

- **Primary tier flex weight = `Math.ceil(count * 1.5)`** — primaries carry the chart strip + a denser content area, so they deserve a larger share of the column-flex parent's vertical budget. With 5 primaries (canonical) the multiplier yields 8 (clamped at 8). With 3 primaries it yields 5; with 1 it yields 2. The multiplier is judgement-tuned to keep the canonical 5+4 layout visually identical to the pre-2026-05-17 5:3 ratio.
- **Secondary tier flex weight = `count`** — secondaries are meta-only, so they share the budget proportional to their count.
- **Clamps**: 6 columns max per tier (beyond that the cards crowd at 1080p TV); flex weights at 8. Beyond 6 categories per tier the row will wrap into a second grid row — the `auto-rows-fr` chain still gives every card the same stretched height, but glanceability degrades. Curators should split categories across primary / secondary instead of cramming a single tier with more than ~5 entries.
- **Empty tier returns `''` for the flex class** so the consumer can omit the row entirely (`{primary.length > 0 && (<div .../>)}`). Don't render an empty stripe — it eats vertical budget the populated tier could be using.

### Consumer shape

```tsx
const sizing = resolveGridSizing(primary.length, secondary.length)

{primary.length > 0 && (
  <div className={cn(
    'grid', sizing.primaryColsClass,
    isTv && 'min-h-0 auto-rows-fr',
    isTv && sizing.primaryFlexClass,
  )}>
    {primary.map((cat) => <SqcdpCard ... />)}
  </div>
)}
{secondary.length > 0 && (
  <div className={cn(
    'grid', sizing.secondaryColsClass,
    isTv && 'min-h-0 auto-rows-fr',
    isTv && sizing.secondaryFlexClass,
  )}>
    {secondary.map((cat) => <SqcdpCard ... />)}
  </div>
)}
```

The rest of the chain (`flex h-full flex-col gap-6` on the wrapper, `auto-rows-fr` + `min-h-0` on the row, `flex-1 items-end` on the card body) is unchanged from the original recipe.

### Don't (added)

- **Don't ship a single canonical clamp number for either dimension** — the maxima are tuned to a 1080p TV viewport. If you find yourself at the clamp (6 cols / flex-8) frequently, that's a strong signal the curator has packed too many categories into one tier; surface a UX nudge or split into a second TV view rather than relaxing the clamp.
- **Don't compose flex weights as `flex-[N]` arbitrary values** — the JIT can sometimes resolve them but ESLint + Tailwind cache eviction make them flaky. Stick to the static map and add a new entry if you genuinely need it (a future redesign with per-tier-row tuning, say).
- **Don't tier-mix at the row level** — the recipe assumes one tier per row. If a future board needs an n×m grid that spans both tiers (e.g. 9 categories laid out 3×3 with no tier distinction), build that separately rather than trying to fold it into this recipe.

### Related

- [[Implementations/Implement-SQCDP-Editable-Categories]] — first application of the dynamic-count variant.
- [[Decisions/ADR-SQCDP-Category-Schema]] — the schema decision that drove the need for dynamic row counts.
- [[Patterns/Per-Field-Style-Overrides]] — the canonical static-class-map convention reused here.



## Auto-fit hero typography (2026-05-17) — SUPERSEDED by v15.1 below

> **Status: superseded same day by the v15.1 uniform-fluid recipe in
> the next section.** The cqh-based per-card auto-fit produced
> visibly inconsistent glyph sizes across siblings on a 1080p TV
> review — each card scaled to its OWN value-block height, which
> differs by content/wrap/trend-arrow presence. Container queries are
> the wrong tool for cross-component uniformity. Decision log:
> [[Decisions/ADR-SQCDP-Uniform-vs-AutoFit-Typography]]. The v15
> recipe is preserved verbatim below for the historical record; new
> work should follow the v15.1 recipe instead.

The viewport-fit recipe gives each card the row-stretched height. But a static `text-{N}xl` token on the hero number is a constant — it doesn't grow with the now-much-taller card. Result: short single-line values float in the upper portion of a tall card with cosmetic dead space below. The fix is to let the typography itself respond to the container's resolved height.

The pattern: **CSS container queries (`cqh`) plus a `clamp()` font-size on the hero number**, gated on TV density and on the curator NOT having pinned a size override.

Surfaced from [[Implementations/Implement-SQCDP-Hero-Autofit-Typography]] (v15).

### Recipe

1. **Establish the container query boundary.** Inline-style the value's parent wrapper with `containerType: 'size'`:

   ```tsx
   const TV_AUTOFIT_CONTAINER_STYLE: CSSProperties = {
     containerType: 'size',
     containerName: 'sqcdp-value',
   }

   <div className='flex flex-col gap-1 min-h-0 flex-1'
        style={isTv && noOverride ? TV_AUTOFIT_CONTAINER_STYLE : undefined}>
     {/* value div, subtitle, comparison */}
   </div>
   ```

   `container-type: size` (NOT `inline-size`) is required — only `size` exposes `cqh` (block-axis 1%). Inline-size only exposes `cqi` / `cqw`.

2. **Pre-compute the clamp class as a static literal.** Tailwind v4's JIT cannot see template-composed strings (`text-[clamp(${min}cqh,${preferred}cqh,${max}cqh)]`); it MUST see the literal in source. Same gotcha as [[Per-Field-Style-Overrides]].

   ```ts
   const TV_AUTOFIT_PRIMARY =
     'text-[clamp(6rem,28cqh,16rem)] leading-[0.95] overflow-hidden'
   const TV_AUTOFIT_SUB =
     'text-[clamp(3rem,30cqh,9rem)] leading-[1] overflow-hidden'
   ```

   Tune the **min** clamp to ≥ the previous static default so the change is a strict improvement at small viewports (no regression at 1080p). Tune the **max** clamp to roughly 2× the previous default so big TVs (4K, 5K) get meaningfully bigger numbers.

3. **Compose with curator overrides via twMerge.** Append the auto-fit class LAST in the `cn()` chain:

   ```tsx
   <div
     className={cn(
       d.primary,           // density baseline 'text-9xl ...'
       primaryClasses,      // curator merge, includes their `text-{N}xl`
       d.primaryReserve,
       'flex items-end gap-3',
       useAutoFitPrimary && TV_AUTOFIT_PRIMARY,  // ← appended last
     )}
   >
   ```

   When the curator HAS pinned a size, `useAutoFitPrimary` is `false`, the auto-fit class is omitted, and twMerge picks the curator's `text-{N}xl` as the last `text-*` size class. When they HAVEN'T pinned, the auto-fit class wins (it's appended last AND it's the same conflict group).

4. **Sub-metrics: per-block flex distribution.** The stacked-mode wrapper already has `flex-1 min-h-0` (from the v1 recipe). Add the same to each individual sub-metric block in TV density so 1 / 2 / 3 sub-metrics distribute the wrapper's height evenly:

   ```tsx
   <div
     className={cn(
       'flex flex-col gap-1',
       showDivider && 'border-border/30 mt-2 border-t pt-2',
       density === 'tv' && 'min-h-0 flex-1',  // NEW — distribute the wrapper height
     )}
     style={useAutoFit ? TV_AUTOFIT_CONTAINER_STYLE : undefined}
   >
     {/* title, value (with auto-fit), subtitle */}
   </div>
   ```

   Combined with each block's own `container-type: size`, the value text scales proportionally — fewer sub-metrics → bigger blocks → bigger numbers. With 3 sub-metrics each block is ~1/3 the wrapper, value scales to ~1/3 the size of a single-block layout.

5. **Optionally scale the trend arrow via `cqh` too.** The trend indicator looks weird at constant size next to a hero number that scaled 3× from its baseline. Pin min/max so it stays visible on tiny viewports and doesn't balloon past the card on huge ones:

   ```ts
   const TV_AUTOFIT_TREND_ICON =
     'h-[20cqh] w-[20cqh] min-h-[2.5rem] min-w-[2.5rem] max-h-[5rem] max-w-[5rem]'
   ```

### Why each layer matters (auto-fit)

| Layer | Without it | With it |
|---|---|---|
| `containerType: size` on wrapper | `cqh` doesn't resolve; `text-[clamp(...)]` falls through to ... well, Chrome falls back to `0px` and the text disappears | `cqh` = 1% of wrapper height; clamp resolves correctly |
| `clamp(min, preferred, max)` (not bare cqh) | Text shrinks to `0px` on collapsed cards; explodes to absurd sizes on huge ones | Always between sensible bounds |
| Auto-fit class appended LAST in `cn()` | twMerge dedup picks an earlier `text-*` and the auto-fit is silently a no-op | Auto-fit wins when its gate is true |
| Auto-fit gate `density === 'tv' && !styleConfig.primary?.size` | Either applies in normal density (wrong) or fights curator pins (wrong) | Only applies when the curator wants the default + we're on TV |
| Per-block `flex-1 min-h-0` on stacked sub-metrics | Blocks size to content; dead space at bottom of wrapper for short stacks | Blocks distribute wrapper height evenly |
| Static class literal (not template-composed) | Tailwind v4 JIT can't see the class; it's not in the build CSS; nothing happens at runtime | JIT scans the literal, emits the rule, runtime works |

### Recharts coexistence

The chart strip MUST live OUTSIDE the container-query boundary. Standard SQCDP card geometry already has this:

```tsx
<CardSurface>
  <div className={d.header}>...</div>
  <div className={d.body}>
    <div style={containerType: 'size'}>...{/* value lives here */}</div>
    <div className='mt-auto'>...{/* meta row */}</div>
  </div>
  {isPrimary && <div className={d.chartStrip}><SqcdpChart .../></div>}
</CardSurface>
```

`<ResponsiveContainer>` inside `<SqcdpChart>` is OUTSIDE the body wrapper and is therefore not affected by the new size containment. It uses its own `ResizeObserver` against its own parent. No conflict.

If a future card variant ever puts the chart INSIDE the container-query boundary, `<ResponsiveContainer>` will see the wrapper's containment-block size — for `inline-size` containment that's fine, for `size` containment Recharts may behave oddly because it'd be reading a container that's intentionally decoupled from its content. Don't put the chart inside the boundary unless you've verified it works.

### Don't

- **Don't use `inline-size` containment.** It only exposes `cqi` / `cqw` (width-based). Auto-fit is a height-based recipe; `cqh` requires `size` containment.
- **Don't compose the clamp class via template literals.** `text-[clamp(${min}rem,${cqh}cqh,${max}rem)]` is invisible to Tailwind v4's JIT. Listing static literals at module scope is the canonical workaround (see [[Per-Field-Style-Overrides]]).
- **Don't make the min clamp smaller than the previous static default.** That's a regression at small viewports — short cards would render text smaller than they did before. Tune the min ≥ the previous default.
- **Don't auto-fit normal (in-page) density.** The in-page rhythm is content-driven and intentional. Gate strictly on `density === 'tv'`.
- **Don't put the container on the value div itself.** The value's font-size depends on `cqh`; if the value div IS the container, you create a circular dependency. Container queries are designed to break this (size containment severs the content→size feedback) but it's clearer to put the container on a parent and let the value stay a regular flex item.
- **Don't fight curator pins.** When `styleConfig.primary.size` is set, the curator has explicitly opted out — defer. Surface this in the editor with a tiny inline hint so curators understand why their pin behaves differently from "no override".
- **Don't forget the `overflow: hidden` safety net.** A pathological 3-line wrap (e.g. very long currency-prefixed value on a narrow tier) at the auto-fit minimum could leak out the bottom and shove the chart strip off-screen. `overflow: hidden` on the value div clips gracefully without breaking layout.

### Reusability

Likely next adopters:

- **Hourly board's KPI strip** (`<BoardMetrics>`) — same TV-density problem if a board's tier weights ever leave dead space.
- **Customer-portal landing tiles** (when admins customize the layout to fit a TV in a customer's lobby).
- Any board that already follows [[TV-Viewport-Fit-Grid]] and then ships a hero metric with a fixed `text-{N}xl` — promote the constants to `production-boards/lib/tv-fit.ts` once a second consumer lands.

### Reference

- [[Implementations/Implement-SQCDP-Hero-Autofit-Typography]] — first application; visual QA matrix with computed sizes; full diff.



## v15.1 — Uniform fluid typography (2026-05-17, supersedes the v15 cqh recipe) — SUPERSEDED by v15.2 below

> **Status: superseded same day by the v15.2 measured-fit recipe further below.** The `vh` clamp picked the SAME px in every card but had no width awareness; the user reported overflow on the TV display (`99.7%` clipped, `848 Days` + `35 QNs` wrapped to 2 lines). Decision log: [[Decisions/ADR-SQCDP-Measured-vs-Viewport-Hero-Typography]]. The v15.1 recipe is kept verbatim below; new work should follow the v15.2 measured-fit recipe further down this page.


Same-day follow-on to v15. The cqh-based recipe scales each card to its OWN value-block container height, which produces visibly inconsistent glyph sizes across siblings on a TV — each card's `cqh` resolves to a different value because per-card content (text length, wrap, comparison subtext, trend-arrow presence) drives different wrapper heights. The user's "pure consistency" requirement (verbatim quote captured in [[ADR-SQCDP-Uniform-vs-AutoFit-Typography]]) means container queries are the wrong tool — they're designed for per-component responsiveness, but here we want the OPPOSITE: cross-component uniformity that still scales with screen size.

The pattern: **viewport-relative `vh` + a `clamp()` font-size**, gated on TV density and on the curator NOT having pinned a size override. Same gate, same composition rule, same JIT-safe static-literal convention. Different unit.

Surfaced from [[Implementations/Implement-SQCDP-Uniform-Hero-Typography]] (v15.1).

### Recipe

1. **Pre-compute the clamp class as a static literal** (same JIT gotcha as v15):

   ```ts
   const TV_UNIFORM_PRIMARY =
     'text-[clamp(4.5rem,10.5vh,12rem)] leading-[0.95] overflow-hidden'
   const TV_UNIFORM_SUB =
     'text-[clamp(2.25rem,5.5vh,5.5rem)] leading-[1] overflow-hidden'
   const TV_UNIFORM_TREND_ICON =
     'h-[7vh] w-[7vh] min-h-[2rem] min-w-[2rem] max-h-[4.5rem] max-w-[4.5rem]'
   ```

2. **Drop the `containerType: 'size'` boundary.** vh resolves against the viewport — there's no per-card container needed. Less code, no Recharts coexistence concerns at a containment boundary, no `inline-size` vs `size` decision to make.

3. **Compose with curator overrides via twMerge** (unchanged from v15):

   ```tsx
   <div
     className={cn(
       d.primary,           // density baseline 'text-9xl ...'
       primaryClasses,      // curator merge, includes their `text-{N}xl`
       d.primaryReserve,
       'flex items-end gap-3',
       useUniformPrimary && TV_UNIFORM_PRIMARY,  // ← appended last
     )}
   >
   ```

4. **Sub-metrics still get per-block `flex-1 min-h-0` in TV** — that's a layout concern (so 1/2/3 stacks distribute the wrapper height evenly) and survives the typography model change. The vh-based clamp resolves uniformly across all blocks regardless of per-block height.

5. **Trend arrow scaled by `vh` with rem floor/ceiling pins.** 7vh = 75.6 px on 1080p, capped at 4.5rem (72 px); 32 px floor on small previews. Pairs with the hero clamp so the arrow tracks the hero scale up to the cap.

### Why each layer matters (uniform fluid)

| Layer | Without it | With it |
|---|---|---|
| Static class literal | Tailwind v4 JIT can't see template-composed strings; nothing happens at runtime | JIT scans the literal, emits the rule, runtime works |
| `vh` (not `cqh`) | Each card sees its own per-block resolved height; siblings drift | Every card on a viewport sees the same value; siblings render uniformly |
| `clamp(min, preferred, max)` (not bare vh) | Unreadable on small embedded previews; comically large on 8K | Always between sensible bounds |
| Floor ≥ previous default | Small-viewport regression vs the static `text-7xl` baseline | Strict improvement at every viewport size |
| Ceiling tighter than v15 | Every card hits the max on 4K (uniform sizing means EVERY card reaches it, vs. v15 where only some did) | Ceiling chosen for "every card at this size feels right," not "biggest possible card" |
| Auto-fit class appended LAST in `cn()` | twMerge dedup picks an earlier `text-*` and uniform sizing is silently a no-op | Uniform class wins when its gate is true |
| Auto-fit gate `density === 'tv' && !styleConfig.primary?.size` | Either applies in normal density (wrong) or fights curator pins (wrong) | Only applies when the curator wants the default + we're on TV |
| `overflow: hidden` safety net | Pathological 3-line wraps could shove the chart strip off-screen | Clips gracefully without breaking layout |

### Visual QA matrix

| Viewport | 1 vh | Primary clamp picks | Sub-metric clamp picks | Trend icon clamp picks |
|----------|------|---------------------|------------------------|------------------------|
| 1024×768 (small preview) | 7.68 | 80 px (preferred) | 42 px (preferred) | 54 px (preferred) |
| 1920×1080 (canonical TV) | 10.80 | 113 px (preferred) | 59 px (preferred) | 72 px (max wins) |
| 2560×1440 (1440p) | 14.40 | 151 px (preferred) | 79 px (preferred) | 72 px (max wins) |
| 3840×2160 (4K TV) | 21.60 | 192 px (max wins) | 88 px (max wins) | 72 px (max wins) |

On 1080p, all five primary cards (whatever their value content — short, long, wrapping, with/without trend arrow) render their hero number at 113 px. That's the exact deliverable from the user's "pure consistency" ask.

### Don't (uniform fluid)

- **Don't re-introduce `cqh`** unless the requirement genuinely flips back to "each card auto-fits to its own height." The user explicitly preferred consistency — leaving the same one-line reference to the user's quote in `sqcdp-card.tsx`'s docblock so future readers don't quietly flip it back.
- **Don't add `whitespace-nowrap`** to fight wrapping. "848 Days" wrapping to 2 lines is GOOD content preservation. Forcing nowrap either truncates or shrinks-to-fit per-card, both of which re-introduce the inconsistency.
- **Don't use bare vh without clamp.** Same reason as bare cqh — unreadable on small embedded previews, comically large on 8K.
- **Don't put the cap on the hero too tight.** With uniform sizing every card reaches the max, so the cap should feel right at "every card this size on a 4K wall," not "biggest possible card."
- **Don't compose the clamp via template literals.** `text-[clamp(${a}rem,${b}vh,${c}rem)]` is invisible to Tailwind v4's JIT.

### Reference

- [[Implementations/Implement-SQCDP-Uniform-Hero-Typography]] — full implementation log + visual QA matrix + tests.
- [[Decisions/ADR-SQCDP-Uniform-vs-AutoFit-Typography]] — vh vs cqh + four alternatives considered (cqw, JS measurement hook, fixed vh, subgrid).



## v15.2 — Measured uniform hero typography (2026-05-17, supersedes v15 cqh + v15.1 vh)

Second same-day revision to the hero typography. Both prior CSS-only recipes (v15 `cqh` and v15.1 `vh`) failed on the user's TV display:

- **v15 (cqh) was rejected** because per-card content drove different container heights → siblings drifted visibly. Container queries are designed for per-component responsiveness; cross-component uniformity is the wrong job for them.
- **v15.1 (vh) was rejected** because the chosen size had no width awareness. Every card resolved the same px, but longer values ("99.7%", "73 DAYS FOR PHYSICAL") overflowed their cards. Pure-CSS approaches can't deliver "every card the same px AND no card overflows" without measuring what actually fits.

The pattern: **JS measurement via a hook + provider with three independent per-tier registries.** Each tier (`primary`, `sub`, `secondarySingle`) computes its own uniform px from `min(maxFit across tier)`, clamped by viewport ceiling + tier floor, with an overflow fallback for unfittable entries (relax to `whitespace-normal` + `line-clamp-2`, pick tier size from survivors).

Surfaced from [[Implementations/Implement-SQCDP-Measured-Hero-Typography]] (v15.2).

### Lessons from v15 → v15.1 → v15.2

The progression here is a clean case study in **knowing when to leave pure-CSS behind**. Don't repeat it on adjacent surfaces:

- If your requirement is "uniform across siblings AND fits", CSS units alone cannot deliver both at once. `cqh` is per-container. `vh` is per-viewport but width-blind. There's no CSS unit that knows about sibling widths AND the text content's natural width.
- The CSS-only attempts feel cheap but burn equal effort to a measured-fit hook, and the third iteration is the one that actually ships. If you find yourself in v15.x territory with a third user-reported problem, the prior agent's "hold the measurement hook in reserve" line is the trigger to act.
- Curator overrides MUST defer through every iteration. The `density === 'tv' && !styleConfig.primary?.size` gate is the canonical "don't fight the pinned size" check; preserve it identically through any future revision.

### Recipe

1. **Three independent tier registries.** Define a `HeroTier` union with one variant per visually-distinct content class. SQCDP uses `primary` / `sub` / `secondarySingle`. Each tier picks its own uniform size from its own entries so a long entry in tier B can't drag tier A down.

   ```ts
   export type HeroTier = 'primary' | 'sub' | 'secondarySingle'
   ```

2. **Provider at the surface root, hook in each card.** The provider owns the per-tier registries + the shared `ResizeObserver` + the debounced resize listener + the RAF-collapsed recompute scheduler. The hook returns a ref callback + an inline `style` block + an `overflow` flag (for the unfittable case) + a `ready` flag (for the first-paint fade-in).

   ```tsx
   <SqcdpHeroFitProvider enabled={density === 'tv'}>
     <SqcdpGrid metrics={metrics} density='tv' />
   </SqcdpHeroFitProvider>
   ```

3. **Compute pipeline**: per tier, measure each entry's natural one-line width at a known reference px (100), compute `maxFit = (clientWidth - safetyPx) / naturalWidth * refPx`, take `min` across the tier, clamp by viewport ceiling (`vh`), floor at the tier's lower bound, round to nearest 4 px. If the snuggest entry's `maxFit < floorPx[tier]`, demote it (it'll render with `line-clamp-2`) and recompute on the survivors.

4. **Measurement uses a hidden cloned span** inheriting the live element's `font-family` / `font-weight` / `font-style` / `letter-spacing` / `text-transform` at the reference font-size. Result cached by `(text, font properties, refPx)` so resize ticks don't re-measure when nothing changed. Append to `document.body` with `position: absolute; visibility: hidden; white-space: nowrap`, read `getBoundingClientRect().width`, remove.

5. **Registered element must be the value text wrapper, not the outer flex row.** Cards with a trend icon (or any sibling that takes width) need a `min-w-0 flex-1` wrapper around just the value text. Its `clientWidth` is the actual available space for the value text after the sibling icon takes its natural width. Without this wrapping, the measurement overestimates available width and the chosen px overflows.

   ```tsx
   <div className='flex items-end gap-3'>
     <div ref={fit.ref} className='min-w-0 flex-1'>{value}</div>
     {trendEnabled && <Icon style={{ width: iconPx, height: iconPx }} />}
   </div>
   ```

6. **Trend icon scales from the measured hero px** rather than carrying its own CSS clamp. `iconPx = clamp(28, heroPx * 0.5, 80)` keeps the arrow visually tracking the hero across viewports.

7. **Stable ref callback** — the hook stashes `ctx` / `tier` / `id` / `text` / `localEnabled` in refs and reads them inside the ref body. Without this, the context value's identity change on every state update would tear the ref down + re-attach + re-register, causing spurious ResizeObserver churn.

8. **First-paint fade-in**: render with `opacity-0` until the tier produces its first measurement (`fit.ready`), then `opacity-100`. Gate with `motion-safe:transition-opacity duration-150` so reduced-motion preference is honored. Single RAF tick of invisibility, ~16 ms total, no visible flash.

9. **Curator override defers** via `enabled: false` on the hook. Registration is a no-op, inline `fontSize` stays unset, the static `text-{N}xl` from `primaryClasses` survives.

### Tuning surface

All the knobs live in one named module-level constant so future tuning has a single home:

```ts
export const DEFAULT_UNIFORM_HERO_FIT_OPTIONS = {
  viewportCeilingVh: { primary: 11, sub: 6, secondarySingle: 9 },
  floorPx: { primary: 56, sub: 32, secondarySingle: 48 },
  initialPx: { primary: 128, sub: 56, secondarySingle: 96 },
  inlineSafetyPx: 16,
  roundToPx: 4,
  resizeDebounceMs: 100,
  referenceFontPx: 100,
}
```

### Why each layer matters (measured)

| Layer | Without it | With it |
|---|---|---|
| Per-tier registries | One global size — long secondary values drag the primary tier down | Tiers compute independently; SQCDP's secondary single-mode "500 Orders" + "73 DAYS FOR PHYSICAL" can't pull the primary 5-card tier into their fit |
| Stable ref callback | Context state updates churn the ref → spurious unregister/register cycles | Single registration per element, stable across recomputes |
| `min-w-0 flex-1` wrapper around the value text | Measurement reads the outer flex row's `clientWidth` → overestimates by the trend icon's width → chosen px overflows | Measurement reads the actual available space for the value text |
| Shared `ResizeObserver` | One observer per registered element → dozens of observers for a typical SQCDP board | Single observer for all elements; cheap recompute trigger |
| Debounced window resize | Recompute fires on every pixel-level resize during a drag → 100s of RAF + measure cycles | One recompute per 100 ms of resize stability |
| Natural-width cache | Every recompute re-measures every entry → expensive on cards with many sub-metrics | Cache keyed by `(text, font properties)`; measure once per unique text/font combo |
| Overflow fallback | An unfittable entry forces the tier below its floor → every card unreadably small | Snuggest entry demoted to 2-line wrap; tier picks size from survivors |
| `opacity-0` until ready | First paint shows initial-px fallback, then snaps to measured — visible flash | Invisible first frame, then measured render fades in |
| Curator-override gate | Measured fit fights the curator's pinned `text-{N}xl` | Pinned size always wins; measurement skipped entirely |

### Don't (measured)

- **Don't put the ref on the outer flex row** when the row has siblings (trend icon) that take width. The measurement will overestimate and the chosen px will overflow.
- **Don't re-introduce per-element CSS clamps** alongside the inline `style.fontSize`. Inline style + CSS `clamp()` interact unintuitively across browsers; pick one channel and stick with it.
- **Don't share a tier across visually-distinct content classes**. SQCDP's split (primary chart-strip / sub-metric / secondary single) is the right granularity. Adding a 4th category (e.g. "large numbers only") would split the registry further.
- **Don't synchronously call `compute()` from `register()`** — multiple registrations in the same React tick would compute N times. Schedule via RAF and collapse.
- **Don't read `ctx.state.sizes[tier]` from the ref callback** — it would freeze the size at the value the ref captured. Read live from the hook return so the component re-renders on size updates.
- **Don't forget to unregister on unmount**. Cards can be removed (category hidden, metric deleted) and stale entries would skew the tier-wide min forever.
- **Don't compose the measured class chain via template literals** — same Tailwind v4 JIT gotcha as the static-class convention in [[Patterns/Per-Field-Style-Overrides]]. Use literal class strings only.
- **Don't fight curator pins**. Skip registration entirely when `metric.styleConfig.primary.size` is set so the curator's `text-{N}xl` chain stays in control.
- **Don't terminate the demote loop without bookkeeping the sole survivor.** When a tier's iterative demote loop has reduced `working` to one entry whose `maxFit` is STILL below the floor, that entry has to be added to the `overflow` set even though it can't be filtered out (filtering would leave the loop with no candidates to size against). The v15.2 ship gated both the `overflow.add` and the `filter+continue` on `working.length > 1` and silently shipped the bug — the sole survivor stayed in nowrap mode at the floor and overflowed the card horizontally. Cost the user 30 minutes of confused TV viewing. Gate only the filter+continue on `working.length > 1`; let the `overflow.add` fire unconditionally. See the postmortem in [[Implementations/Implement-SQCDP-Measured-Hero-Typography#postmortem-v152-first-shipping-bug-2026-05-18]] for the full diff.
- **Don't trust pure-CSS approximations of "this size fits the 2-line wrap".** During the same-day postmortem we considered bounding the chosen tier size by `2 × maxFit` for demoted entries (the intuition: at twice the single-line fit size, the value's natural width fits in two lines' worth of card width). For multi-word values like `73 DAYS FOR PHYSICAL` this is wrong — greedy word-boundary wrapping breaks asymmetrically, so the chosen size pushed above floor would produce a 3-line wrap clipped by `line-clamp-2`. The floor is correct for the user's canonical values; bound from above only by per-entry single-line `maxFit` (for non-overflow entries) and the viewport ceiling (for everyone). If you ever need a tighter wrap fit, do an actual multi-line measurement rather than a `2 × maxFit` shortcut.
- **Don't measure naturalWidth without re-measuring after `document.fonts.ready`.** Google Fonts with `display=swap` paints text in the system fallback first, then swaps to the loaded font. The hook's first compute pass picks up the fallback's natural width — narrower per glyph for sans-serif fallbacks vs. Geist — and the chosen tier size comes out larger than what actually fits once Geist swaps in. The post-2026-05-18 fix wires a `document.fonts.ready` listener that clears the natural-width cache and re-schedules a compute. Cheap defensive measure; mandatory if your display font isn't preloaded.

### Reference

- [[Implementations/Implement-SQCDP-Measured-Hero-Typography]] — full implementation log + visual QA matrix + tests + canonical tuning handles.
- [[Decisions/ADR-SQCDP-Measured-vs-Viewport-Hero-Typography]] — the v15.2 decision log; explains why the v15.1 "trigger to revisit" condition fired and how the JS-measurement approach addresses it without re-introducing the cross-component drift v15.1 fixed.
