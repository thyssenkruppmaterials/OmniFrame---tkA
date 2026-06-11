---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-17
---
# Premium Board Aesthetic

## Purpose / Context

Reusable recipe for **digital-signage-grade** boards — surfaces that need to read as first-class editorial moments rather than generic dashboards. Use this when:

- A board displays user-authored content (announcements, news, posts, alerts, jobs) that benefits from per-item visual variation.
- The same surface renders both inside the app (curator + viewer) and on a TV (read-only at distance).
- The brand surface needs to feel "lifted, considered, top-of-line" — not "shadcn dashboard."

Do NOT use when:

- The surface is dense data (tables, grids of identical numerical KPIs). Use [[Elevated-KPI-Stat-Cards]] for that.
- The content is purely operational and visual polish would slow readability (e.g. a work-queue dispatch board).
- The page already lives on a viewport ≤ 800px (mobile-first surfaces).

First surfaced from the 2026-05-17 v2 aesthetic overhaul on [[Implement-Production-Boards-Bento-Layout]] / [[ADR-Production-Boards-Aesthetic-Overhaul]] / [[Implement-Production-Boards-Aesthetic-Overhaul]]. Sibling pattern to [[Bento-Grid-Layout]] (which handles the layout primitives) — this pattern handles the *visual voice*.

## The Recipe

### 1. Typography — Geist for display, system sans for body

The repo's `index.html` preloads Inter / Geist / Manrope / Plus Jakarta Sans / DM Sans and `src/index.css` registers them via `@theme inline`. **No new font load** — use what's already paid for.

```ts
// cards/card-shared-utils.ts
export const TYPE_TOKENS = {
  eyebrow:    'font-mono text-[10px] uppercase tracking-[0.24em] font-semibold leading-tight',
  eyebrowTv:  'font-mono text-xs    uppercase tracking-[0.32em] font-semibold leading-tight',
  headline:   'font-semibold leading-[1.08] tracking-[-0.022em]',
  display:    'font-semibold leading-[1.02] tracking-[-0.028em] [font-family:var(--font-geist),Inter,system-ui]',
  bodyTight:  'leading-[1.55] tracking-[-0.005em]',
  meta:       'text-[11px] leading-tight tabular-nums',
}
```

Display sizes scale with `clamp()` — `text-[clamp(2.5rem,5vw,5rem)]` on the banner headline. Same `clamp()` math the SQCDP TV-fit pattern uses ([[TV-Viewport-Fit-Grid]] v15.1).

#### Editorial cascade

Every variant opens with the same four-part rhythm:

1. **Eyebrow** — small uppercase, kind-coloured, mono face, `0.24em` tracking.
2. **Headline** — Geist face, display weight, tight `-0.022em` to `-0.028em` tracking.
3. **Support** — body face, `1.55` leading, `line-clamp` to keep the row legible.
4. **Meta** — author + date on the left, action (CTA / ack) on the right.

The relationship reads as orchestrated. Skipping the eyebrow leaves the card mute.

### 2. Color + accent — single per-kind gradient triple

Single source of truth: a per-kind `BoardKindAccent` palette with `from / mid / to` hex stops + soft + strong glow rgba + Tailwind class strings for eyebrow / pulse / tab.

```ts
// board-kind-accent.ts (excerpt)
const palette: Record<BentoBoardKind, BoardKindAccent> = {
  announcement: {
    fromHex: '#0EA5E9', midHex: '#6366F1', toHex: '#8B5CF6',
    glowSoft:   'rgba(99,102,241,0.16)',
    glowStrong: 'rgba(99,102,241,0.28)',
    eyebrowClass: 'border-sky-500/30 bg-sky-500/10 text-sky-700 …',
    pulseClass:   'bg-sky-500 dark:bg-sky-400',
    tabUnderlineClass: 'from-sky-500/0 via-indigo-500/80 to-violet-500/0 …',
  },
  // hr_news / job / safety_alert …
}
```

The same gradient feeds the eyebrow pill, the live-pulse dot, the active-tab gradient underline, the atmosphere mesh, the banner ambient hover-shadow, the empty-state artwork, the compose-CTA gradient, and the "Display on TV" button. **One gradient per kind, everywhere.**

