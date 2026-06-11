---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-05-17
---
# Implement — Production Boards Aesthetic Overhaul (v2)

## Purpose / Context

Same-day follow-on to [[Implement-Production-Boards-Bento-Layout]]. The engineering for the bento grid had landed (drag/resize, five variants, schema, composer integration), but the visual surface read as "shadcn dashboard" rather than "premium digital signage." This slice is a **design-driven aesthetic overhaul** — no schema changes, no new dependencies, no new features. It rebuilds the visual layer on top of the existing engineering.

ADR with the design system + reference-design rationale: [[Decisions/ADR-Production-Boards-Aesthetic-Overhaul]] (includes the 5 reference designs and 5 anti-patterns).

Reusable recipe: [[Patterns/Premium-Board-Aesthetic]].

## Files

### Added (16 files)

```
src/features/shift-productivity/production-boards/
  components/bento/
    board-kind-accent.ts                          — per-kind gradient triple + glow rgba + Tailwind class strings
    board-kind-accent.test.ts                     — 6 unit tests
    board-atmosphere.tsx                          — 4-layer mesh + grain backdrop primitive
    board-atmosphere.test.tsx                     — 4 smoke tests
    board-empty-state.tsx                         — per-kind empty state with halo + artwork + CTA
    board-empty-state.test.tsx                    — 5 smoke tests
    board-header.tsx                              — premium per-board header chrome
    board-header.test.tsx                         — 6 smoke tests
    board-filter-chips.tsx                        — premium chip-strip primitive (gradient on active)
    board-filter-chips.test.tsx                   — 4 smoke tests
    live-pulse.tsx                                — universal kind-coloured pulse indicator
    live-pulse.test.tsx                           — 6 smoke tests
```

### Modified (12 files)

```
src/features/shift-productivity/production-boards/
  components/bento/
    bento-grid.tsx                                — gap-5/6, mount stagger (60ms × index, cap 8), polished drag/resize handles
    bento-board-shell.tsx                         — drag tooltip pill restyled (glass + rounded)
    cards/card-shared-utils.ts                    — bumped 3-stop shadow + hover stack, added TYPE_TOKENS, updated cardShell
    cards/card-shared.tsx                         — premium badge designs, designed edit pencil, new <Eyebrow> primitive, severity dot + tracked uppercase
    cards/classic-card.tsx                        — editorial cascade rebuild (eyebrow → headline → support → meta), vertical gradient stripe, hover image Ken Burns
    cards/banner-card.tsx                         — cinematic hero rebuild (Ken Burns 18s, gradient bleed behind type, kind-tinted hover shadow, edge-faded marquee)
    cards/gallery-card.tsx                        — 600ms blur+opacity crossfade, glass caption panel, dot-pager grows + paints with accent
    cards/spotlight-card.tsx                      — Apple-style featured tile (large icon bubble + halo + display headline + corrective-action callout)
    cards/quote-card.tsx                          — refined pull-quote (display weight italic up to text-5xl, kind-coloured glyph at 18-22% opacity, gradient hairline attribution)
  components/
    board-tabs.tsx                                — dropped heavy bg-muted/40 p-1 wrapper, became inline segmented control with per-kind active underline
  boards/announcements/announcements-board.tsx    — wired through <BoardHeader> + <BoardAtmosphere> + <BoardEmptyState> + <BoardFilterChips>
  boards/hr-news/hr-news-board.tsx                — same wiring
  boards/jobs/jobs-board.tsx                      — same wiring
  boards/safety-alerts/safety-alerts-board.tsx    — same wiring
  production-boards-page.tsx                      — page header collapsed to slim h-12 inline row (15px title, inline description)
  index.ts                                        — + BoardAtmosphere / BoardEmptyState / BoardFilterChips / BentoBoardHeader / LivePulse / accentFor / gradientCss / meshConicCss + BoardKindAccent type
```

### Deleted

None. v1 bento engineering (drag/resize, schema, variant taxonomy, composer integration) is preserved verbatim — this slice rebuilds the visual layer ONLY.

## Architecture

### One source of truth for per-kind accents

`board-kind-accent.ts` declares a `BoardKindAccent` palette per `BentoBoardKind`:

```ts
{
  label: 'Announcements',
  fromHex: '#0EA5E9',  // sky-500
  midHex:  '#6366F1',  // indigo-500
  toHex:   '#8B5CF6',  // violet-500
  glowSoft:   'rgba(99,102,241,0.16)',
  glowStrong: 'rgba(99,102,241,0.28)',
  eyebrowClass: 'border-sky-500/30 bg-sky-500/10 text-sky-700 …',
  pulseClass:   'bg-sky-500 dark:bg-sky-400',
  tabUnderlineClass: 'from-sky-500/0 via-indigo-500/80 to-violet-500/0 …',
}
```

