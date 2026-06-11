// Created and developed by Jai Singh
import { useEffect, useState } from 'react'

export type CinematicLogoTheme = 'dark' | 'light'

/**
 * Iter-6 — must match the THEME_TRANSITION in intro-screen.tsx so the
 * runtime light/dark toggle crossfades cube shadows + orbital ring filters
 * + ambient halo smoothly. Duplicated locally instead of imported to keep
 * cinematic-logo.tsx independent of its parent file.
 */
const THEME_TRANSITION =
  'opacity 700ms cubic-bezier(0.4,0,0.2,1), filter 700ms cubic-bezier(0.4,0,0.2,1), border-color 700ms cubic-bezier(0.4,0,0.2,1), background 700ms cubic-bezier(0.4,0,0.2,1), background-color 700ms cubic-bezier(0.4,0,0.2,1), box-shadow 700ms cubic-bezier(0.4,0,0.2,1)'

type LogoPalette = {
  flashGradient: string
  ambientGradient: string
  outerRingBorder: string
  outerRingDot: { background: string; boxShadow: string }
  secondRingBorder: string
  secondRingDot: { background: string; boxShadow: string }
  innerRingBorder: string
  pulsarBorder: string
  pulsarBoxShadow: string
  pulsarAnimation: string
  /** Iter-5: optional CSS `filter` applied to each orbital ring `<div>` so
   *  the borders read as light-emitting in light mode. Empty string in
   *  dark (the keyframe glow already does this work). */
  ringFilter: string
  /** Iter-5: optional CSS `filter` applied to each pulsar shockwave `<div>`
   *  so the borders feel like soft expanding sonar pings. Empty in dark. */
  pulsarFilter: string
  cubeFilter: string
  cubeAnimation: string
  particleBackground: string
  particleBoxShadow: string
}

/**
 * User-specified anchor for the light palette: a true mid-blue between
 * sky-600 and blue-700 that harmonises with the cube glyph color
 * (`#0080D0` sampled from `public/images/OneBoxLogoX.png`) without
 * competing with it. Centralized so future iterations only have to
 * nudge two literals here. See iteration history in intro-screen.tsx
 * for why we landed on `#0070C0`.
 */
const LIGHT_BLUE_ANCHOR = '#0070C0'
/** RGB triple for use inside `rgba(...)` literals built around the anchor. */
const LBA_RGB = '0,112,192'

/**
 * Iter-5 cinematic shadow craft — light-mode-only stack of real geometry
 * shadows under the cube. Replaces iter-4's single contact-shadow div
 * with a four-layer product-photography stack: tight contact + medium
 * ambient + wide floor + cube-emitted blue halo. Each layer is barely
 * perceptible on its own; the cumulative effect is dimensional weight
 * (cube reads as SITTING on the stage, not stamped onto it).
 *
 * Light direction is consistent across the stage: an overhead key light
 * from the upper centre means shadows fall slightly downward + slightly
 * outward. All four layers obey this.
 */
const LIGHT_LOGO_AMBIENT = {
  /** Tight contact shadow — narrowest + densest. Anchors the "this object
   *  touches the floor" read. Sharper edges than the others. */
  tightContactShadow: {
    width: 96,
    height: 12,
    bottom: 22,
    background:
      'radial-gradient(ellipse at center, rgba(15,23,42,0.32) 0%, transparent 70%)',
    filter: 'blur(4px)',
  },
  /** Medium ambient shadow — wider + softer + lower density. Gives the
   *  cube real weight by extending the shadow beyond its footprint. */
  mediumAmbientShadow: {
    width: 160,
    height: 36,
    bottom: 12,
    background:
      'radial-gradient(ellipse at center, rgba(15,23,42,0.18) 0%, transparent 70%)',
    filter: 'blur(16px)',
  },
  /** Wide soft floor shadow — broadest + lowest density. Suggests the
   *  cube affects the whole "room" around it, like a hero object. */
  wideFloorShadow: {
    width: 240,
    height: 48,
    bottom: 4,
    background:
      'radial-gradient(ellipse at center, rgba(15,23,42,0.10) 0%, transparent 70%)',
    filter: 'blur(32px)',
  },
  /** Cube-emitted blue ambient halo — slightly strengthened from iter-4
   *  (0.20 → 0.26 centre, 150 → 170 px). Sits in front of the orbital
   *  rings (DOM-after) but behind the cube (cube is z-10). Subtle ambient
   *  presence; NOT a glow. */
  ambientHalo: {
    width: 170,
    height: 170,
    background: `radial-gradient(circle, rgba(${LBA_RGB},0.26) 0%, rgba(${LBA_RGB},0.10) 40%, transparent 70%)`,
    filter: 'blur(44px)',
  },
} as const

