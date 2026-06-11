---
tags: [type/pattern, status/active, domain/frontend]
created: 2026-05-25
---

# RF Cinematic Shell

## Purpose / Context

The RF interface previously rendered as a plain 2-column grid of pastel-bordered `QuickActionButton`s on a flat background. The full RF surface (home + 13 sub-form screens) was redesigned on 2026-05-25 to feel cinematic — animated mesh backdrop, glassmorphic cards, accent-haloed tiles, stagger entrance, and a sliding-indicator dock — while staying 100% theme-aware so light / dark / custom palettes all render correctly without per-screen overrides.

## Module location

```
src/features/rf-interface/_shell/
├── index.ts              Barrel
├── motion-variants.ts    fadeUp / fadeUpFast / pagePush / staggerContainer / tapScale
├── mesh-backdrop.tsx     <MeshBackdrop /> — 3 drifting radial blobs (theme tokens)
├── rf-screen.tsx         <RFScreen /> — flex-col wrapper + optional scroll
├── rf-screen-header.tsx  <RFScreenHeader /> — back + title + right slot + underline
├── rf-card.tsx           <RFCard variant glow /> — wraps `glass-card` with halo
├── rf-tile.tsx           <RFTile icon label description accent badge /> — home grid
├── rf-hero.tsx           <RFHero greeting caption stats status /> + <RFStatusPill />
└── rf-dock.tsx           <RFDock /> — floating glass pill, layoutId active indicator
```

## Theme-token contract

Everything resolves through CSS custom properties so light / dark / custom themes swap without code changes:

| Token             | Used for                                            |
| ----------------- | --------------------------------------------------- |
| `--primary`       | Mesh blob 1, hero gradient overlay, dock active     |
| `--rf-accent-*`   | Tile accents (11 categories, both light + dark)     |
| `--glass-*`       | Card surfaces (already shipped — pre-existing)      |
| `--background`    | Page base; mesh blobs sit on `bg-background/40`     |

The 11 RF accent tokens were added to `src/index.css` (`:root` + `.dark` + `@theme inline`) following the existing `--omnibelt-job-*` convention.

## Tile accent → category mapping (canonical)

```
Inbound Scanner    scan
Put Away           putaway
Picking            pick
Kitting Apps       kit
Cycle Count        count
GRS Cycle Count    grs
GRS Core Pulls     grs
Part Transfer      transfer
My Productivity    productivity
Work Queue         queue
Claim Tasks        claim
SAP MIGO           sap
```

## Hero stats wiring

`<RFHero>` shows three live stats on the home screen — `Pushed` (from `usePushedWork()`), `Tasks` (sum of today's productivity metrics from `useTeamPerformance`), and `Zone` (derived from the cycle-count claim via `deriveZone`). A one-shot `refreshPerformanceData()` call fires on mount so the strip has real numbers without waiting for the user to open the Productivity tab.

## Animation language

- **Page transitions** — `pagePush` (12px translate + fade, 320ms ease-out cubic in / 160ms exit). Single `<AnimatePresence mode="wait" initial={false}>` wraps `renderView()` in `rf-interface.tsx`.
- **Stagger entrance** — every redesigned view wraps its top container with `motion.div variants={staggerContainer}` and its children with `fadeUp` / `fadeUpFast`. Stagger delay 40ms per child.
- **Tile press feedback** — `whileTap={tapScale}` (0.97).
- **Dock active indicator** — single `motion.div` with `layoutId` slides between siblings (spring, 460/36).
- **Mesh backdrop** — three CSS `@keyframes` (22s / 28s / 34s, `ease-in-out infinite`) animating `transform` only. Paused under `prefers-reduced-motion`.

See [[Realtime-Presence-Browser-Hardening]] for the policy this redesign sits inside (no new realtime channels added; hero stats reuse existing hooks).

## Bundle impact

The `feature-rf-interface` chunk grew by ~2 KB (532 → 534 KB). The chunk was already over the 500 KB hard budget before this redesign; this change did not cause the budget violation. Future work to bring it under budget should lazy-import the 13 RF sub-form components (each renders only when its tile is tapped).

## Things to **not** do

- Don't reintroduce `<Card>` from `@/components/ui/card` at the top of an RF view — use `<RFScreenHeader>` plus a `glass-card` div, or `<RFCard>`.
- Don't hardcode Tailwind color names (`bg-blue-50`, `text-orange-700`, `dark:bg-...`) on RF surfaces — the redesign deletes the legacy `QuickActionButton` variant map. Use `--rf-accent-*` via `bg-rf-accent-<name>/10` instead.
- Don't add a second `<AnimatePresence>` around `renderView()` — there's exactly one at the shell level.
- Don't break the dock contract: items must be 2–6, the active indicator depends on `layoutId` for the slide animation.

## Related

- [[Realtime-Presence-Browser-Hardening]]
- [[Rust-Work-Service]]
- [[ADR-RF-Activity-Telemetry]]