Opacity tokens follow [[Dark-Mode-Opacity-Colors]] (`/10`, `/15`, `/20`, `/30`) — no raw hex on cards. (The atmosphere + banner-hover-shadow are the exception — those need raw hex for inline `style` so Tailwind v4's JIT doesn't have to statically prove every variant.)

### 3. Depth + glass — extended Elevated-KPI-Stat-Cards stack

Three-stop shadow base (`inset highlight + tight ambient + wide soft drop`) from [[Elevated-KPI-Stat-Cards]]. Hover-state scales the ambient + drop. Banner + spotlight variants add a **4th stop** — a kind-tinted ambient shadow (`var(--accent-glow)` set inline per card), so the card looks like it's emitting its own coloured light.

```tsx
// banner-card.tsx (excerpt)
<article
  className={cn(
    cardShell({ isTv }),
    'motion-safe:hover:[box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.08),0_2px_4px_0_rgba(0,0,0,0.08),0_28px_64px_-20px_var(--accent-glow),0_36px_80px_-20px_rgba(0,0,0,0.5)]'
  )}
  style={{ ['--accent-glow' as string]: `${accent}55` }}
>
  …
</article>
```

Glass: `backdrop-blur-md` is used **selectively** — on the gallery card's caption panel, the hover-revealed edit pencil, the dnd grip + resize handles. **Never on the card surface itself.**

### 4. Motion vocabulary — GPU-only, motion-safe-gated

- **Mount stagger** — every tile fades in with `slide-up + zoom-from-0.985` via `motion-safe:animate-in`. Cap at 8 cards (60ms × index) so big boards don't have a 3-second cascade. Set inline `animationDelay` per tile.
- **Hover** — `motion-safe:hover:-translate-y-0.5` lift + accent glow grows in via opacity fade + kind-tinted shadow deepens. `300ms ease-[cubic-bezier(0.22,1,0.36,1)]`.
- **Gallery Ken Burns** — `scale 1 → 1.05` over the rotate interval (default 6s), `linear`. Outgoing slide gets `opacity + blur(8px)` over 600ms; incoming gets `opacity + blur(8px) → blur(0px) + scale 1.06 → 1`.
- **Banner Ken Burns** — `scale 1 → 1.05 + translate (0.5%, -1%)` over 18s, `ease-in-out`, alternates direction.
- **Marquee** — `28s linear infinite`, edge-faded with a `linear-gradient` mask so the text fades in and out of frame.
- **Atmosphere** — `25s ease-in-out` conic-mesh rotation, two `18s/22s` radial bloom drifts. Opacity 5-12%.
- **Empty-state halo** — 4s `ping` cycle on the centre radial.

Every animation property is `transform` / `opacity` / `filter` — GPU-accelerated, no layout reflow. Every animation gated behind `motion-safe:`.

### 5. Atmosphere layer — `<BoardAtmosphere boardKind={...}>`

Fixed-positioned inside the board container at `-z-10`, `pointer-events-none`, `aria-hidden`. Four layers:

1. Slow-rotating conic mesh (kind-coloured) at 7-9% opacity, blurred 72px.
2. Two radial blooms (kind-from + kind-to) drifting independently at 8-12% opacity.
3. SVG turbulent noise at 2-2.5% opacity, `mix-blend-overlay`.
4. Top + bottom fade scrims so the atmosphere doesn't compete with header chrome.

Pure CSS keyframes, zero JS, zero bundle cost. (Inline `<style>` block — these keyframes are bento-specific and live in the lazy chunk.)

```tsx
<BoardAtmosphere boardKind='announcement' />  // normal density
<BoardAtmosphere boardKind='announcement' isTv />  // bumps mesh opacity, dampens grain
```

### 6. Empty / sparse-content states — `<BoardEmptyState boardKind={...}>`

Replaces the tiny shadcn `<Card>` + one-line "No items" pattern. Renders:

- A 32rem (TV: 36rem) accent radial halo.
- A 9rem (TV: 11rem) gradient artwork (three concentric rings + centre icon bubble).
- Kind eyebrow pill.
- Headline — display weight, kind-specific copy.
- Support paragraph.
- Optional gradient CTA.

Pure CSS artwork (no per-kind SVG asset). One implementation, four kinds.

### 7. Header chrome — `<BoardHeader>` + `<BoardFilterChips>` + `<LivePulse>`

`<BoardHeader>` hosts: kind eyebrow with `<LivePulse>` + count → title (gradient text) → subtitle → filters slot → actions cluster → hairline underline.

