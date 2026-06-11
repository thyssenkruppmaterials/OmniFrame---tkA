// Created and developed by Jai Singh
/**
 * Ticket Chat Thread Component
 *
 * Real-time chat/comment thread UI with message bubbles,
 * avatars, timestamps, and inline reply composer.
 * Uses Rust Core Smartsheet service for data.
 */
import { useState, useRef, useEffect, useMemo } from 'react'
import { format, isToday, isYesterday } from 'date-fns'
import { IconSend, IconLoader2, IconMessageCircle } from '@tabler/icons-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  useAddTicketComment,
  type Discussion,
  type Comment,
} from '../hooks/useTickets'

/**
 * Formats a comment with the user's name and timestamp for Smartsheet tracking.
 * Since all comments go through a single API, this helps identify which OmniFrame user
 * submitted each comment.
 */
function formatCommentWithUserInfo(
  message: string,
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string | undefined
): string {
  // Build the user display name
  const hasName = firstName || lastName
  const fullName = hasName
    ? [firstName, lastName].filter(Boolean).join(' ')
    : email || 'Unknown User'

  // Format the timestamp
  const timestamp = format(new Date(), 'MMM d, yyyy h:mm a')

  // Append user signature to the message
  return `${message}\n\n— ${fullName}, ${timestamp}`
}

interface TicketChatThreadProps {
  ticketId: number
  discussions: Discussion[]
  onCommentAdded?: () => void
}

