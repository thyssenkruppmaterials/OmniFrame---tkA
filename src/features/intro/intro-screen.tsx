// Created and developed by Jai Singh
import { useCallback, useEffect, useRef, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { CinematicLogo } from '@/components/ui/cinematic-logo'
import { CinematicOverture } from '@/features/intro/cinematic-overture'

const TITLE = 'OmniFrame'
const TAGLINE = 'Unified Logistics Intelligence'
const STAGE_REVEAL_MS = 1600
const LOGO_SCALE = 1.45
const LOGO_BOX = Math.round(208 * LOGO_SCALE)
const START_DELAY = STAGE_REVEAL_MS + 350
const AVG_CHAR_DELAY = 95
const TAGLINE_DELAY = START_DELAY + TITLE.length * AVG_CHAR_DELAY + 500
const SWEEP_DELAY = START_DELAY - 120
// Overture fade-out tail that overlaps the reveal for a seamless handoff.
const OVERTURE_FADE_MS = 600

/**
 * Iter-6 — single source of truth for all "this property changes when the
 * theme toggles" transitions. Spread into every themed inline-style block
 * so the dark↔light flip feels like a smooth crossfade, not a snap. The
 * 700ms duration matches the cinematic feel without being so long that
 * the user thinks the click missed.
 */
const THEME_TRANSITION =
  'background 700ms cubic-bezier(0.4,0,0.2,1), background-color 700ms cubic-bezier(0.4,0,0.2,1), color 700ms cubic-bezier(0.4,0,0.2,1), opacity 700ms cubic-bezier(0.4,0,0.2,1), filter 700ms cubic-bezier(0.4,0,0.2,1), border-color 700ms cubic-bezier(0.4,0,0.2,1), height 700ms cubic-bezier(0.4,0,0.2,1)'

export type IntroTheme = 'dark' | 'light'

/**
 * Local palette object — keeps both modes byte-identical except for the
 * literal color values. Avoids pulling in a global theme system; the intro
 * page is a pre-app surface and stays self-contained.
 *
 * Light mode is exposed via `?theme=light` on the `/intro` URL only;
 * default (no query) renders dark exactly as before.
 */
type StagePalette = {
  outerBg: string
  /** Inline `background` value for the stage. Pure color in dark, vertical
   *  gradient in light to give the off-white stage a paper→cool-blue lift. */
  stageBackground: string
  gridLine: string
  /** Radial mask applied to the grid backdrop. Light tightens the central
   *  spotlight area so the lattice dissolves more aggressively at corners. */
  gridMask: string
  stageGlow: string
  /** Full radial-gradient string for the corner vignette. Iter-4 light pulls
   *  a stronger slate vignette so the corners anchor the cinematic frame
   *  WITHOUT letterbox bars. */
  edgeVignette: string
  letterboxClass: string
  letterboxShadow: string
  /** Letterbox bar height in `vh`. Iter-4 sets light to `0` so the frame
   *  is full-bleed; dark stays at the original `9vh`. */
  letterboxVH: number
  wordmarkColor: string
  /** Tailwind weight class on the wordmark — light needs more weight to feel
   *  premium against a near-white backdrop. */
  wordmarkWeightClass: string
  /** Tailwind tracking class on the wordmark. Light reads better at 0.10em. */
  wordmarkTrackingClass: string
  wordmarkFilter: string
  wordmarkLatestFilter: string
  cursorColor: string
  cursorTextShadow: string
  taglineColor: string
  /** Final letter-spacing value for the tagline once it settles in. */
  taglineFinalTracking: string
  /** Optional CSS `filter` on the tagline `<p>` — light gives it a barely-
   *  there drop-shadow so it lifts off the paper. Empty string in dark. */
  taglineFilter: string
  sweepGradient: string
  sweepFilter: string
  moteBg: string
  moteShadow: string
  grainBlend: string
  grainOpacity: number
  /** Iter-6 — runtime light/dark toggle UI. The button shows the OPPOSITE
   *  mode's icon so the user intuits "click to switch to that". */
  toggleSurface: string
  toggleBorder: string
  toggleAccent: string
  toggleIconColor: string
}

/**
 * Light palette is anchored on the user-specified corporate blue
 * `#0070C0` (RGB 0, 112, 192) — a true mid-blue that sits between
 * sky-600 and blue-700 in saturation. It harmonises with the cube glyph
 * color `#0080D0` (sampled from `public/images/OneBoxLogoX.png`)
 * without dominating it, so the wordmark and the cube read as the same
 * blue family with the wordmark as the slightly-deeper authority.
 *
 * Iteration history:
 * - Iter 1 (cyan-700 wordmark) — read as teal/green-blue. Rejected.
 * - Iter 2 (blue-800 navy wordmark) — read as too-deep navy. Rejected.
 * - Iter 3 (this — `#0070C0` literal everywhere) — anchored on a single
 *   constant `LIGHT_BLUE_ANCHOR` so future iterations only have to nudge
 *   one literal. Letterbox bars reverted to neutral slate `#0f172a` and
 *   the tagline reverted to neutral slate `rgba(15,23,42,0.62)` so the
 *   wordmark is the only blue element competing for attention. Reference
 *   mockup: `~/.cursor/projects/.../assets/omniframe-light-mockup.png`.
 */
const LIGHT_BLUE_ANCHOR = '#0070C0'
/** RGB triple of LIGHT_BLUE_ANCHOR for use inside `rgba(...)` literals. */
const LBA_RGB = '0,112,192'

const PALETTE: Record<IntroTheme, StagePalette> = {
  dark: {
    outerBg: 'bg-black',
    stageBackground: '#020617',
    gridLine: 'rgba(6,182,212,0.05)',
    gridMask: 'radial-gradient(ellipse at center, black 40%, transparent 85%)',
    stageGlow: 'rgba(6,182,212,0.12)',
    edgeVignette:
      'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)',
    letterboxClass: 'bg-black',
    letterboxShadow: 'rgba(0,0,0,0.9)',
    letterboxVH: 9,
    wordmarkColor: '#7dd3fc',
    wordmarkWeightClass: 'font-semibold',
    wordmarkTrackingClass: 'tracking-[0.12em]',
    wordmarkFilter:
      'drop-shadow(0 0 22px rgba(6,182,212,0.55)) drop-shadow(0 0 48px rgba(6,182,212,0.22))',
    wordmarkLatestFilter:
      'brightness(1.9) drop-shadow(0 0 16px rgba(6,182,212,0.9))',
    cursorColor: 'rgba(6,182,212,0.95)',
    cursorTextShadow: '0 0 14px rgba(6,182,212,0.7)',
    taglineColor: 'rgba(148,197,253,0.72)',
    taglineFinalTracking: '0.45em',
    // Iter-6: no-op drop-shadow (instead of empty string) so CSS can
    // smoothly interpolate the tagline filter into light's real drop-shadow
    // on theme toggle.
    taglineFilter: 'drop-shadow(0 0 0 rgba(0,0,0,0))',
    sweepGradient:
      'linear-gradient(90deg, transparent 0%, transparent 30%, rgba(186,230,253,0.85) 50%, transparent 70%, transparent 100%)',
    sweepFilter: 'blur(1px) drop-shadow(0 0 18px rgba(6,182,212,0.95))',
    moteBg: 'rgba(186,230,253,0.55)',
    moteShadow: '0 0 6px rgba(6,182,212,0.45)',
    grainBlend: 'overlay',
    grainOpacity: 0.06,
    // Iter-6 toggle UI — dark surface = slate-900 @ 45% with backdrop blur,
    // border + accent + icon all in the cyan-300 family that matches the
    // wordmark. Sun icon is shown in dark mode (= "click to go light").
    toggleSurface: 'rgba(15,23,42,0.45)',
    toggleBorder: 'rgba(125,211,252,0.30)',
    toggleAccent: 'rgba(125,211,252,0.50)',
    toggleIconColor: 'rgba(125,211,252,0.85)',
  },
  light: {
    outerBg: 'bg-[#e2e8f0]',
    stageBackground: 'linear-gradient(180deg, #fdfdff 0%, #f1f5fb 100%)',
    gridLine: `rgba(${LBA_RGB},0.13)`,
    gridMask: 'radial-gradient(ellipse at center, black 25%, transparent 75%)',
    stageGlow: `rgba(${LBA_RGB},0.10)`,
    // Iter-5: tightened the inner edge from 35% → 28% so the cluster sits
    // in a more focused pocket of light. Corner alpha kept at 0.42 — pushing
    // past that turns into theatrical-spotlight territory.
    edgeVignette:
      'radial-gradient(ellipse at center, transparent 28%, rgba(51,65,85,0.22) 92%, rgba(30,41,59,0.42) 100%)',
    // Letterbox JSX still renders, but at vh=0 it has no visible footprint;
    // bg + shadow are kept for parity but never paint anything.
    letterboxClass: 'bg-[#0f172a]',
    letterboxShadow: 'rgba(15,23,42,0)',
    letterboxVH: 0,
    wordmarkColor: LIGHT_BLUE_ANCHOR,
    wordmarkWeightClass: 'font-bold',
    wordmarkTrackingClass: 'tracking-[0.10em]',
    // Iter-5: three-tier elegant compound drop-shadow — kicker + medium soft
    // drop + wide blue ambient halo. The kicker (1px slate) is what makes
    // the letters feel cut OUT from the paper instead of painted ON it; the
    // medium soft drop gives weight; the wide blue halo emits brand color
    // into the surround. Together: the wordmark reads as physically lifted
    // off the paper, not flat against it.
    wordmarkFilter: `drop-shadow(0 1px 0 rgba(15,23,42,0.22)) drop-shadow(0 8px 16px rgba(15,23,42,0.18)) drop-shadow(0 0 28px rgba(${LBA_RGB},0.30))`,
    wordmarkLatestFilter: `brightness(1.20) drop-shadow(0 0 14px rgba(${LBA_RGB},0.55))`,
    cursorColor: LIGHT_BLUE_ANCHOR,
    cursorTextShadow: `0 0 8px rgba(${LBA_RGB},0.40)`,
    taglineColor: 'rgba(15,23,42,0.62)',
    taglineFinalTracking: '0.38em',
    // Iter-5: barely-there single drop-shadow on the tagline so it lifts off
    // the paper without competing with the wordmark's three-tier stack.
    taglineFilter: 'drop-shadow(0 1px 1px rgba(15,23,42,0.12))',
    // Iter-4: dial down the animated reveal sweep so it doesn't compete with
    // the new persistent anamorphic streak (~30% drop on peak alpha).
    sweepGradient: `linear-gradient(90deg, transparent 0%, transparent 30%, rgba(${LBA_RGB},0.40) 50%, transparent 70%, transparent 100%)`,
    sweepFilter: 'blur(1px) drop-shadow(0 0 10px rgba(15,23,42,0.18))',
    moteBg: `rgba(${LBA_RGB},0.45)`,
    moteShadow: '0 0 6px rgba(15,23,42,0.18)',
    grainBlend: 'multiply',
    // Iter-5: drop full-frame grain to 0.03 in light so it doesn't stack
    // visibly with the new in-stage paper-grain layer.
    grainOpacity: 0.03,
    // Iter-6 toggle UI — light surface = white @ 55% with backdrop blur,
    // border + accent + icon all anchored on `#0070C0`. Moon icon is shown
    // in light mode (= "click to go dark").
    toggleSurface: 'rgba(255,255,255,0.55)',
    toggleBorder: `rgba(${LBA_RGB},0.30)`,
    toggleAccent: `rgba(${LBA_RGB},0.50)`,
    toggleIconColor: `rgba(${LBA_RGB},0.85)`,
  },
}

/**
 * Iter-4 ambient cinema layer values for light mode. Centralised here so
 * the JSX stays readable and tuning is a one-line change. None of these
 * apply in dark mode — the dark code path renders no extra layers.
 *
 * First pass used the spec defaults (0.40/0.18/0.32/0.28) but read too
 * subtle at 4K against the bright off-white stage. Bumped each layer
 * roughly +50% to land in the cinematic mockup's contrast range.
 */
const LIGHT_AMBIENT = {
  /** Wide horizontal-oval pale-sky-blue light wash centred slightly above
   *  centre — the "soft stage key light from above". Iter-5 anchored
   *  higher (40% → 32% y) and reshaped to taller-narrower (75% × 42% →
   *  70% × 50%) so the cone of light tapers downward like a real key
   *  light from above the lens. */
  volumetricWash:
    'radial-gradient(ellipse 70% 50% at 50% 32%, rgba(186,230,253,0.78) 0%, rgba(186,230,253,0.36) 35%, transparent 70%)',
  /** Cool-blue mist that thickens toward the floor — "stage air slightly
   *  dustier near the floor". */
  lowerHaze:
    'linear-gradient(180deg, transparent 0%, rgba(186,210,240,0.32) 50%, rgba(148,163,184,0.55) 100%)',
  lowerHazeHeight: '52%',
  /** Persistent frozen-lens-flare horizontal streak running through the
   *  wordmark area; behind the cluster, in front of the grid. */
  streakGradient:
    'linear-gradient(90deg, transparent 0%, transparent 12%, rgba(186,230,253,0.88) 50%, transparent 88%, transparent 100%)',
  streakFilter: `blur(30px) drop-shadow(0 0 28px rgba(${LBA_RGB},0.28))`,
  streakOpacity: 0.95,
  /** Iter-5: barely-there fractal-noise paper grain inside the stage so the
   *  off-white surface doesn't read as a perfectly flat digital backdrop.
   *  Distinct from the full-frame `<GrainLayer />` (which sits at z-40
   *  across the whole composition). 0.05 multiply is the floor — pushing
   *  past 0.06 starts to read as "dirty". */
  paperGrain: {
    opacity: 0.05,
    blendMode: 'multiply' as const,
    image:
      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='p'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='2' seed='4'/><feColorMatrix values='0 0 0 0 0.05  0 0 0 0 0.07  0 0 0 0 0.10  0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23p)'/></svg>\")",
    size: '200px 200px',
  },
} as const

function readInitialTheme(): IntroTheme {
  if (typeof window === 'undefined') return 'dark'
  const params = new URLSearchParams(window.location.search)
  return params.get('theme') === 'light' ? 'light' : 'dark'
}

/**
 * Full-screen cinematic video intro.
 *
 * Two-act timeline (dark mode):
 *
 *  Act I — Cinematic Overture (~4.8 s)
 *    A spark descends into the void, ignites the OmniFrame hub, eight
 *    satellite systems fan out, beams connect them, and data packets begin
 *    flowing along the mesh. Closes with a bright push-in flash.
 *
 *  Act II — Reveal (current intro, unchanged)
 *    0.0 s   Letterbox bars slide in, stage blurs/scales up from behind a
 *            vignette (camera opening).
 *    1.6 s   Stage fully revealed — cube logo animates in, orbital rings
 *            expand, pulsars emit.
 *    1.85 s  Anamorphic lens-flare sweep crosses the wordmark area.
 *    2.0 s   LLM-style token-by-token reveal of "OmniFrame" begins.
 *    2.85 s  Tagline eases in underneath with letter-spacing expansion.
 *
 * Light mode (`?theme=light`) skips Act I entirely — the overture is a
 * "spark in the void" piece that doesn't translate to a light backdrop —
 * and goes straight to Act II with a re-coloured palette.
 */
export default function IntroScreen() {
  // Iter-6: theme is now state (was useMemo) so the in-page toggle can flip
  // it at runtime. URL param wins on initial mount; no param = dark default.
  const [theme, setTheme] = useState<IntroTheme>(() => readInitialTheme())
  const palette = PALETTE[theme]

  // In light mode the overture is bypassed — we go straight to Act II.
  // Initial values still come from the FIRST theme read; in-page toggling
  // never replays the overture (handled by the bypass-on-toggle effect below).
  const [overtureDone, setOvertureDone] = useState(theme === 'light')
  const [overtureMounted, setOvertureMounted] = useState(theme !== 'light')
  const [stageIn, setStageIn] = useState(false)

  const handleOvertureComplete = useCallback(() => {
    setOvertureDone(true)
  }, [])

  /**
   * Iter-6 toggle handler. Flips state, mirrors to the URL via
   * `history.replaceState` (no router navigation, no remount), and lets the
   * smooth-crossfade transitions on the themed elements do the visual work.
   */
  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: IntroTheme = prev === 'dark' ? 'light' : 'dark'
      try {
        const url = new URL(window.location.href)
        if (next === 'dark') url.searchParams.delete('theme')
        else url.searchParams.set('theme', 'light')
        window.history.replaceState({}, '', url.toString())
      } catch {
        /* non-browser env or sandboxed history — ignore */
      }
      return next
    })
  }, [])

  // Iter-6: if the user toggles to light WHILE the overture is still
  // playing, short-circuit it — the light palette has no equivalent for the
  // "spark in the void" piece. Stage reveal fires next frame. The reverse
  // (light → dark mid-session) does NOT replay the overture; once
  // `overtureDone` is true, it stays true.
  useEffect(() => {
    if (theme === 'light' && !overtureDone) {
      setOvertureDone(true)
      setOvertureMounted(false)
    }
  }, [theme, overtureDone])

  // Once the overture signals complete, kick off the stage reveal on the next
  // frame and unmount the overture after the cross-fade finishes so it stops
  // consuming RAF cycles.
  useEffect(() => {
    if (!overtureDone) return
    const raf = requestAnimationFrame(() => setStageIn(true))
    const unmountTimer = window.setTimeout(
      () => setOvertureMounted(false),
      OVERTURE_FADE_MS + 200
    )
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(unmountTimer)
    }
  }, [overtureDone])

  return (
    <div
      className={`fixed inset-0 overflow-hidden ${palette.outerBg}`}
      data-testid='intro-screen'
      data-theme={theme}
    >
      {overtureMounted && (
        <div
          className='pointer-events-none absolute inset-0 z-40'
          style={{
            opacity: overtureDone ? 0 : 1,
            transition: `opacity ${OVERTURE_FADE_MS}ms cubic-bezier(0.16,1,0.3,1)`,
          }}
        >
          <CinematicOverture onComplete={handleOvertureComplete} />
        </div>
      )}

      <GrainLayer palette={palette} />

      {/* CAMERA / STAGE — fades from black, blurs out, pushes in slightly.
          Iter-6: append THEME_TRANSITION so the stage background swap from
          dark color to light gradient crossfades on theme toggle. */}
      <div
        className='absolute inset-0 flex items-center justify-center'
        style={{
          background: palette.stageBackground,
          opacity: stageIn ? 1 : 0,
          transform: stageIn ? 'scale(1)' : 'scale(1.08)',
          filter: stageIn ? 'blur(0px)' : 'blur(22px)',
          transition: `opacity ${STAGE_REVEAL_MS}ms cubic-bezier(0.16,1,0.3,1), transform ${STAGE_REVEAL_MS + 400}ms cubic-bezier(0.16,1,0.3,1), filter ${STAGE_REVEAL_MS}ms cubic-bezier(0.16,1,0.3,1), ${THEME_TRANSITION}`,
        }}
      >
        {/* Subtle grid backdrop masked to a radial vignette. The mask
            transition between gradients is a hard cut (CSS doesn't
            interpolate gradient stops) — masked by the smooth crossfade
            of all the layers above it. */}
        <div
          className='pointer-events-none absolute inset-0'
          style={{
            backgroundImage: `linear-gradient(${palette.gridLine} 1px, transparent 1px), linear-gradient(90deg, ${palette.gridLine} 1px, transparent 1px)`,
            backgroundSize: '48px 48px',
            maskImage: palette.gridMask,
            WebkitMaskImage: palette.gridMask,
            transition: THEME_TRANSITION,
          }}
        />
        {/* Soft cyan stage glow */}
        <div
          className='pointer-events-none absolute inset-0'
          style={{
            background: `radial-gradient(ellipse at center, ${palette.stageGlow} 0%, transparent 60%)`,
            transition: THEME_TRANSITION,
          }}
        />

        {/* Iter-4 light-mode ambient cinema layers. Iter-6: always rendered
            (no longer gated by `theme === 'light'`), with opacity flipping
            between 0 (dark) and 1 (light) so the runtime toggle smoothly
            crossfades them in/out. All sit behind the main cluster (z-10)
            and behind the edge vignette. In dark mode they have opacity 0
            so they're invisible — the small painting cost is negligible. */}
        {/* Volumetric light wash — wide horizontal-oval key light from
            above, centred slightly above the mathematical middle. */}
        <div
          aria-hidden='true'
          className='pointer-events-none absolute inset-0'
          style={{
            background: LIGHT_AMBIENT.volumetricWash,
            opacity: theme === 'light' ? 1 : 0,
            transition: THEME_TRANSITION,
          }}
        />
        {/* Atmospheric haze in the lower-third — stage air thickening
            toward the floor. */}
        <div
          aria-hidden='true'
          className='pointer-events-none absolute inset-x-0 bottom-0'
          style={{
            height: LIGHT_AMBIENT.lowerHazeHeight,
            background: LIGHT_AMBIENT.lowerHaze,
            opacity: theme === 'light' ? 1 : 0,
            transition: THEME_TRANSITION,
          }}
        />
        {/* Iter-5 paper grain — barely-there fractal noise inside the
            stage so the off-white surface doesn't read as a perfectly
            flat digital backdrop. */}
        <div
          aria-hidden='true'
          className='pointer-events-none absolute inset-0'
          style={{
            opacity: theme === 'light' ? LIGHT_AMBIENT.paperGrain.opacity : 0,
            mixBlendMode: LIGHT_AMBIENT.paperGrain.blendMode,
            backgroundImage: LIGHT_AMBIENT.paperGrain.image,
            backgroundSize: LIGHT_AMBIENT.paperGrain.size,
            transition: THEME_TRANSITION,
          }}
        />
        {/* Persistent anamorphic horizontal streak — frozen lens flare
            mid-frame highlight that runs through the wordmark area.
            Different from <LensSweep /> which is the animated reveal. */}
        <div
          aria-hidden='true'
          className='pointer-events-none absolute inset-x-0 top-1/2'
          style={{
            height: '1px',
            transform: 'translateY(-50%)',
            background: LIGHT_AMBIENT.streakGradient,
            filter: LIGHT_AMBIENT.streakFilter,
            opacity: theme === 'light' ? LIGHT_AMBIENT.streakOpacity : 0,
            transition: THEME_TRANSITION,
          }}
        />

        {/* Dust motes + reveal cluster — mounted only after the overture
            completes so their internal timers don't drift during Act I. */}
        {overtureDone && (
          <>
            <Motes palette={palette} />

            {/* MAIN CLUSTER */}
            <div
              className='relative z-10 flex flex-col items-center gap-8 md:flex-row md:items-center md:gap-14'
              data-testid='intro-hero-cluster'
            >
              <div
                className='flex shrink-0 items-center justify-center'
                style={{ width: LOGO_BOX, height: LOGO_BOX }}
                data-testid='intro-logo-mark'
              >
                <div
                  style={{
                    transform: `scale(${LOGO_SCALE})`,
                    transformOrigin: 'center',
                  }}
                >
                  <CinematicLogo theme={theme} />
                </div>
              </div>

              <div className='relative flex flex-col items-center md:items-start'>
                <LensSweep palette={palette} />
                <StreamingTitle palette={palette} />
                <Tagline palette={palette} />
              </div>
            </div>
          </>
        )}

        {/* Edge vignette — darken corners for cinema feel. Iter-4 light
            uses a stronger slate vignette since letterbox bars are dropped.
            Iter-6: the gradient swap is a hard cut (CSS doesn't interpolate
            between gradients with different stop counts) but the cumulative
            crossfade of all the layers above it masks the snap. */}
        <div
          className='pointer-events-none absolute inset-0'
          style={{
            background: palette.edgeVignette,
            transition: THEME_TRANSITION,
          }}
        />
      </div>

      {/* LETTERBOX BARS — cinema aspect framing, above everything. Light
          mode sets palette.letterboxVH=0 so the JSX renders but has no
          visible footprint (slide-in transform animation still runs).
          Iter-6: extended the existing transform transition with
          THEME_TRANSITION so `height` smoothly collapses (light) /
          expands (dark) on toggle. */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 z-30 ${palette.letterboxClass}`}
        style={{
          height: `${palette.letterboxVH}vh`,
          transform: stageIn ? 'translateY(0)' : 'translateY(-100%)',
          transition: `transform 900ms cubic-bezier(0.16,1,0.3,1) 150ms, ${THEME_TRANSITION}`,
          boxShadow: `0 4px 24px ${palette.letterboxShadow}`,
        }}
      />
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 z-30 ${palette.letterboxClass}`}
        style={{
          height: `${palette.letterboxVH}vh`,
          transform: stageIn ? 'translateY(0)' : 'translateY(100%)',
          transition: `transform 900ms cubic-bezier(0.16,1,0.3,1) 150ms, ${THEME_TRANSITION}`,
          boxShadow: `0 -4px 24px ${palette.letterboxShadow}`,
        }}
      />

      {/* Iter-6 in-page theme toggle — anchored top-right of the outer
          fixed container, OUTSIDE both data-testids so the screenshot
          script's clip-screenshots never include it. Mounted only after
          `overtureDone` so it never pokes through the Cinematic Overture
          in dark mode. The defensive hide in scripts/screenshot-intro.mjs
          is belt-and-suspenders against future layout shifts.
          z-35 sits ABOVE the letterbox bars (z-30) so the toggle stays
          accessible in dark mode — bars are 9vh tall and would otherwise
          permanently cover a toggle pinned at top:24. The button's own
          backdrop-blur surface keeps it readable against the slate bar. */}
      {overtureDone && (
        <button
          type='button'
          data-testid='intro-theme-toggle'
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          role='switch'
          aria-checked={theme === 'light'}
          className='intro-theme-toggle absolute z-[35] flex items-center justify-center rounded-full'
          style={{
            top: 24,
            right: 24,
            width: 40,
            height: 40,
            background: palette.toggleSurface,
            color: palette.toggleIconColor,
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            // CSS variables drive the .intro-theme-toggle:hover/focus rules
            // in src/index.css.
            ['--toggle-border' as never]: palette.toggleBorder,
            ['--toggle-accent' as never]: palette.toggleAccent,
            transition: THEME_TRANSITION,
          }}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      )}
    </div>
  )
}

