---
tags: [type/implementation, status/active, domain/frontend]
created: 2026-05-09
---
# Capture Intro Screenshots

## Purpose / Context

The `/intro` route in OmniFrame plays a ~10s cinematic reveal (overture →
stage → cube logo with orbital rings + pulsars → streaming typewriter-style text
"OmniFrame" wordmark → "UNIFIED LOGISTICS INTELLIGENCE" tagline). The
user asked for two reusable, high-quality 4K-class PNG screenshots of
the finished reveal — a hero banner and a tight square logo mark — to
save to the Mac↔Windows bridge folder for use as marketing / pitch
assets.

`scripts/screenshot-intro.mjs` (new) automates the capture using
Playwright + headless Chromium. Modeled on `scripts/record-intro.mjs`
(which records video) but produces stills.

## Details

### Outputs

Default destination: `/Users/jaisingh/Downloads/MacWindowsBridge/`

| File | Physical px | Composition |
|---|---|---|
| `omniframe-intro-hero.png` | 3198x1724 (~2.9 MB) | Wide horizontal banner: cube logo on the left + "OmniFrame" wordmark + tagline on the right; cyan grid backdrop + soft radial glow visible. |
| `omniframe-logo-mark.png` | 1044x1044 (~742 KB) | Square crop of just the `CinematicLogo` (cube + outer/inner orbital rings + pulsar shockwaves + halo). Wordmark column hidden via JS for the duration of this snap so the right edge doesn't bleed into the "O" of "OmniFrame". |

Both are PNG (8-bit RGB, non-interlaced). Captured at viewport
3840x2160 CSS px with `deviceScaleFactor: 2` so the renderer paints at
a physical 7680x4320 — the clipped element shots end up at 2x retina
density even though they crop to the cluster bounding box.

### Required testids

The script depends on two `data-testid` attributes added to
`src/features/intro/intro-screen.tsx`:

- `data-testid="intro-hero-cluster"` — on the `<div>` flex row that
  wraps the logo box + wordmark column (the screenshot's hero target).
- `data-testid="intro-logo-mark"` — on the 302x302 (=`208 * 1.45`)
  logo box wrapper that sizes the `CinematicLogo`.

Adding these is harmless and useful for any future intro automation.
No animation logic, layout, or visual styling was changed.

### How the timing works

See `src/features/intro/intro-screen.tsx` and
`src/components/ui/cinematic-logo.tsx` for the full timeline. The
script waits 11_000 ms after `domcontentloaded` to be safely past:

- ~4.8 s `CinematicOverture`
- 0.35 s overture → stage handoff
- ~0.85 s `OmniFrame` char-stream (9 chars × ~95 ms with jitter)
- ~1.4 s tagline easing in

Total ~7.5 s; 11 s gives ~3.5 s headroom.

### Animation freezing

The cube image runs an 8 s `spin` keyframe after its `cinematic-logo-reveal`
finishes — without intervention every screenshot would catch the cube
at a different rotation. The script handles both halves:

1. `page.addStyleTag` injects `*, *::before, *::after { animation-play-state: paused !important; transition: none !important; }` to freeze the page.
2. `page.evaluate(...)` finds `img[alt="OmniFrame Logo"]` and overrides its inline `style.transform = 'none'` + `style.animation = 'none'` so the cube is axis-aligned regardless of where the spin keyframe was paused.

### How to re-run

```bash
# Terminal 1 — start the dev server (any port, default tries 5173 then 5174 etc.)
pnpm dev

# Terminal 2 — run the capture (note: pass the actual port if 5173 is taken)
node scripts/screenshot-intro.mjs --url=http://localhost:5174/intro
```

Flags (all optional):

- `--url=<intro url>` (default `http://localhost:5173/intro`)
- `--out=<dir>` (default `/Users/jaisingh/Downloads/MacWindowsBridge`)
- `--wait=<ms>` (default 11000)
- `--width=<px>` `--height=<px>` (default 3840 / 2160 — viewport CSS px)
- `--dsf=<n>` (default 2 — `deviceScaleFactor`)
- `--heroExpand=<css px>` (default 280 — generosity around the hero cluster bounding box)
- `--logoExpand=<css px>` (default 110 — tightness around the logo box)

Final physical-px dimensions are `(boundingBox + 2*expand) * dsf`.

## Related

- [[Sessions/2026-05-09]]


## Follow-up — Light-mode variant (2026-05-09 PM)

Extended this work later the same day with a light-mode variant of the
`/intro` page (`?theme=light`) plus a `--theme=light` flag on this script
so the same plumbing captures the matching `*-light.png` pair to the same
bridge folder. The dark filenames + composition documented above are
unchanged — light mode adds new sibling files, doesn't replace.

Full design + palette + decision (overture bypassed) in [[Add-Intro-Light-Mode]].
