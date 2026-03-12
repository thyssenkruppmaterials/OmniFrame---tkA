import { useState } from 'react'
import {
  Calendar,
  Circle,
  FileText,
  Inbox,
  Loader2,
  Mail,
  Search,
  Tag,
  User,
} from 'lucide-react'
import { toast } from 'sonner'
import { type Ticket, useSearchTickets } from '@/lib/smartsheet/ticket-api'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TicketPriorityBadge, TicketStatusBadge } from './TicketStatusBadge'

export function TicketLookupForm() {
  const [searchType, setSearchType] = useState<'email' | 'customer_id'>('email')
  const [searchValue, setSearchValue] = useState('')
  const [shouldSearch, setShouldSearch] = useState(false)
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null)

  const { data, isLoading, error } = useSearchTickets(
    searchType === 'email' ? searchValue : undefined,
    searchType === 'customer_id' ? searchValue : undefined,
    {
      enabled: shouldSearch && searchValue.length > 0,
    }
  )

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()

    if (!searchValue.trim()) {
      toast.error('Please enter a search value')
      return
    }

    if (searchType === 'email' && !searchValue.includes('@')) {
      toast.error('Please enter a valid email address')
      return
    }

    setShouldSearch(true)
    setSelectedTicketId(null)
  }

  const getRelativeTime = (dateString: string | undefined) => {
    if (!dateString) return ''

    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`

    return date.toLocaleDateString()
  }

  const isTicketUnread = (ticket: Ticket) => {
    const isRecent = ticket.created_at
      ? new Date().getTime() - new Date(ticket.created_at).getTime() < 86400000
      : false
    return ticket.status === 'Open' || isRecent
  }

  const selectedTicket = data?.tickets.find(
    (t) => t.row_id === selectedTicketId
  )

  return (
    <div className='space-y-4'>
      {/* Search Form */}
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Mail className='h-5 w-5' />
            Search for Your Tickets
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className='space-y-4'>
            <div className='flex gap-4'>
              <div className='flex-1 space-y-2'>
                <Label htmlFor='search-value'>
                  {searchType === 'email' ? 'Email Address' : 'Customer ID'}
                </Label>
                <Input
                  id='search-value'
                  type={searchType === 'email' ? 'email' : 'text'}
                  placeholder={
                    searchType === 'email'
                      ? 'Enter your email address'
                      : 'Enter your customer ID'
                  }
                  value={searchValue}
                  onChange={(e) => {
                    setSearchValue(e.target.value)
                    setShouldSearch(false)
                  }}
                  className='flex-1'
                />
              </div>
            </div>

            <div className='flex gap-2'>
              <Button
                type='button'
                variant={searchType === 'email' ? 'default' : 'outline'}
                onClick={() => {
                  setSearchType('email')
                  setSearchValue('')
                  setShouldSearch(false)
                }}
                size='sm'
              >
                Search by Email
              </Button>
              <Button
                type='button'
                variant={searchType === 'customer_id' ? 'default' : 'outline'}
                onClick={() => {
                  setSearchType('customer_id')
                  setSearchValue('')
                  setShouldSearch(false)
                }}
                size='sm'
              >
                Search by Customer ID
              </Button>
            </div>

            <Button type='submit' className='w-full' disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Searching...
                </>
              ) : (
                <>
                  <Search className='mr-2 h-4 w-4' />
                  Search Tickets
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Card className='border-destructive'>
          <CardContent className='pt-6'>
            <p className='text-destructive text-sm'>
              Error: {error.message || 'Failed to search tickets'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Outlook-Style Two-Column Layout */}
      {shouldSearch && data && data.total_count > 0 && (
        <Card>
          <CardHeader className='pb-3'>
            <div className='flex items-center justify-between'>
              <CardTitle className='flex items-center gap-2'>
                <Inbox className='h-5 w-5' />
                Inbox ({data.total_count})
              </CardTitle>
              <p className='text-muted-foreground text-sm'>
                {data.tickets.filter((t) => isTicketUnread(t)).length} unread
              </p>
            </div>
          </CardHeader>
          <CardContent className='p-0'>
            <div className='divide-border grid h-[600px] grid-cols-1 divide-x lg:grid-cols-[400px_1fr]'>
              {/* Left Panel - Ticket List */}
              <div className='flex flex-col'>
                <ScrollArea className='h-[600px]'>
                  <div className='divide-border divide-y'>
                    {data.tickets.map((ticket) => {
                      const unread = isTicketUnread(ticket)
                      const isSelected = selectedTicketId === ticket.row_id

                      return (
                        <div
                          key={ticket.row_id}
                          className={cn(
                            'group relative flex cursor-pointer items-start gap-3 px-4 py-3 transition-all',
                            'hover:bg-accent/50',
                            isSelected &&
                              'bg-accent border-l-primary border-l-2',
                            unread && !isSelected && 'bg-muted/30'
                          )}
                          onClick={() => setSelectedTicketId(ticket.row_id)}
                        >
                          {/* Unread Indicator */}
                          <div className='flex-shrink-0 pt-1'>
                            {unread ? (
                              <Circle className='fill-primary text-primary h-2.5 w-2.5' />
                            ) : (
                              <div className='h-2.5 w-2.5' />
                            )}
                          </div>

                          {/* Ticket Content */}
                          <div className='min-w-0 flex-1 space-y-1'>
                            {/* Subject Line */}
                            <div className='flex items-start justify-between gap-2'>
                              <h4
                                className={cn(
                                  'flex-1 truncate text-sm',
                                  unread ? 'font-semibold' : 'font-normal'
                                )}
                              >
                                {ticket.subject}
                              </h4>
                              <span className='text-muted-foreground flex-shrink-0 text-xs'>
                                {getRelativeTime(ticket.created_at)}
                              </span>
                            </div>

                            {/* Preview Text */}
                            <p
                              className={cn(
                                'line-clamp-2 text-xs',
                                unread
                                  ? 'text-foreground/70'
                                  : 'text-muted-foreground'
                              )}
                            >
                              {ticket.description}
                            </p>

                            {/* Badges Row */}
                            <div className='flex items-center gap-2 pt-1'>
                              <TicketStatusBadge status={ticket.status} />
                              <TicketPriorityBadge priority={ticket.priority} />
                              {ticket.category && (
                                <span className='text-muted-foreground text-xs'>
                                  {ticket.category}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </ScrollArea>
              </div>

              {/* Right Panel - Preview Pane */}
              <div className='bg-muted/20 flex flex-col'>
                {selectedTicket ? (
                  <div className='flex h-full flex-col'>
                    {/* Preview Header */}
                    <div className='border-border bg-background space-y-3 border-b p-4'>
                      <div className='flex items-start justify-between gap-4'>
                        <div className='flex-1 space-y-2'>
                          <h3 className='text-xl font-semibold'>
                            {selectedTicket.subject}
                          </h3>
                          <div className='flex items-center gap-2'>
                            <TicketStatusBadge status={selectedTicket.status} />
                            <TicketPriorityBadge
                              priority={selectedTicket.priority}
                            />
                          </div>
                        </div>
                        <span className='text-muted-foreground text-sm'>
                          #{selectedTicket.ticket_id}
                        </span>
                      </div>
                    </div>

                    {/* Preview Body */}
                    <ScrollArea className='flex-1'>
                      <div className='space-y-4 p-4'>
                        {/* Ticket Details Grid */}
                        <div className='grid grid-cols-2 gap-4'>
                          <div className='space-y-1'>
                            <div className='text-muted-foreground flex items-center gap-2 text-xs'>
                              <User className='h-3 w-3' />
                              Customer ID
                            </div>
                            <p className='text-sm font-medium'>
                              {selectedTicket.customer_id || 'N/A'}
                            </p>
                          </div>

                          <div className='space-y-1'>
                            <div className='text-muted-foreground flex items-center gap-2 text-xs'>
                              <Mail className='h-3 w-3' />
                              Email
                            </div>
                            <p className='text-sm font-medium'>
                              {selectedTicket.email}
                            </p>
                          </div>

                          <div className='space-y-1'>
                            <div className='text-muted-foreground flex items-center gap-2 text-xs'>
                              <Tag className='h-3 w-3' />
                              Category
                            </div>
                            <p className='text-sm font-medium'>
                              {selectedTicket.category || 'General'}
                            </p>
                          </div>

                          <div className='space-y-1'>
                            <div className='text-muted-foreground flex items-center gap-2 text-xs'>
                              <Calendar className='h-3 w-3' />
                              Created
                            </div>
                            <p className='text-sm font-medium'>
                              {selectedTicket.created_at
                                ? new Date(
                                    selectedTicket.created_at
                                  ).toLocaleString()
                                : 'N/A'}
                            </p>
                          </div>
                        </div>

                        {/* Description */}
                        <div className='space-y-2'>
                          <div className='flex items-center gap-2 text-sm font-medium'>
                            <FileText className='h-4 w-4' />
                            Description
                          </div>
                          <Card>
                            <CardContent className='pt-4'>
                              <p className='text-sm whitespace-pre-wrap'>
                                {selectedTicket.description}
                              </p>
                            </CardContent>
                          </Card>
                        </div>

                        {/* View Full Details Button */}
                        <Button
                          className='w-full'
                          onClick={(e) => {
                            e.stopPropagation()
                            window.location.href = `/customer-portal/${selectedTicket.row_id}`
                          }}
                        >
                          View Full Ticket Details
                        </Button>
                      </div>
                    </ScrollArea>
                  </div>
                ) : (
                  <div className='flex h-full items-center justify-center p-8'>
                    <div className='space-y-3 text-center'>
                      <Mail className='text-muted-foreground/20 mx-auto h-16 w-16' />
                      <div>
                        <p className='text-muted-foreground font-medium'>
                          No ticket selected
                        </p>
                        <p className='text-muted-foreground mt-1 text-sm'>
                          Select a ticket from the list to preview
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* No Results */}
      {shouldSearch && data && data.total_count === 0 && (
        <Card>
          <CardContent className='p-8'>
            <div className='space-y-3 text-center'>
              <Mail className='text-muted-foreground/20 mx-auto h-16 w-16' />
              <div>
                <p className='text-muted-foreground font-medium'>
                  No tickets found
                </p>
                <p className='text-muted-foreground mt-1 text-sm'>
                  No tickets found for the provided{' '}
                  {searchType === 'email' ? 'email address' : 'customer ID'}.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
