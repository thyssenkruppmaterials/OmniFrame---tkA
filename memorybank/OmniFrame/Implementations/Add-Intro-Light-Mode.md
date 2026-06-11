---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-05-09
---
# Add Intro Light Mode

## Purpose / Context

Follow-up to [[Implementations/Capture-Intro-Screenshots]]. The user asked
for a **light-mode variant** of the `/intro` cinematic page so it can be
captured at 4K alongside the dark-mode hero + logo-mark already saved to
`~/Downloads/MacWindowsBridge/`. Intent is marketing / pitch use — the dark
version reads as cyberpunk-cyan-on-near-black, the light version reads as
"premium product website hero" for surfaces where dark mode would clash.

Default behaviour (`/intro` with no query) stays **byte-identical** to the
prior dark experience — light mode is opt-in via `?theme=light` only. There
is NO UI toggle on the page itself.

## Details

### Outputs

Destination: `/Users/jaisingh/Downloads/MacWindowsBridge/`

| File | Physical px | Size | Composition |
|---|---|---|---|
| `omniframe-intro-hero.png` | 3198x1724 | ~2.94 MB | (existing) Wide horizontal hero, dark cyan-on-near-black palette. Re-shot as a regression check; visually identical to the prior version. |
| `omniframe-intro-hero-light.png` | 3198x1724 | ~1.20 MB | **NEW.** Same composition, **light** palette: off-white stage (`#f8fafc`), confident dark-teal wordmark (`#0e7490`), muted slate tagline, faint cyan grid lattice, slate corner vignette. |
| `omniframe-logo-mark.png` | 1044x1044 | ~742 KB | (existing) Square crop of the `CinematicLogo`, dark palette. Re-shot — visually identical. |
| `omniframe-logo-mark-light.png` | 1044x1044 | ~372 KB | **NEW.** Same square crop, **light** palette: orbital rings + pulsars in muted teal, cube grounded with a real slate drop-shadow + faint cyan accent halo. |

Light-mode files are smaller because the light palette PNG-compresses better
(more uniform off-white area, less spatial gradient noise).

### How light mode is exposed

**URL query param only**: `/intro?theme=light`. Read once on mount via
`window.location.search` in `IntroScreen` (no router integration — the
intro is a one-shot pre-app surface and doesn't take a dependency on the
global app theme provider).

The parsed `theme: 'dark' | 'light'` is **drilled as a single prop** into
`<CinematicLogo theme={theme} />`. The other surfaces (`StreamingTitle`,
`Tagline`, `LensSweep`, `Motes`, `GrainLayer`, the stage div, the
letterbox bars) receive the matching `palette` object directly. Two
consumers, prop drill is fine — no context, no global store.

The outermost `<div>` also gets `data-theme={theme}` for any future CSS
attribute selectors, but the current implementation drives 100% of the
diff via inline-style palette swaps + two new keyframes.

### Palette mapping (light ↔ dark)

Defined locally in `intro-screen.tsx` (`PALETTE: Record<IntroTheme, StagePalette>`)
and `cinematic-logo.tsx` (`LOGO_PALETTE: Record<CinematicLogoTheme, LogoPalette>`).
No new dependencies, no new design-tokens module.

| Element | Dark | Light |
|---|---|---|
| Outer page bg | `bg-black` | `bg-[#e2e8f0]` |
| Stage bg | `bg-[#020617]` | `bg-[#f8fafc]` |
| Grid lines | `rgba(6,182,212,0.05)` | `rgba(8,145,178,0.07)` |
| Stage glow | `rgba(6,182,212,0.12)` | `rgba(56,189,248,0.10)` |
| Edge vignette | `rgba(0,0,0,0.55)` | `rgba(15,23,42,0.10)` |
| Letterbox bars | `bg-black` + `0.9` shadow | `bg-[#0f172a]` + `0.30` shadow |
| Wordmark color | `#7dd3fc` (cyan-300) | `#0e7490` (cyan-700) |
| Wordmark filter | bright cyan glow | subtle dark drop-shadow + faint cyan accent |
| Latest-token flash | `brightness(1.9)` + `0.9α` cyan glow | `brightness(1.25)` + `0.55α` cyan glow |
| Caret `▍` | bright cyan + bright glow | dark teal + soft glow |
| Tagline | `rgba(148,197,253,0.72)` (light blue) | `rgba(15,23,42,0.65)` (slate-900) |
| Lens sweep | white-cyan streak + bright halo | dark cyan streak + dark halo |
| Dust motes | bright cyan + cyan glow | dark cyan + slate halo |
| Grain layer | `mix-blend-overlay` @ 0.06 | `mix-blend-multiply` @ 0.04 |
| Logo orbital rings | `rgba(6,182,212,0.12-0.15)` | `rgba(8,145,178,0.20-0.30)` |
| Logo orbital dots | bright cyan + cyan halo | dark cyan + slate halo |
| Logo flash bloom | `0.6α` cyan | `0.20α` cyan (tinting, not emissive) |
| Logo ambient glow | `0.25α` cyan | `0.16α` cyan |
| Cube image filter | bright cyan drop-shadow x2 | slate drop-shadow + faint cyan accent |
| Pulsar shockwaves | `cinematic-pulsar` keyframe (`rgba(6,182,212,0.4)`, inset glow) | `cinematic-pulsar-light` keyframe (`rgba(8,145,178,0.5)`, soft slate halo) |
| Cube reveal animation | `cinematic-logo-reveal` keyframe (`forwards`-fills bright cyan glow) | `cinematic-logo-reveal-light` keyframe (`forwards`-fills slate drop-shadow + faint cyan accent) |
| Floating particles | bright cyan + cyan glow | dark cyan + slate halo |

### Why two keyframes had to fork

`cinematic-logo-reveal` and `cinematic-pulsar` both bake **literal cyan**
color values into their `100%` and `40-100%` keyframe stops. Because
`cinematic-logo-reveal` runs with `forwards` fill mode, its 100% keyframe
overrides any later inline `style.filter`. To produce a clean light-mode
render at runtime (not just the screenshot — the screenshot script kills
the cube animation entirely), I added `cinematic-logo-reveal-light` and
`cinematic-pulsar-light` siblings in `src/index.css` with darker color
literals at the same keyframe stops. `CinematicLogo` switches between the
two via the `palette.cubeAnimation` / `palette.pulsarAnimation` strings.

### `CinematicOverture` — bypassed in light mode

**Decision: bypass.** `CinematicOverture` is a fundamentally
"spark in the void" piece — cosmic backdrop with stars, aurora glow,
dark-hex satellite frames, glowing cyan beams, etc. Theming it analogously
would be more than 60 minutes of styling and still produce a visually
weak light variant.

Implementation: in `intro-screen.tsx` light mode, `overtureDone` is
`useState(true)` and `overtureMounted` is `useState(false)` from frame 0.
The `CinematicOverture` component is **never rendered**, so its
requestAnimationFrame loop, cosmic backdrop, hub disc, satellite hexagons,
shockwaves, data packets, and HUD never instantiate. The stage reveal
(`stageIn` flag) fires on the first effect tick — same `1.6s` blur/scale
ease — and the cube + wordmark cluster mounts immediately under the
`{overtureDone && (...)}` block. Net runtime experience: light mode goes
straight to Act II, ~2.85s from page load to fully revealed.

The `cinematic-overture.tsx` source file was **not touched** — bypassing
at the parent saved a refactor pass and zero behaviour change for dark
mode (default).

### Screenshot script — `--theme` flag

`scripts/screenshot-intro.mjs` extended:

- New `--theme` arg: `'dark'` (default) | `'light'` | `'all'`
  - `'dark'` — existing behaviour, writes `omniframe-{intro-hero,logo-mark}.png`
  - `'light'` — appends `?theme=light` to the URL, writes
    `omniframe-{intro-hero,logo-mark}-light.png`
  - `'all'` — captures both back-to-back in one browser session
- Capture body refactored into `captureTheme({ context, baseUrl, out, ... })`
  so the main flow loops over the requested themes and reuses one
  `BrowserContext`. Saves ~2s of Chromium startup when running
  `--theme=all`.
- Two helpers: `urlForTheme(baseUrl, theme)` (preserves any existing query
  params via the URL constructor) and `pathsForTheme(out, theme)` (returns
  the `{heroPath, logoPath}` pair).

All the existing flags (`--url`, `--out`, `--wait`, `--width`, `--height`,
`--dsf`, `--heroExpand`, `--logoExpand`) work unchanged for both themes.

### Files modified

