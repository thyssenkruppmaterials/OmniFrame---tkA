---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-10
---
# Elevated KPI Stat Cards

## Purpose / Context

Reusable visual recipe for **KPI stat cards** that should read as **lifted, premium tiles** — think Apple / Linear / Vercel dashboard, not inflated drop-shadow.

Use this when:

- The page has a horizontal strip of 3–6 numeric "hero" KPIs (Active Associates / Throughput / Target Achievement / etc.).
- The KPI strip is the page's headline summary and benefits from sitting **above** the rest of the surface in the visual hierarchy.
- A single unified surface (see [[Unified-Workbench-Card-Layout]]) would feel too quiet for the importance of the data.

Do NOT use when:

- Cells share state and reorder/collapse together (use unified workbench instead).
- The tiles need internal scroll, complex header, or any chrome that the shadcn `<Card>` component already provides — the recipe deliberately drops the `<Card>` primitive.

First surfaced from the 2026-05-10 v5 polish on [[Implementations/Implement-Production-Boards-Hourly-Grid]] (Production Boards' four KPI cards). Likely next adopter: the `LiveOperatorStatus` summary tiles (currently flat).

## Recipe

### Outer grid

```tsx
<div className='grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-5'>
  {/* four KpiCard instances */}
</div>
```

For a TV-density variant: `grid-cols-2 lg:grid-cols-4 gap-6` and wider gap so the lift feels generous on a 1920×1080 TV.

### Card surface (single component, density-aware)

```tsx
<div
  role='group'
  aria-label={ariaLabel}
  style={{ '--kpi-glow': accentRgba, animationDelay: `${index * 60}ms` }}
  className={cn(
    'group relative isolate overflow-hidden border border-border/60 bg-card',
    'rounded-2xl', // or 'rounded-3xl' at TV density

    // Top-light gradient — the "pop" hint
    'bg-linear-to-b from-white/4 via-transparent to-transparent',

    // Elevation — see Shadow stack below
    SHADOW_NORMAL, // or SHADOW_TV at TV density

    // Hover lift + shadow transition
    'transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
    'motion-safe:hover:-translate-y-0.5', // -translate-y-1 at TV

    // Mount fade + slide-up + stagger via inline animationDelay above
    'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 motion-safe:fill-mode-backwards'
  )}
>
  {/* Top accent line — thin, color-coded per KPI */}
  <span
    aria-hidden
    className={cn(
      'pointer-events-none absolute inset-x-3 top-0 h-px rounded-full',
      'bg-linear-to-r from-transparent to-transparent',
      accentLineClass // e.g. 'via-emerald-500/60 dark:via-emerald-400/55'
    )}
  />

  {/* Subtle radial glow on hover only — colour from --kpi-glow inline var */}
  <span
    aria-hidden
    className={cn(
      'pointer-events-none absolute inset-0 opacity-0',
      'bg-[radial-gradient(120%_60%_at_50%_0%,var(--kpi-glow),transparent_60%)]',
      'motion-safe:transition-opacity motion-safe:duration-500',
      'motion-safe:group-hover:opacity-100'
    )}
  />

  {/* Body — icon tile + label + primary number + subtitle */}
  <div className='relative flex flex-col gap-1.5 p-5 lg:p-6'>
    <div className='flex items-center gap-2'>
      <div className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md',
        iconBgClass, // e.g. 'bg-emerald-500/10 text-emerald-500 dark:bg-emerald-500/15 dark:text-emerald-400'
        'ring-1 ring-inset',
        iconRingClass, // e.g. 'ring-emerald-500/20 dark:ring-emerald-400/25'
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]' // micro-elevation on the tile
      )}>
        <Icon className='h-4 w-4' aria-hidden />
      </div>
      <span className='text-muted-foreground text-xs font-medium uppercase tracking-wide'>
        {label}
      </span>
    </div>
    <div className={cn(
      'text-3xl font-semibold tabular-nums tracking-tight',
      // Tactile 1px top highlight on the big number — dark mode only
      'dark:[text-shadow:0_1px_0_rgba(255,255,255,0.04)]'
    )}>
      {primary}
    </div>
    <div className='text-muted-foreground text-xs'>{secondary}</div>
  </div>
</div>
```

### Shadow stack (the canonical recipe)

Three stops per state — inset top-edge highlight + tight 1–2 px ambient + wide soft drop. **Do not exceed three stops per state.**

#### Normal density

- **Light, resting** — `inset 0 1px 0 0 rgba(255,255,255,0.04), 0 1px 2px 0 rgba(0,0,0,0.06), 0 8px 24px -12px rgba(15,23,42,0.18)`
- **Dark, resting** — `inset 0 1px 0 0 rgba(255,255,255,0.05), 0 2px 4px 0 rgba(0,0,0,0.5), 0 24px 48px -12px rgba(0,0,0,0.55)`
- **Light, hover** — `inset 0 1px 0 0 rgba(255,255,255,0.05), 0 2px 4px 0 rgba(0,0,0,0.08), 0 16px 40px -12px rgba(15,23,42,0.25)`
- **Dark, hover** — `inset 0 1px 0 0 rgba(255,255,255,0.06), 0 4px 8px 0 rgba(0,0,0,0.55), 0 32px 64px -16px rgba(0,0,0,0.6)`

As Tailwind v4 arbitrary values (single class string per state):

```
shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04),0_1px_2px_0_rgba(0,0,0,0.06),0_8px_24px_-12px_rgba(15,23,42,0.18)]
dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_2px_4px_0_rgba(0,0,0,0.5),0_24px_48px_-12px_rgba(0,0,0,0.55)]
motion-safe:hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_2px_4px_0_rgba(0,0,0,0.08),0_16px_40px_-12px_rgba(15,23,42,0.25)]
motion-safe:dark:hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06),0_4px_8px_0_rgba(0,0,0,0.55),0_32px_64px_-16px_rgba(0,0,0,0.6)]
```

#### TV density (1920×1080)

- **Light, resting** — `inset 0 1px 0 0 rgba(255,255,255,0.04), 0 2px 4px 0 rgba(0,0,0,0.07), 0 24px 48px -16px rgba(15,23,42,0.28)`
- **Dark, resting** — `inset 0 1px 0 0 rgba(255,255,255,0.05), 0 4px 8px 0 rgba(0,0,0,0.55), 0 40px 80px -20px rgba(0,0,0,0.65)`
- **Light, hover** — `inset 0 1px 0 0 rgba(255,255,255,0.05), 0 4px 8px 0 rgba(0,0,0,0.10), 0 32px 64px -16px rgba(15,23,42,0.32)`
- **Dark, hover** — `inset 0 1px 0 0 rgba(255,255,255,0.07), 0 6px 12px 0 rgba(0,0,0,0.6), 0 48px 96px -24px rgba(0,0,0,0.7)`

TV cards also bump `rounded-3xl`, `gap-6` outer, `-translate-y-1` hover lift, `p-8` body, `text-5xl` primary, `h-10 w-10 rounded-lg` icon tile.

### Per-KPI accent tokens

Four colour keys cover the standard productivity palette. Match the icon tile colour + ring + accent line + glow rgba for visual coherence:

| Accent | Icon tile bg | Ring | Accent line | Glow rgba |
|---|---|---|---|---|
| sky | `bg-sky-500/10 text-sky-500 dark:bg-sky-500/15 dark:text-sky-400` | `ring-sky-500/20 dark:ring-sky-400/25` | `via-sky-500/60 dark:via-sky-400/55` | `rgba(56,189,248,0.10)` |
| emerald | `bg-emerald-500/10 text-emerald-500 dark:bg-emerald-500/15 dark:text-emerald-400` | `ring-emerald-500/20 dark:ring-emerald-400/25` | `via-emerald-500/60 dark:via-emerald-400/55` | `rgba(16,185,129,0.10)` |
| amber | `bg-amber-500/10 text-amber-500 dark:bg-amber-500/15 dark:text-amber-400` | `ring-amber-500/20 dark:ring-amber-400/25` | `via-amber-500/60 dark:via-amber-400/55` | `rgba(245,158,11,0.10)` |
| violet | `bg-violet-500/10 text-violet-500 dark:bg-violet-500/15 dark:text-violet-400` | `ring-violet-500/20 dark:ring-violet-400/25` | `via-violet-500/60 dark:via-violet-400/55` | `rgba(139,92,246,0.10)` |

If you need a new accent, follow the same four tokens (icon bg, ring, accent line, glow rgba). Glow rgba alpha sits at **0.10** — don't crank it higher; the radial gradient covers a wide area and the tile starts to look neon.

### Mount stagger

Each card's mount-in animation is offset by **60 ms × index**. Set via inline `style={{ animationDelay: `${index * 60}ms` }}`. Pair with `motion-safe:fill-mode-backwards` so cards stay invisible during their delay (otherwise card #4 paints at full opacity before card #1 finishes — looks twitchy).

## Layering / stacking order

Reading bottom→top (as composed in CSS painter order):

1. **Border + bg-card surface** with `rounded-2xl` (or `-3xl`) and `overflow-hidden isolate`.
2. **Top-light gradient** — `bg-linear-to-b from-white/4 via-transparent to-transparent` painted on the same element.
3. **Top accent `<span>`** — absolute, 1 px tall, color-coded per KPI.
4. **Hover radial-glow `<span>`** — absolute inset-0, fades in via `motion-safe:group-hover:opacity-100`, colour from inline `--kpi-glow` CSS var.
5. **Body** — `relative` so it stacks above the decorative spans; icon tile carries its own micro-elevation (`ring-1 ring-inset` + `shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]`).

`isolate` on the card creates a stacking context so `overflow-hidden` clips the radial glow cleanly, and `pointer-events-none` on every decorative `<span>` keeps hit-testing on the body.

## Reduced motion

All animation-bearing classes are wrapped in `motion-safe:`:

- `motion-safe:hover:-translate-y-0.5` (and TV's `-translate-y-1`)
- `motion-safe:hover:shadow-[…]` and `motion-safe:dark:hover:shadow-[…]`
- `motion-safe:transition-opacity motion-safe:group-hover:opacity-100` on the radial glow
- `motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 motion-safe:fill-mode-backwards`

Users with `prefers-reduced-motion` see static cards with the same elevation — no lift, no glow fade, no mount-in.

## Don't

- **Don't use the shadcn `<Card>` primitive.** Its built-in `shadow-sm` fights the multi-stop stack we layer ourselves. Compose your own `<div>` surface.
- **Don't use `shadow-2xl` or any of the off-the-shelf Tailwind shadow scales.** They're tuned for inflated marketing aesthetics, not premium dashboard restraint.
- **Don't add a `bg-black/50` or `bg-card/70` overlay** on hover. The radial-glow span is the entire hover-emphasis budget; another overlay turns the card muddy.
- **Don't add a neon accent ring** (`ring-2 ring-emerald-500`). The accent line + icon tile ring + 0.10-alpha glow is the entire colour budget; more saturation drags the card toward dashboard-from-2017.
- **Don't exceed three shadow stops per state.** The recipe is `inset highlight + tight ambient + wide soft drop` — any more and the card crosses from "premium quiet" into "inflated drop-shadow".
- **Don't drop `overflow-hidden` from the card.** The radial glow span and top accent line both rely on it for clipping to the rounded edge.
- **Don't crank the glow rgba alpha above 0.10.** It's a wide radial; it only needs to whisper.
- **Don't omit `motion-safe:` on the hover/mount affordances.** Reduced-motion users get a flickering experience otherwise.
- **Don't add `backdrop-blur` to these cards.** This pattern is for opaque elevated tiles; if you want a glassmorphic surface, see the `glass-*` utilities in `index.css` instead — different visual language.

## Reusability

Likely adopters once the pattern stabilises:

- `LiveOperatorStatus` summary tiles (already referenced in [[Dark-Mode-Opacity-Colors]]).
- Any future KPI strip on the productivity / shift surfaces.
- Admin dashboard hero summaries (e.g. agent fleet metrics, work-queue metrics).

If two consumers land, promote `SHADOW_NORMAL` / `SHADOW_TV` strings into `@utility` blocks in `src/index.css` so the JSX stays compact — the inline arbitrary classes are fine for one consumer but pile up across two.

## Variant: Colored Header Scorecard

The SQCDP scorecard cards (`src/features/shift-productivity/production-boards/boards/sqcdp/components/sqcdp-card.tsx`) extend this recipe with a **colored header strip** in place of the thin top accent line + icon-tile-on-neutral-surface eyebrow. The thyssenkrupp Branch Performance scorecard layout is the visual reference — each cell wears a saturated header (red for Safety, green for Quality, …) carrying the category title in white at `text-2xl font-bold uppercase tracking-tight` (normal density) or `text-4xl` (TV). The icon renders inline in `text-white/95` (no tile — the tile pattern is for icons on neutral surfaces). The pencil edit affordance moves into the right slot of the colored header, hover-revealed and styled `text-white/85 hover:text-white hover:bg-white/15`. The base elevation surface is unchanged: same `border-border/60 bg-card`, same 3-stop shadow stack, same `motion-safe:hover:-translate-y-0.5`, same `rounded-2xl overflow-hidden`. The colored header inherits the rounded top corners via the parent's `overflow-hidden` (don't add `rounded-t-2xl` on the header itself — doubles up). White text on the 9 canonical SQCDP accents (`#DC2626` Safety … `#0EA5E9` Announcement) all clear WCAG AA large-text (≥ 3.0:1) since `text-2xl bold` qualifies as large text. A `shadow-[inset_0_-1px_0_rgba(0,0,0,0.10)]` hairline at the bottom edge of the header gives a hint of depth into the meta block. Use this variant when the cell is a **scorecard** (categorical performance summary, color is a first-class signifier) rather than a generic KPI — if you're showing a number that doesn't map to a category-coded color, stick with the base recipe's thin accent line + icon tile. See [[Implementations/Implement-Production-Boards-Hourly-Grid#v11.3 — SQCDP Colored Header Strip + Larger Category Title (2026-05-10)|v11.3 note]] for the full diff and contrast table.

## Related

- [[Dark-Mode-Opacity-Colors]] — the per-KPI accent tokens follow the opacity-token system from this pattern.
- [[Unified-Workbench-Card-Layout]] — the **opposite** pattern (single surface, internal dividers). Use that one when sections share state; use this one when the cells are independent KPIs.
- [[Implementations/Implement-Production-Boards-Hourly-Grid]] § v5 — first application.