Two helpers built on top:

- `gradientCss(kind, angle)` — returns a `linear-gradient(...)` string for inline `style` (empty-state artwork, banner ambient shadow, active CTA).
- `meshConicCss(kind)` — returns a `conic-gradient(...)` for the atmosphere mesh layer.

**Four exact kind palettes:**

| Kind | from | mid | to |
|---|---|---|---|
| announcement | `#0EA5E9` sky-500 | `#6366F1` indigo-500 | `#8B5CF6` violet-500 |
| hr_news | `#10B981` emerald-500 | `#14B8A6` teal-500 | `#0EA5E9` sky-500 |
| job | `#F59E0B` amber-500 | `#FB923C` orange-400 | `#EC4899` pink-500 |
| safety_alert | `#F43F5E` rose-500 | `#EF4444` red-500 | `#F97316` orange-500 |

### Atmosphere primitive

`<BoardAtmosphere boardKind={...}>` — fixed `-z-10` backdrop inside the board container. Four layers via four nested `<div>`s + one inline SVG noise filter:

1. **Slow-rotating conic mesh** — `transform: rotate(0deg) scale(1.18) → rotate(8deg) scale(1.32)` over 25s `ease-in-out`. Opacity 7% (normal) / 9% (TV). Blurred 72px. Wrapped in `motion-safe:animate-[board-mesh_25s_…]`.
2. **Two radial blooms** — drift independently over 18s + 22s `ease-in-out`. Opacity 8-12%. Blurred 48-56px. Kind-from on top-left, kind-to on bottom-right.
3. **SVG turbulent noise** — `<feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'>` desaturated. `mix-blend-overlay`. Opacity 2.5% (normal) / 1.8% (TV — bands at distance).
4. **Top + bottom fade scrims** — `bg-gradient-to-(b|t) from-background/40 to-transparent` so the atmosphere doesn't compete with the board header above.

Inline `<style>{...}` block declares the three keyframes (`board-mesh` / `board-bloom-a` / `board-bloom-b`) — board-bento-specific so they live in the lazy chunk, not in `index.css`.

`animated={false}` prop disables the keyframes — used in test environments where jsdom doesn't paint CSS animations and the smoke test asserts the static layer renders.

### Empty-state artwork

`<BoardEmptyState boardKind={...} onCompose={...}>` renders pure CSS artwork (no per-kind SVG asset):

- 32rem (TV: 36rem) accent radial halo via inline `background: radial-gradient(circle, glowSoft, transparent 60%)`.
- Three concentric rings (24rem outermost, 18rem middle, 12rem innermost gradient-filled circle).
- Centre icon (Tabler `IconSpeakerphone` / `IconUsersGroup` / `IconBriefcase` / `IconAlertTriangle`).
- 4s `ping` animation on the centre radial.

Headline + support copy keyed per kind:

| Kind | Headline | Support |
|---|---|---|
| announcement | "Nothing on the wire yet." | "Announcements posted here ripple across every working area. Start with the morning huddle or a shift call-out." |
| hr_news | "Quiet on the HR channel." | "Company-wide news or branch-specific updates — pin a welcome, surface a policy change, share a milestone. The whole org's listening." |
| job | "No openings posted." | "Spotlight internal moves and external roles alongside each other. Cross-shift visibility makes the difference on hard-to-fill posts." |
| safety_alert | "All clear — no active alerts." | "When something needs the floor's attention, post here. Severity-sort + ack tracking make sure it reaches the right shift." |

CTA renders a gradient pill via inline `background: linear-gradient(135deg, fromHex, toHex)` with kind-tinted box-shadow. CTA only renders when `onCompose` is provided — read-only viewers don't see it.

### Header primitive

`<BoardHeader>` hosts (in flexbox row):

- **Left** — kind eyebrow chip ([`<LivePulse>` + label + count]), gradient text title, optional subtitle.
- **Right** — actions cluster (extras slot, optional compose button, optional "Display on TV" gradient button).
- **Filters row** — optional `<BoardFilterChips>` strip below.
- **Hairline underline** — `linear-gradient(90deg, transparent, midHex55, transparent)`.

Title uses `bg-clip-text text-transparent` with the kind gradient — reads as a confident editorial mark.

### BoardFilterChips primitive

Single component replaces four duplicated `FilterChips` locals across the four boards. Active chip paints with the kind gradient + soft shadow; inactive renders as a glass pill with `backdrop-blur-sm + border-border/50 + bg-card/60`.

### LivePulse primitive

Two stacked spans: a `motion-safe:animate-ping` halo at 50% opacity + a static inner dot, both kind-coloured. Three size tokens (`sm` / `md` / `lg`). Optional `label` makes the dot announce as `role='img'` for screen readers.