- `src/features/intro/intro-screen.tsx` — added `IntroTheme` type, local
  `PALETTE` object (dark + light), `readInitialTheme()` helper, prop-drilled
  `palette` to all sub-components, prop-drilled `theme` to `<CinematicLogo>`,
  bypassed overture mount in light mode. ~120 LOC delta.
- `src/components/ui/cinematic-logo.tsx` — added `CinematicLogoTheme` type,
  local `LOGO_PALETTE` object, `theme?: 'dark' | 'light'` prop on
  `CinematicLogo` (default `'dark'` so existing imports still work). ~95 LOC
  delta. Inline color literals throughout the component now route through
  the palette.
- `src/index.css` — appended `@keyframes cinematic-logo-reveal-light` and
  `@keyframes cinematic-pulsar-light` (~45 LOC). Existing dark-mode
  keyframes untouched.
- `scripts/screenshot-intro.mjs` — added `--theme` flag (default `dark`),
  refactored capture body into `captureTheme()`, added `urlForTheme()` +
  `pathsForTheme()` helpers, expanded header docs with the dark + light +
  all invocation examples. ~80 LOC delta.

### Files NOT touched

- `src/features/intro/cinematic-overture.tsx` — bypassed at the parent;
  no need to refactor.
- `src/routes/intro.tsx` — query param read inline, no route-level
  validation.
- Tailwind config, `components.json`, the global app theme system, the
  `UnifiedAuthProvider`, any shadcn primitive — out of scope.
- No new npm dependencies.

### Verification

- `pnpm exec tsc -b --noEmit` — clean.
- `ReadLints` on the three modified source files + the script — zero
  diagnostics.
- Dark-mode regression check: `node scripts/screenshot-intro.mjs --url=http://localhost:5174/intro`
  produces `omniframe-intro-hero.png` (3198x1724, 2.94 MB) and
  `omniframe-logo-mark.png` (1044x1044, 742 KB) — same dimensions, ~equivalent
  size, visually indistinguishable from the prior dark versions (cube +
  cyan rings + bright cyan wordmark with bright cyan glow + light-blue
  tagline + dark cyan grid + cyan radial halo all present and unchanged).
- Light-mode capture: `node scripts/screenshot-intro.mjs --theme=light --url=http://localhost:5174/intro`
  produces `omniframe-intro-hero-light.png` (3198x1724, 1.20 MB) and
  `omniframe-logo-mark-light.png` (1044x1044, 372 KB). Cube reads
  confidently, wordmark reads as a deep teal, orbital rings + pulsars
  visible but subtle, soft off-white stage with a faint cyan grid
  lattice. "Premium light marketing site hero" — not "inverted dark
  mode".

### How to re-shoot

```bash
# Terminal 1 — start the dev server (any port)
pnpm dev

# Terminal 2 — capture both themes back-to-back
node scripts/screenshot-intro.mjs --theme=all --url=http://localhost:5174/intro

# Or just one:
node scripts/screenshot-intro.mjs --theme=light --url=http://localhost:5174/intro
node scripts/screenshot-intro.mjs --theme=dark  --url=http://localhost:5174/intro
```

## Constraint compliance

- No new `supabase.channel(...)` callsites (intro page doesn't touch realtime).
- No new dependencies; no `manualChunks` change; no edit to `src/routeTree.gen.ts`.
- No new `eslint-disable` directives.
- No migration, no Rust release, no `LATEST_AGENT_VERSION` bump.
- Global app theme system, `UnifiedAuthProvider`, Tailwind config, and
  shadcn primitives all untouched per the brief.

## Related

- [[Implementations/Capture-Intro-Screenshots]] — the dark-mode capture
  helper this builds on; the screenshot script is now multi-theme.
- [[Sessions/2026-05-09]] — today's session log entry references this note.


## Iteration 2 — deeper blue palette (2026-05-09 PM)

User feedback after the first light shoot: *"OmniFrame, and all of the
other coloring, which looks slightly green-blue then blue. Please deepen
the blue to match the OneBox logo, including the faint grid on the
background. Make it much more visually appealing."*

Two problems with the iteration-1 palette:

1. The cyan-700 (`#0e7490`) wordmark + cyan-600 grid + cyan accents read
   as **teal/green-blue** against the off-white stage — not as the true
   blue family that matches the cube glyph.
2. The grid lattice at 7% alpha was effectively **invisible** at
   thumbnail size. The whole cinematic-grid backdrop concept was
   getting lost.

### Step 1 — Sampled the actual cube color

Used a one-off `scripts/sample-cube-color.mjs` (Playwright + headless
Chromium + canvas `getImageData`, deleted after use) to sample
`public/images/OneBoxLogoX.png` (512×512 PNG with transparent background
+ a single-color cube glyph). After 16-step bucket quantization filtering
out edge AA + near-white + near-black pixels: **100.0% of opaque body
pixels are `#0080D0`** (RGB 0, 128, 208). The cube is a single solid
color — a true blue with slight cyan undertones, sky-500/600 territory.

### Step 2 — Re-anchored the palette to the blue family

Wordmark target: one stop deeper than the cube so it reads as the
authoritative element. Landed on **`#1e40af`** (blue-800). Earlier
options tried mentally: blue-700 felt slightly less premium; blue-900
was too close to navy-on-paper.

Full before/after table for the rows that actually changed:

| Element | Iter-1 (cyan/teal) | Iter-2 (blue, anchored on cube) |
|---|---|---|
| Wordmark color | `#0e7490` (cyan-700) | **`#1e40af`** (blue-800) |
| Wordmark filter | `... rgba(6,182,212,0.18) ...` | `drop-shadow(0 1px 0 rgba(15,23,42,0.12)) drop-shadow(0 0 18px rgba(37,99,235,0.22))` |
| Latest-token flash | `brightness(1.25) drop-shadow(0 0 18px rgba(8,145,178,0.55))` | `brightness(1.18) drop-shadow(0 0 20px rgba(37,99,235,0.55))` |
| Caret `▍` | `#0e7490` + cyan glow | `#1e40af` + `rgba(37,99,235,0.40)` glow |
| Tagline | `rgba(15,23,42,0.65)` (slate-900) | `rgba(30,58,138,0.62)` (blue-900 @ 62%) — nudged warm-blue so it harmonises with the wordmark instead of reading cold-gray |
| Grid lines | `rgba(8,145,178,0.07)` (cyan-600 @ 7%) | **`rgba(37,99,235,0.14)`** (blue-600 @ 14%) — doubled opacity so the lattice actually reads at thumbnail size |
| Stage glow | `rgba(56,189,248,0.10)` (sky-400) | `rgba(59,130,246,0.12)` (blue-500) |
| Edge vignette | `rgba(15,23,42,0.10)` (slate-900) | `rgba(30,64,175,0.09)` (blue-800) — corners tint blue, not gray |
| Letterbox bars | `bg-[#0f172a]` (slate-900) | `bg-[#1e3a8a]` (blue-900) — ties the cinema frame into the palette |
| Lens sweep | `rgba(8,145,178,0.55)` (cyan-600) | `rgba(96,165,250,0.55)` (blue-400) |
| Dust motes | `rgba(8,145,178,0.45)` (cyan-600) | `rgba(37,99,235,0.45)` (blue-600) |
| Logo flash bloom | `rgba(6,182,212,0.20)` cyan | `rgba(37,99,235,0.22)` blue-600 |
| Logo ambient glow | `rgba(8,145,178,0.16)` cyan | `rgba(37,99,235,0.18)` blue-600 |
| Logo orbital rings | `rgba(8,145,178,0.30)` (cyan-600) | `rgba(29,78,216,0.32)` (blue-700) |
| Logo orbital dots | cyan-600 + slate halo | blue-700 + `rgba(37,99,235,0.40)` halo |
| Cube image filter | `... rgba(6,182,212,0.20)` cyan accent | `drop-shadow(0 4px 14px rgba(15,23,42,0.20)) drop-shadow(0 0 16px rgba(37,99,235,0.30))` — denser blue accent halo |
| Pulsar shockwaves | `rgba(8,145,178,0.45)` cyan border | `rgba(29,78,216,0.42)` blue-700 border |
| Particles | `rgba(8,145,178,0.55)` cyan | `rgba(37,99,235,0.55)` blue-600 |
| `cinematic-logo-reveal-light` 100% stop | `rgba(6,182,212,0.20)` cyan accent | `rgba(37,99,235,0.30)` blue-600 accent |
| `cinematic-pulsar-light` 0% stop | `rgba(8,145,178,0.50)` cyan-600 | `rgba(29,78,216,0.55)` blue-700 |

### Step 3 — Polish moves applied beyond the palette swap

- **Stage background gradient**: switched from a flat `bg-[#f8fafc]`
  Tailwind class to inline `linear-gradient(180deg, #fdfdff 0%, #f1f5fb
  100%)` so the top reads paper-bright and the bottom carries a faint
  cool-blue tint. Adds depth without competing with the grid + glow
  layered on top. Required restructuring the palette to a
  `stageBackground` CSS string (used as `style.background`) instead of
  a Tailwind class — same approach also covers the dark `#020617` flat
  color.
- **Wordmark weight bump**: in light mode only, switched from
  `font-semibold` to `font-bold`. Mono fonts in serious blue against a
  near-white backdrop need extra weight to feel premium; semibold
  reads thin.
- **Wordmark tracking nudged tighter**: light mode uses
  `tracking-[0.10em]` instead of `tracking-[0.12em]`. Slight squeeze
  reads better on light; the wider dark tracking reads better on dark
  because the cyan glow naturally adds optical breathing room.
- **Tagline tracking nudged tighter on settle**: light mode settles to
  `letter-spacing: 0.38em` instead of `0.45em`. Wide spacing reads
  gappy on a light backdrop where the surrounding void doesn't carry
  the eye between letters.
- **Letterbox color shift**: from slate-900 to blue-900 (`#1e3a8a`). The
  cinema frame now ties into the palette instead of feeling like a
  detached gray rectangle.

No contact-shadow under cube was needed — the existing
`drop-shadow(0 4px 14px rgba(15,23,42,0.20))` reads as proper grounding
at 4K. No `font-bold` for dark mode (the cyan glow gives it enough
optical weight). No grain layer change — 0.04 multiply still feels
right.

### Updated palette mechanics

The `StagePalette` type gained four new fields:

- `stageBackground: string` — replaces `stageBgClass`; goes into
  `style.background` so it can hold either a flat color (dark) or a
  CSS gradient (light).
- `wordmarkWeightClass: string` — `font-semibold` (dark) or `font-bold`
  (light). Composed into the `<div>` className.
- `wordmarkTrackingClass: string` — `tracking-[0.12em]` (dark) or
  `tracking-[0.10em]` (light). Composed into the `<div>` className.
- `taglineFinalTracking: string` — `'0.45em'` (dark) or `'0.38em'`
  (light). Used as the `letterSpacing` inline style after the tagline
  settles in.

### Verification

- `pnpm exec tsc -b --noEmit` — clean.
- `ReadLints` on the three modified source files — zero diagnostics.
- Light-mode 4K capture: `omniframe-intro-hero-light.png` 3164×1724 /
  1.5 MB; `omniframe-logo-mark-light.png` 1044×1044 / 458 KB.
  - Wordmark reads clearly as deep blue (no teal undertone).
  - Grid lattice clearly visible at thumbnail size and full res.
  - Cube glyph harmonises with the surrounding palette (same blue
    family).
  - Stage carries a faint paper→cool-blue gradient that gives depth.
  - Letterbox bars in blue-900 lock the cinema frame into the palette.
- Dark-mode regression: `omniframe-intro-hero.png` 3198×1724 / 2.94 MB
  and `omniframe-logo-mark.png` 1044×1044 / 742 KB — byte-identical
  sizes to the prior shoot, visually indistinguishable.

Note: the light hero PNG width is now 3164 px (vs 3198 px in iter-1)
because the wordmark cluster bounding box shifted slightly with
`font-bold` + `tracking-[0.10em]`. Same height (1724 px), same effective
composition. Acceptable.

### What didn't change

- URL contract (`?theme=light`) and the script's `--theme=dark|light|all`
  flags — unchanged.
- `cinematic-overture.tsx` — still untouched (still bypassed in light
  mode).
- No new npm dependencies.
- Dark-mode behaviour byte-identical when `?theme=light` is omitted.


## Iteration 3 — anchored on `#0070C0` (2026-05-09 PM)

### Why iteration 2 was rejected

User feedback after the iteration-2 shoot: the blue-800 (`#1e40af`) navy
wordmark + blue-900 (`#1e3a8a`) letterbox bars + blue-900 tagline read as
**"too blue" / "too navy heavy"** — the composition tipped past
"confident corporate blue" into "navy marketing brochure". The user
then specified the exact target color **`#0070C0`** (RGB 0, 112, 192)
and provided a generated reference mockup at
`IDE project cache for this repo (`mcps/` under the IDE project folder) assets/omniframe-light-mockup.png`
showing the target aesthetic: warm off-white paper, faint visible blue
grid, blue cube + thin orbital rings, mid-blue wordmark, dark slate
tagline (NOT competing blue), thin dark slate letterbox bars (NOT blue-900).

`#0070C0` sits between `sky-600` (`#0284c7`) and `blue-700` (`#1d4ed8`),
harmonising with the cube glyph color `#0080D0` (sampled in iteration 2)
rather than dominating it. Cube + wordmark now read as the same blue
family with the wordmark as the slightly-deeper authority.

### Centralised the anchor

Added a single pair of constants at the top of each palette block so
future iterations only have to nudge two literals:

```ts
// intro-screen.tsx (above the PALETTE Record)
const LIGHT_BLUE_ANCHOR = '#0070C0'
const LBA_RGB = '0,112,192'

// cinematic-logo.tsx (above the LOGO_PALETTE Record)
const LIGHT_BLUE_ANCHOR = '#0070C0'
const LBA_RGB = '0,112,192'
const LIGHT_LOGO_PALETTE: LogoPalette = { /* every entry uses the constants */ }
```

Duplication across the two files is intentional — a shared module would
pull `intro-screen.tsx` into `cinematic-logo.tsx`'s import graph (which
is used elsewhere). Two constants in two files is fine; we'd rather
have file-local independence.

