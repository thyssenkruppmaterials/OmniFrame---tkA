// Created and developed by Jai Singh
/**
 * OmniBelt — Agent Chat: single message bubble
 *
 * User bubbles render right-aligned with the white-on-dark palette
 * shared by the input box. Agent bubbles render left-aligned with
 * the project's `bg-muted` token so they read clearly against the
 * dialog's dark backdrop.
 *
 * v1 keeps message rendering deliberately simple:
 *   - Newlines split into `<br>` (no Markdown parsing yet).
 *   - Image attachments render as small thumbnails; tapping fires
 *     the parent's `onPreviewImage` to open the shared
 *     `ImageViewDialog`.
 *
 * Markdown / tool-call rendering lands in v1.5 alongside the real
 * agent backend.
 */
import { useMemo } from 'react'
import { IconRobot, IconUser } from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import type { ChatMessage as ChatMessageData } from './types'

export type ChatMessageProps = {
  message: ChatMessageData
  onPreviewImage?: (src: string, alt?: string) => void
  className?: string
}

function formatTimestamp(ms: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(ms))
  } catch {
    return ''
  }
}

function renderContent(content: string) {
  if (!content) return null
  const lines = content.split('\n')
  return lines.map((line, i) => (
    <span key={i}>
      {line}
      {i < lines.length - 1 && <br />}
    </span>
  ))
}

export function ChatMessage({
  message,
  onPreviewImage,
  className,
}: ChatMessageProps) {
  const isUser = message.role === 'user'
  const timestamp = useMemo(
    () => formatTimestamp(message.createdAt),
    [message.createdAt]
  )

  return (
    <div
      data-testid={`omnibelt-chat-message-${message.role}`}
      data-message-id={message.id}
      className={cn(
        'flex w-full gap-2',
        isUser ? 'justify-end' : 'justify-start',
        className
      )}
    >
      {!isUser && (
        <div
          aria-hidden='true'
          className='mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-violet-500/20 text-violet-300'
        >
          <IconRobot className='size-4' />
        </div>
      )}
      <div
        className={cn(
          'flex max-w-[80%] flex-col gap-1',
          isUser ? 'items-end' : 'items-start'
        )}
      >
        <div
          className={cn(
            'rounded-2xl px-3 py-2 text-sm leading-relaxed',
            isUser
              ? 'rounded-br-sm bg-white text-black'
              : 'rounded-bl-sm bg-white/[0.06] text-white'
          )}
        >
          {renderContent(message.content)}
          {message.attachments && message.attachments.length > 0 && (
            <div className='mt-2 flex flex-wrap gap-2'>
              {message.attachments.map((att) => (
                <button
                  key={att.id}
                  type='button'
                  onClick={() => onPreviewImage?.(att.previewUrl, att.name)}
                  aria-label={`Preview ${att.name}`}
                  className='block size-20 overflow-hidden rounded-md border border-white/10 bg-black/40 focus:ring-2 focus:ring-white/40 focus:outline-none'
                >
                  <img
                    src={att.previewUrl}
                    alt={att.name}
                    className='size-full object-cover'
                  />
                </button>
              ))}
            </div>
          )}
        </div>
        {timestamp && (
          <span className='px-2 text-[10px] text-white/40'>{timestamp}</span>
        )}
      </div>
      {isUser && (
        <div
          aria-hidden='true'
          className='mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-white/10 text-white/80'
        >
          <IconUser className='size-4' />
        </div>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