export function TicketChatThread({
  ticketId,
  discussions,
  onCommentAdded,
}: TicketChatThreadProps) {
  const [message, setMessage] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { authState } = useUnifiedAuth()
  const currentUserEmail = authState.user?.email
  const userProfile = authState.profile

  const { addComment, isPending } = useAddTicketComment()

  // Memoize user info for comment formatting
  const userInfo = useMemo(
    () => ({
      firstName: userProfile?.first_name,
      lastName: userProfile?.last_name,
      email: currentUserEmail,
    }),
    [userProfile?.first_name, userProfile?.last_name, currentUserEmail]
  )

  // Flatten all comments from discussions and sort by date
  const allComments = discussions
    .flatMap((d) => d.comments || [])
    .sort((a, b) => {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0
      return dateA - dateB // Oldest first (chronological)
    })

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [allComments.length])

  const handleSend = async () => {
    if (!message.trim()) return

    try {
      // Format the message with user info and timestamp for Smartsheet tracking
      const formattedMessage = formatCommentWithUserInfo(
        message.trim(),
        userInfo.firstName,
        userInfo.lastName,
        userInfo.email
      )

      await addComment(ticketId, formattedMessage)
      setMessage('')
      onCommentAdded?.()
      // Note: Toast is shown by the underlying useCreateRowDiscussion hook
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to send message'
      )
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Group messages by date for date separators
  const groupedMessages = allComments.reduce<
    { date: string; messages: Comment[] }[]
  >((groups, comment) => {
    const dateStr = comment.created_at
      ? format(new Date(comment.created_at), 'yyyy-MM-dd')
      : 'unknown'

    const lastGroup = groups[groups.length - 1]
    if (lastGroup?.date === dateStr) {
      lastGroup.messages.push(comment)
    } else {
      groups.push({ date: dateStr, messages: [comment] })
    }
    return groups
  }, [])

  const formatDateSeparator = (dateStr: string) => {
    if (dateStr === 'unknown') return 'Unknown Date'
    const date = new Date(dateStr)
    if (isToday(date)) return 'Today'
    if (isYesterday(date)) return 'Yesterday'
    return format(date, 'MMMM d, yyyy')
  }

  return (
    <div className='flex h-full flex-col'>
      {/* Messages Area */}
      <ScrollArea className='flex-1 pr-4' ref={scrollRef}>
        {allComments.length === 0 ? (
          <div className='text-muted-foreground flex flex-col items-center justify-center py-12'>
            <IconMessageCircle className='mb-3 h-12 w-12 opacity-40' />
            <p className='text-sm font-medium'>No comments yet</p>
            <p className='text-xs'>
              Start the conversation by sending a message
            </p>
          </div>
        ) : (
          <div className='space-y-1 pb-4'>
            {groupedMessages.map((group) => (
              <div key={group.date}>
                {/* Date Separator */}
                <div className='my-4 flex items-center gap-4'>
                  <div className='bg-border h-px flex-1' />
                  <span className='text-muted-foreground text-xs font-medium'>
                    {formatDateSeparator(group.date)}
                  </span>
                  <div className='bg-border h-px flex-1' />
                </div>

                {/* Messages */}
                <div className='space-y-3'>
                  {group.messages.map((comment) => (
                    <MessageBubble
                      key={comment.id}
                      comment={comment}
                      isCurrentUser={
                        comment.created_by?.email === currentUserEmail
                      }
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Reply Composer */}
      <div className='mt-auto border-t pt-4'>
        <div className='flex items-center gap-2'>
          <Input
            ref={inputRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Type your message...'
            disabled={isPending}
            className='flex-1'
          />
          <Button
            onClick={handleSend}
            disabled={!message.trim() || isPending}
            size='icon'
          >
            {isPending ? (
              <IconLoader2 className='h-4 w-4 animate-spin' />
            ) : (
              <IconSend className='h-4 w-4' />
            )}
          </Button>
        </div>
        <p className='text-muted-foreground mt-2 text-xs'>
          Press Enter to send
        </p>
      </div>
    </div>
  )
}

// Individual Message Bubble
interface MessageBubbleProps {
  comment: Comment
  isCurrentUser: boolean
}

function MessageBubble({ comment, isCurrentUser }: MessageBubbleProps) {
  const author =
    comment.created_by?.name || comment.created_by?.email || 'Unknown'
  const initials = getInitials(author)
  const timestamp = comment.created_at
    ? format(new Date(comment.created_at), 'h:mm a')
    : ''

  return (
    <div
      className={cn(
        'flex gap-3',
        isCurrentUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      <Avatar className='h-8 w-8 flex-shrink-0'>
        <AvatarFallback
          className={cn(
            'text-xs font-medium',
            isCurrentUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
          )}
        >
          {initials}
        </AvatarFallback>
      </Avatar>

      {/* Message Content */}
      <div
        className={cn(
          'flex max-w-[75%] flex-col',
          isCurrentUser ? 'items-end' : 'items-start'
        )}
      >
        {/* Author Name */}
        <div
          className={cn(
            'mb-1 flex items-center gap-2',
            isCurrentUser ? 'flex-row-reverse' : 'flex-row'
          )}
        >
          <span className='text-xs font-medium'>
            {isCurrentUser ? 'You' : author}
          </span>
          <span className='text-muted-foreground text-xs'>{timestamp}</span>
        </div>

        {/* Message Bubble */}
        <div
          className={cn(
            'rounded-2xl px-4 py-2 text-sm',
            isCurrentUser
              ? 'bg-primary text-primary-foreground rounded-tr-sm'
              : 'bg-muted rounded-tl-sm'
          )}
        >
          <p className='break-words whitespace-pre-wrap'>{comment.text}</p>
        </div>

        {/* Attachments (if any) */}
        {comment.attachments && comment.attachments.length > 0 && (
          <div className='mt-1 flex flex-wrap gap-1'>
            {comment.attachments.map((att) => (
              <a
                key={att.id}
                href={att.url}
                target='_blank'
                rel='noopener noreferrer'
                className='text-xs text-blue-500 hover:underline'
              >
                📎 {att.name}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Helper to get initials from name/email
function getInitials(name: string): string {
  // If it's an email, get first letter of each part before @
  if (name.includes('@')) {
    const localPart = name.split('@')[0]
    const parts = localPart.split(/[._-]/)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }
    return localPart.substring(0, 2).toUpperCase()
  }

  // Otherwise get initials from name parts
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return name.substring(0, 2).toUpperCase()
}

// Created and developed by Jai Singh