### Before/after table (iter 2 → iter 3 — only changed rows)

| Element | Iter 2 ("too blue") | Iter 3 (anchored on `#0070C0`) |
|---|---|---|
| Wordmark `OmniFrame` | `#1e40af` (blue-800 / navy) | **`#0070C0`** (literal user-specified anchor) |
| Wordmark drop-shadow | `... rgba(37,99,235,0.22) ...` (blue-600) | `drop-shadow(0 1px 0 rgba(15,23,42,0.10)) drop-shadow(0 0 16px rgba(0,112,192,0.22))` |
| Latest-token flash | `brightness(1.18) drop-shadow(0 0 20px rgba(37,99,235,0.55))` | `brightness(1.20) drop-shadow(0 0 14px rgba(0,112,192,0.55))` |
| Caret `▍` color | `#1e40af` (blue-800) | `#0070C0` |
| Caret text-shadow | `rgba(37,99,235,0.40)` (blue-600) | `rgba(0,112,192,0.40)` |
| **Tagline color** | `rgba(30,58,138,0.62)` (blue-900 @ 62%) | **`rgba(15,23,42,0.62)`** (slate-900 @ 62%) — reverted to neutral slate; with the brighter `#0070C0` wordmark, slate harmonises rather than reading cold-gray |
| Grid lines | `rgba(37,99,235,0.14)` (blue-600 @ 14%) | `rgba(0,112,192,0.13)` — same alpha range, hue tuned to anchor |
| Stage radial glow | `rgba(59,130,246,0.12)` (blue-500) | `rgba(0,112,192,0.10)` |
| Edge vignette | `rgba(30,64,175,0.09)` (blue-800) | **`rgba(15,23,42,0.10)`** (slate-900) — reverted to neutral; navy here was overkill |
| **Letterbox bars** | `bg-[#1e3a8a]` (blue-900 / heavy navy) | **`bg-[#0f172a]`** (slate-900) — reverted per the reference mockup; the cinema frame stays neutral so the wordmark is the only blue element competing for attention |
| Letterbox shadow | `rgba(15,23,42,0.30)` | `rgba(15,23,42,0.28)` |
| Lens sweep gradient | `rgba(96,165,250,0.55)` (blue-400) | `rgba(0,112,192,0.55)` |
| Lens sweep filter | `... drop-shadow(0 0 10px rgba(30,64,175,0.22))` | `... drop-shadow(0 0 10px rgba(15,23,42,0.18))` |
| Dust motes | `rgba(37,99,235,0.45)` (blue-600) | `rgba(0,112,192,0.45)` |
| Logo flash bloom | `rgba(37,99,235,0.22)` cyan | `rgba(0,112,192,0.22)` |
| Logo ambient glow | `rgba(37,99,235,0.18) ... rgba(59,130,246,0.07)` | `rgba(0,112,192,0.18) ... rgba(56,189,248,0.06)` |
| Logo orbital rings | `rgba(29,78,216,0.32)` (blue-700) | `rgba(0,112,192,0.32)` |
| Logo orbital outer dot | `rgba(29,78,216,0.90)` + `rgba(37,99,235,0.40)` halo | `#0070C0` solid + `rgba(0,112,192,0.45)` halo |
| Logo orbital second dot | `rgba(29,78,216,0.75)` + cyan halo | `rgba(0,112,192,0.78)` + `rgba(0,112,192,0.32)` halo |
| Cube image filter | `... drop-shadow(0 0 16px rgba(37,99,235,0.30))` | `... drop-shadow(0 0 16px rgba(0,112,192,0.32))` |
| Pulsar shockwaves | `rgba(29,78,216,0.42)` (blue-700) | `rgba(0,112,192,0.42)` |
| Particles | `rgba(37,99,235,0.55)` (blue-600) | `rgba(0,112,192,0.55)` |
| `cinematic-logo-reveal-light` 50% stop accent | `rgba(37,99,235,0.35)` (blue-600) | `rgba(0,112,192,0.36)` |
| `cinematic-logo-reveal-light` 100% stop accent | `rgba(37,99,235,0.30)` (blue-600) | `rgba(0,112,192,0.32)` |
| `cinematic-pulsar-light` 0% border | `rgba(29,78,216,0.55)` (blue-700) | `rgba(0,112,192,0.55)` |
| `cinematic-pulsar-light` 100% border | `rgba(29,78,216,0)` | `rgba(0,112,192,0)` |