/**
 * LLM-style streaming title: every character is mounted from the start at
 * opacity 0 so layout is stable, then each one un-blurs + lifts + flashes
 * bright cyan as it becomes "the freshly emitted token".
 */
function StreamingTitle({ palette }: { palette: StagePalette }) {
  const [revealed, setRevealed] = useState(0)
  const [latestIdx, setLatestIdx] = useState(-1)
  const [blinkOn, setBlinkOn] = useState(true)
  const timeoutRef = useRef<number | null>(null)
  const latestClearRef = useRef<number | null>(null)

  useEffect(() => {
    const startTimer = window.setTimeout(() => {
      let i = 0
      const step = () => {
        i += 1
        setRevealed(i)
        setLatestIdx(i - 1)
        if (latestClearRef.current) window.clearTimeout(latestClearRef.current)
        latestClearRef.current = window.setTimeout(() => setLatestIdx(-1), 340)
        if (i < TITLE.length) {
          const jitter = AVG_CHAR_DELAY - 25 + Math.random() * 80
          timeoutRef.current = window.setTimeout(step, jitter)
        }
      }
      step()
    }, START_DELAY)

    return () => {
      window.clearTimeout(startTimer)
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
      if (latestClearRef.current) window.clearTimeout(latestClearRef.current)
    }
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setBlinkOn((v) => !v), 520)
    return () => window.clearInterval(id)
  }, [])

  const done = revealed >= TITLE.length

  return (
    <div
      className={`flex items-baseline font-mono text-6xl md:text-8xl ${palette.wordmarkWeightClass} ${palette.wordmarkTrackingClass}`}
      style={{
        color: palette.wordmarkColor,
        filter: palette.wordmarkFilter,
        // Iter-6: wordmark color + three-tier filter compound smoothly
        // interpolate on theme toggle.
        transition: THEME_TRANSITION,
      }}
    >
      <h1 className='m-0 leading-none'>
        {TITLE.split('').map((ch, idx) => {
          const isRevealed = idx < revealed
          const isLatest = idx === latestIdx
          return (
            <span
              key={idx}
              aria-hidden={!isRevealed}
              style={{
                display: 'inline-block',
                opacity: isRevealed ? 1 : 0,
                transform: isRevealed
                  ? 'translateY(0) scale(1)'
                  : 'translateY(8px) scale(0.9)',
                filter: isLatest
                  ? palette.wordmarkLatestFilter
                  : 'brightness(1)',
                transition:
                  'opacity 220ms ease, transform 340ms cubic-bezier(0.16, 1, 0.3, 1), filter 700ms ease',
              }}
            >
              {ch}
            </span>
          )
        })}
      </h1>
      <span
        aria-hidden='true'
        className='ml-1 inline-block font-mono leading-none font-light'
        style={{
          width: '0.55em',
          color: palette.cursorColor,
          opacity: done ? (blinkOn ? 1 : 0) : 1,
          textShadow: palette.cursorTextShadow,
          animation: done
            ? 'cinematic-cursor-fade 2.4s ease-out 2s forwards'
            : undefined,
        }}
      >
        ▍
      </span>
    </div>
  )
}

