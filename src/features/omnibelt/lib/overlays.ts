// Created and developed by Jai Singh
/**
 * OmniBelt — portaled overlay helpers
 *
 * Radix/shadcn dropdowns and tooltips render via Portal at
 * `document.body`. The panel shell sits at z-[60], above the
 * default shadcn z-50 — without a bump, menu/tooltip layers paint
 * behind the glass. Click-outside on the panel must also ignore
 * pointer events inside those portaled layers.
 *
 * Tool-shell dialogs (`AgentChatDialog`) also render in a Radix
 * Portal at `document.body`, so their DOM tree is outside the panel
 * skin's `[data-omnibelt-host]` subtree. Without an explicit opt-in,
 * the panel's outside-click handler treats every click inside the
 * dialog as outside-the-panel and collapses both the dialog and
 * the panel underneath. Tool shells tag their portaled content with
 * `data-omnibelt-overlay='true'` so this helper recognises them as
 * OmniBelt-owned overlays and skips the close path.
 */

/** Tailwind class for OmniBelt-adjacent portaled content (menus, tooltips). */
export const OMNIBELT_OVERLAY_Z = 'z-[70]' as const

/** Data attribute opt-in for tool-shell dialogs / sheets / popovers
 *  that render via Radix Portal but should be treated as OmniBelt-
 *  owned surfaces by the panel's outside-click handler. */
export const OMNIBELT_OVERLAY_DATA_ATTR = 'data-omnibelt-overlay' as const

export function isOmnibeltOverlayPointerTarget(
  target: EventTarget | null
): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest('[data-slot="dropdown-menu-content"]') ||
    target.closest('[data-slot="dropdown-menu-sub-content"]') ||
    target.closest('[data-slot="tooltip-content"]') ||
    target.closest('[role="tooltip"]') ||
    target.closest('[data-omnibelt-overlay]')
  )
}

// Created and developed by Jai Singh