`<BoardFilterChips>` is the chip-strip primitive — inline glass pills inactive, kind-gradient pills active.

`<LivePulse boardKind={...} size='sm|md|lg'>` is the universal pulse indicator — same kind-coloured pulse cadence everywhere on the platform.

### 8. Tab chrome — lower visual weight

Drop the heavy `bg-muted/40 p-1` wrapper on the global tab strip; render as an inline segmented control with a hairline underneath. Active tab paints with the board kind's gradient underline (2px hairline with kind-coloured glow).

Reduce the page header weight: collapse to a slim h-12 inline row at 15px. The per-board `<BoardHeader>` carries the editorial weight.

## Don't

- **Don't add a fifth tracking value.** Eyebrow `0.24em`, headline `-0.022em`, display `-0.028em`, body `-0.005em`, meta neutral. Five values cover everything. Adding `0.14em` "for emphasis" muddies the typographic voice.
- **Don't use `text-base` on a display surface.** Every headline uses `clamp()` so it scales fluidly across viewports. A fixed `text-2xl` on a 1080p TV reads tiny; a fixed `text-5xl` on a 1280px laptop reads cramped.
- **Don't crank glow rgba alpha above 0.32.** Past 0.32 the accent reads as neon. The empty-state halo + banner hover-shadow + spotlight hover-shadow all sit at 0.28-0.32.
- **Don't add `backdrop-blur-xl` to the card surface.** Kills perceived performance on a 50-card board. Use it selectively (caption panels, hover-revealed chrome).
- **Don't add a per-card scroll-tied parallax.** The atmosphere layer is the entire "ambient motion" budget. Mouse-tilt 3D cards / scroll-tied parallax fight the bento drag/resize interaction.
- **Don't introduce a second per-kind palette.** `board-kind-accent.ts` is the source of truth. If you need an additional accent for a new kind, extend the palette table — don't fork.
- **Don't drop the eyebrow.** Every variant opens with `<Eyebrow>`. Skipping it leaves the card visually mute and breaks the editorial cascade.
- **Don't animate `width` / `height` / `left` / `top`.** Layout-driven animations cause reflow; the bento drag/resize already does that on user input. Decoration stays on `transform` / `opacity` / `filter`.
- **Don't omit `motion-safe:` on hover / mount / atmosphere animations.** Reduced-motion users see a flickering experience otherwise.

## Reusability

Likely adopters once the pattern stabilises:

- **Customer Portal "announcement" / "ticket spotlight" surfaces** — same shape applies. The customer-portal currently uses a `<Card variant='outline'>` + plain `<h3>` chrome; promoting to the cascade + atmosphere reads as a much more considered brand surface.
- **HR Self-Service "company news" surface** — single-kind variant of HR News — would adopt `<BoardAtmosphere boardKind='hr_news'>` + `<BoardHeader>` directly.
- **A future Standard Work template browser** — per-template hero / banner / spotlight variants benefit from the atmosphere + editorial cascade.
- **Admin "system health" surface** — replacing the current grid-of-cards with the bento + atmosphere reads as a Linear-grade ops surface.

If two consumers land:

1. Promote `<BoardAtmosphere>` + `<LivePulse>` to `src/components/ui/` or `src/lib/atmosphere/`.
2. Generalise the `BoardKindAccent` table to a feature-namespaced lookup (e.g. `accentForFeature(featureKey, variantKey)`).
3. Keep `<BoardHeader>` + `<BoardEmptyState>` per-feature (they bake in the specific kind copy + filter primitives).

## Related

- [[Implementations/Implement-Production-Boards-Aesthetic-Overhaul]] — first application, full file inventory.
- [[Decisions/ADR-Production-Boards-Aesthetic-Overhaul]] — the design system + reference designs.
- [[Bento-Grid-Layout]] — sibling pattern handling layout primitives (drag / resize / schema).
- [[Elevated-KPI-Stat-Cards]] — the three-stop shadow stack recipe this extends.
- [[Cinematic-Tab-Rotation]] — motion vocabulary this pattern stays compatible with.
- [[Dark-Mode-Opacity-Colors]] — the opacity-token convention.
- [[TV-Viewport-Fit-Grid]] — the `clamp()` fluid-type recipe reused here.
- [[Components/ProductionBoards - Feature Module]] — the feature module this pattern lives inside.