function Tagline({ palette }: { palette: StagePalette }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setVisible(true), TAGLINE_DELAY)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <p
      className='mt-5 text-center font-mono text-[11px] uppercase md:text-left md:text-sm'
      style={{
        color: palette.taglineColor,
        filter: palette.taglineFilter || undefined,
        opacity: visible ? 1 : 0,
        letterSpacing: visible ? palette.taglineFinalTracking : '0.1em',
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
        transition: `opacity 1.1s ease, transform 1.1s ease, letter-spacing 1.4s cubic-bezier(0.16,1,0.3,1), ${THEME_TRANSITION}`,
      }}
    >
      {TAGLINE}
    </p>
  )
}

/**
 * Anamorphic horizontal lens-flare sweep that crosses the title area
 * right before the first character streams in — very Blade Runner-esque.
 */
function LensSweep({ palette }: { palette: StagePalette }) {
  const [play, setPlay] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setPlay(true), SWEEP_DELAY)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <div
      aria-hidden='true'
      className='pointer-events-none absolute top-1/2 left-0 z-20'
      style={{
        width: '120%',
        height: '2px',
        transform: 'translateY(-50%)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: palette.sweepGradient,
          filter: palette.sweepFilter,
          opacity: play ? 1 : 0,
          transform: play ? 'translateX(10%)' : 'translateX(-100%)',
          transition:
            'transform 1200ms cubic-bezier(0.16,1,0.3,1), opacity 280ms ease',
          animation: play
            ? 'intro-sweep-fade 1400ms ease-out forwards'
            : undefined,
        }}
      />
    </div>
  )
}

