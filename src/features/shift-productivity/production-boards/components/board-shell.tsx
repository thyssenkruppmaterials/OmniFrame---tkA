// Created and developed by Jai Singh
import { type ReactNode } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import type { BoardSlug } from '../lib/boards'

interface BoardShellProps {
  slug: BoardSlug
  children: ReactNode
}

/**
 * Animated transition wrapper around the active board. Honours
 * `prefers-reduced-motion` via `<MotionConfig reducedMotion="user">`.
 *
 * The animation is intentionally subtle (8 px slide, 250 ms) — boards are
 * dense surfaces and a flashy transition would distract.
 */
export function BoardShell({ slug, children }: BoardShellProps) {
  return (
    <MotionConfig reducedMotion='user'>
      <AnimatePresence mode='wait' initial={false}>
        <motion.div
          key={slug}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </MotionConfig>
  )
}

// Created and developed by Jai Singh