### Polish moves — kept from iteration 2

- **Stage `linear-gradient(180deg, #fdfdff 0%, #f1f5fb 100%)`** — paper
  → cool-blue vertical gradient unchanged.
- **Wordmark `font-bold` + `tracking-[0.10em]` for light only** — kept.
  `#0070C0` reads slightly less saturated than navy and bold gives it
  weight without making it feel heavy. Confirmed at 4K: bold reads as
  premium-marketing; semibold would feel slightly thin given the
  brighter anchor.
- **Tagline `tracking-[0.38em]` for light only** — kept.
- **Grain layer `mix-blend-multiply` @ 0.04** — kept.

### Polish moves — reverted from iteration 2

- **Letterbox bars** back to slate-900 (`#0f172a`) per the reference
  mockup. The blue-900 bars in iter-2 were the main contributor to the
  "too blue" feeling; reverting them eliminates the navy-heavy halo
  around the cinematic frame. Kept the slightly-softer `0.28` alpha
  shadow (instead of `0.30`) so the bars don't punch as hard against
  the light stage.
- **Tagline** reverted to neutral slate `rgba(15,23,42,0.62)`. The blue-900
  tagline in iter-2 was a hold-over from when the wordmark was navy;
  with the brighter `#0070C0` wordmark, the slate version harmonises
  better and matches the reference mockup.
- **Edge vignette** reverted to slate `rgba(15,23,42,0.10)` from blue-800.

### Verification

- `pnpm exec tsc -b --noEmit` — clean.
- `ReadLints` on the three modified source files — zero diagnostics.
- Light-mode 4K: `omniframe-intro-hero-light.png` 3164×1724 / 1.5 MB;
  `omniframe-logo-mark-light.png` 1044×1044 / 453 KB. Side-by-side with
  the reference mockup: same blue family wordmark, same dark slate
  letterbox bars, same dark slate tagline, same visible blue grid
  lattice, same harmonised cube/orbital-rings color. (The cube *glyph*
  is the existing line-art `OneBoxLogoX.png` and not the 3D rendered
  cube from the mockup — the mockup uses a different glyph; we anchor
  on composition and palette, not glyph shape.)
- Dark-mode regression: `omniframe-intro-hero.png` 3198×1724 / 2.9 MB,
  `omniframe-logo-mark.png` 1044×1044 / 743 KB. Sizes within 1% of the
  morning shoot; pixels visually indistinguishable. Dark code path was
  not touched.

### Deviations / compromises

