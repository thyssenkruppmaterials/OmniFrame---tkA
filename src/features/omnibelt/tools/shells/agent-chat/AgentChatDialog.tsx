// Created and developed by Jai Singh
/**
 * OmniBelt — Agent Chat dialog
 *
 * The full chat surface mounted by `<AgentChatShell>`. Uses the
 * project's shadcn `<Dialog>` (NOT a fresh Radix wrapper) so focus,
 * Escape, and click-outside are handled identically to every other
 * dialog in the app.
 *
 * Layout:
 *   ┌────────────────────────────────────────────┐
 *   │ Agent Chat              [×]                │ ← header
 *   │ Powered by OmniFrame agent                 │
 *   ├────────────────────────────────────────────┤
 *   │                                            │
 *   │  <ChatMessageList /> (scrollable)          │
 *   │                                            │
 *   ├────────────────────────────────────────────┤
 *   │ <PromptInputBox />                         │ ← footer
 *   └────────────────────────────────────────────┘
 *
 * v1 stubs the agent: every user send schedules a synthetic agent
 * reply after a short delay. Real LLM wiring lands in v1.5 — the
 * `handleSend` callback is the only swap point.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { IconRobot } from '@tabler/icons-react'
import { motion, useReducedMotion, useWillChange } from 'framer-motion'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  CONTENT_STAGGER,
  HOUSE_EASE,
  TOOL_LAUNCH_SPRING,
} from '../../../lib/motion'
import { ChatMessageList } from './ChatMessageList'
import { PromptInputBox } from './PromptInputBox'
import type { ChatAttachment, ChatMessage, ChatMode } from './types'

export type AgentChatDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const AGENT_REPLY_DELAY_MS = 1200

function newId(): string {
  const fromCrypto = globalThis.crypto?.randomUUID?.()
  if (typeof fromCrypto === 'string') return fromCrypto
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function buildStubReply(
  userText: string,
  files: File[] | undefined,
  voiceDurationMs: number | undefined
): string {
  const parts: string[] = []
  parts.push('(agent stub) I received your message.')
  if (userText) {
    const trimmed =
      userText.length > 200 ? `${userText.slice(0, 200)}…` : userText
    parts.push(`\nYou said: "${trimmed}"`)
  }
  if (files && files.length > 0) {
    parts.push(
      `\nAttached ${files.length} file${files.length === 1 ? '' : 's'}.`
    )
  }
  if (voiceDurationMs) {
    const seconds = Math.round(voiceDurationMs / 1000)
    parts.push(`\nVoice memo: ${seconds}s.`)
  }
  parts.push('\n\nReal LLM wiring lands in v1.5.')
  return parts.join('')
}

export function AgentChatDialog({ open, onOpenChange }: AgentChatDialogProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isAgentResponding, setIsAgentResponding] = useState(false)
  // Track timeout so closing the dialog mid-reply doesn't fire a
  // dangling setState into an unmounted tree.
  const replyTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (replyTimer.current !== null) {
        window.clearTimeout(replyTimer.current)
        replyTimer.current = null
      }
    }
  }, [])

  const handleSend = useCallback(
    (
      message: string,
      files?: File[],
      options?: { mode: ChatMode | null; voiceDurationMs?: number }
    ) => {
      // Mirror the file list into ChatAttachment shape so the
      // message list can render thumbnails. Object URLs are owned
      // by the message; cleanup happens when the dialog unmounts.
      const attachments: ChatAttachment[] | undefined = files?.map((f) => ({
        id: newId(),
        name: f.name,
        size: f.size,
        mimeType: f.type,
        file: f,
        previewUrl: URL.createObjectURL(f),
      }))

      const userMsg: ChatMessage = {
        id: newId(),
        role: 'user',
        content: message,
        attachments,
        createdAt: Date.now(),
        mode: options?.mode ?? undefined,
      }
      setMessages((prev) => [...prev, userMsg])
      setIsAgentResponding(true)

      if (replyTimer.current !== null) {
        window.clearTimeout(replyTimer.current)
      }
      replyTimer.current = window.setTimeout(() => {
        const replyContent = buildStubReply(
          message,
          files,
          options?.voiceDurationMs
        )
        const agentMsg: ChatMessage = {
          id: newId(),
          role: 'agent',
          content: replyContent,
          createdAt: Date.now(),
          mode: options?.mode ?? undefined,
        }
        setMessages((prev) => [...prev, agentMsg])
        setIsAgentResponding(false)
        replyTimer.current = null
      }, AGENT_REPLY_DELAY_MS)
    },
    []
  )

  // Revoke object URLs attached to messages on dialog unmount so the
  // browser releases the underlying blobs.
  useEffect(() => {
    return () => {
      for (const m of messages) {
        if (!m.attachments) continue
        for (const a of m.attachments) {
          try {
            URL.revokeObjectURL(a.previewUrl)
          } catch {
            /* noop */
          }
        }
      }
    }
    // Run only at unmount — per-message cleanup happens implicitly
    // because we never remove messages today (v1.5 will add clear).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reduced = useReducedMotion() ?? false
  // Managed promotion — `auto` until the launch spring runs; the dialog
  // only mounts while open (see [[fixing-motion-performance]]).
  const willChange = useWillChange()

  // Section-level reveal — header → message list → composer cascade
  // after the dialog container has settled. Tuned shorter than the
  // panel's grid stagger so the chat surface feels alive within the
  // first ~400 ms of mount. Reduced-motion collapses the variants to
  // a flat opacity tween via framer's MotionConfig at the host.
  const sectionVariants = reduced
    ? {
        hidden: { opacity: 0 },
        show: { opacity: 1, transition: { duration: 0 } },
      }
    : {
        hidden: { opacity: 0, y: 6 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.28, ease: HOUSE_EASE },
        },
      }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal>
      <DialogContent
        data-testid='omnibelt-agent-chat-dialog'
        // Mark this Radix-Portaled surface as an OmniBelt-owned
        // overlay so the panel/skin's outside-click handler skips it
        // (the dialog renders at document.body, outside the panel's
        // `[data-omnibelt-host]` subtree). Without this, every click
        // inside the chat is interpreted as outside-the-panel and
        // collapses both. See [[Fix-OmniBelt-AgentChat-Instant-Close]].
        data-omnibelt-overlay='true'
        className={cn(
          'flex h-[640px] max-h-[85vh] w-full max-w-3xl flex-col gap-0 overflow-hidden border-white/10 bg-[#1F2023] p-0 text-white sm:max-w-3xl md:max-w-[800px]'
        )}
      >
        {/*
          Two-layer reveal:
          1. Outer motion.div springs from scale 0.94 → 1 on mount
             (cinematic "lift") on top of Radix's default zoom-in-95
             / fade-in-0. Object-literal initial/animate so framer
             can't dilute the spring with a variant name.
          2. Inner motion.div uses variant names ('hidden' → 'show')
             so the staggered children below cascade in after the
             outer container settles. Framer only propagates variants
             to children when the parent's `initial`/`animate` are
             variant names, hence the split.
          Reduced-motion is honoured by the host's MotionConfig +
          the `reduced` shortcut on the section variants below.
        */}
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 8 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 4 }}
          transition={TOOL_LAUNCH_SPRING}
          className='flex h-full min-h-0 flex-col gap-0'
          style={{ willChange }}
        >
          <motion.div
            initial='hidden'
            animate='show'
            variants={{
              hidden: {},
              show: { transition: CONTENT_STAGGER },
            }}
            className='flex h-full min-h-0 flex-col gap-0'
          >
            <motion.div variants={sectionVariants}>
              <DialogHeader className='flex flex-row items-center gap-3 border-b border-white/10 px-5 py-4 text-left'>
                <div
                  aria-hidden='true'
                  className='grid size-9 place-items-center rounded-full bg-violet-500/20 text-violet-300'
                >
                  <IconRobot className='size-5' />
                </div>
                <div className='flex flex-col gap-0.5'>
                  <DialogTitle className='text-base font-semibold text-white'>
                    Agent Chat
                  </DialogTitle>
                  <DialogDescription className='text-xs text-white/60'>
                    Powered by OmniFrame agent
                  </DialogDescription>
                </div>
              </DialogHeader>
            </motion.div>

            <motion.div
              variants={sectionVariants}
              className='flex min-h-0 flex-1 flex-col'
            >
              <ChatMessageList
                messages={messages}
                isAgentResponding={isAgentResponding}
              />
            </motion.div>

            <motion.div
              variants={sectionVariants}
              className='border-t border-white/10 bg-[#1F2023] p-3'
            >
              <PromptInputBox
                onSend={handleSend}
                isLoading={isAgentResponding}
                placeholder='Ask the OmniFrame agent…'
              />
            </motion.div>
          </motion.div>
        </motion.div>
      </DialogContent>
    </Dialog>
  )
}

// Created and developed by Jai Singh
