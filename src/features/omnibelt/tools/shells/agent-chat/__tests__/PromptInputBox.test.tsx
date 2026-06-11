// Created and developed by Jai Singh
/**
 * PromptInputBox — composer behaviour contract.
 *
 * Visual fidelity (framer-motion animations, exact accent colors)
 * isn't asserted in jsdom; these tests cover the behavioural
 * contract a future agent transport will rely on:
 *
 *   - Enter submits; Shift+Enter inserts a newline.
 *   - Empty inputs do NOT fire `onSend` (send button morphs into
 *     the mic icon instead).
 *   - Drag-drop of an image file stages an attachment that's then
 *     included in `onSend`.
 *   - Mode toggles update the active mode and tint the matching
 *     pill (asserted via `data-active`).
 *   - The send button morphs through its four states based on
 *     `hasContent`, `isRecording`, and `isLoading` — exposed via
 *     a `data-send-state` attribute for resilient querying.
 *   - Files > 10 MB and non-image files are rejected with an
 *     `role="alert"` message and never reach `onSend`.
 */
import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PromptInputBox } from '../PromptInputBox'

// jsdom doesn't implement `URL.createObjectURL` — stub for the
// attachment preview pipeline. `Object.defineProperty` keeps the
// stub type-safe (no `any` cast on the URL global).
beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((f: Blob) => `blob:mock/${(f as File).name ?? 'unknown'}`),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  })
})
afterEach(() => {
  vi.clearAllMocks()
})

function getTextarea(): HTMLTextAreaElement {
  return screen.getByLabelText(/agent chat message/i) as HTMLTextAreaElement
}

function getSendButton(): HTMLButtonElement {
  // The composer exposes the morph state via `data-send-state` so
  // tests aren't tied to icon identity (the lucide React icons
  // render as opaque SVG nodes in jsdom).
  return document.querySelector<HTMLButtonElement>('button[data-send-state]')!
}

describe('PromptInputBox — submit semantics', () => {
  it('submits on Enter when there is text', () => {
    const onSend = vi.fn()
    render(<PromptInputBox onSend={onSend} />)
    const textarea = getTextarea()
    fireEvent.change(textarea, { target: { value: 'hello agent' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0][0]).toBe('hello agent')
  })

  it('does NOT submit on Shift+Enter — newline only', () => {
    const onSend = vi.fn()
    render(<PromptInputBox onSend={onSend} />)
    const textarea = getTextarea()
    fireEvent.change(textarea, { target: { value: 'first line' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('ignores empty submits (no text, no attachments)', () => {
    const onSend = vi.fn()
    render(<PromptInputBox onSend={onSend} />)
    const textarea = getTextarea()
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('clears the textarea after a successful send', () => {
    const onSend = vi.fn()
    render(<PromptInputBox onSend={onSend} />)
    const textarea = getTextarea()
    fireEvent.change(textarea, { target: { value: 'ping' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(textarea.value).toBe('')
  })
})

describe('PromptInputBox — file attachments', () => {
  it('accepts image drops and includes them on the next send', () => {
    const onSend = vi.fn()
    render(<PromptInputBox onSend={onSend} />)
    const dropZone = screen.getByTestId('omnibelt-prompt-input')
    const file = new File(['x'], 'shot.png', { type: 'image/png' })
    act(() => {
      fireEvent.drop(dropZone, {
        dataTransfer: { files: [file], types: ['Files'] },
      })
    })
    // Attachment preview row appears.
    expect(
      screen.getByTestId('omnibelt-prompt-attachments')
    ).toBeInTheDocument()
    // Send button now reads `send` (we have content via attachment).
    expect(getSendButton().getAttribute('data-send-state')).toBe('send')
    // Submit via Enter on the textarea — files should flow through.
    fireEvent.click(getSendButton())
    expect(onSend).toHaveBeenCalledTimes(1)
    const [text, files] = onSend.mock.calls[0]
    expect(text).toBe('')
    expect(Array.isArray(files)).toBe(true)
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('shot.png')
  })

  it('rejects files larger than 10 MB and surfaces an alert', () => {
    const onSend = vi.fn()
    render(<PromptInputBox onSend={onSend} />)
    const dropZone = screen.getByTestId('omnibelt-prompt-input')
    // 11 MB JPEG.
    const bigBlob = new Uint8Array(11 * 1024 * 1024)
    const file = new File([bigBlob], 'too-big.jpg', { type: 'image/jpeg' })
    act(() => {
      fireEvent.drop(dropZone, {
        dataTransfer: { files: [file], types: ['Files'] },
      })
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/larger than 10 mb/i)
    // No attachment was staged.
    expect(
      screen.queryByTestId('omnibelt-prompt-attachments')
    ).not.toBeInTheDocument()
  })

  it('rejects non-image files', () => {
    render(<PromptInputBox onSend={vi.fn()} />)
    const dropZone = screen.getByTestId('omnibelt-prompt-input')
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
    act(() => {
      fireEvent.drop(dropZone, {
        dataTransfer: { files: [file], types: ['Files'] },
      })
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/only image files/i)
  })
})

describe('PromptInputBox — mode toggles', () => {
  it('toggles the Search mode and reflects the active state', () => {
    render(<PromptInputBox onSend={vi.fn()} />)
    const searchBtn = screen.getByRole('button', { name: /search mode/i })
    expect(searchBtn.getAttribute('data-active')).toBe('false')
    fireEvent.click(searchBtn)
    expect(searchBtn.getAttribute('data-active')).toBe('true')
    expect(searchBtn.getAttribute('aria-pressed')).toBe('true')
  })

  it('passes the active mode to onSend', () => {
    const onSend = vi.fn()
    render(<PromptInputBox onSend={onSend} />)
    fireEvent.click(screen.getByRole('button', { name: /think mode/i }))
    const textarea = getTextarea()
    fireEvent.change(textarea, { target: { value: 'reason about this' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend.mock.calls[0][2]).toMatchObject({ mode: 'think' })
  })

  it('clicking the same mode twice deselects it', () => {
    render(<PromptInputBox onSend={vi.fn()} />)
    const canvasBtn = screen.getByRole('button', { name: /canvas mode/i })
    fireEvent.click(canvasBtn)
    expect(canvasBtn.getAttribute('data-active')).toBe('true')
    fireEvent.click(canvasBtn)
    expect(canvasBtn.getAttribute('data-active')).toBe('false')
  })
})

describe('PromptInputBox — send-button morph', () => {
  it('shows the Mic state when the composer is empty', () => {
    render(<PromptInputBox onSend={vi.fn()} />)
    expect(getSendButton().getAttribute('data-send-state')).toBe('mic')
  })

  it('morphs to Send when text is present', () => {
    render(<PromptInputBox onSend={vi.fn()} />)
    fireEvent.change(getTextarea(), { target: { value: 'hi' } })
    expect(getSendButton().getAttribute('data-send-state')).toBe('send')
  })

  it('morphs to Loading when isLoading is true', () => {
    render(<PromptInputBox onSend={vi.fn()} isLoading />)
    expect(getSendButton().getAttribute('data-send-state')).toBe('loading')
    expect(getSendButton()).toBeDisabled()
  })

  it('morphs to Recording after clicking Mic', () => {
    render(<PromptInputBox onSend={vi.fn()} />)
    fireEvent.click(getSendButton())
    expect(getSendButton().getAttribute('data-send-state')).toBe('recording')
    expect(screen.getByTestId('omnibelt-voice-recorder')).toBeInTheDocument()
  })
})

// Created and developed by Jai Singh
