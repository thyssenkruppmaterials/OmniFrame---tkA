// Created and developed by Jai Singh
/**
 * ChatMessageList — render contract + auto-scroll behaviour.
 *
 *   - Empty state shows the welcome hero so the dialog isn't a
 *     blank rectangle on first open.
 *   - User + agent bubbles render with the correct role markers
 *     so screen-readers and Playwright selectors can disambiguate.
 *   - Typing indicator shows when `isAgentResponding` is true.
 *   - `scrollIntoView` fires when the message count changes
 *     (auto-scroll to bottom on new message).
 */
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatMessageList } from '../ChatMessageList'
import type { ChatMessage } from '../types'

// jsdom doesn't implement scrollIntoView — stub once per test.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  vi.clearAllMocks()
})

function userMsg(id: string, content: string): ChatMessage {
  return {
    id,
    role: 'user',
    content,
    createdAt: 1_700_000_000_000,
  }
}

function agentMsg(id: string, content: string): ChatMessage {
  return {
    id,
    role: 'agent',
    content,
    createdAt: 1_700_000_000_500,
  }
}

describe('ChatMessageList', () => {
  it('renders the empty-state hero when there are no messages', () => {
    render(<ChatMessageList messages={[]} />)
    expect(screen.getByTestId('omnibelt-chat-empty')).toBeInTheDocument()
    expect(
      screen.getByText(/start chatting with the omniframe agent/i)
    ).toBeInTheDocument()
    // The scrollable list wrapper should not exist in empty state.
    expect(screen.queryByTestId('omnibelt-chat-list')).not.toBeInTheDocument()
  })

  it('renders user and agent bubbles with role-tagged testids', () => {
    render(
      <ChatMessageList
        messages={[userMsg('m1', 'hello'), agentMsg('m2', 'hi there')]}
      />
    )
    expect(screen.getByTestId('omnibelt-chat-list')).toBeInTheDocument()
    expect(screen.getByTestId('omnibelt-chat-message-user')).toHaveTextContent(
      'hello'
    )
    expect(screen.getByTestId('omnibelt-chat-message-agent')).toHaveTextContent(
      'hi there'
    )
  })

  it('preserves newlines in message content', () => {
    render(<ChatMessageList messages={[userMsg('m1', 'line one\nline two')]} />)
    const bubble = screen.getByTestId('omnibelt-chat-message-user')
    // Newline rendered as a <br>.
    expect(bubble.querySelector('br')).not.toBeNull()
    expect(bubble).toHaveTextContent(/line one/)
    expect(bubble).toHaveTextContent(/line two/)
  })

  it('surfaces a typing indicator when the agent is responding', () => {
    render(
      <ChatMessageList
        messages={[userMsg('m1', 'are you there?')]}
        isAgentResponding
      />
    )
    expect(screen.getByTestId('omnibelt-chat-typing')).toBeInTheDocument()
  })

  it('auto-scrolls the sentinel into view when new messages arrive', () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    const { rerender } = render(
      <ChatMessageList messages={[userMsg('m1', 'first')]} />
    )
    expect(spy).toHaveBeenCalled()
    spy.mockClear()
    rerender(
      <ChatMessageList
        messages={[userMsg('m1', 'first'), agentMsg('m2', 'second')]}
      />
    )
    expect(spy).toHaveBeenCalled()
  })
})

// Created and developed by Jai Singh