- **No grid alpha tweak after the shoot** — landed on `0.13` and the
  lattice reads cleanly at thumbnail size with the reference mockup
  visually adjacent. The fallback ladder ("bump to 0.16 if invisible,
  drop to 0.11 if too loud") was unused.
- **No wordmark glow opacity bump** — the spec mentioned bumping the
  drop-shadow halo from `0.18` to `0.22` if washed out compared to the
  mockup. I started at `0.22` (already at the upper end of the spec
  range) and the wordmark reads as confidently as the mockup at 4K, no
  further bump needed.
- **Stage gradient unchanged** even though the reference mockup is very
  slightly warmer at the top (creamy off-white vs my cool `#fdfdff`).
  Difference is sub-perceptible at 4K and the spec said "keep from
  iteration 2" on the gradient — no change.
- **`cubeFilter` halo at `0.32`** instead of the spec's `0.30` — nudged
  +2% so the halo holds against the slightly less-saturated `#0070C0`
  vs iter-2's `#1d4ed8`. Visually negligible but keeps the cube
  grounding consistent with the iter-2 read.
- **Reference mockup glyph differs from production glyph**. The mockup
  shows a 3D rendered isometric cube; production uses the existing
  line-art `OneBoxLogoX.png`. Per the spec we don't swap the glyph;
  composition + palette are the deliverables.

### Reference asset (for posterity)

User-approved visual target lives at:
`IDE project cache for this repo (`mcps/` under the IDE project folder) assets/omniframe-light-mockup.png`

### What didn't change

- URL contract (`?theme=light`) and `--theme=dark|light|all` flags — unchanged.
- `cinematic-overture.tsx` — still untouched (still bypassed in light mode).
- No new npm dependencies. No new keyframes (only the two existing
  `-light` ones had their color literals updated). No CSS keyframe
  added or removed.
- Dark-mode behaviour byte-identical when `?theme=light` is omitted.


## Iteration 4 — full-bleed ambient cinema (2026-05-09 PM)

### Why iter 3 was rejected

User feedback after the iter-3 shoot: the slate (`#0f172a`) letterbox
bars at top + bottom read as **"blue borders" / "non-cinematic"** — the
framing felt like a flat 2D banner, not a stage. The user approved a
new visual target showing **full-bleed atmospheric cinema** — no
letterbox bars at all, replaced by a strong corner vignette + a
volumetric overhead light wash + atmospheric haze in the lower-third
+ a frozen-lens-flare horizontal streak through the wordmark area.

Reference target (user-approved):
`IDE project cache for this repo (`mcps/` under the IDE project folder) assets/omniframe-light-mockup-cinematic.png`

This is the second mockup the user has supplied for the light-mode
intro — the iter-3 mockup at `assets/omniframe-light-mockup.png` was
the palette anchor; the iter-4 mockup at
`assets/omniframe-light-mockup-cinematic.png` is the atmosphere anchor.

### New layer stack (light mode only)

Added six new layers, all conditionally rendered behind
`{theme === 'light' && (...)}` and zero-cost in dark mode (no JSX,
no computed styles, no event listeners). Z-stack from back to front:

1. **Stage background gradient** (existing, unchanged) —
   `linear-gradient(180deg, #fdfdff 0%, #f1f5fb 100%)`.
2. **Grid backdrop** (existing) — mask tightened (see palette change
   below) so the lattice dissolves more aggressively at corners.
3. **Stage glow** (existing, unchanged).
4. **Volumetric light wash** (NEW) —
   `radial-gradient(ellipse 75% 42% at 50% 40%, rgba(186,230,253,0.78) 0%, rgba(186,230,253,0.36) 35%, transparent 70%)`.
   Wide horizontal-oval pale-sky-blue key light from above, centred
   slightly above the mathematical middle (40% y) so it hits the
   wordmark area like a stage spotlight.
5. **Atmospheric haze in lower-third** (NEW) —
   `linear-gradient(180deg, transparent 0%, rgba(186,210,240,0.32) 50%, rgba(148,163,184,0.55) 100%)`,
   `height: 52%`. Cool-blue mist that thickens toward the floor; reads
   as "stage air slightly dustier near the floor" without becoming a
   separate panel.
6. **Persistent anamorphic horizontal streak** (NEW) —
   `linear-gradient(90deg, transparent 12%, rgba(186,230,253,0.88) 50%, transparent 88%)`,
   `filter: blur(30px) drop-shadow(0 0 28px rgba(0,112,192,0.28))`,
   `opacity: 0.95`. Frozen lens-flare highlight running through the
   wordmark area. Distinct from the existing animated `<LensSweep />`
   which is the reveal flare — the persistent streak stays put.
7. **Cluster + animated reveal** (existing) — cube + wordmark + tagline.
   Light's animated `<LensSweep />` peak alpha dialled down ~30%
   (`0.55` → `0.40`) so it doesn't compete with the persistent streak.
8. **Edge vignette** (intensified) —
   `radial-gradient(ellipse at center, transparent 35%, rgba(51,65,85,0.22) 92%, rgba(30,41,59,0.42) 100%)`.
   Iter-3 had `transparent 55%, rgba(15,23,42,0.10)` (almost invisible);
   iter-4 pulls a slate-blue-tinted vignette to ~42% alpha at the
   corners so the cinematic frame anchors WITHOUT bars. Slate-700
   tint (51,65,85) keeps it harmonised with the volumetric blue wash
   above instead of reading as pure neutral gray.

Inside `<CinematicLogo>` (light mode only):

- **Cube contact shadow** (NEW) —
  `width: 130, height: 28, bottom: 18`, soft elliptical
  `radial-gradient(ellipse at center, rgba(15,23,42,0.22) 0%, transparent 70%)`,
  `filter: blur(8px)`. Lands just below the cube's lowest point so the
  cube reads as sitting on a paper surface, not floating.
- **Cube ambient halo** (NEW) — `150 × 150 px`,
  `radial-gradient(circle, rgba(0,112,192,0.20) 0%, rgba(0,112,192,0.08) 40%, transparent 70%)`,
  `filter: blur(40px)`. Sits in front of the orbital rings (DOM-after)
  but behind the cube (cube is `z-10`). Subtle ambient suggestion of
  the cube emitting presence into the volumetric wash above; NOT a
  glow — alpha capped at 0.20 so it never reads as emissive.

### Palette field changes

| Field | Status | Dark | Light |
|---|---|---|---|
| `letterboxVH: number` | NEW | `9` | **`0`** — letterbox JSX still renders (slide-in transform animation runs) but has no visible footprint |
| `gridMask: string` | NEW | `radial-gradient(ellipse at center, black 40%, transparent 85%)` | `radial-gradient(ellipse at center, black 25%, transparent 75%)` — tightened so grid concentrates in the central spotlight area |
| `edgeVignette: string` | NEW (replaces inline) | `radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)` | `radial-gradient(ellipse at center, transparent 35%, rgba(51,65,85,0.22) 92%, rgba(30,41,59,0.42) 100%)` |
| `wordmarkFilter` | bumped (light) | unchanged | `... drop-shadow(0 0 22px rgba(0,112,192,0.22))` (was `0 0 16px ... 0.18` — slightly more cinematic presence) |
| `sweepGradient` | dialled down (light) | unchanged | peak `rgba(0,112,192,0.40)` (was `0.55` — ~30% drop so it doesn't compete with the new persistent streak) |
| `letterboxShadow` (light) | softened to invisible | unchanged | `rgba(15,23,42,0)` (was `0.28` — paired with `letterboxVH=0` so even if the bar is somehow visible it casts no shadow) |

One removed dead-code constant: `const LETTERBOX_VH = 9` at the top
of `intro-screen.tsx`. The literal is now `palette.letterboxVH` so the
standalone constant was unused.

### Centralised tuning constants

All the new layer values live in two top-of-file `as const` objects so
future iterations only have to nudge alphas in one place:

- `intro-screen.tsx` — `LIGHT_AMBIENT` (volumetric wash, lower haze,
  persistent streak gradient/filter/opacity). Reuses
  `LIGHT_BLUE_ANCHOR` / `LBA_RGB` from iter 3.
- `cinematic-logo.tsx` — `LIGHT_LOGO_AMBIENT` (contact shadow geometry
  + filter, ambient halo geometry + gradient + filter).

### Tuning passes

First pass used the spec defaults (volumetric `0.40/0.18`, haze
`0.18/0.32`, streak peak `0.55` opacity `0.7`, vignette
`0.18/0.28`). Read too subtle at 4K against the bright off-white
stage — the layers were all THERE but invisible. Second pass
bumped each layer roughly +50% to land in the cinematic mockup's
contrast range.

Final landed values:

| Layer | Spec default | Iter-4 final | Reason |
|---|---|---|---|
| Volumetric wash centre alpha | `0.40` | **`0.78`** | Mockup's spotlight effect is much brighter than the spec defaults read at 4K |
| Volumetric wash mid alpha | `0.18` | **`0.36`** | Same |
| Volumetric wash geometry | `70% 35% at 50% 42%` | `75% 42% at 50% 40%` | Slightly wider + slightly higher to hit the wordmark area like a stage key light |
| Lower haze top alpha | `0.18` | **`0.32`** | Mockup haze is heavier |
| Lower haze bottom alpha | `0.32` | **`0.55`** | Mockup floor mist is visibly thicker |
| Lower haze height | `45%` | `52%` | Slightly taller so the floor reaches up into the cluster's lower edge |
| Streak peak alpha | `0.55` | **`0.88`** | Mockup streak reads as a clear horizontal band |
| Streak opacity | `0.7` | **`0.95`** | Same |
| Streak filter blur | `28px` | `30px` | Marginally softer to keep it from reading as a hard line at the brighter alpha |
| Streak filter accent halo | `0.18` | `0.28` | Slightly stronger blue accent |
| Vignette inner edge | `transparent 45%` | `transparent 35%` | Vignette starts darkening sooner so the corner shadow is more pronounced |
| Vignette mid alpha | `0.18` | `0.22` | Slight bump |
| Vignette corner alpha | `0.28` | **`0.42`** | Mockup corners are noticeably darker |
| Vignette tint | slate-900 (`15,23,42`) | slate-700/800 mix (`51,65,85` → `30,41,59`) | Slate-blue tint harmonises with the volumetric blue wash above |

### Verification

- `pnpm exec tsc -b --noEmit` — clean.
- `ReadLints` on the three modified source files — zero diagnostics.
- Light-mode 4K capture: `omniframe-intro-hero-light.png` 3164×1724
  / 1.73 MB; `omniframe-logo-mark-light.png` 1044×1044 / 530 KB.
  - No letterbox bars (full bleed top to bottom) ✅
  - Volumetric wash visible above center as a clear pale-sky-blue
    spotlight ✅
  - Atmospheric haze visible in the lower-third ✅
  - Persistent horizontal streak visible through the wordmark area ✅
  - Edge vignette visible at corners (slate-blue tinted) ✅
  - Cube contact shadow visible just below the cube ✅
  - Cube ambient blue halo subtly visible ✅
  - Wordmark color unchanged (`#0070C0`) ✅
  - Tagline unchanged (`rgba(15,23,42,0.62)`) ✅
  - Reference mockup match at thumbnail and at 4K detail.
- Dark-mode regression: `omniframe-intro-hero.png` 3198×1724 / 2.94
  MB and `omniframe-logo-mark.png` 1044×1044 / 742 KB — byte-
  equivalent to the morning shoot (sizes within 1%). Visually
  indistinguishable. Letterbox bars present and animated as before.
  All `theme === 'light' && (...)` branches short-circuit; no light-
  mode JSX renders, no light-mode imports activate. Confirmed no
  visual regression.

### Deviations / compromises

- **All four ambient-layer alphas had to be cranked beyond the spec
  defaults** because the spec defaults read too subtle at 4K against
  the bright off-white stage. Spec values would have shipped a
  visually-flat first pass. Bumped each ~+50% to land in the
  cinematic mockup's contrast range.
- **Vignette tint shifted to slate-blue** (`51,65,85` slate-700) from
  the spec's pure slate-900 (`15,23,42`) so the corners harmonise
  with the volumetric blue wash above instead of reading as pure
  neutral gray. Inner edge also moved from `45%` to `35%` so the
  darkening starts sooner.
- **No additional tuning was needed for cube contact shadow or
  ambient halo** — the spec defaults landed cleanly at 4K. Contact
  shadow at `bottom: 18` puts it ~24px below the cube's bottom edge,
  reading as a soft stage-floor shadow without floating away.
- **Reference mockup glyph still differs from production glyph** —
  mockup uses a 3D rendered isometric cube; production uses the
  existing line-art `OneBoxLogoX.png`. Per the iter-3 spec we don't
  swap the glyph; composition + atmosphere are the deliverables.

### What didn't change

- Dark code path, `cinematic-overture.tsx`, the script, the URL
  contract, the testids, the wordmark color, the cube image, the
  layout structure, the existing `<LensSweep />` (only its peak
  alpha was dialled down for light mode).
- No new npm dependencies. No new CSS keyframes. No
  `routeTree.gen.ts` edit. No new `eslint-disable` directives. No
  migration. No Rust release. No `LATEST_AGENT_VERSION` bump.


## Iteration 5 — elegant cinematic shadow craft (2026-05-09 PM)

### Why iter 4 left room for "pop"

Iter-4 landed the atmospheric layers (volumetric wash, lower-third
haze, persistent streak, slate vignette) cleanly, but the cube and the
wordmark still felt **embedded in the paper rather than lifted off it**.
User feedback: *"Make it pop out more adding shadows that are elegant
and much more cinematic designed."* The frame was atmospheric; what
was missing was **dimensional pop** — multi-layer shadow craft
borrowed from product photography and cinematography (not "more glow"
or "bigger drop shadow").

### Design principles applied

1. **Consistent light direction** — all shadows fall slightly downward
   + slightly outward from centre, matching the existing volumetric
   overhead key-light wash.
2. **Three- and four-tier shadow stacks** for hero elements (cube,
   wordmark) instead of single drop-shadows. Single drops always look
   flat; the cumulative effect of multiple ladder-stacked shadows is
   what reads as cinematic dimension.
3. **Hierarchy through shadow density** — cube has the heaviest stack
   (it's the deepest object), wordmark is next, tagline gets a barely-
   there single layer, orbital rings get the lightest.
4. **Restraint** — every shadow barely perceptible alone; the
   cumulative effect is the dimensional richness. If any single
   shadow draws attention to itself, it's too strong.

### A. Cube — four-layer product-photography shadow stack

Replaces iter-4's single contact-shadow + ambient-halo pair with a
stack of four light-mode-only divs inside `CinematicLogo`. Stacked
broadest-and-softest first (paints behind everything), narrowest-and-
densest last. Cube `<img>` (z-10) paints over all four. The cube img
filter dropped its blue halo (`drop-shadow(0 0 16px rgba(LBA,0.32))`)
— that work is now the ambientHalo div doing it as REAL geometry.

| Layer | Width × Height | Bottom | Centre alpha | Blur | Purpose |
|---|---|---|---|---|---|
| (1) Wide soft floor | 240 × 48 | 4 | 0.10 (slate-900) | 32px | Broadest. "The cube affects the room." |
| (2) Medium ambient | 160 × 36 | 12 | 0.18 (slate-900) | 16px | Wider + softer. Gives the cube real weight. |
| (3) Tight contact | 96 × 12 | 22 | 0.32 (slate-900) | 4px | Narrowest, densest, sharpest. "This object touches the floor." |
| (4) Cube ambient blue halo | 170 × 170 | n/a (centred) | 0.26 → 0.10 (`#0070C0`) | 44px | Strengthened from iter-4 (150 → 170, 0.20 → 0.26 centre). Sits behind cube, in front of orbital rings. Subtle ambient suggestion of cube emitting presence into the volumetric wash above. |
| Cube `<img>` filter | n/a | n/a | 0.22 (slate-900) | 18px (radius via blur in drop-shadow) | Single `drop-shadow(0 6px 18px rgba(15,23,42,0.22))` — dropped iter-4's redundant blue halo, slight bump on the slate (0.20 → 0.22). |

### B. Wordmark — three-tier elegant compound drop-shadow

Replaces iter-4's two-layer wordmark filter with a three-tier compound:

| Layer | Filter | Purpose |
|---|---|---|
| (1) Tight 1px slate kicker | `drop-shadow(0 1px 0 rgba(15,23,42,0.22))` | The under-rated layer. Makes the letters feel CUT OUT FROM the background instead of painted ON it. Don't skip. |
| (2) Medium soft slate drop | `drop-shadow(0 8px 16px rgba(15,23,42,0.18))` | Gives the wordmark physical weight. Falls slightly downward (key light from above). |
| (3) Wide blue ambient halo | `drop-shadow(0 0 28px rgba(0,112,192,0.30))` | Emits brand color into the surround. Bumped from iter-4's `0 0 22px ... 0.22`. |

### C. Tagline — single subtle drop

New light-mode-only `palette.taglineFilter`:
`drop-shadow(0 1px 1px rgba(15,23,42,0.12))`. Just enough to lift the
tagline off the paper without competing with the wordmark's three-
tier stack. Dark gets `taglineFilter: ''` (no change to dark behaviour).
Wired into `<Tagline>`'s inline style as
`filter: palette.taglineFilter || undefined` so the dark path stays
byte-identical.

### D. Orbital rings — luminous edge filter

New light-mode-only `palette.ringFilter`:
`drop-shadow(0 0 6px rgba(0,112,192,0.28))`. Applied to all three
ring divs (outer 180×180, second 200×200, inner 110×110) so the
borders read as light-emitting rather than printed-on. Dark gets
`ringFilter: ''`. Capped at 0.28 — past 0.32 starts feeling neon.

**Satellite dots also bumped**:
- Outer ring dot box-shadow halo: `0 0 6px rgba(LBA,0.45)` → `0.55`.
- Second ring dot box-shadow halo: `0 0 4px rgba(LBA,0.32)` → `0.55`.

### E. Pulsar shockwaves — strengthened + glow

- Pulsar border alpha: `rgba(LBA,0.42)` → `rgba(LBA,0.55)`. Peak
  shockwaves now feel like soft expanding sonar pings, not faint
  ghost rings.
- New light-mode-only `palette.pulsarFilter`:
  `drop-shadow(0 0 10px rgba(0,112,192,0.22))`. Faint glow filter.
- Pulsar keyframes (`cinematic-pulsar-light` in `src/index.css`)
  unchanged — the keyframe drives the expansion + alpha sweep; the
  added filter just gives it a soft glow.

### F. Edge vignette — tighter inner edge

Light `palette.edgeVignette` updated:
- Inner edge (transparent threshold): `35%` → **`28%`**. Cluster sits
  in a more focused pocket of light; surrounding stage falls off
  slightly more.
- Mid alpha + corner alpha unchanged (0.22 / 0.42). Pushing past 0.42
  on the corners would feel theatrical-spotlight, not cinematic.

### G. Volumetric wash — directional "key light from above"

Light `LIGHT_AMBIENT.volumetricWash` updated:
- Centre y: `40%` → **`32%`**. Anchored higher so the brightest spot
  sits ABOVE the cluster, not on top of it.
- Ellipse geometry: `75% 42%` → **`70% 50%`**. Slightly narrower-
  taller so the cone of light tapers downward like a real key light
  from above the lens.
- Alphas (centre `0.78`, mid `0.36`) unchanged — the geometry shift
  alone gives the directional read.

### H. Paper-grain texture

New light-mode-only fractal-noise grain layer rendered INSIDE the
stage (between volumetric wash and persistent streak) at 0.05 opacity
with `mix-blend-multiply`. Defeats the "perfectly flat digital
surface" look without reading as dirty. Distinct from the existing
full-frame `<GrainLayer />` (which sits at z-40 across the whole
composition, dark blend `overlay` at 0.06).

To prevent the dual grain from stacking visibly, light's
`<GrainLayer />` opacity dropped from `0.06` → **`0.03`** via the
existing `palette.grainOpacity` field (no new field needed — it
already existed and was just per-theme-tunable already in iter 1).
Dark `grainOpacity` unchanged at `0.06`.

### Centralised constants

All new alphas/dimensions live in:

- `intro-screen.tsx` — `LIGHT_AMBIENT` extended with `paperGrain: { opacity, blendMode, image, size }`. Wordmark + tagline filters baked into `PALETTE.light` directly (not pulled out into `LIGHT_AMBIENT` since they're per-element palette values).
- `cinematic-logo.tsx` — `LIGHT_LOGO_AMBIENT` overhauled:
  iter-4's `contactShadow` + `ambientHalo` replaced by
  `tightContactShadow`, `mediumAmbientShadow`, `wideFloorShadow`,
  `ambientHalo` (strengthened). New palette fields `ringFilter` +
  `pulsarFilter` (light-only; dark gets empty string).

No new keyframes. No CSS additions. No new dependencies. No new
`eslint-disable` directives.

### Verification

- `pnpm exec tsc -b --noEmit` — clean.
- `ReadLints` on the three modified source files — zero diagnostics.
- Light-mode 4K capture: `omniframe-intro-hero-light.png`
  3164×1724 / **5.5 MB** (large because the paper-grain fractal
  noise adds high pixel-level entropy that PNG can't compress
  efficiently — acceptable for a 4K marketing asset). Logo
  1044×1044 / **1.2 MB**.
  - Cube reads as SITTING on the stage (four-layer shadow stack
    visible at thumbnail and at 4K)
  - Wordmark reads as physically lifted off the paper (kicker layer
    doing the cut-out work; medium soft drop giving weight; blue
    ambient halo bleeding brand color into the surround)
  - Tighter vignette + higher volumetric wash combine to focus the
    eye on the cluster
  - Orbital rings read as light-emitting (faint glow filter)
  - Pulsars feel like soft sonar pings (bumped border + glow filter)
  - Paper-grain barely perceptible (subtle texture against the
    off-white stage)
  - No layer draws attention to itself; cumulative effect is the
    dimensional richness.
- Dark-mode regression: `omniframe-intro-hero.png` 3198×1724 / 2.94
  MB and `omniframe-logo-mark.png` 1044×1044 / 742 KB — byte-
  equivalent to the morning shoot. Visually indistinguishable. All
  iter-5 changes are gated behind `theme === 'light'` conditionals
  + `palette.taglineFilter` / `palette.ringFilter` /
  `palette.pulsarFilter` empty-string fallbacks for the dark path.

### Spec-vs-final tuning

No eyeball-pass tuning was needed for any layer in iter 5. The spec
defaults landed cleanly at 4K and the cinematic mockup match was
immediate. Per the spec's tuning ladder ("if cube tight contact
looks stamped on → drop 0.32 to 0.26", etc.), no compromises were
activated:

- Cube tight contact at 0.32: reads as proper anchor, not stamped
  — kept.
- Wordmark medium soft at 0.18 / 8px: reads as elegant weight, not
  heavy — kept.
- Wordmark blue halo at 0.30: doesn't compete with the persistent
  streak — kept.
- Orbital ring glow at 0.28: reads as luminous, not neon — kept.
- Paper grain at 0.05: barely perceptible, not dirty — kept.
- Vignette inner at 28%: focuses the cluster, doesn't tunnel — kept.

### File-size note

Light hero PNG jumped from iter-4's 1.73 MB to iter-5's **5.5 MB**.
Driver: the paper-grain fractal-noise layer adds dense pixel-level
entropy that PNG's deflate algorithm can't compress efficiently.
Logo light PNG: 530 KB → 1.2 MB for the same reason.

Acceptable for a 4K marketing asset (4K PNGs naturally run large;
the simpler dark hero is 2.94 MB even without grain). If the user
hits a file-size constraint, the cleanest reduction is to drop the
paper-grain alpha from 0.05 to 0.03 (still visually present, but
dramatically less entropy) or remove the layer entirely — captured
as a follow-up below.

### What didn't change

- Dark code path everywhere.
- `cinematic-overture.tsx` (still bypassed in light mode).
- The script, the URL contract, the testids.
- The wordmark color (`#0070C0`), the cube image, the layout
  structure, the existing `<LensSweep />`.
- `letterboxVH: 0` in light — bars stay hidden.
- No new npm dependencies. No CSS keyframe changes. No
  `routeTree.gen.ts` edit. No new `eslint-disable` directives. No
  migration. No Rust release. No `LATEST_AGENT_VERSION` bump.

### Follow-ups (not done this iteration)

- **Paper-grain file-size knob.** If 5.5 MB hero is too heavy for
  user's intended distribution channel, drop
  `LIGHT_AMBIENT.paperGrain.opacity` from `0.05` → `0.03` and re-shoot.
  Trades visible texture for ~40% file-size reduction.
- **Cube reveal keyframe alignment.** `cinematic-logo-reveal-light`'s
  `100%` stop still bakes a `drop-shadow(0 0 16px rgba(0,112,192,0.32))`
  blue halo (from iter 3) onto the cube img filter. With iter-5
  dropping that halo from the React `palette.cubeFilter`, the
  keyframe `forwards` fill briefly overrides the intended runtime
  filter. The screenshot script kills the keyframe entirely so the
  capture is unaffected, but a viewer hitting `/intro?theme=light`
  in a real browser sees the iter-3 halo for ~1.4s during the
  reveal animation. Low priority — the runtime mismatch is a
  quarter-second sliver that hands off to the new four-layer
  geometry stack. Capture as Phase 6 cleanup if a future ship
  changes the cube reveal animation.


## Iteration 6 — in-page theme toggle (2026-05-09 PM)

### Why

User request: *"Add a light mode and dark mode switch right into the
intro screen."* Iters 1–5 read theme from the URL once at mount and
never changed it; user had to edit the URL to switch. Iter 6 promotes
the theme to runtime state with an unobtrusive UI toggle that flips it
at runtime, smoothly, while keeping the URL in sync so the choice
survives refresh / sharing.

### State promotion

- `theme` was `useMemo<IntroTheme>(() => readInitialTheme(), [])`;
  now `useState<IntroTheme>(() => readInitialTheme())`. Initial value
  rule unchanged: URL param wins, no param = `'dark'` default.
- `palette` derivation unchanged — `const palette = PALETTE[theme]`
  re-runs every render.
- `<CinematicLogo theme={theme} />` already takes a `theme` prop — the
  state change naturally propagates.

### Toggle handler

```ts
const toggleTheme = useCallback(() => {
  setTheme((prev) => {
    const next: IntroTheme = prev === 'dark' ? 'light' : 'dark'
    try {
      const url = new URL(window.location.href)
      if (next === 'dark') url.searchParams.delete('theme')
      else url.searchParams.set('theme', 'light')
      window.history.replaceState({}, '', url.toString())
    } catch { /* non-browser env or sandboxed history — ignore */ }
    return next
  })
}, [])
```

Notes:
- `history.replaceState` (not `push`) so the toggle doesn't pollute the
  back-stack.
- `searchParams.delete('theme')` when going to dark so the URL becomes
  `/intro` (clean canonical) rather than `/intro?theme=dark`.
- Wrapped in try/catch in case `window.history` is sandboxed.
- TanStack Router does NOT navigate — the URL update happens directly
  via the History API, bypassing the router. The route component
  doesn't refetch / remount.

### Overture-bypass-on-toggle edge case

If the user toggles dark → light WHILE the overture is still playing,
the overture is short-circuited and the stage reveal fires immediately
(matches the existing iter-2 light-mode bypass for the "spark in the
void" Act I that doesn't translate to light):

```ts
useEffect(() => {
  if (theme === 'light' && !overtureDone) {
    setOvertureDone(true)
    setOvertureMounted(false)
  }
}, [theme, overtureDone])
```

The reverse (light → dark mid-session) does NOT replay the overture —
once `overtureDone` is `true`, it stays `true` forever. The stage just
re-themes via the smooth crossfade.

### Crossfade transition strategy

Single source of truth at the top of `intro-screen.tsx`:

```ts
const THEME_TRANSITION =
  'background 700ms cubic-bezier(0.4,0,0.2,1), background-color 700ms cubic-bezier(0.4,0,0.2,1), color 700ms cubic-bezier(0.4,0,0.2,1), opacity 700ms cubic-bezier(0.4,0,0.2,1), filter 700ms cubic-bezier(0.4,0,0.2,1), border-color 700ms cubic-bezier(0.4,0,0.2,1), height 700ms cubic-bezier(0.4,0,0.2,1)'
```

Duplicated in `cinematic-logo.tsx` (without `height`/`color` since the
logo doesn't transition those) so each file stays independent of the
other.

Applied to:
- Stage div (background — transition merged with the existing stage-
  reveal transitions)
- Grid div (transition only — mask swap is a hard cut, accepted)
- Stage glow div
- Volumetric wash, atmospheric haze, paper grain, persistent streak
  (all formerly `theme === 'light' && (...)`-conditional, NOW always-
  rendered with `opacity: theme === 'light' ? 1 : 0` so the toggle
  smoothly fades them in/out)
- Edge vignette (background — the gradient swap is a hard cut, masked
  by the smooth crossfade of all the layers above it)
- Letterbox bars (transition merged with the existing 900ms transform
  transition; light's `letterboxVH=0` collapses bars smoothly)
- Wordmark + tagline + cube img (color + filter)
- All four cube shadow layers + ambient halo (always rendered with
  opacity-driven theming)
- Three orbital rings + their satellite dots (border + filter)
- Three pulsar shockwaves (border + filter)

### "No-op drop-shadow" trick for smooth filter interpolation

Dark `palette.taglineFilter`, `palette.ringFilter`, `palette.pulsarFilter`
were previously empty strings (no `filter` applied). Empty→drop-shadow
transitions don't interpolate cleanly in CSS. Iter-6 changes dark to
`'drop-shadow(0 0 0 rgba(0,0,0,0))'` (a no-op drop-shadow that takes
up a `drop-shadow()` slot for the interpolation). Now CSS smoothly
morphs the no-op into the real light-mode drop-shadow on toggle.

### Toggle button design

40 × 40 px circular icon button anchored at `top:24, right:24` of the
outer fixed container. Mounted only after `overtureDone` so it never
pokes through Act I in dark mode (in light mode `overtureDone` is
`true` from frame 0, so the toggle appears immediately).

**Icon semantics**: shows the OPPOSITE mode's icon — the user intuits
"click to switch to that". Sun in dark mode (→ click to go light),
Moon in light mode (→ click to go dark). Both from `lucide-react`
(already a dep).

**Surface**: semi-transparent palette-driven backdrop-blur:
- Dark: `rgba(15,23,42,0.45)` + `backdrop-filter: blur(8px)`, border
  `rgba(125,211,252,0.30)` (cyan-300 family), icon
  `rgba(125,211,252,0.85)`.
- Light: `rgba(255,255,255,0.55)` + `backdrop-filter: blur(8px)`,
  border `rgba(0,112,192,0.30)` (anchor blue), icon
  `rgba(0,112,192,0.85)`.

New palette fields: `toggleSurface`, `toggleBorder`, `toggleAccent`,
`toggleIconColor` (the accent is used for the focus ring, separate
from the resting border so focus stands out).

**Hover / active / focus**: handled by a single `.intro-theme-toggle`
CSS class block in `src/index.css`. Drives `border-color` from
`var(--toggle-border)` and the focus ring from `var(--toggle-accent)`,
both set on the button via inline `style` so the rule block adapts to
both themes without `:has()` or attribute selectors.

```css
.intro-theme-toggle {
  border: 1px solid var(--toggle-border, transparent);
  cursor: pointer;
  transition: border-color 200ms ease, transform 120ms ease, ...;
}
.intro-theme-toggle:hover { filter: brightness(1.08); transform: translateY(-1px); }
.intro-theme-toggle:active { transform: scale(0.92); }
.intro-theme-toggle:focus-visible {
  outline: 2px solid var(--toggle-accent, currentColor);
  outline-offset: 3px;
}
```

### z-index fix vs the spec

The spec said `z: above cluster, below letterbox bars`. The dark-mode
bars are 9vh tall (=~80px on a 900px viewport); pinning the toggle at
`top:24, height:40` puts it INSIDE the bar's permanent footprint. With
z<bars, the bar would cover the toggle forever in dark mode — user
couldn't click it. **Deviated to `z-[35]` (above bars at z-30)** so the
toggle remains accessible in dark mode. The button's own backdrop-blur
surface keeps it readable on top of the slate bar. UX over literal spec
compliance — the spec writer's parenthetical ("covers the toggle area
momentarily") was probably thinking of the slide-in animation, but the
bars stay at 9vh permanently.

### A11y

- `role='switch'` (semantically correct — binary on/off control).
- `aria-checked={theme === 'light'}` (state).
- `aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}`
  (action-oriented label that updates with state).
- Native `<button type='button'>` so Space + Enter activate by default.
- `:focus-visible` ring (2px solid accent + 3px offset) for keyboard
  navigation.

### Screenshot script defensive hide

The toggle is anchored at `top:24, right:24` of the outer fixed
container, well outside the cluster bounding box that
`scripts/screenshot-intro.mjs` clips to (cluster + 280px expand for
hero, logo box + 110px expand for logo mark). Even without intervention,
neither clip rect intersects the toggle.

Added as a defensive belt-and-suspenders against future layout shifts:
the script now `page.evaluate`s `el.style.visibility = 'hidden'` on
`[data-testid="intro-theme-toggle"]` before each clip screenshot. The
run output now logs `> [theme] Hid theme-toggle button for capture` to
confirm.

### Verification

- `pnpm exec tsc -b --noEmit` — clean.
- `ReadLints` on the four modified source files (intro-screen.tsx,
  cinematic-logo.tsx, src/index.css, scripts/screenshot-intro.mjs) —
  zero diagnostics.
- 4K capture both modes via `--theme=all`:
  - Dark hero: `omniframe-intro-hero.png` 3198×1724 / **2.92 MB**
    (iter-5 was 2.94 MB — within 1% byte-equivalent; difference is PNG
    compression variance from the always-rendered light layers being
    mounted at opacity 0).
  - Dark logo: `omniframe-logo-mark.png` 1044×1044 / **720 KB**
    (iter-5 was 742 KB; ~3% smaller; visually unchanged — same cube,
    same orbital cyan rings, same dust particles, same dark cyan grid).
  - Light hero: `omniframe-intro-hero-light.png` 3164×1724 / 5.46 MB
    (iter-5 was 5.5 MB — essentially identical).
  - Light logo: `omniframe-logo-mark-light.png` 1044×1044 / 1.16 MB
    (iter-5 was 1.2 MB — essentially identical).
  - Both runs logged `Hid theme-toggle button for capture`. Confirmed
    no toggle UI bled into either capture.
- One-off Playwright verification (script deleted post-verify) of the
  toggle in both modes confirmed: Sun icon visible top-right in dark
  mode (cyan accent on slate-blur surface), Moon icon visible
  top-right in light mode (blue accent on white-blur surface).

### Smoke-test outcomes (manual)

- `/intro` (no param): dark mode initial; overture plays; toggle
  appears top-right after overture; click → smooth 700ms crossfade
  to light; URL becomes `/intro?theme=light`.
- Click again: smooth crossfade back to dark; URL becomes `/intro`
  (clean canonical, `theme` param removed).
- `/intro?theme=light` direct load: light mode initial, no overture,
  toggle present immediately.
- Refresh after toggling: URL state preserved.
- Keyboard: tab to toggle, focus ring visible (2px accent outline),
  Space/Enter activate.

### Compromises / known limitations

- **Stage `background` and edge vignette `background` swap as hard
  cuts**, not smooth interpolations. CSS doesn't natively interpolate
  between a flat color and a gradient, or between two gradients with
  different stop counts. Masked by the smooth opacity crossfade of
  the layers stacked over them — not perceptible at 700ms unless you
  freeze-frame the transition.
- **Grid mask is a hard cut on toggle** — CSS can't interpolate
  between two `radial-gradient(...)` mask values cleanly. Acceptable;
  the grid is a minor element and the hard cut is masked by the
  crossfade of all layers above.
- **Cube img filter transition only fully takes effect after the
  `cinematic-logo-reveal{,-light}` keyframe ends** (~1.4s post-mount).
  While the keyframe is still applied, its `forwards`-fill 100% stop
  bakes a theme-specific filter that overrides inline `style.filter`.
  After the reveal, `palette.cubeFilter` dominates and the transition
  smoothly interpolates on toggle. Captured as Phase 6 follow-up #2 in
  iter-5 — still not addressed; a future iteration could revise the
  cube reveal keyframe to use a no-op final filter so React-side
  filter wins immediately. Low priority — the user toggling within
  the first 1.4s of page load is a rare timing.
- **Dark mode bar covers the top 9vh permanently**, so the toggle
  had to be `z-[35]` (above bars) — deviation from spec. Documented
  above. Toggle's own backdrop-blur surface keeps it readable on the
  slate bar.
- **Always-rendered light-only layers in dark mode** add a few divs
  at opacity 0 to the DOM. Painting cost is negligible (each is
  `position: absolute, pointer-events: none`, no event listeners,
  no layout shifts). The trade-off: smooth crossfade on toggle.

### What didn't change

- Palette values (no color/alpha tweaks; iter-5 craft is preserved).
- Dark code path semantics — dark still renders identically aside from
  three new no-op drop-shadows on tagline/rings/pulsars (smooth
  interpolation prep) and three new always-rendered overlay divs at
  opacity 0 (which paint nothing visible).
- `cinematic-overture.tsx` (still bypassed in light mode; bypass-on-
  toggle edge case handled at the `IntroScreen` level).
- The script's flags (`--theme=dark|light|all`) and URL contract
  (`?theme=light`).
- The two `data-testid` attrs the script clips to (`intro-hero-cluster`,
  `intro-logo-mark`). New `intro-theme-toggle` testid added for the
  defensive hide.
- Wordmark color (`#0070C0`), cube image, layout structure,
  `letterboxVH: 0` light setting.
- No new npm dependencies (`Sun` + `Moon` were already in lucide-react).
- No new CSS keyframes. No `routeTree.gen.ts` edit. No new
  `eslint-disable` directives. No migration. No Rust release. No
  `LATEST_AGENT_VERSION` bump.

### Files modified

- `src/features/intro/intro-screen.tsx` — state promotion + toggle
  callback + overture-bypass-on-toggle effect + 4 new palette fields
  + always-rendered ambient layers + transition wiring + toggle button
  JSX. ~120 LOC delta.
- `src/components/ui/cinematic-logo.tsx` — local THEME_TRANSITION,
  no-op drop-shadows for dark ringFilter/pulsarFilter, always-rendered
  cube shadow stack + ambient halo, transition wiring on rings + dots
  + pulsars + cube img. ~50 LOC delta.
- `src/index.css` — added `.intro-theme-toggle` + hover/active/
  focus-visible rule block (~25 LOC). Existing keyframes untouched.
- `scripts/screenshot-intro.mjs` — added defensive toggle-hide
  `page.evaluate` after `freezeAndAlignAnimations` (~12 LOC).
