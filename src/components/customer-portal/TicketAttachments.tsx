// Created and developed by Jai Singh
import { useState } from 'react'
import {
  Download,
  ExternalLink,
  File,
  FileText,
  Image,
  Loader2,
  Paperclip,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getAttachmentDownloadUrl,
  useAttachUrl,
  useTicket,
} from '@/lib/smartsheet/ticket-api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface TicketAttachmentsProps {
  ticketId: string
}

export function TicketAttachments({ ticketId }: TicketAttachmentsProps) {
  const rowId = parseInt(ticketId, 10)
  const { data: ticket, isLoading } = useTicket(rowId)
  const attachUrl = useAttachUrl()

  const [showAttachForm, setShowAttachForm] = useState(false)
  const [urlToAttach, setUrlToAttach] = useState('')
  const [attachmentName, setAttachmentName] = useState('')

  const handleAttachUrl = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!urlToAttach.trim()) {
      toast.error('Please enter a URL')
      return
    }

    if (
      !urlToAttach.startsWith('http://') &&
      !urlToAttach.startsWith('https://')
    ) {
      toast.error(
        'Please enter a valid URL (must start with http:// or https://)'
      )
      return
    }

    try {
      await attachUrl.mutateAsync({
        rowId,
        url: urlToAttach,
        name: attachmentName.trim() || 'Attachment',
      })

      toast.success('URL attached successfully')
      setUrlToAttach('')
      setAttachmentName('')
      setShowAttachForm(false)
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to attach URL'
      )
    }
  }

  const handleDownloadAttachment = async (
    attachmentId: number,
    _attachmentName: string
  ) => {
    try {
      const result = await getAttachmentDownloadUrl(rowId, attachmentId)
      if (result.success && result.data?.attachment?.url) {
        window.open(result.data.attachment.url, '_blank')
      } else {
        toast.error('Failed to get download URL')
      }
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to download attachment'
      )
    }
  }

  const getFileIcon = (mimeType?: string, name?: string) => {
    if (!mimeType && !name) return <File className='h-5 w-5' />

    const type = (mimeType || '').toLowerCase()
    const fileName = (name || '').toLowerCase()

    if (
      type.includes('image') ||
      fileName.match(/\.(jpg|jpeg|png|gif|webp|svg)$/)
    ) {
      return <Image className='h-5 w-5 text-blue-500' />
    }

    if (
      type.includes('pdf') ||
      type.includes('document') ||
      type.includes('text') ||
      fileName.match(/\.(pdf|doc|docx|txt|rtf)$/)
    ) {
      return <FileText className='h-5 w-5 text-red-500' />
    }

    return <File className='text-muted-foreground h-5 w-5' />
  }

  const formatFileSize = (sizeInKb?: number) => {
    if (!sizeInKb) return 'Unknown size'
    if (sizeInKb < 1024) return `${sizeInKb.toFixed(1)} KB`
    return `${(sizeInKb / 1024).toFixed(1)} MB`
  }

  if (isLoading) {
    return (
      <div className='flex items-center justify-center py-8'>
        <Loader2 className='text-muted-foreground h-6 w-6 animate-spin' />
      </div>
    )
  }

  const attachments = ticket?.attachments || []

  return (
    <div className='space-y-6'>
      {/* Attach URL Form */}
      {!showAttachForm ? (
        <Button
          onClick={() => setShowAttachForm(true)}
          variant='outline'
          className='w-full'
        >
          <Paperclip className='mr-2 h-4 w-4' />
          Attach URL
        </Button>
      ) : (
        <Card>
          <CardContent className='pt-6'>
            <form onSubmit={handleAttachUrl} className='space-y-4'>
              <div className='space-y-2'>
                <Label htmlFor='attachment-name'>Attachment Name *</Label>
                <Input
                  id='attachment-name'
                  type='text'
                  placeholder='e.g., Screenshot, Document, etc.'
                  value={attachmentName}
                  onChange={(e) => setAttachmentName(e.target.value)}
                />
              </div>

              <div className='space-y-2'>
                <Label htmlFor='attachment-url'>URL *</Label>
                <Input
                  id='attachment-url'
                  type='url'
                  placeholder='https://example.com/file.pdf'
                  value={urlToAttach}
                  onChange={(e) => setUrlToAttach(e.target.value)}
                />
                <p className='text-muted-foreground text-xs'>
                  Link to an external file or resource
                </p>
              </div>

              <div className='flex gap-2'>
                <Button
                  type='submit'
                  disabled={attachUrl.isPending || !urlToAttach.trim()}
                  className='flex-1'
                >
                  {attachUrl.isPending ? (
                    <>
                      <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                      Attaching...
                    </>
                  ) : (
                    <>
                      <Paperclip className='mr-2 h-4 w-4' />
                      Attach URL
                    </>
                  )}
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  onClick={() => {
                    setShowAttachForm(false)
                    setUrlToAttach('')
                    setAttachmentName('')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Attachments List */}
      {attachments.length === 0 ? (
        <div className='text-muted-foreground py-8 text-center'>
          <Paperclip className='mx-auto mb-2 h-12 w-12 opacity-50' />
          <p className='text-sm'>No attachments yet</p>
        </div>
      ) : (
        <div className='space-y-3'>
          <h4 className='text-sm font-semibold'>
            {attachments.length} Attachment{attachments.length !== 1 ? 's' : ''}
          </h4>

          <div className='space-y-2'>
            {attachments.map((attachment) => (
              <Card
                key={attachment.id}
                className='hover:bg-accent/50 transition-colors'
              >
                <CardContent className='py-3'>
                  <div className='flex items-center justify-between gap-4'>
                    <div className='flex min-w-0 flex-1 items-center gap-3'>
                      {getFileIcon(attachment.mime_type, attachment.name)}
                      <div className='min-w-0 flex-1'>
                        <p className='truncate text-sm font-medium'>
                          {attachment.name}
                        </p>
                        <div className='text-muted-foreground flex items-center gap-2 text-xs'>
                          <span>{formatFileSize(attachment.size_in_kb)}</span>
                          {attachment.attachment_type && (
                            <>
                              <span>•</span>
                              <span className='capitalize'>
                                {attachment.attachment_type.toLowerCase()}
                              </span>
                            </>
                          )}
                          {attachment.created_at && (
                            <>
                              <span>•</span>
                              <span>
                                {new Date(
                                  attachment.created_at
                                ).toLocaleDateString()}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className='flex items-center gap-2'>
                      {attachment.attachment_type === 'LINK' &&
                      attachment.url ? (
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() => window.open(attachment.url, '_blank')}
                        >
                          <ExternalLink className='h-4 w-4' />
                        </Button>
                      ) : (
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() =>
                            handleDownloadAttachment(
                              attachment.id,
                              attachment.name
                            )
                          }
                        >
                          <Download className='h-4 w-4' />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Created and developed by Jai Singh