const LIGHT_LOGO_PALETTE: LogoPalette = {
  flashGradient: `radial-gradient(circle, rgba(${LBA_RGB},0.22) 0%, transparent 60%)`,
  ambientGradient: `radial-gradient(circle, rgba(${LBA_RGB},0.18) 0%, rgba(56,189,248,0.06) 50%, transparent 70%)`,
  outerRingBorder: `1px solid rgba(${LBA_RGB},0.32)`,
  outerRingDot: {
    background: LIGHT_BLUE_ANCHOR,
    // Iter-5: bumped halo 0.45 → 0.55 so the satellite reads as a tiny
    // light-emitting bead rather than a printed dot.
    boxShadow: `0 1px 4px rgba(15,23,42,0.20), 0 0 6px rgba(${LBA_RGB},0.55)`,
  },
  secondRingBorder: `1px solid rgba(${LBA_RGB},0.22)`,
  secondRingDot: {
    background: `rgba(${LBA_RGB},0.78)`,
    // Iter-5: bumped halo 0.32 → 0.55.
    boxShadow: `0 1px 3px rgba(15,23,42,0.18), 0 0 4px rgba(${LBA_RGB},0.55)`,
  },
  innerRingBorder: `1px solid rgba(${LBA_RGB},0.32)`,
  // Iter-5: pulsar border 0.42 → 0.55 so peak shockwaves feel like soft
  // expanding sonar pings, not faint ghost rings.
  pulsarBorder: `1.5px solid rgba(${LBA_RGB},0.55)`,
  pulsarBoxShadow: '0 0 6px rgba(15,23,42,0.10)',
  pulsarAnimation: 'cinematic-pulsar-light 3.6s ease-out infinite',
  // Iter-5: faint luminous edge on rings + pulsars so they read as light-
  // emitting rather than printed-on. Capped at 0.28 — past 0.32 starts
  // feeling neon.
  ringFilter: `drop-shadow(0 0 6px rgba(${LBA_RGB},0.28))`,
  pulsarFilter: `drop-shadow(0 0 10px rgba(${LBA_RGB},0.22))`,
  // Iter-5: dropped the redundant `0 0 16px rgba(LBA,0.32)` blue halo from
  // the cube img filter — that's now the four-layer shadow stack +
  // ambientHalo div doing the work as REAL geometry. Just one slate
  // drop-shadow on the img itself, slightly bumped (0.20 → 0.22).
  cubeFilter: 'drop-shadow(0 6px 18px rgba(15,23,42,0.22))',
  cubeAnimation:
    'cinematic-logo-reveal-light 1.4s cubic-bezier(0.16, 1, 0.3, 1) forwards, spin 8s linear 1.4s infinite',
  particleBackground: `rgba(${LBA_RGB},0.55)`,
  particleBoxShadow: '0 0 3px rgba(15,23,42,0.15)',
}

const LOGO_PALETTE: Record<CinematicLogoTheme, LogoPalette> = {
  dark: {
    flashGradient:
      'radial-gradient(circle, rgba(6,182,212,0.6) 0%, transparent 60%)',
    ambientGradient:
      'radial-gradient(circle, rgba(6,182,212,0.25) 0%, rgba(59,130,246,0.08) 50%, transparent 70%)',
    outerRingBorder: '1px solid rgba(6,182,212,0.12)',
    outerRingDot: {
      background: 'rgba(6,182,212,0.8)',
      boxShadow:
        '0 0 12px 3px rgba(6,182,212,0.5), 0 0 4px 1px rgba(6,182,212,0.8)',
    },
    secondRingBorder: '1px solid rgba(59,130,246,0.08)',
    secondRingDot: {
      background: 'rgba(147,197,253,0.6)',
      boxShadow: '0 0 8px 2px rgba(147,197,253,0.4)',
    },
    innerRingBorder: '1px solid rgba(6,182,212,0.15)',
    pulsarBorder: '1.5px solid rgba(6,182,212,0.35)',
    pulsarBoxShadow:
      '0 0 8px rgba(6,182,212,0.15), inset 0 0 8px rgba(6,182,212,0.08)',
    // Iter-6: no-op drop-shadows (instead of empty strings) so CSS
    // interpolates smoothly into the light filters on theme toggle.
    ringFilter: 'drop-shadow(0 0 0 rgba(0,0,0,0))',
    pulsarFilter: 'drop-shadow(0 0 0 rgba(0,0,0,0))',
    pulsarAnimation: 'cinematic-pulsar 3.6s ease-out infinite',
    cubeFilter:
      'drop-shadow(0 0 12px rgba(6,182,212,0.4)) drop-shadow(0 0 24px rgba(6,182,212,0.15))',
    cubeAnimation:
      'cinematic-logo-reveal 1.4s cubic-bezier(0.16, 1, 0.3, 1) forwards, spin 8s linear 1.4s infinite',
    particleBackground: 'rgba(6,182,212,0.7)',
    particleBoxShadow: '0 0 4px rgba(6,182,212,0.4)',
  },
  light: LIGHT_LOGO_PALETTE,
}