### Variant cards — editorial cascade rebuild

Every variant adopts the **eyebrow → headline → support → meta** rhythm.

| Variant | Hero element | Cover treatment | Hover affordance |
|---|---|---|---|
| `classic` | Headline `text-base` (TV `text-2xl`) | Optional cover image at top, 6s scale-1.03 on hover | Lift + glow span fades in |
| `banner` | Display headline `clamp(2.5rem,5vw,5rem)` | Cover image with 18s Ken Burns + gradient scrim + accent radial bleed BEHIND the type | Lift + 4th shadow stop kind-tinted |
| `gallery` | Glass caption panel with 600ms blur+opacity crossfade + Ken Burns on active slide | Cover is the entire card | Pause on hover, chevrons fade in, dot grows + paints accent |
| `spotlight` | 80px icon bubble + halo + display headline `clamp(2rem,3.5vw,3.5rem)` | None (single-attribute hero) | Lift + 4th shadow stop kind-tinted |
| `quote` | Display blockquote `clamp(2rem,3.5vw,3.5rem)` italic light-weight | Kind-coloured quote glyph in corner @ 18-22% opacity | Lift + glow span fades in |

### Shadow stack

Resting state:

```
inset 0 1px 0 0 rgba(255,255,255,0.06),
0 1px 2px 0 rgba(0,0,0,0.06),
0 12px 32px -12px rgba(15,23,42,0.18)
```

Dark mode resting:

```
inset 0 1px 0 0 rgba(255,255,255,0.06),
0 2px 4px 0 rgba(0,0,0,0.5),
0 24px 56px -16px rgba(0,0,0,0.6)
```

Hover scales the ambient (1→2 / 2→4) and the wide drop (12-32 → 24-56). Banner + spotlight ADD a 4th kind-tinted stop on hover:

```
inset 0 1px 0 0 rgba(255,255,255,0.08),
0 2px 4px 0 rgba(0,0,0,0.08),
0 28px 64px -20px var(--accent-glow),
0 36px 80px -20px rgba(0,0,0,0.5)
```

Where `--accent-glow` is `${accent}55` set inline per card.

### Page header weight reduction

`production-boards-page.tsx` collapsed the previous shadcn-Card-style header (h-14, 24px icon tile, `text-2xl font-bold`, description on its own row) to a slim h-12 inline row:

- 32px icon tile → 24px tile
- `text-2xl font-bold` → `text-[15px] font-semibold tracking-[-0.01em]`
- Description moved inline (separated by a muted `·`), hidden on narrow viewports

The per-board `<BoardHeader>` carries the editorial weight now.

### Tab strip weight reduction

`board-tabs.tsx` dropped the heavy `bg-muted/40 p-1 rounded-xl` wrapper. Tabs render as inline segmented buttons with a hairline border underneath. Active tab paints with the board kind's `midHex` gradient underline (2px hairline + soft glow).

Hourly + SQCDP tabs (not bento boards) fall back to a neutral emerald palette so the chrome stays inside the same vocabulary.

## Validation

- `pnpm vitest run src/features/shift-productivity/production-boards/` — **36 test files, 375 tests, all passing** (was 343 → +32 new across `board-kind-accent` (6), `board-atmosphere` (4), `board-empty-state` (5), `board-header` (6), `board-filter-chips` (4), `live-pulse` (6) — +1 already-passing from `card-shared-utils` change).
- `pnpm exec eslint <touched files>` — **clean** (zero new warnings on every touched file).
- `pnpm exec tsc -b --noEmit` — **clean**.
- `pnpm build` — **successful**. Bundle sizes:
  - `feature-production-boards-bento-Bk0dy-15.js`: **96.71 KB raw / 28.78 KB gzip** (was 76.74 KB / 23.73 KB → net **+19.97 KB raw / +5.05 KB gzip**).
  - `feature-shift-productivity-yZa9gX-M.js`: **474.66 KB raw / 101.08 KB gzip** (was 473.88 KB / 100.75 KB → net **+0.78 KB raw / +0.33 KB gzip**). Well under the 500 KB ceiling.
  - `feature-production-boards-composer`: **77.63 KB** (unchanged).
- `node scripts/check-bundle-budget.mjs` — three pre-existing chunks remain over budget (`warehouse-location-map`, `feature-admin`, `feature-rf-interface`) — unrelated to this slice; documented as pre-existing in the session log. `feature-shift-productivity` reports WARN (463.54 KB gzipped budget number), NOT FAIL.
- `node scripts/lint-ratchet.mjs` — pre-existing 94 warnings vs 16 baseline carries from prior sibling work; touched files contribute zero new warnings (verified via direct `pnpm eslint <touched files>` clean run).

