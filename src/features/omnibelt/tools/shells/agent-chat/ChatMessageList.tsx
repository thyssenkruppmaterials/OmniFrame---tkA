// Created and developed by Jai Singh
/**
 * OmniBelt — Agent Chat: scrollable message list
 *
 * Renders an empty-state hero when there are no messages yet, then
 * a flex column of `<ChatMessage>` bubbles. Auto-scrolls a sentinel
 * `<div>` into view whenever the message count changes so the user
 * always sees the latest exchange.
 *
 * The dialog renders this inside a `flex-1 min-h-0` slot so the
 * list owns its own scroll area independent of the input box.
 */
import { useEffect, useRef, useState } from 'react'
import { IconRobot } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { ChatMessage } from './ChatMessage'
import { ImageViewDialog } from './ImageViewDialog'
import type { ChatMessage as ChatMessageData } from './types'

export type ChatMessageListProps = {
  messages: ChatMessageData[]
  isAgentResponding?: boolean
  className?: string
}

export function ChatMessageList({
  messages,
  isAgentResponding = false,
  className,
}: ChatMessageListProps) {
  const endRef = useRef<HTMLDivElement | null>(null)
  const [preview, setPreview] = useState<{
    src: string
    alt?: string
  } | null>(null)

  useEffect(() => {
    if (!endRef.current) return
    endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, isAgentResponding])

  if (messages.length === 0) {
    return (
      <div
        data-testid='omnibelt-chat-empty'
        className={cn(
          'flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-white/60',
          className
        )}
      >
        <div className='grid size-12 place-items-center rounded-full bg-violet-500/15 text-violet-300'>
          <IconRobot className='size-6' />
        </div>
        <p className='text-sm font-medium text-white'>
          Start chatting with the OmniFrame agent below
        </p>
        <p className='text-xs text-white/50'>
          Try Search for facts, Think for reasoning, or Canvas for drafts.
        </p>
      </div>
    )
  }

  return (
    <div
      data-testid='omnibelt-chat-list'
      className={cn(
        'omnibelt-chat-scroll flex h-full flex-col gap-4 overflow-y-auto px-4 py-4',
        className
      )}
    >
      {messages.map((m) => (
        <ChatMessage
          key={m.id}
          message={m}
          onPreviewImage={(src, alt) => setPreview({ src, alt })}
        />
      ))}
      {isAgentResponding && (
        <div
          data-testid='omnibelt-chat-typing'
          className='flex items-center gap-2 px-2 text-xs text-white/50'
          aria-live='polite'
        >
          <span className='inline-flex gap-1'>
            <span className='size-1.5 animate-bounce rounded-full bg-white/40 [animation-delay:0ms]' />
            <span className='size-1.5 animate-bounce rounded-full bg-white/40 [animation-delay:120ms]' />
            <span className='size-1.5 animate-bounce rounded-full bg-white/40 [animation-delay:240ms]' />
          </span>
          Agent is thinking…
        </div>
      )}
      <div ref={endRef} aria-hidden='true' />
      <ImageViewDialog
        open={preview !== null}
        onOpenChange={(o) => !o && setPreview(null)}
        src={preview?.src ?? null}
        alt={preview?.alt}
      />
    </div>
  )
}

// Created and developed by Jai Singh
