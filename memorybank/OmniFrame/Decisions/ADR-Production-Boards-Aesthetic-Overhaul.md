---
tags: [type/decision, status/active, domain/frontend]
created: 2026-05-17
---
# ADR — Production Boards Aesthetic Overhaul (v2)

## Purpose / Context

2026-05-17 brought a follow-on brief on top of the same-day Bento Grid Layout slice ([[Implement-Production-Boards-Bento-Layout]]). The engineering shipped — drag/resize, five variants, schema, composer integration — but the visual surface read as "shadcn dashboard" rather than "premium digital signage." The user's exact language:

> "This looks nothing like a top-of-the-line, brand new, ultra-beautiful website would do. This looks clunky. It's not a very futuristic design… I want you to think of announcement boards and how things are displayed. What are the top-of-the-line competitors? What are they offering, and how can we do much better than them here?"

This ADR records the design system + reference-design decisions that shaped the v2 overhaul. Implementation lives at [[Implementations/Implement-Production-Boards-Aesthetic-Overhaul]] and the reusable recipe at [[Patterns/Premium-Board-Aesthetic]].

## Aesthetic Brief

Premium digital signage today separates into two visual lineages. The enterprise stack (Korbyt, Enplug, ScreenCloud, Yodeck, AppSpace) is template-driven and brand-safe — it ships clean editorial templates with strong typography and clear hierarchy, but the surfaces feel like *displays* rather than *editorial moments*. The consumer brand stack (Apple Newsroom, Linear, Vercel, Stripe Press, Framer, Notion, Arc, Raycast, Spotify Wrapped) treats the same primitives — headline, supporting copy, accent colour, motion — as cinematic prose. The first lineage tells you what's posted; the second makes you stop and read. We're rebuilding for the second lineage.