## Decisions log (condensed — full rationale in the ADR)

1. **Adopted Geist for display, system sans for body.** Already loaded by the page — zero bundle cost.
2. **Single `BoardKindAccent` table** as the source of truth for every kind's gradient, glow, eyebrow class, pulse class, tab underline class. Same gradient on eyebrow / pulse / tab / atmosphere / banner shadow / empty-state / CTA / "Display on TV" button.
3. **CSS-only atmosphere layer** — pure keyframes + inline SVG noise. No framer-motion, no canvas, no JS.
4. **Mount stagger via `motion-safe:animate-in` + inline `animationDelay`**, capped at 8 cards. No framer-motion variants on every tile (stutters on 50-card boards).
5. **Banner + spotlight get a 4th kind-tinted shadow stop on hover** via inline `--accent-glow` CSS var.
6. **Page header + tab strip collapse to slim chrome** so the per-board `<BoardHeader>` carries the editorial weight.
7. **Editorial cascade in every variant** — eyebrow → headline → support → meta. The discipline holds the typographic voice together.
8. **Reduced-motion gate on every animation** via `motion-safe:` — reduced-motion users see a static experience with the same elevation + glow at-rest.

## Open follow-ups

- **Custom SVG empty-state illustrations** — the current artwork is CSS-only (gradient rings + icon bubble). If curator feedback asks for bespoke illustration per kind, the surface is there to slot in custom SVGs (4 × ~10-15 KB each ≈ +60 KB lazy chunk — still well inside budget).
- **Per-area atmosphere palette** — the schema already carries `scope`; if a curator wires per-area atmosphere (Announcements board cycling per working-area), pull the area accent from `boards/hourly/lib/area-color.ts` instead of `board-kind-accent.ts`.
- **Promote `<BoardAtmosphere>` + `<LivePulse>` to `src/components/ui/`** once a second consumer outside production-boards picks them up. Currently they live in the production-boards bento namespace.
- **Adopt the cascade on the SQCDP card body** — the SQCDP scorecards use a colored-header-strip variant of [[Elevated-KPI-Stat-Cards]] today. Promoting the eyebrow + display-headline cascade for sub-metric blocks would unify the editorial voice across the whole Production Boards hub. Defer to the concurrent SQCDP agent — don't touch their files in this slice.

## Canonical handles for future tweaks

- **Typography scale**: `TYPE_TOKENS` in `cards/card-shared-utils.ts`. Change tracking / leading / weight per token here, applied to every variant via `cn(TYPE_TOKENS.headline, …)`.
- **Per-kind accents**: `palette` constant in `board-kind-accent.ts`. Change a kind's hex stops here; every consumer (eyebrow / pulse / tab / atmosphere / empty-state / CTA) picks it up.
- **Motion timings**: each component declares its own keyframe + duration inline (`board-mesh` in `board-atmosphere.tsx`, `banner-kenburns` in `banner-card.tsx`, `bento-marquee` in `bento-grid.tsx`, dot crossfade in `gallery-card.tsx`). To tune globally, search for `motion-safe:duration-`.
- **Atmosphere opacity**: `meshOpacity` / `bloomAOpacity` / `bloomBOpacity` / `grainOpacity` in `board-atmosphere.tsx`. Normal density at 7-8-2.5%, TV at 9-10-1.8%.
- **Mount stagger cap**: `MOUNT_STAGGER_MS` / `MOUNT_STAGGER_CAP` in `bento-grid.tsx`. Currently 60ms × min(idx, 8).
- **Shadow stack**: `CARD_SHADOW` + `CARD_SHADOW_HOVER` in `cards/card-shared-utils.ts`. Three-stop base; banner + spotlight add a 4th inline via the kind-tinted CSS variable.

## Related

- [[Decisions/ADR-Production-Boards-Aesthetic-Overhaul]] — the design system + reference designs + alternatives.
- [[Patterns/Premium-Board-Aesthetic]] — the reusable recipe distilled.
- [[Patterns/Bento-Grid-Layout]] — the v1 layout pattern this builds on (v2 aesthetic section added).
- [[Implementations/Implement-Production-Boards-Bento-Layout]] — the v1 implementation note (engineering still in force).
- [[Patterns/Elevated-KPI-Stat-Cards]] — the shadow-stack recipe extended here.
- [[Patterns/Cinematic-Tab-Rotation]] — motion-vocabulary sibling pattern.
- [[Patterns/Dark-Mode-Opacity-Colors]] — opacity-token convention.
- [[Patterns/TV-Viewport-Fit-Grid]] — `clamp()` fluid-type recipe.
- [[Components/ProductionBoards - Feature Module]] — the feature module the overhaul lands on.
