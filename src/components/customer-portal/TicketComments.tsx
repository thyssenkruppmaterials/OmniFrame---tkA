import { useState, useEffect, useMemo } from 'react'
import { format } from 'date-fns'
import { Loader2, MessageSquare, Send, User } from 'lucide-react'
import { toast } from 'sonner'
import { useUnifiedAuth } from '@/lib/auth/unified-auth-provider'
import { useAddComment, useTicket } from '@/lib/smartsheet/ticket-api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

/**
 * Formats a comment with the user's name and timestamp for Smartsheet tracking.
 * This helps identify which OmniFrame user submitted each comment.
 */
function formatCommentWithTimestamp(
  message: string,
  authorName: string
): string {
  const timestamp = format(new Date(), 'MMM d, yyyy h:mm a')
  const signature = authorName ? `${authorName}` : 'User'
  return `${message}\n\n— ${signature}, ${timestamp}`
}

interface TicketCommentsProps {
  ticketId: string
}

export function TicketComments({ ticketId }: TicketCommentsProps) {
  const rowId = parseInt(ticketId, 10)
  const { data: ticket, isLoading } = useTicket(rowId)
  const addComment = useAddComment()
  const { authState } = useUnifiedAuth()

  const [commentText, setCommentText] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [authorEmail, setAuthorEmail] = useState('')
  const [showCommentForm, setShowCommentForm] = useState(false)

  // Auto-populate author info from authenticated user
  const userFullName = useMemo(() => {
    const profile = authState.profile
    if (profile?.first_name || profile?.last_name) {
      return [profile.first_name, profile.last_name].filter(Boolean).join(' ')
    }
    return profile?.full_name || ''
  }, [authState.profile])

  const userEmail = authState.user?.email || ''

  // Set initial values from auth when form opens
  useEffect(() => {
    if (showCommentForm) {
      // Only auto-fill if fields are empty (don't override user edits)
      if (!authorName && userFullName) {
        setAuthorName(userFullName)
      }
      if (!authorEmail && userEmail) {
        setAuthorEmail(userEmail)
      }
    }
  }, [showCommentForm, userFullName, userEmail, authorName, authorEmail])

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!commentText.trim()) {
      toast.error('Please enter a comment')
      return
    }

    try {
      // Format the comment with user name and timestamp for Smartsheet tracking
      const effectiveAuthorName = authorName.trim() || userFullName || 'User'
      const formattedText = formatCommentWithTimestamp(
        commentText.trim(),
        effectiveAuthorName
      )

      await addComment.mutateAsync({
        rowId,
        comment: {
          text: formattedText,
          author_name: authorName.trim() || userFullName || undefined,
          author_email: authorEmail.trim() || userEmail || undefined,
        },
      })

      toast.success('Comment added successfully')
      setCommentText('')
      setShowCommentForm(false)
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to add comment'
      )
    }
  }

  if (isLoading) {
    return (
      <div className='flex items-center justify-center py-8'>
        <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
      </div>
    )
  }

  const discussions = ticket?.discussions || []
  const allComments = discussions
    .flatMap((d) => d.comments)
    .sort((a, b) => {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0
      return dateB - dateA
    })

  return (
    <div className='space-y-4'>
      {/* Add Comment Form */}
      {!showCommentForm ? (
        <Button
          onClick={() => setShowCommentForm(true)}
          variant='outline'
          className='w-full'
        >
          <MessageSquare className='mr-2 h-4 w-4' />
          Add a Comment
        </Button>
      ) : (
        <Card>
          <CardContent className='pt-6'>
            <form onSubmit={handleSubmitComment} className='space-y-4'>
              <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
                <div className='space-y-2'>
                  <Label htmlFor='author-name'>
                    Your Name{' '}
                    {userFullName && (
                      <span className='text-muted-foreground text-xs'>
                        (auto-filled)
                      </span>
                    )}
                  </Label>
                  <Input
                    id='author-name'
                    type='text'
                    placeholder='Enter your name'
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                  />
                </div>

                <div className='space-y-2'>
                  <Label htmlFor='author-email'>
                    Your Email{' '}
                    {userEmail && (
                      <span className='text-muted-foreground text-xs'>
                        (auto-filled)
                      </span>
                    )}
                  </Label>
                  <Input
                    id='author-email'
                    type='email'
                    placeholder='Enter your email'
                    value={authorEmail}
                    onChange={(e) => setAuthorEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className='space-y-2'>
                <Label htmlFor='comment-text'>Comment *</Label>
                <Textarea
                  id='comment-text'
                  placeholder='Enter your comment or question'
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  rows={4}
                />
              </div>

              <div className='flex gap-2'>
                <Button
                  type='submit'
                  disabled={addComment.isPending || !commentText.trim()}
                  className='flex-1'
                >
                  {addComment.isPending ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      Posting...
                    </>
                  ) : (
                    <>
                      <Send className='mr-2 h-4 w-4' />
                      Post Comment
                    </>
                  )}
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => {
                    setShowCommentForm(false)
                    setCommentText('')
                    setAuthorName('')
                    setAuthorEmail('')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Comments List */}
      {allComments.length === 0 ? (
        <div className='text-muted-foreground py-8 text-center'>
          <MessageSquare className='mx-auto mb-2 h-12 w-12 opacity-50' />
          <p className='text-sm'>No comments yet. Be the first to comment!</p>
        </div>
      ) : (
        <div className='space-y-3'>
          <div className='flex items-center justify-between'>
            <h4 className='text-sm font-semibold'>
              {allComments.length} Comment{allComments.length !== 1 ? 's' : ''}
            </h4>
          </div>

          <div className='space-y-2'>
            {allComments.map((comment, index) => (
              <div key={comment.id} className='space-y-3'>
                <Card>
                  <CardContent className='pt-4'>
                    <div className='space-y-2'>
                      {/* Comment Header */}
                      <div className='flex items-start justify-between'>
                        <div className='flex items-center gap-2'>
                          <User className='text-muted-foreground h-4 w-4' />
                          <span className='text-sm font-medium'>
                            {comment.created_by?.name ||
                              comment.created_by?.email ||
                              'Customer'}
                          </span>
                        </div>
                        {comment.created_at && (
                          <span className='text-muted-foreground text-xs'>
                            {new Date(comment.created_at).toLocaleString()}
                          </span>
                        )}
                      </div>

                      {/* Comment Text */}
                      <p className='pl-6 text-sm whitespace-pre-wrap'>
                        {comment.text}
                      </p>

                      {/* Attachments (if any) */}
                      {comment.attachments &&
                        comment.attachments.length > 0 && (
                          <div className='pt-2 pl-6'>
                            <p className='text-muted-foreground mb-1 text-xs'>
                              Attachments:
                            </p>
                            <div className='space-y-1'>
                              {comment.attachments.map((attachment) => (
                                <a
                                  key={attachment.id}
                                  href={attachment.url}
                                  target='_blank'
                                  rel='noopener noreferrer'
                                  className='block text-xs text-blue-600 hover:underline'
                                >
                                  {attachment.name}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                    </div>
                  </CardContent>
                </Card>
                {index < allComments.length - 1 && <Separator />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
