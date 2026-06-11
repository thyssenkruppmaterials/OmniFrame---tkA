// Created and developed by Jai Singh
import type { Transition, Variants } from 'framer-motion'

const SPRING_OUT: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 30,
  mass: 0.6,
}

const EASE_OUT_CUBIC: Transition = {
  duration: 0.32,
  ease: [0.22, 1, 0.36, 1],
}

const EASE_OUT_FAST: Transition = {
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1],
}

/** Container that staggers its children by 40ms each. */
export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      delayChildren: 0.06,
      staggerChildren: 0.04,
    },
  },
}

/** Soft fade + small vertical lift used for tiles and cards. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.985 },
  visible: { opacity: 1, y: 0, scale: 1, transition: SPRING_OUT },
}

/** Tighter rise for inline stats/badges. */
export const fadeUpFast: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: EASE_OUT_FAST },
}

/** Page-level enter/exit with a directional push. */
export const pagePush: Variants = {
  hidden: { opacity: 0, x: 12 },
  visible: { opacity: 1, x: 0, transition: EASE_OUT_CUBIC },
  exit: {
    opacity: 0,
    x: -12,
    transition: { duration: 0.16, ease: [0.4, 0, 1, 1] },
  },
}

/** Press feedback for tappable surfaces (whileTap). */
export const tapScale = { scale: 0.97 }

export { EASE_OUT_CUBIC, EASE_OUT_FAST, SPRING_OUT }

// Created and developed by Jai Singh
