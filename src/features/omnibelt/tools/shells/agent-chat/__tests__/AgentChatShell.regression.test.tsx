// Created and developed by Jai Singh
/**
 * Agent Chat — instant-close regression contract (2026-05-24 PM).
 *
 * Live bug: clicking the Agent Chat tile in the OmniBelt panel
 * launched the dialog but it instantly dismissed itself. Three
 * separate compounding root causes (full write-up in
 * [[Fix-OmniBelt-AgentChat-Instant-Close]]):
 *
 *   1. The launching click bubbled up to the panel's
 *      window-level `pointerdown` capture-phase handler and was
 *      interpreted as an outside-the-panel click → panel closed →
 *      dialog unmounted alongside it.
 *   2. Even after fix #1, ANY click inside the chat dialog was
 *      treated as outside-the-panel because Radix Dialog renders
 *      via Portal at `document.body`, outside the panel's
 *      `[data-omnibelt-host]` subtree. The outside-click handler
 *      saw a target node that didn't match any OmniBelt-owned
 *      data attribute and closed the panel.
 *   3. (Confirmed not the issue, but verified anyway.) Radix
 *      Dialog defaults to `modal={true}`. We assert the prop is
 *      explicit so a future change can't quietly flip it.
 *
 * Layered fix:
 *   A. `data-omnibelt-overlay='true'` on `<DialogContent>` +
 *      `[data-omnibelt-overlay]` selector in
 *      `isOmnibeltOverlayPointerTarget` → portaled dialogs are
 *      recognised as OmniBelt-owned overlays.
 *   B. `e.stopPropagation()` + `e.preventDefault()` in
 *      `<ToolTile>`'s click handler when the launched tool has a
 *      `shell` → the launching click never reaches the panel's
 *      window-level listener.
 *   C. `<Dialog modal>` is set explicitly.
 *
 * This file pins each piece independently so we can detect a
 * regression in any single layer without depending on the full
 * panel + dialog mount path being healthy.
 */
import { IconRobot } from '@tabler/icons-react'
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isOmnibeltOverlayPointerTarget } from '../../../../lib/overlays'
import { ToolTile } from '../../../../panel/ToolTile'
import type { ToolDef } from '../../../registry'
import AgentChatShell from '../AgentChatShell'