Three vocabularies do the heavy lifting in that lineage. The first is **type as voice**: Stripe Press uses geometric sans paired with restrained editorial layouts where the typography itself carries weight; Apple Newsroom pushes display sizes to the hero with very tight negative tracking; Vercel's Geist face goes to `-2.4px` tracking at 48px. The bento boards in v1 used the system default `text-base` everywhere — typography didn't feel "voiced." In v2, hero/banner/spotlight/quote cards adopt Geist for display (it's already loaded by the page, zero bundle cost), use `clamp()` so the size scales fluidly across viewports (`text-[clamp(2.5rem,5vw,5rem)]` on the banner headline), and pin `-0.022em` tracking on every display-weight string.

The second vocabulary is **atmospheric depth**. Linear's gradient mesh, Arc's gradient borders, Vercel's mesh-gradient hero atmosphere, Framer's layered glassmorphism — none of these add per-card weight; they live BEHIND the content as ambient texture. v1 was visually thin because the bento grid had zero atmosphere — a stranded card on a vast white field with nowhere for the eye to rest. v2 introduces `<BoardAtmosphere>`, a `-z-10` fixed layer that paints (a) a slow-rotating conic gradient mesh in the board's signature colour, (b) two soft kind-tinted radial blooms, (c) SVG turbulent grain at 2% mix-blend-overlay, and (d) fade scrims at the top/bottom so the atmosphere never competes with the header chrome. Total cost: pure CSS keyframes + one inline SVG noise filter, zero new dependencies.

The third vocabulary is **editorial cascade**. Apple Newsroom, Stripe Press, Notion's marketing: every card opens with an eyebrow (small uppercase, tracked, accent-coloured), then a display-weight headline, then a support paragraph, then a meta row. The relationship reads as orchestrated. v1's `<ClassicCard>` flowed straight into the title with no eyebrow — a missed editorial beat. Every v2 variant now opens with a kind-coloured `<Eyebrow>` ("Announcement", "Safety alert", "HR voice", "Job posting"), uses Geist for the headline, and ends with author+date on the left and the action (CTA / ack) on the right.

### Reference designs we drew from

1. **Apple Newsroom** — large editorial hero, generous whitespace, headline-first composition. Adopted: the empty-state hero (no body, just a confident headline + one CTA), the display-typography scale.
2. **Linear changelog + UI refresh** — calmer interface with frosted-glass materials and gradient meshes. Adopted: the `<BoardAtmosphere>` conic mesh + radial blooms, the `backdrop-blur-md` glass panel on the gallery caption.
3. **Vercel design system** — Geist face with aggressive negative tracking, three-stop shadow stack (`inset highlight + tight ambient + wide soft drop`), mesh gradient as the only decorative system. Adopted: the kind-accent gradient triple (`fromHex / midHex / toHex`), the polish on the shadow stack, the inset 1px highlight on every card.
4. **Stripe Press** — restrained editorial type, materials and shadows used sparingly as finishing touches. Adopted: the discipline of the editorial cascade (eyebrow → headline → support → meta), the willingness to NOT decorate when the type carries enough weight (quote card, empty state).
5. **Spotify Wrapped 2025** — cinematic typography, layered motion that "forms in real time," Ken Burns drift on imagery. Adopted: the 6-second Ken Burns on the banner cover + active gallery slide, the 600ms crossfade with `blur(8px) → blur(0px)` on the outgoing image, the `motion-safe:` discipline so reduced-motion users see a static experience.

### Anti-patterns we avoided

1. **Bootstrap-era drop shadows** — no `shadow-2xl`, no inflated single-stop shadows. The three-stop stack with inset highlight is the entire shadow budget.
2. **Neon-on-black gamer aesthetic** — no saturated `ring-2` accents, no electric glows above 0.28 alpha. Accent glow rgba alpha caps at 0.28 strong / 0.16 soft.
3. **Over-animated busy parallax** — no per-card scroll-tied parallax, no mouse-tilt 3D cards, no auto-playing motion that resists user input. The Ken Burns is slow, the marquee is `linear`, every animation is gated behind `motion-safe:`.
4. **Heavy header chrome** — no big shadcn `<Card>` wrappers around the page header. The "Production Boards" page header collapses to a single h-12 inline row at 15px so the per-board `<BoardHeader>` carries the editorial weight.
5. **One-size text scaling** — no fixed `text-base` / `text-xl` on a 1080p TV that's 4× the viewport of a laptop. Every display string uses `clamp()` so the rhythm holds across viewports.

## Design system

### Typography

The page already preloads Inter, Geist, Manrope, Plus Jakarta Sans, and DM Sans via `<link rel='preload'>` in `index.html` and registers them in `@theme inline` (`--font-geist`, etc.) in `src/index.css`. We use **Geist** for display (eyebrow / headline / display blockquote) and the system default sans for body — zero new font load, zero bundle impact.

Tracking + leading tokens live in `TYPE_TOKENS` in `cards/card-shared-utils.ts`:

```ts
TYPE_TOKENS = {
  eyebrow:    'font-mono text-[10px] uppercase tracking-[0.24em] font-semibold leading-tight',
  eyebrowTv:  'font-mono text-xs    uppercase tracking-[0.32em] font-semibold leading-tight',
  headline:   'font-semibold leading-[1.08] tracking-[-0.022em]',
  display:    'font-semibold leading-[1.02] tracking-[-0.028em] [font-family:var(--font-geist),Inter,system-ui]',
  bodyTight:  'leading-[1.55] tracking-[-0.005em]',
  meta:       'text-[11px] leading-tight tabular-nums',
  metaTv:     'text-sm     leading-tight tabular-nums',
}
```

Display sizes scale with `clamp()` — `text-[clamp(2.5rem,5vw,5rem)]` on the banner headline; the same `clamp()` math the SQCDP TV-fit pattern uses ([[Patterns/TV-Viewport-Fit-Grid]] v15.1).

### Color + accent

Single source of truth: `components/bento/board-kind-accent.ts`. Each of the four kinds gets a `BoardKindAccent` palette:

| Kind | from → mid → to | Glow soft / strong | Eyebrow class |
|---|---|---|---|
| `announcement` | `#0EA5E9 → #6366F1 → #8B5CF6` | `rgba(99,102,241,0.16)` / `0.28` | sky |
| `hr_news` | `#10B981 → #14B8A6 → #0EA5E9` | `rgba(20,184,166,0.16)` / `0.28` | emerald |
| `job` | `#F59E0B → #FB923C → #EC4899` | `rgba(251,146,60,0.16)` / `0.28` | amber |
| `safety_alert` | `#F43F5E → #EF4444 → #F97316` | `rgba(244,63,94,0.16)` / `0.32` | rose |

Same palette feeds the eyebrow pill, the live-pulse dot, the active-tab gradient underline, the atmosphere mesh, the banner ambient hover-shadow, the empty-state artwork, the compose-CTA gradient, and the "Display on TV" button. **One gradient per kind, everywhere.**

Opacity tokens follow [[Dark-Mode-Opacity-Colors]] (`/10`, `/15`, `/20`, `/30`) — no raw hex in card chrome.

### Depth + glass

Shadow stack extends [[Elevated-KPI-Stat-Cards]]:

- **Resting** — `inset highlight + 1-2px ambient + 12-24px soft drop` (3 stops).
- **Hover** — same stack scaled up (4-8px ambient + 24-56px soft drop).
- **Banner / spotlight hover** — adds a 4th stop, a **kind-tinted ambient shadow** (`var(--accent-glow)` set inline per card). The card looks like it's emitting its own coloured light.

Glass: `backdrop-blur-md` is used selectively on (a) the gallery card's caption panel, (b) the edit pencil at-hover, (c) the dnd grip + resize handles. **Never on the card surface itself** — kills perceived performance and would conflict with the atmosphere layer underneath.

### Motion vocabulary

- **Mount stagger** — every tile fades in with `slide-up + zoom-from-0.985` via `motion-safe:animate-in`. Cap stagger at 8 cards (60ms × index) so a 50-card board doesn't have a 3-second cascade. Set inline `animationDelay` per tile in `<BentoGrid>`.
- **Hover** — `motion-safe:hover:-translate-y-0.5` lift, accent glow grows in via opacity fade, kind-tinted shadow deepens. All transitions `300ms ease-[cubic-bezier(0.22,1,0.36,1)]`.
- **Gallery Ken Burns** — `scale 1 → 1.05` over the rotate interval (default 6s), `linear`. Outgoing slide gets `opacity + blur(8px)` over 600ms; incoming gets `opacity + blur(8px) → blur(0px) + scale 1.06 → 1`.
- **Banner Ken Burns** — `scale 1 → 1.05 + translate (0.5%, -1%)` over 18s, `ease-in-out`, alternates direction (so it never resets visibly).
- **Marquee** — `28s linear infinite`, edge-faded with a `linear-gradient` mask so the text fades in and out of frame.
- **Atmosphere** — `25s ease-in-out` conic-mesh rotation, two `18s/22s` radial bloom drifts. Opacity 5-12%.
- **Empty-state halo** — 4s `ping` cycle on the centre radial; concentric ring breathing.

Every animation property is `transform` / `opacity` / `filter` — GPU-accelerated, no layout reflow. Every animation gated behind `motion-safe:`.

### Editorial rhythm

Every variant adopts the same four-part rhythm:

1. **Eyebrow** — small uppercase, accent-coloured, mono face, `0.24em` tracking.
2. **Headline** — Geist face, display weight, tight `-0.022em` to `-0.028em` tracking.
3. **Support** — body face, `1.55` leading, `line-clamp` to keep the row legible.
4. **Meta** — author + date on the left, action (CTA / ack) on the right.

### Atmosphere layer

`<BoardAtmosphere boardKind={...}>` — four-layer fixed backdrop:

1. Slow-rotating conic mesh (kind-coloured) at 7-9% opacity, blurred 72px.
2. Two radial blooms (kind-from + kind-to) drifting independently at 8-12% opacity.
3. SVG turbulent noise at 2-2.5% opacity, `mix-blend-overlay`.
4. Top + bottom fade scrims so the atmosphere doesn't compete with header chrome.

Renders inside the board container at `-z-10`, `pointer-events-none`, `aria-hidden`. Pure CSS keyframes, zero JS, zero bundle cost.

### Empty / sparse-content states

`<BoardEmptyState boardKind={...} onCompose={...}>` replaces the tiny shadcn `<Card>` + one-line "No items" pattern. Renders:

- A 32rem (TV: 36rem) accent radial halo.
- A 9rem (TV: 11rem) gradient artwork (three concentric rings + centre icon bubble).
- Kind eyebrow pill.
- Headline — display weight, kind-specific copy ("Nothing on the wire yet.", "Quiet on the HR channel.", "No openings posted.", "All clear — no active alerts.").
- Support paragraph.
- Optional gradient CTA ("Compose first announcement").

This is what makes a board with zero posts feel intentional rather than desolate.

### Header chrome

`<BoardHeader boardKind={...}>` replaces the per-board duplicated header markup. Each section:

- Kind eyebrow with `<LivePulse>` + count.
- Title (gradient text — `bg-clip-text`).
- Subtitle.
- Filters slot (chip strip).
- Actions cluster (compose / TV / extras).
- Hairline underline with the kind gradient.

`<BoardFilterChips>` is the chip-strip primitive — inline glass pills inactive, kind-gradient pills active.

`<BoardTabs>` global tab strip dropped its heavy `bg-muted/40 p-1` wrapper, became an inline segmented control with a hairline underneath and a per-tab kind-coloured active underline.

`production-boards-page.tsx` page header collapsed from h-14 with full-shadcn-Card chrome to h-12 with a single inline row. The 32px page-icon tile dropped to 24px. Title weight 600 → 500. Description moved from below-title to inline. The per-board `<BoardHeader>` now carries the editorial weight.

## Decision

Eight decisions land together:

1. **Single per-kind accent vocabulary** in `board-kind-accent.ts`. One gradient triple per kind drives eyebrow / pulse / tab / atmosphere / banner-hover-shadow / empty-state artwork / CTA.

2. **Adopt Geist for display, system sans for body**. Already loaded by the page — zero new bundle cost. Avoids the alternative of adding Inter Display or shipping a custom variable font.

3. **Atmospheric mesh + grain backdrop** as a per-board primitive. Pure CSS keyframes + inline SVG noise. No motion library, no canvas, no JS.

4. **`<BoardEmptyState>` per kind** — beautiful empty state with hero illustration + CTA, replacing the tiny shadcn Card + one-line copy.

5. **`<BoardHeader>` + `<BoardFilterChips>` primitives** — premium header chrome shared across all four content boards.

6. **`<LivePulse>` universal indicator** — same kind-coloured pulse cadence everywhere on the platform.

7. **Editorial cascade in every variant** — eyebrow → headline → support → meta. Each variant uses the same rhythm; only the typographic weight + cover treatment differs.

8. **`<BoardTabs>` + page header weight reduction** — the global tab strip drops its heavy container; the page header collapses to a slim inline row. The per-board `<BoardHeader>` takes the editorial weight instead.

## Alternatives considered

### A) Add Inter Display or a custom variable font

Rejected — adds 40-80 KB to the page even at `font-display: swap`, and the page already loads Inter / Geist / Manrope. Using Geist as the display face (already paid for) gets us the geometric-sans editorial voice without the bundle hit.

### B) Use `framer-motion` for the atmosphere mesh

Rejected — the atmosphere is purely decorative; a CSS `@keyframes` rotation is enough and adds zero bundle weight. `framer-motion` is already in the bento chunk for the gallery crossfade — we just reuse it there, not on the atmosphere.

### C) Per-kind background image instead of conic mesh

Rejected — an SVG/PNG asset would add at minimum a network request per kind (4 kinds × ~30 KB each = 120 KB of new assets), and the visual would feel static. The CSS-driven conic mesh + radial blooms breathe over 25s + 18s + 22s cycles independently — it reads as a living surface for zero cost.

### D) Per-card mount stagger via `framer-motion` variants

Rejected — `framer-motion` is already in the chunk for the gallery crossfade, but per-card variants on a 50-card board stutters on slower hardware (Spotify Wrapped 2025's research confirmed body-level animation only). The mount stagger uses `motion-safe:animate-in` (Tailwind's built-in `tw-animate-css`) + an inline `animationDelay` per tile. Capped at 8 cards (`MOUNT_STAGGER_CAP`) so big boards don't have a 3-second cascade.

### E) Larger gallery crossfade duration (1s+) for a fully filmic feel

Rejected — Spotify Wrapped 2025 uses 700ms for the cinematic moment; longer than 600-700ms feels sluggish. Settled on 600ms with `blur(8px) → blur(0px)` on the outgoing image — captures the filmic quality without the lag.

### F) Standalone artwork per empty state (illustrated SVG per kind)

Held in reserve. The current `<BoardEmptyState>` artwork is a CSS-only triple ring + icon bubble with the kind gradient at the centre — feels considered without the cost of designing four bespoke SVGs. If a future curator-feedback round asks for custom illustration, the design surface is there.

## Consequences

- **Bundle**: `feature-shift-productivity` chunk: **474.66 KB** (was 473.88 — net **+0.78 KB**, well under the 500 KB ceiling). `feature-production-boards-bento` lazy chunk: **96.71 KB** (was 76.74 — net **+19.97 KB** for all the new primitives + variant rebuilds + atmosphere). `feature-production-boards-composer` unchanged at 77.63 KB.
- **Test coverage**: 343 → 375 tests (+32 new across `board-kind-accent`, `board-atmosphere`, `board-empty-state`, `board-header`, `board-filter-chips`, `live-pulse`).
- **Bundle budget script** still fails on the three pre-existing oversized chunks (`warehouse-location-map`, `feature-admin`, `feature-rf-interface`) — unrelated to this slice. `feature-shift-productivity` sits at WARN (463.54 KB gzipped budget-script number) not FAIL.
- **Lint ratchet** unaffected — touched files lint-clean. Pre-existing 94 warnings vs 16 baseline carries from prior sibling work.
- **No new dependencies**. No new fonts. No new motion libraries. The entire overhaul is CSS keyframes + design tokens.
- **Accessibility**: every animation gated behind `motion-safe:`. Aria-labels on every interactive element. Eyebrow chips include the kind label so screen readers announce context.
- **Curator hover affordances unchanged** — drag grip + resize corner still hover-revealed; just got designed (glass + accent ring).
- **TV mode** picks up the same atmosphere + variant cards. Atmosphere bumps mesh opacity slightly on TV (9% vs 7%) and dampens grain (1.8% vs 2.5%) so banding doesn't read at 8ft.

## Related

- [[Implementations/Implement-Production-Boards-Aesthetic-Overhaul]] — the implementation note (files, decisions, bundle deltas).
- [[Patterns/Premium-Board-Aesthetic]] — the reusable recipe distilled from this work.
- [[Patterns/Bento-Grid-Layout]] — the v1 pattern; v2 aesthetic overhaul extends it (see the v2 section in that pattern).
- [[Implementations/Implement-Production-Boards-Bento-Layout]] — the v1 implementation this builds on (drag/resize/schema/variants — all unchanged).
- [[Patterns/Elevated-KPI-Stat-Cards]] — the shadow-stack recipe extended here.
- [[Patterns/Cinematic-Tab-Rotation]] — motion vocabulary the overhaul stays compatible with.
- [[Patterns/Dark-Mode-Opacity-Colors]] — the opacity-token convention this work follows.
- [[Patterns/TV-Viewport-Fit-Grid]] — the clamp-based fluid type recipe reused here.
- [[Components/ProductionBoards - Feature Module]] — the feature module the overhaul lands on.
