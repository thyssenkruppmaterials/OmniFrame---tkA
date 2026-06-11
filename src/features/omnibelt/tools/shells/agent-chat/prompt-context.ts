// Created and developed by Jai Singh
/**
 * OmniBelt — Agent Chat composer context
 *
 * Tiny React context wired by `<PromptInputBox>` so sibling controls
 * (mode toggles, voice recorder, send button) can read the live
 * draft, attachment list, and isLoading flag without a tall prop
 * cascade. Keeps the input box readable — see `PromptInputBox.tsx`
 * for the provider that mints the value.
 */
import { createContext, useContext } from 'react'
import type { ChatAttachment, ChatMode } from './types'

export type PromptInputContextValue = {
  /** Current textarea value (controlled). */
  value: string
  /** Pending files staged for the next send. Cleared on submit. */
  attachments: ChatAttachment[]
  /** Active composer mode — drives accent color + the label shown
   *  next to each mode toggle when active. */
  mode: ChatMode | null
  /** True while the parent is waiting on an agent reply. Disables
   *  submit + morphs the send button into a "stop" affordance. */
  isLoading: boolean
  /** True while the voice recorder is actively capturing. The send
   *  button morphs into a stop-recording variant in that case. */
  isRecording: boolean
}

/**
 * Default value is `null` so any consumer rendered outside a
 * `<PromptInputProvider>` throws via `usePromptInput` — that's
 * always a wiring bug, never a runtime fallback. Mirrors the React
 * docs recommendation for required-context patterns.
 */
const PromptInputContext = createContext<PromptInputContextValue | null>(null)

export const PromptInputProvider = PromptInputContext.Provider

/** Accessor — throws when called outside the provider tree. */
export function usePromptInput(): PromptInputContextValue {
  const ctx = useContext(PromptInputContext)
  if (!ctx) {
    throw new Error(
      'usePromptInput must be called inside a <PromptInputProvider>'
    )
  }
  return ctx
}

// Created and developed by Jai Singh
