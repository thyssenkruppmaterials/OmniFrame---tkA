---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-10
---
# Cinematic Tab Rotation

## Purpose / Context

Reusable visual recipe for **TV-display** surfaces that auto-rotate between content slices (e.g. per-area, per-category, per-branch). When the rotation tick fires, the swap should feel like a film chapter break — not a snap, not a generic crossfade. The cinematic moment is what carries operator attention across the swap so the new context registers instead of being dismissed as "oh, the screen flickered."

Use this when:

- A surface auto-rotates between data slices on a TV (cron-like cadence ≥10s).
- Each slice has an obvious accent colour already paid for elsewhere on the screen (avatar tints, area badges, category bands).
- The slice has a short identifier (e.g. area_code) and a human-readable name worth foregrounding for ~1.5s every cycle.

Do NOT use when:

- Users navigate manually (clicks, keyboard) — the cinematic block is distracting when the click was intentional. Fall back to a 250ms calm crossfade.
- `prefers-reduced-motion: reduce` is set — fall back to the calm path via `<MotionConfig reducedMotion='user'>`.
- The rotation is faster than ~10s — the chapter overlay needs ~1.45s to play through and you'd never see steady-state content.

First surfaced from the 2026-05-10 v8 polish on [[Implement-Production-Boards-Hourly-Grid]] (Hourly Completion Tracker per-area rotation in TV mode). Likely next adopter: SQCDP rotating between categories on a TV.

## Recipe — four layers

```
t=0ms                                                                            t≈2000ms
├── Layer 1: outgoing slice fades + scales + blurs + lifts up   ──── 600ms ──→
│                       ┌── Layer 2: chapter overlay ──── 1450ms total ──────────┐
│                       │   eyebrow → code → name + sub cascade @80/160ms        │
│                                                  ├── Layer 3: incoming slice fades + scales + blurs + slides down ──── 700ms ──→
│                                                  └── Layer 4 (optional): progress bar drains+refills across the rotation cycle
```

All three timings use `[0.22, 1, 0.36, 1]` so the layers feel orchestrated as one event.

### Layer 1 — Outgoing slice (variant)

```ts
exit: {
  opacity: 0,
  y: -12,
  scale: 0.985,
  filter: 'blur(6px)',
  transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
}
```

### Layer 2 — Chapter overlay

Absolute fill on a `relative` parent so it doesn't push layout. Backdrop is a soft accent-coloured radial gradient (CSS var driven — see Accent Reuse below). Centred content stack:

- Eyebrow — `text-xs tracking-[0.4em] font-medium text-muted-foreground` uppercase label (e.g. `NOW SHOWING`). Fade-in first.
- **Identifier** (e.g. area_code) — `font-mono text-7xl font-bold tabular-nums tracking-tight leading-none` in the accent hex. Scale-up from 0.92 → 1 with a slight overshoot.
- **Name** — `text-3xl font-semibold tracking-tight text-foreground/90`. Cascade in 80ms after the code.
- **Sub-line** — `text-sm tabular-nums text-muted-foreground` with a count or context (e.g. `Hourly Completion · 12 associates`). Cascade in 160ms after the code.

Variants:

```ts
const container = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.25, ease: EASE,
             when: 'beforeChildren', staggerChildren: 0.08 } },
  exit:    { opacity: 0, scale: 1.04, transition: { duration: 0.5, ease: EASE } },
}
const eyebrow = { initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } } }
const code    = { initial: { opacity: 0, scale: 0.92, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.55, ease: EASE } } }
const name    = { initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE, delay: 0.08 } } }
const sub     = { initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE, delay: 0.16 } } }
```

Mount the overlay imperatively on the slice change (set state, schedule `setTimeout(..., 1450)` to clear it), and wrap with `<AnimatePresence>` so framer-motion plays the exit when state is cleared. Total visible time: ~1450ms.

### Layer 3 — Incoming slice (variant)

```ts
initial: { opacity: 0, y: 12, scale: 1.015, filter: 'blur(6px)' }
animate: {
  opacity: 1, y: 0, scale: 1, filter: 'blur(0px)',
  transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
}
```

Use `<AnimatePresence mode='wait'>` so the outgoing slice fully exits before the incoming mounts. The chapter overlay covers the gap.

### Layer 4 — Optional rotation progress bar

A 2px bar at the bottom of the body (`absolute right-0 bottom-0 left-0 h-[2px]`) that drains in 250ms then refills across the rotation cycle. Re-key on each cycle. Adds ~10–12KB to the bundle when framer-motion-driven; gate behind a per-feature chunk-budget guard.

## Calm fallback (manual nav, reduced motion, normal mode)