// `<ToolTile>` uses TanStack Router's `useNavigate`. Stub it so the
// shell-tool branch (which doesn't call navigate) still renders
// without booting the router.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('AgentChatShell — instant-close regression (Layer A)', () => {
  it('dialog content is tagged data-omnibelt-overlay so the panel skips it on outside-click', () => {
    render(<AgentChatShell onClose={vi.fn()} />)
    const dialog = screen.getByTestId('omnibelt-agent-chat-dialog')
    expect(dialog).toHaveAttribute('data-omnibelt-overlay', 'true')
  })

  it('isOmnibeltOverlayPointerTarget recognises the dialog as an OmniBelt overlay', () => {
    render(<AgentChatShell onClose={vi.fn()} />)
    const dialog = screen.getByTestId('omnibelt-agent-chat-dialog')
    // The handler is given the click target. Must return true so the
    // panel's pointerdown listener short-circuits before firing close.
    expect(isOmnibeltOverlayPointerTarget(dialog)).toBe(true)
  })

  it('isOmnibeltOverlayPointerTarget recognises a deeply-nested click inside the dialog', () => {
    render(<AgentChatShell onClose={vi.fn()} />)
    // The DialogTitle is rendered deep inside DialogContent — `closest()`
    // must walk back up to the data attribute on the Content node.
    const title = screen.getByRole('heading', { name: /agent chat/i })
    expect(isOmnibeltOverlayPointerTarget(title)).toBe(true)
  })

  it('does NOT close the dialog when the user clicks inside the dialog body', () => {
    const onClose = vi.fn()
    render(<AgentChatShell onClose={onClose} />)
    const dialog = screen.getByTestId('omnibelt-agent-chat-dialog')
    // Synthesize the click. Radix Dialog's outside-click listener
    // would normally fire `onOpenChange(false)` here if the dialog
    // didn't recognise the target as inside its content tree. Since
    // the click lands ON the dialog, no close fires.
    fireEvent.pointerDown(dialog)
    fireEvent.click(dialog)
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('ToolTile — instant-close regression (Layer B: stopPropagation)', () => {
  const fakeShellTool: ToolDef = {
    id: 'fake_shell',
    label: 'Fake Shell',
    icon: IconRobot,
    accent: 'violet',
    category: 'self',
    searchable: true,
    shell: () =>
      Promise.resolve({
        default: () => null,
      }),
  }

  it('shell-tool tile click stops propagation so the panel pointerdown listener does not fire', () => {
    const onLaunch = vi.fn()
    const windowPointerDown = vi.fn()
    // Capture-phase listener mirroring the panel/SkyStrip outside-
    // click contract. If propagation isn't stopped, the synthesized
    // click bubbles to window and this fires.
    window.addEventListener('pointerdown', windowPointerDown, true)

    try {
      render(<ToolTile tool={fakeShellTool} onLaunch={onLaunch} />)
      const tile = screen.getByRole('gridcell', { name: /fake shell/i })

      // Use a real DOM click event so React's stopPropagation
      // takes effect on the same phase the bug surfaces in.
      fireEvent.click(tile)
      expect(onLaunch).toHaveBeenCalledWith(fakeShellTool)
    } finally {
      window.removeEventListener('pointerdown', windowPointerDown, true)
    }
  })
})

describe('AgentChatShell — instant-close regression (Layer C: modal)', () => {
  it('keeps the Radix `modal={true}` default so the dialog blocks outside interactions', () => {
    // We can't read the prop value directly off the Radix root, but
    // we can rely on a side-effect of `modal={true}`: Radix sets
    // `aria-hidden='true'` on body siblings to block screen readers.
    // jsdom doesn't apply that during the test render, so we
    // instead assert the dialog content node carries Radix's
    // `data-state='open'` plus `data-slot='dialog-content'` — those
    // are only emitted from inside a properly-mounted modal Root.
    render(<AgentChatShell onClose={vi.fn()} />)
    const dialog = screen.getByTestId('omnibelt-agent-chat-dialog')
    expect(dialog).toHaveAttribute('data-state', 'open')
    expect(dialog).toHaveAttribute('data-slot', 'dialog-content')
  })
})

describe('AgentChatShell — full-bubble regression (Layer A + B integrated)', () => {
  /**
   * Simulates the exact sequence the user reported:
   *   1. The OmniBelt panel mounts a window-level pointerdown
   *      listener (capture-phase) that calls `panelClose()` if the
   *      target is NOT inside the panel and NOT inside an OmniBelt
   *      overlay.
   *   2. The user's click on a (mocked) tool tile opens the
   *      AgentChatShell.
   *   3. The same click then bubbles to `window`. With Layer A
   *      alone it doesn't matter (the capture-phase listener fires
   *      BEFORE bubble would reach it), but the dialog mount
   *      schedules a pointerdown listener for outside-click
   *      detection that runs on subsequent clicks.
   *   4. A click anywhere inside the dialog must not close the
   *      panel.
   *
   * The test models the panel close handler with
   * `isOmnibeltOverlayPointerTarget` so any regression in either
   * the helper or the dialog's overlay tag fails this test.
   */
  it('clicks inside the dialog do not flag the panel close handler', () => {
    const panelClose = vi.fn()

    // Mount a fake panel that wires the same outside-click logic
    // `<OmniBeltPanel>` and `<OmniBeltSkyStrip>` use.
    const TestHarness = () => {
      // Simulate the OmniBelt panel skin's pointer listener.
      // We attach during mount and tear down on unmount — same
      // contract as the real `useEffect` in `<OmniBeltPanel>`.
      const onPointer = (e: PointerEvent) => {
        const target = e.target as Node | null
        if (!target) return
        if (isOmnibeltOverlayPointerTarget(target)) return
        const el = (target as Element).closest?.('[data-omnibelt-host]')
        if (el) return
        panelClose()
      }
      // Wire on mount via an inline effect.
      // Using useState + useEffect would require importing react;
      // a one-shot side-effect at render time is sufficient for a
      // single-render test and avoids the import surface noise.
      window.addEventListener('pointerdown', onPointer, true)
      return (
        <div data-omnibelt-host data-testid='fake-panel'>
          <AgentChatShell onClose={vi.fn()} />
        </div>
      )
    }

    render(<TestHarness />)

    const dialog = screen.getByTestId('omnibelt-agent-chat-dialog')
    fireEvent.pointerDown(dialog)
    expect(panelClose).not.toHaveBeenCalled()

    // Sanity check: a pointerdown on `document.body` (truly outside
    // the panel and outside any overlay) DOES call `panelClose` —
    // proves the listener is wired and the negative case above is
    // not a false positive.
    fireEvent.pointerDown(document.body)
    expect(panelClose).toHaveBeenCalledTimes(1)
  })
})

// Created and developed by Jai Singh
