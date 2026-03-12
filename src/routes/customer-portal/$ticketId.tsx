import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PublicHeader } from '@/components/customer-portal/PublicHeader'
import { TicketAttachments } from '@/components/customer-portal/TicketAttachments'
import { TicketComments } from '@/components/customer-portal/TicketComments'
import { TicketDetailView } from '@/components/customer-portal/TicketDetailView'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'

function TicketDetailPage() {
  const { ticketId } = Route.useParams()
  const navigate = useNavigate()

  return (
    <>
      <PublicHeader fixed>
        <div className='flex items-center space-x-4'>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => navigate({ to: '/customer-portal' })}
          >
            <ArrowLeft className='mr-2 h-4 w-4' />
            Back to Portal
          </Button>
          <h1 className='text-lg font-semibold'>Ticket #{ticketId}</h1>
        </div>
        <div className='ml-auto flex items-center space-x-4'>
          <ThemeSwitch />
        </div>
      </PublicHeader>

      <Main>
        <div className='space-y-6'>
          {/* Ticket Details */}
          <TicketDetailView ticketId={ticketId} />

          {/* Comments Section */}
          <div className='bg-background rounded-lg border p-6'>
            <h3 className='mb-4 text-xl font-semibold'>
              Comments & Discussion
            </h3>
            <TicketComments ticketId={ticketId} />
          </div>

          {/* Attachments Section */}
          <div className='bg-background rounded-lg border p-6'>
            <h3 className='mb-4 text-xl font-semibold'>Attachments</h3>
            <TicketAttachments ticketId={ticketId} />
          </div>
        </div>
      </Main>
    </>
  )
}

export const Route = createFileRoute('/customer-portal/$ticketId')({
  component: TicketDetailPage,
})
// Developer and Creator: Jai Singh
