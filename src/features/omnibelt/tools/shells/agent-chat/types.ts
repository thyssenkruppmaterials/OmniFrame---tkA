// Created and developed by Jai Singh
/**
 * OmniBelt — Agent Chat shared types
 *
 * Single source of truth for the chat surface. Lives outside the
 * components so test fixtures, the prompt-input context, and the
 * future v1.5 agent transport can all import from one place.
 */

/** Roles the chat surface understands. */
export type ChatRole = 'user' | 'agent'

/**
 * Composer modes. Each mode tints the input chrome (cyan / violet /
 * orange) and is echoed back on `onSend` so the (eventually) real
 * agent can route Search vs Think vs Canvas requests differently.
 *
 * v1: cosmetic only — the stub agent ignores `mode`.
 */
export type ChatMode = 'search' | 'think' | 'canvas'

/**
 * In-memory chat attachment. v1 keeps the raw `File` so the message
 * list can render an inline image thumbnail via `URL.createObjectURL`
 * without round-tripping through a storage backend.
 *
 * v1.5 will replace the `file` field with a `url` (post-upload) so
 * messages can survive a refresh.
 */
export type ChatAttachment = {
  id: string
  name: string
  size: number
  mimeType: string
  file: File
  /** `object-url` cached at create time so the message list and the
   *  ImageViewDialog reuse the same blob URL. The owner of the
   *  attachment is responsible for `URL.revokeObjectURL` on unmount. */
  previewUrl: string
}

/** Single chat row rendered by `<ChatMessageList>`. */
export type ChatMessage = {
  id: string
  role: ChatRole
  /** Plain text for v1. v1.5 will swap this for a richer
   *  markdown / tool-call discriminated payload. */
  content: string
  attachments?: ChatAttachment[]
  createdAt: number
  /** Echoed from the composer when present so the agent bubble can
   *  pick up a subtle accent matching the mode the user sent in. */
  mode?: ChatMode
}

/** Bounds the file picker — anything bigger is silently rejected with
 *  a thrown error the caller can toast on. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024 // 10 MB

// Created and developed by Jai Singh
