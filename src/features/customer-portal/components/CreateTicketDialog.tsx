/**
 * Create Ticket Dialog Component
 *
 * Dialog for internal staff to create new support tickets.
 * Uses Rust Core Smartsheet service for data.
 */
import { useState } from 'react'
import { IconLoader2 } from '@tabler/icons-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  useCreateTicket,
  TicketPriority,
  TicketCategory,
} from '../hooks/useTickets'

interface CreateTicketDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function CreateTicketDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateTicketDialogProps) {
  const { createTicket, isPending } = useCreateTicket()

  const [formData, setFormData] = useState({
    customer_id: '',
    email: '',
    subject: '',
    description: '',
    priority: TicketPriority.MEDIUM,
    category: TicketCategory.GENERAL,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.customer_id.trim()) {
      toast.error('Customer ID is required')
      return
    }
    if (!formData.email.trim()) {
      toast.error('Email is required')
      return
    }
    if (!formData.subject.trim()) {
      toast.error('Subject is required')
      return
    }
    if (!formData.description.trim()) {
      toast.error('Description is required')
      return
    }

    try {
      await createTicket(formData)
      toast.success('Ticket created successfully')
      setFormData({
        customer_id: '',
        email: '',
        subject: '',
        description: '',
        priority: TicketPriority.MEDIUM,
        category: TicketCategory.GENERAL,
      })
      onSuccess?.()
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create ticket'
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[525px]'>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Ticket</DialogTitle>
            <DialogDescription>
              Create a support ticket on behalf of a customer.
            </DialogDescription>
          </DialogHeader>

          <div className='grid gap-4 py-4'>
            <div className='grid grid-cols-2 gap-4'>
              <div className='space-y-2'>
                <Label htmlFor='customer_id'>Customer ID *</Label>
                <Input
                  id='customer_id'
                  value={formData.customer_id}
                  onChange={(e) =>
                    setFormData({ ...formData, customer_id: e.target.value })
                  }
                  placeholder='CUST-001'
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='email'>Email *</Label>
                <Input
                  id='email'
                  type='email'
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  placeholder='customer@example.com'
                />
              </div>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='subject'>Subject *</Label>
              <Input
                id='subject'
                value={formData.subject}
                onChange={(e) =>
                  setFormData({ ...formData, subject: e.target.value })
                }
                placeholder='Brief description of the issue'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='description'>Description *</Label>
              <Textarea
                id='description'
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder='Detailed description of the issue...'
                rows={4}
              />
            </div>

            <div className='grid grid-cols-2 gap-4'>
              <div className='space-y-2'>
                <Label htmlFor='priority'>Priority</Label>
                <Select
                  value={formData.priority}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      priority: value as TicketPriority,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TicketPriority.LOW}>Low</SelectItem>
                    <SelectItem value={TicketPriority.MEDIUM}>
                      Medium
                    </SelectItem>
                    <SelectItem value={TicketPriority.HIGH}>High</SelectItem>
                    <SelectItem value={TicketPriority.CRITICAL}>
                      Critical
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-2'>
                <Label htmlFor='category'>Category</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      category: value as TicketCategory,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TicketCategory.GENERAL}>
                      General
                    </SelectItem>
                    <SelectItem value={TicketCategory.TECHNICAL}>
                      Technical
                    </SelectItem>
                    <SelectItem value={TicketCategory.BILLING}>
                      Billing
                    </SelectItem>
                    <SelectItem value={TicketCategory.SHIPPING}>
                      Shipping
                    </SelectItem>
                    <SelectItem value={TicketCategory.PRODUCT}>
                      Product
                    </SelectItem>
                    <SelectItem value={TicketCategory.OTHER}>Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type='submit' disabled={isPending}>
              {isPending ? (
                <>
                  <IconLoader2 className='mr-2 h-4 w-4 animate-spin' />
                  Creating...
                </>
              ) : (
                'Create Ticket'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