A 250ms opacity-only crossfade. Same easing. No chapter overlay. No per-layer cascade. The transition uses the same `<AnimatePresence mode='wait'>` so the parent component code path is identical — only the `variants` object swaps.

```ts
const calm = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.25, ease: EASE } },
  exit:    { opacity: 0, transition: { duration: 0.25, ease: EASE } },
}
```

Gate via:

```tsx
const cinematic = isTv && isRotating
const variants = cinematic ? cinematicVariants : calmVariants
```

Wrap everything in `<MotionConfig reducedMotion='user'>` so users with `prefers-reduced-motion: reduce` get framer-motion's built-in fallback regardless of `cinematic`.

## Accent reuse — same colour everywhere

The chapter overlay's radial-glow backdrop AND the identifier text colour both pull from the **same** deterministic hash that already paints the slice's chrome elsewhere on screen (avatar tint, area badge, category band). Operators learn "OUTBOUND = sky" once.

For Production Boards, the canonical hash is `deriveAreaColor(area_code)` returning one of 8 keys (`emerald | sky | amber | violet | rose | cyan | lime | fuchsia`). The hex mapper `accentHexFor(area_code)` (in `boards/hourly/lib/area-color.ts`) is the single source of truth for the inline hex / rgba values — **do NOT** introduce a second mapping table or the chrome and the chapter title will drift.

For a future SQCDP adopter, the equivalent is `metric.color_hex ?? defaultColorFor(category)`.

Glow alpha:
- Light mode: 0.18
- Dark mode: 0.25

Driven via two CSS variables (`--accent-glow` for light, `--accent-glow-dark` for dark) so the radial gradient class string can stay literal (Tailwind JIT rejects template-literal class names).

## Performance

- Animate **transform / opacity / filter only** — all GPU-accelerated.
- Apply motion at the **body level only**. A 50-row × 13-col grid is 650 cells; per-cell variants stutter even on modern Chromium. The single body fade owns the entire entrance.
- Use `will-change-[transform,opacity,filter]` on the body wrapper as a compositor hint.
- Re-key `<AnimatePresence>` on the slice value so framer-motion correctly identifies enter/exit.
- The chapter overlay's mount lifetime is driven by a single `setTimeout` per swap — don't subscribe to a per-frame motion value.

## Reduced motion

`<MotionConfig reducedMotion='user'>` at the wrapper. framer-motion short-circuits `transition` blocks for the entire subtree when the OS-level `prefers-reduced-motion: reduce` is on. The chapter overlay degrades to a plain mount/unmount; the body slices degrade to instant swaps. No flicker.

## Don't

- **Don't run the cinematic on manual nav.** Operators clicking a slice intentionally don't want a 1.5s film overlay between them and their goal.
- **Don't animate width / height / left / top.** Layout-driven animations cause reflow and the grid will stutter.
- **Don't apply per-row variants** on the slice content. Body-level only.
- **Don't introduce a second accent-colour table.** Reuse `deriveAreaColor` (or your feature's equivalent) so the chrome on screen and the chapter overlay match.
- **Don't drop `<MotionConfig reducedMotion='user'>`.** The variants are non-trivial and a reduced-motion user without it sees a flickering experience.
- **Don't run the rotation faster than ~10s.** The chapter overlay needs 1.45s; if the cycle is much shorter you'll never see steady state.
- **Don't omit the calm fallback.** Manual nav (deep links, future click-to-pin), `prefers-reduced-motion`, and any non-rotating mount must take the 250ms crossfade path.

## Reusability

Likely adopters once the pattern stabilises:

- SQCDP rotating between categories (Safety / Quality / Cost / Delivery / Production / Maintenance / Shipping / Big Idea / Announcement) on a TV.
- Customer-facing TV displays rotating between branches.
- Any future TV surface with `≥3` slices and an auto-rotation.

If two consumers land:

1. Promote the variants to a shared `production-boards/lib/cinematic-variants.ts`.
2. Promote the chapter overlay to `production-boards/components/chapter-title-overlay.tsx` (rename to drop the `Area` prefix — it's not area-specific).
3. Keep the per-feature transition wrapper (e.g. `AreaTransitionFrame`, `CategoryTransitionFrame`) since each feature owns its own slice-change detection and accent lookup.

## Related

- [[Implementations/Implement-Production-Boards-Hourly-Grid]] § v8 — first application, full file inventory.
- [[ProductionBoards - Feature Module]] — the feature this pattern lives inside.
- [[Elevated-KPI-Stat-Cards]] — same `motion-safe`-driven approach to reduced-motion gating.
- [[Dark-Mode-Opacity-Colors]] — the per-slice accent palette comes from the same opacity-token system.