type CinematicLogoProps = {
  theme?: CinematicLogoTheme
}

export function CinematicLogo({ theme = 'dark' }: CinematicLogoProps) {
  const palette = LOGO_PALETTE[theme]

  const particles = [
    { left: '22%', top: '18%', delay: '0s', dur: '6s' },
    { left: '72%', top: '28%', delay: '1.2s', dur: '5s' },
    { left: '38%', top: '78%', delay: '2.4s', dur: '7s' },
    { left: '82%', top: '62%', delay: '0.6s', dur: '5.5s' },
    { left: '12%', top: '52%', delay: '1.8s', dur: '6.5s' },
    { left: '58%', top: '88%', delay: '3.2s', dur: '4.5s' },
    { left: '48%', top: '12%', delay: '0.3s', dur: '5.8s' },
    { left: '88%', top: '42%', delay: '2.1s', dur: '6.2s' },
  ]

  return (
    <div
      className='relative flex h-52 w-52 items-center justify-center'
      style={{
        animation:
          'cinematic-entrance 1.8s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      }}
    >
      {/* Iter-5 light-mode four-layer cube shadow stack — replaces iter-4's
          single contact-shadow div with product-photography depth. Stacked
          broadest-and-softest first (paints behind everything), narrowest-
          and-densest last (paints just before the entrance flash). The cube
          (z-10) paints over all four. Cumulative effect: cube reads as
          SITTING on the stage, not stamped onto it.
          Iter-6: always rendered (was `theme === 'light' && (...)`) with
          opacity flipping between 0 (dark) and 1 (light) so the runtime
          toggle smoothly crossfades the stack in/out. */}
      {/* (1) Wide soft floor shadow — broadest, lowest density. */}
      <div
        aria-hidden='true'
        className='pointer-events-none absolute rounded-[50%]'
        style={{
          width: LIGHT_LOGO_AMBIENT.wideFloorShadow.width,
          height: LIGHT_LOGO_AMBIENT.wideFloorShadow.height,
          bottom: LIGHT_LOGO_AMBIENT.wideFloorShadow.bottom,
          left: '50%',
          transform: 'translateX(-50%)',
          background: LIGHT_LOGO_AMBIENT.wideFloorShadow.background,
          filter: LIGHT_LOGO_AMBIENT.wideFloorShadow.filter,
          opacity: theme === 'light' ? 1 : 0,
          transition: THEME_TRANSITION,
        }}
      />
      {/* (2) Medium ambient shadow — wider + softer than the contact. */}
      <div
        aria-hidden='true'
        className='pointer-events-none absolute rounded-[50%]'
        style={{
          width: LIGHT_LOGO_AMBIENT.mediumAmbientShadow.width,
          height: LIGHT_LOGO_AMBIENT.mediumAmbientShadow.height,
          bottom: LIGHT_LOGO_AMBIENT.mediumAmbientShadow.bottom,
          left: '50%',
          transform: 'translateX(-50%)',
          background: LIGHT_LOGO_AMBIENT.mediumAmbientShadow.background,
          filter: LIGHT_LOGO_AMBIENT.mediumAmbientShadow.filter,
          opacity: theme === 'light' ? 1 : 0,
          transition: THEME_TRANSITION,
        }}
      />
      {/* (3) Tight contact shadow — narrowest, densest, sharpest edges.
          Anchors the "this object touches the floor" read. */}
      <div
        aria-hidden='true'
        className='pointer-events-none absolute rounded-[50%]'
        style={{
          width: LIGHT_LOGO_AMBIENT.tightContactShadow.width,
          height: LIGHT_LOGO_AMBIENT.tightContactShadow.height,
          bottom: LIGHT_LOGO_AMBIENT.tightContactShadow.bottom,
          left: '50%',
          transform: 'translateX(-50%)',
          background: LIGHT_LOGO_AMBIENT.tightContactShadow.background,
          filter: LIGHT_LOGO_AMBIENT.tightContactShadow.filter,
          opacity: theme === 'light' ? 1 : 0,
          transition: THEME_TRANSITION,
        }}
      />

      {/* Entrance flash — bright bloom that fades after reveal */}
      <div
        className='pointer-events-none absolute rounded-full'
        style={{
          width: 160,
          height: 160,
          background: palette.flashGradient,
          filter: 'blur(30px)',
          animation: 'cinematic-flash 2s ease-out forwards',
        }}
      />

      {/* Deep ambient glow */}
      <div
        className='pointer-events-none absolute rounded-full'
        style={{
          width: 120,
          height: 120,
          background: palette.ambientGradient,
          filter: 'blur(25px)',
          animation: 'cinematic-glow 4s ease-in-out 1.8s infinite',
          opacity: 0,
        }}
      />

      {/* Outer orbital ring */}
      <div
        className='pointer-events-none absolute rounded-full'
        style={{
          width: 180,
          height: 180,
          border: palette.outerRingBorder,
          filter: palette.ringFilter || undefined,
          animation:
            'cinematic-ring-expand 1.6s cubic-bezier(0.16, 1, 0.3, 1) 0.4s forwards, spin 30s linear 2s infinite',
          opacity: 0,
          transform: 'scale(0.3)',
          transition: THEME_TRANSITION,
        }}
      >
        <div
          className='absolute rounded-full'
          style={{
            width: 6,
            height: 6,
            top: -3,
            left: '50%',
            marginLeft: -3,
            background: palette.outerRingDot.background,
            boxShadow: palette.outerRingDot.boxShadow,
            transition: THEME_TRANSITION,
          }}
        />
      </div>

      {/* Second orbital ring (counter-rotating) */}
      <div
        className='pointer-events-none absolute rounded-full'
        style={{
          width: 200,
          height: 200,
          border: palette.secondRingBorder,
          filter: palette.ringFilter || undefined,
          animation:
            'cinematic-ring-expand 1.8s cubic-bezier(0.16, 1, 0.3, 1) 0.6s forwards, spin 45s linear 2.4s infinite reverse',
          opacity: 0,
          transform: 'scale(0.2)',
          transition: THEME_TRANSITION,
        }}
      >
        <div
          className='absolute rounded-full'
          style={{
            width: 4,
            height: 4,
            bottom: -2,
            left: '33%',
            background: palette.secondRingDot.background,
            boxShadow: palette.secondRingDot.boxShadow,
            transition: THEME_TRANSITION,
          }}
        />
      </div>

      {/* Pulsing inner ring */}
      <div
        className='pointer-events-none absolute rounded-full'
        style={{
          width: 110,
          height: 110,
          border: palette.innerRingBorder,
          filter: palette.ringFilter || undefined,
          animation:
            'cinematic-ring-expand 1.2s cubic-bezier(0.16, 1, 0.3, 1) 0.2s forwards, cinematic-ring-pulse 3s ease-in-out 1.4s infinite',
          opacity: 0,
          transform: 'scale(0.4)',
          transition: THEME_TRANSITION,
        }}
      />

      {/* Pulsar ripple rings — continuous outward shockwaves */}
      {[0, 1, 2].map((i) => (
        <div
          key={`pulsar-${i}`}
          className='pointer-events-none absolute rounded-full'
          style={{
            width: 96,
            height: 96,
            border: palette.pulsarBorder,
            boxShadow: palette.pulsarBoxShadow,
            filter: palette.pulsarFilter || undefined,
            animation: palette.pulsarAnimation,
            animationDelay: `${2 + i * 1.2}s`,
            opacity: 0,
            transition: THEME_TRANSITION,
          }}
        />
      ))}

      {/* Iter-4 light-mode ambient halo — subtle blue tint behind the cube
          so it gently emits presence into the volumetric wash above. Sits
          in front of the orbital rings (DOM-after) but behind the cube
          (cube is z-10; this is default z=auto). NOT a glow — keep alpha
          modest; bumping past 0.20 turns it emissive.
          Iter-6: always rendered with opacity gating so the toggle
          smoothly crossfades it in/out. */}
      <div
        aria-hidden='true'
        className='pointer-events-none absolute rounded-full'
        style={{
          width: LIGHT_LOGO_AMBIENT.ambientHalo.width,
          height: LIGHT_LOGO_AMBIENT.ambientHalo.height,
          background: LIGHT_LOGO_AMBIENT.ambientHalo.background,
          filter: LIGHT_LOGO_AMBIENT.ambientHalo.filter,
          opacity: theme === 'light' ? 1 : 0,
          transition: THEME_TRANSITION,
        }}
      />

      {/* Original PNG cube logo with cinematic entrance.
          Iter-6 caveat: the runtime filter transition only fully takes
          effect after the `cinematic-logo-reveal{,-light}` keyframe ends
          (~1.4s post-mount), because the keyframe's `forwards`-fill 100%
          stop bakes a theme-specific filter that overrides inline
          style.filter while the keyframe is still applied. After the
          reveal, palette.cubeFilter dominates and the transition smoothly
          interpolates on toggle. The screenshot script kills the cube
          animation entirely so captures always reflect palette.cubeFilter
          accurately. See Add-Intro-Light-Mode.md § Iteration 5 follow-up
          for the full mechanic. */}
      <img
        src='/images/OneBoxLogoX.png'
        alt='OmniFrame Logo'
        className='relative z-10 h-24 w-24'
        style={{
          animation: palette.cubeAnimation,
          filter: palette.cubeFilter,
          transition: THEME_TRANSITION,
        }}
      />

      {/* Floating particles — delayed until after entrance */}
      <div className='pointer-events-none absolute inset-0 overflow-hidden'>
        {particles.map((p, i) => (
          <div
            key={i}
            className='absolute rounded-full'
            style={{
              width: i % 3 === 0 ? 2 : 1.5,
              height: i % 3 === 0 ? 2 : 1.5,
              left: p.left,
              top: p.top,
              background: palette.particleBackground,
              boxShadow: palette.particleBoxShadow,
              animation: `cinematic-float ${p.dur} ease-in-out 2s infinite`,
              animationDelay: `calc(2s + ${p.delay})`,
              opacity: 0,
            }}
          />
        ))}
      </div>
    </div>
  )
}

const TITLE = 'OmniFrame'
const TYPE_DELAY = 100
const START_DELAY = 1400

export function MachineTitle() {
  const [charCount, setCharCount] = useState(0)
  const [showCursor, setShowCursor] = useState(true)

  useEffect(() => {
    const startTimer = setTimeout(() => {
      let i = 0
      const interval = setInterval(() => {
        i++
        setCharCount(i)
        if (i >= TITLE.length) clearInterval(interval)
      }, TYPE_DELAY)
      return () => clearInterval(interval)
    }, START_DELAY)
    return () => clearTimeout(startTimer)
  }, [])

  useEffect(() => {
    const blink = setInterval(() => setShowCursor((v) => !v), 530)
    return () => clearInterval(blink)
  }, [])

  const typed = TITLE.slice(0, charCount)
  const done = charCount >= TITLE.length

  return (
    <div
      className='flex items-center justify-center'
      style={{
        opacity: charCount > 0 ? 1 : 0,
        transition: 'opacity 0.3s ease',
      }}
    >
      <h1
        className='font-mono text-xl font-semibold tracking-[0.25em] uppercase'
        style={{
          color: 'rgba(6,182,212,0.9)',
          textShadow:
            '0 0 20px rgba(6,182,212,0.35), 0 0 40px rgba(6,182,212,0.1)',
        }}
      >
        {typed}
      </h1>
      <span
        className='ml-0.5 inline-block font-mono text-xl font-light'
        style={{
          color: 'rgba(6,182,212,0.8)',
          opacity: showCursor ? 1 : 0,
          width: '2px',
          animation: done
            ? 'cinematic-cursor-fade 2s ease-out 1.5s forwards'
            : undefined,
          textShadow: '0 0 6px rgba(6,182,212,0.5)',
        }}
      >
        |
      </span>
    </div>
  )
}

// Created and developed by Jai Singh
