---
tags: [type/decision, status/active, domain/frontend]
created: 2026-05-16
---

# ADR — Container Queries for Stat Tiles

## Status

Accepted (2026-05-16). Scoped initially to the two primitives `<StatTile>` and `<KpiGrid>`. The viewport-breakpoint system (`sm:` / `md:` / `lg:` / `xl:` / `2xl:`) remains the **primary** responsive system for everything else.

## Context

On 2026-05-16 the audit phase of the responsive resize sweep surfaced a clipping bug on `/apps/inventory` Inventory Counts: the "Variance 25074" KPI tile painted its value under the left rail at typical laptop widths. Screenshot attached to the parent plan.

The root cause was twofold:

1. **`min-w-0` was missing** through the flex chain wrapping the tile, so the `text-3xl` value pushed its container wider than the viewport.
2. **Typography did not step down for narrow tiles.** The tile used `text-3xl` at every viewport width, even when the tile itself was rendered into a 240-px sidebar slot.

(1) is a hygiene fix — added `min-w-0` to the new `<StatTile>` primitive and threaded it through the layout shells. (2) is the interesting question, and the subject of this ADR.

The Tailwind viewport breakpoints (`sm:` / `md:` / `lg:` / `xl:`) react to the **viewport width**, not the **tile's own width**. A tile in a 1280-px tab and a tile in a 240-px sidebar both see the same `lg:` breakpoint and pick the same `text-3xl` value class. That mismatch is structurally responsible for every "it looks fine on its own page but broken when embedded" KPI bug we've shipped in the last six months.

Container queries (`@container` + `@sm/...` / `@md/...` / `@xl/...`) react to the **container's** width. A `<StatTile>` with `@container/stat-tile` self-declared sees only its own box, regardless of where it's mounted. That's exactly the right unit of measurement for a primitive that's designed to be embedded anywhere.

## Decision

**Introduce `@container/stat-tile` and `@container/kpi-grid` as sanctioned container-query tokens.** Specifically:

- `<StatTile>` declares `@container/stat-tile` on its own root. Its typography (label size, value size, icon size, hint size) and internal padding step UP at `@sm/stat-tile` and `@md/stat-tile` and `@xl/stat-tile`, **not** at viewport breakpoints.
- `<KpiGrid>` declares `@container/kpi-grid` on its own root. Its column count steps from 1 → 2 → 3 → 4 (etc., capped by the `columns` prop) at `@xs/kpi-grid` → `@md/kpi-grid` → `@xl/kpi-grid` — again, not at viewport breakpoints.
- **Keep `sm:` / `md:` / `lg:` / `xl:` viewport breakpoints as the primary responsive system for everything else** — page layouts, sidebars, the main shell, feature shells, modal sizing (modal width tokens already use `min(100vw-2rem,Npx)` instead of viewport breakpoints, see [[ResponsiveDialog-Width-Tokens]]).
- New container-query tokens require a Pattern note + this ADR's "Sanctioned tokens" section to grow. No ad-hoc `@container/` names sprinkled across feature code.

Rationale: container queries are the right tool for **embeddable primitives**, not for top-level page layout. The page layout has exactly one container that matters — the viewport — and the viewport-breakpoint vocabulary maps onto it directly. Primitives, by contrast, are dropped into arbitrary parents and need to react to the parent they happen to land in.

### Sanctioned tokens (as of 2026-05-16)

| Token | Component | Steps | Used for |
|---|---|---|---|
| `@container/stat-tile` | `<StatTile>` | `@sm` `@md` `@xl` | Label / value / icon / hint typography + padding |
| `@container/kpi-grid` | `<KpiGrid>` | `@xs` `@sm` `@md` `@lg` `@xl` | Column count step-down |

## Consequences

### Positive

- **Embeddable primitives finally behave correctly.** A `<StatTile>` inside a sidebar shrinks; the same tile on a wide page expands. No more "looks fine on its own page" bugs.
- **Existing viewport-breakpoint code is unchanged.** This ADR is additive, not a replacement — `lg:grid-cols-3` etc. continue to work everywhere they're used today.
- **The shape generalises.** When a future primitive needs the same treatment (a `<ChartCard>` with axis label sizing, a `<ToolbarRow>` with overflow-menu thresholds), the precedent is set for adding `@container/chart-card` etc. and growing the table above.

