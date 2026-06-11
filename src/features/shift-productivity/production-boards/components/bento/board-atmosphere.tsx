// Created and developed by Jai Singh
/**
 * BoardAtmosphere — the ambient gradient mesh + SVG-noise grain that
 * sits BEHIND the bento grid. Renders fixed-positioned inside the
 * board container at `z-[-1]`, so a board with zero / one card never
 * feels desolate.
 *
 * Visual recipe (low-opacity layered):
 *   - Conic mesh (kind-coloured, animated 25s ease-in-out) at 5–8% alpha.
 *   - Two radial blooms (kind-coloured) at 6–10% alpha for depth.
 *   - SVG noise grain at 2% alpha for tactile "paper" texture.
 *
 * The whole stack is `pointer-events-none` and `aria-hidden`. The mesh
 * animation is gated behind `motion-safe:` so reduced-motion users get
 * a still backdrop.
 *
 * Performance: every animated property is `transform` / `opacity` /
 * `filter` — all GPU-accelerated. No layout-triggering animation.
 *
 * Why a scoped `<style>` instead of `index.css`: the mesh keyframes
 * are board-bento-specific (and gated behind the lazy chunk), so we
 * keep them co-located rather than bloating the global stylesheet.
 */
import { useId } from 'react'
import { accentFor, meshConicCss } from './board-kind-accent'
import type { BentoBoardKind } from './card-variant'

export interface BoardAtmosphereProps {
  boardKind: BentoBoardKind
  /**
   * TV mode bumps the mesh opacity slightly and dampens the grain —
   * the texture only reads on a near-screen surface; on a 1080p TV at
   * 8 ft, grain becomes visible banding.
   */
  isTv?: boolean
  /**
   * Optionally disable the keyframe animation — useful in test environments
   * where jsdom doesn't paint CSS animations and the smoke test wants to
   * assert the static layer renders without flakey timing.
   */
  animated?: boolean
  className?: string
}

export function BoardAtmosphere({
  boardKind,
  isTv = false,
  animated = true,
  className,
}: BoardAtmosphereProps) {
  const a = accentFor(boardKind)
  const noiseId = useId().replace(/:/g, '')
  const animClass = animated
    ? 'motion-safe:animate-[board-mesh_25s_ease-in-out_infinite]'
    : ''
  const meshOpacity = isTv ? 0.09 : 0.07
  const bloomAOpacity = isTv ? 0.12 : 0.1
  const bloomBOpacity = isTv ? 0.1 : 0.08
  const grainOpacity = isTv ? 0.018 : 0.025

  return (
    <div
      aria-hidden
      className={[
        'pointer-events-none absolute inset-0 -z-10 overflow-hidden',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-board-atmosphere={boardKind}
    >
      <style>{`
@keyframes board-mesh {
  0%, 100% { transform: rotate(0deg) scale(1.18); }
  50%      { transform: rotate(8deg)  scale(1.32); }
}
@keyframes board-bloom-a {
  0%, 100% { transform: translate3d(-4%, -2%, 0) scale(1); opacity: var(--bloom-a-min); }
  50%      { transform: translate3d(2%,  3%, 0)  scale(1.15); opacity: var(--bloom-a-max); }
}
@keyframes board-bloom-b {
  0%, 100% { transform: translate3d(3%, 2%, 0) scale(1.1);  opacity: var(--bloom-b-min); }
  50%      { transform: translate3d(-2%, -3%, 0) scale(0.95); opacity: var(--bloom-b-max); }
}
      `}</style>

      {/* Layer 1 — slow rotating conic mesh, the atmosphere's spine. */}
      <div
        className={`absolute -inset-[20%] ${animClass}`}
        style={{
          background: meshConicCss(boardKind),
          opacity: meshOpacity,
          filter: 'blur(72px)',
          willChange: 'transform',
        }}
      />

      {/* Layer 2 — two soft radial blooms in the kind's accent. */}
      <div
        className='absolute top-[18%] left-[12%] h-[55vh] w-[55vh] rounded-full motion-safe:animate-[board-bloom-a_18s_ease-in-out_infinite]'
        style={{
          background: `radial-gradient(circle at center, ${a.fromHex}, transparent 70%)`,
          opacity: bloomAOpacity,
          filter: 'blur(48px)',
          ['--bloom-a-min' as string]: String(bloomAOpacity * 0.85),
          ['--bloom-a-max' as string]: String(bloomAOpacity * 1.15),
        }}
      />
      <div
        className='absolute right-[8%] bottom-[10%] h-[45vh] w-[45vh] rounded-full motion-safe:animate-[board-bloom-b_22s_ease-in-out_infinite]'
        style={{
          background: `radial-gradient(circle at center, ${a.toHex}, transparent 70%)`,
          opacity: bloomBOpacity,
          filter: 'blur(56px)',
          ['--bloom-b-min' as string]: String(bloomBOpacity * 0.85),
          ['--bloom-b-max' as string]: String(bloomBOpacity * 1.2),
        }}
      />

      {/* Layer 3 — SVG noise grain (data URI; zero network cost). */}
      <svg
        className='absolute inset-0 h-full w-full'
        style={{ opacity: grainOpacity, mixBlendMode: 'overlay' }}
        xmlns='http://www.w3.org/2000/svg'
      >
        <filter id={`noise-${noiseId}`}>
          <feTurbulence
            type='fractalNoise'
            baseFrequency='0.9'
            numOctaves='2'
            stitchTiles='stitch'
          />
          <feColorMatrix type='saturate' values='0' />
        </filter>
        <rect width='100%' height='100%' filter={`url(#noise-${noiseId})`} />
      </svg>

      {/* Layer 4 — vertical fade at the top + bottom so atmosphere */}
      {/* doesn't compete with the header chrome above. */}
      <div className='from-background/40 absolute inset-x-0 top-0 h-32 bg-gradient-to-b to-transparent' />
      <div className='from-background/40 absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t to-transparent' />
    </div>
  )
}

// Created and developed by Jai Singh
