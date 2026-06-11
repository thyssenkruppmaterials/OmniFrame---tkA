// Created and developed by Jai Singh
/**
 * OmniBelt — motion language constants
 *
 * House spring / easing pulled from
 * `memorybank/OmniFrame/Patterns/Cinematic-Tab-Rotation.md` and
 * referenced by the OmniBelt pattern doc. Centralising them here lets
 * every Pill / Panel / Tray surface inherit the same orchestrated
 * feel without re-typing the magic numbers.
 *
 * Tri-state collapse uses a single `layoutId` on every state so
 * `framer-motion` interpolates size, border-radius and position as one
 * morph (same primitive that drives iOS Dynamic Island). The
 * per-state durations below are tuned for snappiness without
 * stuttering on mid-range hardware.
 *
 * Reduced-motion gating: every consumer should be wrapped in
 * `<MotionConfig reducedMotion='user'>` so framer short-circuits the
 * spring + duration blocks when the OS reports
 * `prefers-reduced-motion: reduce`.
 */
import type { Transition } from 'framer-motion'

/** Shared spring for layout morphs (Pill ↔ Panel ↔ Orb ↔ Nub).
 *  Tuned for iOS-Dynamic-Island feel — quick to start, settles cleanly,
 *  no overshoot wobble. */
export const HOUSE_SPRING: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 32,
  mass: 0.9,
}

/** Stiffer spring reserved for the Sky Strip morph specifically.
 *  Mirrors Apple's Dynamic Island physics — appreciably snappier than
 *  HOUSE_SPRING so the strip → panel bloom reads as a single tactile
 *  movement instead of a soft, fade-y expansion. Keep HOUSE_SPRING as
 *  the default everywhere else; this is opt-in for the SkyStrip skin
 *  only. */
export const ISLAND_SPRING: Transition = {
  type: 'spring',
  stiffness: 600,
  damping: 38,
  mass: 0.85,
  restDelta: 0.001,
}

/** Softer spring for content micro-interactions (tile lift, hover,
 *  drag feedback). Visibly elastic but never silly. */
export const LIQUID_SPRING: Transition = {
  type: 'spring',
  stiffness: 320,
  damping: 26,
  mass: 0.7,
}

/** Snappy spring for in-panel content fades + tab swaps. Faster
 *  than HOUSE_SPRING so secondary motion never "drags" the morph. */
export const SNAP_SPRING: Transition = {
  type: 'spring',
  stiffness: 520,
  damping: 38,
  mass: 0.6,
}

/** Cubic-bezier easing for non-spring transitions (fades, scale-only). */
export const HOUSE_EASE = [0.22, 1, 0.36, 1] as const

/** Cinematic tool-launch spring (2026-05-24 PM).
 *
 *  Used wherever a tool surface enters the viewport — panel grid →
 *  shell swap, AgentChatDialog mount, OrbShellPopover bloom, future
 *  Sheet / Popover tool surfaces. Slightly slower than HOUSE_SPRING
 *  for breath, slightly more damped so dialog-sized rects settle
 *  cleanly without overshoot wobble. The motion budget is still
 *  sub-300 ms perceptually so the open never feels languid.
 *
 *  Pair with `BACKDROP_FADE` for the overlay and `CONTENT_STAGGER`
 *  for child reveal. See [[OmniBelt-Floating-Launcher]] §"Tool launch
 *  motion" for the full recipe. */
export const TOOL_LAUNCH_SPRING: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 32,
  mass: 0.9,
  restDelta: 0.001,
}

/** Backdrop / overlay fade tuned to run in parallel with
 *  `TOOL_LAUNCH_SPRING` so the dialog content's rise lines up with
 *  the scrim darkening. Duration-based (not spring) so framer cleanly
 *  collapses to instant under `prefers-reduced-motion: reduce`. */
export const BACKDROP_FADE: Transition = {
  duration: 0.22,
  ease: HOUSE_EASE,
}

/** Inner content stagger — used after a tool surface has settled to
 *  reveal child elements (header → message list → composer for chat;
 *  search → tabs → grid for the panel) in a smooth cascade. Cap at
 *  ~8 staggered items so the cascade never visibly drifts past the
 *  end of the surface's settle. */
export const CONTENT_STAGGER = {
  delayChildren: 0.08,
  staggerChildren: 0.04,
} as const

/** Tool-tile press feedback. Quick scale-down for haptic feel before
 *  the launch animation fires. Stiffer + lighter than LIQUID_SPRING
 *  so the press reads as a tactile tick, not a soft squish. */
export const TILE_PRESS_TRANSITION: Transition = {
  type: 'spring',
  stiffness: 600,
  damping: 30,
  mass: 0.5,
}

/** Single `layoutId` shared by every Pill/Orb/Panel/Nub host node. */
export const COLLAPSE_LAYOUT_ID = 'omnibelt-host' as const

/** `LayoutGroup` id used at the host wrapper. */
export const COLLAPSE_LAYOUT_GROUP_ID = 'omnibelt' as const

/** Tri-state collapse target durations (ms). Spring is used for the
 * morph itself; these read as the perceptual budget for each path. */
export const PILL_TO_PANEL_MS = 320
export const PILL_TO_ORB_MS = 280
export const ORB_TO_NUB_MS = 200

// Created and developed by Jai Singh
