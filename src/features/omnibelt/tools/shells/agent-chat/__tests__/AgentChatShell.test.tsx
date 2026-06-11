// Created and developed by Jai Singh
/**
 * Agent Chat shell — mount + close contract.
 *
 * Validates the two responsibilities of `AgentChatShell`:
 *   1. Rendering the shell mounts the chat dialog immediately
 *      (the panel relies on a side-effect-free `default` export).
 *   2. Closing the dialog (via `onOpenChange(false)` synthesised
 *      by Escape, the X close button, or click-outside) invokes
 *      the parent `onClose` so the OmniBelt panel collapses too.
 */
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AgentChatShell from '../AgentChatShell'

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('AgentChatShell', () => {
  it('renders the Agent Chat dialog immediately when mounted', () => {
    render(<AgentChatShell onClose={vi.fn()} />)
    expect(screen.getByTestId('omnibelt-agent-chat-dialog')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /agent chat/i })
    ).toBeInTheDocument()
    // Empty state shows the welcome prompt.
    expect(
      screen.getByText(/start chatting with the omniframe agent/i)
    ).toBeInTheDocument()
  })

  it('invokes onClose when the dialog is dismissed via Escape', () => {
    const onClose = vi.fn()
    render(<AgentChatShell onClose={onClose} />)
    // Radix Dialog listens for keydown on the content; Escape closes
    // it via the same `onOpenChange(false)` we wire into onClose.
    fireEvent.keyDown(screen.getByTestId('omnibelt-agent-chat-dialog'), {
      key: 'Escape',
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders the composer input so the user can type immediately', () => {
    render(<AgentChatShell onClose={vi.fn()} />)
    expect(screen.getByLabelText(/agent chat message/i)).toBeInTheDocument()
  })
})

// Created and developed by Jai Singh