/** Slow-drifting dust motes in the stage air — extra depth. */
function Motes({ palette }: { palette: StagePalette }) {
  const motes = [
    { left: '12%', top: '22%', size: 2, dur: 12, delay: 0 },
    { left: '78%', top: '18%', size: 1.5, dur: 15, delay: 2 },
    { left: '30%', top: '75%', size: 2, dur: 11, delay: 1 },
    { left: '84%', top: '68%', size: 1.5, dur: 14, delay: 3 },
    { left: '55%', top: '15%', size: 1.5, dur: 13, delay: 4 },
    { left: '20%', top: '55%', size: 2, dur: 16, delay: 2.5 },
    { left: '68%', top: '48%', size: 1.5, dur: 12, delay: 1.5 },
    { left: '45%', top: '88%', size: 2, dur: 17, delay: 3.5 },
  ]
  return (
    <div className='pointer-events-none absolute inset-0 overflow-hidden'>
      {motes.map((m, i) => (
        <div
          key={i}
          className='absolute rounded-full'
          style={{
            left: m.left,
            top: m.top,
            width: m.size,
            height: m.size,
            background: palette.moteBg,
            boxShadow: palette.moteShadow,
            animation: `intro-mote-drift ${m.dur}s ease-in-out ${m.delay}s infinite`,
            opacity: 0,
          }}
        />
      ))}
    </div>
  )
}

/** Subtle film-grain overlay for texture (CSS-only, no image asset). */
function GrainLayer({ palette }: { palette: StagePalette }) {
  return (
    <div
      aria-hidden='true'
      className='pointer-events-none absolute inset-0 z-40'
      style={{
        opacity: palette.grainOpacity,
        mixBlendMode: palette.grainBlend as React.CSSProperties['mixBlendMode'],
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='7'/><feColorMatrix values='0 0 0 0 1   0 0 0 0 1   0 0 0 0 1   0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        backgroundSize: '160px 160px',
      }}
    />
  )
}

// Created and developed by Jai Singh
