// Created and developed by Jai Singh
/**
 * Constants for the Work Queue Management dispatcher tab.
 *
 * Animation primitives are pulled out so the timing band lives in
 * one place — design tweaks are a single-file edit, and the
 * `<MotionConfig>` at the top of the tab can re-export the tokens
 * without scanning every component for inline springs.
 *
 * `OPERATOR_TASK_QUEUE_LIMIT` is re-exported from
 * `operator-task-queue.tsx` so the existing 12-task per-lane
 * planning horizon stays in one place; bumping it later is a single
 * line change in the dialog file. We re-export rather than redeclare
 * to keep the two surfaces lockstep.
 */
import type { Variants, Transition } from 'framer-motion'
import { OPERATOR_TASK_QUEUE_LIMIT } from '@/components/operator-task-queue'

export { OPERATOR_TASK_QUEUE_LIMIT }

/**
 * Tasks per lane beyond which the NEXT pipeline switches from plain
 * DOM rendering to `@tanstack/react-virtual`. Below this threshold
 * the layout-measure cost of virtualization (one ResizeObserver per
 * row, scroll re-measure on every paint) is more expensive than
 * just rendering the rows.
 */
export const VIRTUALIZATION_PER_LANE_THRESHOLD = 12

/**
 * Total visible tasks across ALL lanes beyond which we eagerly turn
 * on virtualization for every lane (even ones below the per-lane
 * threshold). Keeps the dispatcher fluid when many operators each
 * have a moderate queue.
 */
export const VIRTUALIZATION_TOTAL_THRESHOLD = 110

/**
 * Estimated row height for the NEXT pipeline. Used by react-virtual
 * as the initial measurement; ResizeObserver corrects per-row after
 * mount.
 */
export const PIPELINE_ROW_HEIGHT_PX = 56

/**
 * Pipeline scroll cap before the operator lane becomes scrollable.
 * Roughly fits 6–7 pipeline rows at PIPELINE_ROW_HEIGHT_PX.
 */
export const PIPELINE_SCROLL_HEIGHT_PX = 420

/**
 * Spring for "task lands in lane" enter animation. Lifted from the
 * spec — sized so the card visibly springs in (overshoots slightly)
 * without feeling bouncy. Composed into `PIPELINE_ITEM_VARIANTS`
 * below; not exported separately because every consumer reaches
 * it via the variants object.
 */
const SPRING_TASK_ENTER: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 28,
  mass: 0.85,
}

/**
 * Spring for "lane appears" (operator comes online). Slightly
 * softer than the per-task spring — a lane is a heavier surface and
 * the supervisor's eye should track it without feeling startled.
 */
export const SPRING_LANE_ENTER: Transition = {
  type: 'spring',
  stiffness: 320,
  damping: 30,
  mass: 1,
}

/**
 * Easing tween for fade-out exits. Material-style cubic curve —
 * accelerated start, decelerated end, ~220ms total. Reduced motion
 * collapses this to opacity-only via `<MotionConfig reducedMotion>`.
 * Internal — composed into `PIPELINE_ITEM_VARIANTS` below.
 */
const TRANSITION_TASK_EXIT: Transition = {
  duration: 0.22,
  ease: [0.4, 0, 0.2, 1],
}

/**
 * Stagger spec for batched task arrivals. Threshold detection lives
 * in the dispatcher hook (see `use-multi-operator-tasks`) — when
 * 2+ tasks land within ~100ms we apply the stagger; single arrivals
 * skip it so they animate immediately without a delay.
 */
export const TASK_ENTER_STAGGER_BURST_MS = 100
const TASK_ENTER_STAGGER_CHILD_MS = 30
const TASK_ENTER_STAGGER_DELAY_MS = 40

/**
 * Glow keyframes for the active / in-progress card pulse. Keyed
 * outside the component so the same loop spec is reused by the
 * skeleton (which doesn't pulse, but inherits the height) and by
 * any future variant (paused, recount-in-progress, etc.).
 */
export const ACTIVE_GLOW_KEYFRAMES = [
  '0 0 0 0 rgba(16,185,129,0.0)',
  '0 0 0 6px rgba(16,185,129,0.15)',
  '0 0 0 0 rgba(16,185,129,0.0)',
] as const

export const ACTIVE_GLOW_TRANSITION: Transition = {
  duration: 2.4,
  repeat: Infinity,
  ease: 'easeInOut',
}

/**
 * `framer-motion` `Variants` for the NEXT pipeline list. The list
 * orchestrates `staggerChildren` only when a burst is in flight (see
 * the dispatcher hook); otherwise the children animate solo via
 * `SPRING_TASK_ENTER`. Reduced-motion users get instant cards via
 * the surrounding `<MotionConfig reducedMotion="user">` wrapper.
 */
export const PIPELINE_LIST_VARIANTS: Variants = {
  hidden: {},
  visible: ({ stagger = false }: { stagger?: boolean } = {}) => ({
    transition: stagger
      ? {
          staggerChildren: TASK_ENTER_STAGGER_CHILD_MS / 1000,
          delayChildren: TASK_ENTER_STAGGER_DELAY_MS / 1000,
        }
      : undefined,
  }),
}

export const PIPELINE_ITEM_VARIANTS: Variants = {
  hidden: { opacity: 0, x: 12 },
  visible: { opacity: 1, x: 0, transition: SPRING_TASK_ENTER },
  exit: { opacity: 0, y: -8, scale: 0.985, transition: TRANSITION_TASK_EXIT },
}

/**
 * Cross-lane reassign undo window in milliseconds. Toast lifetime
 * matches so the affordance vanishes when the action becomes
 * unrecoverable.
 */
export const CROSS_LANE_UNDO_TIMEOUT_MS = 8_000

// Created and developed by Jai Singh