### Negative / costs

- **Two responsive systems in the codebase.** Engineers have to learn when to reach for `@container/...` (inside a sanctioned primitive's own implementation) vs `sm:`/`md:` (everywhere else). Mitigated by the rule "only `<StatTile>` and `<KpiGrid>` declare container queries today; new ones require an ADR amendment."
- **Container-query syntax in Tailwind v4 is unfamiliar.** `@sm/stat-tile:text-xl` reads strangely on first encounter. Mitigated by the Pattern note ([[Responsive-StatTile-And-KpiGrid]]) which shows the syntax in context and the source file's inline JSDoc.

### Browser support

CSS container queries (`@container` + `container-type: inline-size`) are supported in:

- Chrome 105+ (Sep 2022)
- Safari 16+ (Sep 2022)
- Firefox 110+ (Feb 2023)

All three floors are *below* every browser OmniFrame currently targets:

- **PWA** — the install flow gates on Chrome/Edge/Safari current; users running below Chrome 105 / Safari 16 cannot install in the first place.
- **Capacitor iOS RF terminal** — the app ships against iOS 15+ via Capacitor 7, and iOS 15 ships Safari 15. **However**, the RF interface does *not* use `<StatTile>` or `<KpiGrid>` today; this primitive lives in the desktop / tablet web app, which runs against the system browser on modern devices. If we later use these primitives inside the RF Capacitor wrapper, we'll need to verify against the iOS 15 Safari floor (or bump the iOS deployment floor to 16).
- **Desktop OS browsers** — the support analytics for the OmniFrame deployment show 0% of sessions below Chrome 105 / Safari 16 / Firefox 110 in the last 30 days.

No polyfill is required; native support is universal across the deployed audience.

## Alternatives considered

### 1. Pure viewport breakpoints (status quo)

**What:** Keep `sm:`/`md:`/`lg:`/`xl:` everywhere, including inside `<StatTile>` and `<KpiGrid>`. Accept that the tile renders at the same typography regardless of where it's embedded.

**Why rejected:** Doesn't solve the bug. The whole point of the sweep is to make the primitive react to its container, not the viewport. Pure viewport breakpoints leave the "embedded in a sidebar" case structurally broken.

### 2. JS-driven `useResizeObserver`

**What:** Implement `useContainerWidth(ref)` (which we did, see `src/hooks/use-container-width.ts`) and branch on width inside `<StatTile>` to pick `text-lg` vs `text-3xl`.

**Why rejected as the primary mechanism:** A ResizeObserver subscription per tile means N observers for an N-tile KPI strip, plus a re-render every time the width crosses a threshold. CSS container queries fire at the engine level with no React reconciliation, no JS bookkeeping, no `useEffect` cleanup. They're strictly cheaper.

We DID keep `useContainerWidth` for the cases CSS genuinely cannot solve — Recharts (the chart cannot read its own container in CSS, it needs a numeric `width` prop), virtualised lists where the column count drives data structures, and JS-driven truncation rulers. That's the role documented in the hook's JSDoc.

### 3. JS-computed Tailwind classes (e.g. `clsx({'text-3xl': width > 320})`)

**What:** Hybrid — keep the JS observer, but compute Tailwind classes from the observed width instead of inline styles.

**Why rejected:** Same cost as alternative 2 (per-tile observer, re-render on threshold cross) without the developer-experience win of writing the rules in CSS-adjacent syntax. Strictly worse than the container-query path.

## Related

- [[Responsive-StatTile-And-KpiGrid]] — the Pattern note that documents the user-facing API of the two primitives this ADR sanctions.
- [[ResponsiveDialog-Width-Tokens]] — sibling 2026-05-16 sweep decision; addresses the *dialog* width axis using `min(100vw-2rem,Npx)` instead of container queries.
- [[Elevated-KPI-Stat-Cards]] — the pre-existing hero/TV recipe for KPI strips, retained as-is for the cases where the elevation budget is warranted. The container-query treatment in this ADR scopes to the new utilitarian primitive, not the hero recipe.
